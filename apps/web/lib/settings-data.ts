import { connect, CrmUser, AppConfig, AuditLog } from "@elefin/db";
import { ALERT_RULES, type AlertType } from "@elefin/domain";
import { createElefinApi } from "@elefin/elefin-client";
import { cached } from "@elefin/cache";

export interface CrmUserRow {
  _id: string;
  email: string;
  name: string;
  role: "owner" | "analyst" | "viewer";
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string | null;
}

export async function fetchUsers(): Promise<CrmUserRow[]> {
  return cached("crm-users", { ttl: 300, tags: ["config"] }, loadUsers);
}

async function loadUsers(): Promise<CrmUserRow[]> {
  await connect();
  const rows = await CrmUser.find({}).sort({ createdAt: 1 }).lean();
  return rows.map((u) => ({
    _id: String(u._id),
    email: u.email,
    name: u.name ?? "",
    role: u.role as CrmUserRow["role"],
    isActive: u.isActive !== false,
    lastLoginAt: u.lastLoginAt ? new Date(u.lastLoginAt).toISOString() : null,
    createdAt: u.createdAt ? new Date(u.createdAt).toISOString() : null,
  }));
}

/** Effective alert thresholds = catalogue defaults overlaid with stored config. */
export async function fetchAlertThresholds(): Promise<
  Array<{ type: AlertType; description: string; params: Array<{ key: string; value: number; isDefault: boolean }> }>
> {
  return cached("alert-thresholds", { ttl: 600, tags: ["config"] }, loadAlertThresholds);
}

async function loadAlertThresholds(): Promise<
  Array<{ type: AlertType; description: string; params: Array<{ key: string; value: number; isDefault: boolean }> }>
> {
  await connect();
  const cfg = await AppConfig.findById("alerts").lean();
  const stored = (cfg?.data ?? {}) as Partial<Record<AlertType, Record<string, number>>>;

  return (Object.keys(ALERT_RULES) as AlertType[])
    .filter((t) => Object.keys(ALERT_RULES[t].defaults).length > 0)
    .map((type) => ({
      type,
      description: ALERT_RULES[type].description,
      params: Object.entries(ALERT_RULES[type].defaults).map(([key, def]) => {
        const override = stored[type]?.[key];
        return {
          key,
          value: override ?? def,
          isDefault: override === undefined,
        };
      }),
    }));
}

export interface AuditRow {
  _id: string;
  action: string;
  entity: string | null;
  entityId: string | null;
  at: string | null;
  userEmail: string;
}

export async function fetchAuditLog(limit = 60): Promise<AuditRow[]> {
  return cached(
    `audit-log:${limit}`,
    { ttl: 20, tags: ["config"] },
    () => loadAuditLog(limit),
  );
}

async function loadAuditLog(limit: number): Promise<AuditRow[]> {
  await connect();
  const rows = await AuditLog.find({}).sort({ at: -1 }).limit(limit).lean();
  const ids = [
    ...new Set(rows.map((r) => r.userId).filter(Boolean).map(String)),
  ];
  const emails = new Map(
    (await CrmUser.find({ _id: { $in: ids } }, { email: 1 }).lean()).map((u) => [
      String(u._id),
      u.email,
    ]),
  );
  return rows.map((r) => ({
    _id: String(r._id),
    action: r.action,
    entity: r.entity ?? null,
    entityId: r.entityId ?? null,
    at: r.at ? new Date(r.at).toISOString() : null,
    userEmail: r.userId ? emails.get(String(r.userId)) ?? "—" : "system",
  }));
}

export interface CredentialStatus {
  ok: boolean;
  error?: string;
  keyName?: string;
  abilities?: string[];
  allGranted?: boolean;
  partner?: string;
  partnerCodes?: string[];
  expiresAt?: string | null;
  totalClients?: number;
  tradesFrom?: string | null;
  transactionsFrom?: string | null;
}

export async function fetchCredentialStatus(): Promise<CredentialStatus> {
  // Caches the Elefin `/me` round-trip — the one external API call on this page.
  return cached("credential-status", { ttl: 300, tags: ["config"] }, loadCredentialStatus);
}

async function loadCredentialStatus(): Promise<CredentialStatus> {
  try {
    const api = createElefinApi();
    const me = await api.me();
    const codes = [
      me.scope.partner.code,
      ...((me.scope.partner as { additional_codes?: string[] }).additional_codes ?? []),
    ].filter(Boolean) as string[];
    return {
      ok: true,
      keyName: me.key.name,
      abilities: me.key.abilities,
      allGranted: me.key.abilities.length === 0,
      partner: `${me.scope.partner.name} (#${me.scope.partner.id})`,
      partnerCodes: codes,
      expiresAt: me.key.expires_at,
      totalClients: me.totals.clients,
      tradesFrom: me.data_availability.trades_from,
      transactionsFrom: me.data_availability.transactions_from,
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
