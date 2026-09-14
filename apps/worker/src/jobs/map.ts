import { dec } from "@elefin/db";
import type { Types } from "mongoose";
import type {
  RawAccount,
  RawAccountItem,
  RawClient,
  RawPosition,
  RawTrade,
  RawTransaction,
} from "@elefin/elefin-client";

/** Coerce an API number/string to Decimal128, defaulting missing -> "0". */
const money = (v: unknown): Types.Decimal128 =>
  dec(v == null || v === "" ? "0" : (v as number | string)) as Types.Decimal128;

/** Like `money` but preserves null (for optional Decimal fields). */
const moneyOrNull = (v: unknown): Types.Decimal128 | null =>
  v == null || v === "" ? null : (dec(v as number | string) as Types.Decimal128);

/**
 * Elefin has a confirmed API bug (2026-09): lifetime-P&L fields
 * (`trading.net_profit`, `accounts.items[].net_profit`, per-trade `profit` /
 * `net_profit`) can come back `null` instead of `0`. Other fields (lots,
 * trades, commission, swap) are unaffected. Support's own workaround for the
 * client/account aggregate: the same figure equals balance minus total
 * deposits plus total withdrawals — use it whenever the direct field is null.
 */
const derivedNetProfit = (
  balance: unknown,
  deposits: unknown,
  withdrawals: unknown,
): number | null => {
  if (balance == null || deposits == null) return null;
  const raw = Number(balance) - Number(deposits) + Number(withdrawals ?? 0);
  return Math.round(raw * 100) / 100; // avoid float noise like -6.680000000000007
};

/**
 * Sum each account's own net_profit (falling back per-account to
 * `derivedNetProfit`) instead of deriving one figure from the client-wide
 * balance/deposit/withdrawal totals. More accurate whenever `/clients/{id}`'s
 * `accounts.items[]` is available: the client-wide formula silently assumes
 * commission/fees net out cleanly against total deposits across every
 * account, which doesn't always hold (seen live: a client whose account-level
 * net_profit was -101.82 derived to only -100 at the client-wide level).
 */
const sumAccountNetProfit = (items: RawAccountItem[]): number => {
  const total = items.reduce((sum, it) => {
    const v =
      it.net_profit ??
      derivedNetProfit(it.balance, it.total_deposit, it.total_withdrawal);
    return sum + (v ?? 0);
  }, 0);
  return Math.round(total * 100) / 100;
};

/**
 * Like `money`, but returns `undefined` (omit the key) instead of zeroing when
 * the value is missing. Used only for the per-trade profit fields the API bug
 * hits directly — there's no balance/deposit figure to derive a per-trade
 * fallback from, so the safest move on a re-sync is to leave a previously
 * -synced trade's good value alone rather than overwrite it with 0.
 */
const moneyOrKeep = (v: unknown): Types.Decimal128 | undefined =>
  v == null || v === "" ? undefined : (dec(v as number | string) as Types.Decimal128);

const date = (v: unknown): Date | null =>
  v ? new Date(v as string) : null;

const int = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
};

/** A masked value from the API contains a bullet/asterisk; absent counts too. */
const isMasked = (s: unknown): boolean =>
  s == null || s === "" || /[*•]/.test(String(s));

export interface MappedClient {
  _id: number;
  set: Record<string, unknown>;
}

export function mapClient(raw: RawClient): MappedClient {
  const funding = raw.funding ?? {};
  const accounts = raw.accounts ?? {};
  const trading = raw.trading ?? {};
  const logins = (accounts.logins ?? []).map(String);
  const items = accounts.items;

  return {
    _id: int(raw.client_id),
    set: {
      name: raw.name ?? "",
      email: raw.email ?? null,
      phone: raw.phone ?? null,
      country: raw.country ?? "Unknown",
      status: raw.status ?? "active",
      emailMasked: isMasked(raw.email),
      phoneMasked: isMasked(raw.phone),
      registeredAt: date(raw.registered_at),
      referredAt: date(raw.referred_at),
      referralCode: raw.referral_code ?? null,

      fundingCurrency: funding.currency ?? "USD",
      fundingDeposits: money(funding.deposits),
      fundingWithdrawals: money(funding.withdrawals),
      fundingNetDeposit: money(funding.net_deposit),
      fundingDepositCount: int(funding.deposit_count),
      fundingFirstDepositAt: date(funding.first_deposit_at),
      fundingLastDepositAt: date(funding.last_deposit_at),
      fundingIsFunded: Boolean(funding.is_funded),

      accountsCount: int(accounts.count ?? logins.length),
      accountsBalance: money(accounts.balance),
      accountsEquity: money(accounts.equity),
      accountsCredit: money(accounts.credit),
      logins,

      tradingLots: money(trading.lots),
      tradingTrades: int(trading.trades),
      tradingNetProfit: money(
        trading.net_profit ??
          (items?.length
            ? sumAccountNetProfit(items)
            : derivedNetProfit(accounts.balance, funding.deposits, funding.withdrawals)),
      ),
      tradingLastTradeAt: date(trading.last_trade_at),

      commissionEarned: money(raw.commission_earned),

      raw,
      lastSyncedAt: new Date(),
    },
  };
}

