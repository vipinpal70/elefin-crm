import { BookDaily, Client, FundingEvent, Trade } from "@elefin/db";
import { log } from "../logger";
import type { Job } from "../runner";

const DAY_MS = 86_400_000;
const ALL = "*";

const dayStartUtc = (d: Date | string | number): Date => {
  const t = new Date(d);
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()));
};
const dayKey = (d: Date): string => d.toISOString().slice(0, 10);
const inc = (m: Map<string, number>, k: string, by = 1) =>
  m.set(k, (m.get(k) ?? 0) + by);

interface BuildOpts {
  /** Rebuild snapshots from this UTC day (inclusive). */
  from?: Date;
  /** ...through this UTC day (inclusive). Defaults to today. */
  to?: Date;
  /** Rebuild the entire history (overrides `from`). */
  full?: boolean;
}

export interface BuildResult {
  codes: string[];
  days: number;
  rowsWritten: number;
  from: string;
  to: string;
}

/**
 * Reconstruct `book_daily` from source. The Elefin API has no history, but we
 * can rebuild most of it: signups from `clients.registeredAt`, the funded /
 * active counts from each client's first deposit / first trade, and the
 * deposit / withdrawal / trade flows from `funding_events` / `trades` by day.
 * Balance, equity and commission have no history — only the latest day carries
 * their current totals; those trend lines fill in as snapshots accumulate.
 *
 * Idempotent: for each (code, day) in range it deletes then re-inserts.
 */
