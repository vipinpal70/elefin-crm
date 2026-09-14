import { connect, ApiCallLog, Client, SYNC_JOBS, type SyncJob } from "@elefin/db";
import type { FilterQuery } from "mongoose";
import { plain } from "./serialize";
import { parseRange, rangeClause } from "./range";
import type { SP } from "./clients-query";

const one = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v[0] : v) || undefined;
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export interface ApiLogQuery {
  page: number;
  perPage: number;
  job?: SyncJob;
  ok?: "ok" | "error";
  q?: string; // global filter: client id, email, or name (substring)
  from?: string;
  to?: string;
  fromDate?: Date;
  toDate?: Date;
}

export function parseApiLogQuery(sp: SP): ApiLogQuery {
  const r = parseRange(sp);
  const n = (v: string | undefined, d: number) => {
    const x = Number(v);
    return Number.isFinite(x) && x > 0 ? Math.floor(x) : d;
  };
  const job = one(sp.job);
  const ok = one(sp.ok);
  return {
    page: n(one(sp.page), 1),
    perPage: Math.min(n(one(sp.perPage), 50), 200),
    job: job && (SYNC_JOBS as readonly string[]).includes(job) ? (job as SyncJob) : undefined,
    ok: ok === "ok" || ok === "error" ? ok : undefined,
    q: (one(sp.q) || "").trim() || undefined,
    ...r,
  };
}

async function buildFilter(q: ApiLogQuery): Promise<FilterQuery<Record<string, unknown>>> {
  const filter: FilterQuery<Record<string, unknown>> = {};
  if (q.job) filter.job = q.job;
  if (q.ok === "ok") filter.ok = true;
  if (q.ok === "error") filter.ok = false;
  const rc = rangeClause(q);
  if (rc) filter.requestedAt = rc;

  if (q.q) {
    const or: FilterQuery<Record<string, unknown>>[] = [];
    const asNum = Number(q.q);
    if (Number.isInteger(asNum)) {
      or.push({ clientId: asNum });
      const c = await Client.findById(asNum, { logins: 1 }).lean();
      if (c?.logins?.length) or.push({ login: { $in: c.logins.map(String) } });
    }
    const rx = new RegExp(escapeRegex(q.q), "i");
    or.push({ email: rx }, { login: rx });
    // Global filter: also resolve by client name/email, then match every
    // account (login) and client id that belongs to.
    const matches = await Client.find(
      { $or: [{ name: rx }, { email: rx }] },
      { logins: 1 },
    )
      .limit(50)
      .lean();
    if (matches.length) {
      or.push({ clientId: { $in: matches.map((m) => m._id) } });
      const logins = matches.flatMap((m) => (m.logins ?? []).map(String));
      if (logins.length) or.push({ login: { $in: logins } });
    }
    filter.$or = or;
  }
  return filter;
}

export interface ApiLogRow {
  _id: string;
  job: string;
  endpoint: string;
  params: Record<string, unknown> | null;
  ok: boolean;
  httpStatus: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  rateLimitRemaining: number | null;
  durationMs: number | null;
  clientId: number | null;
  clientName: string;
  login: string | null;
  email: string | null;
  bodyTruncated: boolean;
  bodyRowCount: number | null;
  requestedAt: string | null;
}

export interface ApiLogResult {
  rows: ApiLogRow[];
  total: number;
}

/** Not cached — this page is for watching a job run live. */
export async function fetchApiLog(q: ApiLogQuery): Promise<ApiLogResult> {
  await connect();
  const filter = await buildFilter(q);

  const [docs, total] = await Promise.all([
    ApiCallLog.find(filter)
      .sort({ requestedAt: -1 })
      .skip((q.page - 1) * q.perPage)
      .limit(q.perPage)
      .select("-body")
      .lean(),
    ApiCallLog.countDocuments(filter),
  ]);

  const ids = [
    ...new Set(docs.map((d) => d.clientId).filter((x): x is number => x != null)),
  ];
  const names = new Map(
    (await Client.find({ _id: { $in: ids } }, { name: 1 }).lean()).map((c) => [
      c._id,
      c.name ?? "",
    ]),
  );

  return {
    rows: docs.map((d) => {
      const p = plain<Omit<ApiLogRow, "clientName">>(d);
      return { ...p, clientName: p.clientId != null ? names.get(p.clientId) ?? "" : "" };
    }),
    total,
  };
}

export interface ApiLogDetail extends ApiLogRow {
  body: unknown;
}

export async function fetchApiLogEntry(id: string): Promise<ApiLogDetail | null> {
  if (!/^[0-9a-f]{24}$/i.test(id)) return null;
  await connect();
  const doc = await ApiCallLog.findById(id).lean();
  if (!doc) return null;
  const clientName =
    doc.clientId != null
      ? ((await Client.findById(doc.clientId, { name: 1 }).lean())?.name ?? "")
      : "";
  return { ...plain<Omit<ApiLogDetail, "clientName">>(doc), clientName };
}

export function apiLogQs(q: Partial<ApiLogQuery>): string {
  const p = new URLSearchParams();
  if (q.job) p.set("job", q.job);
  if (q.ok) p.set("ok", q.ok);
  if (q.q) p.set("q", q.q);
  if (q.from) p.set("from", q.from);
  if (q.to) p.set("to", q.to);
  if (q.page && q.page > 1) p.set("page", String(q.page));
  const s = p.toString();
  return s ? `?${s}` : "";
}
