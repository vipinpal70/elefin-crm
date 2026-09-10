const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});
const NUM = new Intl.NumberFormat("en-US");
const NUM2 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const USD_COMPACT = new Intl.NumberFormat("en-US", {
  notation: "compact",
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 1,
});
const USD_SMALL = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});
const NUM_COMPACT = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

type Numish = number | string | null | undefined;

const toNum = (v: Numish): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

export const usd = (v: Numish): string => USD.format(toNum(v));
export const num = (v: Numish): string => NUM.format(toNum(v));
export const num2 = (v: Numish): string => NUM2.format(toNum(v));
export const pctStr = (v: Numish, dp = 1): string => `${toNum(v).toFixed(dp)}%`;

/** Compact money for at-a-glance tiles: $1.2K, -$8.4K, $1.4M. Exact below 1000. */
export const compactUsd = (v: Numish): string => {
  const n = toNum(v);
  return Math.abs(n) < 1000 ? USD_SMALL.format(n) : USD_COMPACT.format(n);
};
/** Compact count: 2.8K, 1.2M. Plain below 1000. */
export const compactNum = (v: Numish): string => NUM_COMPACT.format(toNum(v));

export const signedUsd = (v: Numish): string => {
  const n = toNum(v);
  return (n > 0 ? "+" : "") + USD.format(n);
};

export const dateShort = (v: Date | string | null | undefined): string =>
  v ? new Date(v).toISOString().slice(0, 10) : "—";

export const dateTimeShort = (v: Date | string | null | undefined): string =>
  v ? new Date(v).toISOString().slice(0, 16).replace("T", " ") + " UTC" : "—";

export const relativeDays = (v: Date | string | null | undefined): string => {
  if (!v) return "—";
  const days = Math.floor((Date.now() - new Date(v).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
};

export const pf = (v: number | null | undefined): string =>
  v == null ? "∞" : v.toFixed(2);

export const duration = (seconds: Numish): string => {
  const s = Math.max(0, Math.round(toNum(seconds)));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h < 24) return rem ? `${h}h ${rem}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
};

export const lots = (v: Numish): string => num2(v);

