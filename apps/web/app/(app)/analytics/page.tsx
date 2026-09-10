import { connect, Client, FundingEvent } from "@elefin/db";
import { conversionFunnel } from "@elefin/domain";
import { fetchBookSeries, bucketWeekly } from "@/lib/book-daily";
import { fetchRetention } from "@/lib/retention";
import { Card } from "@/components/ui/card";
import { TimeSeries } from "@/components/charts/time-series";
import { EquityCurve } from "@/components/charts/equity-curve";
import { usd, num, pctStr } from "@/lib/format";
import { cn } from "@/lib/cn";

export const dynamic = "force-dynamic";

const DEPOSIT_BANDS: Array<[string, number, number]> = [
  ["< $50", 0, 50],
  ["$50–100", 50, 100],
  ["$100–200", 100, 200],
  ["$200–500", 200, 500],
  ["$500–1k", 500, 1000],
  ["$1k+", 1000, Infinity],
];

async function load() {
  await connect();

  const [series, clients, deposits, retention] = await Promise.all([
    fetchBookSeries(),
    Client.find(
      {},
      { country: 1, fundingIsFunded: 1, tradingTrades: 1, tradingLastTradeAt: 1 },
    ).lean(),
    FundingEvent.find(
      { type: "deposit", status: "success" },
      { amount: 1 },
    ).lean(),
    fetchRetention(),
  ]);

  const funnel = conversionFunnel(
    clients.map((c) => ({
      fundingIsFunded: c.fundingIsFunded,
      tradingTrades: c.tradingTrades ?? 0,
      tradingLastTradeAt: c.tradingLastTradeAt ?? null,
    })),
  );

  const byCountry = new Map<string, number>();
  for (const c of clients) {
    const k = c.country || "Unknown";
    byCountry.set(k, (byCountry.get(k) ?? 0) + 1);
  }
  const countries = [...byCountry.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([country, n]) => ({ country, n }));

  const bands = DEPOSIT_BANDS.map(([label, lo, hi]) => ({
    label,
    n: deposits.filter((d) => {
      const a = Number(d.amount);
      return a >= lo && a < hi;
    }).length,
  }));

  return { series, funnel, countries, bands, depositCount: deposits.length, retention };
}

