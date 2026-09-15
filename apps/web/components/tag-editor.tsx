"use client";

import { useState, useTransition } from "react";
import { cn } from "@/lib/cn";

/**
 * Click a tag to toggle it on/off. `onSave` is a server action bound to the
 * entity id (e.g. `setClientTags.bind(null, clientId)`), so this component
 * stays entity-agnostic — used for both Client and ExternalTrader tags.
 */
export function TagEditor({
  tags: initial,
  catalogue,
  onSave,
}: {
  tags: string[];
  catalogue: string[];
  onSave: (tags: string[]) => Promise<void>;
}) {
  const [tags, setTags] = useState(initial);
  const [pending, start] = useTransition();

  const toggle = (tag: string) => {
    const next = tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag];
    setTags(next);
    start(() => onSave(next));
  };

  // a tag already on this record but no longer in the catalogue still shows, so it stays visible/removable
  const extra = tags.filter((t) => !catalogue.includes(t));

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {[...catalogue, ...extra].map((tag) => {
        const active = tags.includes(tag);
        return (
          <button
            key={tag}
            type="button"
            disabled={pending}
            onClick={() => toggle(tag)}
            className={cn(
              "rounded-full border px-2 py-0.5 text-[11px] font-medium transition disabled:opacity-50",
              active
                ? "border-accent bg-accent-bg text-accent"
                : "border-dashed border-rule-2 text-muted hover:text-ink-2",
            )}
          >
            {tag}
          </button>
        );
      })}
      {catalogue.length === 0 && extra.length === 0 ? (
        <span className="text-[12px] text-muted">
          No tags yet — add some from Settings.
        </span>
      ) : null}
    </div>
  );
}
