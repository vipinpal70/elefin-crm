/**
 * Recover from Elefin's confirmed, ongoing API bug where trade `profit` /
 * `net_profit` can come back null instead of a real number:
 *
 *   1. Flag likely-affected trades that predate the `profitMissing` field
 *      (added after the bug was found, so pre-existing zeroed trades were
 *      never marked) — heuristic: stored profit/netPnl are both exactly 0,
 *      but open/close price differ, so a genuine $0 result is implausible.
 *   2. For every account with a flagged trade, re-fetch its trades for the
 *      affected date window from GET /accounts/{login}/trades and re-upsert.
 *      A ticket Elefin now returns a real number for gets fixed and
 *      un-flagged (mapTrade); one still null is left exactly as before.
 *
 * Safe to re-run — idempotent, and can't overwrite a good value with 0
 * (mapTrade's moneyOrKeep omits the field instead when the API sends null).
 *
 *   npm run backfill:trade-profit
 */
import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(import.meta.dirname, "../.env") });

const { connect, disconnect, Trade } = await import("@elefin/db");
const { createElefinApi, ElefinApiError } = await import("@elefin/elefin-client");
const { mapTrade } = await import("../apps/worker/src/jobs/map.ts");

await connect();
const api = createElefinApi();

// Step 1: flag legacy suspects that predate profitMissing.
const flaggedNow = await Trade.updateMany(
  {
    profitMissing: { $ne: true },
    profit: "0",
    netPnl: "0",
    openPrice: { $ne: null },
    closePrice: { $ne: null },
    $expr: { $ne: ["$openPrice", "$closePrice"] },
  },
  { $set: { profitMissing: true } },
);
if (flaggedNow.modifiedCount) {
  console.log(`flagged ${flaggedNow.modifiedCount} pre-existing trade(s) as profitMissing (0 PnL despite a price move)`);
}

const flagged = await Trade.find(
  { profitMissing: true },
  { login: 1, clientId: 1, closeAt: 1 },
).lean();

if (!flagged.length) {
  console.log("no trades flagged profitMissing — nothing to backfill");
  await disconnect();
  process.exit(0);
}

interface Window {
  clientId: number | null;
  from: Date;
  to: Date;
}
const byLogin = new Map<string, Window>();
for (const t of flagged) {
  const login = String(t.login);
  const closeAt = t.closeAt ? new Date(t.closeAt) : new Date();
  const win = byLogin.get(login);
  if (!win) {
    byLogin.set(login, { clientId: t.clientId ?? null, from: closeAt, to: closeAt });
  } else {
    if (closeAt < win.from) win.from = closeAt;
    if (closeAt > win.to) win.to = closeAt;
  }
}

const startCount = flagged.length;
console.log(`${startCount} flagged trade(s) across ${byLogin.size} account(s) — re-fetching...`);
console.log(
  "(re-fetching the affected window can also discover trades never synced " +
    "before, so the flagged count may rise before it falls)",
);

let apiCalls = 0;
let failed = 0;

for (const [login, { clientId, from, to }] of byLogin) {
  const fromIso = new Date(from.getTime() - 86_400_000).toISOString();
  const toIso = new Date(to.getTime() + 86_400_000).toISOString();
  try {
    const rows = await api.listAllTrades(
      login,
      { from: fromIso, to: toIso, limit: 200 },
      () => {
        apiCalls += 1;
      },
    );
    if (!rows.length) {
      console.log(`  ${login}: 0 trades returned for the window`);
      continue;
    }
    const ops = rows.map((t) => {
      const { _id, set, setOnInsert } = mapTrade(t, login, clientId);
      return {
        updateOne: {
          filter: { _id },
          update: { $set: set, ...(setOnInsert ? { $setOnInsert: setOnInsert } : {}) },
          upsert: true,
        },
      };
    });
    await Trade.bulkWrite(ops, { ordered: false });
    console.log(`  ${login}: re-synced ${rows.length} trade(s) in range`);
  } catch (err) {
    failed += 1;
    const msg =
      err instanceof ElefinApiError
        ? `${err.code} ${err.status ?? ""}`.trim()
        : (err as Error).message;
    console.warn(`  ${login}: FAILED — ${msg}`);
  }
}

const remaining = await Trade.countDocuments({ profitMissing: true });
console.log(
  `done: started this run with ${startCount} flagged, ${remaining} still missing a profit ` +
    `figure now (Elefin's API is still returning null for these). If that's higher than ` +
    `${startCount}, the wider re-fetch found trades that had never been synced before — not a ` +
    `regression. ${failed} account(s) failed, ${apiCalls} API calls.`,
);
await disconnect();
