import { connect, Trade } from "@elefin/db";
import type { FilterQuery } from "mongoose";
import { cached, hashKey } from "@elefin/cache";
import { plain } from "./serialize";
import { parseRange, rangeClause } from "./range";
import type { SP } from "./clients-query";

const one = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v[0] : v) || undefined;
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export interface ClientTradesQuery {
  page: number;
  perPage: number;
  from?: string;
  to?: string;
  fromDate?: Date;
  toDate?: Date;
  symbol?: string;
  side?: "buy" | "sell";
  result?: "win" | "loss";
  login?: string;
  q?: string;
}

export function parseClientTradesQuery(sp: SP): ClientTradesQuery {
  const r = parseRange(sp);
  const n = (v: string | undefined, d: number) => {
    const x = Number(v);
    return Number.isFinite(x) && x > 0 ? Math.floor(x) : d;
  };
  const side = one(sp.side);
  const result = one(sp.result);
  return {
    page: n(one(sp.page), 1),
    perPage: Math.min(n(one(sp.perPage), 20), 100),
    symbol: one(sp.symbol) || undefined,
    side: side === "buy" || side === "sell" ? side : undefined,
    result: result === "win" || result === "loss" ? result : undefined,
    login: one(sp.login) || undefined,
    q: (one(sp.q) || "").trim() || undefined,
    ...r,
  };
}

function buildFilter(
  clientId: number,
  q: ClientTradesQuery,
): FilterQuery<Record<string, unknown>> {
  const filter: FilterQuery<Record<string, unknown>> = { clientId };
  const rc = rangeClause(q);
  if (rc) filter.closeAt = rc;
  if (q.symbol) filter.symbol = q.symbol;
  if (q.side) filter.side = q.side;
  if (q.login) filter.login = q.login;
  if (q.result === "win") filter.netPnl = { $gt: 0 };
  if (q.result === "loss") filter.netPnl = { $lt: 0 };
  if (q.q) filter._id = new RegExp(escapeRegex(q.q), "i");
  return filter;
}

export interface ClientTradeRow {
  _id: string;
  login: string;
  symbol: string | null;
  side: "buy" | "sell" | null;
  volumeLots: number;
  openPrice: number | null;
  closePrice: number | null;
  openAt: string | null;
  closeAt: string | null;
  holdingDurationSeconds: number | null;
  commission: number;
  swap: number;
  netPnl: number;
}

export interface ClientTradesResult {
  rows: ClientTradeRow[];
  total: number;
  symbols: string[];
  logins: string[];
}

/** One client's closed trades across all their accounts — filtered, paginated. */
export async function fetchClientTrades(
  clientId: number,
  q: ClientTradesQuery,
): Promise<ClientTradesResult> {
  return cached(
    `client-trades:${clientId}:${hashKey(q)}`,
    { ttl: 60, tags: ["trades"] },
    () => loadClientTrades(clientId, q),
  );
}

async function loadClientTrades(
  clientId: number,
  q: ClientTradesQuery,
): Promise<ClientTradesResult> {
  await connect();
  const filter = buildFilter(clientId, q);

  const [docs, total, symbols, logins] = await Promise.all([
    Trade.find(filter)
      .sort({ closeAt: -1, _id: -1 })
      .skip((q.page - 1) * q.perPage)
      .limit(q.perPage)
      .lean(),
    Trade.countDocuments(filter),
    Trade.distinct("symbol", { clientId }),
    Trade.distinct("login", { clientId }),
  ]);

  return {
    rows: docs.map((d) => plain<ClientTradeRow>(d)),
    total,
    symbols: (symbols as (string | null)[]).filter((x): x is string => !!x).sort(),
    logins: (logins as (string | null)[]).filter((x): x is string => !!x).sort(),
  };
}

export function clientTradesQs(q: Partial<ClientTradesQuery>): string {
  const p = new URLSearchParams();
  if (q.symbol) p.set("symbol", q.symbol);
  if (q.side) p.set("side", q.side);
  if (q.result) p.set("result", q.result);
  if (q.login) p.set("login", q.login);
  if (q.q) p.set("q", q.q);
  if (q.from) p.set("from", q.from);
  if (q.to) p.set("to", q.to);
  if (q.page && q.page > 1) p.set("page", String(q.page));
  const s = p.toString();
  return s ? `?${s}` : "";
}
