import { n, pct, round, sumBy, type Num } from "./money";

/**
 * Book-level KPIs computed from a set of client rows. See project-structure-plan.md
 * §8 for the authoritative definitions. Trend/in-range variants (which need
 * `client_daily` deltas) land with the snapshot builder in Phase 3.
 */
export interface ClientRowLike {
  fundingIsFunded?: boolean;
  status?: string;
  registeredAt?: Date | string | null;
  referralCode?: string | null;
  country?: string | null;
  fundingDeposits?: Num;
  fundingWithdrawals?: Num;
  fundingNetDeposit?: Num;
  accountsBalance?: Num;
  accountsEquity?: Num;
  tradingLots?: Num;
  tradingTrades?: Num;
  tradingNetProfit?: Num;
  tradingLastTradeAt?: Date | string | null;
  commissionEarned?: Num;
}

export interface BookKpis {
  clientsTotal: number;
  clientsFunded: number;
  fundedRate: number;
  activeTraders: number;
  activeRate: number;
  dormantClients: number;
  totalDeposits: number;
  totalWithdrawals: number;
  netDeposits: number;
  withdrawalRatio: number;
  avgDepositPerFunded: number;
  totalLots: number;
  totalTrades: number;
  clientPnl: number;
  /** Loss side only: Σ negative client PnL (the plan's primary "total lost"). */
  totalLost: number;
  commissionEarned: number;
  commissionPerLot: number;
  commissionPerFunded: number;
  balanceTotal: number;
  equityTotal: number;
}

export interface BookKpiOptions {
  /** Days since last trade past which a funded client counts as dormant. */
  dormantAfterDays?: number;
  /** "Now" for the dormancy clock; defaults to Date.now(). */
  asOf?: Date;
}

export function bookKpis(
  clients: readonly ClientRowLike[],
  opts: BookKpiOptions = {},
): BookKpis {
  const dormantAfterDays = opts.dormantAfterDays ?? 30;
  const asOf = (opts.asOf ?? new Date()).getTime();
  const dormantCutoffMs = dormantAfterDays * 86_400_000;

  const funded = clients.filter((c) => c.fundingIsFunded);
  const activeTraders = clients.filter((c) => n(c.tradingTrades) > 0);

  const dormant = funded.filter((c) => {
    if (!c.tradingLastTradeAt) return true;
    return asOf - new Date(c.tradingLastTradeAt).getTime() > dormantCutoffMs;
  });

  const totalDeposits = sumBy(clients, (c) => c.fundingDeposits);
  const totalWithdrawals = sumBy(clients, (c) => c.fundingWithdrawals);
  const totalLots = sumBy(clients, (c) => c.tradingLots);
  const commissionEarned = sumBy(clients, (c) => c.commissionEarned);
  const clientPnl = sumBy(clients, (c) => c.tradingNetProfit);
  const totalLost = sumBy(
    clients.filter((c) => n(c.tradingNetProfit) < 0),
    (c) => c.tradingNetProfit,
  );

  return {
    clientsTotal: clients.length,
    clientsFunded: funded.length,
    fundedRate: pct(funded.length, clients.length),
    activeTraders: activeTraders.length,
    activeRate: pct(activeTraders.length, clients.length),
    dormantClients: dormant.length,
    totalDeposits: round(totalDeposits),
    totalWithdrawals: round(totalWithdrawals),
    netDeposits: round(totalDeposits - totalWithdrawals),
    withdrawalRatio: round(totalDeposits ? totalWithdrawals / totalDeposits : 0, 4),
    avgDepositPerFunded: funded.length ? round(totalDeposits / funded.length) : 0,
    totalLots: round(totalLots, 2),
    totalTrades: sumBy(clients, (c) => c.tradingTrades),
    clientPnl: round(clientPnl),
    totalLost: round(totalLost),
    commissionEarned: round(commissionEarned),
    commissionPerLot: totalLots ? round(commissionEarned / totalLots, 4) : 0,
    commissionPerFunded: funded.length ? round(commissionEarned / funded.length, 4) : 0,
    balanceTotal: round(sumBy(clients, (c) => c.accountsBalance)),
    equityTotal: round(sumBy(clients, (c) => c.accountsEquity)),
  };
}

export interface FunnelStage {
  key: "signed_up" | "funded" | "traded" | "active";
  label: string;
  count: number;
  rateOfPrev: number;
  rateOfTop: number;
}

/** Signed up -> Funded -> Placed a trade -> Active (traded recently). */
export function conversionFunnel(
  clients: readonly ClientRowLike[],
  opts: BookKpiOptions = {},
): FunnelStage[] {
  const asOf = (opts.asOf ?? new Date()).getTime();
  const activeWithinMs = (opts.dormantAfterDays ?? 30) * 86_400_000;

  const signedUp = clients.length;
  const funded = clients.filter((c) => c.fundingIsFunded).length;
  const traded = clients.filter((c) => n(c.tradingTrades) > 0).length;
  const active = clients.filter(
    (c) =>
      n(c.tradingTrades) > 0 &&
      c.tradingLastTradeAt != null &&
      asOf - new Date(c.tradingLastTradeAt).getTime() <= activeWithinMs,
  ).length;

  const rows: Array<[FunnelStage["key"], string, number]> = [
    ["signed_up", "Signed up", signedUp],
    ["funded", "Funded", funded],
    ["traded", "Placed a trade", traded],
    ["active", "Active", active],
  ];

  return rows.map(([key, label, count], i) => {
    const prev = i === 0 ? count : rows[i - 1]![2];
    return {
      key,
      label,
      count,
      rateOfPrev: pct(count, prev),
      rateOfTop: pct(count, signedUp),
    };
  });
}
