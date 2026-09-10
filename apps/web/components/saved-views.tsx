"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { saveView, deleteView } from "@/lib/actions/views";
import { cn } from "@/lib/cn";
import type { ViewRow } from "@/lib/views-data";

export function SavedViews({
  page,
  views,
}: {
  page: "clients" | "funding";
  views: ViewRow[];
}) {
  const pathname = usePathname();
  const sp = useSearchParams();
  const currentQuery = sp.toString();
  const [pending, start] = useTransition();

  const activeName = views.find((v) => v.query === currentQuery)?.name;

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-rule bg-raised px-4 py-1.5 text-[12px]">
      <span className="text-[10px] uppercase tracking-[0.1em] text-muted">Views</span>
      <Link
        href={pathname}
        className={cn(
          "rounded-full border px-2 py-0.5",
          !currentQuery ? "border-accent bg-accent-bg text-accent" : "border-rule-2 text-ink-2 hover:text-ink",
        )}
      >
        All
      </Link>
      {views.map((v) => (
        <span key={v._id} className="inline-flex items-center">
          <Link
            href={`${pathname}?${v.query}`}
            className={cn(
              "rounded-full border py-0.5 pl-2",
              v.mine ? "pr-1" : "pr-2",
              activeName === v.name
                ? "border-accent bg-accent-bg text-accent"
                : "border-rule-2 text-ink-2 hover:text-ink",
            )}
          >
            {v.name}
            {v.mine ? (
              <button
                onClick={(e) => {
                  e.preventDefault();
                  start(() => deleteView(v._id));
                }}
                className="ml-1 text-muted hover:text-err"
                title="Delete view"
              >
                ✕
              </button>
            ) : null}
          </Link>
        </span>
      ))}
      <button
        disabled={pending || !currentQuery}
        onClick={() => {
          const name = window.prompt("Name this view");
          if (name?.trim()) start(() => saveView(page, name.trim(), currentQuery));
        }}
        className="rounded-full border border-dashed border-rule-2 px-2 py-0.5 text-ink-2 hover:text-ink disabled:opacity-40"
        title={currentQuery ? "Save the current filters" : "Set some filters first"}
      >
        + Save view
      </button>
    </div>
  );
}
