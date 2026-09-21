import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/auth";
import { fetchTcRows, parseTcQuery, type TcRow } from "@/lib/tc-data";

export const dynamic = "force-dynamic";

const COLUMNS: Array<[string, (r: TcRow) => unknown]> = [
  ["id", (r) => r._id],
  ["name", (r) => r.name],
  ["email", (r) => r.email],
  ["phone", (r) => r.phone],
  ["mt5_login", (r) => r.mt5Login],
  ["broker_raw", (r) => r.brokerRaw],
  ["detected_broker", (r) => r.brokerNormalized],
  ["trading_capital", (r) => r.tradingCapital],
  ["tags", (r) => r.tags.join("|")],
  ["suggested_elefin_client_id", (r) => r.linkedClientId],
  ["suggested_elefin_client_name", (r) => r.linkedClientName],
  ["match_method", (r) => r.matchMethod],
  ["needs_review", (r) => (r.needsReview ? "yes" : "no")],
  ["review_reason", (r) => r.reviewReason],
];

const cell = (v: unknown): string => {
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET(req: NextRequest) {
  await requireRole("owner");

  const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
  const q = parseTcQuery(sp);
  const rows = await fetchTcRows(q);

  const header = COLUMNS.map(([c]) => c).join(",");
  const lines = rows.map((r) => COLUMNS.map(([, get]) => cell(get(r))).join(","));
  const csv = [header, ...lines].join("\n") + "\n";

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="tc-clients-${stamp}.csv"`,
    },
  });
}
