/** UTC-only date helpers for snapshotting and per-day bucketing. */

export function utcDayStart(d: Date | string | number): Date {
  const t = new Date(d);
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()));
}

export function utcDayKey(d: Date | string | number): string {
  return utcDayStart(d).toISOString().slice(0, 10); // YYYY-MM-DD
}

export function addUtcDays(d: Date, days: number): Date {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + days);
  return x;
}

/** Inclusive list of UTC day-starts from `from` to `to`. */
export function eachUtcDay(from: Date | string, to: Date | string): Date[] {
  let cur = utcDayStart(from);
  const end = utcDayStart(to);
  const out: Date[] = [];
  while (cur.getTime() <= end.getTime()) {
    out.push(cur);
    cur = addUtcDays(cur, 1);
  }
  return out;
}

/** ISO-8601 week key, e.g. "2026-W35". */
export function isoWeekKey(d: Date | string | number): string {
  const date = new Date(d);
  const day = (date.getUTCDay() + 6) % 7; // Mon = 0
  const thursday = new Date(date);
  thursday.setUTCDate(date.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
  const week =
    1 +
    Math.round(
      ((thursday.getTime() - firstThursday.getTime()) / 86_400_000 -
        3 +
        ((firstThursday.getUTCDay() + 6) % 7)) /
        7,
    );
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function daysBetween(a: Date | string, b: Date | string): number {
  return Math.floor((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);
}
