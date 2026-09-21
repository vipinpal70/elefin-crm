import { NextResponse, type NextRequest } from "next/server";
import { requireSession } from "@/lib/auth";
import { fetchAllXmClientRows, parseXmClientsQuery, type XmClientRow } from "@/lib/xm-data";

export const dynamic = "force-dynamic";

const COLUMNS: Array<[string, (r: XmClientRow) => unknown]> = [
  ["id", (r) => r._id],
  ["name", (r) => r.name],
  ["email", (r) => r.email],
  ["mt5_login", (r) => r.mt5Login],
  ["trading_capital", (r) => r.tradingCapital],
  ["trades", (r) => r.trades],
  ["lots", (r) => r.lots],
  ["commission", (r) => r.commission],
  ["tags", (r) => r.tags.join("|")],
  ["linked_elefin_client_id", (r) => r.linkedClientId],
  ["needs_review", (r) => (r.needsReview ? "yes" : "no")],
];

const cell = (v: unknown): string => {
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET(req: NextRequest) {
  await requireSession();

  const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
  const q = parseXmClientsQuery(sp);
  const rows = await fetchAllXmClientRows(q);

  const header = COLUMNS.map(([c]) => c).join(",");
  const lines = rows.map((r) => COLUMNS.map(([, get]) => cell(get(r))).join(","));
  const csv = [header, ...lines].join("\n") + "\n";

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="xm-clients-${stamp}.csv"`,
    },
  });
}
