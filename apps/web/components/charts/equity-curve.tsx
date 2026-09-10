"use client";

import { useMemo, useState } from "react";
import { usd, num, num2 } from "@/lib/format";

export interface EquityPoint {
  t: string;
  cum: number;
}

export type ChartUnit = "usd" | "num" | "num1";
const FMT: Record<ChartUnit, (n: number) => string> = {
  usd: (n) => usd(n),
  num: (n) => num(Math.round(n)),
  num1: (n) => num2(n),
};

/** A cumulative series as an area under a 2px line. Hover for the value. */
export function EquityCurve({
  data,
  unit = "usd",
  emptyLabel = "Not enough data yet.",
}: {
  data: EquityPoint[];
  unit?: ChartUnit;
  emptyLabel?: string;
}) {
  const format = FMT[unit];
  const [hoverX, setHoverX] = useState<number | null>(null);
  const W = 800;
  const H = 180;
  const PAD = 6;

  const { path, area, min, max, xs } = useMemo(() => {
    if (data.length < 2) return { path: "", area: "", min: 0, max: 0, xs: [] as number[] };
    const ys = data.map((d) => d.cum);
    const lo = Math.min(0, ...ys);
    const hi = Math.max(0, ...ys);
    const span = hi - lo || 1;
    const xScale = (i: number) => PAD + (i / (data.length - 1)) * (W - PAD * 2);
    const yScale = (v: number) => H - PAD - ((v - lo) / span) * (H - PAD * 2);
    const pts = data.map((d, i) => [xScale(i), yScale(d.cum)] as const);
    const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
    const base = yScale(0);
    return {
      path: line,
      area: `${line} L${pts[pts.length - 1]![0].toFixed(1)},${base.toFixed(1)} L${pts[0]![0].toFixed(1)},${base.toFixed(1)} Z`,
      min: lo,
      max: hi,
      xs: pts.map((p) => p[0]),
    };
  }, [data]);

  if (data.length < 2) {
    return (
      <div className="grid h-44 place-items-center rounded-md border border-dashed border-rule-2 text-xs text-muted">
        {emptyLabel}
      </div>
    );
  }

  const hoverIdx =
    hoverX == null
      ? null
      : xs.reduce(
          (best, x, i) => (Math.abs(x - hoverX) < Math.abs(xs[best]! - hoverX) ? i : best),
          0,
        );

  const zeroY = (() => {
    const span = max - min || 1;
    return H - PAD - ((0 - min) / span) * (H - PAD * 2);
  })();

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-44 w-full"
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setHoverX(((e.clientX - r.left) / r.width) * W);
        }}
        onMouseLeave={() => setHoverX(null)}
      >
        <line x1={PAD} x2={W - PAD} y1={zeroY} y2={zeroY} stroke="var(--rule-2)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        <path d={area} fill="var(--accent)" opacity={0.1} />
        <path d={path} fill="none" stroke="var(--accent)" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        {hoverIdx != null && (
          <>
            <line x1={xs[hoverIdx]} x2={xs[hoverIdx]} y1={PAD} y2={H - PAD} stroke="var(--rule-2)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          </>
        )}
      </svg>

      <div className="mt-1 flex justify-between text-[10px] tabular-nums text-muted">
        <span>{data[0]!.t.slice(0, 10)}</span>
        <span>range {format(min)} … {format(max)}</span>
        <span>{data[data.length - 1]!.t.slice(0, 10)}</span>
      </div>

      {hoverIdx != null && data[hoverIdx] ? (
        <div className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 rounded-md border border-rule-2 bg-raised px-2 py-1 text-[12px] shadow-pop">
          <span className="text-ink-2">{data[hoverIdx]!.t.slice(0, 16).replace("T", " ")}</span>{" "}
          <span className={data[hoverIdx]!.cum < 0 ? "text-err" : "text-ok"}>{format(data[hoverIdx]!.cum)}</span>
        </div>
      ) : null}
    </div>
  );
}