export interface MappedAccount {
  _id: string;
  set: Record<string, unknown>;
}

export function mapAccount(
  item: RawAccountItem | RawAccount,
  clientId: number,
): MappedAccount {
  return {
    _id: String(item.login),
    set: {
      clientId,
      accountType: item.account_type ?? null,
      platformGroup: item.platform_group ?? null,
      currency: item.currency ?? "USD",
      openedAt: date(item.opened_at),
      balance: money(item.balance),
      equity: money(item.equity),
      credit: money(item.credit),
      margin: money(item.margin),
      freeMargin: money(item.free_margin),
      leverage: item.leverage != null ? int(item.leverage) : null,
      tradingEnabled: item.trading_enabled ?? true,
      totalDeposit: money(item.total_deposit),
      totalWithdrawal: money(item.total_withdrawal),
      netDeposit: money(item.net_deposit),
      lots: money(item.lots),
      trades: int(item.trades),
      netProfit: money(
        item.net_profit ??
          derivedNetProfit(item.balance, item.total_deposit, item.total_withdrawal),
      ),
      lastTradeAt: date(item.last_trade_at),
      commission: money(item.commission),
      apiUpdatedAt: date(item.updated_at),
      raw: item,
      lastSyncedAt: new Date(),
    },
  };
}

export interface MappedDoc {
  _id: string;
  set: Record<string, unknown>;
  /** Applied only when the upsert inserts a brand-new document. */
  setOnInsert?: Record<string, unknown>;
}

const sideOf = (t: RawTrade | RawPosition): "buy" | "sell" | null => {
  const v = String(t.type ?? t.side ?? "").toLowerCase();
  if (v.includes("buy")) return "buy";
  if (v.includes("sell")) return "sell";
  return null;
};

export function mapTrade(
  t: RawTrade,
  login: string,
  clientId: number | null,
): MappedDoc {
  // profit / net_profit: omit rather than zero when the API sends null, so a
  // re-sync (the 1h overlap window re-fetches recent trades every run) can't
  // clobber a previously-good value with 0 while Elefin's bug is live.
  const profit = moneyOrKeep(t.profit);
  const netPnl = moneyOrKeep(t.net_profit ?? t.profit);
  const hasProfit = profit !== undefined || netPnl !== undefined;
  return {
    _id: String(t.trade_ticket_id),
    set: {
      login: String(t.login ?? login),
      clientId,
      symbol: t.instrument ?? null,
      side: sideOf(t),
      volumeLots: money(t.lots),
      openPrice: moneyOrNull(t.open_price),
      closePrice: moneyOrNull(t.close_price),
      openAt: date(t.open_time),
      closeAt: date(t.close_time),
      holdingDurationSeconds:
        t.holding_duration_seconds != null ? int(t.holding_duration_seconds) : null,
      stopLoss: moneyOrNull(t.stop_loss),
      takeProfit: moneyOrNull(t.take_profit),
      ...(profit !== undefined ? { profit } : {}),
      commission: money(t.commission),
      brokerCommission: money(t.broker_commission),
      swap: money(t.swap),
      ...(netPnl !== undefined ? { netPnl } : {}),
      // A real value just arrived — clear the flag for good, even if an
      // earlier sync (before this field existed, or during the outage)
      // never set it.
      ...(hasProfit ? { profitMissing: false } : {}),
      currency: t.currency ?? "USD",
      raw: t,
      syncedAt: new Date(),
    },
    // Only marks a *brand-new* ticket as unreliable. An existing ticket that
    // already has a real value keeps it (moneyOrKeep above) and is never
    // re-flagged just because this particular re-sync came back null.
    setOnInsert: hasProfit ? undefined : { profitMissing: true },
  };
}

export function mapPosition(
  p: RawPosition,
  login: string,
  clientId: number | null,
  asOf: Date | null,
): MappedDoc {
  return {
    _id: String(p.trade_ticket_id),
    set: {
      login,
      clientId,
      symbol: (p as { instrument?: string }).instrument ?? p.symbol ?? null,
      side: sideOf(p),
      volumeLots: money(p.lots ?? p.volume),
      openPrice: moneyOrNull(p.open_price),
      currentPrice: moneyOrNull(p.current_price),
      openAt: date(p.open_time ?? p.opened_at),
      unrealizedPnl: money(p.unrealized_pnl ?? p.profit),
      asOf,
      raw: p,
      syncedAt: new Date(),
    },
  };
}

export function mapTransaction(x: RawTransaction): MappedDoc {
  return {
    _id: String(x.id),
    set: {
      clientId: x.client_id != null ? int(x.client_id) : null,
      login: x.login != null ? String(x.login) : null,
      type: x.type ?? "deposit",
      status: x.status ?? "success",
      currency: x.currency ?? "USD",
      amount: money(x.amount),
      fee: money(x.fee),
      paymentMethod: x.payment_method ?? null,
      paidCurrency: x.paid_currency ?? null,
      paidAmount: moneyOrNull(x.paid_amount),
      exchangeRate: moneyOrNull(x.exchange_rate),
      occurredAt: date(x.created_at),
      apiUpdatedAt: date(x.updated_at),
      raw: x,
      syncedAt: new Date(),
    },
  };
}
