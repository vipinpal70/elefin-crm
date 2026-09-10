import { RateLimiter } from "./rate-limiter";
import type { ApiEnvelope } from "./types";

export type ElefinErrorCode =
  | "unauthorized" // 401 - bad/expired/inactive credential (terminal)
  | "forbidden" // 403 - key lacks the ability (terminal)
  | "not_found" // 404 - not ours or does not exist (terminal)
  | "rate_limited" // 429 - back off Retry-After
  | "server" // 5xx - retry with backoff
  | "network" // fetch threw
  | "bad_response" // 2xx but envelope.success === false or unparseable
  | "unknown";

export class ElefinApiError extends Error {
  readonly code: ElefinErrorCode;
  readonly status: number | null;
  readonly retryable: boolean;
  readonly retryAfterSec: number | null;
  readonly path: string;

  constructor(opts: {
    code: ElefinErrorCode;
    message: string;
    status?: number | null;
    retryable?: boolean;
    retryAfterSec?: number | null;
    path: string;
    cause?: unknown;
  }) {
    super(opts.message, opts.cause ? { cause: opts.cause } : undefined);
    this.name = "ElefinApiError";
    this.code = opts.code;
    this.status = opts.status ?? null;
    this.retryable = opts.retryable ?? false;
    this.retryAfterSec = opts.retryAfterSec ?? null;
    this.path = opts.path;
  }
}

export interface ElefinClientOptions {
  baseUrl?: string;
  apiKey?: string;
  apiSecret?: string;
  /** Requests/minute the key allows (see /me). Defaults to env or 60. */
  ratePerMinute?: number;
  /** Retries for 429 / 5xx / network. Default 4. */
  maxRetries?: number;
  fetchImpl?: typeof fetch;
  /** Optional structured log sink for each attempt. */
  onRequest?: (info: RequestLog) => void;
}

export interface RequestLog {
  path: string;
  attempt: number;
  status: number | null;
  ms: number;
  rateLimitRemaining: number | null;
  error?: string;
}

export interface RequestOpts {
  query?: Record<string, string | number | boolean | undefined | null>;
  signal?: AbortSignal;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Transport for the Elefin API: one Bearer credential, paced by {@link RateLimiter},
 * retrying only 429 / 5xx / network per the docs. Endpoint methods live in
 * `endpoints.ts` (class `ElefinApi extends ElefinClient`).
 */
export class ElefinClient {
  protected readonly baseUrl: string;
  private readonly token: string;
  private readonly maxRetries: number;
  private readonly fetchImpl: typeof fetch;
  private readonly onRequest?: (info: RequestLog) => void;
  readonly limiter: RateLimiter;

  /** Rate-limit headroom reported by the most recent response, if any. */
  lastRateLimitRemaining: number | null = null;

  constructor(opts: ElefinClientOptions = {}) {
    const baseUrl =
      opts.baseUrl ??
      process.env.ELEFIN_API_BASE_URL ??
      "https://el.theloginarea.com/api/v1";
    const apiKey = opts.apiKey ?? process.env.ELEFIN_API_KEY ?? "";
    const apiSecret = opts.apiSecret ?? process.env.ELEFIN_API_SECRET ?? "";

    if (!apiKey || !apiSecret) {
      throw new Error(
        "ElefinClient: ELEFIN_API_KEY and ELEFIN_API_SECRET must both be set.",
      );
    }

    const rpm = Number(
      opts.ratePerMinute ?? process.env.ELEFIN_RATE_LIMIT_PER_MIN ?? 60,
    );

    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.token = `${apiKey}.${apiSecret}`;
    this.maxRetries = opts.maxRetries ?? 4;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    this.onRequest = opts.onRequest;
    this.limiter = new RateLimiter(rpm);

    if (typeof this.fetchImpl !== "function") {
      throw new Error("ElefinClient: no global fetch; pass opts.fetchImpl.");
    }
  }

  /** GET `path` and unwrap `data` from the response envelope. */
  async request<T>(path: string, opts: RequestOpts = {}): Promise<T> {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }

    let lastErr: ElefinApiError | null = null;

    for (let attempt = 1; attempt <= this.maxRetries + 1; attempt++) {
      await this.limiter.acquire();
      const started = Date.now();
      let status: number | null = null;
      let remaining: number | null = null;

      try {
        const res = await this.fetchImpl(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${this.token}`,
            Accept: "application/json",
          },
          signal: opts.signal,
        });
        status = res.status;
        remaining = numOrNull(res.headers.get("X-RateLimit-Remaining"));
        if (remaining !== null) this.lastRateLimitRemaining = remaining;

        this.onRequest?.({ path, attempt, status, ms: Date.now() - started, rateLimitRemaining: remaining });

        if (res.ok) {
          const body = (await res.json()) as ApiEnvelope<T>;
          if (!body || body.success !== true) {
            throw new ElefinApiError({
              code: "bad_response",
              message: body?.message || "API returned success:false",
              status,
              path,
            });
          }
          return body.data;
        }

        lastErr = await errorFromResponse(res, path);
        if (!lastErr.retryable) throw lastErr;

        const backoff =
          lastErr.retryAfterSec != null
            ? lastErr.retryAfterSec * 1000
            : Math.min(30_000, 500 * 2 ** (attempt - 1)) + Math.random() * 250;
        if (lastErr.code === "rate_limited" && lastErr.retryAfterSec != null) {
          this.limiter.penalise(lastErr.retryAfterSec);
        }
        if (attempt <= this.maxRetries) await sleep(backoff);
      } catch (err) {
        if (err instanceof ElefinApiError) {
          if (!err.retryable || attempt > this.maxRetries) throw err;
          lastErr = err;
        } else {
          lastErr = new ElefinApiError({
            code: "network",
            message: `fetch failed for ${path}: ${(err as Error).message}`,
            retryable: true,
            path,
            cause: err,
          });
          this.onRequest?.({
            path,
            attempt,
            status,
            ms: Date.now() - started,
            rateLimitRemaining: remaining,
            error: lastErr.message,
          });
          if (attempt > this.maxRetries) throw lastErr;
          await sleep(Math.min(30_000, 500 * 2 ** (attempt - 1)));
        }
      }
    }

    throw (
      lastErr ??
      new ElefinApiError({ code: "unknown", message: `exhausted retries for ${path}`, path })
    );
  }
}

function numOrNull(v: string | null): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function errorFromResponse(res: Response, path: string): Promise<ElefinApiError> {
  let message = `${res.status} ${res.statusText}`;
  try {
    const body = (await res.json()) as { message?: string };
    if (body?.message) message = body.message;
  } catch {
    /* non-JSON body */
  }

  switch (res.status) {
    case 401:
      return new ElefinApiError({ code: "unauthorized", message, status: 401, path });
    case 403:
      return new ElefinApiError({ code: "forbidden", message, status: 403, path });
    case 404:
      return new ElefinApiError({ code: "not_found", message, status: 404, path });
    case 429:
      return new ElefinApiError({
        code: "rate_limited",
        message,
        status: 429,
        retryable: true,
        retryAfterSec: numOrNull(res.headers.get("Retry-After")) ?? 5,
        path,
      });
    default:
      return new ElefinApiError({
        code: res.status >= 500 ? "server" : "unknown",
        message,
        status: res.status,
        retryable: res.status >= 500,
        path,
      });
  }
}
