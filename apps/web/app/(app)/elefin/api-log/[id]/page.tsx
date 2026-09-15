import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchApiLogEntry } from "@/lib/api-log-data";
import { Card } from "@/components/ui/card";
import { dateTimeShort } from "@/lib/format";
import { cn } from "@/lib/cn";

export const dynamic = "force-dynamic";

export default async function ApiLogEntryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const r = await fetchApiLogEntry(id);
  if (!r) notFound();

  return (
    <div className="p-4 lg:p-5">
      <Link href="/elefin/api-log" className="text-[13px] text-accent hover:underline">
        ‹ API log
      </Link>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
        <h1 className="text-lg font-semibold tracking-tight">
          {r.job} · {r.endpoint}
        </h1>
        <span
          className={cn(
            "rounded px-1.5 py-0.5 text-[11px]",
            r.ok ? "bg-ok-bg text-ok" : "bg-err-bg text-err",
          )}
        >
          {r.ok ? "ok" : r.errorCode ?? "error"} {r.httpStatus ?? ""}
        </span>
      </div>
      <p className="mt-1 text-[13px] text-ink-2">{dateTimeShort(r.requestedAt)}</p>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHead>Call</CardHead>
          <dl className="grid grid-cols-[9rem_1fr] gap-y-1.5 text-[13px]">
            <Dt>Job</Dt>
            <Dd>{r.job}</Dd>
            <Dt>Endpoint</Dt>
            <Dd className="font-mono text-[12px]">{r.endpoint}</Dd>
            <Dt>Params</Dt>
            <Dd className="font-mono text-[12px]">
              {r.params ? JSON.stringify(r.params) : "—"}
            </Dd>
            <Dt>Duration</Dt>
            <Dd>{r.durationMs != null ? `${r.durationMs}ms` : "—"}</Dd>
            <Dt>Rate limit left</Dt>
            <Dd>{r.rateLimitRemaining ?? "—"}</Dd>
          </dl>
        </Card>

        <Card>
          <CardHead>Context</CardHead>
          <dl className="grid grid-cols-[9rem_1fr] gap-y-1.5 text-[13px]">
            <Dt>Client</Dt>
            <Dd>
              {r.clientId != null ? (
                <Link href={`/elefin/clients/${r.clientId}`} className="text-accent hover:underline">
                  {r.clientName || `#${r.clientId}`}
                </Link>
              ) : (
                "—"
              )}
            </Dd>
            <Dt>Login</Dt>
            <Dd>
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
            </Dd>
            <Dt>Email</Dt>
            <Dd>{r.email ?? "—"}</Dd>
            {!r.ok && (
              <>
                <Dt>Error</Dt>
                <Dd className="text-err">
                  {r.errorCode ?? "?"}: {r.errorMessage ?? "—"}
                </Dd>
              </>
            )}
          </dl>
        </Card>
      </div>

      <Card className="mt-3 p-0">
        <div className="flex items-center justify-between border-b border-rule px-4 py-2">
          <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted">
            Response body
          </span>
          {r.bodyTruncated && (
            <span className="text-[11px] text-muted">
              truncated — stored as a preview{r.bodyRowCount != null ? ` (${r.bodyRowCount} rows total)` : ""}
            </span>
          )}
        </div>
        <pre className="max-h-[70vh] overflow-auto p-4 text-[12px] leading-relaxed text-ink-2">
          {r.body != null ? JSON.stringify(r.body, null, 2) : "(no body — call failed before a response was parsed)"}
        </pre>
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
const Dt = ({ children }: { children: React.ReactNode }) => (
  <dt className="text-muted">{children}</dt>
);
const Dd = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <dd className={cn("text-ink", className)}>{children}</dd>
);
