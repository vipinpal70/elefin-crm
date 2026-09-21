import Link from "next/link";
import { fetchNotesList, parseNotesQuery, withNotesParams, type NotesQuery, type NotesSortKey, type SP } from "@/lib/notes-data";
import { toggleNoteDone, deleteNote } from "@/lib/actions/notes";
import { Card, CardTitle } from "@/components/ui/card";
import { AddNoteForm } from "./add-note-form";
import { NotesFilters } from "./notes-filters";
import { dateShort, dateTimeShort } from "@/lib/format";
import { cn } from "@/lib/cn";

export const dynamic = "force-dynamic";

export default async function NotesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const q = parseNotesQuery(sp);
  const { rows, total } = await fetchNotesList(q);

  return (
    <div className="p-4 lg:p-5">
      <h1 className="mb-1 text-lg font-semibold tracking-tight">Notes &amp; follow-ups</h1>
      <p className="mb-4 text-[13px] text-ink-2">
        Every note across every client in one place — log one here without opening their profile.
      </p>

      <Card className="mb-3">
        <CardTitle>Add a note</CardTitle>
        <div className="mt-2">
          <AddNoteForm />
        </div>
      </Card>

      <NotesFilters q={q} total={total} />

      <div className="overflow-x-auto rounded-xl border border-rule bg-raised shadow-card">
        <table className="w-full min-w-[880px] text-[13px]">
          <thead>
            <tr className="border-b border-rule-2 text-left text-[11px] uppercase tracking-[0.08em] text-muted">
              <SortTh q={q} col="client" label="Client" />
              <th className="px-3 py-1.5 font-medium">Note</th>
              <SortTh q={q} col="due" label="Follow up" />
              <SortTh q={q} col="status" label="Status" />
              <SortTh q={q} col="author" label="Author" />
              <SortTh q={q} col="created" label="Created" />
              <th className="px-3 py-1.5 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center text-muted">
                  Nothing here for these filters.
                </td>
              </tr>
            ) : (
              rows.map((n) => {
                const overdue = !n.doneAt && n.dueAt && new Date(n.dueAt) < new Date();
                return (
                  <tr key={n._id} className={cn("border-b border-rule last:border-0 hover:bg-sunken", overdue && "bg-err-bg/30")}>
                    <td className="px-3 py-1.5">
                      <Link href={`/elefin/clients/${n.clientId}`} className="text-ink hover:text-accent">
                        {n.clientName}
                      </Link>
                    </td>
                    <td className="max-w-md px-3 py-1.5 text-ink-2">{n.body}</td>
                    <td className={cn("px-3 py-1.5 tabular-nums", overdue ? "text-err" : "text-ink-2")}>
                      {n.dueAt ? dateShort(n.dueAt) : "—"}
                    </td>
                    <td className="px-3 py-1.5">
                      {n.doneAt ? (
                        <span className="text-ok">done</span>
                      ) : overdue ? (
                        <span className="font-medium text-err">overdue</span>
                      ) : n.dueAt ? (
                        <span className="text-accent">open</span>
                      ) : (
                        <span className="text-muted">note</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-ink-2">{n.authorName}</td>
                    <td className="px-3 py-1.5 tabular-nums text-muted">{dateTimeShort(n.createdAt)}</td>
                    <td className="px-3 py-1.5">
                      <div className="flex justify-end gap-1.5">
                        <form action={toggleNoteDone.bind(null, n._id)}>
                          <button className="rounded border border-rule-2 px-2 py-0.5 text-[12px] text-ink-2 hover:text-ink">
                            {n.doneAt ? "Reopen" : "Done"}
                          </button>
                        </form>
                        <form action={deleteNote.bind(null, n._id)}>
                          <button className="rounded border border-rule-2 px-2 py-0.5 text-[12px] text-err hover:brightness-90">
                            Delete
                          </button>
                        </form>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SortTh({ q, col, label }: { q: NotesQuery; col: NotesSortKey; label: string }) {
  const active = q.sort === col;
  const nextDir = active && q.dir === "asc" ? "desc" : "asc";
  const arrow = active ? (q.dir === "desc" ? " ↓" : " ↑") : "";
  return (
    <th className="px-3 py-1.5 font-medium">
      <Link
        href={`/elefin/notes${withNotesParams(q, { sort: col, dir: nextDir })}`}
        className={cn("hover:text-ink", active && "text-ink")}
      >
        {label}
        {arrow}
      </Link>
    </th>
  );
}
