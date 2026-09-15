import {
  connect,
  dec,
  Client,
  ExternalTrader,
  ExternalTrade,
  ImportRun,
  type Broker,
  type MatchMethod,
} from "@elefin/db";
import { plain } from "./serialize";
import { parseRosterFile, type RosterRow } from "./imports/parse-roster";
import { parseXmTradesFile } from "./imports/parse-xm-trades";

/** Coerce a parsed number to Decimal128, defaulting missing -> "0" (matches the worker's own money() convention). */
const money = (v: number | null | undefined) => dec(v == null ? "0" : String(v));
const moneyOrNull = (v: number | null | undefined) => (v == null ? null : dec(String(v)));
import { matchRosterRow } from "./imports/match";
import { isLoginLengthSuspicious } from "./imports/normalize";

/* ── roster preview ──────────────────────────────────────────────── */

export interface PreviewRow {
  dedupeKey: string;
  sourceRowNumbers: number[];
  name: string;
  email: string | null;
  phone: string | null;
  brokerRaw: string;
  brokerNormalized: Broker;
  mt5Login: string | null;
  mt5LoginRaw: string;
  discordId: string | null;
  status: string | null;
  tradingCapital: number | null;
  tradingCapitalRaw: string;
  remarks: string | null;
  action: "link" | "create" | "update";
  linkedClientId: number | null;
  linkedClientName: string | null;
  matchMethod: MatchMethod | null;
  needsReview: boolean;
  reviewReason: string | null;
  tags: string[];
}

/** In-file dedupe: same MT5 login, else same email, else the row stands alone. Last row wins on a collision. */
function dedupeKeyOf(row: RosterRow): string {
  if (row.mt5Login) return `login:${row.mt5Login}`;
  if (row.email) return `email:${row.email}`;
  return `row:${row.rowNumber}`;
}

export interface RosterPreviewSummary {
  importRunId: string;
  totalSourceRows: number;
  totalRows: number;
  linked: number;
  created: number;
  updated: number;
  flagged: number;
}

export async function previewRosterUpload(
  buffer: Buffer,
  fileName: string,
  uploadedBy: string,
  applyTags: string[],
): Promise<RosterPreviewSummary> {
  await connect();
  const parsed = await parseRosterFile(buffer);

  // in-file merge (last row wins), preserving first-seen order
  const order: string[] = [];
  const merged = new Map<string, RosterRow[]>();
  for (const row of parsed.rows) {
    const key = dedupeKeyOf(row);
    if (!merged.has(key)) {
      order.push(key);
      merged.set(key, []);
    }
    merged.get(key)!.push(row);
  }

  // batch-lookup which dedupe keys already have an ExternalTrader on file
  const allLogins = [...merged.values()].map((rs) => rs.at(-1)!.mt5Login).filter((x): x is string => !!x);
  const allEmails = [...merged.values()].map((rs) => rs.at(-1)!.email).filter((x): x is string => !!x);
  const existing = await ExternalTrader.find(
    { $or: [{ mt5Login: { $in: allLogins } }, { email: { $in: allEmails } }] },
    { mt5Login: 1, email: 1 },
  ).lean();
  const existingByLogin = new Map(existing.filter((e) => e.mt5Login).map((e) => [e.mt5Login as string, e]));
  const existingByEmail = new Map(existing.filter((e) => e.email).map((e) => [e.email as string, e]));

  const clientNameCache = new Map<number, string>();
  const rows: PreviewRow[] = [];
  let linked = 0;
  let created = 0;
  let updated = 0;
  let flagged = 0;

  for (const key of order) {
    const group = merged.get(key)!;
    const row = group.at(-1)!; // last row wins
    const match = await matchRosterRow(row);

    let needsReview = match.needsReview;
    let reviewReason = match.reviewReason;
    if (!needsReview && isLoginLengthSuspicious(row.mt5Login)) {
      needsReview = true;
      reviewReason = `MT5 login "${row.mt5Login}" is only ${row.mt5Login!.length} digits — shorter than the usual 8-11 (Elefin logins are 11, XM's are ~9), worth double-checking`;
    }

    let action: PreviewRow["action"] = "create";
    let linkedClientName: string | null = null;
    if (match.linkedClientId != null) {
      action = "link";
      linked += 1;
      if (!clientNameCache.has(match.linkedClientId)) {
        const c = await Client.findById(match.linkedClientId, { name: 1 }).lean();
        clientNameCache.set(match.linkedClientId, c?.name || `#${match.linkedClientId}`);
      }
      linkedClientName = clientNameCache.get(match.linkedClientId) ?? null;
    } else if (
      (row.mt5Login && existingByLogin.has(row.mt5Login)) ||
      (row.email && existingByEmail.has(row.email))
    ) {
      action = "update";
      updated += 1;
    } else {
      created += 1;
    }
    if (needsReview) flagged += 1;

    rows.push({
      dedupeKey: key,
      sourceRowNumbers: group.map((r) => r.rowNumber),
      name: row.name,
      email: row.email,
      phone: row.phone,
      brokerRaw: row.brokerRaw,
      brokerNormalized: row.brokerNormalized,
      mt5Login: row.mt5Login,
      mt5LoginRaw: row.mt5LoginRaw,
      discordId: row.discordId,
      status: row.status,
      tradingCapital: row.tradingCapital,
      tradingCapitalRaw: row.tradingCapitalRaw,
      remarks: row.remarks,
      action,
      linkedClientId: match.linkedClientId,
      linkedClientName,
      matchMethod: match.matchMethod,
      needsReview,
      reviewReason,
      tags: applyTags,
    });
  }

  const doc = await ImportRun.create({
    kind: "roster",
    status: "preview",
    fileName,
    uploadedBy,
    totalRows: rows.length,
    linkedCount: linked,
    createdCount: created,
    updatedCount: updated,
    flaggedCount: flagged,
    rows,
  });

  return {
    importRunId: String(doc._id),
    totalSourceRows: parsed.rows.length,
    totalRows: rows.length,
    linked,
    created,
    updated,
    flagged,
  };
}

