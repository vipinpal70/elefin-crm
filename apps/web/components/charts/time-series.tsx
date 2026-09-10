"use client";

import { useMemo, useState } from "react";
import { usd, num, num2 } from "@/lib/format";

export type TSPoint = { date: string } & Record<string, number | string>;

/** Function props can't cross the RSC boundary, so the unit is a string. */
export type ChartUnit = "usd" | "num" | "num1";
const FMT: Record<ChartUnit, (n: number) => string> = {
  usd: (n) => usd(n),
  num: (n) => num(Math.round(n)),
  num1: (n) => num2(n),
};

interface SeriesDef {
  key: string;
  label: string;
  /** CSS colour, e.g. "var(--ok)" or "#5645e7". */
  color: string;
  /** Bars only: draw below the zero line. */
  down?: boolean;
}

/**
 * One shared linear y-axis (never dual). Bars are grouped per day (up above the
 * zero line, `down` series below); lines overlay at the same scale. Hover a day
 * for every series' value.
 */
export function TimeSeries({
  data,
  bars = [],
  lines = [],
  height = 150,
  unit = "num",
}: {
  data: TSPoint[];
  bars?: SeriesDef[];
  lines?: SeriesDef[];
  height?: number;
  unit?: ChartUnit;
}) {
  const format = FMT[unit];
  const [hover, setHover] = useState<number | null>(null);
  const keys = [...bars, ...lines].map((s) => s.key);

  const { lo, hi } = useMemo(() => {
    let lo = 0;
    let hi = 0;
    for (const row of data) {
      for (const k of keys) {
        const v = Number(row[k] ?? 0);
        if (Number.isFinite(v)) {
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      }
    }
    if (lo === hi) hi = lo + 1;
    return { lo, hi };
  }, [data, keys.join()]);

  if (!data.length) {
    return (
      <div className="grid h-36 place-items-center rounded-md border border-dashed border-rule-2 text-xs text-muted">
        No data in range.
      </div>
    );
  }

  const span = hi - lo;
  const zeroFrac = (0 - lo) / span; // 0 line position from bottom (0..1)
  const W = 900;
  const PAD = 4;
  const step = (W - PAD * 2) / data.length;
  const barW = Math.max(1, Math.min(18, (step * 0.7) / Math.max(1, bars.length)));

  const yPx = (v: number) => height - PAD - ((v - lo) / span) * (height - PAD * 2);
  const zeroY = yPx(0);

  const linePath = (key: string) =>
    data
      .map((row, i) => {
        const x = PAD + step * (i + 0.5);
        const y = yPx(Number(row[key] ?? 0));
        return `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");

  return (
    <div>
      {(bars.length + lines.length > 1) && (
        <div className="mb-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-2">
          {[...bars, ...lines].map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-sm" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      )}

      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${height}`}
          preserveAspectRatio="none"
          className="w-full"
          style={{ height }}
          onMouseMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const i = Math.floor(((e.clientX - r.left) / r.width) * data.length);
            setHover(Math.max(0, Math.min(data.length - 1, i)));
          }}
          onMouseLeave={() => setHover(null)}
        >
          <line
            x1={PAD}
            x2={W - PAD}
            y1={zeroY}
            y2={zeroY}
            stroke="var(--rule-2)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />

          {data.map((row, i) => {
            const cx = PAD + step * (i + 0.5);
            const groupW = barW * bars.length;
            return bars.map((s, bi) => {
              const v = Number(row[s.key] ?? 0);
              if (!v) return null;
              const y = yPx(v);
              const top = Math.min(y, zeroY);
              const h = Math.max(1, Math.abs(y - zeroY));
              const x = cx - groupW / 2 + bi * barW;
              return (
                <rect
                  key={`${i}-${s.key}`}
                  x={x}
                  y={top}
                  width={Math.max(0.8, barW - 0.6)}
                  height={h}
                  rx={1}
                  fill={s.color}
                  opacity={hover == null || hover === i ? 1 : 0.4}
                />
              );
            });
          })}

          {lines.map((s) => (
            <path
              key={s.key}
              d={linePath(s.key)}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {hover != null && (
            <line
              x1={PAD + step * (hover + 0.5)}
              x2={PAD + step * (hover + 0.5)}
              y1={PAD}
              y2={height - PAD}
              stroke="var(--rule-2)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>

        {hover != null && data[hover] ? (
          <div className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 rounded-md border border-rule-2 bg-raised px-2 py-1 text-[11px] shadow-pop">
            <div className="mb-0.5 text-ink-2">{String(data[hover]!.date)}</div>
            {[...bars, ...lines].map((s) => (
              <div key={s.key} className="flex items-center gap-1.5 tabular-nums">
                <span className="inline-block h-2 w-2 rounded-sm" style={{ background: s.color }} />
                <span className="text-muted">{s.label}</span>
                <span className="ml-auto text-ink">{format(Number(data[hover]![s.key] ?? 0))}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div className="mt-1 flex justify-between text-[10px] tabular-nums text-muted">
        <span>{String(data[0]!.date)}</span>
        <span>{String(data[data.length - 1]!.date)}</span>
      </div>
    </div>
  );
}
