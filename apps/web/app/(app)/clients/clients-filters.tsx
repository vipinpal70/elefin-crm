import Link from "next/link";
import type { ClientsQuery } from "@/lib/clients-query";

const ACTIVITY = [
  ["", "Any activity"],
  ["traded", "Has traded"],
  ["never", "Never traded"],
  ["dormant30", "Dormant 30d+"],
  ["dormant60", "Dormant 60d+"],
  ["dormant90", "Dormant 90d+"],
] as const;

export function ClientsFilters({
  q,
  codes,
  countries,
  total,
}: {
  q: ClientsQuery;
  codes: string[];
  countries: string[];
  total: number;
}) {
  return (
    <form
      method="GET"
      action="/clients"
      className="flex flex-wrap items-end gap-2 border-b border-rule bg-raised px-4 py-3 text-[13px]"
    >
      <Field label="Search">
        <input
          type="search"
          name="q"
          defaultValue={q.q ?? ""}
          placeholder="name, email, id, login"
          className="h-8 w-56 rounded-md border border-rule-2 bg-raised px-2 text-ink placeholder:text-muted"
        />
      </Field>

      <Field label="Code">
        <Select name="code" value={q.code ?? ""} options={[["", "All"], ...codes.map((c) => [c, c] as const)]} />
      </Field>
      <Field label="Status">
        <Select
          name="status"
          value={q.status ?? ""}
          options={[["", "Any"], ["active", "Active"], ["suspended", "Suspended"], ["inactive", "Inactive"]]}
        />
      </Field>
      <Field label="Funded">
        <Select
          name="funded"
          value={q.funded ?? ""}
          options={[["", "Any"], ["yes", "Funded"], ["no", "Not funded"]]}
        />
      </Field>
      <Field label="Activity">
        <Select name="activity" value={q.activity ?? ""} options={ACTIVITY} />
      </Field>
      <Field label="Country">
        <Select
          name="country"
          value={q.country ?? ""}
          options={[["", "Any"], ...countries.map((c) => [c, c] as const)]}
        />
      </Field>
      <Field label="Partner status">
        <Select
          name="partnerStatus"
          value={q.partnerStatus}
          options={[
            ["with_us", "With us"],
            ["departed", "Departed"],
            ["all", "All"],
          ]}
        />
      </Field>

      {q.sort !== "registered" ? <input type="hidden" name="sort" value={q.sort} /> : null}
      {q.dir !== "desc" ? <input type="hidden" name="dir" value={q.dir} /> : null}

      <button
        type="submit"
        className="h-8 rounded-md bg-accent-solid px-3 font-medium text-white hover:brightness-105"
      >
        Apply
      </button>
      <Link
        href="/clients"
        className="h-8 rounded-md border border-rule-2 px-3 leading-8 text-ink-2 hover:text-ink"
      >
        Reset
      </Link>

      <span className="ml-auto self-center text-xs text-muted">
        {total.toLocaleString()} match{total === 1 ? "" : "es"} ·{" "}
        <a className="text-accent hover:underline" href={`/api/clients/export${exportQs(q)}`}>
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

function exportQs(q: ClientsQuery): string {
  const p = new URLSearchParams();
  if (q.q) p.set("q", q.q);
  if (q.code) p.set("code", q.code);
  if (q.status) p.set("status", q.status);
  if (q.funded) p.set("funded", q.funded);
  if (q.activity) p.set("activity", q.activity);
  if (q.country) p.set("country", q.country);
  if (q.partnerStatus !== "with_us") p.set("partnerStatus", q.partnerStatus);
  if (q.sort !== "registered") p.set("sort", q.sort);
  if (q.dir !== "desc") p.set("dir", q.dir);
  const s = p.toString();
  return s ? `?${s}` : "";
}
