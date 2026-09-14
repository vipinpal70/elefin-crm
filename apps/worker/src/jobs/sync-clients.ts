import { Account, Client } from "@elefin/db";
import { createLoggedElefinApi } from "../api-logger";
import { log } from "../logger";
import type { Job } from "../runner";
import { mapClient } from "./map";

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
    },
  };
};
