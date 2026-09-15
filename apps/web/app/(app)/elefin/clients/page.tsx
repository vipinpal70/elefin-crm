import Link from "next/link";
import { fetchClients, type ClientRow } from "@/lib/clients-data";
import {
  parseClientsQuery,
  withParams,
  type ClientsQuery,
  type SortKey,
  type SP,
} from "@/lib/clients-query";
import { getSession } from "@/lib/auth";
import { fetchViews } from "@/lib/views-data";
import { fetchTagCatalogue } from "@/lib/tags-data";
import { ClientsFilters } from "./clients-filters";
import { SavedViews } from "@/components/saved-views";
import { usd, num, num2, dateShort, relativeDays } from "@/lib/format";
import { cn } from "@/lib/cn";

export const dynamic = "force-dynamic";

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const sp = await searchParams;
  const q = parseClientsQuery(sp);
  const session = await getSession();
  const [{ rows, total, codes, countries }, views, tagCatalogue] = await Promise.all([
    fetchClients(q),
    session ? fetchViews(session.sub, "clients") : Promise.resolve([]),
    fetchTagCatalogue(),
  ]);

  const pages = Math.max(1, Math.ceil(total / q.perPage));
  const from = total === 0 ? 0 : (q.page - 1) * q.perPage + 1;
  const to = Math.min(q.page * q.perPage, total);

  return (
    <div>
      <div className="flex items-baseline justify-between px-4 pt-4">
        <h1 className="text-lg font-semibold tracking-tight">Clients</h1>
        <p className="text-xs text-muted">the referral book</p>
      </div>

      <SavedViews page="clients" views={views} />
      <ClientsFilters q={q} codes={codes} countries={countries} tagCatalogue={tagCatalogue} total={total} />

      <div className="overflow-x-auto">
        <table className="w-full min-w-[1100px] text-[13px]">
          <thead>
            <tr className="border-b border-rule-2 text-left text-[11px] uppercase tracking-[0.08em] text-muted">
              <Th>Client</Th>
              <Th>Country</Th>
              <Th>Code</Th>
              <Th>Tags</Th>
              <Th className="text-center">Funded</Th>
              <SortTh q={q} col="registered" label="Registered" />
              <SortTh q={q} col="deposits" label="Deposits" align="right" />
              <SortTh q={q} col="net" label="Net dep." align="right" />
              <SortTh q={q} col="lots" label="Lots" align="right" />
              <SortTh q={q} col="trades" label="Trades" align="right" />
              <SortTh q={q} col="pnl" label="Net PnL" align="right" />
              <SortTh q={q} col="lasttrade" label="Last trade" align="right" />
              <SortTh q={q} col="commission" label="Comm." align="right" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={13} className="px-3 py-10 text-center text-muted">
                  No clients match these filters.
                </td>
              </tr>
            ) : (
              rows.map((r) => <Row key={r._id} r={r} />)
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between px-4 py-3 text-[13px] text-ink-2">
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

function Th({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <th className={cn("whitespace-nowrap px-3 py-1.5 font-medium", className)}>{children}</th>;
}

function SortTh({
  q,
  col,
  label,
  align = "left",
}: {
  q: ClientsQuery;
  col: SortKey;
  label: string;
  align?: "left" | "right";
}) {
  const active = q.sort === col;
  const nextDir = active && q.dir === "desc" ? "asc" : "desc";
  const arrow = active ? (q.dir === "desc" ? " ↓" : " ↑") : "";
  return (
    <th
      className={cn(
        "whitespace-nowrap px-3 py-1.5 font-medium",
        align === "right" && "text-right",
      )}
    >
      <Link
        href={`/elefin/clients${withParams(q, { sort: col, dir: nextDir })}`}
        className={cn("hover:text-ink", active && "text-ink")}
      >
        {label}
        {arrow}
      </Link>
    </th>
  );
}

function Row({ r }: { r: ClientRow }) {
  return (
    <tr className="border-b border-rule hover:bg-sunken">
      <td className="px-3 py-1.5">
        <Link href={`/elefin/clients/${r._id}`} className="font-medium text-ink hover:text-accent">
          {r.name || `#${r._id}`}
        </Link>
        <span className="ml-2 text-[11px] text-muted">#{r._id}</span>
        {r.partnerStatus === "departed" ? (
          <span
            className="ml-1.5 rounded-full bg-err-bg px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-err"
            title={r.departedAt ? `Left your referral code ${relativeDays(r.departedAt)}` : "No longer under your referral code"}
          >
            Left
          </span>
        ) : null}
        {r.openNotes > 0 ? (
          <span
            className="ml-1.5 rounded-full bg-accent-bg px-1.5 text-[10px] font-medium text-accent"
            title={`${r.openNotes} open note${r.openNotes > 1 ? "s" : ""}`}
          >
            {r.openNotes}
          </span>
        ) : null}
      </td>
      <td className="px-3 py-1.5 text-ink-2">{r.country}</td>
      <td className="px-3 py-1.5 font-mono text-[12px] text-ink-2">{r.referralCode ?? "—"}</td>
      <td className="px-3 py-1.5">
        <div className="flex flex-wrap gap-1">
          {r.tags.map((t) => (
            <span key={t} className="rounded-full border border-rule-2 px-1.5 py-0.5 text-[10.5px] text-ink-2">
              {t}
            </span>
          ))}
        </div>
      </td>
      <td className="px-3 py-1.5 text-center">{r.fundingIsFunded ? "✅" : "—"}</td>
      <td className="px-3 py-1.5 text-right tabular-nums text-ink-2">{dateShort(r.registeredAt)}</td>
      <td className="px-3 py-1.5 text-right tabular-nums">{usd(r.fundingDeposits)}</td>
      <td className="px-3 py-1.5 text-right tabular-nums">{usd(r.fundingNetDeposit)}</td>
      <td className="px-3 py-1.5 text-right tabular-nums">{num2(r.tradingLots)}</td>
      <td className="px-3 py-1.5 text-right tabular-nums">{num(r.tradingTrades)}</td>
      <td
        className={cn(
          "px-3 py-2 text-right tabular-nums",
          r.tradingNetProfit < 0 ? "text-err" : r.tradingNetProfit > 0 ? "text-ok" : "text-ink-2",
        )}
      >
        {usd(r.tradingNetProfit)}
      </td>
      <td className="px-3 py-1.5 text-right tabular-nums text-ink-2">
        {r.tradingLastTradeAt ? relativeDays(r.tradingLastTradeAt) : "—"}
      </td>
      <td className="px-3 py-1.5 text-right tabular-nums">{usd(r.commissionEarned)}</td>
    </tr>
  );
}

function PageLink({
  q,
  page,
  disabled,
  children,
}: {
  q: ClientsQuery;
  page: number;
  disabled: boolean;
  children: React.ReactNode;
}) {
  if (disabled) {
    return <span className="rounded-md px-2 py-1 text-muted opacity-50">{children}</span>;
  }
  return (
    <Link
      href={`/elefin/clients${withParams(q, { page })}`}
      className="rounded-md border border-rule-2 px-2 py-1 hover:border-accent hover:text-accent"
    >
      {children}
    </Link>
  );
}
