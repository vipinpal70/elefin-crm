import Link from "next/link";
import { fetchPositions } from "@/lib/positions-data";
import { KpiCard } from "@/components/kpi-card";
import { Card } from "@/components/ui/card";
import { usd, num, num2, dateTimeShort, relativeDays } from "@/lib/format";
import { cn } from "@/lib/cn";

export const dynamic = "force-dynamic";

export default async function PositionsPage() {
  const { rows, kpis, lastSync, positionsSyncEnabled } = await fetchPositions();

  const stale =
    lastSync.at != null &&
    Date.now() - new Date(lastSync.at).getTime() > 15 * 60_000;

  return (
    <div className="p-4 lg:p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <h1 className="text-lg font-semibold tracking-tight">Open positions</h1>
        <p className="text-xs text-muted">
          {lastSync.at
            ? `synced ${relativeDays(lastSync.at)} · ${dateTimeShort(lastSync.at)}`
            : "not synced yet"}
        </p>
      </div>

      {!positionsSyncEnabled && (
        <Card className="mb-3 border-butter-line bg-butter">
          <p className="text-[13px] text-ink-2">
            No positions sweep has run yet. The worker runs it on boot and every 2
            minutes (<code>SYNC_POSITIONS_CRON</code>); or run it now with{" "}
            <code>npm run job --workspace @elefin/worker -- positions</code>.
          </p>
        </Card>
      )}

      {stale && positionsSyncEnabled && (
        <Card className="mb-3 border-err/30 bg-err-bg">
          <p className="text-[13px] text-err">
            Positions data is {relativeDays(lastSync.at)} old — an empty list may
            just mean the sync stalled, not that everyone is flat.
          </p>
        </Card>
      )}

      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <KpiCard title="Accounts with risk" value={num(kpis.accounts)} />
        <KpiCard title="Open lots" value={num2(kpis.totalLots)} />
        <KpiCard
          title="Unrealised PnL"
          value={usd(kpis.unrealized)}
          tone={kpis.unrealized < 0 ? "negative" : kpis.unrealized > 0 ? "positive" : "neutral"}
        />
        <KpiCard
          title="Most-exposed"
          value={kpis.bySymbol[0]?.symbol ?? "—"}
          sub={kpis.bySymbol[0] ? `${num2(kpis.bySymbol[0].lots)} lots` : undefined}
        />
      </div>

      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[900px] text-[13px]">
          <thead>
            <tr className="border-b border-rule-2 text-left text-[11px] uppercase tracking-[0.08em] text-muted">
              <th className="px-3 py-1.5 font-medium">Client</th>
              <th className="px-3 py-1.5 font-medium">Login</th>
              <th className="px-3 py-1.5 font-medium">Symbol</th>
              <th className="px-3 py-1.5 font-medium">Side</th>
              <th className="px-3 py-1.5 font-medium text-right">Lots</th>
              <th className="px-3 py-1.5 font-medium text-right">Open</th>
              <th className="px-3 py-1.5 font-medium text-right">Current</th>
              <th className="px-3 py-1.5 font-medium text-right">Unrealised</th>
              <th className="px-3 py-1.5 font-medium text-right">Opened</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-10 text-center text-muted">
                  No open positions{positionsSyncEnabled ? " right now" : " synced yet"}.
                </td>
              </tr>
            ) : (
              rows.map((p) => (
                <tr key={p._id} className="border-b border-rule last:border-0 hover:bg-sunken">
                  <td className="px-3 py-1.5">
                    {p.clientId != null ? (
                      <Link href={`/elefin/clients/${p.clientId}`} className="text-ink hover:text-accent">
                        {p.clientName || `#${p.clientId}`}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-1.5">
                    <Link
                      href={`/elefin/accounts/${p.login}/history`}
                      className="font-mono text-[12px] text-accent hover:underline"
                    >
                      {p.login}
                    </Link>
                  </td>
                  <td className="px-3 py-1.5">{p.symbol}</td>
                  <td className={cn("px-3 py-1.5 uppercase", p.side === "sell" ? "text-err" : "text-ok")}>
                    {p.side}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{num2(p.volumeLots)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-ink-2">{num2(p.openPrice)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-ink-2">{num2(p.currentPrice)}</td>
                  <td
                    className={cn(
                      "px-3 py-1.5 text-right font-medium tabular-nums",
                      p.unrealizedPnl < 0 ? "text-err" : "text-ok",
                    )}
                  >
                    {usd(p.unrealizedPnl)}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-ink-2">
                    {p.openAt ? relativeDays(p.openAt) : "—"}
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
