import type { FilterQuery } from "mongoose";

/** Search-param bag Next hands to a page (already resolved). */
export type SP = Record<string, string | string[] | undefined>;

const SORTS = {
  registered: "registeredAt",
  name: "name",
  deposits: "fundingDeposits",
  net: "fundingNetDeposit",
  lots: "tradingLots",
  trades: "tradingTrades",
  pnl: "tradingNetProfit",
  commission: "commissionEarned",
  lasttrade: "tradingLastTradeAt",
} as const;

export type SortKey = keyof typeof SORTS;

export interface ClientsQuery {
  page: number;
  perPage: number;
  sort: SortKey;
  dir: "asc" | "desc";
  code?: string;
  status?: "active" | "suspended" | "inactive";
  funded?: "yes" | "no";
  activity?: "traded" | "never" | "dormant30" | "dormant60" | "dormant90";
  country?: string;
  q?: string;
  tag?: string;
  /** "with_us" (default) hides departed clients; "departed" shows only them; "all" shows everyone. */
  partnerStatus: "with_us" | "departed" | "all";
}

const one = (v: string | string[] | undefined): string | undefined =>
  Array.isArray(v) ? v[0] : v;

export function parseClientsQuery(sp: SP): ClientsQuery {
  const num = (v: string | undefined, def: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : def;
  };
  const sortRaw = one(sp.sort) as SortKey | undefined;
  return {
    page: num(one(sp.page), 1),
    perPage: Math.min(num(one(sp.perPage), 50), 200),
    sort: sortRaw && sortRaw in SORTS ? sortRaw : "registered",
    dir: one(sp.dir) === "asc" ? "asc" : "desc",
    code: one(sp.code) || undefined,
    status: (["active", "suspended", "inactive"] as const).find(
      (s) => s === one(sp.status),
    ),
    funded: one(sp.funded) === "yes" ? "yes" : one(sp.funded) === "no" ? "no" : undefined,
    activity: (
      ["traded", "never", "dormant30", "dormant60", "dormant90"] as const
    ).find((a) => a === one(sp.activity)),
    country: one(sp.country) || undefined,
    q: (one(sp.q) || "").trim() || undefined,
    tag: one(sp.tag) || undefined,
    partnerStatus:
      (["with_us", "departed", "all"] as const).find(
        (p) => p === one(sp.partnerStatus),
      ) ?? "with_us",
  };
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function buildFilter(q: ClientsQuery): FilterQuery<Record<string, unknown>> {
  const filter: FilterQuery<Record<string, unknown>> = {};
  if (q.code) filter.referralCode = q.code;
  if (q.status) filter.status = q.status;
  if (q.country) filter.country = q.country;
  if (q.tag) filter.tags = q.tag;
  if (q.funded === "yes") filter.fundingIsFunded = true;
  if (q.funded === "no") filter.fundingIsFunded = false;
  if (q.partnerStatus === "departed") filter.partnerStatus = "departed";
  else if (q.partnerStatus !== "all") filter.partnerStatus = { $ne: "departed" };

  if (q.activity === "traded") filter.tradingTrades = { $gt: 0 };
  if (q.activity === "never") filter.tradingTrades = { $lte: 0 };
  if (q.activity?.startsWith("dormant")) {
    const days = Number(q.activity.replace("dormant", ""));
    const cutoff = new Date(Date.now() - days * 86_400_000);
    filter.fundingIsFunded = true;
    filter.$or = [
      { tradingLastTradeAt: { $lt: cutoff } },
      { tradingLastTradeAt: null },
    ];
  }

  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), "i");
    const or: FilterQuery<Record<string, unknown>>[] = [
      { name: rx },
      { email: rx },
      { logins: q.q },
    ];
    const asNum = Number(q.q);
    if (Number.isInteger(asNum)) or.push({ _id: asNum });
    // combine with any dormant $or via $and
    if (filter.$or) {
      filter.$and = [{ $or: filter.$or }, { $or: or }];
      delete filter.$or;
    } else {
      filter.$or = or;
    }
  }
  return filter;
}

export function sortSpec(q: ClientsQuery): Record<string, 1 | -1> {
  const field = SORTS[q.sort];
  return { [field]: q.dir === "asc" ? 1 : -1, _id: -1 };
}

/**
 * Querystring for a link that changes some params. Any patch other than `page`
 * resets pagination to page 1.
 */
export function withParams(current: ClientsQuery, patch: Partial<ClientsQuery>): string {
  const changingPageOnly = Object.keys(patch).every((k) => k === "page");
  const merged: ClientsQuery = {
    ...current,
    ...patch,
    page: changingPageOnly ? (patch.page ?? current.page) : 1,
  };
  const p = new URLSearchParams();
  if (merged.page > 1) p.set("page", String(merged.page));
  if (merged.sort !== "registered") p.set("sort", merged.sort);
  if (merged.dir !== "desc") p.set("dir", merged.dir);
  if (merged.perPage !== 50) p.set("perPage", String(merged.perPage));
  if (merged.code) p.set("code", merged.code);
  if (merged.status) p.set("status", merged.status);
  if (merged.funded) p.set("funded", merged.funded);
  if (merged.activity) p.set("activity", merged.activity);
  if (merged.country) p.set("country", merged.country);
  if (merged.q) p.set("q", merged.q);
  if (merged.tag) p.set("tag", merged.tag);
  if (merged.partnerStatus !== "with_us") p.set("partnerStatus", merged.partnerStatus);
  const s = p.toString();
  return s ? `?${s}` : "";
}

export { SORTS };
