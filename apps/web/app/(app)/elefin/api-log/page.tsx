import Link from "next/link";
import { fetchApiLog, parseApiLogQuery, apiLogQs, type ApiLogQuery } from "@/lib/api-log-data";
import type { SP } from "@/lib/clients-query";
import { DateRangeFields } from "@/components/ui/date-range-fields";
import { Card } from "@/components/ui/card";
import { dateTimeShort } from "@/lib/format";
import { cn } from "@/lib/cn";

export const dynamic = "force-dynamic";

const JOBS = [
  "me",
  "clients",
  "accounts",
  "transactions",
  "trades",
  "positions",
] as const;

export default async function ApiLogPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const sp = await searchParams;
  const q = parseApiLogQuery(sp);
  const { rows, total } = await fetchApiLog(q);

  const pages = Math.max(1, Math.ceil(total / q.perPage));
  const from = total === 0 ? 0 : (q.page - 1) * q.perPage + 1;
  const to = Math.min(q.page * q.perPage, total);

  return (
    <div className="p-4 lg:p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <h1 className="text-lg font-semibold tracking-tight">API log</h1>
        <p className="text-xs text-muted">
          every Elefin API response the worker has seen, newest first · auto-expires after 14 days
        </p>
      </div>

      <form
        method="GET"
        action="/elefin/api-log"
        className="mb-3 flex flex-wrap items-end gap-2 rounded-xl border border-rule bg-raised p-3 text-[13px] shadow-card"
      >
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-[0.1em] text-muted">Client</span>
          <input
            type="search"
            name="q"
            defaultValue={q.q ?? ""}
            placeholder="client id, email, or name"
            className="h-8 w-56 rounded-md border border-rule-2 bg-raised px-2 text-ink placeholder:text-muted"
          />
        </label>
        <Sel
          name="job"
          label="Job"
          value={q.job ?? ""}
          opts={[["", "All"], ...JOBS.map((j) => [j, j] as const)]}
        />
        <Sel
          name="ok"
          label="Status"
          value={q.ok ?? ""}
          opts={[["", "All"], ["ok", "OK"], ["error", "Error"]]}
        />
        <DateRangeFields from={q.from} to={q.to} />
        <button type="submit" className="h-8 rounded-md bg-accent-solid px-3 font-medium text-white hover:brightness-105">
          Apply
        </button>
        <Link href="/elefin/api-log" className="h-8 rounded-md border border-rule-2 px-3 leading-8 text-ink-2 hover:text-ink">
          Reset
        </Link>
      </form>

      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[1040px] text-[13px]">
          <thead>
            <tr className="border-b border-rule-2 text-left text-[11px] uppercase tracking-[0.08em] text-muted">
              <th className="px-3 py-1.5 font-medium">Time</th>
              <th className="px-3 py-1.5 font-medium">Job</th>
              <th className="px-3 py-1.5 font-medium">Endpoint</th>
              <th className="px-3 py-1.5 font-medium">Client</th>
              <th className="px-3 py-1.5 font-medium">Login</th>
              <th className="px-3 py-1.5 font-medium">Status</th>
              <th className="px-3 py-1.5 font-medium text-right">Rate left</th>
              <th className="px-3 py-1.5 font-medium text-right">Duration</th>
              <th className="px-3 py-1.5 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-10 text-center text-muted">
                  No API calls match these filters yet — they show up here as soon as a
                  worker job runs.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r._id} className="border-b border-rule last:border-0 hover:bg-sunken">
                  <td className="px-3 py-1.5 whitespace-nowrap tabular-nums text-ink-2">
                    {dateTimeShort(r.requestedAt)}
                  </td>
                  <td className="px-3 py-1.5">
                    <span className="rounded bg-sunken px-1.5 py-0.5 text-[11px] text-ink-2">
                      {r.job}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 font-mono text-[12px] text-ink-2">
                    {r.endpoint}
                    {r.params && Object.keys(r.params).length > 0 ? (
                      <span className="text-muted"> {JSON.stringify(r.params)}</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-1.5">
                    {r.clientId != null ? (
                      <Link href={`/elefin/clients/${r.clientId}`} className="text-ink hover:text-accent">
                        {r.clientName || `#${r.clientId}`}
                      </Link>
                    ) : r.email ? (
                      <span className="text-ink-2">{r.email}</span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-1.5">
                    {r.login ? (
                      <Link
                        href={`/elefin/accounts/${r.login}/history`}
                        className="font-mono text-[12px] text-accent hover:underline"
                      >
                        {r.login}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-1.5">
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[11px]",
                        r.ok ? "bg-ok-bg text-ok" : "bg-err-bg text-err",
                      )}
                      title={r.errorMessage ?? undefined}
                    >
                      {r.ok ? "ok" : r.errorCode ?? "error"} {r.httpStatus ?? ""}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-ink-2">
                    {r.rateLimitRemaining ?? "—"}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-ink-2">
                    {r.durationMs != null ? `${r.durationMs}ms` : "—"}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <Link href={`/elefin/api-log/${r._id}`} className="text-[12px] text-accent hover:underline">
                      view
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>

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
  q: ApiLogQuery;
  page: number;
  disabled: boolean;
  children: React.ReactNode;
}) {
  if (disabled)
    return <span className="rounded-md px-2 py-1 text-muted opacity-50">{children}</span>;
  return (
    <Link
      href={`/elefin/api-log${apiLogQs({ ...q, page })}`}
      className="rounded-md border border-rule-2 px-2 py-1 hover:border-accent hover:text-accent"
    >
      {children}
    </Link>
  );
}
