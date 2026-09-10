import { Account, Client } from "@elefin/db";
import { createElefinApi, ElefinApiError } from "@elefin/elefin-client";
import { log } from "../logger";
import type { Job } from "../runner";
import { mapAccount, mapClient } from "./map";

/**
 * For every known client, GET /clients/{id} and upsert the full per-account
 * detail from `accounts.items[]` (leverage, margin, platform group, per-account
 * deposits/lots/PnL/commission). Also refreshes the client aggregates from the
 * detail payload.
 *
 * One API call per client (~266) — paced at ~1.1s each this is a ~5min job, so
 * schedule it every few hours, not every 15 minutes.
 */
export const syncAccounts: Job = async ({ signal }) => {
  const api = createElefinApi();
  const clients = await Client.find({}, { _id: 1 }).lean();

  let apiCalls = 0;
  let accountUpserts = 0;
  let clientsRefreshed = 0;
  let failed = 0;

  for (const c of clients) {
    if (signal.aborted) {
      log.warn("sync-accounts aborted mid-run");
      break;
    }
    try {
      const detail = await api.getClient(c._id, signal);
      apiCalls += 1;

      const items = detail.accounts?.items ?? [];
      if (items.length) {
        const ops = items.map((item) => {
          const { _id, set } = mapAccount(item, c._id);
          return {
            updateOne: { filter: { _id }, update: { $set: set }, upsert: true },
          };
        });
        const r = await Account.bulkWrite(ops, { ordered: false });
        accountUpserts += (r.upsertedCount ?? 0) + (r.modifiedCount ?? 0);
      }

      const { _id, set } = mapClient(detail);
      await Client.updateOne({ _id }, { $set: set });
      clientsRefreshed += 1;
    } catch (err) {
      failed += 1;
      const msg =
        err instanceof ElefinApiError
          ? `${err.code} ${err.status ?? ""}`.trim()
          : (err as Error).message;
      log.warn(`/clients/${c._id}: ${msg}`);
      if (err instanceof ElefinApiError && err.code === "unauthorized") throw err;
    }
  }

  log.info(
    `accounts: ${clientsRefreshed}/${clients.length} clients, ` +
      `${accountUpserts} account docs, ${failed} failed`,
  );

  return {
    apiCalls,
    docsUpserted: accountUpserts,
    rateLimitRemainingMin: api.lastRateLimitRemaining,
    partial: failed > 0,
    meta: { clients: clients.length, clientsRefreshed, accountUpserts, failed },
  };
};
