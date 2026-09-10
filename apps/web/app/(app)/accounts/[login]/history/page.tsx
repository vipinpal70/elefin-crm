import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchAccountHistory } from "@/lib/trades-data";
import type { SP } from "@/lib/clients-query";
import { DateRangeFields } from "@/components/ui/date-range-fields";
import { DailyPnlChart } from "@/components/charts/daily-pnl";
import { EquityCurve } from "@/components/charts/equity-curve";
import { KpiCard } from "@/components/kpi-card";
import { Card } from "@/components/ui/card";
import { usd, num, num2, pf, pctStr, duration, dateShort, dateTimeShort } from "@/lib/format";
import { cn } from "@/lib/cn";

export const dynamic = "force-dynamic";

export default async function TradingHistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ login: string }>;
  searchParams: Promise<SP>;
}) {
  const { login } = await params;
  const sp = await searchParams;
  const data = await fetchAccountHistory(login, sp);
  if (!data) notFound();

  const { account: a, clientName, clientId, stats: s, trades, positions, symbols, range, symbol } = data;
  const openAsOf = positions[0]?.asOf ?? null;

  return (
    <div className="p-4 lg:p-5">
      <div className="mb-3">
        <Link
          href={clientId ? `/clients/${clientId}` : "/clients"}
          className="text-[13px] text-accent hover:underline"
        >
          ‹ {clientName ?? "Clients"}
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="text-lg font-semibold tracking-tight">
            Trading history
          </h1>
          <span className="font-mono text-[13px] text-ink-2">account {a._id}</span>
          <span className="text-[13px] text-ink-2">
            {a.accountType ?? "MT5"} · 1:{a.leverage ?? "—"}
          </span>
        </div>
      </div>

      {/* filters */}
      <form
        method="GET"
        action={`/accounts/${a._id}/history`}
        className="mb-4 flex flex-wrap items-end gap-2 rounded-xl border border-rule bg-raised p-3 text-[13px] shadow-card"
      >
        <DateRangeFields from={range.from} to={range.to} />
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-[0.1em] text-muted">Symbol</span>
          <select
            name="symbol"
            defaultValue={symbol ?? ""}
            className="h-8 rounded-md border border-rule-2 bg-raised px-2 text-ink"
          >
            <option value="">All</option>
            {symbols.map((sy) => (
              <option key={sy} value={sy}>
                {sy}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="h-8 rounded-md bg-accent-solid px-3 font-medium text-white hover:brightness-105">
          Apply
        </button>
        <Link href={`/accounts/${a._id}/history`} className="h-8 rounded-md border border-rule-2 px-3 leading-8 text-ink-2 hover:text-ink">
          Reset
        </Link>
        <a
          href={`/api/accounts/${a._id}/trades/export${qs(range.from, range.to, symbol)}`}
          className="ml-auto self-center text-xs text-accent hover:underline"
        >
          Export CSV
        </a>
      </form>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-6">
        <KpiCard title="Trades" value={num(s.trades)} sub={`${s.wins}W · ${s.losses}L`} />
        <KpiCard title="Win rate" value={pctStr(s.winRate * 100)} />
        <KpiCard
          title="Net PnL"
          value={usd(s.netPnl)}
          tone={s.netPnl < 0 ? "negative" : s.netPnl > 0 ? "positive" : "neutral"}
        />
        <KpiCard title="Volume" value={`${num2(s.totalLots)} lots`} />
        <KpiCard title="Profit factor" value={pf(s.profitFactor)} />
        <KpiCard title="Expectancy" value={usd(s.expectancy)} sub="per trade" />
        <KpiCard title="Avg win" value={usd(s.avgWin)} tone="positive" />
        <KpiCard title="Avg loss" value={usd(s.avgLoss)} tone="negative" />
        <KpiCard title="Largest win" value={usd(s.largestWin)} />
        <KpiCard title="Largest loss" value={usd(s.largestLoss)} />
        <KpiCard title="Max drawdown" value={usd(s.maxDrawdown)} sub={`${pctStr(s.maxDrawdownPct)}`} />
        <KpiCard
          title="Avg hold"
          value={s.avgHoldingMs != null ? duration(s.avgHoldingMs / 1000) : "—"}
          sub={`comm ${usd(s.commissionPaid)}`}
        />
      </div>

      {positions.length > 0 && (
        <Card className="mt-4">
          <div className="mb-2 flex items-center gap-2">
            <CardHead>Open positions ({positions.length})</CardHead>
            <span className="text-[11px] text-muted">
              as of {openAsOf ? dateTimeShort(openAsOf) : "unknown"}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <tbody>
                {positions.map((p) => (
                  <tr key={p._id} className="border-t border-rule first:border-0">
                    <td className="py-1.5 pr-3">{p.symbol}</td>
                    <td className="py-1.5 pr-3 uppercase text-ink-2">{p.side}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{num2(p.volumeLots)} lots</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-ink-2">@ {num2(p.openPrice)}</td>
                    <td
                      className={cn(
                        "py-1.5 text-right tabular-nums",
                        p.unrealizedPnl < 0 ? "text-err" : "text-ok",
                      )}
                    >
                      {usd(p.unrealizedPnl)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* charts */}
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHead>Daily PnL</CardHead>
          <div className="mt-2">
            <DailyPnlChart data={s.dailyPnl} />
          </div>
        </Card>
        <Card>
          <CardHead>Cumulative PnL</CardHead>
          <div className="mt-2">
            <EquityCurve data={s.equityCurve} />
          </div>
        </Card>
      </div>

      {/* by symbol */}
      {s.bySymbol.length > 0 && (
        <Card className="mt-3">
          <CardHead>By instrument</CardHead>
          <table className="mt-2 w-full text-[13px]">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-[0.08em] text-muted">
                <th className="py-1 font-medium">Symbol</th>
                <th className="py-1 text-right font-medium">Trades</th>
                <th className="py-1 text-right font-medium">Lots</th>
                <th className="py-1 text-right font-medium">Win rate</th>
                <th className="py-1 text-right font-medium">Net PnL</th>
              </tr>
            </thead>
            <tbody>
              {s.bySymbol.map((r) => (
                <tr key={r.symbol} className="border-t border-rule">
                  <td className="py-1.5">{r.symbol}</td>
                  <td className="py-1.5 text-right tabular-nums">{num(r.trades)}</td>
                  <td className="py-1.5 text-right tabular-nums">{num2(r.lots)}</td>
                  <td className="py-1.5 text-right tabular-nums">{pctStr(r.winRate * 100)}</td>
                  <td className={cn("py-1.5 text-right tabular-nums", r.netPnl < 0 ? "text-err" : "text-ok")}>
                    {usd(r.netPnl)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {/* trades table */}
      <Card className="mt-3 overflow-x-auto p-0">
        <div className="border-b border-rule px-4 py-2 text-[11px] font-medium uppercase tracking-[0.12em] text-muted">
          Trades ({num(trades.length)})
        </div>
        <table className="w-full min-w-[960px] text-[13px]">
          <thead>
            <tr className="border-b border-rule-2 text-left text-[11px] uppercase tracking-[0.08em] text-muted">
              <th className="px-3 py-1.5 font-medium">Ticket</th>
              <th className="px-3 py-1.5 font-medium">Symbol</th>
              <th className="px-3 py-1.5 font-medium">Side</th>
              <th className="px-3 py-1.5 font-medium text-right">Lots</th>
              <th className="px-3 py-1.5 font-medium text-right">Open → Close</th>
              <th className="px-3 py-1.5 font-medium text-right">Opened</th>
              <th className="px-3 py-1.5 font-medium text-right">Held</th>
              <th className="px-3 py-1.5 font-medium text-right">Comm.</th>
              <th className="px-3 py-1.5 font-medium text-right">Net PnL</th>
            </tr>
          </thead>
          <tbody>
            {trades.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-10 text-center text-muted">
                  No trades in range.
                </td>
              </tr>
            ) : (
              [...trades]
                .reverse()
                .map((t) => (
                  <tr key={t._id} className="border-b border-rule last:border-0 hover:bg-sunken">
                    <td className="px-3 py-1.5 font-mono text-[12px] text-ink-2">{t._id}</td>
                    <td className="px-3 py-1.5">{t.symbol}</td>
                    <td className={cn("px-3 py-2 uppercase", t.side === "sell" ? "text-err" : "text-ok")}>
                      {t.side}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{num2(t.volumeLots)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-ink-2">
                      {num2(t.openPrice)} → {num2(t.closePrice)}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-ink-2">
                      {dateShort(t.openAt)}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-ink-2">
                      {t.holdingDurationSeconds != null ? duration(t.holdingDurationSeconds) : "—"}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-ink-2">{usd(t.commission)}</td>
                    <td className={cn("px-3 py-2 text-right font-medium tabular-nums", t.netPnl < 0 ? "text-err" : "text-ok")}>
                      {t.netPnl >= 0 ? "+" : ""}
                      {usd(t.netPnl)}
                    </td>
                  </tr>
                ))
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function qs(from?: string, to?: string, symbol?: string) {
  const p = new URLSearchParams();
  if (from) p.set("from", from);
  if (to) p.set("to", to);
  if (symbol) p.set("symbol", symbol);
  const s = p.toString();
  return s ? `?${s}` : "";
}

function CardHead({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted">
      {children}
    </p>
  );
}
