import { Schema, Types } from "./mongoose";
import type { SchemaOptions, Types as MTypes } from "mongoose";

type Decimal = MTypes.Decimal128;

/**
 * Shared money helpers. Money and volume are stored as Decimal128 and must never
 * be turned into a binary float. Read them with `toDecimalString` for display /
 * transport; convert to `number` only inside analytics code that tolerates it.
 */
export const Decimal128 = Schema.Types.Decimal128;

export function toDecimalString(
  v: Decimal | string | number | null | undefined,
): string | null {
  if (v === null || v === undefined) return null;
  return v.toString();
}

export function toNumber(
  v: Decimal | string | number | null | undefined,
): number {
  if (v === null || v === undefined) return 0;
  return typeof v === "number" ? v : Number(v.toString());
}

export function dec(
  v: string | number | null | undefined,
): Decimal | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  return Types.Decimal128.fromString(String(v));
}

/** Recursively turn Decimal128 -> string and ObjectId -> string in a plain object. */
function normalise(value: unknown): unknown {
  if (value instanceof Types.Decimal128 || value instanceof Types.ObjectId) {
    return value.toString();
  }
  if (Array.isArray(value)) return value.map(normalise);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = normalise(v);
    }
    return out;
  }
  return value;
}

/** JSON that is safe to send to the browser (Decimal128 -> string, etc.). */
export const jsonSchemaConfig = {
  virtuals: true,
  versionKey: false,
  transform(_doc: unknown, ret: Record<string, unknown>): Record<string, unknown> {
    return normalise(ret) as Record<string, unknown>;
  },
} as const;

/** Base options: timestamps + browser-safe JSON. */
export const baseSchemaOptions = {
  timestamps: true,
  toJSON: jsonSchemaConfig,
  toObject: { virtuals: true, versionKey: false },
} satisfies SchemaOptions;

/**
 * Options for MongoDB time-series collections. These are insert-only, so no
 * `timestamps` and no custom `_id`. `timeField` / `metaField` are set per model.
 */
export function timeseriesSchemaOptions(
  timeField: string,
  metaField: string,
): SchemaOptions {
  return {
    timestamps: false,
    toJSON: jsonSchemaConfig,
    toObject: { virtuals: false, versionKey: false },
    timeseries: { timeField, metaField, granularity: "hours" },
  } satisfies SchemaOptions;
}

export const STATUSES = ["active", "suspended", "inactive"] as const;
export type Status = (typeof STATUSES)[number];

/** Whether a client is still affiliated with our Elefin referral code. */
export const PARTNER_STATUSES = ["active", "departed"] as const;
export type PartnerStatus = (typeof PARTNER_STATUSES)[number];

export const SIDES = ["buy", "sell"] as const;
export type Side = (typeof SIDES)[number];

export const TXN_TYPES = ["deposit", "withdrawal"] as const;
export type TxnType = (typeof TXN_TYPES)[number];

export const ROLES = ["owner", "analyst", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const SYNC_JOBS = [
  "me",
  "clients",
  "accounts",
  "transactions",
  "trades",
  "positions",
  "snapshot",
  "alerts",
  "digest",
  "pnl-fix",
] as const;
export type SyncJob = (typeof SYNC_JOBS)[number];

export const SYNC_STATUSES = ["running", "ok", "partial", "failed"] as const;
export type SyncStatus = (typeof SYNC_STATUSES)[number];

export const ALERT_SEVERITIES = ["info", "warning", "critical"] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

/** Normalized broker bucket for an uploaded roster row — see sheet-plan.md §5. */
export const BROKERS = ["elefin", "xm", "other", "unknown"] as const;
export type Broker = (typeof BROKERS)[number];

/** How an ExternalTrader got linked to a real Elefin Client, if at all. */
export const MATCH_METHODS = ["mt5_login", "email", "manual"] as const;
export type MatchMethod = (typeof MATCH_METHODS)[number];

/** Which sheet template was uploaded. One column mapping per kind (sheet-plan.md §4.2). */
export const IMPORT_KINDS = ["roster", "xm_trades"] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

export const IMPORT_STATUSES = ["preview", "committed", "failed"] as const;
export type ImportStatus = (typeof IMPORT_STATUSES)[number];
