import { test } from "node:test";
import assert from "node:assert/strict";

import { ElefinApi } from "./endpoints";
import { ElefinApiError } from "./client";
import { RateLimiter } from "./rate-limiter";

/* ── a scriptable fake fetch ────────────────────────────── */

type Reply =
  | { status: number; json: unknown; headers?: Record<string, string> }
  | { throw: Error };

function fakeFetch(replies: Reply[]) {
  const calls: string[] = [];
  const impl = (async (url: URL | string) => {
    calls.push(String(url));
    const r = replies.shift();
    if (!r) throw new Error("fakeFetch: no more scripted replies");
    if ("throw" in r) throw r.throw;
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      statusText: `HTTP ${r.status}`,
      headers: {
        get: (k: string) => r.headers?.[k.toLowerCase()] ?? null,
      },
      json: async () => r.json,
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const api = (impl: typeof fetch, opts = {}) =>
  new ElefinApi({
    apiKey: "pk_test",
    apiSecret: "sk_test",
    baseUrl: "https://example.test/api/v1",
    ratePerMinute: 6000, // ~10ms spacing, keeps tests fast
    fetchImpl: impl,
    ...opts,
  });

const ok = (data: unknown) => ({
  status: 200,
  json: { success: true, message: "Success", data },
});

/* ── transport ──────────────────────────────────────────── */

test("request: unwraps `data` from the envelope", async () => {
  const { impl, calls } = fakeFetch([ok({ hello: "world" })]);
  const res = await api(impl).me();
  assert.deepEqual(res, { hello: "world" });
  assert.equal(calls.length, 1);
  assert.match(calls[0]!, /\/me$/);
});

test("request: 401 is terminal — thrown, not retried", async () => {
  const { impl, calls } = fakeFetch([
    { status: 401, json: { success: false, message: "bad key" } },
    ok({}), // must not be consumed
  ]);
  await assert.rejects(
    () => api(impl).me(),
    (e: unknown) => e instanceof ElefinApiError && e.code === "unauthorized" && !e.retryable,
  );
  assert.equal(calls.length, 1);
});

test("request: 403 and 404 are terminal too", async () => {
  for (const [status, code] of [
    [403, "forbidden"],
    [404, "not_found"],
  ] as const) {
    const { impl } = fakeFetch([{ status, json: { success: false, message: "no" } }]);
    await assert.rejects(
      () => api(impl).getClient(1),
      (e: unknown) => e instanceof ElefinApiError && e.code === code,
    );
  }
});

test("request: 429 is retried, then succeeds", async () => {
  const { impl, calls } = fakeFetch([
    { status: 429, json: { success: false, message: "slow down" }, headers: { "retry-after": "0" } },
    ok({ ok: 1 }),
  ]);
  const res = await api(impl).me();
  assert.deepEqual(res, { ok: 1 });
  assert.equal(calls.length, 2);
});

test("request: 5xx retried up to maxRetries, then throws `server`", async () => {
  const { impl, calls } = fakeFetch([
    { status: 500, json: { success: false, message: "boom" } },
    { status: 502, json: { success: false, message: "boom" } },
    { status: 503, json: { success: false, message: "boom" } },
  ]);
  await assert.rejects(
    () => api(impl, { maxRetries: 2 }).me(),
    (e: unknown) => e instanceof ElefinApiError && e.code === "server" && e.retryable,
  );
  assert.equal(calls.length, 3); // initial + 2 retries
});

test("request: network error is retried", async () => {
  const { impl, calls } = fakeFetch([
    { throw: new TypeError("fetch failed") },
    ok({ recovered: true }),
  ]);
  const res = await api(impl).me();
  assert.deepEqual(res, { recovered: true });
  assert.equal(calls.length, 2);
});

test("request: 2xx with success:false -> bad_response", async () => {
  const { impl } = fakeFetch([{ status: 200, json: { success: false, message: "nope" } }]);
  await assert.rejects(
    () => api(impl).me(),
    (e: unknown) => e instanceof ElefinApiError && e.code === "bad_response",
  );
});

test("request: reads X-RateLimit-Remaining", async () => {
  const { impl } = fakeFetch([
    { status: 200, json: { success: true, message: "ok", data: {} }, headers: { "x-ratelimit-remaining": "42" } },
  ]);
  const c = api(impl);
  await c.me();
  assert.equal(c.lastRateLimitRemaining, 42);
});

/* ── pagination helpers ─────────────────────────────────── */

const page = (rows: unknown[], current: number, last: number) => ({
  status: 200,
  json: {
    success: true,
    message: "ok",
    data: { data: rows, meta: { current_page: current, per_page: 200, last_page: last, total: rows.length * last } },
  },
});

test("listAllTrades: follows pagination", async () => {
  const { impl, calls } = fakeFetch([
    page([{ trade_ticket_id: "1" }, { trade_ticket_id: "2" }], 1, 2),
    page([{ trade_ticket_id: "3" }], 2, 2),
  ]);
  const all = await api(impl).listAllTrades("12345");
  assert.equal(all.length, 3);
  assert.equal(calls.length, 2);
  assert.match(calls[0]!, /page=1/);
  assert.match(calls[1]!, /page=2/);
});

test("listAllTransactions: single page stops immediately", async () => {
  const { impl, calls } = fakeFetch([page([{ id: "DEP-1" }], 1, 1)]);
  const all = await api(impl).listAllTransactions({ type: "deposit" });
  assert.equal(all.length, 1);
  assert.equal(calls.length, 1);
  assert.match(calls[0]!, /type=deposit/);
});

/* ── rate limiter ───────────────────────────────────────── */

test("RateLimiter: spaces successive acquisitions", async () => {
  const rl = new RateLimiter(60_000 / 40, 0); // 40ms min interval, no margin -> ~40ms
  const t0 = Date.now();
  await rl.acquire();
  await rl.acquire();
  await rl.acquire();
  const elapsed = Date.now() - t0;
  assert.ok(elapsed >= 60, `expected >=60ms of spacing, got ${elapsed}ms`);
});

test("RateLimiter: penalise pushes the next slot out", async () => {
  const rl = new RateLimiter(6000, 0);
  await rl.acquire();
  rl.penalise(0.15); // 150ms
  const t0 = Date.now();
  await rl.acquire();
  assert.ok(Date.now() - t0 >= 120, "penalise should delay the next acquire");
});

/* ── construction ───────────────────────────────────────── */

test("ElefinApi: throws without credentials", () => {
  assert.throws(
    () => new ElefinApi({ apiKey: "", apiSecret: "", fetchImpl: fetch }),
    /must both be set/,
  );
});
