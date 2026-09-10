import { Account, Position } from "@elefin/db";
import { createElefinApi, ElefinApiError } from "@elefin/elefin-client";
import { log } from "../logger";
import type { Job } from "../runner";
import { mapPosition } from "./map";

/**
 * Sync currently-open positions from GET /accounts/{login}/positions.
 * Walks accounts that could hold risk (trading enabled, or a balance, or a
 * trading history). For each login with a non-null `as_of` we replace the open
 * set (delete rows not returned); a null `as_of` means UNKNOWN so we leave the
 * last-known rows in place and just refresh what we can.
 */
export const syncPositions: Job = async ({ signal }) => {
  const api = createElefinApi();

  const accounts = await Account.find(
    {
      $or: [
        { tradingEnabled: true },
        { trades: { $gt: 0 } },
        { balance: { $gt: 0 } },
      ],
    },
    { _id: 1, clientId: 1 },
  ).lean();

  let apiCalls = 0;
  let upserts = 0;
  let deletes = 0;
  let openAccounts = 0;
  let unknownAccounts = 0;
  let failed = 0;

  for (const acc of accounts) {
    if (signal.aborted) break;
    try {
      const res = await api.listPositions(acc._id, signal);
      apiCalls += 1;
      const rows = res.positions ?? res.data ?? [];
      const asOf = res.as_of ? new Date(res.as_of) : null;

      if (rows.length) {
        openAccounts += 1;
        const ops = rows.map((p) => {
          const { _id, set } = mapPosition(p, acc._id, acc.clientId ?? null, asOf);
          return {
            updateOne: { filter: { _id }, update: { $set: set }, upsert: true },
          };
        });
        const w = await Position.bulkWrite(ops, { ordered: false });
        upserts += (w.upsertedCount ?? 0) + (w.modifiedCount ?? 0);
      }

      if (asOf) {
        // authoritative snapshot — prune anything not in it
        const keep = rows.map((p) => String(p.trade_ticket_id));
        const d = await Position.deleteMany({ login: acc._id, _id: { $nin: keep } });
        deletes += d.deletedCount ?? 0;
      } else if (!rows.length) {
        unknownAccounts += 1;
      }
    } catch (err) {
      failed += 1;
      const msg =
        err instanceof ElefinApiError
          ? `${err.code} ${err.status ?? ""}`.trim()
          : (err as Error).message;
      log.warn(`positions ${acc._id}: ${msg}`);
      if (err instanceof ElefinApiError && err.code === "unauthorized") throw err;
    }
  }

  log.info(
    `positions: ${accounts.length} accounts, ${openAccounts} with open risk, ` +
      `${upserts} upserts, ${deletes} closed, ${unknownAccounts} unknown (null as_of), ${failed} failed`,
  );

  return {
    apiCalls,
    docsUpserted: upserts,
    rateLimitRemainingMin: api.lastRateLimitRemaining,
    partial: failed > 0,
    meta: { accounts: accounts.length, openAccounts, upserts, deletes, unknownAccounts, failed },
  };
};
