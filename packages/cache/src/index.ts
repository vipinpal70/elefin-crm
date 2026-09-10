import { createHash } from "node:crypto";
import Redis, { type RedisOptions } from "ioredis";

/**
 * Tiny read-through cache over Redis for the web app's hot data paths.
 *
 * Principles:
 *  - **Optional.** No `REDIS_URL` (or `CACHE_DISABLED=1`) → every call is a
 *    straight passthrough to the loader. Dev works with nothing running.
 *  - **Never blocks.** Commands are only issued while the connection is
 *    `ready`; every command is also time-boxed. A slow, half-open, or down
 *    Redis just means you get a fresh (uncached) result — it can't hang or
 *    fail a page.
 *  - **Tag invalidation, not TTL.** A cached value declares which data groups
 *    (`tags`) it derives from. The worker bumps a tag after a sync; a server
 *    action bumps one after a write. Bumping a tag `INCR`s a counter that is
 *    baked into every key using it, so old entries are instantly unreachable
 *    and expire on their own. No `KEYS` / `SCAN`. TTL is only a safety net.
 *
 * Only import from server code (route handlers, server components, the worker).
 */

const NS = "elefin";

// Bump (via env) to invalidate *everything* at once — e.g. after a deploy that
// changes the shape of a cached value.
const SCHEMA = process.env.CACHE_SCHEMA || "1";

const DISABLED =
  process.env.CACHE_DISABLED === "1" || process.env.CACHE_DISABLED === "true";

// Hard ceiling on any single Redis round-trip. Past this we abandon the cache
// for this call and run the loader.
const OP_TIMEOUT_MS = 500;

/** Invalidation groups. Keep in sync with the worker's per-job map. */
export const TAGS = [
  "clients", // Client collection (sync-clients / sync-accounts)
  "funding", // FundingEvent (sync-transactions)
  "trades", // Trade (sync-trades)
  "positions", // Position (sync-positions)
  "book", // BookDaily snapshots (snapshot job)
  "alerts", // Alert collection (run-alerts + ack/snooze actions)
  "digest", // Digest docs (digest job)
  "config", // AppConfig / CrmUser / audit / Elefin /me (settings actions, sync-me)
  "notes", // ClientNote (notes actions)
] as const;
export type Tag = (typeof TAGS)[number];

export interface CacheOptions {
  /** Seconds to live. A backstop only — tags do the real invalidation. */
  ttl: number;
  /** Data groups this value is derived from; bumping any of them evicts it. */
  tags?: Tag[];
}

interface Slot {
  client: Redis | null | undefined;
}
const globalForRedis = globalThis as unknown as { __elefinRedis?: Slot };
const slot: Slot =
  globalForRedis.__elefinRedis ??
  (globalForRedis.__elefinRedis = { client: undefined });

let warned = false;
function warnOnce(msg: string, err?: unknown): void {
  if (warned) return;
  warned = true;
  const detail = err instanceof Error ? `: ${err.message}` : "";
  console.warn(`[cache] ${msg}${detail} — falling back to uncached reads`);
}

/**
 * The shared Redis connection, or `null` when caching is off. Memoised on
 * `globalThis` so Next's dev hot-reload and many server invocations reuse one
 * socket (same trick as the Mongoose connection). Connects lazily in the
 * background; callers must check {@link ready} before issuing a command.
 */
export function getRedis(): Redis | null {
  if (slot.client !== undefined) return slot.client;

  const url = process.env.REDIS_URL;
  if (DISABLED || !url) return (slot.client = null);

  const opts: RedisOptions = {
    // Connect in the background — never on the import path.
    lazyConnect: true,
    // No implicit queuing: we gate on status ourselves and fall back instead.
    enableOfflineQueue: false,
    maxRetriesPerRequest: 2,
    connectTimeout: 1000,
    keyPrefix: `${NS}:${SCHEMA}:`,
    // Reconnect with capped back-off, but give up after ~20 straight failures
    // (~90s) so a dead Redis can't pin the event loop open in short-lived
    // scripts. The counter resets on any successful (re)connect, so brief blips
    // in a long-lived server still self-heal.
    retryStrategy: (n) => (n > 20 ? null : Math.min(n * 300, 5000)),
    reconnectOnError: () => true,
  };

  const client = new Redis(url, opts);
  client.on("error", (err) => warnOnce("redis connection error", err));
  // Kick off the connection; swallow the initial failure (retryStrategy owns it).
  client.connect().catch(() => undefined);
  return (slot.client = client);
}