export default async function AnalyticsPage() {
  const { series, funnel, countries, bands, depositCount, retention } = await load();

  const wkGrowth = bucketWeekly(series, ["newSignups"]);
  const wkFlow = bucketWeekly(series, [
    "depositsDay",
    "withdrawalsDay",
    "withdrawalsDayNeg",
    "netFlowDay",
    "clientPnlDay",
  ]);
  const clientsLine = series.map((p) => ({ t: p.date, cum: p.clientsTotal }));
  const activeLine = series.map((p) => ({ t: p.date, cum: p.clientsActiveTraders }));

  return (
    <div className="p-4 lg:p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <h1 className="text-lg font-semibold tracking-tight">Analytics</h1>
        <p className="text-xs text-muted">how the book is moving · {series.length} days of history</p>
      </div>

      <Section title="Growth">
        <Card>
          <CardHead>New signups / week</CardHead>
          <TimeSeries
            data={wkGrowth}
            bars={[{ key: "newSignups", label: "Signups", color: "var(--accent-solid)" }]}
          />
        </Card>
        <Card>
          <CardHead>Cumulative clients</CardHead>
          <EquityCurve data={clientsLine} unit="num" emptyLabel="Snapshots start today." />
        </Card>
        <Card>
          <CardHead>Active traders over time</CardHead>
          <EquityCurve data={activeLine} unit="num" emptyLabel="Snapshots start today." />
        </Card>
        <Card>
          <CardHead>Signups by country (top 8)</CardHead>
          <HBars rows={countries.map((c) => ({ label: c.country, value: c.n }))} />
        </Card>
      </Section>

      <Section title="Conversion">
        <Card className="lg:col-span-2">
          <CardHead>Signup → Funded → First trade → Active</CardHead>
          <div className="space-y-1.5">
            {funnel.map((s) => (
              <div key={s.key} className="flex items-center gap-2 text-[13px]">
                <span className="w-28 text-ink-2">{s.label}</span>
                <div className="h-3.5 flex-1 overflow-hidden rounded bg-sunken">
                  <div
                    className="h-full bg-accent-solid"
                    style={{ width: `${Math.max(s.rateOfTop, 2)}%` }}
                  />
                </div>
                <span className="w-28 text-right tabular-nums text-ink">
                  {num(s.count)} · {pctStr(s.rateOfTop)}
                </span>
              </div>
            ))}
          </div>
        </Card>
      </Section>

      <section className="mt-4">
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
          Retention
        </h2>
        <Card className="overflow-x-auto">
          <CardHead>
            Trading retention by signup week — % of the funded cohort that traded
            in week N
          </CardHead>
          <RetentionGridView grid={retention} />
        </Card>
      </section>

      <Section title="Funding">
        <Card>
          <CardHead>Deposits vs withdrawals / week</CardHead>
          <TimeSeries
            data={wkFlow}
            bars={[
              { key: "depositsDay", label: "Deposits", color: "var(--ok)" },
              { key: "withdrawalsDayNeg", label: "Withdrawals", color: "var(--err)" },
            ]}
            lines={[{ key: "netFlowDay", label: "Net", color: "var(--accent)" }]}
            unit="usd"
          />
        </Card>
        <Card>
          <CardHead>Cumulative net deposit</CardHead>
          <EquityCurve data={series.map((p) => ({ t: p.date, cum: p.netDepositCum }))} />
        </Card>
        <Card className="lg:col-span-2">
          <CardHead>Deposit size distribution ({num(depositCount)} deposits)</CardHead>
          <HBars rows={bands.map((b) => ({ label: b.label, value: b.n }))} />
        </Card>
      </Section>

      <Section title="Trading activity">
        <Card>
          <CardHead>Client PnL / week</CardHead>
          <TimeSeries
            data={wkFlow}
            bars={[{ key: "clientPnlDay", label: "Net PnL", color: "var(--accent-solid)" }]}
            unit="usd"
          />
        </Card>
        <Card>
          <CardHead>Cumulative client PnL</CardHead>
          <EquityCurve data={series.map((p) => ({ t: p.date, cum: p.clientPnlCum }))} />
        </Card>
        <Card>
          <CardHead>Cumulative trades</CardHead>
          <EquityCurve data={series.map((p) => ({ t: p.date, cum: p.tradesCum }))} unit="num" />
        </Card>
        <Card>
          <CardHead>Cumulative volume (lots)</CardHead>
          <EquityCurve data={series.map((p) => ({ t: p.date, cum: p.lotsCum }))} unit="num1" />
        </Card>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-4 first:mt-0">
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
        {title}
      </h2>
      <div className="grid gap-3 lg:grid-cols-2">{children}</div>
    </section>
  );
}

function CardHead({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-muted">
      {children}
    </p>
  );
}

function RetentionGridView({
  grid,
}: {
  grid: { maxOffset: number; cohorts: Array<{ week: string; size: number; cells: Array<number | null> }> };
}) {
  if (!grid.cohorts.length) {
    return <p className="mt-2 text-[13px] text-muted">No funded cohorts yet.</p>;
  }
  const offsets = Array.from({ length: grid.maxOffset + 1 }, (_, i) => i);
  return (
    <table className="mt-2 text-[11px] tabular-nums">
      <thead>
        <tr className="text-muted">
          <th className="px-2 py-1 text-left font-medium">Cohort</th>
          <th className="px-2 py-1 text-right font-medium">n</th>
          {offsets.map((k) => (
            <th key={k} className="px-2 py-1 text-center font-medium">
              w{k}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {grid.cohorts.map((c) => (
          <tr key={c.week}>
            <td className="px-2 py-1 text-ink-2">{c.week}</td>
            <td className="px-2 py-1 text-right text-ink-2">{c.size}</td>
            {c.cells.map((v, k) => (
              <td
                key={k}
                className={cn(
                  "px-2 py-1 text-center",
                  v == null ? "text-rule-2" : v >= 50 ? "text-white" : "text-ink",
                )}
                style={
                  v == null
                    ? undefined
                    : { background: `color-mix(in srgb, var(--accent-solid) ${Math.round(v * 0.9)}%, transparent)` }
                }
              >
                {v == null ? "·" : `${v}`}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function HBars({ rows }: { rows: Array<{ label: string; value: number }> }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="space-y-1">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2 text-[12px]">
          <span className="w-24 shrink-0 truncate text-ink-2">{r.label}</span>
          <div className="h-3.5 flex-1 overflow-hidden rounded bg-sunken">
            <div
              className="h-full bg-accent-solid"
              style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }}
            />
          </div>
          <span className="w-10 text-right tabular-nums text-ink">{r.value}</span>
        </div>
      ))}
    </div>
  );
}
