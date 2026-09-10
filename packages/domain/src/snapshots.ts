import { n, round, sumBy } from "./money";
import { utcDayStart } from "./time";
import type { ClientRowLike } from "./kpis";

/**
 * Snapshot builders (project-structure-plan.md §5.2). Phase 3 wires these into
 * the daily worker job; the shapes are fixed here so `book_daily` / `client_daily`
 * documents are written consistently.
 */

export interface ClientDailyDraft {
  date: Date;
  meta: { clientId: number; referralCode: string | null };
  isFunded: boolean;
  status: string;
  fundingDeposits: number;
  fundingWithdrawals: number;
  fundingNetDeposit: number;
  accountsBalance: number;
  accountsEquity: number;
  tradingLots: number;
  tradingTrades: number;
  tradingNetProfit: number;
  commissionEarned: number;
}

export interface BookDailyDraft {
  date: Date;
  meta: { referralCode: string };
  clientsTotal: number;
  clientsFunded: number;
  clientsActiveTraders: number;
  depositsCum: number;
  withdrawalsCum: number;
  netDepositCum: number;
  balanceTotal: number;
  equityTotal: number;
  lotsCum: number;
  tradesCum: number;
  clientPnlCum: number;
  commissionCum: number;
}

type WithId = ClientRowLike & { _id?: number; clientId?: number };

export function buildClientDaily(client: WithId, at: Date): ClientDailyDraft {
  return {
    date: utcDayStart(at),
    meta: {
      clientId: Number(client._id ?? client.clientId ?? 0),
      referralCode: client.referralCode ?? null,
    },
    isFunded: Boolean(client.fundingIsFunded),
    status: client.status ?? "active",
    fundingDeposits: round(n(client.fundingDeposits)),
    fundingWithdrawals: round(n(client.fundingWithdrawals)),
    fundingNetDeposit: round(n(client.fundingNetDeposit)),
    accountsBalance: round(n(client.accountsBalance)),
    accountsEquity: round(n(client.accountsEquity)),
    tradingLots: round(n(client.tradingLots), 2),
    tradingTrades: n(client.tradingTrades),
    tradingNetProfit: round(n(client.tradingNetProfit)),
    commissionEarned: round(n(client.commissionEarned)),
  };
}

/** Roll a set of clients (already filtered to one code, or all) into one day. */
export function buildBookDaily(
  clients: readonly WithId[],
  referralCode: string,
  at: Date,
): BookDailyDraft {
  const deposits = sumBy(clients, (c) => c.fundingDeposits);
  const withdrawals = sumBy(clients, (c) => c.fundingWithdrawals);
  return {
    date: utcDayStart(at),
    meta: { referralCode },
    clientsTotal: clients.length,
    clientsFunded: clients.filter((c) => c.fundingIsFunded).length,
    clientsActiveTraders: clients.filter((c) => n(c.tradingTrades) > 0).length,
    depositsCum: round(deposits),
    withdrawalsCum: round(withdrawals),
    netDepositCum: round(deposits - withdrawals),
    balanceTotal: round(sumBy(clients, (c) => c.accountsBalance)),
    equityTotal: round(sumBy(clients, (c) => c.accountsEquity)),
    lotsCum: round(sumBy(clients, (c) => c.tradingLots), 2),
    tradesCum: sumBy(clients, (c) => c.tradingTrades),
    clientPnlCum: round(sumBy(clients, (c) => c.tradingNetProfit)),
    commissionCum: round(sumBy(clients, (c) => c.commissionEarned)),
  };
}
