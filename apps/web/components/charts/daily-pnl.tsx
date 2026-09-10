"use client";

import { useState } from "react";
import { usd, num } from "@/lib/format";

export interface DailyPnlDatum {
  date: string;
  pnl: number;
  trades: number;
}

/**
 * One diverging bar per UTC day — green above the zero line for a profitable
 * day, red below for a losing one. Bars are thin, rounded at the data end and
 * anchored to the baseline; hover a column for the exact figure.
 */
export function DailyPnlChart({
  data,
  weekly = false,
}: {
  data: DailyPnlDatum[];
  weekly?: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);
  if (!data.length) {
    return <Empty>No closed trades in range.</Empty>;
  }

  const maxAbs = Math.max(1, ...data.map((d) => Math.abs(d.pnl)));
  const H = 128; // px, half above / half below

  return (
    <div className="relative">
      <div
        className="flex items-stretch gap-[2px] overflow-x-auto pb-1"
        style={{ height: H * 2 }}
      >
        {data.map((d, i) => {
          const frac = Math.abs(d.pnl) / maxAbs;
          const barH = Math.max(d.pnl === 0 ? 0 : 2, frac * H);
          const up = d.pnl >= 0;
          return (
            <div
              key={d.date}
              className="relative flex min-w-[6px] flex-1 flex-col justify-center"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover((h) => (h === i ? null : h))}
            >
              {/* zero line */}
              <div className="absolute inset-x-0 top-1/2 h-px bg-rule-2" />
              <div className="flex h-full flex-col">
                <div className="flex flex-1 items-end justify-center">
                  {up && (
                    <div
                      className="w-full rounded-t-[3px] bg-ok transition-opacity"
                      style={{ height: barH, opacity: hover == null || hover === i ? 1 : 0.45 }}
                    />
                  )}
                </div>
                <div className="flex flex-1 items-start justify-center">
                  {!up && (
                    <div
                      className="w-full rounded-b-[3px] bg-err transition-opacity"
                      style={{ height: barH, opacity: hover == null || hover === i ? 1 : 0.45 }}
                    />
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-1 flex justify-between text-[10px] tabular-nums text-muted">
        <span>{fmtDay(data[0]!.date, weekly)}</span>
        <span>{fmtDay(data[data.length - 1]!.date, weekly)}</span>
      </div>

      {hover != null && data[hover] ? (
        <div className="pointer-events-none absolute -top-1 left-1/2 -translate-x-1/2 -translate-y-full rounded-md border border-rule-2 bg-raised px-2 py-1 text-[12px] shadow-pop">
          <span className="text-ink-2">{fmtDay(data[hover]!.date, weekly)}</span>{" "}
          <span className={data[hover]!.pnl < 0 ? "text-err" : "text-ok"}>
            {data[hover]!.pnl >= 0 ? "+" : ""}
            {usd(data[hover]!.pnl)}
          </span>{" "}
          <span className="text-muted">· {num(data[hover]!.trades)} tr</span>
        </div>
      ) : null}
    </div>
  );
}

function fmtDay(iso: string, weekly: boolean) {
  return weekly ? iso : iso.slice(5); // MM-DD
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid h-40 place-items-center rounded-md border border-dashed border-rule-2 text-xs text-muted">
      {children}
    </div>
  );
}
