import { NextResponse, type NextRequest } from "next/server";
import { connect, Client } from "@elefin/db";
import { requireSession } from "@/lib/auth";
import { plain } from "@/lib/serialize";
import { buildFilter, parseClientsQuery, sortSpec } from "@/lib/clients-query";

export const dynamic = "force-dynamic";

const COLUMNS: Array<[string, (r: Record<string, unknown>) => unknown]> = [
  ["client_id", (r) => r._id],
  ["name", (r) => r.name],
  ["email", (r) => r.email],
  ["country", (r) => r.country],
  ["status", (r) => r.status],
  ["referral_code", (r) => r.referralCode],
  ["registered_at", (r) => r.registeredAt],
  ["partner_status", (r) => r.partnerStatus],
  ["departed_at", (r) => r.departedAt],
  ["funded", (r) => (r.fundingIsFunded ? "yes" : "no")],
  ["deposits", (r) => r.fundingDeposits],
  ["withdrawals", (r) => r.fundingWithdrawals],
  ["net_deposit", (r) => r.fundingNetDeposit],
  ["deposit_count", (r) => r.fundingDepositCount],
  ["accounts", (r) => r.accountsCount],
  ["balance", (r) => r.accountsBalance],
  ["equity", (r) => r.accountsEquity],
  ["lots", (r) => r.tradingLots],
  ["trades", (r) => r.tradingTrades],
  ["net_pnl", (r) => r.tradingNetProfit],
  ["last_trade_at", (r) => r.tradingLastTradeAt],
  ["commission_earned", (r) => r.commissionEarned],
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
  const q = parseClientsQuery(sp);

  await connect();
  const docs = await Client.find(buildFilter(q))
    .sort(sortSpec(q))
    .limit(10_000)
    .lean();

  const cols = includePii ? COLUMNS : COLUMNS.filter(([c]) => c !== "email");
  const header = cols.map(([c]) => c).join(",");
  const lines = docs.map((d) => {
    const r = plain<Record<string, unknown>>(d);
    return cols.map(([, get]) => cell(get(r))).join(",");
  });
  const csv = [header, ...lines].join("\n") + "\n";

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="elefin-clients-${stamp}.csv"`,
    },
  });
}
