"use client";

import { useActionState } from "react";
import { uploadRoster, uploadXmTradesAction, type ImportFormState } from "@/lib/actions/imports";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const init: ImportFormState = {};

function Msg({ state }: { state: ImportFormState }) {
  if (state.error) return <p className="mt-2 text-[12px] text-err">{state.error}</p>;
  if (state.ok) return <p className="mt-2 text-[12px] text-ok">{state.ok}</p>;
  return null;
}

export function RosterUploadForm({ tagCatalogue }: { tagCatalogue: string[] }) {
  const [state, action, pending] = useActionState(uploadRoster, init);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1 text-[12px] text-ink-2">
        Roster file (.xlsx / .csv)
        <Input name="file" type="file" accept=".xlsx,.xls,.csv" required className="h-9 w-64 py-1.5" />
      </label>
      <label className="flex flex-col gap-1 text-[12px] text-ink-2">
        Tag every row with
        <input
          name="tags"
          list="tag-catalogue"
          placeholder="e.g. 5x"
          className="h-9 w-40 rounded-md border border-rule-2 bg-raised px-3 text-sm text-ink placeholder:text-muted"
        />
        <datalist id="tag-catalogue">
          {tagCatalogue.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      </label>
      <Button size="sm" type="submit" disabled={pending}>
        {pending ? "Parsing…" : "Upload & preview"}
      </Button>
      <div className="w-full">
        <Msg state={state} />
      </div>
    </form>
  );
}

export function XmTradesUploadForm() {
  const [state, action, pending] = useActionState(uploadXmTradesAction, init);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1 text-[12px] text-ink-2">
        XM trade-history export (.csv)
        <Input name="file" type="file" accept=".csv" required className="h-9 w-64 py-1.5" />
      </label>
      <Button size="sm" type="submit" disabled={pending}>
        {pending ? "Importing…" : "Upload"}
      </Button>
      <div className="w-full">
        <Msg state={state} />
      </div>
    </form>
  );
}
