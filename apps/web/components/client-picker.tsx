"use client";

import { useEffect, useRef, useState } from "react";
import type { SearchHit } from "@/lib/search-types";

/** Type-to-search client picker. Renders a hidden `name="clientId"` input once a client is chosen. */
export function ClientPicker({ required = true }: { required?: boolean }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<{ id: string; title: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (picked || q.trim().length < 2) {
      setHits([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        const data = (await res.json()) as { hits: SearchHit[] };
        setHits(data.hits.filter((h) => h.type === "client"));
        setOpen(true);
      } catch {
        /* aborted */
      }
    }, 180);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q, picked]);

  if (picked) {
    return (
      <div className="flex h-8 items-center gap-1.5 rounded-md border border-rule-2 bg-sunken px-2 text-[13px]">
        <input type="hidden" name="clientId" value={picked.id} />
        <span className="text-ink">{picked.title}</span>
        <button
          type="button"
          onClick={() => {
            setPicked(null);
            setQ("");
            setTimeout(() => inputRef.current?.focus(), 0);
          }}
          className="text-muted hover:text-ink"
          aria-label="Change client"
        >
          ×
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => hits.length && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        placeholder="Search client by name, email, id…"
        required={required}
        className="h-8 w-64 rounded-md border border-rule-2 bg-raised px-2 text-[13px] text-ink placeholder:text-muted"
      />
      {open && hits.length > 0 ? (
        <ul className="absolute z-30 mt-1 max-h-56 w-72 overflow-auto rounded-lg border border-rule-2 bg-raised py-1 text-[13px] shadow-pop">
          {hits.map((h) => (
            <li key={h.id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setPicked({ id: h.id, title: h.title });
                  setOpen(false);
                }}
                className="flex w-full flex-col px-3 py-1.5 text-left hover:bg-sunken"
              >
                <span className="text-ink">{h.title}</span>
                <span className="text-[11px] text-muted">{h.subtitle}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
