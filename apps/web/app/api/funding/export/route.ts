import { NextResponse, type NextRequest } from "next/server";
import { requireSession } from "@/lib/auth";
import { fetchFunding, parseFundingQuery } from "@/lib/funding-data";

export const dynamic = "force-dynamic";

const cell = (v: unknown): string => {
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET(req: NextRequest) {
  await requireSession();
  const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
  const q = { ...parseFundingQuery(sp), page: 1, perPage: 200 };

  const header = [
    "txn_id",
    "occurred_at",
    "client_id",
    "client_name",
    "login",
    "type",
    "status",
    "currency",
    "amount",
    "fee",
    "payment_method",
    "paid_currency",
    "paid_amount",
  ].join(",");

  const lines: string[] = [];
  for (let page = 1; page <= 60; page += 1) {
    const { rows } = await fetchFunding({ ...q, page });
    if (!rows.length) break;
    for (const r of rows) {
      lines.push(
        [
          r._id,
          r.occurredAt ?? "",
          r.clientId ?? "",
          r.clientName,
          r.login ?? "",
          r.type,
          r.status,
          r.currency,
          r.amount,
          r.fee,
          r.paymentMethod ?? "",
          r.paidCurrency ?? "",
          r.paidAmount ?? "",
        ]
          .map(cell)
          .join(","),
      );
    }
    if (rows.length < q.perPage) break;
  }

  const csv = [header, ...lines].join("\n") + "\n";
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="elefin-funding-${stamp}.csv"`,
    },
  });
}