export interface ImportRunDetail {
  _id: string;
  kind: "roster" | "xm_trades";
  status: "preview" | "committed" | "failed";
  fileName: string;
  totalRows: number;
  linkedCount: number;
  createdCount: number;
  updatedCount: number;
  flaggedCount: number;
  skippedCount: number;
  committedAt: string | null;
  createdAt: string | null;
  rows: PreviewRow[];
}

export async function fetchImportRun(id: string): Promise<ImportRunDetail | null> {
  if (!/^[0-9a-f]{24}$/i.test(id)) return null;
  await connect();
  const doc = await ImportRun.findById(id).select("+rows").lean();
  if (!doc) return null;
  return plain<ImportRunDetail>(doc);
}

export interface ImportRunRow {
  _id: string;
  kind: "roster" | "xm_trades";
  status: "preview" | "committed" | "failed";
  fileName: string;
  totalRows: number;
  linkedCount: number;
  createdCount: number;
  updatedCount: number;
  flaggedCount: number;
  skippedCount: number;
  committedAt: string | null;
  createdAt: string | null;
}

export async function fetchImportRuns(limit = 30): Promise<ImportRunRow[]> {
  await connect();
  const docs = await ImportRun.find({}).sort({ createdAt: -1 }).limit(limit).lean();
  return docs.map((d) => plain<ImportRunRow>(d));
}

export interface CommitResult {
  linked: number;
  created: number;
  updated: number;
  skipped: number;
}

/**
 * Commit a roster preview. `includeKeys` are the dedupe keys (PreviewRow.dedupeKey)
 * the reviewer left checked; `null` means "everything" (e.g. a non-interactive
 * commit). Anything not included is left untouched in the DB and tallied as skipped.
 *
 * Nothing is applied to a real `Client` here — every row lands in
 * `external_traders` with `confirmed: false` (the "TC" holding area), carrying
 * whatever match was suggested (`linkedClientId`/`matchMethod`) as a hint.
 * A human later calls `confirmExternalTrader` to actually move it into the
 * Elefin or XM book; see sheet-plan.md's TC addendum (2026-09-15).
 */