export async function buildSnapshots(opts: BuildOpts = {}): Promise<BuildResult> {
  const to = dayStartUtc(opts.to ?? new Date());

  const clients = await Client.find(
    {},
    {
      referralCode: 1,
      registeredAt: 1,
      accountsBalance: 1,
      accountsEquity: 1,
      commissionEarned: 1,
    },
  ).lean();

  const codeOf = new Map<number, string>(
    clients.map((c) => [c._id, c.referralCode || "unknown"]),
  );

  // first successful deposit / first trade per client -> "funded on" / "active on"
  const [firstDep, firstTrade, txnByDay, tradeByDay] = await Promise.all([
    FundingEvent.aggregate<{ _id: number; first: Date }>([
      { $match: { type: "deposit", status: "success", clientId: { $ne: null } } },
      { $group: { _id: "$clientId", first: { $min: "$occurredAt" } } },
    ]),
    Trade.aggregate<{ _id: number; first: Date }>([
      { $match: { clientId: { $ne: null }, closeAt: { $ne: null } } },
      { $group: { _id: "$clientId", first: { $min: "$closeAt" } } },
    ]),
    FundingEvent.aggregate<{
      _id: { day: Date; clientId: number; type: string };
      amt: number;
    }>([
      { $match: { status: "success", occurredAt: { $ne: null } } },
      {
        $group: {
          _id: {
            day: { $dateTrunc: { date: "$occurredAt", unit: "day", timezone: "UTC" } },
            clientId: "$clientId",
            type: "$type",
          },
          amt: { $sum: { $toDouble: "$amount" } },
        },
      },
    ]),
    Trade.aggregate<{
      _id: { day: Date; clientId: number };
      pnl: number;
      lots: number;
      n: number;
    }>([
      { $match: { closeAt: { $ne: null } } },
      {
        $group: {
          _id: {
            day: { $dateTrunc: { date: "$closeAt", unit: "day", timezone: "UTC" } },
            clientId: "$clientId",
          },
          pnl: { $sum: { $toDouble: "$netPnl" } },
          lots: { $sum: { $toDouble: "$volumeLots" } },
          n: { $sum: 1 },
        },
      },
    ]),
  ]);

  const fundedDay = new Map(firstDep.map((r) => [r._id, dayKey(dayStartUtc(r.first))]));
  const activeDay = new Map(
    firstTrade.map((r) => [r._id, dayKey(dayStartUtc(r.first))]),
  );

  // earliest relevant day, for `full` backfill
  const earliest = [
    ...clients.map((c) => c.registeredAt).filter(Boolean),
    ...firstDep.map((r) => r.first),
    ...firstTrade.map((r) => r.first),
  ]
    .map((d) => new Date(d as Date).getTime())
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b)[0];

  const from = dayStartUtc(
    opts.full && earliest
      ? new Date(earliest)
      : (opts.from ?? new Date(to.getTime() - 2 * DAY_MS)),
  );

  const codes = [ALL, ...new Set([...codeOf.values()])].filter(Boolean);
  const toKey = dayKey(to);

  // pre-bucket flows keyed by "code|day"
  const perCode = (id: number) => codeOf.get(id) ?? "unknown";
  const depDay = new Map<string, number>();
  const wdDay = new Map<string, number>();
  for (const r of txnByDay) {
    if (r._id.clientId == null) continue;
    const k = dayKey(dayStartUtc(r._id.day));
    const c = perCode(r._id.clientId);
    const target = r._id.type === "withdrawal" ? wdDay : depDay;
    inc(target, `${ALL}|${k}`, r.amt);
    inc(target, `${c}|${k}`, r.amt);
  }

  const pnlDay = new Map<string, number>();
  const lotsDay = new Map<string, number>();
  const tradesDay = new Map<string, number>();
  for (const r of tradeByDay) {
    const k = dayKey(dayStartUtc(r._id.day));
    const c = r._id.clientId != null ? perCode(r._id.clientId) : "unknown";
    inc(pnlDay, `${ALL}|${k}`, r.pnl);
    inc(pnlDay, `${c}|${k}`, r.pnl);
    inc(lotsDay, `${ALL}|${k}`, r.lots);
    inc(lotsDay, `${c}|${k}`, r.lots);
    inc(tradesDay, `${ALL}|${k}`, r.n);
    inc(tradesDay, `${c}|${k}`, r.n);
  }

  const signupsDay = new Map<string, number>();
  const fundedOnDay = new Map<string, number>();
  const activeOnDay = new Map<string, number>();
  for (const c of clients) {
    const code = c.referralCode || "unknown";
    if (c.registeredAt) {
      const k = dayKey(dayStartUtc(c.registeredAt));
      inc(signupsDay, `${ALL}|${k}`, 1);
      inc(signupsDay, `${code}|${k}`, 1);
    }
    const fd = fundedDay.get(c._id);
    if (fd) {
      inc(fundedOnDay, `${ALL}|${fd}`, 1);
      inc(fundedOnDay, `${code}|${fd}`, 1);
    }
    const ad = activeDay.get(c._id);
    if (ad) {
      inc(activeOnDay, `${ALL}|${ad}`, 1);
      inc(activeOnDay, `${code}|${ad}`, 1);
    }
  }

  const currentByCode = new Map<string, { balance: number; equity: number; commission: number }>();
  for (const code of codes) currentByCode.set(code, { balance: 0, equity: 0, commission: 0 });
  for (const c of clients) {
    const add = (code: string) => {
      const cur = currentByCode.get(code);
      if (!cur) return;
      cur.balance += Number(c.accountsBalance ?? 0);
      cur.equity += Number(c.accountsEquity ?? 0);
      cur.commission += Number(c.commissionEarned ?? 0);
    };
    add(ALL);
    add(c.referralCode || "unknown");
  }

  const r2 = (x: number) => Math.round(x * 100) / 100;
  const fromKey = dayKey(from);
  let rowsWritten = 0;
  let dayCount = 0;

  // every day-key that carries any data, sorted — used to seed running totals
  // for days that fall before `from` (a daily run only rebuilds the tail).
  const priorKeys = [
    ...new Set(
      [
        ...signupsDay.keys(),
        ...fundedOnDay.keys(),
        ...activeOnDay.keys(),
        ...depDay.keys(),
        ...wdDay.keys(),
        ...tradesDay.keys(),
        ...lotsDay.keys(),
        ...pnlDay.keys(),
      ].map((k) => k.slice(k.indexOf("|") + 1)),
    ),
  ]
    .filter((k) => k < fromKey)
    .sort();

  for (const code of codes) {
    const run = { clients: 0, funded: 0, active: 0, dep: 0, wd: 0, trades: 0, lots: 0, pnl: 0 };
    for (const k of priorKeys) {
      run.clients += signupsDay.get(`${code}|${k}`) ?? 0;
      run.funded += fundedOnDay.get(`${code}|${k}`) ?? 0;
      run.active += activeOnDay.get(`${code}|${k}`) ?? 0;
      run.dep += depDay.get(`${code}|${k}`) ?? 0;
      run.wd += wdDay.get(`${code}|${k}`) ?? 0;
      run.trades += tradesDay.get(`${code}|${k}`) ?? 0;
      run.lots += lotsDay.get(`${code}|${k}`) ?? 0;
      run.pnl += pnlDay.get(`${code}|${k}`) ?? 0;
    }

    const rows: Record<string, unknown>[] = [];
    for (let d = new Date(from); d.getTime() <= to.getTime(); d = new Date(d.getTime() + DAY_MS)) {
      const k = dayKey(d);
      const s = signupsDay.get(`${code}|${k}`) ?? 0;
      const dd = depDay.get(`${code}|${k}`) ?? 0;
      const wd = wdDay.get(`${code}|${k}`) ?? 0;
      const pd = pnlDay.get(`${code}|${k}`) ?? 0;
      run.clients += s;
      run.funded += fundedOnDay.get(`${code}|${k}`) ?? 0;
      run.active += activeOnDay.get(`${code}|${k}`) ?? 0;
      run.dep += dd;
      run.wd += wd;
      run.trades += tradesDay.get(`${code}|${k}`) ?? 0;
      run.lots += lotsDay.get(`${code}|${k}`) ?? 0;
      run.pnl += pd;

      const isLast = k === toKey;
      const cur = currentByCode.get(code) ?? { balance: 0, equity: 0, commission: 0 };
      rows.push({
        date: d,
        meta: { referralCode: code },
        clientsTotal: run.clients,
        clientsFunded: run.funded,
        clientsActiveTraders: run.active,
        newSignups: s,
        churned: 0,
        netChange: s,
        tradesCum: run.trades,
        depositsCum: r2(run.dep),
        withdrawalsCum: r2(run.wd),
        netDepositCum: r2(run.dep - run.wd),
        balanceTotal: isLast ? r2(cur.balance) : 0,
        equityTotal: isLast ? r2(cur.equity) : 0,
        lotsCum: r2(run.lots),
        clientPnlCum: r2(run.pnl),
        commissionCum: isLast ? r2(cur.commission) : 0,
        depositsDay: r2(dd),
        withdrawalsDay: r2(wd),
        commissionDay: 0,
        clientPnlDay: r2(pd),
      });
    }

    await BookDaily.deleteMany({
      "meta.referralCode": code,
      date: { $gte: from, $lte: to },
    });
    if (rows.length) await BookDaily.insertMany(rows, { ordered: false });
    rowsWritten += rows.length;
    dayCount = rows.length;
  }

  return {
    codes,
    days: dayCount,
    rowsWritten,
    from: dayKey(from),
    to: toKey,
  };
}

export const snapshotJob: Job = async () => {
  const res = await buildSnapshots();
  log.info(
    `snapshots: ${res.rowsWritten} rows across ${res.codes.length} codes ` +
      `for ${res.from}..${res.to}`,
  );
  return {
    docsUpserted: res.rowsWritten,
    meta: { ...res } as Record<string, unknown>,
  };
};
