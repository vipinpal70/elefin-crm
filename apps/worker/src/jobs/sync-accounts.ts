import { Account, Client } from "@elefin/db";
import { ElefinApiError } from "@elefin/elefin-client";
import { createLoggedElefinApi } from "../api-logger";
import { log } from "../logger";
import type { Job } from "../runner";
import { mapAccount, mapClient } from "./map";
import { markDeparted, reactivate } from "./partner-status";

/**
 * For every known client, GET /clients/{id} and upsert the full per-account
 * detail from `accounts.items[]` (leverage, margin, platform group, per-account
 * deposits/lots/PnL/commission). Also refreshes the client aggregates from the
 * detail payload, and — since `accounts.items[].affiliated` is right there in
 * the same payload — the partner-code status (see partner-status.ts and
 * partner-code-change-plan.md).
 *
 * One API call per client (~266) — paced at ~1.1s each this is a ~5min job, so
 * schedule it every few hours, not every 15 minutes.
 */
export const syncAccounts: Job = async ({ signal }) => {
  const api = createLoggedElefinApi("accounts");
  const clients = await Client.find({}, { _id: 1, missingSince: 1 }).lean();
  const missingSinceById = new Map(clients.map((c) => [c._id, c.missingSince ?? null]));

  let apiCalls = 0;
  let accountUpserts = 0;
  let clientsRefreshed = 0;
  let failed = 0;
  let departed = 0;
  let reactivated = 0;

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

        // Elefin's own affiliation flag — the strongest signal we have.
        // Conservative: only call it departed when *every* known account
        // agrees; a disagreement is unexpected and just gets logged.
        const unaffiliated = items.filter((it) => it.affiliated === false);
        if (unaffiliated.length === items.length) {
          if (await markDeparted(c._id, "affiliated_false")) departed += 1;
        } else {
          if (unaffiliated.length > 0) {
            log.warn(`client ${c._id}: accounts disagree on affiliated status`);
          }
          if (await reactivate(c._id)) reactivated += 1; // was previously departed
        }
      }

      const { _id, set } = mapClient(detail);
      await Client.updateOne({ _id }, { $set: set });
      clientsRefreshed += 1;
    } catch (err) {
      failed += 1;
      const isApiErr = err instanceof ElefinApiError;
      const msg = isApiErr ? `${err.code} ${err.status ?? ""}`.trim() : (err as Error).message;
      log.warn(`/clients/${c._id}: ${msg}`);
      if (isApiErr && err.code === "unauthorized") throw err;

      // GET /clients/{id} failing for just this one client (not a general
      // outage — other clients in this same run keep succeeding) is
      // corroborating evidence of departure, but only once sync-clients'
      // list-diff already flagged them as missing — a single 403/404 alone
      // could be a transient blip on one client.
      if (isApiErr && (err.code === "forbidden" || err.code === "not_found")) {
        if (missingSinceById.get(c._id)) {
          if (await markDeparted(c._id, "lookup_failed")) departed += 1;
        } else {
          await Client.updateOne({ _id: c._id }, { $set: { missingSince: new Date() } });
        }
      }
    }
  }

  log.info(
    `accounts: ${clientsRefreshed}/${clients.length} clients, ` +
      `${accountUpserts} account docs, ${failed} failed` +
      (departed ? `, ${departed} newly departed` : ""),
  );

  return {
    apiCalls,
    docsUpserted: accountUpserts,
    rateLimitRemainingMin: api.lastRateLimitRemaining,
    partial: failed > 0,
    meta: { clients: clients.length, clientsRefreshed, accountUpserts, failed, departed, reactivated },
  };
};
