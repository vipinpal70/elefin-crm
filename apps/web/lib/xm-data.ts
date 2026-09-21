import { connect, ExternalTrader, ExternalTrade } from "@elefin/db";
import { cached, hashKey } from "@elefin/cache";
import { plain } from "./serialize";

/* ── query parsing (mirrors clients-query.ts, kept lean for phase 1) ──── */

export type SP = Record<string, string | string[] | undefined>;

const SORTS = ["name", "email", "mt5Login", "tradingCapital", "trades", "lots", "commission"] as const;
export type XmSortKey = (typeof SORTS)[number];

export interface XmClientsQuery {
  page: number;
  perPage: number;
  q?: string;
  tag?: string;
  sort: XmSortKey;
  dir: "asc" | "desc";
}

const one = (v: string | string[] | undefined): string | undefined =>
  Array.isArray(v) ? v[0] : v;

export function parseXmClientsQuery(sp: SP): XmClientsQuery {
  const num = (v: string | undefined, def: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : def;
  };
  const sort = one(sp.sort);
  return {
    page: num(one(sp.page), 1),
    perPage: Math.min(num(one(sp.perPage), 50), 200),
    q: (one(sp.q) || "").trim() || undefined,
    tag: one(sp.tag) || undefined,
    sort: sort && (SORTS as readonly string[]).includes(sort) ? (sort as XmSortKey) : "name",
    dir: one(sp.dir) === "desc" ? "desc" : "asc",
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
  if (merged.sort !== "name") p.set("sort", merged.sort);
  if (merged.dir !== "asc") p.set("dir", merged.dir);
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

/** Cap on how many XM traders a single filter set can match — comfortably above real book size. */
const XM_ROWS_CAP = 5000;

export async function fetchXmClients(q: XmClientsQuery): Promise<XmClientsResult> {
  const all = await fetchAllXmClientRows(q);
  const start = (q.page - 1) * q.perPage;
  return { rows: all.slice(start, start + q.perPage), total: all.length };
}

/** Every row matching the filter, sorted — used by the paginated list and by CSV export alike. */
export async function fetchAllXmClientRows(q: XmClientsQuery): Promise<XmClientRow[]> {
  return cached(`xm-clients-all:${hashKey({ q: q.q, tag: q.tag, sort: q.sort, dir: q.dir })}`, { ttl: 60, tags: ["clients"] }, () =>
    loadAllXmClientRows(q),
  );
}

async function loadAllXmClientRows(q: XmClientsQuery): Promise<XmClientRow[]> {
  await connect();
  const filter: Record<string, unknown> = { brokerNormalized: "xm", confirmed: true };
  if (q.tag) filter.tags = q.tag;
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), "i");
    filter.$or = [{ name: rx }, { email: rx }, { mt5Login: { $regex: `^${escapeRegex(q.q)}` } }];
  }

  const rows = await ExternalTrader.find(filter, {
    name: 1,
    email: 1,
    mt5Login: 1,
    tradingCapital: 1,
    tags: 1,
    linkedClientId: 1,
    needsReview: 1,
  })
    .limit(XM_ROWS_CAP)
    .lean();

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

  const merged = rows.map((r) => {
    const s = r.mt5Login ? statsByLogin.get(r.mt5Login) : undefined;
    return plain<XmClientRow>({
      ...r,
      trades: s?.trades ?? 0,
      lots: s?.lots ?? 0,
      commission: s?.commission ?? 0,
    });
  });

  const dir = q.dir === "desc" ? -1 : 1;
  const val = (r: XmClientRow): string | number => {
    switch (q.sort) {
      case "email":
        return r.email ?? "";
      case "mt5Login":
        return r.mt5Login ?? "";
      case "tradingCapital":
        return r.tradingCapital ?? -Infinity;
      case "trades":
        return r.trades;
      case "lots":
        return r.lots;
      case "commission":
        return r.commission;
      case "name":
      default:
        return r.name || "";
    }
  };
  merged.sort((a, b) => {
    const av = val(a);
    const bv = val(b);
    if (typeof av === "string" || typeof bv === "string") {
      return String(av).localeCompare(String(bv)) * dir;
    }
    return (av - bv) * dir;
  });

  return merged;
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
