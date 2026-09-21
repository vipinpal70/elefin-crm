import Link from "next/link";
import { connect, Client, toNumber } from "@elefin/db";
import { cached } from "@elefin/cache";
import { bookKpis, conversionFunnel, round } from "@elefin/domain";
import { fetchBookSeries, bucketWeekly, periodDeltas, type PeriodDelta } from "@/lib/book-daily";
import { fetchTopAlerts } from "@/lib/alerts-data";
import { fetchOpenFollowUps } from "@/lib/notes-data";
import { fetchTargets } from "@/lib/targets-data";
import { fetchLatestDigest } from "@/lib/digest-data";
import { KpiCard, type KpiChange } from "@/components/kpi-card";
import { Card } from "@/components/ui/card";
import { TimeSeries } from "@/components/charts/time-series";
import { EquityCurve } from "@/components/charts/equity-curve";
import { usd, num, num2, pctStr, dateShort, dateTimeShort, compactUsd, compactNum } from "@/lib/format";
import { cn } from "@/lib/cn";

export const dynamic = "force-dynamic";

const PROJECTION = {
  name: 1,
  fundingIsFunded: 1,
  status: 1,
  registeredAt: 1,
  referralCode: 1,
  country: 1,
  fundingDeposits: 1,
  fundingWithdrawals: 1,
  fundingNetDeposit: 1,
  accountsBalance: 1,
  accountsEquity: 1,
  tradingLots: 1,
  tradingTrades: 1,
  tradingNetProfit: 1,
  tradingLastTradeAt: 1,
  commissionEarned: 1,
  lastSyncedAt: 1,
} as const;

interface CodeStat {
  code: string;
  clients: number;
  funded: number;
  lots: number;
  commission: number;
}

async function loadBook() {
  // The full-book scan + KPI/funnel/by-code roll-up is the expensive part and
  // only changes when a sync writes new client rows or a snapshot lands.
  const core = await cached(
    "dashboard-core",
    { ttl: 120, tags: ["clients", "book"] },
    loadDashboardCore,
  );

  const [series, topAlerts, followUps, digest] = await Promise.all([
    fetchBookSeries(),
    fetchTopAlerts(6),
    fetchOpenFollowUps(6),
    fetchLatestDigest(),
  ]);
  const targets = await fetchTargets(series);

  return {
    ...core,
    series,
    deltas: periodDeltas(series, 30),
    topAlerts,
    followUps,
    targets,
    digest,
  };
}

async function loadDashboardCore() {
  await connect();
  // Current-book KPIs: a client who has switched partner codes no longer
  // counts, though their historical data (book_daily trend charts) is left
  // alone — see partner-code-change-plan.md §9.1.
  const rows = await Client.find({ partnerStatus: { $ne: "departed" } }, PROJECTION).lean();

  const clients = rows.map((r) => ({
    _id: r._id,
    name: r.name ?? "",
    fundingIsFunded: r.fundingIsFunded,
    status: r.status,
    registeredAt: r.registeredAt,
    referralCode: r.referralCode,
    country: r.country,
    fundingDeposits: toNumber(r.fundingDeposits),
    fundingWithdrawals: toNumber(r.fundingWithdrawals),
    fundingNetDeposit: toNumber(r.fundingNetDeposit),
    accountsBalance: toNumber(r.accountsBalance),
    accountsEquity: toNumber(r.accountsEquity),
    tradingLots: toNumber(r.tradingLots),
    tradingTrades: r.tradingTrades ?? 0,
    tradingNetProfit: toNumber(r.tradingNetProfit),
    tradingLastTradeAt: r.tradingLastTradeAt,
    commissionEarned: toNumber(r.commissionEarned),
  }));

  const lastSyncedRaw = rows
    .map((r) => r.lastSyncedAt)
    .filter(Boolean)
    .sort()
    .at(-1) as Date | undefined;
  const lastSynced = lastSyncedRaw ? new Date(lastSyncedRaw).toISOString() : null;

  const byCode = new Map<string, CodeStat>();
  for (const c of clients) {
    const code = c.referralCode ?? "(none)";
    const s = byCode.get(code) ?? { code, clients: 0, funded: 0, lots: 0, commission: 0 };
    s.clients += 1;
    if (c.fundingIsFunded) s.funded += 1;
    s.lots += c.tradingLots;
    s.commission += c.commissionEarned;
    byCode.set(code, s);
  }

  const topClients = [...clients]
    .filter((c) => c.commissionEarned > 0)
    .sort((a, b) => b.commissionEarned - a.commissionEarned)
    .slice(0, 8)
    .map((c) => ({
      _id: c._id,
      name: c.name,
      tradingLots: c.tradingLots,
      tradingTrades: c.tradingTrades,
      commissionEarned: c.commissionEarned,
    }));

  return {
    count: rows.length,
    kpis: bookKpis(clients),
    funnel: conversionFunnel(clients),
    codeStats: [...byCode.values()]
      .map((s) => ({ ...s, lots: round(s.lots, 2), commission: round(s.commission) }))
      .sort((a, b) => b.commission - a.commission || b.clients - a.clients),
    topClients,
    lastSynced,
  };
}

