import { connect, FundingEvent, Client } from "@elefin/db";
import type { FilterQuery } from "mongoose";
import { plain } from "./serialize";
import { parseRange, rangeClause } from "./range";
import type { SP } from "./clients-query";

const one = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v[0] : v) || undefined;
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export interface FundingQuery {
  page: number;
  perPage: number;
  type?: "deposit" | "withdrawal";
  status?: string;
  method?: string;
  q?: string;
  from?: string;
  to?: string;
  fromDate?: Date;
  toDate?: Date;
}

export function parseFundingQuery(sp: SP): FundingQuery {
  const r = parseRange(sp);
  const n = (v: string | undefined, d: number) => {
    const x = Number(v);
    return Number.isFinite(x) && x > 0 ? Math.floor(x) : d;
  };
  const type = one(sp.type);
  return {
    page: n(one(sp.page), 1),
    perPage: Math.min(n(one(sp.perPage), 50), 200),
    type: type === "deposit" || type === "withdrawal" ? type : undefined,
    status: one(sp.status),
    method: one(sp.method),
    q: (one(sp.q) || "").trim() || undefined,
    ...r,
  };
}

function buildFilter(q: FundingQuery): FilterQuery<Record<string, unknown>> {
  const f: FilterQuery<Record<string, unknown>> = {};
  if (q.type) f.type = q.type;
  if (q.status) f.status = q.status;
  if (q.method) f.paymentMethod = q.method;
  const rc = rangeClause(q);
  if (rc) f.occurredAt = rc;
  if (q.q) {
    const asNum = Number(q.q);
    f.$or = [
      { _id: new RegExp(escapeRegex(q.q), "i") },
      { login: q.q },
      ...(Number.isInteger(asNum) ? [{ clientId: asNum }] : []),
    ];
  }
  return f;
}

export interface FundingRow {
  _id: string;
  clientId: number | null;
  clientName: string;
  login: string | null;
  type: string;
  status: string;
  currency: string;
  amount: number;
  fee: number;
  paymentMethod: string | null;
  paidCurrency: string | null;
  paidAmount: number | null;
  occurredAt: string | null;
}

export interface FundingResult {
  rows: FundingRow[];
  total: number;
  totals: { deposits: number; withdrawals: number; net: number; depositCount: number; withdrawalCount: number };
  statuses: string[];
  methods: string[];
}

export async function fetchFunding(q: FundingQuery): Promise<FundingResult> {
  await connect();
  const filter = buildFilter(q);

  const [docs, total, agg, statuses, methods] = await Promise.all([
    FundingEvent.find(filter)
      .sort({ occurredAt: -1, _id: -1 })
      .skip((q.page - 1) * q.perPage)
      .limit(q.perPage)
      .lean(),
    FundingEvent.countDocuments(filter),
    FundingEvent.aggregate<{ _id: string; total: number; n: number }>([
      { $match: filter },
      { $group: { _id: "$type", total: { $sum: { $toDouble: "$amount" } }, n: { $sum: 1 } } },
    ]),
    FundingEvent.distinct("status", filter),
    FundingEvent.distinct("paymentMethod", filter),
  ]);

  const ids = [...new Set(docs.map((d) => d.clientId).filter((x): x is number => x != null))];
  const names = new Map(
    (await Client.find({ _id: { $in: ids } }, { name: 1 }).lean()).map((c) => [
      c._id,
      c.name ?? "",
    ]),
  );

  const dep = agg.find((a) => a._id === "deposit");
  const wd = agg.find((a) => a._id === "withdrawal");

  return {
    rows: docs.map((d) => {
      const p = plain<Omit<FundingRow, "clientName">>(d);
      return { ...p, clientName: p.clientId != null ? names.get(p.clientId) ?? "" : "" };
    }),
    total,
    totals: {
      deposits: Math.round((dep?.total ?? 0) * 100) / 100,
      withdrawals: Math.round((wd?.total ?? 0) * 100) / 100,
      net: Math.round(((dep?.total ?? 0) - (wd?.total ?? 0)) * 100) / 100,
      depositCount: dep?.n ?? 0,
      withdrawalCount: wd?.n ?? 0,
    },
    statuses: (statuses as (string | null)[]).filter((x): x is string => !!x).sort(),
    methods: (methods as (string | null)[]).filter((x): x is string => !!x).sort(),
  };
}

export function fundingQs(q: Partial<FundingQuery>): string {
  const p = new URLSearchParams();
  if (q.type) p.set("type", q.type);
  if (q.status) p.set("status", q.status);
  if (q.method) p.set("method", q.method);
  if (q.q) p.set("q", q.q);
  if (q.from) p.set("from", q.from);
  if (q.to) p.set("to", q.to);
  if (q.page && q.page > 1) p.set("page", String(q.page));
  const s = p.toString();
  return s ? `?${s}` : "";
}
