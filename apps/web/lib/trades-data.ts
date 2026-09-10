import { connect, Account, Client, Trade, Position } from "@elefin/db";
import { tradingStats, type TradingStats } from "@elefin/domain";
import { plain } from "./serialize";
import { parseRange, rangeClause, type DateRange } from "./range";
import type { SP } from "./clients-query";

const one = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v[0] : v) || undefined;

export interface TradeRow {
  _id: string;
  symbol: string | null;
  side: "buy" | "sell" | null;
  volumeLots: number;
  openPrice: number | null;
  closePrice: number | null;
  openAt: string | null;
  closeAt: string | null;
  holdingDurationSeconds: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  profit: number;
  commission: number;
  swap: number;
  netPnl: number;
}

export interface PositionRow {
  _id: string;
  symbol: string | null;
  side: "buy" | "sell" | null;
  volumeLots: number;
  openPrice: number | null;
  currentPrice: number | null;
  openAt: string | null;
  unrealizedPnl: number;
  asOf: string | null;
}

export interface AccountHistory {
  account: {
    _id: string;
    clientId: number | null;
    accountType: string | null;
    platformGroup: string | null;
    currency: string;
    balance: number;
    equity: number;
    leverage: number | null;
    lots: number;
    trades: number;
    netProfit: number;
    commission: number;
    lastTradeAt: string | null;
  };
  clientName: string | null;
  clientId: number | null;
  trades: TradeRow[];
  stats: TradingStats;
  positions: PositionRow[];
  symbols: string[];
  range: DateRange;
  symbol?: string;
}

export async function fetchAccountHistory(
  login: string,
  sp: SP,
): Promise<AccountHistory | null> {
  await connect();
  const account = await Account.findById(login).lean();
  if (!account) return null;

  const range = parseRange(sp);
  const symbol = one(sp.symbol);

  const filter: Record<string, unknown> = { login };
  const rc = rangeClause(range);
  if (rc) filter.closeAt = rc;
  if (symbol) filter.symbol = symbol;

  const [client, tradesRaw, symbols, positionsRaw] = await Promise.all([
    account.clientId != null
      ? Client.findById(account.clientId, { name: 1 }).lean()
      : null,
    Trade.find(filter).sort({ closeAt: 1 }).limit(5000).lean(),
    Trade.distinct("symbol", { login }),
    Position.find({ login }).sort({ openAt: -1 }).lean(),
  ]);

  const trades = tradesRaw.map((t) => plain<TradeRow>(t));

  return {
    account: plain(account),
    clientName: client?.name ?? null,
    clientId: account.clientId ?? null,
    trades,
    stats: tradingStats(trades),
    positions: positionsRaw.map((p) => plain<PositionRow>(p)),
    symbols: (symbols as (string | null)[]).filter((x): x is string => !!x).sort(),
    range,
    symbol,
  };
}
