/**
 * Money helpers. Values arrive as Decimal128 strings from Mongo or as JSON
 * numbers from the API. Analytics here operate on `number` for speed; callers
 * that need exactness (ledgers, payouts) should use a decimal library instead.
 */
export type Num = number | string | null | undefined;

export function n(v: Num): number {
  if (v === null || v === undefined || v === "") return 0;
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

export function sum(values: Iterable<Num>): number {
  let total = 0;
  for (const v of values) total += n(v);
  return total;
}

export function sumBy<T>(items: readonly T[], pick: (item: T) => Num): number {
  let total = 0;
  for (const item of items) total += n(pick(item));
  return total;
}

/** Round to `dp` decimal places, away from floating-point fuzz. */
export function round(value: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round((value + Number.EPSILON) * f) / f;
}

export function ratio(numerator: Num, denominator: Num): number {
  const d = n(denominator);
  return d === 0 ? 0 : n(numerator) / d;
}

export function pct(numerator: Num, denominator: Num, dp = 1): number {
  return round(ratio(numerator, denominator) * 100, dp);
}
