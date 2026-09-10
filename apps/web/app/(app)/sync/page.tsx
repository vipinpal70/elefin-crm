import {
  connect,
  SyncRun,
  SyncRequest,
  SyncState,
  Client,
  Trade,
  FundingEvent,
  SYNC_JOBS,
} from "@elefin/db";
import { getSession } from "@/lib/auth";
import { requestSync } from "@/lib/actions/sync";
import { fetchCredentialStatus } from "@/lib/settings-data";
import { Card } from "@/components/ui/card";
import { dateTimeShort, relativeDays, num } from "@/lib/format";
import { cn } from "@/lib/cn";

export const dynamic = "force-dynamic";

async function load(isOwner: boolean) {
  await connect();
  const [runs, requests, txnState, counts, cred] = await Promise.all([
    SyncRun.find({}).sort({ startedAt: -1 }).limit(25).lean(),
    SyncRequest.find({}).sort({ createdAt: -1 }).limit(10).lean(),
    SyncState.findById("transactions").lean(),
    Promise.all([
      Client.estimatedDocumentCount(),
      Trade.estimatedDocumentCount(),
      FundingEvent.estimatedDocumentCount(),
    ]),
    isOwner ? fetchCredentialStatus() : Promise.resolve(null),
  ]);
  return {
    runs,
    requests,
    txnCursor: txnState?.cursor ? new Date(txnState.cursor).toISOString() : null,
    counts: { clients: counts[0], trades: counts[1], funding: counts[2] },
    cred,
  };
}

export default async function SyncStatusPage() {
  const session = await getSession();
  const isOwner = session?.role === "owner";
  const { runs, requests, txnCursor, counts, cred } = await load(isOwner);

  const newestRun = runs[0];
  const stale =
    newestRun?.startedAt &&
    Date.now() - new Date(newestRun.startedAt).getTime() > 2 * 3_600_000;

  return (
    <div className="p-4 lg:p-5">
      <h1 className="mb-1 text-lg font-semibold tracking-tight">Sync status</h1>
      <p className="mb-4 text-sm text-ink-2">Worker health, data freshness and manual triggers.</p>

      {stale && (
        <Card className="mb-3 border-err/30 bg-err-bg">
          <p className="text-[13px] text-err">
            Last sync ran {relativeDays(newestRun!.startedAt)} — the worker may be down.
          </p>
        </Card>
      )}

      <div className="mb-3 grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHead>Data</CardHead>
          <dl className="grid grid-cols-[10rem_1fr] gap-y-1 text-[13px]">
            <dt className="text-muted">Clients (local)</dt>
            <dd className="tabular-nums">{num(counts.clients)}</dd>
            <dt className="text-muted">Clients (API)</dt>
            <dd className="tabular-nums">
              {cred?.ok ? num(cred.totalClients ?? 0) : "—"}
              {cred?.ok && cred.totalClients != null && cred.totalClients !== counts.clients ? (
                <span className="ml-2 text-err">Δ {cred.totalClients - counts.clients}</span>
              ) : null}
            </dd>
            <dt className="text-muted">Trades</dt>
            <dd className="tabular-nums">{num(counts.trades)}</dd>
            <dt className="text-muted">Funding events</dt>
            <dd className="tabular-nums">{num(counts.funding)}</dd>
            <dt className="text-muted">Txn cursor</dt>
            <dd className="tabular-nums text-ink-2">{dateTimeShort(txnCursor)}</dd>
          </dl>
        </Card>

        <Card>
          <CardHead>Credential</CardHead>
          {isOwner ? (
            cred?.ok ? (
              <dl className="grid grid-cols-[7rem_1fr] gap-y-1 text-[13px]">
                <dt className="text-muted">Status</dt>
                <dd className="text-ok">connected</dd>
                <dt className="text-muted">Partner</dt>
                <dd>{cred.partner}</dd>
                <dt className="text-muted">Abilities</dt>
                <dd>{cred.allGranted ? "all" : (cred.abilities ?? []).join(", ")}</dd>
                <dt className="text-muted">Expires</dt>
                <dd>{cred.expiresAt ?? "never"}</dd>
              </dl>
            ) : (
              <p className="text-[13px] text-err">API unreachable: {cred?.error}</p>
            )
          ) : (
            <p className="text-[13px] text-muted">Owner only.</p>
          )}
        </Card>
      </div>

      {isOwner && (
        <Card className="mb-3">
          <CardHead>Run a job now</CardHead>
          <div className="flex flex-wrap gap-1.5">
            {SYNC_JOBS.map((job) => (
              <form key={job} action={requestSync.bind(null, job)}>
                <button className="rounded-md border border-rule-2 px-2 py-1 text-[12px] text-ink-2 hover:border-accent hover:text-accent">
                  {job}
                </button>
              </form>
            ))}
          </div>
          {requests.length > 0 && (
            <table className="mt-3 w-full text-[12px]">
              <tbody>
                {requests.map((r) => (
                  <tr key={String(r._id)} className="border-t border-rule first:border-0">
                    <td className="py-1 pr-3 font-mono">{r.job}</td>
                    <td
                      className={cn(
                        "py-1 pr-3",
                        r.status === "failed" && "text-err",
                        r.status === "done" && "text-ok",
                      )}
                    >
                      {r.status}
                    </td>
                    <td className="py-1 pr-3 tabular-nums text-muted">
                      {dateTimeShort(r.createdAt)}
                    </td>
                    <td className="py-1 text-muted">
                      {r.error ??
                        (r.result
                          ? `${(r.result as { durationMs?: number }).durationMs != null ? ((r.result as { durationMs: number }).durationMs / 1000).toFixed(1) + "s" : ""}`
                          : "")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      <Card className="overflow-x-auto p-0">
        <div className="border-b border-rule px-4 py-2 text-[11px] font-medium uppercase tracking-[0.12em] text-muted">
          Run history
        </div>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-rule-2 text-left text-[11px] uppercase tracking-[0.1em] text-muted">
              <th className="px-3 py-1.5 font-medium">Job</th>
              <th className="px-3 py-1.5 font-medium">Status</th>
              <th className="px-3 py-1.5 font-medium">Started</th>
              <th className="px-3 py-1.5 font-medium">Duration</th>
              <th className="px-3 py-1.5 font-medium text-right">API calls</th>
              <th className="px-3 py-1.5 font-medium text-right">Docs</th>
              <th className="px-3 py-1.5 font-medium">Error</th>
            </tr>
          </thead>
          <tbody>
            {runs.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-muted">
                  No sync runs yet. Start the worker: <code>npm run dev:worker</code>
                </td>
              </tr>
            ) : (
              runs.map((r) => (
                <tr key={String(r._id)} className="border-b border-rule last:border-0">
                  <td className="px-3 py-1.5 font-mono text-[13px]">{r.job}</td>
                  <td
                    className={cn(
                      "px-3 py-1.5",
                      r.status === "failed" && "text-err",
                      r.status === "ok" && "text-ok",
                    )}
                  >
                    {r.status}
                  </td>
                  <td className="px-3 py-1.5 tabular-nums">{dateTimeShort(r.startedAt)}</td>
                  <td className="px-3 py-1.5 tabular-nums">
                    {r.durationMs != null ? `${(r.durationMs / 1000).toFixed(1)}s` : "—"}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{r.apiCalls}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{r.docsUpserted}</td>
                  <td className="px-3 py-1.5 text-err">{r.error ?? ""}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
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
