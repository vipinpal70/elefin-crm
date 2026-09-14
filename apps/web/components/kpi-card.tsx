import { Card, CardTitle, CardValue } from "@/components/ui/card";
import { cn } from "@/lib/cn";

export interface KpiChange {
  text: string;
  dir: "up" | "down" | "flat";
  /** Is an "up" move good here? (deposits: yes; withdrawals: no) */
  goodUp?: boolean;
}

export function KpiCard({
  title,
  value,
  sub,
  tone = "neutral",
  change,
  info,
}: {
  title: string;
  value: string;
  sub?: string;
  tone?: "neutral" | "positive" | "negative";
  change?: KpiChange;
  /** Short explanation shown in a hover/focus tooltip off the "i" badge. */
  info?: string;
}) {
  const good =
    change && change.dir !== "flat"
      ? (change.dir === "up") === (change.goodUp ?? true)
      : null;

  return (
    <Card className="relative p-3">
      {info ? (
        <span className="group absolute right-2 top-2">
          <span
            tabIndex={0}
            aria-label={info}
            className="grid h-3.5 w-3.5 cursor-help place-items-center rounded-full border border-rule-2 text-[9px] font-medium leading-none text-muted outline-none hover:border-accent hover:text-accent focus-visible:border-accent focus-visible:text-accent"
          >
            i
          </span>
          <span
            role="tooltip"
            className="pointer-events-none invisible absolute right-0 top-5 z-20 w-52 rounded-md border border-rule-2 bg-raised p-2 text-[11px] leading-snug normal-case text-ink-2 opacity-0 shadow-card transition-opacity group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
          >
            {info}
          </span>
        </span>
      ) : null}
      <CardTitle className="pr-4">{title}</CardTitle>
      <CardValue
        className={cn(
          tone === "positive" && "text-ok",
          tone === "negative" && "text-err",
        )}
      >
        {value}
      </CardValue>
      <div className="mt-0.5 flex items-center gap-1.5 text-[11px]">
        {change ? (
          <span
            className={cn(
              "tabular-nums",
              good === null ? "text-muted" : good ? "text-ok" : "text-err",
            )}
          >
            {change.dir === "up" ? "▲" : change.dir === "down" ? "▼" : "•"} {change.text}
          </span>
        ) : null}
        {sub ? <span className="text-ink-2">{sub}</span> : null}
      </div>
    </Card>
  );
}
