"use client";

import { useState, useTransition } from "react";
import { toggleWatch } from "@/lib/actions/watch";
import { cn } from "@/lib/cn";

export function WatchButton({
  clientId,
  initial,
}: {
  clientId: number;
  initial: boolean;
}) {
  const [watched, setWatched] = useState(initial);
  const [pending, start] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          setWatched(await toggleWatch(clientId));
        })
      }
      className={cn(
        "inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[12px] font-medium transition disabled:opacity-50",
        watched
          ? "border-accent bg-accent-bg text-accent"
          : "border-rule-2 text-ink-2 hover:text-ink",
      )}
    >
      <span>{watched ? "★" : "☆"}</span>
      {watched ? "Watching" : "Watch"}
    </button>
  );
}
