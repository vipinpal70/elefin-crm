import Link from "next/link";
import type { TcQuery } from "@/lib/tc-data";

const BROKERS = [
  ["", "Any"],
  ["elefin", "Elefin"],
  ["xm", "XM"],
  ["other", "Other"],
  ["unknown", "Unknown"],
] as const;

export function TcFilters({
  q,
  tagCatalogue,
  total,
}: {
  q: TcQuery;
  tagCatalogue: string[];
  total: number;
}) {
  return (
    <form
      method="GET"
      action="/tc/clients"
      className="mb-3 flex flex-wrap items-end gap-2 rounded-xl border border-rule bg-raised p-3 text-[13px] shadow-card"
    >
      <Field label="Search">
        <input
          type="search"
          name="q"
          defaultValue={q.q ?? ""}
          placeholder="name, email, login"
          className="h-8 w-56 rounded-md border border-rule-2 bg-raised px-2 text-ink placeholder:text-muted"
        />
      </Field>
      <Field label="Detected broker">
        <Select name="broker" value={q.broker ?? ""} options={BROKERS} />
      </Field>
      <Field label="Tag">
        <Select
          name="tag"
          value={q.tag ?? ""}
          options={[["", "Any"], ...tagCatalogue.map((t) => [t, t] as const)]}
        />
      </Field>
      <label className="flex items-center gap-1.5 pb-1.5 text-[12px] text-ink-2">
        <input
          type="checkbox"
          name="flagged"
          value="1"
          defaultChecked={!!q.flagged}
          className="h-3.5 w-3.5 accent-tc-accent"
        />
        Flagged only
      </label>

      <button
        type="submit"
        className="h-8 rounded-md bg-accent-solid px-3 font-medium text-white hover:brightness-105"
      >
        Apply
      </button>
      <Link
        href="/tc/clients"
        className="h-8 rounded-md border border-rule-2 px-3 leading-8 text-ink-2 hover:text-ink"
      >
        Reset
      </Link>

      <span className="ml-auto self-center text-xs text-muted">
        {total.toLocaleString()} match{total === 1 ? "" : "es"}
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

function Select({
  name,
  value,
  options,
}: {
  name: string;
  value: string;
  options: ReadonlyArray<readonly [string, string]>;
}) {
  return (
    <select
      name={name}
      defaultValue={value}
      className="h-8 rounded-md border border-rule-2 bg-raised px-2 text-ink"
    >
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
}