/**
 * Close the shared connection. Long-lived processes (web, worker) don't need
 * this; call it from short-lived scripts so the process can exit promptly.
 */
export async function closeCache(): Promise<void> {
  const client = slot.client;
  slot.client = undefined;
  if (!client) return;
  try {
    await client.quit();
  } catch {
    client.disconnect();
  }
}

/** True when the client exists and can take a command right now. */
function ready(client: Redis | null): client is Redis {
  return client !== null && client.status === "ready";
}

/** Run `op`, but give up (resolve `null`) after {@link OP_TIMEOUT_MS}. */
async function withTimeout<T>(op: Promise<T>): Promise<T | null> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      op,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), OP_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Build the final key: `q:<name>@<tag><ver>.<tag><ver>...` (versions from Redis). */
async function keyFor(
  redis: Redis,
  name: string,
  tags: Tag[],
): Promise<string | null> {
  if (tags.length === 0) return `q:${name}`;
  const versions = await withTimeout(
    redis.mget(...tags.map((t) => `tag:${t}`)),
  );
  if (versions === null) return null; // timed out — skip cache for this call
  const stamp = tags.map((t, i) => `${t}${versions[i] ?? "0"}`).join(".");
  return `q:${name}@${stamp}`;
}

/**
 * Return `loader()`'s result, caching it in Redis under a tag-versioned key.
 * A Redis hiccup just means you get a fresh (uncached) result.
 */
export async function cached<T>(
  name: string,
  opts: CacheOptions,
  loader: () => Promise<T>,
): Promise<T> {
  const redis = getRedis();
  if (!ready(redis)) return loader();

  let key: string | null = null;
  try {
    key = await keyFor(redis, name, opts.tags ?? []);
    if (key) {
      const hit = await withTimeout(redis.get(key));
      if (hit != null) return JSON.parse(hit) as T;
    }
  } catch (err) {
    warnOnce("read failed", err);
    return loader();
  }

  const value = await loader(); // loader errors propagate — never swallowed
  try {
    if (value !== undefined && key && ready(redis)) {
      await withTimeout(
        redis.set(
          key,
          JSON.stringify(value),
          "EX",
          Math.max(1, Math.floor(opts.ttl)),
        ),
      );
    }
  } catch (err) {
    warnOnce("write failed", err);
  }
  return value;
}

/**
 * Evict every cached value that used any of `tags`. Call after a write:
 *   - the worker, once a sync job succeeds
 *   - a server action, after it mutates the collection
 * One `INCR` per tag; safe to over-call.
 */
export async function invalidate(...tags: Tag[]): Promise<void> {
  const redis = getRedis();
  if (!ready(redis) || tags.length === 0) return;
  try {
    const pipe = redis.pipeline();
    for (const t of new Set(tags)) pipe.incr(`tag:${t}`);
    await withTimeout(pipe.exec());
  } catch (err) {
    warnOnce("invalidate failed", err);
  }
}

/** Stable short discriminator for a query object, for use inside a cache name. */
export function hashKey(value: unknown): string {
  return createHash("sha1")
    .update(JSON.stringify(value) ?? "null")
    .digest("base64url")
    .slice(0, 16);
}

/** For the health endpoint. */
export async function cacheHealth(): Promise<{
  enabled: boolean;
  ok: boolean;
  ms: number | null;
}> {
  const redis = getRedis();
  if (redis === null) return { enabled: false, ok: false, ms: null };
  const started = Date.now();
  try {
    const pong = await withTimeout(redis.ping());
    return { enabled: true, ok: pong === "PONG", ms: Date.now() - started };
  } catch {
    return { enabled: true, ok: false, ms: Date.now() - started };
  }
}
