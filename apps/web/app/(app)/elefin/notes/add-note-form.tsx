"use client";

import { useActionState, useEffect, useRef } from "react";
import { addNoteQuick, type NoteFormState } from "@/lib/actions/notes";
import { ClientPicker } from "@/components/client-picker";
import { Button } from "@/components/ui/button";

const init: NoteFormState = {};

export function AddNoteForm() {
  const [state, action, pending] = useActionState(addNoteQuick, init);
  const ref = useRef<HTMLFormElement>(null);

  // Reset the note text + due date on a successful add — the client picker
  // keeps its selection (React-controlled), so logging several notes for the
  // same person in a row doesn't require re-searching each time.
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state.ok]);

  return (
    <form ref={ref} action={action} className="flex flex-wrap items-start gap-2">
      <ClientPicker />
      <textarea
        name="body"
        required
        rows={1}
        placeholder="Add a note or a dated follow-up…"
        className="h-8 min-w-[16rem] flex-1 resize-y rounded-md border border-rule-2 bg-raised px-2 py-1.5 text-[13px] text-ink placeholder:text-muted focus-visible:outline-2 focus-visible:outline-accent"
      />
      <label className="flex h-8 items-center gap-1 text-[12px] text-muted">
        Follow up
        <input type="date" name="due" className="h-8 rounded border border-rule-2 bg-raised px-1.5 text-[12px] text-ink" />
      </label>
      <Button size="sm" type="submit" disabled={pending}>
        {pending ? "Saving…" : "Add"}
      </Button>
      {state.error ? <p className="w-full text-[12px] text-err">{state.error}</p> : null}
      {state.ok ? <p className="w-full text-[12px] text-ok">{state.ok}</p> : null}
    </form>
  );
}
