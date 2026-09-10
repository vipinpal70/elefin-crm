"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { SearchHit } from "@/lib/search-types";

export function GlobalSearch() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const listId = useId();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && document.activeElement?.tagName !== "INPUT")) {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([]);
      setOpen(false);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
          signal: ctrl.signal,
        });
        const data = (await res.json()) as { hits: SearchHit[] };
        setHits(data.hits);
        setActive(0);
        setOpen(true);
      } catch {
        /* aborted */
      } finally {
        setLoading(false);
      }
    }, 180);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  const go = (hit: SearchHit | undefined) => {
    if (!hit) return;
    setOpen(false);
    setQ("");
    router.push(hit.href);
  };

  return (
    <div className="relative mx-auto w-full max-w-md">
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => hits.length && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => Math.min(i + 1, hits.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter") {
            if (hits.length) go(hits[active]);
            else if (q.trim()) router.push(`/clients?q=${encodeURIComponent(q.trim())}`);
          }
        }}
        placeholder="Search clients, accounts…  ( / or ⌘K )"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        className="h-8 w-full rounded-md border border-rule-2 bg-raised px-3 text-[13px] text-ink placeholder:text-muted focus-visible:outline-2 focus-visible:outline-accent"
      />
      {open && (hits.length > 0 || loading) ? (
        <ul
          id={listId}
          className="absolute z-30 mt-1 max-h-80 w-full overflow-auto rounded-lg border border-rule-2 bg-raised py-1 text-[13px] shadow-pop"
        >
          {loading && hits.length === 0 ? (
            <li className="px-3 py-2 text-muted">Searching…</li>
          ) : null}
          {hits.map((h, i) => (
            <li key={`${h.type}-${h.id}`}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => go(h)}
                onMouseEnter={() => setActive(i)}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left ${
                  i === active ? "bg-accent-bg text-accent" : "text-ink hover:bg-sunken"
                }`}
              >
                <span className="w-14 shrink-0 text-[10px] uppercase tracking-wide text-muted">
                  {h.type}
                </span>
                <span className="min-w-0 flex-1 truncate">{h.title}</span>
                <span className="shrink-0 truncate text-[11px] text-muted">{h.subtitle}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
