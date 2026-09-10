import type { SP } from "./clients-query";

export interface DateRange {
  from?: string; // raw YYYY-MM-DD from the input
  to?: string;
  fromDate?: Date;
  toDate?: Date;
}

const one = (v: string | string[] | undefined): string | undefined =>
  Array.isArray(v) ? v[0] : v;

const isYmd = (s: string | undefined): s is string =>
  !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

export function parseRange(sp: SP): DateRange {
  const from = one(sp.from);
  const to = one(sp.to);
  return {
    from: isYmd(from) ? from : undefined,
    to: isYmd(to) ? to : undefined,
    fromDate: isYmd(from) ? new Date(`${from}T00:00:00.000Z`) : undefined,
    toDate: isYmd(to) ? new Date(`${to}T23:59:59.999Z`) : undefined,
  };
}

/** Mongo range clause for a date field, or undefined if no bounds. */
export function rangeClause(r: DateRange): Record<string, Date> | undefined {
  if (!r.fromDate && !r.toDate) return undefined;
  const c: Record<string, Date> = {};
  if (r.fromDate) c.$gte = r.fromDate;
  if (r.toDate) c.$lte = r.toDate;
  return c;
}
