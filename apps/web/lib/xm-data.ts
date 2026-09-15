import { connect, ExternalTrader, ExternalTrade } from "@elefin/db";
import { cached, hashKey } from "@elefin/cache";
import { plain } from "./serialize";

/* ── query parsing (mirrors clients-query.ts, kept lean for phase 1) ──── */

export type SP = Record<string, string | string[] | undefined>;

export interface XmClientsQuery {
  page: number;
  perPage: number;
  q?: string;
  tag?: string;
}

const one = (v: string | string[] | undefined): string | undefined =>
  Array.isArray(v) ? v[0] : v;

export function parseXmClientsQuery(sp: SP): XmClientsQuery {
  const num = (v: string | undefined, def: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : def;
  };
  return {
    page: num(one(sp.page), 1),
    perPage: Math.min(num(one(sp.perPage), 50), 200),
    q: (one(sp.q) || "").trim() || undefined,
    tag: one(sp.tag) || undefined,
  };
}

export function withXmParams(current: XmClientsQuery, patch: Partial<XmClientsQuery>): string {
  const changingPageOnly = Object.keys(patch).every((k) => k === "page");
  const merged: XmClientsQuery = {
    ...current,
    ...patch,
    page: changingPageOnly ? (patch.page ?? current.page) : 1,
  };
  const p = new URLSearchParams();
  if (merged.page > 1) p.set("page", String(merged.page));
  if (merged.q) p.set("q", merged.q);
  if (merged.tag) p.set("tag", merged.tag);
  const s = p.toString();
  return s ? `?${s}` : "";
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/* ── clients list ─────────────────────────────────────────────────── */

export interface XmClientRow {
  _id: string;
  name: string;
  email: string | null;
  mt5Login: string | null;
  tradingCapital: number | null;
  tags: string[];
  linkedClientId: number | null;
  needsReview: boolean;
  trades: number;
  lots: number;
  commission: number;
}

export interface XmClientsResult {
  rows: XmClientRow[];
  total: number;
}

export async function fetchXmClients(q: XmClientsQuery): Promise<XmClientsResult> {
  return cached(`xm-clients-list:${hashKey(q)}`, { ttl: 60, tags: ["clients"] }, () => loadXmClients(q));
}

async function loadXmClients(q: XmClientsQuery): Promise<XmClientsResult> {
  await connect();
  const filter: Record<string, unknown> = { brokerNormalized: "xm", confirmed: true };
  if (q.tag) filter.tags = q.tag;
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), "i");
    filter.$or = [{ name: rx }, { email: rx }, { mt5Login: { $regex: `^${escapeRegex(q.q)}` } }];
  }

  const [rows, total] = await Promise.all([
    ExternalTrader.find(filter, {
      name: 1,
      email: 1,
      mt5Login: 1,
      tradingCapital: 1,
      tags: 1,
      linkedClientId: 1,
      needsReview: 1,
    })
      .sort({ _id: -1 })
      .skip((q.page - 1) * q.perPage)
      .limit(q.perPage)
      .lean(),
    ExternalTrader.countDocuments(filter),
  ]);

  const logins = rows.map((r) => r.mt5Login).filter((x): x is string => !!x);
  const stats = logins.length
    ? await ExternalTrade.aggregate<{ _id: string; trades: number; lots: number; commission: number }>([
        { $match: { login: { $in: logins } } },
        {
          $group: {
            _id: "$login",
            trades: { $sum: 1 },
            lots: { $sum: { $toDouble: "$volumeLots" } },
            commission: { $sum: { $toDouble: "$commission" } },
          },
        },
      ])
    : [];
  const statsByLogin = new Map(stats.map((s) => [s._id, s]));

  return {
    rows: rows.map((r) => {
      const s = r.mt5Login ? statsByLogin.get(r.mt5Login) : undefined;
      return {
        ...plain<Omit<XmClientRow, "trades" | "lots" | "commission">>(r),
        trades: s?.trades ?? 0,
        lots: s?.lots ?? 0,
        commission: s?.commission ?? 0,
      };
    }),
    total,
  };
}

/* ── client profile ──────────────────────────────────────────────── */

export interface XmTradeRow {
  _id: string;
  symbol: string | null;
  side: string | null;
  volumeLots: number;
  openPrice: number | null;
  closePrice: number | null;
  openAt: string | null;
  closeAt: string | null;
  commission: number;
  affiliateCommission: number;
}

export interface XmClientDetail {
  _id: string;
  name: string;
  email: string | null;
  phone: string | null;
  mt5Login: string | null;
  tradingCapital: number | null;
  remarks: string | null;
  tags: string[];
  linkedClientId: number | null;
  needsReview: boolean;
  reviewReason: string | null;
  trades: XmTradeRow[];
  totalTrades: number;
  totalLots: number;
  totalCommission: number;
}

export async function fetchXmClient(id: string): Promise<XmClientDetail | null> {
  if (!/^[0-9a-f]{24}$/i.test(id)) return null;
  await connect();
  const trader = await ExternalTrader.findById(id).lean();
  if (!trader || !trader.confirmed) return null;

  const tradeDocs = trader.mt5Login
    ? await ExternalTrade.find({ login: trader.mt5Login })
        .sort({ closeAt: -1 })
        .limit(200)
        .lean()
    : [];
  const trades = tradeDocs.map((t) => plain<XmTradeRow>(t));

  const totals = trades.reduce(
    (acc, t) => {
      acc.lots += t.volumeLots;
      acc.commission += t.commission;
      return acc;
    },
    { lots: 0, commission: 0 },
  );

  return {
    ...plain<Omit<XmClientDetail, "trades" | "totalTrades" | "totalLots" | "totalCommission">>(trader),
    trades,
    totalTrades: trades.length,
    totalLots: totals.lots,
    totalCommission: totals.commission,
  };
}

/* ── dashboard ────────────────────────────────────────────────────── */

export interface XmDashboard {
  totalTraders: number;
  linkedTraders: number;
  flaggedTraders: number;
  totalTrades: number;
  totalLots: number;
  totalCommission: number;
  recentTraders: Array<{ _id: string; name: string; email: string | null; mt5Login: string | null }>;
}

export async function fetchXmDashboard(): Promise<XmDashboard> {
  return cached("xm-dashboard", { ttl: 120, tags: ["clients"] }, loadXmDashboard);
}

async function loadXmDashboard(): Promise<XmDashboard> {
  await connect();
  const filter = { brokerNormalized: "xm" as const, confirmed: true };

  const [totalTraders, linkedTraders, flaggedTraders, recent, [tradeAgg]] = await Promise.all([
    ExternalTrader.countDocuments(filter),
    ExternalTrader.countDocuments({ ...filter, linkedClientId: { $ne: null } }),
    ExternalTrader.countDocuments({ ...filter, needsReview: true }),
    ExternalTrader.find(filter, { name: 1, email: 1, mt5Login: 1 }).sort({ _id: -1 }).limit(8).lean(),
    ExternalTrade.aggregate<{ trades: number; lots: number; commission: number }>([
      { $match: { broker: "xm" } },
      {
        $group: {
          _id: null,
          trades: { $sum: 1 },
          lots: { $sum: { $toDouble: "$volumeLots" } },
          commission: { $sum: { $toDouble: "$commission" } },
        },
      },
    ]),
  ]);

  return {
    totalTraders,
    linkedTraders,
    flaggedTraders,
    totalTrades: tradeAgg?.trades ?? 0,
    totalLots: tradeAgg?.lots ?? 0,
    totalCommission: tradeAgg?.commission ?? 0,
    recentTraders: recent.map((r) => plain(r)),
  };
}
