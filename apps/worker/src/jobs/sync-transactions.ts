import { FundingEvent, SyncState, TXN_TYPES } from "@elefin/db";
import { createElefinApi } from "@elefin/elefin-client";
import { log } from "../logger";
import type { Job } from "../runner";
import { mapTransaction } from "./map";

const STATE_ID = "transactions";
const OVERLAP_MS = 2 * 24 * 60 * 60 * 1000; // re-pull the last 2 days each run

/**
 * Sync the book-wide deposit/withdrawal ledger from GET /transactions.
 * Incremental via a SyncState cursor (high-water `occurredAt`), with a 2-day
 * overlap so late-settling rows aren't missed. Upserts by the API's stable id
 * (`DEP-…` / `WDR-…`) so re-runs never duplicate.
 */
export const syncTransactions: Job = async ({ signal }) => {
  const api = createElefinApi();
  let apiCalls = 0;

  const state = await SyncState.findById(STATE_ID).lean();
  let from: string;
  if (state?.cursor) {
    from = new Date(state.cursor.getTime() - OVERLAP_MS).toISOString();
  } else {
    const me = await api.me(signal);
    apiCalls += 1;
    from =
      me.data_availability.transactions_from ??
      new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString();
    log.info(`transactions: first run, backfilling from ${from}`);
  }
  const to = new Date().toISOString();

  let upserted = 0;
  let maxOccurred = state?.cursor ?? null;
  const perType: Record<string, number> = {};

  for (const type of TXN_TYPES) {
    const rows = await api.listAllTransactions(
      { type, from, to },
      (page, last, r) => {
        apiCalls += 1;
        if (last > 1) log.debug(`/transactions ${type} page ${page}/${last} (${r.length})`);
      },
      signal,
    );
    perType[type] = rows.length;

    if (rows.length) {
      const ops = rows.map((x) => {
        const { _id, set } = mapTransaction(x);
        return { updateOne: { filter: { _id }, update: { $set: set }, upsert: true } };
      });
      const res = await FundingEvent.bulkWrite(ops, { ordered: false });
      upserted += (res.upsertedCount ?? 0) + (res.modifiedCount ?? 0);

      for (const x of rows) {
        const t = x.created_at ? new Date(x.created_at) : null;
        if (t && (!maxOccurred || t > maxOccurred)) maxOccurred = t;
      }
    }
  }

  await SyncState.updateOne(
    { _id: STATE_ID },
    { $set: { cursor: maxOccurred ?? new Date(to), lastRunAt: new Date(), meta: { from, to, perType } } },
    { upsert: true },
  );

  log.info(
    `transactions: deposits ${perType.deposit ?? 0}, withdrawals ${perType.withdrawal ?? 0}; ` +
      `${upserted} written; cursor -> ${(maxOccurred ?? new Date(to)).toISOString()}`,
  );

  return {
    apiCalls,
    docsUpserted: upserted,
    rateLimitRemainingMin: api.lastRateLimitRemaining,
    meta: { from, to, perType },
  };
};
