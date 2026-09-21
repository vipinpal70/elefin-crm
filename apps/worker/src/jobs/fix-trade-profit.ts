import { Trade } from "@elefin/db";
import { ElefinApiError } from "@elefin/elefin-client";
import { createLoggedElefinApi } from "../api-logger";
import { log } from "../logger";
import type { Job } from "../runner";
import { mapTrade } from "./map";

/**
 * Recover from Elefin's confirmed, ongoing API bug where trade `profit`/
 * `net_profit` can come back null instead of a real number (see
 * scripts/backfill-trade-profit.mts, which this job is the on-demand,
 * worker-side twin of — same logic, triggered from /elefin/sync instead of
 * the CLI):
 *
 *   1. Flag likely-affected trades that predate the `profitMissing` field —
 *      heuristic: stored profit/netPnl are both exactly 0, but open/close
 *      price differ, so a genuine $0 result is implausible.
 *   2. For every account with a flagged trade, re-fetch its trades for the
 *      affected date window and re-upsert. A ticket Elefin now returns a
 *      real number for gets fixed and un-flagged (mapTrade); one still null
 *      is left exactly as before.
 *
 * Safe to re-run — idempotent, and can't overwrite a good value with 0
 * (mapTrade's moneyOrKeep omits the field instead when the API sends null).
 */
export const fixTradeProfit: Job = async ({ signal }) => {
  const api = createLoggedElefinApi("pnl-fix");
  let apiCalls = 0;

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
    log.info(`pnl-fix: flagged ${flaggedNow.modifiedCount} pre-existing trade(s) as profitMissing`);
  }

  const startCount = await Trade.countDocuments({ profitMissing: true });
  const flagged = await Trade.find({ profitMissing: true }, { login: 1, clientId: 1, closeAt: 1 }).lean();

  if (!flagged.length) {
    log.info("pnl-fix: no trades flagged profitMissing — nothing to backfill");
    return { apiCalls: 0, docsUpserted: 0, meta: { startCount: 0, remaining: 0 } };
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

  log.info(`pnl-fix: ${startCount} flagged trade(s) across ${byLogin.size} account(s) — re-fetching...`);

  let reupserted = 0;
  let failed = 0;

  for (const [login, { clientId, from, to }] of byLogin) {
    if (signal.aborted) {
      log.warn("pnl-fix aborted mid-run");
      break;
    }
    const fromIso = new Date(from.getTime() - 86_400_000).toISOString();
    const toIso = new Date(to.getTime() + 86_400_000).toISOString();
    try {
      const rows = await api.listAllTrades(
        login,
        { from: fromIso, to: toIso, limit: 200 },
        () => {
          apiCalls += 1;
        },
        signal,
      );
      if (!rows.length) continue;
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
      const res = await Trade.bulkWrite(ops, { ordered: false });
      reupserted += (res.upsertedCount ?? 0) + (res.modifiedCount ?? 0);
    } catch (err) {
      failed += 1;
      const msg = err instanceof ElefinApiError ? `${err.code} ${err.status ?? ""}`.trim() : (err as Error).message;
      log.warn(`pnl-fix ${login}: ${msg}`);
      if (err instanceof ElefinApiError && err.code === "unauthorized") throw err;
    }
  }

  const remaining = await Trade.countDocuments({ profitMissing: true });
  log.info(
    `pnl-fix: started with ${startCount} flagged, ${remaining} still missing a profit figure ` +
      `(Elefin's API still returning null for these), ${failed} account(s) failed, ${apiCalls} API calls`,
  );

  return {
    apiCalls,
    docsUpserted: reupserted,
    rateLimitRemainingMin: api.lastRateLimitRemaining,
    partial: failed > 0,
    meta: { startCount, remaining, accounts: byLogin.size, failed },
  };
};
