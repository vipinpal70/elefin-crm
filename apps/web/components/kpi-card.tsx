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
}: {
  title: string;
  value: string;
  sub?: string;
  tone?: "neutral" | "positive" | "negative";
  change?: KpiChange;
}) {
  const good =
    change && change.dir !== "flat"
      ? (change.dir === "up") === (change.goodUp ?? true)
      : null;

  return (
    <Card className="p-3">
      <CardTitle>{title}</CardTitle>
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
