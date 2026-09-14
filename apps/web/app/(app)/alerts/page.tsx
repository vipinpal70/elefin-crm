import Link from "next/link";
import { requireSession } from "@/lib/auth";
import { fetchAlerts, parseAlertsQuery } from "@/lib/alerts-data";
import { fetchWatchlist } from "@/lib/watchlist";
import { fetchOpenFollowUps } from "@/lib/notes-data";
import type { SP } from "@/lib/clients-query";
import {
  acknowledgeAlert,
  unacknowledgeAlert,
  snoozeAlert,
} from "@/lib/actions/alerts";
import { toggleNoteDone } from "@/lib/actions/notes";
import { KpiCard } from "@/components/kpi-card";
import { Card } from "@/components/ui/card";
import { usd, num, dateShort, relativeDays } from "@/lib/format";
import { cn } from "@/lib/cn";

export const dynamic = "force-dynamic";

const SEV_STYLE: Record<string, string> = {
  critical: "bg-err-bg text-err",
  warning: "bg-butter text-ink-2 border border-butter-line",
  info: "bg-accent-bg text-accent",
};

const TYPE_LABEL: Record<string, string> = {
  big_deposit: "Big deposit",
  big_withdrawal: "Big withdrawal",
  funded_never_traded: "Funded, never traded",
  gone_dormant: "Gone dormant",
  balance_wipeout: "Balance wipeout",
  margin_pressure: "Margin pressure",
  new_whale: "New whale",
  first_trade: "First trade",
  integration_down: "Integration down",
  partner_code_changed: "Left referral code",
};

