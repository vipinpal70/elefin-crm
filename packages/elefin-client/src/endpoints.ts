import { ElefinClient } from "./client";
import type {
  ListClientsParams,
  ListTradesParams,
  ListTransactionsParams,
  LookupResult,
  MeData,
  Paginated,
  RawAccount,
  RawClient,
  RawClientDetail,
  RawPositionsResponse,
  RawTrade,
  RawTransaction,
} from "./types";

/**
 * The seven documented GET endpoints, typed. All reads; nothing here mutates.
 * `listAllClients` / `listAllTrades` page through transparently, paced by the
 * shared rate limiter.
 */
export class ElefinApi extends ElefinClient {
  /** Who we are, what the key can do, how far back data goes. Call on startup. */
  me(signal?: AbortSignal): Promise<MeData> {
    return this.request<MeData>("/me", { signal });
  }

  /** One page of referred clients (aggregates pre-computed). */
  listClients(
    params: ListClientsParams = {},
    signal?: AbortSignal,
  ): Promise<Paginated<RawClient>> {
    return this.request<Paginated<RawClient>>("/clients", {
      query: { ...params },
      signal,
    });
  }

  /** Every referred client, following pagination. */
  async listAllClients(
    params: Omit<ListClientsParams, "page"> = {},
    onPage?: (page: number, lastPage: number, rows: RawClient[]) => void,
    signal?: AbortSignal,
  ): Promise<RawClient[]> {
    const perPage = params.per_page ?? 200;
    const all: RawClient[] = [];
    let page = 1;
    let lastPage = 1;
    do {
      const res = await this.listClients({ ...params, per_page: perPage, page }, signal);
      all.push(...res.data);
      lastPage = res.meta.last_page || 1;
      onPage?.(page, lastPage, res.data);
      page += 1;
    } while (page <= lastPage);
    return all;
  }

  /** "Is this email one of my clients?" — cheap, real-time, no roster paging. */
  lookup(email: string, signal?: AbortSignal): Promise<LookupResult> {
    return this.request<LookupResult>("/clients/lookup", {
      query: { email },
      signal,
    });
  }

  /** One client with per-account breakdown under `accounts.items[]`. */
  getClient(clientId: number | string, signal?: AbortSignal): Promise<RawClientDetail> {
    return this.request<RawClientDetail>(`/clients/${clientId}`, { signal });
  }

  /** One MT5 account. `affiliated:false` means "not yours or doesn't exist". */
  getAccount(login: string, signal?: AbortSignal): Promise<RawAccount> {
    return this.request<RawAccount>(`/accounts/${encodeURIComponent(login)}`, { signal });
  }

  /** One page of closed trades for an account, newest first. */
  listTrades(
    login: string,
    params: ListTradesParams = {},
    signal?: AbortSignal,
  ): Promise<Paginated<RawTrade>> {
    return this.request<Paginated<RawTrade>>(
      `/accounts/${encodeURIComponent(login)}/trades`,
      { query: { ...params }, signal },
    );
  }

  /** Every closed trade for an account (optionally since `from`). */
  async listAllTrades(
    login: string,
    params: Omit<ListTradesParams, "page"> = {},
    onPage?: (page: number, lastPage: number, rows: RawTrade[]) => void,
    signal?: AbortSignal,
  ): Promise<RawTrade[]> {
    const limit = params.limit ?? 200;
    const all: RawTrade[] = [];
    let page = 1;
    let lastPage = 1;
    do {
      const res = await this.listTrades(login, { ...params, limit, page }, signal);
      all.push(...res.data);
      lastPage = res.meta.last_page || 1;
      onPage?.(page, lastPage, res.data);
      page += 1;
    } while (page <= lastPage);
    return all;
  }

  /**
   * Currently-open positions plus an `as_of` snapshot time.
   * A `null`/stale `as_of` means UNKNOWN, not "flat" — callers must check it.
   */
  listPositions(login: string, signal?: AbortSignal): Promise<RawPositionsResponse> {
    return this.request<RawPositionsResponse>(
      `/accounts/${encodeURIComponent(login)}/positions`,
      { signal },
    );
  }

  /**
   * One page of the book-wide deposit/withdrawal ledger for a date window.
   * Not per-client — returns transactions across every referred client.
   */
  listTransactions(
    params: ListTransactionsParams,
    signal?: AbortSignal,
  ): Promise<Paginated<RawTransaction>> {
    return this.request<Paginated<RawTransaction>>("/transactions", {
      query: { ...params },
      signal,
    });
  }

  /** Every transaction of one type in the window, following pagination. */
  async listAllTransactions(
    params: Omit<ListTransactionsParams, "page">,
    onPage?: (page: number, lastPage: number, rows: RawTransaction[]) => void,
    signal?: AbortSignal,
  ): Promise<RawTransaction[]> {
    const limit = params.limit ?? 200;
    const all: RawTransaction[] = [];
    let page = 1;
    let lastPage = 1;
    do {
      const res = await this.listTransactions({ ...params, limit, page }, signal);
      all.push(...res.data);
      lastPage = res.meta.last_page || 1;
      onPage?.(page, lastPage, res.data);
      page += 1;
    } while (page <= lastPage);
    return all;
  }
}
