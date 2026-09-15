import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { fetchImportRuns } from "@/lib/imports-data";
import { fetchTagCatalogue } from "@/lib/tags-data";
import { RosterUploadForm, XmTradesUploadForm } from "./import-forms";
import { Card, CardTitle } from "@/components/ui/card";
import { dateTimeShort } from "@/lib/format";
import { cn } from "@/lib/cn";

export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<string, string> = {
  preview: "text-accent",
  committed: "text-ok",
  failed: "text-err",
};

export default async function ImportsPage() {
  await requireRole("owner");
  const [runs, tagCatalogue] = await Promise.all([fetchImportRuns(), fetchTagCatalogue()]);

  return (
    <div className="mx-auto max-w-4xl p-4 lg:p-5">
      <h1 className="mb-4 text-lg font-semibold tracking-tight">Imports</h1>

      <Card>
        <CardTitle>Elefin roster (.xlsx / .csv)</CardTitle>
        <p className="mb-3 mt-1 text-[12px] text-muted">
          Rows are matched against existing clients by MT5 login, then email —
          but even a confident match only lands in{" "}
          <Link href="/tc/clients" className="text-tc-accent hover:underline">
            TC
          </Link>{" "}
          for you to confirm, never applied automatically.
        </p>
        <RosterUploadForm tagCatalogue={tagCatalogue} />
      </Card>

      <Card className="mt-3">
        <CardTitle>XM trade-history export (.csv)</CardTitle>
        <p className="mb-3 mt-1 text-[12px] text-muted">
          Trade-level data with no identity ambiguity — this saves immediately,
          upserted by ticket id.
        </p>
        <XmTradesUploadForm />
      </Card>

      <Card className="mt-3">
        <CardTitle>History</CardTitle>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[640px] text-[13px]">
            <thead>
              <tr className="border-b border-rule-2 text-left text-[11px] uppercase tracking-[0.08em] text-muted">
                <th className="py-1.5 pr-3 font-medium">When</th>
                <th className="py-1.5 pr-3 font-medium">File</th>
                <th className="py-1.5 pr-3 font-medium">Kind</th>
                <th className="py-1.5 pr-3 font-medium">Status</th>
                <th className="py-1.5 pr-3 font-medium text-right">Rows</th>
                <th className="py-1.5 pr-3 font-medium text-right">Linked</th>
                <th className="py-1.5 pr-3 font-medium text-right">Created</th>
                <th className="py-1.5 pr-3 font-medium text-right">Updated</th>
                <th className="py-1.5 font-medium text-right">Skipped</th>
              </tr>
            </thead>
            <tbody>
              {runs.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-4 text-center text-muted">
                    No imports yet.
                  </td>
                </tr>
              ) : (
                runs.map((r) => (
                  <tr key={r._id} className="border-b border-rule last:border-0">
                    <td className="py-1.5 pr-3 tabular-nums text-muted">
                      {r.createdAt ? dateTimeShort(r.createdAt) : "—"}
                    </td>
                    <td className="py-1.5 pr-3 text-ink-2">
                      {r.kind === "roster" && r.status === "preview" ? (
                        <Link href={`/imports/${r._id}`} className="text-accent hover:underline">
                          {r.fileName}
                        </Link>
                      ) : (
                        r.fileName
                      )}
                    </td>
                    <td className="py-1.5 pr-3">{r.kind === "roster" ? "Roster" : "XM trades"}</td>
                    <td className={cn("py-1.5 pr-3", STATUS_STYLE[r.status])}>{r.status}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{r.totalRows}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-ink-2">{r.linkedCount}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-ink-2">{r.createdCount}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-ink-2">{r.updatedCount}</td>
                    <td className="py-1.5 text-right tabular-nums text-muted">{r.skippedCount ?? 0}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
