import { connect, BookDaily } from "@elefin/db";
import { cached } from "@elefin/cache";
import type { TSPoint } from "@/components/charts/time-series";

export interface BookPoint {
  date: string; // YYYY-MM-DD
  newSignups: number;
  clientsTotal: number;
  clientsFunded: number;
  clientsActiveTraders: number;
  depositsDay: number;
  withdrawalsDay: number;
  withdrawalsDayNeg: number;
  netFlowDay: number;
  depositsCum: number;
  withdrawalsCum: number;
  netDepositCum: number;
  tradesCum: number;
  lotsCum: number;
  clientPnlDay: number;
  clientPnlCum: number;
  balanceTotal: number;
  commissionCum: number;
}

const nz = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** The book_daily series for one referral code ("*" = all). */
export async function fetchBookSeries(
  opts: {
    code?: string;
    from?: Date;
    to?: Date;
  } = {},
): Promise<BookPoint[]> {
  const code = opts.code || "*";
  const from = opts.from ? opts.from.toISOString() : "";
  const to = opts.to ? opts.to.toISOString() : "";
  return cached(
    `book-series:${code}:${from}:${to}`,
    { ttl: 900, tags: ["book"] },
    () => loadBookSeries(opts),
  );
}

async function loadBookSeries(opts: {
  code?: string;
  from?: Date;
  to?: Date;
}): Promise<BookPoint[]> {
  await connect();

  const filter: Record<string, unknown> = {
    "meta.referralCode": opts.code || "*",
  };
  if (opts.from || opts.to) {
    const d: Record<string, Date> = {};
    if (opts.from) d.$gte = opts.from;
    if (opts.to) d.$lte = opts.to;
    filter.date = d;
  }

  const rows = await BookDaily.find(filter).sort({ date: 1 }).lean();

  return rows.map((r) => {
    const dep = nz(r.depositsDay);
    const wd = nz(r.withdrawalsDay);
    return {
      date: new Date(r.date as Date).toISOString().slice(0, 10),
      newSignups: nz(r.newSignups),
      clientsTotal: nz(r.clientsTotal),
      clientsFunded: nz(r.clientsFunded),
      clientsActiveTraders: nz(r.clientsActiveTraders),
      depositsDay: dep,
      withdrawalsDay: wd,
      withdrawalsDayNeg: -wd,
      netFlowDay: Math.round((dep - wd) * 100) / 100,
      depositsCum: nz(r.depositsCum),
      withdrawalsCum: nz(r.withdrawalsCum),
      netDepositCum: nz(r.netDepositCum),
      tradesCum: nz(r.tradesCum),
      lotsCum: nz(r.lotsCum),
      clientPnlDay: nz(r.clientPnlDay),
      clientPnlCum: nz(r.clientPnlCum),
      balanceTotal: nz(r.balanceTotal),
      commissionCum: nz(r.commissionCum),
    };
  });
}

export interface PeriodDelta {
  cur: number;
  prev: number;
  diff: number;
  pct: number | null; // null when prev == 0
}

const delta = (cur: number, prev: number): PeriodDelta => ({
  cur,
  prev,
  diff: Math.round((cur - prev) * 100) / 100,
  pct: prev === 0 ? null : Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10,
});

/**
 * Trailing-window totals vs the window immediately before it, from the daily
 * series. `days` counts back from the last snapshot.
 */
export function periodDeltas(points: BookPoint[], days = 30) {
  const n = points.length;
  const win = points.slice(Math.max(0, n - days));
  const prevWin = points.slice(Math.max(0, n - days * 2), Math.max(0, n - days));
  const sum = (rows: BookPoint[], k: keyof BookPoint) =>
    rows.reduce((s, p) => s + nz(p[k]), 0);

  return {
    days,
    signups: delta(sum(win, "newSignups"), sum(prevWin, "newSignups")),
    deposits: delta(sum(win, "depositsDay"), sum(prevWin, "depositsDay")),
    withdrawals: delta(sum(win, "withdrawalsDay"), sum(prevWin, "withdrawalsDay")),
    netFlow: delta(sum(win, "netFlowDay"), sum(prevWin, "netFlowDay")),
    clientPnl: delta(sum(win, "clientPnlDay"), sum(prevWin, "clientPnlDay")),
  };
}

/** Sum a per-day field into ISO-week buckets (Mon-anchored), newest last. */
export function bucketWeekly(
  points: BookPoint[],
  sumKeys: (keyof BookPoint)[],
  lastKeys: (keyof BookPoint)[] = [],
): TSPoint[] {
  const weeks = new Map<string, TSPoint>();
  for (const p of points) {
    const d = new Date(`${p.date}T00:00:00Z`);
    const day = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - day);
    const key = d.toISOString().slice(0, 10);
    const cur: TSPoint = weeks.get(key) ?? { date: key };
    for (const k of sumKeys) cur[k as string] = (Number(cur[k as string]) || 0) + nz(p[k]);
    for (const k of lastKeys) cur[k as string] = nz(p[k]);
    weeks.set(key, cur);
  }
  return [...weeks.values()];
}
