import { NextResponse, type NextRequest } from "next/server";
import { requireSession } from "@/lib/auth";
import { fetchAlerts, parseAlertsQuery, type AlertRow } from "@/lib/alerts-data";

export const dynamic = "force-dynamic";

const COLUMNS: Array<[string, (r: AlertRow) => unknown]> = [
  ["id", (r) => r._id],
  ["type", (r) => r.type],
  ["severity", (r) => r.severity],
  ["title", (r) => r.title],
  ["client_id", (r) => r.clientId],
  ["client_name", (r) => r.clientName],
  ["client_email", (r) => r.clientEmail],
  ["created_at", (r) => r.createdAt],
  ["acknowledged_at", (r) => r.acknowledgedAt],
  ["snoozed_until", (r) => r.snoozedUntil],
];

const cell = (v: unknown): string => {
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET(req: NextRequest) {
  const session = await requireSession();
  const includePii = session.role === "owner" || session.role === "analyst";

  const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
  const q = parseAlertsQuery(sp);
  const { rows } = await fetchAlerts(q);

  const cols = includePii ? COLUMNS : COLUMNS.filter(([c]) => c !== "client_email");
  const header = cols.map(([c]) => c).join(",");
  const lines = rows.map((r) => cols.map(([, get]) => cell(get(r))).join(","));
  const csv = [header, ...lines].join("\n") + "\n";

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="alerts-${stamp}.csv"`,
    },
  });
}
