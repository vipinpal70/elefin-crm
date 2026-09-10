"use client";

import { useRef, useTransition } from "react";
import { addNote } from "@/lib/actions/notes";
import { Button } from "@/components/ui/button";

export function NoteForm({ clientId }: { clientId: number }) {
  const ref = useRef<HTMLFormElement>(null);
  const [pending, start] = useTransition();

  return (
    <form
      ref={ref}
      action={(fd) =>
        start(async () => {
          await addNote(clientId, fd);
          ref.current?.reset();
        })
      }
      className="mt-3 border-t border-rule pt-3"
    >
      <textarea
        name="body"
        required
        rows={2}
        placeholder="Add a note or a dated follow-up…"
        className="w-full resize-y rounded-md border border-rule-2 bg-raised px-2 py-1.5 text-[13px] text-ink placeholder:text-muted focus-visible:outline-2 focus-visible:outline-accent"
      />
      <div className="mt-2 flex items-center gap-2">
        <label className="flex items-center gap-1 text-[12px] text-muted">
          Follow up
          <input
            type="date"
            name="due"
            className="h-7 rounded border border-rule-2 bg-raised px-1.5 text-[12px] text-ink"
          />
        </label>
        <Button size="sm" type="submit" disabled={pending} className="ml-auto">
          {pending ? "Saving…" : "Add note"}
        </Button>
      </div>
    </form>
  );
}
