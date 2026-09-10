import { NextResponse, type NextRequest } from "next/server";
import { connect, Trade } from "@elefin/db";
import { requireSession } from "@/lib/auth";
import { plain } from "@/lib/serialize";
import { parseRange, rangeClause } from "@/lib/range";

export const dynamic = "force-dynamic";

const cell = (v: unknown): string => {
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ login: string }> },
) {
  await requireSession();
  const { login } = await params;

  const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
  const range = parseRange(sp);
  const symbol = sp.symbol;

  const filter: Record<string, unknown> = { login };
  const rc = rangeClause(range);
  if (rc) filter.closeAt = rc;
  if (symbol) filter.symbol = symbol;

  await connect();
  const docs = await Trade.find(filter).sort({ closeAt: 1 }).limit(20_000).lean();

  const header = [
    "trade_ticket_id",
    "symbol",
    "side",
    "lots",
    "open_time",
    "close_time",
    "open_price",
    "close_price",
    "holding_seconds",
    "stop_loss",
    "take_profit",
    "profit",
    "commission",
    "swap",
    "net_pnl",
  ].join(",");

  const lines = docs.map((d) => {
    const r = plain<Record<string, unknown>>(d);
    return [
      r._id,
      r.symbol,
      r.side,
      r.volumeLots,
      r.openAt,
      r.closeAt,
      r.openPrice,
      r.closePrice,
      r.holdingDurationSeconds,
      r.stopLoss,
      r.takeProfit,
      r.profit,
      r.commission,
      r.swap,
      r.netPnl,
    ]
      .map(cell)
      .join(",");
  });

  const csv = [header, ...lines].join("\n") + "\n";
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="elefin-trades-${login}-${stamp}.csv"`,
    },
  });
}
