import { n, round, type Num } from "../money";
import { utcDayKey } from "../time";

export interface TradeLike {
  symbol?: string | null;
  side?: string | null;
  volumeLots?: Num;
  profit?: Num;
  commission?: Num;
  swap?: Num;
  netPnl?: Num;
  openAt?: Date | string | null;
  closeAt?: Date | string | null;
}

export interface DailyPnl {
  date: string; // YYYY-MM-DD (UTC)
  pnl: number;
  trades: number;
}

export interface SymbolStat {
  symbol: string;
  trades: number;
  lots: number;
  netPnl: number;
  winRate: number;
}

export interface EquityPoint {
  t: string; // ISO close time
  cum: number;
}

export interface TradingStats {
  trades: number;
  wins: number;
  losses: number;
  breakeven: number;
  winRate: number;
  netPnl: number;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number | null;
  avgWin: number;
  avgLoss: number;
  expectancy: number;
  largestWin: number;
  largestLoss: number;
  totalLots: number;
  commissionPaid: number;
  swapPaid: number;
  avgHoldingMs: number | null;
  maxDrawdown: number;
  maxDrawdownPct: number;
  equityCurve: EquityPoint[];
  dailyPnl: DailyPnl[];
  bySymbol: SymbolStat[];
}

export function netOf(t: TradeLike): number {
  if (t.netPnl !== undefined && t.netPnl !== null && t.netPnl !== "") {
    return n(t.netPnl);
  }
  return n(t.profit) + n(t.commission) + n(t.swap);
}

/** Full per-account trading analysis. Pure; order of input does not matter. */
export function tradingStats(input: readonly TradeLike[]): TradingStats {
  const trades = [...input].sort(
    (a, b) => timeOf(a.closeAt) - timeOf(b.closeAt),
  );

  let wins = 0;
  let losses = 0;
  let breakeven = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  let largestWin = 0;
  let largestLoss = 0;
  let totalLots = 0;
  let commissionPaid = 0;
  let swapPaid = 0;
  let holdingSum = 0;
  let holdingCount = 0;

  const daily = new Map<string, { pnl: number; trades: number }>();
  const symbols = new Map<
    string,
    { trades: number; lots: number; netPnl: number; wins: number }
  >();
  const equityCurve: EquityPoint[] = [];
  let cum = 0;
  let peak = 0;
  let maxDrawdown = 0;
  let maxDrawdownPct = 0;

  for (const t of trades) {
    const net = netOf(t);
    const lots = n(t.volumeLots);
    totalLots += lots;
    commissionPaid += n(t.commission);
    swapPaid += n(t.swap);

    if (net > 0) {
      wins += 1;
      grossProfit += net;
      if (net > largestWin) largestWin = net;
    } else if (net < 0) {
      losses += 1;
      grossLoss += -net;
      if (net < largestLoss) largestLoss = net;
    } else {
      breakeven += 1;
    }

    if (t.openAt && t.closeAt) {
      const held = timeOf(t.closeAt) - timeOf(t.openAt);
      if (held >= 0) {
        holdingSum += held;
        holdingCount += 1;
      }
    }

    const dayKey = t.closeAt ? utcDayKey(t.closeAt) : "unknown";
    const d = daily.get(dayKey) ?? { pnl: 0, trades: 0 };
    d.pnl += net;
    d.trades += 1;
    daily.set(dayKey, d);

    const sym = (t.symbol ?? "unknown").toString();
    const s = symbols.get(sym) ?? { trades: 0, lots: 0, netPnl: 0, wins: 0 };
    s.trades += 1;
    s.lots += lots;
    s.netPnl += net;
    if (net > 0) s.wins += 1;
    symbols.set(sym, s);

    cum += net;
    if (t.closeAt) equityCurve.push({ t: new Date(t.closeAt).toISOString(), cum: round(cum) });
    if (cum > peak) peak = cum;
    const dd = peak - cum;
    if (dd > maxDrawdown) {
      maxDrawdown = dd;
      maxDrawdownPct = peak > 0 ? round((dd / peak) * 100, 2) : 0;
    }
  }

  const count = trades.length;
  const netPnl = grossProfit - grossLoss;

  return {
    trades: count,
    wins,
    losses,
    breakeven,
    winRate: count ? round(wins / count, 4) : 0,
    netPnl: round(netPnl),
    grossProfit: round(grossProfit),
    grossLoss: round(grossLoss),
    profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss, 3) : null,
    avgWin: wins ? round(grossProfit / wins) : 0,
    avgLoss: losses ? round(-grossLoss / losses) : 0,
    expectancy: count ? round(netPnl / count) : 0,
    largestWin: round(largestWin),
    largestLoss: round(largestLoss),
    totalLots: round(totalLots, 2),
    commissionPaid: round(commissionPaid),
    swapPaid: round(swapPaid),
    avgHoldingMs: holdingCount ? Math.round(holdingSum / holdingCount) : null,
    maxDrawdown: round(maxDrawdown),
    maxDrawdownPct,
    equityCurve,
    dailyPnl: [...daily.entries()]
      .filter(([k]) => k !== "unknown")
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([date, v]) => ({ date, pnl: round(v.pnl), trades: v.trades })),
    bySymbol: [...symbols.entries()]
      .map(([symbol, v]) => ({
        symbol,
        trades: v.trades,
        lots: round(v.lots, 2),
        netPnl: round(v.netPnl),
        winRate: v.trades ? round(v.wins / v.trades, 4) : 0,
      }))
      .sort((a, b) => b.trades - a.trades),
  };
}

function timeOf(v: Date | string | null | undefined): number {
  if (!v) return 0;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : 0;
}
