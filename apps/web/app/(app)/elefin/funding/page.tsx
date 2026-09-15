import Link from "next/link";
import {
  fetchFunding,
  fundingQs,
  parseFundingQuery,
  type FundingQuery,
} from "@/lib/funding-data";
import type { SP } from "@/lib/clients-query";
import { getSession } from "@/lib/auth";
import { fetchViews } from "@/lib/views-data";
import { DateRangeFields } from "@/components/ui/date-range-fields";
import { SavedViews } from "@/components/saved-views";
import { KpiCard } from "@/components/kpi-card";
import { usd, num, dateShort, compactUsd } from "@/lib/format";
import { cn } from "@/lib/cn";

export const dynamic = "force-dynamic";

export default async function FundingPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const sp = await searchParams;
  const q = parseFundingQuery(sp);
  const session = await getSession();
  const [{ rows, total, totals, statuses, methods }, views] = await Promise.all([
    fetchFunding(q),
    session ? fetchViews(session.sub, "funding") : Promise.resolve([]),
  ]);

  const pages = Math.max(1, Math.ceil(total / q.perPage));
  const from = total === 0 ? 0 : (q.page - 1) * q.perPage + 1;
  const to = Math.min(q.page * q.perPage, total);

  return (
    <div className="p-4 lg:p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <h1 className="text-lg font-semibold tracking-tight">Funding</h1>
        <p className="text-xs text-muted">deposit &amp; withdrawal ledger · book-wide</p>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <KpiCard title="Deposits" value={compactUsd(totals.deposits)} sub={`${num(totals.depositCount)} txns`} tone="positive" />
        <KpiCard title="Withdrawals" value={compactUsd(totals.withdrawals)} sub={`${num(totals.withdrawalCount)} txns`} />
        <KpiCard title="Net" value={compactUsd(totals.net)} tone={totals.net < 0 ? "negative" : "positive"} />
        <KpiCard title="Transactions" value={num(total)} />
        <KpiCard
          title="Avg deposit"
          value={usd(totals.depositCount ? totals.deposits / totals.depositCount : 0)}
        />
      </div>

      <div className="-mx-4 mb-3 border-y border-rule lg:-mx-5">
        <SavedViews page="funding" views={views} />
      </div>

      <form
        method="GET"
        action="/elefin/funding"
        className="mb-3 flex flex-wrap items-end gap-2 rounded-xl border border-rule bg-raised p-3 text-[13px] shadow-card"
      >
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-[0.1em] text-muted">Search</span>
          <input
            type="search"
            name="q"
            defaultValue={q.q ?? ""}
            placeholder="txn id, login, client id"
            className="h-8 w-52 rounded-md border border-rule-2 bg-raised px-2 text-ink placeholder:text-muted"
          />
        </label>
        <Sel name="type" value={q.type ?? ""} label="Type" opts={[["", "All"], ["deposit", "Deposits"], ["withdrawal", "Withdrawals"]]} />
        <Sel name="status" value={q.status ?? ""} label="Status" opts={[["", "Any"], ...statuses.map((s) => [s, s] as const)]} />
        <Sel name="method" value={q.method ?? ""} label="Method" opts={[["", "Any"], ...methods.map((m) => [m, m] as const)]} />
        <DateRangeFields from={q.from} to={q.to} />
        <button type="submit" className="h-8 rounded-md bg-accent-solid px-3 font-medium text-white hover:brightness-105">
          Apply
        </button>
        <Link href="/elefin/funding" className="h-8 rounded-md border border-rule-2 px-3 leading-8 text-ink-2 hover:text-ink">
          Reset
        </Link>
        <a
          href={`/api/funding/export${fundingQs(q)}`}
          className="ml-auto self-center text-xs text-accent hover:underline"
        >
          Export CSV
        </a>
      </form>

      <div className="overflow-x-auto rounded-xl border border-rule bg-raised shadow-card">
        <table className="w-full min-w-[880px] text-[13px]">
          <thead>
            <tr className="border-b border-rule-2 text-left text-[11px] uppercase tracking-[0.08em] text-muted">
              <th className="px-3 py-1.5 font-medium">Date</th>
              <th className="px-3 py-1.5 font-medium">Client</th>
              <th className="px-3 py-1.5 font-medium">Login</th>
              <th className="px-3 py-1.5 font-medium">Type</th>
              <th className="px-3 py-1.5 font-medium">Status</th>
              <th className="px-3 py-1.5 font-medium">Method</th>
              <th className="px-3 py-1.5 font-medium text-right">Amount</th>
              <th className="px-3 py-1.5 font-medium text-right">Paid</th>
              <th className="px-3 py-1.5 font-medium">Txn</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-10 text-center text-muted">
                  No transactions match these filters.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r._id} className="border-b border-rule last:border-0 hover:bg-sunken">
                  <td className="px-3 py-1.5 tabular-nums text-ink-2">{dateShort(r.occurredAt)}</td>
                  <td className="px-3 py-1.5">
                    {r.clientId != null ? (
                      <Link href={`/elefin/clients/${r.clientId}`} className="text-ink hover:text-accent">
                        {r.clientName || `#${r.clientId}`}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-1.5 font-mono text-[12px] text-ink-2">{r.login ?? "—"}</td>
                  <td className="px-3 py-1.5">
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[11px]",
                        r.type === "deposit" ? "bg-ok-bg text-ok" : "bg-sunken text-ink-2",
                      )}
                    >
                      {r.type}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-ink-2">{r.status}</td>
                  <td className="px-3 py-1.5 text-ink-2">{r.paymentMethod ?? "—"}</td>
                  <td
                    className={cn(
                      "px-3 py-2 text-right font-medium tabular-nums",
                      r.type === "withdrawal" && "text-err",
                    )}
                  >
                    {r.type === "withdrawal" ? "−" : ""}
                    {usd(r.amount)}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-ink-2">
                    {r.paidCurrency && r.paidAmount != null
                      ? `${num(r.paidAmount)} ${r.paidCurrency}`
                      : "—"}
                  </td>
                  <td className="px-3 py-1.5 font-mono text-[11px] text-muted">{r._id}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between px-1 py-3 text-[13px] text-ink-2">
        <span>
          {from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()}
        </span>
        <span className="flex items-center gap-1">
          <PageLink q={q} page={q.page - 1} disabled={q.page <= 1}>
            ‹ Prev
          </PageLink>
          <span className="px-2 tabular-nums">
            {q.page} / {pages}
          </span>
          <PageLink q={q} page={q.page + 1} disabled={q.page >= pages}>
            Next ›
          </PageLink>
        </span>
      </div>
    </div>
  );
}

function Sel({
  name,
  label,
  value,
  opts,
}: {
  name: string;
  label: string;
  value: string;
  opts: ReadonlyArray<readonly [string, string]>;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-[0.1em] text-muted">{label}</span>
      <select
        name={name}
        defaultValue={value}
        className="h-8 rounded-md border border-rule-2 bg-raised px-2 text-ink"
      >
        {opts.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

function PageLink({
  q,
  page,
  disabled,
  children,
}: {
  q: FundingQuery;
  page: number;
  disabled: boolean;
  children: React.ReactNode;
}) {
  if (disabled)
    return <span className="rounded-md px-2 py-1 text-muted opacity-50">{children}</span>;
  return (
    <Link
      href={`/elefin/funding${fundingQs({ ...q, page })}`}
      className="rounded-md border border-rule-2 px-2 py-1 hover:border-accent hover:text-accent"
    >
      {children}
    </Link>
  );
}
