import Link from "next/link";
import { connect, Client, toNumber } from "@elefin/db";
import { fetchBookSeries, bucketWeekly } from "@/lib/book-daily";
import { Card } from "@/components/ui/card";
import { TimeSeries, type TSPoint } from "@/components/charts/time-series";
import { usd, num, num2, pctStr } from "@/lib/format";
import { cn } from "@/lib/cn";

export const dynamic = "force-dynamic";

interface CodeRow {
  code: string;
  clients: number;
  funded: number;
  active: number;
  deposits: number;
  withdrawals: number;
  netDeposit: number;
  lots: number;
  trades: number;
  pnl: number;
  commission: number;
}

async function load() {
  await connect();
  const rows = await Client.find(
    {},
    {
      referralCode: 1,
      fundingIsFunded: 1,
      tradingTrades: 1,
      fundingDeposits: 1,
      fundingWithdrawals: 1,
      fundingNetDeposit: 1,
      tradingLots: 1,
      tradingNetProfit: 1,
      commissionEarned: 1,
    },
  ).lean();

  const map = new Map<string, CodeRow>();
  for (const r of rows) {
    const code = r.referralCode || "(none)";
    const c =
      map.get(code) ??
      {
        code,
        clients: 0,
        funded: 0,
        active: 0,
        deposits: 0,
        withdrawals: 0,
        netDeposit: 0,
        lots: 0,
        trades: 0,
        pnl: 0,
        commission: 0,
      };
    c.clients += 1;
    if (r.fundingIsFunded) c.funded += 1;
    if ((r.tradingTrades ?? 0) > 0) c.active += 1;
    c.deposits += toNumber(r.fundingDeposits);
    c.withdrawals += toNumber(r.fundingWithdrawals);
    c.netDeposit += toNumber(r.fundingNetDeposit);
    c.lots += toNumber(r.tradingLots);
    c.trades += r.tradingTrades ?? 0;
    c.pnl += toNumber(r.tradingNetProfit);
    c.commission += toNumber(r.commissionEarned);
    map.set(code, c);
  }

  const codes = [...map.values()].sort(
    (a, b) => b.commission - a.commission || b.clients - a.clients,
  );

  // per-code weekly signups for the stacked growth chart
  const codeKeys = codes.map((c) => c.code).filter((c) => c !== "(none)");
  const perCode = await Promise.all(
    codeKeys.map((code) => fetchBookSeries({ code })),
  );
  const weeklyByDate = new Map<string, TSPoint>();
  perCode.forEach((series, i) => {
    for (const w of bucketWeekly(series, ["newSignups"])) {
      const date = String(w.date);
      const row: TSPoint = weeklyByDate.get(date) ?? { date };
      row[codeKeys[i]!] = Number(w.newSignups) || 0;
      weeklyByDate.set(date, row);
    }
  });

  return {
    codes,
    codeKeys,
    growth: [...weeklyByDate.values()].sort((a, b) =>
      a.date < b.date ? -1 : 1,
    ),
  };
}

const PALETTE = ["var(--chart-1)", "var(--chart-3)", "var(--chart-5)", "var(--chart-7)", "var(--chart-2)"];

export default async function ReferralCodesPage() {
  const { codes, codeKeys, growth } = await load();
  const totalCommission = codes.reduce((s, c) => s + c.commission, 0);

  return (
    <div className="p-4 lg:p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <h1 className="text-lg font-semibold tracking-tight">Referral codes</h1>
        <p className="text-xs text-muted">performance by code</p>
      </div>

      {codeKeys.length > 1 && (
        <Card className="mb-3">
          <CardHead>New signups / week by code</CardHead>
          <TimeSeries
            data={growth}
            bars={codeKeys.map((k, i) => ({
              key: k,
              label: k,
              color: PALETTE[i % PALETTE.length]!,
            }))}
            height={150}
          />
        </Card>
      )}

      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[900px] text-[13px]">
          <thead>
            <tr className="border-b border-rule-2 text-left text-[11px] uppercase tracking-[0.08em] text-muted">
              <th className="px-3 py-1.5 font-medium">Code</th>
              <th className="px-3 py-1.5 font-medium text-right">Clients</th>
              <th className="px-3 py-1.5 font-medium text-right">Funded</th>
              <th className="px-3 py-1.5 font-medium text-right">Active</th>
              <th className="px-3 py-1.5 font-medium text-right">Fund %</th>
              <th className="px-3 py-1.5 font-medium text-right">Net deposit</th>
              <th className="px-3 py-1.5 font-medium text-right">Lots</th>
              <th className="px-3 py-1.5 font-medium text-right">Trades</th>
              <th className="px-3 py-1.5 font-medium text-right">Client PnL</th>
              <th className="px-3 py-1.5 font-medium text-right">Commission</th>
              <th className="px-3 py-1.5 font-medium text-right">Share</th>
            </tr>
          </thead>
          <tbody>
            {codes.map((c) => (
              <tr key={c.code} className="border-b border-rule last:border-0 hover:bg-sunken">
                <td className="px-3 py-1.5">
                  <Link
                    href={`/clients?code=${encodeURIComponent(c.code)}`}
                    className="font-mono text-[12px] text-accent hover:underline"
                  >
                    {c.code}
                  </Link>
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">{num(c.clients)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{num(c.funded)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{num(c.active)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-ink-2">
                  {pctStr((c.funded / Math.max(1, c.clients)) * 100)}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">{usd(c.netDeposit)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{num2(c.lots)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{num(c.trades)}</td>
                <td
                  className={cn(
                    "px-3 py-1.5 text-right tabular-nums",
                    c.pnl < 0 ? "text-err" : c.pnl > 0 ? "text-ok" : "text-ink-2",
                  )}
                >
                  {usd(c.pnl)}
                </td>
                <td className="px-3 py-1.5 text-right font-medium tabular-nums">{usd(c.commission)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-ink-2">
                  {pctStr((c.commission / Math.max(0.01, totalCommission)) * 100)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function CardHead({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-muted">
      {children}
    </p>
  );
}
