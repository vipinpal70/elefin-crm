import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { fetchImportRun } from "@/lib/imports-data";
import { Card, CardTitle, CardValue } from "@/components/ui/card";
import { dateTimeShort } from "@/lib/format";
import { CommitForm } from "./commit-form";

export const dynamic = "force-dynamic";

export default async function ImportRunPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("owner");
  const { id } = await params;
  const run = await fetchImportRun(id);
  if (!run) notFound();

  return (
    <div className="mx-auto max-w-6xl p-4 lg:p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <Link href="/imports" className="text-[12px] text-muted hover:text-ink-2">
            ← Imports
          </Link>
          <h1 className="mt-1 text-lg font-semibold tracking-tight">{run.fileName}</h1>
          <p className="text-[12px] text-muted">
            {run.createdAt ? dateTimeShort(run.createdAt) : "—"} · {run.status}
            {run.committedAt ? ` · committed ${dateTimeShort(run.committedAt)}` : ""}
          </p>
        </div>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2.5 sm:grid-cols-5">
        <Card>
          <CardTitle>Rows</CardTitle>
          <CardValue>{run.totalRows}</CardValue>
        </Card>
        <Card>
          <CardTitle>Suggested links</CardTitle>
          <CardValue className="text-accent">{run.linkedCount}</CardValue>
        </Card>
        <Card>
          <CardTitle>Created</CardTitle>
          <CardValue className="text-ok">{run.createdCount}</CardValue>
        </Card>
        <Card>
          <CardTitle>Updated</CardTitle>
          <CardValue className="text-chart-4">{run.updatedCount}</CardValue>
        </Card>
        <Card>
          <CardTitle>Flagged</CardTitle>
          <CardValue className={run.flaggedCount ? "text-err" : undefined}>{run.flaggedCount}</CardValue>
        </Card>
      </div>

      <Card>
        <CardTitle>Rows</CardTitle>
        <div className="mt-2">
          {run.status === "preview" ? (
            <>
              <p className="mb-3 text-[12px] text-muted">
                Committing doesn&apos;t touch any Elefin client or the XM book yet — every
                included row lands in{" "}
                <Link href="/tc/clients" className="text-tc-accent hover:underline">
                  TC
                </Link>{" "}
                for confirmation first.
              </p>
              <CommitForm importRunId={run._id} rows={run.rows} />
            </>
          ) : (
            <p className="text-[13px] text-ink-2">
              This import was already {run.status} — {run.linkedCount} suggested-linked,{" "}
              {run.createdCount} created, {run.updatedCount} updated into{" "}
              <Link href="/tc/clients" className="text-tc-accent hover:underline">
                TC
              </Link>
              {run.skippedCount ? `, ${run.skippedCount} skipped` : ""}.
            </p>
          )}
        </div>
      </Card>
    </div>
  );
}
