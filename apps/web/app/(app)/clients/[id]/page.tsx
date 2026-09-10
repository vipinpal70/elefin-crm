import Link from "next/link";
import { notFound } from "next/navigation";
import { connect, Client, Account, Trade, FundingEvent, Position } from "@elefin/db";
import { tradingStats } from "@elefin/domain";
import { plain } from "@/lib/serialize";
import { getSession } from "@/lib/auth";
import { isWatched } from "@/lib/watchlist";
import { fetchClientNotes } from "@/lib/notes-data";
import { toggleNoteDone, deleteNote } from "@/lib/actions/notes";
import { KpiCard } from "@/components/kpi-card";
import { Card } from "@/components/ui/card";
import { WatchButton } from "@/components/watch-button";
import { NoteForm } from "@/components/note-form";
import { DailyPnlChart } from "@/components/charts/daily-pnl";
import { EquityCurve } from "@/components/charts/equity-curve";
import { usd, num, num2, dateShort, dateTimeShort, relativeDays } from "@/lib/format";
import { cn } from "@/lib/cn";

export const dynamic = "force-dynamic";

interface ClientDoc {
  _id: number;
  name: string;
  email: string | null;
  emailMasked: boolean;
  phone: string | null;
  country: string;
  status: string;
  referralCode: string | null;
  registeredAt: string | null;
  referredAt: string | null;
  fundingCurrency: string;
  fundingDeposits: number;
  fundingWithdrawals: number;
  fundingNetDeposit: number;
  fundingDepositCount: number;
  fundingFirstDepositAt: string | null;
  fundingLastDepositAt: string | null;
  fundingIsFunded: boolean;
  accountsCount: number;
  accountsBalance: number;
  accountsEquity: number;
  accountsCredit: number;
  tradingLots: number;
  tradingTrades: number;
  tradingNetProfit: number;
  tradingLastTradeAt: string | null;
  commissionEarned: number;
  lastSyncedAt: string | null;
}

interface AccountDoc {
  _id: string;
  accountType: string | null;
  platformGroup: string | null;
  currency: string;
  openedAt: string | null;
  balance: number;
  equity: number;
  credit: number;
  leverage: number | null;
  tradingEnabled: boolean;
  totalDeposit: number;
  totalWithdrawal: number;
  netDeposit: number;
  lots: number;
  trades: number;
  netProfit: number;
  lastTradeAt: string | null;
  commission: number;
}

interface FundingRow {
  _id: string;
  login: string | null;
  type: string;
  status: string;
  amount: number;
  fee: number;
  paymentMethod: string | null;
  paidCurrency: string | null;
  paidAmount: number | null;
  occurredAt: string | null;
}

