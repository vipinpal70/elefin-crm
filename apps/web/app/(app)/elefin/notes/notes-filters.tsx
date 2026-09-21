import Link from "next/link";
import { withNotesParams, type NotesQuery } from "@/lib/notes-data";

export function NotesFilters({ q, total }: { q: NotesQuery; total: number }) {
  return (
    <form
      method="GET"
      action="/elefin/notes"
      className="mb-3 flex flex-wrap items-end gap-2 rounded-xl border border-rule bg-raised p-3 text-[13px] shadow-card"
    >
      <Field label="Search">
        <input
          type="search"
          name="q"
          defaultValue={q.q ?? ""}
          placeholder="note text, client name/id"
          className="h-8 w-60 rounded-md border border-rule-2 bg-raised px-2 text-ink placeholder:text-muted"
        />
      </Field>
      <Field label="Status">
        <select
          name="status"
          defaultValue={q.status}
          className="h-8 rounded-md border border-rule-2 bg-raised px-2 text-ink"
        >
          <option value="open">Open</option>
          <option value="done">Done</option>
          <option value="all">All</option>
        </select>
      </Field>
      <label className="flex items-center gap-1.5 pb-1.5 text-[12px] text-ink-2">
        <input type="checkbox" name="overdue" value="1" defaultChecked={!!q.overdue} className="h-3.5 w-3.5 accent-err" />
        Overdue only
      </label>

      <button type="submit" className="h-8 rounded-md bg-accent-solid px-3 font-medium text-white hover:brightness-105">
        Apply
      </button>
      <Link href="/elefin/notes" className="h-8 rounded-md border border-rule-2 px-3 leading-8 text-ink-2 hover:text-ink">
        Reset
      </Link>

      <span className="ml-auto self-center text-xs text-muted">
        {total.toLocaleString()} note{total === 1 ? "" : "s"} ·{" "}
        <a className="text-accent hover:underline" href={`/api/notes/export${withNotesParams(q, {})}`}>
          Export CSV
        </a>
      </span>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-[0.1em] text-muted">{label}</span>
      {children}
    </label>
  );
}
