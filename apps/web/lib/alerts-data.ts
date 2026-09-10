import { connect, Alert, Client } from "@elefin/db";
import { plain } from "./serialize";
import type { SP } from "./clients-query";

const one = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v[0] : v) || undefined;

export interface AlertRow {
  _id: string;
  type: string;
  clientId: number | null;
  clientName: string;
  severity: "info" | "warning" | "critical";
  title: string;
  createdAt: string | null;
  acknowledgedAt: string | null;
  snoozedUntil: string | null;
}

export interface AlertsQuery {
  type?: string;
  severity?: string;
  showResolved: boolean; // include acknowledged / snoozed
}

export function parseAlertsQuery(sp: SP): AlertsQuery {
  return {
    type: one(sp.type),
    severity: one(sp.severity),
    showResolved: one(sp.show) === "all",
  };
}

export interface AlertsResult {
  rows: AlertRow[];
  counts: { critical: number; warning: number; info: number; total: number };
  types: string[];
  openTotal: number;
}

export interface TopAlert {
  _id: string;
  type: string;
  clientId: number | null;
  clientName: string;
  severity: "info" | "warning" | "critical";
  title: string;
}

/** The most urgent open alerts, for the dashboard. */
export async function fetchTopAlerts(limit = 6): Promise<{ rows: TopAlert[]; total: number }> {
  await connect();
  const now = new Date();
  const filter = {
    acknowledgedAt: null,
    $or: [{ snoozedUntil: null }, { snoozedUntil: { $lte: now } }],
    severity: { $in: ["critical", "warning"] },
  };
  const sevRank = { critical: 0, warning: 1, info: 2 } as const;

  const [docs, total] = await Promise.all([
    Alert.find(filter).sort({ createdAt: -1 }).limit(200).lean(),
    Alert.countDocuments(filter),
  ]);

  const sorted = docs
    .sort(
      (a, b) =>
        sevRank[a.severity as keyof typeof sevRank] -
        sevRank[b.severity as keyof typeof sevRank],
    )
    .slice(0, limit);

  const ids = [
    ...new Set(sorted.map((d) => d.clientId).filter((x): x is number => x != null)),
  ];
  const names = new Map(
    (await Client.find({ _id: { $in: ids } }, { name: 1 }).lean()).map((c) => [
      c._id,
      c.name ?? "",
    ]),
  );

  return {
    total,
    rows: sorted.map((d) => ({
      _id: String(d._id),
      type: d.type,
      clientId: d.clientId ?? null,
      clientName: d.clientId != null ? names.get(d.clientId) ?? "" : "",
      severity: d.severity as TopAlert["severity"],
      title: d.title,
    })),
  };
}

export async function fetchAlerts(q: AlertsQuery): Promise<AlertsResult> {
  await connect();
  const now = new Date();

  const openFilter = {
    acknowledgedAt: null,
    $or: [{ snoozedUntil: null }, { snoozedUntil: { $lte: now } }],
  };

  const filter: Record<string, unknown> = q.showResolved ? {} : { ...openFilter };
  if (q.type) filter.type = q.type;
  if (q.severity) filter.severity = q.severity;

  const sevRank = { critical: 0, warning: 1, info: 2 } as const;

  const [docs, allTypes, openDocs] = await Promise.all([
    Alert.find(filter).sort({ createdAt: -1 }).limit(500).lean(),
    Alert.distinct("type"),
    Alert.find(openFilter, { severity: 1 }).lean(),
  ]);

  const ids = [
    ...new Set(docs.map((d) => d.clientId).filter((x): x is number => x != null)),
  ];
  const names = new Map(
    (await Client.find({ _id: { $in: ids } }, { name: 1 }).lean()).map((c) => [
      c._id,
      c.name ?? "",
    ]),
  );

  const rows: AlertRow[] = docs
    .map((d) => {
      const p = plain<Omit<AlertRow, "clientName">>(d);
      return { ...p, clientName: p.clientId != null ? names.get(p.clientId) ?? "" : "" };
    })
    .sort(
      (a, b) =>
        sevRank[a.severity] - sevRank[b.severity] ||
        (b.createdAt ?? "").localeCompare(a.createdAt ?? ""),
    );

  const counts = { critical: 0, warning: 0, info: 0, total: openDocs.length };
  for (const d of openDocs) counts[d.severity as "critical" | "warning" | "info"] += 1;

  return {
    rows,
    counts,
    types: (allTypes as string[]).sort(),
    openTotal: openDocs.length,
  };
}
