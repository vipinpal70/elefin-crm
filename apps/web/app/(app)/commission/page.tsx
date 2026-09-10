import Link from "next/link";
import { connect, Client, toNumber } from "@elefin/db";
import { cached } from "@elefin/cache";
import { fetchBookSeries } from "@/lib/book-daily";
import { KpiCard } from "@/components/kpi-card";
import { Card } from "@/components/ui/card";
import { EquityCurve } from "@/components/charts/equity-curve";
import { usd, num, num2, pctStr, compactUsd } from "@/lib/format";
import { cn } from "@/lib/cn";

export const dynamic = "force-dynamic";

function load() {
  return cached(
    "commission-page",
    { ttl: 600, tags: ["clients", "book"] },
    loadCommission,
  );
}

async function loadCommission() {
  await connect();
  const rows = await Client.find(
    {},
    {
      name: 1,
      referralCode: 1,
      fundingIsFunded: 1,
      tradingLots: 1,
      tradingTrades: 1,
      tradingNetProfit: 1,
      commissionEarned: 1,
      tradingLastTradeAt: 1,
    },
  ).lean();

  const clients = rows.map((r) => ({
    _id: r._id,
    name: r.name ?? "",
    code: r.referralCode || "(none)",
    funded: !!r.fundingIsFunded,
    lots: toNumber(r.tradingLots),
    trades: r.tradingTrades ?? 0,
    pnl: toNumber(r.tradingNetProfit),
    commission: toNumber(r.commissionEarned),
    lastTradeAt: r.tradingLastTradeAt ? new Date(r.tradingLastTradeAt).getTime() : 0,
  }));

  const earning = clients.filter((c) => c.commission > 0).sort((a, b) => b.commission - a.commission);
  const total = earning.reduce((s, c) => s + c.commission, 0);
  const totalLots = clients.reduce((s, c) => s + c.lots, 0);
  const funded = clients.filter((c) => c.funded).length;

  const dormantCut = Date.now() - 30 * 86_400_000;
  const atRisk = earning
    .filter((c) => c.lastTradeAt > 0 && c.lastTradeAt < dormantCut)
    .reduce((s, c) => s + c.commission, 0);

  const byCode = new Map<string, number>();
  for (const c of earning) byCode.set(c.code, (byCode.get(c.code) ?? 0) + c.commission);

  const series = await fetchBookSeries();

  return {
    total,
    totalLots,
    funded,
    perLot: totalLots ? total / totalLots : 0,
    perFunded: funded ? total / funded : 0,
    top1Share: earning[0] ? earning[0].commission / total : 0,
    top5Share: earning.slice(0, 5).reduce((s, c) => s + c.commission, 0) / Math.max(0.01, total),
    atRisk,
    earners: earning.slice(0, 50),
    byCode: [...byCode.entries()].sort((a, b) => b[1] - a[1]),
    series,
  };
}

export default async function CommissionPage() {
  const d = await load();

  return (
    <div className="p-4 lg:p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <h1 className="text-lg font-semibold tracking-tight">Commission</h1>
        <p className="text-xs text-muted">what the partner earns, and what drives it</p>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6">
        <KpiCard title="Earned to date" value={compactUsd(d.total)} tone="positive" />
        <KpiCard title="Per lot" value={usd(d.perLot)} />
        <KpiCard title="Per funded client" value={usd(d.perFunded)} />
        <KpiCard title="Earning clients" value={num(d.earners.length >= 50 ? 50 : d.earners.length)} />
        <KpiCard title="Top client share" value={pctStr(d.top1Share * 100)} />
        <KpiCard
          title="At risk (dormant)"
          value={compactUsd(d.atRisk)}
          tone={d.atRisk > 0 ? "negative" : "neutral"}
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHead>Commission earned over time</CardHead>
          <EquityCurve data={d.series.map((p) => ({ t: p.date, cum: p.commissionCum }))} />
          <p className="mt-1 text-[11px] text-muted">
            Only the current total is known historically — this line fills in as
            daily snapshots accumulate.
          </p>
        </Card>

        <Card>
          <CardHead>By referral code</CardHead>
          <table className="w-full text-[13px]">
            <tbody>
              {d.byCode.map(([code, amt]) => (
                <tr key={code} className="border-t border-rule first:border-0">
                  <td className="py-1.5 font-mono text-[12px]">{code}</td>
                  <td className="py-1.5 text-right tabular-nums">{usd(amt)}</td>
                  <td className="w-16 py-1.5 text-right tabular-nums text-ink-2">
                    {pctStr((amt / Math.max(0.01, d.total)) * 100)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-muted">
            Top 5 clients = {pctStr(d.top5Share * 100)} of all commission.
          </p>
        </Card>
      </div>

      <Card className="mt-3 overflow-x-auto p-0">
        <div className="border-b border-rule px-4 py-2 text-[11px] font-medium uppercase tracking-[0.12em] text-muted">
          Top earners
        </div>
        <table className="w-full min-w-[720px] text-[13px]">
          <thead>
            <tr className="border-b border-rule-2 text-left text-[11px] uppercase tracking-[0.08em] text-muted">
              <th className="px-3 py-1.5 font-medium">#</th>
              <th className="px-3 py-1.5 font-medium">Client</th>
              <th className="px-3 py-1.5 font-medium">Code</th>
              <th className="px-3 py-1.5 font-medium text-right">Lots</th>
              <th className="px-3 py-1.5 font-medium text-right">Trades</th>
              <th className="px-3 py-1.5 font-medium text-right">Client PnL</th>
              <th className="px-3 py-1.5 font-medium text-right">Commission</th>
              <th className="px-3 py-1.5 font-medium text-right">Per lot</th>
            </tr>
          </thead>
          <tbody>
            {d.earners.map((c, i) => (
              <tr key={c._id} className="border-b border-rule last:border-0 hover:bg-sunken">
                <td className="px-3 py-1.5 text-muted tabular-nums">{i + 1}</td>
                <td className="px-3 py-1.5">
                  <Link href={`/clients/${c._id}`} className="text-ink hover:text-accent">
                    {c.name || `#${c._id}`}
                  </Link>
                </td>
                <td className="px-3 py-1.5 font-mono text-[12px] text-ink-2">{c.code}</td>
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
                  {c.lots ? usd(c.commission / c.lots) : "—"}
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
