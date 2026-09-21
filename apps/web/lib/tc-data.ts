import { connect, Client, ExternalTrader, type Broker, type MatchMethod } from "@elefin/db";
import { plain } from "./serialize";

/* ── query parsing (mirrors clients-query.ts / xm-data.ts) ───────────── */

export type SP = Record<string, string | string[] | undefined>;

const SORTS = ["name", "email", "mt5Login", "brokerNormalized", "linkedClientName", "needsReview"] as const;
export type TcSortKey = (typeof SORTS)[number];

export interface TcQuery {
  q?: string;
  broker?: Broker;
  flagged?: boolean;
  tag?: string;
  sort: TcSortKey;
  dir: "asc" | "desc";
}

const one = (v: string | string[] | undefined): string | undefined =>
  Array.isArray(v) ? v[0] : v;

const BROKER_VALUES: readonly string[] = ["elefin", "xm", "other", "unknown"];

export function parseTcQuery(sp: SP): TcQuery {
  const broker = one(sp.broker);
  const sort = one(sp.sort);
  return {
    q: (one(sp.q) || "").trim() || undefined,
    broker: broker && BROKER_VALUES.includes(broker) ? (broker as Broker) : undefined,
    flagged: one(sp.flagged) === "1" ? true : undefined,
    tag: one(sp.tag) || undefined,
    sort: sort && (SORTS as readonly string[]).includes(sort) ? (sort as TcSortKey) : "needsReview",
    dir: one(sp.dir) === "desc" ? "desc" : "asc",
  };
}

export function withTcParams(current: TcQuery, patch: Partial<TcQuery>): string {
  const merged: TcQuery = { ...current, ...patch };
  const p = new URLSearchParams();
  if (merged.q) p.set("q", merged.q);
  if (merged.broker) p.set("broker", merged.broker);
  if (merged.flagged) p.set("flagged", "1");
  if (merged.tag) p.set("tag", merged.tag);
  if (merged.sort !== "needsReview") p.set("sort", merged.sort);
  if (merged.dir !== "asc") p.set("dir", merged.dir);
  const s = p.toString();
  return s ? `?${s}` : "";
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/* ── rows ─────────────────────────────────────────────────────────── */

export interface TcRow {
  _id: string;
  name: string;
  email: string | null;
  phone: string | null;
  mt5Login: string | null;
  brokerRaw: string | null;
  brokerNormalized: Broker;
  tradingCapital: number | null;
  remarks: string | null;
  tags: string[];
  linkedClientId: number | null;
  linkedClientName: string | null;
  matchMethod: MatchMethod | null;
  needsReview: boolean;
  reviewReason: string | null;
}

const TC_ROWS_CAP = 1000;

export async function fetchTcRows(q: TcQuery = { sort: "needsReview", dir: "asc" }): Promise<TcRow[]> {
  await connect();
  const filter: Record<string, unknown> = { confirmed: false };
  if (q.broker) filter.brokerNormalized = q.broker;
  if (q.flagged) filter.needsReview = true;
  if (q.tag) filter.tags = q.tag;
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), "i");
    filter.$or = [{ name: rx }, { email: rx }, { mt5Login: { $regex: `^${escapeRegex(q.q)}` } }];
  }

  const rows = await ExternalTrader.find(filter, {
    name: 1,
    email: 1,
    phone: 1,
    mt5Login: 1,
    brokerRaw: 1,
    brokerNormalized: 1,
    tradingCapital: 1,
    remarks: 1,
    tags: 1,
    linkedClientId: 1,
    matchMethod: 1,
    needsReview: 1,
    reviewReason: 1,
  })
    .limit(TC_ROWS_CAP)
    .lean();

  const clientIds = [...new Set(rows.map((r) => r.linkedClientId).filter((x): x is number => x != null))];
  const clients = clientIds.length
    ? await Client.find({ _id: { $in: clientIds } }, { name: 1 }).lean()
    : [];
  const nameById = new Map(clients.map((c) => [c._id, c.name || `#${c._id}`]));

  const merged = rows.map((r) =>
    plain<TcRow>({
      ...r,
      linkedClientName: r.linkedClientId != null ? (nameById.get(r.linkedClientId) ?? null) : null,
    }),
  );

  const dir = q.dir === "desc" ? -1 : 1;
  const val = (r: TcRow): string | number => {
    switch (q.sort) {
      case "email":
        return r.email ?? "";
      case "mt5Login":
        return r.mt5Login ?? "";
      case "brokerNormalized":
        return r.brokerNormalized;
      case "linkedClientName":
        return r.linkedClientName ?? "";
      case "needsReview":
        return r.needsReview ? 1 : 0;
      case "name":
      default:
        return r.name || "";
    }
  };
  merged.sort((a, b) => {
    const av = val(a);
    const bv = val(b);
    const primary = typeof av === "string" || typeof bv === "string" ? String(av).localeCompare(String(bv)) : av - bv;
    return primary * dir || Number(a._id > b._id) - Number(a._id < b._id);
  });

  return merged;
}

/* ── confirm ──────────────────────────────────────────────────────── */

export type ConfirmDecision = "elefin" | "xm";

/**
 * Move a TC row into its final home. "elefin" adds its tags to `linkedClientId`
 * (which the caller must supply — either the suggested match or one picked
 * manually) and deletes the holding record; "xm" just flips `confirmed: true`.
 */
export async function confirmExternalTrader(
  traderId: string,
  decision: ConfirmDecision,
  linkedClientId?: number,
): Promise<{ error: string } | { ok: true }> {
  await connect();
  const trader = await ExternalTrader.findById(traderId).lean();
  if (!trader) return { error: "Not found." };
  if (trader.confirmed) return { error: "Already confirmed." };

  if (decision === "elefin") {
    const clientId = linkedClientId ?? trader.linkedClientId;
    if (clientId == null) return { error: "Pick an Elefin client to link to first." };
    const client = await Client.exists({ _id: clientId });
    if (!client) return { error: `No Elefin client #${clientId}.` };
    if (trader.tags.length) {
      await Client.updateOne({ _id: clientId }, { $addToSet: { tags: { $each: trader.tags } } });
    }
    await ExternalTrader.deleteOne({ _id: traderId });
    return { ok: true };
  }

  await ExternalTrader.updateOne(
    { _id: traderId },
    { $set: { confirmed: true, brokerNormalized: "xm" } },
  );
  return { ok: true };
}

export interface BulkConfirmResult {
  confirmed: number;
  skipped: Array<{ id: string; name: string; reason: string }>;
}

/**
 * Bulk version of `confirmExternalTrader`. For "elefin" this only ever uses
 * each row's own *suggested* `linkedClientId` — there's no way to pick a
 * different client per-row in a batch — so a row with no suggestion is
 * reported back as skipped rather than silently dropped.
 */
export async function confirmManyExternalTraders(
  traderIds: string[],
  decision: ConfirmDecision,
): Promise<BulkConfirmResult> {
  await connect();
  let confirmed = 0;
  const skipped: BulkConfirmResult["skipped"] = [];

  for (const id of traderIds) {
    const res = await confirmExternalTrader(id, decision);
    if ("error" in res) {
      const trader = await ExternalTrader.findById(id, { name: 1 }).lean();
      skipped.push({ id, name: trader?.name || id, reason: res.error });
    } else {
      confirmed += 1;
    }
  }

  return { confirmed, skipped };
}
