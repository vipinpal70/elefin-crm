import { Account, Client } from "@elefin/db";
import { createLoggedElefinApi } from "../api-logger";
import { log } from "../logger";
import type { Job } from "../runner";
import { mapClient } from "./map";
import { markDepartedMany, reactivateMany } from "./partner-status";

/**
 * Page through GET /clients and upsert one `clients` doc per referred client
 * with all the pre-aggregated funding / account / trading totals. Also upserts a
 * minimal `accounts` stub per MT5 login so joins work before `sync-accounts`
 * fills in the per-account detail.
 *
 * ~2 API calls for a 266-client book at per_page=200.
 */
export const syncClients: Job = async ({ signal }) => {
  const api = createLoggedElefinApi("clients");
  let apiCalls = 0;

  const rows = await api.listAllClients(
    { per_page: 200 },
    (page, last, r) => {
      apiCalls += 1;
      log.debug(`/clients page ${page}/${last} — ${r.length} rows`);
    },
    signal,
  );

  const clientOps = rows.map((raw) => {
    const { _id, set, setOnInsert } = mapClient(raw);
    return {
      updateOne: {
        filter: { _id },
        update: {
          $set: set,
          $setOnInsert: { firstSeenAt: new Date(), ...setOnInsert },
        },
        upsert: true,
      },
    };
  });

  const cRes = clientOps.length
    ? await Client.bulkWrite(clientOps, { ordered: false })
    : null;

  const seenLogins = new Set<string>();
  const accountOps: Parameters<typeof Account.bulkWrite>[0] = [];
  for (const raw of rows) {
    const clientId = Number(raw.client_id);
    for (const login of raw.accounts?.logins ?? []) {
      const id = String(login);
      if (seenLogins.has(id)) continue;
      seenLogins.add(id);
      accountOps.push({
        updateOne: {
          filter: { _id: id },
          update: {
            $set: { clientId },
            $setOnInsert: { currency: "USD", lastSyncedAt: new Date() },
          },
          upsert: true,
        },
      });
    }
  }
  const aRes = accountOps.length
    ? await Account.bulkWrite(accountOps, { ordered: false })
    : null;

  // Partner-code churn: GET /clients is implicitly "clients currently under
  // our code", so a client we knew about that this run didn't return is a
  // signal they may have switched away. Missing for a *second* consecutive
  // run (no reappearance, and sync-accounts hasn't already resolved it one
  // way or the other) is treated as confirmed — the weakest of the three
  // signals in partner-code-change-plan.md, used only as a fallback.
  const returnedIds = new Set(rows.map((r) => Number(r.client_id)));
  const known = await Client.find(
    {},
    { _id: 1, partnerStatus: 1, missingSince: 1 },
  ).lean();

  const reappearedIds: number[] = [];
  const clearedMissingIds: number[] = [];
  const firstMissIds: number[] = [];
  const confirmDepartedIds: number[] = [];

  for (const c of known) {
    const present = returnedIds.has(c._id);
    if (present) {
      if (c.partnerStatus === "departed") reappearedIds.push(c._id);
      else if (c.missingSince) clearedMissingIds.push(c._id);
    } else if (c.partnerStatus !== "departed") {
      if (c.missingSince) confirmDepartedIds.push(c._id);
      else firstMissIds.push(c._id);
    }
  }

  const reactivated = await reactivateMany(reappearedIds);
  if (clearedMissingIds.length) {
    await Client.updateMany(
      { _id: { $in: clearedMissingIds } },
      { $set: { missingSince: null } },
    );
  }
  if (firstMissIds.length) {
    await Client.updateMany(
      { _id: { $in: firstMissIds } },
      { $set: { missingSince: new Date() } },
    );
  }
  const departed = await markDepartedMany(confirmDepartedIds, "missing_from_list");
  if (firstMissIds.length || departed) {
    log.info(
      `clients: ${firstMissIds.length} newly missing from the live list, ` +
        `${departed} confirmed departed (missing 2+ runs)`,
    );
  }

  const newClients = cRes?.upsertedCount ?? 0;
  const updatedClients = cRes?.modifiedCount ?? 0;
  log.info(
    `clients: ${rows.length} rows (${newClients} new, ${updatedClients} updated); ` +
      `account stubs: ${accountOps.length} (${aRes?.upsertedCount ?? 0} new)`,
  );

  return {
    apiCalls,
    docsUpserted: rows.length + accountOps.length,
    rateLimitRemainingMin: api.lastRateLimitRemaining,
    meta: {
      clients: rows.length,
      newClients,
      updatedClients,
      logins: accountOps.length,
      reactivated,
      newlyMissing: firstMissIds.length,
      confirmedDeparted: departed,
    },
  };
};
