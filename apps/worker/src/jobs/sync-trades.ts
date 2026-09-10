import { Account, Trade } from "@elefin/db";
import { createElefinApi, ElefinApiError } from "@elefin/elefin-client";
import { log } from "../logger";
import type { Job } from "../runner";
import { mapTrade } from "./map";

const OVERLAP_MS = 60 * 60 * 1000; // re-pull the last hour per account

/**
 * Sync closed trades per account from GET /accounts/{login}/trades.
 * Only walks accounts that have traded (`accounts.trades > 0`). Incremental:
 * `from` = the account's local max `closeAt` (minus 1h overlap), else the
 * partner's `data_availability.trades_from`. Upserts by `trade_ticket_id`.
 */
export const syncTrades: Job = async ({ signal }) => {
  const api = createElefinApi();

  const me = await api.me(signal);
  let apiCalls = 1;
  const floor =
    me.data_availability.trades_from ??
    new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();

  const accounts = await Account.find(
    { trades: { $gt: 0 } },
    { _id: 1, clientId: 1 },
  ).lean();

  const cursors = new Map<string, Date>();
  for (const row of await Trade.aggregate<{ _id: string; maxClose: Date }>([
    { $match: { login: { $in: accounts.map((a) => a._id) } } },
    { $group: { _id: "$login", maxClose: { $max: "$closeAt" } } },
  ])) {
    if (row.maxClose) cursors.set(row._id, row.maxClose);
  }

  const to = new Date().toISOString();
  let tradeUpserts = 0;
  let accountsWithNew = 0;
  let failed = 0;

  for (const acc of accounts) {
    if (signal.aborted) {
      log.warn("sync-trades aborted mid-run");
      break;
    }
    const cur = cursors.get(acc._id);
    const from = cur
      ? new Date(cur.getTime() - OVERLAP_MS).toISOString()
      : floor;

    try {
      const rows = await api.listAllTrades(
        acc._id,
        { from, to, limit: 200 },
        () => {
          apiCalls += 1;
        },
        signal,
      );
      if (rows.length) {
        const ops = rows.map((t) => {
          const { _id, set } = mapTrade(t, acc._id, acc.clientId ?? null);
          return {
            updateOne: { filter: { _id }, update: { $set: set }, upsert: true },
          };
        });
        const res = await Trade.bulkWrite(ops, { ordered: false });
        const n = (res.upsertedCount ?? 0) + (res.modifiedCount ?? 0);
        tradeUpserts += n;
        if (res.upsertedCount) accountsWithNew += 1;
      }
    } catch (err) {
      failed += 1;
      const msg =
        err instanceof ElefinApiError
          ? `${err.code} ${err.status ?? ""}`.trim()
          : (err as Error).message;
      log.warn(`trades ${acc._id}: ${msg}`);
      if (err instanceof ElefinApiError && err.code === "unauthorized") throw err;
    }
  }

  log.info(
    `trades: ${accounts.length} accounts scanned, ${tradeUpserts} trades written ` +
      `(${accountsWithNew} accounts got new rows), ${failed} failed`,
  );

  return {
    apiCalls,
    docsUpserted: tradeUpserts,
    rateLimitRemainingMin: api.lastRateLimitRemaining,
    partial: failed > 0,
    meta: { accounts: accounts.length, tradeUpserts, accountsWithNew, failed },
  };
};