const chg = (d: PeriodDelta, fmt: (n: number) => string, goodUp = true): KpiChange => ({
  text: `${d.diff >= 0 ? "+" : ""}${fmt(d.diff)} vs prev 30d`,
  dir: d.diff > 0 ? "up" : d.diff < 0 ? "down" : "flat",
  goodUp,
});

export default async function DashboardPage() {
  const {
    count, kpis, funnel, codeStats, topClients, lastSynced, series, deltas,
    topAlerts, followUps, targets, digest,
  } = await loadBook();

  const weekly = bucketWeekly(
    series,
    ["newSignups", "depositsDay", "withdrawalsDay", "withdrawalsDayNeg", "netFlowDay"],
  );

  return (
    <div className="p-4 lg:p-5">
      <div className="mb-4 flex items-baseline justify-between">
        <h1 className="text-lg font-semibold tracking-tight">Dashboard</h1>
        <p className="text-xs text-muted">
          {count > 0
            ? `${num(count)} clients · data as of ${dateTimeShort(lastSynced ?? null)}`
            : "no data yet"}
        </p>
      </div>

      {count === 0 ? (
        <Card className="border-butter-line bg-butter">
          <p className="text-sm font-medium text-ink">The book is empty.</p>
          <p className="mt-1 text-[13px] text-ink-2">
            Populate it by either:
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] text-ink-2">
            <li>
              starting the sync worker (<code>npm run dev:worker</code>) with valid{" "}
              <code>ELEFIN_API_*</code> credentials in <code>.env</code>, or
            </li>
            <li>
              importing the sample export (<code>npm run import:xlsx</code> — Phase 1).
            </li>
          </ul>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6">
            <KpiCard
              title="Clients"
              value={num(kpis.clientsTotal)}
              change={chg(deltas.signups, (n) => num(n))}
              info="Total clients registered under your referral code(s). The change compares the trailing 30 days to the 30 days before that."
            />
            <KpiCard
              title="Funded"
              value={num(kpis.clientsFunded)}
              sub={`${pctStr(kpis.fundedRate)} of book`}
              info="Clients who have made at least one deposit, and their share of the whole book."
            />
            <KpiCard
              title="Active traders"
              value={num(kpis.activeTraders)}
              sub={`${pctStr(kpis.activeRate)} of book`}
              info="Clients who have placed at least one trade (lifetime — not necessarily recently), and their share of the whole book."
            />
            <KpiCard
              title="Net deposits"
              value={compactUsd(kpis.netDeposits)}
              change={chg(deltas.netFlow, compactUsd)}
              info="Total deposits minus total withdrawals, book-wide. The change compares the trailing 30 days to the 30 days before that."
            />
            <KpiCard
              title="Commission"
              value={compactUsd(kpis.commissionEarned)}
              sub={`${usd(kpis.commissionPerLot)} / lot`}
              tone="positive"
              info="Total commission earned to date across every client, and the average earned per lot traded."
            />
            <KpiCard
              title="Client PnL"
              value={compactUsd(kpis.clientPnl)}
              change={chg(deltas.clientPnl, compactUsd)}
              tone={kpis.clientPnl < 0 ? "negative" : "positive"}
              info="Sum of every client's net trading profit/loss — what traders made or lost, not your commission. The change compares the trailing 30 days to the 30 days before that."
            />
          </div>

          <div className="mt-2.5 grid grid-cols-2 gap-2.5 sm:grid-cols-4 xl:grid-cols-7">
            <KpiCard
              title="Deposits"
              value={compactUsd(kpis.totalDeposits)}
              change={chg(deltas.deposits, compactUsd)}
              info="Total amount deposited by all clients, book-wide. The change compares the trailing 30 days to the 30 days before that."
            />
            <KpiCard
              title="Withdrawals"
              value={compactUsd(kpis.totalWithdrawals)}
              change={chg(deltas.withdrawals, compactUsd, false)}
              info="Total amount withdrawn by all clients, book-wide. The change compares the trailing 30 days to the 30 days before that."
            />
            <KpiCard
              title="Total lost"
              value={compactUsd(kpis.totalLost)}
              tone="negative"
              info="Sum of net losses only — added up across clients whose lifetime trading PnL is negative."
            />
            <KpiCard
              title="Lots"
              value={num2(kpis.totalLots)}
              info="Total trading volume, in lots, across every client."
            />
            <KpiCard
              title="Trades"
              value={compactNum(kpis.totalTrades)}
              info="Total number of closed trades across every client."
            />
            <KpiCard
              title="Avg deposit"
              value={compactUsd(kpis.avgDepositPerFunded)}
              info="Average total deposit per funded client (total deposits ÷ funded clients)."
            />
            {/* Dormant KPI card hidden — commented out per request. dormantClients
                is still computed in bookKpis() if this needs to come back. */}
            {/* <KpiCard title="Dormant" value={num(kpis.dormantClients)} /> */}
            <KpiCard
              title="Balance"
              value={compactUsd(kpis.balanceTotal)}
              info="Sum of current account balances across every client."
            />
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <Card className="lg:col-span-2">
              <div className="mb-2 flex items-center justify-between">
                <CardHead>Needs attention</CardHead>
                <span className="flex gap-2 text-[11px]">
                  <Link href="/elefin/alerts" className="text-accent hover:underline">
                    all alerts →
                  </Link>
                  <Link href="/elefin/notes" className="text-accent hover:underline">
                    notes →
                  </Link>
                </span>
              </div>
              {topAlerts.rows.length === 0 && followUps.length === 0 ? (
                <p className="text-[13px] text-muted">Nothing urgent. Nice.</p>
              ) : (
                <ul className="space-y-1 text-[13px]">
                  {topAlerts.rows.map((a) => (
                    <li key={a._id} className="flex items-center gap-2">
                      <span
                        className={cn(
                          "h-1.5 w-1.5 shrink-0 rounded-full",
                          a.severity === "critical" ? "bg-err" : "bg-butter-line",
                        )}
                      />
                      {a.clientId != null ? (
                        <Link href={`/elefin/clients/${a.clientId}`} className="text-ink hover:text-accent">
                          {a.title}
                        </Link>
                      ) : (
                        <span className="text-ink">{a.title}</span>
                      )}
                    </li>
                  ))}
                  {topAlerts.total > topAlerts.rows.length ? (
                    <li className="text-[11px] text-muted">
                      + {topAlerts.total - topAlerts.rows.length} more open alerts
                    </li>
                  ) : null}
                  {followUps.map((f) => {
                    const overdue = f.dueAt && new Date(f.dueAt) < new Date();
                    return (
                      <li key={f._id} className="flex items-center gap-2">
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                        <span className={overdue ? "text-err" : "text-ink-2"}>
                          {dateShort(f.dueAt)}
                        </span>
                        <Link href={`/elefin/clients/${f.clientId}`} className="text-accent hover:underline">
                          {f.clientName}
                        </Link>
                        <span className="truncate text-ink-2">{f.body}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>

            {targets && targets.rows.length > 0 && (
              <Card>
                <div className="mb-2 flex items-baseline justify-between">
                  <CardHead>Monthly targets</CardHead>
                  <span className="text-[11px] text-muted">
                    {targets.month} · day {targets.daysElapsed}/{targets.daysInMonth}
                  </span>
                </div>
                <div className="space-y-2.5">
                  {targets.rows.map((r) => {
                    const f = r.fmt === "usd" ? compactUsd : (n: number) => num(Math.round(n));
                    const pct = r.target ? Math.min(100, (r.actual / r.target) * 100) : 0;
                    const pacePct = r.target ? Math.min(100, (r.pace / r.target) * 100) : 0;
                    return (
                      <div key={r.key}>
                        <div className="flex items-baseline justify-between text-[12px]">
                          <span className="text-ink-2">{r.label}</span>
                          <span className="tabular-nums">
                            <span className={cn("font-medium", r.onTrack ? "text-ok" : "text-err")}>
                              {f(r.actual)}
                            </span>
                            <span className="text-muted"> / {f(r.target)}</span>
                          </span>
                        </div>
                        <div className="relative mt-1 h-2 overflow-hidden rounded bg-sunken">
                          <div
                            className={cn("h-full", r.onTrack ? "bg-ok" : "bg-accent-solid")}
                            style={{ width: `${pct}%` }}
                          />
                          <div
                            className="absolute top-0 h-full w-px bg-ink/40"
                            style={{ left: `${pacePct}%` }}
                            title={`pace: ${f(r.pace)}`}
                          />
                        </div>
                        <p className="mt-0.5 text-[11px] text-muted">
                          {r.onTrack
                            ? "on track"
                            : `behind pace by ${f(Math.max(0, r.pace - r.actual))}`}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </Card>
            )}

            {digest && (
              <Card>
                <div className="mb-2 flex items-baseline justify-between">
                  <CardHead>Latest digest</CardHead>
                  <span className="text-[11px] text-muted">{digest.date}</span>
                </div>
                <pre className="whitespace-pre-wrap font-sans text-[12px] leading-relaxed text-ink-2">
                  {digest.text || "(empty)"}
                </pre>
              </Card>
            )}

            <Card>
              <CardHead>Referral book growth · new signups / week</CardHead>
              <TimeSeries
                data={weekly}
                bars={[{ key: "newSignups", label: "Signups", color: "var(--accent-solid)" }]}
                height={150}
              />
            </Card>

            <Card>
              <CardHead>Deposits vs withdrawals / week</CardHead>
              <TimeSeries
                data={weekly}
                bars={[
                  { key: "depositsDay", label: "Deposits", color: "var(--ok)" },
                  { key: "withdrawalsDayNeg", label: "Withdrawals", color: "var(--err)" },
                ]}
                lines={[{ key: "netFlowDay", label: "Net", color: "var(--accent)" }]}
                height={150}
                unit="usd"
              />
            </Card>

            <Card>
              <CardHead>Net deposit over time</CardHead>
              <EquityCurve data={series.map((p) => ({ t: p.date, cum: p.netDepositCum }))} />
            </Card>

            <Card>
              <CardHead>Client PnL over time</CardHead>
              <EquityCurve data={series.map((p) => ({ t: p.date, cum: p.clientPnlCum }))} />
            </Card>

            <Card>
              <CardHead>Signup → Funded → Active funnel</CardHead>
              <div className="space-y-1.5">
                {funnel.map((s) => (
                  <div key={s.key} className="flex items-center gap-2 text-sm">
                    <span className="w-28 text-ink-2">{s.label}</span>
                    <div className="h-4 flex-1 overflow-hidden rounded bg-sunken">
                      <div
                        className="h-full bg-accent-solid"
                        style={{ width: `${Math.max(s.rateOfTop, 2)}%` }}
                      />
                    </div>
                    <span className="w-24 text-right tabular-nums text-ink">
                      {num(s.count)} · {pctStr(s.rateOfTop)}
                    </span>
                  </div>
                ))}
              </div>
            </Card>

            <Card>
              <CardHead>By referral code</CardHead>
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-[0.08em] text-muted">
                    <th className="py-1 font-medium">Code</th>
                    <th className="py-1 text-right font-medium">Clients</th>
                    <th className="py-1 text-right font-medium">Funded</th>
                    <th className="py-1 text-right font-medium">Lots</th>
                    <th className="py-1 text-right font-medium">Commission</th>
                  </tr>
                </thead>
                <tbody>
                  {codeStats.map((s) => (
                    <tr key={s.code} className="border-t border-rule">
                      <td className="py-1.5 font-mono text-[12px]">{s.code}</td>
                      <td className="py-1.5 text-right tabular-nums">{num(s.clients)}</td>
                      <td className="py-1.5 text-right tabular-nums">{num(s.funded)}</td>
                      <td className="py-1.5 text-right tabular-nums">{num2(s.lots)}</td>
                      <td className="py-1.5 text-right tabular-nums">{usd(s.commission)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <Card className="lg:col-span-2">
              <CardHead>Top clients by commission</CardHead>
              <table className="w-full text-[13px]">
                <tbody>
                  {topClients.map((c, i) => (
                    <tr key={c._id} className="border-t border-rule first:border-0">
                      <td className="w-6 py-1.5 text-muted tabular-nums">{i + 1}</td>
                      <td className="py-1.5">
                        <Link href={`/elefin/clients/${c._id}`} className="text-ink hover:text-accent">
                          {c.name || `#${c._id}`}
                        </Link>
                      </td>
                      <td className="py-1.5 text-right tabular-nums text-ink-2">
                        {num2(c.tradingLots)} lots
                      </td>
                      <td className="py-1.5 text-right tabular-nums">{num(c.tradingTrades)} tr</td>
                      <td className="w-24 py-1.5 text-right font-medium tabular-nums">
                        {usd(c.commissionEarned)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

          </div>
        </>
      )}
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