export default async function AlertsPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  const q = parseAlertsQuery(sp);
  const [{ rows, counts, types }, watchlist, followUps] = await Promise.all([
    fetchAlerts(q),
    fetchWatchlist(session.sub),
    fetchOpenFollowUps(),
  ]);

  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { type: q.type, severity: q.severity, show: q.showResolved ? "all" : undefined, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return `/alerts${s ? `?${s}` : ""}`;
  };

  return (
    <div className="p-4 lg:p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <h1 className="text-lg font-semibold tracking-tight">Alerts</h1>
        <p className="text-xs text-muted">who to call today</p>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <KpiCard title="Open" value={num(counts.total)} />
        <KpiCard title="Critical" value={num(counts.critical)} tone={counts.critical ? "negative" : "neutral"} />
        <KpiCard title="Warning" value={num(counts.warning)} />
        <KpiCard title="Info" value={num(counts.info)} />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-1.5 text-[12px]">
        <Chip href={qs({ severity: undefined })} active={!q.severity}>All severities</Chip>
        {["critical", "warning", "info"].map((s) => (
          <Chip key={s} href={qs({ severity: s })} active={q.severity === s}>
            {s}
          </Chip>
        ))}
        <span className="mx-1 text-rule-2">·</span>
        <Chip href={qs({ type: undefined })} active={!q.type}>All types</Chip>
        {types.map((t) => (
          <Chip key={t} href={qs({ type: t })} active={q.type === t}>
            {TYPE_LABEL[t] ?? t}
          </Chip>
        ))}
        <span className="mx-1 text-rule-2">·</span>
        <Chip href={qs({ show: q.showResolved ? undefined : "all" })} active={q.showResolved}>
          show acknowledged
        </Chip>
      </div>

      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[820px] text-[13px]">
          <thead>
            <tr className="border-b border-rule-2 text-left text-[11px] uppercase tracking-[0.08em] text-muted">
              <th className="px-3 py-1.5 font-medium">Severity</th>
              <th className="px-3 py-1.5 font-medium">Type</th>
              <th className="px-3 py-1.5 font-medium">What</th>
              <th className="px-3 py-1.5 font-medium">Age</th>
              <th className="px-3 py-1.5 font-medium text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-10 text-center text-muted">
                  Nothing here. {q.showResolved ? "" : "Every alert is acknowledged."}
                </td>
              </tr>
            ) : (
              rows.map((a) => {
                const ack = !!a.acknowledgedAt;
                const snoozed = a.snoozedUntil && new Date(a.snoozedUntil) > new Date();
                return (
                  <tr
                    key={a._id}
                    className={cn(
                      "border-b border-rule last:border-0",
                      (ack || snoozed) && "opacity-55",
                    )}
                  >
                    <td className="px-3 py-1.5">
                      <span className={cn("rounded px-1.5 py-0.5 text-[11px]", SEV_STYLE[a.severity])}>
                        {a.severity}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-ink-2">{TYPE_LABEL[a.type] ?? a.type}</td>
                    <td className="px-3 py-1.5">
                      {a.clientId != null ? (
                        <Link href={`/clients/${a.clientId}`} className="text-ink hover:text-accent">
                          {a.title}
                        </Link>
                      ) : (
                        <span className="text-ink">{a.title}</span>
                      )}
                      {snoozed ? (
                        <span className="ml-2 text-[11px] text-muted">
                          snoozed → {dateShort(a.snoozedUntil)}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-1.5 tabular-nums text-ink-2">{relativeDays(a.createdAt)}</td>
                    <td className="px-3 py-1.5">
                      <div className="flex justify-end gap-1.5">
                        {ack ? (
                          <form action={unacknowledgeAlert.bind(null, a._id)}>
                            <button className="rounded border border-rule-2 px-2 py-0.5 text-[12px] text-ink-2 hover:text-ink">
                              Reopen
                            </button>
                          </form>
                        ) : (
                          <>
                            <form action={snoozeAlert.bind(null, a._id, 7)}>
                              <button className="rounded border border-rule-2 px-2 py-0.5 text-[12px] text-ink-2 hover:text-ink">
                                Snooze 7d
                              </button>
                            </form>
                            <form action={acknowledgeAlert.bind(null, a._id)}>
                              <button className="rounded bg-accent-solid px-2 py-0.5 text-[12px] font-medium text-white hover:brightness-105">
                                Ack
                              </button>
                            </form>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </Card>

      <h2 className="mb-2 mt-6 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
        Open follow-ups ({followUps.length})
      </h2>
      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[640px] text-[13px]">
          <tbody>
            {followUps.length === 0 ? (
              <tr>
                <td className="px-3 py-6 text-center text-muted">
                  No open follow-ups. Add one from a client profile.
                </td>
              </tr>
            ) : (
              followUps.map((f) => {
                const overdue = f.dueAt && new Date(f.dueAt) < new Date();
                return (
                  <tr key={f._id} className="border-b border-rule last:border-0">
                    <td className="w-8 px-3 py-1.5">
                      <form action={toggleNoteDone.bind(null, f._id)}>
                        <button
                          className="grid h-4 w-4 place-items-center rounded border border-rule-2 text-[10px] hover:border-ok"
                          title="Mark done"
                        />
                      </form>
                    </td>
                    <td className={cn("w-24 px-3 py-1.5 tabular-nums", overdue ? "text-err" : "text-ink-2")}>
                      {dateShort(f.dueAt)}
                    </td>
                    <td className="px-3 py-1.5">
                      <Link href={`/clients/${f.clientId}`} className="text-accent hover:underline">
                        {f.clientName}
                      </Link>
                      <span className="ml-2 text-ink-2">{f.body}</span>
                    </td>
                    <td className="w-24 px-3 py-1.5 text-right text-[11px] text-muted">{f.authorName}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </Card>

      <h2 className="mb-2 mt-6 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
        My watchlist ({watchlist.length})
      </h2>
      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[820px] text-[13px]">
          <thead>
            <tr className="border-b border-rule-2 text-left text-[11px] uppercase tracking-[0.08em] text-muted">
              <th className="px-3 py-1.5 font-medium">Client</th>
              <th className="px-3 py-1.5 font-medium">Code</th>
              <th className="px-3 py-1.5 font-medium text-right">Net dep.</th>
              <th className="px-3 py-1.5 font-medium text-right">Balance</th>
              <th className="px-3 py-1.5 font-medium text-right">Trades</th>
              <th className="px-3 py-1.5 font-medium text-right">Net PnL</th>
              <th className="px-3 py-1.5 font-medium text-right">Last trade</th>
              <th className="px-3 py-1.5 font-medium text-right">Comm.</th>
            </tr>
          </thead>
          <tbody>
            {watchlist.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-muted">
                  Star a client from their profile to watch them here.
                </td>
              </tr>
            ) : (
              watchlist.map((c) => (
                <tr key={c._id} className="border-b border-rule last:border-0 hover:bg-sunken">
                  <td className="px-3 py-1.5">
                    <Link href={`/clients/${c._id}`} className="text-ink hover:text-accent">
                      {c.name || `#${c._id}`}
                    </Link>
                  </td>
                  <td className="px-3 py-1.5 font-mono text-[12px] text-ink-2">{c.referralCode ?? "—"}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{usd(c.fundingNetDeposit)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{usd(c.accountsBalance)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{num(c.tradingTrades)}</td>
                  <td
                    className={cn(
                      "px-3 py-1.5 text-right tabular-nums",
                      c.tradingNetProfit < 0 ? "text-err" : c.tradingNetProfit > 0 ? "text-ok" : "text-ink-2",
                    )}
                  >
                    {usd(c.tradingNetProfit)}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-ink-2">
                    {c.tradingLastTradeAt ? relativeDays(c.tradingLastTradeAt) : "—"}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{usd(c.commissionEarned)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function Chip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "rounded-full border px-2 py-0.5",
        active
          ? "border-accent bg-accent-bg text-accent"
          : "border-rule-2 text-ink-2 hover:text-ink",
      )}
    >
      {children}
    </Link>
  );
}