async function load(id: number) {
  await connect();
  const [client, accounts, tradesRaw, fundingRaw, positionsRaw] = await Promise.all([
    Client.findById(id).lean(),
    Account.find({ clientId: id }).sort({ lots: -1 }).lean(),
    Trade.find({ clientId: id }, {
      symbol: 1,
      side: 1,
      volumeLots: 1,
      netPnl: 1,
      openAt: 1,
      closeAt: 1,
    })
      .sort({ closeAt: 1 })
      .limit(5000)
      .lean(),
    FundingEvent.find({ clientId: id }).sort({ occurredAt: -1 }).limit(50).lean(),
    Position.find({ clientId: id }).lean(),
  ]);
  if (!client) return null;

  const trades = tradesRaw.map((t) => plain<Record<string, unknown>>(t));
  return {
    client: plain<ClientDoc>(client),
    accounts: accounts.map((a) => plain<AccountDoc>(a)),
    stats: tradingStats(trades as never),
    funding: fundingRaw.map((f) => plain<FundingRow>(f)),
    positions: positionsRaw.map((p) => plain<Record<string, unknown>>(p)),
  };
}

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const numId = Number(id);
  if (!Number.isInteger(numId)) notFound();

  const [data, session, notes] = await Promise.all([
    load(numId),
    getSession(),
    fetchClientNotes(numId),
  ]);
  if (!data) notFound();
  const { client: c, accounts, stats, funding, positions } = data;
  const openAsOf = (positions[0]?.asOf as string | null) ?? null;
  const watched = session ? await isWatched(session.sub, numId) : false;

  return (
    <div className="p-4 lg:p-5">
      <div className="mb-4">
        <Link href="/clients" className="text-[13px] text-accent hover:underline">
          ‹ Clients
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="text-lg font-semibold tracking-tight">
            {c.name || `Client #${c._id}`}
          </h1>
          <span className="text-sm text-muted">#{c._id}</span>
          <Badge>{c.status}</Badge>
          <span className="font-mono text-[12px] text-ink-2">{c.referralCode ?? "no code"}</span>
          <span className="text-[13px] text-ink-2">{c.country}</span>
          <span className="ml-auto">
            <WatchButton clientId={numId} initial={watched} />
          </span>
        </div>
        <p className="mt-1 text-[13px] text-ink-2">
          {c.email ?? "—"}
          {c.emailMasked ? (
            <span className="ml-2 rounded border border-rule-2 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted">
              PII not granted
            </span>
          ) : null}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <KpiCard title="Net deposit" value={usd(c.fundingNetDeposit)} />
        <KpiCard title="Balance" value={usd(c.accountsBalance)} />
        <KpiCard title="Equity" value={usd(c.accountsEquity)} />
        <KpiCard title="Lots" value={num2(c.tradingLots)} />
        <KpiCard
          title="Net PnL"
          value={usd(c.tradingNetProfit)}
          tone={c.tradingNetProfit < 0 ? "negative" : c.tradingNetProfit > 0 ? "positive" : "neutral"}
        />
        <KpiCard title="Commission" value={usd(c.commissionEarned)} tone="positive" />
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHead>Overview</CardHead>
          <dl className="grid grid-cols-[10rem_1fr] gap-y-1.5 text-[13px]">
            <Dt>Registered</Dt>
            <Dd>{dateShort(c.registeredAt)}</Dd>
            <Dt>Referred</Dt>
            <Dd>{dateShort(c.referredAt)}</Dd>
            <Dt>Accounts</Dt>
            <Dd>{num(c.accountsCount)}</Dd>
            <Dt>Trades</Dt>
            <Dd>{num(c.tradingTrades)}</Dd>
            <Dt>Last trade</Dt>
            <Dd>
              {c.tradingLastTradeAt
                ? `${dateShort(c.tradingLastTradeAt)} (${relativeDays(c.tradingLastTradeAt)})`
                : "never"}
            </Dd>
            <Dt>Data as of</Dt>
            <Dd>{dateTimeShort(c.lastSyncedAt)}</Dd>
          </dl>
        </Card>

        <Card>
          <CardHead>Funding</CardHead>
          <dl className="grid grid-cols-[10rem_1fr] gap-y-1.5 text-[13px]">
            <Dt>Funded</Dt>
            <Dd>{c.fundingIsFunded ? "yes" : "no"}</Dd>
            <Dt>Deposits</Dt>
            <Dd>
              {usd(c.fundingDeposits)}{" "}
              <span className="text-muted">({num(c.fundingDepositCount)})</span>
            </Dd>
            <Dt>Withdrawals</Dt>
            <Dd>{usd(c.fundingWithdrawals)}</Dd>
            <Dt>Net deposit</Dt>
            <Dd>{usd(c.fundingNetDeposit)}</Dd>
            <Dt>First deposit</Dt>
            <Dd>{dateShort(c.fundingFirstDepositAt)}</Dd>
            <Dt>Last deposit</Dt>
            <Dd>{dateShort(c.fundingLastDepositAt)}</Dd>
          </dl>
        </Card>
      </div>

      <Card className="mt-3">
        <CardHead>Notes &amp; follow-ups ({notes.length})</CardHead>
        {notes.length === 0 ? (
          <p className="text-[13px] text-muted">No notes yet.</p>
        ) : (
          <ul className="space-y-2">
            {notes.map((n) => {
              const overdue = n.dueAt && !n.doneAt && new Date(n.dueAt) < new Date();
              return (
                <li
                  key={n._id}
                  className={cn(
                    "flex gap-2 rounded-md border border-rule px-2.5 py-1.5 text-[13px]",
                    n.doneAt && "opacity-55",
                  )}
                >
                  <form action={toggleNoteDone.bind(null, n._id)} className="pt-0.5">
                    <button
                      className={cn(
                        "grid h-4 w-4 place-items-center rounded border text-[10px]",
                        n.doneAt ? "border-ok bg-ok text-white" : "border-rule-2",
                      )}
                      title={n.doneAt ? "Reopen" : "Mark done"}
                    >
                      {n.doneAt ? "✓" : ""}
                    </button>
                  </form>
                  <div className="min-w-0 flex-1">
                    <p className={cn("whitespace-pre-wrap text-ink", n.doneAt && "line-through")}>
                      {n.body}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted">
                      {n.authorName} · {dateShort(n.createdAt)}
                      {n.dueAt ? (
                        <span className={cn("ml-2", overdue ? "text-err" : "text-accent")}>
                          {n.doneAt ? "was due" : "due"} {dateShort(n.dueAt)}
                        </span>
                      ) : null}
                    </p>
                  </div>
                  <form action={deleteNote.bind(null, n._id)}>
                    <button className="text-[12px] text-muted hover:text-err" title="Delete">
                      ✕
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
        )}
        <NoteForm clientId={numId} />
      </Card>

      <div className="mt-4">
        <h2 className="mb-2 text-sm font-semibold">Accounts ({accounts.length})</h2>
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[900px] text-[13px]">
            <thead>
              <tr className="border-b border-rule-2 text-left text-[11px] uppercase tracking-[0.08em] text-muted">
                <th className="px-3 py-1.5 font-medium">Login</th>
                <th className="px-3 py-1.5 font-medium">Type</th>
                <th className="px-3 py-1.5 font-medium text-right">Leverage</th>
                <th className="px-3 py-1.5 font-medium text-right">Balance</th>
                <th className="px-3 py-1.5 font-medium text-right">Equity</th>
                <th className="px-3 py-1.5 font-medium text-right">Net dep.</th>
                <th className="px-3 py-1.5 font-medium text-right">Lots</th>
                <th className="px-3 py-1.5 font-medium text-right">Trades</th>
                <th className="px-3 py-1.5 font-medium text-right">Net PnL</th>
                <th className="px-3 py-1.5 font-medium text-right">Comm.</th>
                <th className="px-3 py-1.5 font-medium text-right">Last trade</th>
              </tr>
            </thead>
            <tbody>
              {accounts.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-3 py-6 text-center text-muted">
                    No account detail yet — run <code>npm run job --workspace @elefin/worker -- accounts</code>
                  </td>
                </tr>
              ) : (
                accounts.map((a) => (
                  <tr key={a._id} className="border-b border-rule last:border-0 hover:bg-sunken">
                    <td className="px-3 py-1.5">
                      <Link
                        href={`/accounts/${a._id}/history`}
                        className="font-mono text-[12px] text-accent hover:underline"
                      >
                        {a._id}
                      </Link>
                    </td>
                    <td className="px-3 py-1.5 text-ink-2">{a.accountType ?? "—"}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {a.leverage ? `1:${a.leverage}` : "—"}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{usd(a.balance)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{usd(a.equity)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{usd(a.netDeposit)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{num2(a.lots)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{num(a.trades)}</td>
                    <td
                      className={cn(
                        "px-3 py-2 text-right tabular-nums",
                        a.netProfit < 0 ? "text-err" : a.netProfit > 0 ? "text-ok" : "text-ink-2",
                      )}
                    >
                      {usd(a.netProfit)}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{usd(a.commission)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-ink-2">
                      {a.lastTradeAt ? relativeDays(a.lastTradeAt) : "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </Card>
      </div>

      {stats.trades > 0 && (
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <Card>
            <CardHead>Daily PnL</CardHead>
            <div className="mt-2">
              <DailyPnlChart data={stats.dailyPnl} />
            </div>
          </Card>
          <Card>
            <CardHead>Cumulative PnL</CardHead>
            <div className="mt-2">
              <EquityCurve data={stats.equityCurve} />
            </div>
          </Card>
        </div>
      )}

      {positions.length > 0 && (
        <Card className="mt-3">
          <div className="mb-2 flex items-center gap-2">
            <CardHead>Open positions ({positions.length})</CardHead>
            <span className="text-[11px] text-muted">
              as of {openAsOf ? dateTimeShort(openAsOf) : "unknown"}
            </span>
          </div>
          <table className="w-full text-[13px]">
            <tbody>
              {positions.map((p) => (
                <tr key={String(p._id)} className="border-t border-rule first:border-0">
                  <td className="py-1.5 pr-3">{String(p.symbol ?? "")}</td>
                  <td className="py-1.5 pr-3 uppercase text-ink-2">{String(p.side ?? "")}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{num2(p.volumeLots as number)} lots</td>
                  <td
                    className={cn(
                      "py-1.5 text-right tabular-nums",
                      (p.unrealizedPnl as number) < 0 ? "text-err" : "text-ok",
                    )}
                  >
                    {usd(p.unrealizedPnl as number)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Card className="mt-3 overflow-x-auto p-0">
        <div className="border-b border-rule px-4 py-2 text-[11px] font-medium uppercase tracking-[0.12em] text-muted">
          Funding history ({funding.length}
          {funding.length === 50 ? "+" : ""})
        </div>
        <table className="w-full min-w-[720px] text-[13px]">
          <thead>
            <tr className="border-b border-rule-2 text-left text-[11px] uppercase tracking-[0.08em] text-muted">
              <th className="px-3 py-1.5 font-medium">Date</th>
              <th className="px-3 py-1.5 font-medium">Type</th>
              <th className="px-3 py-1.5 font-medium">Status</th>
              <th className="px-3 py-1.5 font-medium">Method</th>
              <th className="px-3 py-1.5 font-medium">Login</th>
              <th className="px-3 py-1.5 font-medium text-right">Amount</th>
              <th className="px-3 py-1.5 font-medium text-right">Paid</th>
            </tr>
          </thead>
          <tbody>
            {funding.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-muted">
                  No transactions found for this client.
                </td>
              </tr>
            ) : (
              funding.map((f) => (
                <tr key={f._id} className="border-b border-rule last:border-0">
                  <td className="px-3 py-1.5 tabular-nums text-ink-2">{dateShort(f.occurredAt)}</td>
                  <td className="px-3 py-1.5">
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[11px]",
                        f.type === "deposit" ? "bg-ok-bg text-ok" : "bg-sunken text-ink-2",
                      )}
                    >
                      {f.type}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-ink-2">{f.status}</td>
                  <td className="px-3 py-1.5 text-ink-2">{f.paymentMethod ?? "—"}</td>
                  <td className="px-3 py-1.5 font-mono text-[12px] text-ink-2">{f.login ?? "—"}</td>
                  <td
                    className={cn(
                      "px-3 py-2 text-right font-medium tabular-nums",
                      f.type === "withdrawal" && "text-err",
                    )}
                  >
                    {f.type === "withdrawal" ? "−" : ""}
                    {usd(f.amount)}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-ink-2">
                    {f.paidCurrency && f.paidAmount != null
                      ? `${num(f.paidAmount)} ${f.paidCurrency}`
                      : "—"}
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

const CardHead = ({ children }: { children: React.ReactNode }) => (
  <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-muted">{children}</p>
);
const Dt = ({ children }: { children: React.ReactNode }) => (
  <dt className="text-muted">{children}</dt>
);
const Dd = ({ children }: { children: React.ReactNode }) => (
  <dd className="text-ink">{children}</dd>
);
const Badge = ({ children }: { children: React.ReactNode }) => (
  <span className="rounded-full border border-rule-2 px-2 py-0.5 text-[11px] uppercase tracking-wide text-ink-2">
    {children}
  </span>
);
