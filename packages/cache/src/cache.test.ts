import assert from "node:assert/strict";
import { test } from "node:test";

import { cached, invalidate, cacheHealth, hashKey, TAGS } from "./index";

/**
 * Runs with no env set, so `getRedis()` returns null and every call is a
 * straight passthrough. The tag-versioning / eviction path needs a live Redis
 * and is covered by the app's integration check.
 */

test("cached() is a passthrough when REDIS_URL is unset", async () => {
  let calls = 0;
  const load = async () => {
    calls += 1;
    return { n: calls };
  };

  const a = await cached("t", { ttl: 60, tags: ["clients"] }, load);
  const b = await cached("t", { ttl: 60, tags: ["clients"] }, load);

  assert.deepEqual(a, { n: 1 });
  assert.deepEqual(b, { n: 2 }); // not cached — loader ran again
  assert.equal(calls, 2);
});

test("cached() propagates loader errors (never swallowed)", async () => {
  await assert.rejects(
    () =>
      cached("t", { ttl: 60 }, async () => {
        throw new Error("boom");
      }),
    /boom/,
  );
});

test("invalidate() is a no-op when caching is off", async () => {
  await invalidate("clients", "book"); // must not throw
});

test("cacheHealth() reports disabled when off", async () => {
  assert.deepEqual(await cacheHealth(), { enabled: false, ok: false, ms: null });
});

test("hashKey() is stable and discriminating", async () => {
  assert.equal(hashKey({ a: 1, b: 2 }), hashKey({ a: 1, b: 2 }));
  assert.notEqual(hashKey({ a: 1 }), hashKey({ a: 2 }));
  assert.equal(typeof hashKey({ x: [1, 2, 3] }), "string");
});

test("TAGS covers every invalidation group used by the app", async () => {
  for (const t of [
    "clients",
    "funding",
    "trades",
    "positions",
    "book",
    "alerts",
    "digest",
    "config",
    "notes",
  ]) {
    assert.ok(TAGS.includes(t as never), `missing tag: ${t}`);
  }
});
