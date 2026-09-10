import { createElefinApi } from "@elefin/elefin-client";
import { log } from "../logger";
import type { Job } from "../runner";

/**
 * Confirms the credential works and records what the key can do. Cheapest way to
 * detect a lifecycle event (deactivation / expiry surface as 401).
 */
export const syncMe: Job = async ({ signal }) => {
  const api = createElefinApi({ onRequest: (i) => log.debug(`GET ${i.path} -> ${i.status}`) });
  const me = await api.me(signal);
  const abilities = me.key.abilities;
  // Per the docs, an empty list means every ability except `clients.pii` is
  // granted (and on this instance PII comes back unmasked too).
  const allGranted = abilities.length === 0;
  const codes = [
    me.scope.partner.code,
    ...(me.scope.partner.additional_codes ?? []),
  ].filter(Boolean);

  log.info(
    `key "${me.key.name}" · abilities [${allGranted ? "all" : abilities.join(", ")}] · ` +
      `partner ${me.scope.partner.name} (#${me.scope.partner.id}) · ` +
      `codes [${codes.join(", ")}] · ${me.totals.clients} clients`,
  );
  log.info(
    `data availability: trades_from=${me.data_availability.trades_from ?? "?"} ` +
      `transactions_from=${me.data_availability.transactions_from ?? "?"}`,
  );

  if (me.key.expires_at) {
    const days = Math.round(
      (new Date(me.key.expires_at).getTime() - Date.now()) / 86_400_000,
    );
    if (days <= 14) log.warn(`API key expires in ${days} day(s) (${me.key.expires_at})`);
  }
  if (!allGranted && !abilities.includes("clients.read")) {
    log.warn("Key lacks `clients.read` — /clients and downstream syncs will 403.");
  }
  if (!allGranted && !abilities.includes("clients.pii")) {
    log.info("Key lacks `clients.pii` — email/phone will be stored masked.");
  }

  return {
    apiCalls: 1,
    rateLimitRemainingMin: api.lastRateLimitRemaining,
    meta: {
      abilities,
      allGranted,
      partnerId: me.scope.partner.id,
      partnerCodes: codes,
      totalClients: me.totals.clients,
      expiresAt: me.key.expires_at,
      dataAvailability: me.data_availability,
    },
  };
};
