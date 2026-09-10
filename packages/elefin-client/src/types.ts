/**
 * Wire types for the Elefin Client Data API (v2, read-only).
 * See docs/elefin-client-data-api V2.html.
 *
 * Shapes below reflect the live API (probed 2026-09-09), which nests funding /
 * accounts / trading under sub-objects rather than the flat columns of the xlsx
 * export. The API withholds fields per key (absent, not null), so sub-objects
 * keep an index signature and most fields stay optional. The Phase-1 sync jobs
 * own the mapping to our normalised Mongo documents.
 */

export interface ApiEnvelope<T> {
  success: boolean;
  message: string;
  data: T;
}

export interface PaginatorMeta {
  current_page: number;
  per_page: number;
  last_page: number;
  total: number;
}

export interface Paginated<T> {
  data: T[];
  meta: PaginatorMeta;
}

/* ── /me ─────────────────────────────────────────────────── */

export interface MeData {
  key: {
    name: string;
    abilities: string[]; // [] means "all granted" (only clients.pii is opt-in)
    rate_limit_per_minute: number;
    expires_at: string | null;
  };
  scope: {
    type: string;
    partner: {
      id: number;
      name: string;
      status?: string;
      code?: string;
      additional_codes?: string[];
    };
  };
  totals: { clients: number };
  data_availability: {
    transactions_from: string | null;
    trades_from: string | null;
  };
  conventions: {
    currency: string;
    timezone: string;
    volume_unit: string;
  };
}

/* ── shared sub-objects ──────────────────────────────────── */

export interface RawFunding {
  currency?: string;
  deposits?: number;
  withdrawals?: number;
  net_deposit?: number;
  deposit_count?: number;
  first_deposit_at?: string | null;
  last_deposit_at?: string | null;
  is_funded?: boolean;
  [key: string]: unknown;
}

export interface RawTradingSummary {
  lots?: number;
  trades?: number;
  net_profit?: number;
  last_trade_at?: string | null;
  [key: string]: unknown;
}

/** Per-account object. `/clients` list gives only the aggregate + `logins[]`;
 *  `/clients/{id}` and `/accounts/{login}` add the full `items[]` fields. */
export interface RawAccountItem {
  login: string;
  affiliated?: boolean;
  account_type?: string;
  platform_group?: string;
  currency?: string;
  opened_at?: string;
  balance?: number;
  equity?: number;
  credit?: number;
  margin?: number;
  free_margin?: number;
  leverage?: number;
  trading_enabled?: boolean;
  total_deposit?: number;
  total_withdrawal?: number;
  net_deposit?: number;
  lots?: number;
  trades?: number;
  net_profit?: number;
  last_trade_at?: string | null;
  commission?: number;
  updated_at?: string;
  [key: string]: unknown;
}

export interface RawAccountsSummary {
  count?: number;
  logins?: string[];
  balance?: number;
  equity?: number;
  credit?: number;
  items?: RawAccountItem[]; // present on /clients/{id} only
  [key: string]: unknown;
}

/* ── /clients & /clients/{id} ────────────────────────────── */

export interface RawClient {
  client_id: number;
  name?: string;
  email?: string;
  phone?: string;
  country?: string;
  status?: string;
  registered_at?: string;
  referred_at?: string;
  referral_code?: string;
  funding?: RawFunding;
  accounts?: RawAccountsSummary;
  trading?: RawTradingSummary;
  commission_earned?: number;
  [key: string]: unknown;
}

/** Same shape as a `/clients` row; `accounts.items[]` is populated. */
export type RawClientDetail = RawClient;

/* ── /clients/lookup ─────────────────────────────────────── */

export interface LookupResult {
  affiliated: boolean;
  client_id?: number;
  name?: string;
  email?: string;
  [key: string]: unknown;
}

/* ── /accounts/{login} ───────────────────────────────────── */

export interface RawAccount extends RawAccountItem {
  client_id?: number;
  affiliated?: boolean;
}

/* ── /accounts/{login}/trades ────────────────────────────── */

export interface RawTrade {
  trade_ticket_id: string;
  login?: string;
  instrument?: string;
  type?: string; // "BUY" | "SELL"
  lots?: number;
  open_time?: string;
  close_time?: string;
  open_price?: number;
  close_price?: number;
  holding_duration_seconds?: number;
  stop_loss?: number | null;
  take_profit?: number | null;
  profit?: number;
  swap?: number;
  broker_commission?: number;
  net_profit?: number;
  currency?: string;
  commission?: number;
  [key: string]: unknown;
}

/* ── /transactions ───────────────────────────────────────── */

export interface RawTransaction {
  id: string; // "DEP-…" | "WDR-…"
  client_id?: number;
  login?: string;
  type?: "deposit" | "withdrawal";
  status?: string; // "success" | …
  currency?: string;
  amount?: number;
  fee?: number;
  payment_method?: string | null;
  paid_currency?: string | null;
  paid_amount?: number | null;
  exchange_rate?: number | null;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface ListTransactionsParams {
  type: "deposit" | "withdrawal";
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

/* ── /accounts/{login}/positions ─────────────────────────── */

export interface RawPositionsResponse {
  login?: string;
  affiliated?: boolean;
  as_of: string | null;
  positions?: RawPosition[];
  data?: RawPosition[];
  [key: string]: unknown;
}

export interface RawPosition {
  trade_ticket_id: string;
  symbol?: string;
  side?: string;
  type?: string;
  volume?: number;
  lots?: number;
  open_price?: number;
  current_price?: number;
  open_time?: string;
  opened_at?: string;
  profit?: number;
  unrealized_pnl?: number;
  [key: string]: unknown;
}

/* ── query params ────────────────────────────────────────── */

export interface ListClientsParams {
  page?: number;
  per_page?: number;
  email?: string;
  sort?: "registered_at" | "client_id" | "name";
  direction?: "asc" | "desc";
  registered_from?: string;
  registered_to?: string;
  country?: string;
  status?: "active" | "suspended" | "inactive";
  funded_only?: 0 | 1;
}

export interface ListTradesParams {
  page?: number;
  limit?: number;
  from?: string;
  to?: string;
  symbol?: string;
}
