import Link from "next/link";
import { fetchXmDashboard } from "@/lib/xm-data";
import { KpiCard } from "@/components/kpi-card";
import { Card, CardTitle } from "@/components/ui/card";
import { usd, num, num2 } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function XmDashboardPage() {
  const d = await fetchXmDashboard();

  return (
    <div className="p-4 lg:p-5">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold tracking-tight">XM dashboard</h1>
        <span className="rounded-full border border-xm-accent/30 bg-xm-accent-bg px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.08em] text-xm-accent">
          XM
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        <KpiCard title="Traders" value={num(d.totalTraders)} />
        <KpiCard title="Linked to Elefin" value={num(d.linkedTraders)} sub={`${d.totalTraders ? Math.round((d.linkedTraders / d.totalTraders) * 100) : 0}%`} />
        <KpiCard title="Flagged" value={num(d.flaggedTraders)} tone={d.flaggedTraders ? "negative" : "neutral"} />
        <KpiCard title="Trades" value={num(d.totalTrades)} />
        <KpiCard title="Lots" value={num2(d.totalLots)} />
        <KpiCard title="Commission" value={usd(d.totalCommission)} tone="positive" />
      </div>

      <Card className="mt-3">
        <CardTitle>Recently imported</CardTitle>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[520px] text-[13px]">
            <thead>
              <tr className="border-b border-rule-2 text-left text-[11px] uppercase tracking-[0.08em] text-muted">
                <th className="py-1.5 pr-3 font-medium">Name</th>
                <th className="py-1.5 pr-3 font-medium">Email</th>
                <th className="py-1.5 font-medium">MT5 login</th>
              </tr>
            </thead>
            <tbody>
              {d.recentTraders.length === 0 ? (
                <tr>
                  <td colSpan={3} className="py-4 text-center text-muted">
                    No XM traders imported yet — see{" "}
                    <Link href="/imports" className="text-accent hover:underline">
                      Imports
                    </Link>
                    .
                  </td>
                </tr>
              ) : (
                d.recentTraders.map((t) => (
                  <tr key={t._id} className="border-b border-rule last:border-0">
                    <td className="py-1.5 pr-3">
                      <Link href={`/xm/clients/${t._id}`} className="text-ink hover:text-accent">
                        {t.name || "—"}
                      </Link>
                    </td>
                    <td className="py-1.5 pr-3 text-ink-2">{t.email || "—"}</td>
                    <td className="py-1.5 font-mono text-[12px] text-ink-2">{t.mt5Login || "—"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
