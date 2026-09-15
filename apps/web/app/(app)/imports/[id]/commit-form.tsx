"use client";

import { useActionState, useRef } from "react";
import { commitImport, type ImportFormState } from "@/lib/actions/imports";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { PreviewRow } from "@/lib/imports-data";

const init: ImportFormState = {};

const ACTION_STYLE: Record<PreviewRow["action"], string> = {
  link: "text-accent",
  update: "text-chart-4",
  create: "text-ok",
};

export function CommitForm({ importRunId, rows }: { importRunId: string; rows: PreviewRow[] }) {
  const [state, action, pending] = useActionState(commitImport, init);
  const formRef = useRef<HTMLFormElement>(null);

  const setAll = (checked: boolean) => {
    formRef.current
      ?.querySelectorAll<HTMLInputElement>('input[name="include"]')
      .forEach((el) => (el.checked = checked));
  };

  return (
    <form ref={formRef} action={action}>
      <input type="hidden" name="importRunId" value={importRunId} />

      <div className="mb-2 flex flex-wrap items-center gap-3 text-[12px]">
        <button type="button" onClick={() => setAll(true)} className="text-accent hover:underline">
          Select all
        </button>
        <button type="button" onClick={() => setAll(false)} className="text-accent hover:underline">
          Select none
        </button>
        <span className="text-muted">
          {rows.length} rows — flagged rows start unchecked, review before including them.
        </span>
      </div>

      <div className="overflow-x-auto rounded-md border border-rule">
        <table className="w-full min-w-[920px] text-[12.5px]">
          <thead>
            <tr className="border-b border-rule-2 bg-sunken text-left text-[11px] uppercase tracking-[0.08em] text-muted">
              <th className="py-1.5 pl-3 pr-2 font-medium">Include</th>
              <th className="py-1.5 pr-3 font-medium">Name</th>
              <th className="py-1.5 pr-3 font-medium">Email</th>
              <th className="py-1.5 pr-3 font-medium">MT5 login</th>
              <th className="py-1.5 pr-3 font-medium">Broker</th>
              <th className="py-1.5 pr-3 font-medium">Suggests</th>
              <th className="py-1.5 pr-3 font-medium">Suggested match</th>
              <th className="py-1.5 font-medium">Review</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.dedupeKey}
                className={cn("border-b border-rule last:border-0", row.needsReview && "bg-err-bg/40")}
              >
                <td className="py-1.5 pl-3 pr-2">
                  <input
                    type="checkbox"
                    name="include"
                    value={row.dedupeKey}
                    defaultChecked={!row.needsReview}
                    className="h-3.5 w-3.5 accent-accent-solid"
                  />
                </td>
                <td className="py-1.5 pr-3 text-ink">{row.name || "—"}</td>
                <td className="py-1.5 pr-3 text-ink-2">{row.email || "—"}</td>
                <td className="py-1.5 pr-3 font-mono text-ink-2">{row.mt5Login || "—"}</td>
                <td className="py-1.5 pr-3 text-ink-2">{row.brokerNormalized}</td>
                <td className={cn("py-1.5 pr-3 font-medium", ACTION_STYLE[row.action])}>{row.action}</td>
                <td className="py-1.5 pr-3 text-ink-2">
                  {row.linkedClientName ? `${row.linkedClientName} (${row.matchMethod})` : "—"}
                </td>
                <td className="py-1.5 text-[11px] text-err">{row.reviewReason ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Sending to TC…" : "Send selected rows to TC"}
        </Button>
        {state.error ? <p className="text-[12px] text-err">{state.error}</p> : null}
        {state.ok ? <p className="text-[12px] text-ok">{state.ok}</p> : null}
      </div>
    </form>
  );
}
