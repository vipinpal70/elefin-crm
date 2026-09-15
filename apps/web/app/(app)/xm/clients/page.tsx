import Link from "next/link";
import { fetchXmClients, parseXmClientsQuery, withXmParams, type XmClientsQuery } from "@/lib/xm-data";
import { fetchTagCatalogue } from "@/lib/tags-data";
import { num, num2, usd } from "@/lib/format";
import { cn } from "@/lib/cn";

export const dynamic = "force-dynamic";

export default async function XmClientsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const q = parseXmClientsQuery(sp);
  const [{ rows, total }, tagCatalogue] = await Promise.all([fetchXmClients(q), fetchTagCatalogue()]);
  const lastPage = Math.max(1, Math.ceil(total / q.perPage));

  return (
    <div className="p-4 lg:p-5">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold tracking-tight">XM clients</h1>
        <span className="rounded-full border border-xm-accent/30 bg-xm-accent-bg px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.08em] text-xm-accent">
          XM
        </span>
      </div>

      <form
        method="GET"
        action="/xm/clients"
        className="mb-3 flex flex-wrap items-end gap-2 rounded-xl border border-rule bg-raised p-3 text-[13px] shadow-card"
      >
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-[0.1em] text-muted">Search</span>
          <input
            type="search"
            name="q"
            defaultValue={q.q ?? ""}
            placeholder="name, email, login"
            className="h-8 w-56 rounded-md border border-rule-2 bg-raised px-2 text-ink placeholder:text-muted"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-[0.1em] text-muted">Tag</span>
          <select
            name="tag"
            defaultValue={q.tag ?? ""}
            className="h-8 rounded-md border border-rule-2 bg-raised px-2 text-ink"
          >
            <option value="">All</option>
            {tagCatalogue.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="h-8 rounded-md bg-accent-solid px-3 font-medium text-white hover:brightness-105">
          Apply
        </button>
        <Link href="/xm/clients" className="h-8 rounded-md border border-rule-2 px-3 leading-8 text-ink-2 hover:text-ink">
          Reset
        </Link>
        <span className="ml-auto self-center text-xs text-muted">
          {total.toLocaleString()} match{total === 1 ? "" : "es"}
        </span>
      </form>

      <div className="overflow-x-auto rounded-xl border border-rule bg-raised shadow-card">
        <table className="w-full min-w-[840px] text-[13px]">
          <thead>
            <tr className="border-b border-rule-2 text-left text-[11px] uppercase tracking-[0.08em] text-muted">
              <th className="px-3 py-1.5 font-medium">Name</th>
              <th className="px-3 py-1.5 font-medium">Email</th>
              <th className="px-3 py-1.5 font-medium">MT5 login</th>
              <th className="px-3 py-1.5 font-medium text-right">Trades</th>
              <th className="px-3 py-1.5 font-medium text-right">Lots</th>
              <th className="px-3 py-1.5 font-medium text-right">Commission</th>
              <th className="px-3 py-1.5 font-medium">Tags</th>
              <th className="px-3 py-1.5 font-medium">Elefin</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-10 text-center text-muted">
                  No XM traders match these filters yet.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r._id} className={cn("border-b border-rule last:border-0 hover:bg-sunken", r.needsReview && "bg-err-bg/30")}>
                  <td className="px-3 py-1.5">
                    <Link href={`/xm/clients/${r._id}`} className="font-medium text-ink hover:text-accent">
                      {r.name || "—"}
                    </Link>
                  </td>
                  <td className="px-3 py-1.5 text-ink-2">{r.email || "—"}</td>
                  <td className="px-3 py-1.5 font-mono text-[12px] text-ink-2">{r.mt5Login || "—"}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{num(r.trades)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{num2(r.lots)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{usd(r.commission)}</td>
                  <td className="px-3 py-1.5">
                    <div className="flex flex-wrap gap-1">
                      {r.tags.map((t) => (
                        <span key={t} className="rounded-full border border-rule-2 px-1.5 py-0.5 text-[10.5px] text-ink-2">
                          {t}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-1.5">
                    {r.linkedClientId != null ? (
                      <Link href={`/elefin/clients/${r.linkedClientId}`} className="text-[12px] text-accent hover:underline">
                        #{r.linkedClientId}
                      </Link>
                    ) : (
                      <span className="text-[12px] text-muted">unlinked</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-2.5 flex items-center justify-between text-[12px] text-muted">
        <span>
          Page {q.page} of {lastPage}
        </span>
        <div className="flex items-center gap-1">
          <PageLink q={q} page={q.page - 1} disabled={q.page <= 1}>
            ‹ Prev
          </PageLink>
          <PageLink q={q} page={q.page + 1} disabled={q.page >= lastPage}>
            Next ›
          </PageLink>
        </div>
      </div>
    </div>
  );
}

function PageLink({
  q,
  page,
  disabled,
  children,
}: {
  q: XmClientsQuery;
  page: number;
  disabled: boolean;
  children: React.ReactNode;
}) {
  if (disabled) {
    return <span className="rounded-md px-2 py-1 text-muted opacity-50">{children}</span>;
  }
  return (
    <Link
      href={`/xm/clients${withXmParams(q, { page })}`}
      className="rounded-md border border-rule-2 px-2 py-1 hover:border-accent hover:text-accent"
    >
      {children}
    </Link>
  );
}
