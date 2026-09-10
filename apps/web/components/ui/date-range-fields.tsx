export function DateRangeFields({
  from,
  to,
}: {
  from?: string;
  to?: string;
}) {
  return (
    <>
      <label className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-[0.1em] text-muted">From</span>
        <input
          type="date"
          name="from"
          defaultValue={from ?? ""}
          className="h-8 rounded-md border border-rule-2 bg-raised px-2 text-ink"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-[0.1em] text-muted">To</span>
        <input
          type="date"
          name="to"
          defaultValue={to ?? ""}
          className="h-8 rounded-md border border-rule-2 bg-raised px-2 text-ink"
        />
      </label>
    </>
  );
}