export async function commitRosterImport(
  importRunId: string,
  includeKeys: string[] | null,
): Promise<CommitResult | { error: string }> {
  await connect();
  const run = await ImportRun.findById(importRunId).select("+rows").lean();
  if (!run) return { error: "Import not found." };
  if (run.status !== "preview") return { error: `Already ${run.status}.` };

  const include = includeKeys == null ? null : new Set(includeKeys);
  const rows = (run.rows ?? []) as unknown as PreviewRow[];

  let linked = 0;
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    if (include != null && !include.has(row.dedupeKey)) {
      skipped += 1;
      continue;
    }

    const set: Record<string, unknown> = {
      name: row.name,
      email: row.email,
      phone: row.phone,
      brokerRaw: row.brokerRaw,
      brokerNormalized: row.brokerNormalized,
      mt5Login: row.mt5Login,
      mt5LoginRaw: row.mt5LoginRaw,
      discordId: row.discordId,
      status: row.status,
      tradingCapital: row.tradingCapital,
      tradingCapitalRaw: row.tradingCapitalRaw,
      remarks: row.remarks,
      confirmed: false,
      linkedClientId: row.linkedClientId,
      matchMethod: row.matchMethod,
      needsReview: row.needsReview,
      reviewReason: row.reviewReason,
      sourceImportId: importRunId,
    };

    if (row.action === "link") linked += 1;

    // No login and no email at all — there's no stable key to dedupe on, so
    // upserting against a synthetic filter would let at most one such row
    // ever succeed (every later one would collide). Just insert fresh.
    if (!row.mt5Login && !row.email) {
      await ExternalTrader.create({ ...set, tags: row.tags });
      created += 1;
      continue;
    }

    const filter = row.mt5Login ? { mt5Login: row.mt5Login } : { email: row.email };
    const res = await ExternalTrader.findOneAndUpdate(
      filter,
      {
        $set: set,
        $addToSet: row.tags.length ? { tags: { $each: row.tags } } : {},
      },
      { upsert: true, new: false },
    );
    if (res) updated += 1;
    else created += 1;
  }

  await ImportRun.updateOne(
    { _id: importRunId },
    {
      $set: {
        status: "committed",
        committedAt: new Date(),
        linkedCount: linked,
        createdCount: created,
        updatedCount: updated,
        skippedCount: skipped,
      },
    },
  );

  return { linked, created, updated, skipped };
}

/* ── XM trade-history upload (no preview gate — see sheet-plan.md §4.2) ── */

export interface XmTradesImportSummary {
  importRunId: string;
  totalRows: number;
  logins: number;
  upserted: number;
}

export async function importXmTrades(
  buffer: Buffer,
  fileName: string,
  uploadedBy: string,
): Promise<XmTradesImportSummary> {
  await connect();
  const csvText = buffer.toString("utf8");
  const trades = parseXmTradesFile(csvText);

  const logins = [...new Set(trades.map((t) => t.login))];
  const traders = await ExternalTrader.find(
    { mt5Login: { $in: logins } },
    { mt5Login: 1 },
  ).lean();
  const traderIdByLogin = new Map(traders.map((t) => [t.mt5Login as string, t._id]));

  const ops = trades.map((t) => ({
    updateOne: {
      filter: { _id: `xm:${t.ticketId}` },
      update: {
        $set: {
          broker: "xm",
          login: t.login,
          externalTraderId: traderIdByLogin.get(t.login) ?? null,
          symbol: t.symbol,
          side: t.side,
          volumeLots: money(t.volumeLots),
          openPrice: moneyOrNull(t.openPrice),
          closePrice: moneyOrNull(t.closePrice),
          openAt: t.openAt,
          closeAt: t.closeAt,
          commission: money(t.commission),
          affiliateCommission: money(t.affiliateCommission),
          accountType: t.accountType,
          accountCurrency: t.accountCurrency,
          campaign: t.campaign,
          raw: t.raw,
        },
      },
      upsert: true,
    },
  }));

  const res = ops.length ? await ExternalTrade.bulkWrite(ops, { ordered: false }) : null;
  const upserted = (res?.upsertedCount ?? 0) + (res?.modifiedCount ?? 0);

  const doc = await ImportRun.create({
    kind: "xm_trades",
    status: "committed",
    fileName,
    uploadedBy,
    totalRows: trades.length,
    createdCount: res?.upsertedCount ?? 0,
    updatedCount: res?.modifiedCount ?? 0,
    committedAt: new Date(),
  });

  return {
    importRunId: String(doc._id),
    totalRows: trades.length,
    logins: logins.length,
    upserted,
  };
}
