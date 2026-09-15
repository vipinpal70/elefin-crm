/**
 * Normalization helpers for uploaded roster/trade sheets — see
 * sheet-plan.md §3/§5. Nothing here guesses silently: an ambiguous or
 * malformed cell comes back `null`/`"unknown"`/`"other"` rather than
 * coerced into something that merely looks plausible.
 */
import type { Broker } from "@elefin/db";

const ELEFIN_ALIASES = new Set(["elefin", "elfin", "elffin", "ellfin"]);
const XM_ALIASES = new Set(["xm", "xm global", "xm360"]);

export interface BrokerNormalization {
  raw: string;
  normalized: Broker;
}

/** Normalize a free-text "Broker/Prop Firm" cell (case/punctuation tolerant, typo-tolerant only for known aliases). */
export function normalizeBroker(raw: unknown): BrokerNormalization {
  const text = String(raw ?? "").trim();
  if (!text) return { raw: text, normalized: "unknown" };
  const lower = text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (ELEFIN_ALIASES.has(lower)) return { raw: text, normalized: "elefin" };
  if (XM_ALIASES.has(lower)) return { raw: text, normalized: "xm" };
  return { raw: text, normalized: "other" };
}

export interface Mt5LoginExtraction {
  /** Digits-only candidate login, or null if the cell didn't plausibly contain one. */
  login: string | null;
  /** The original cell text, always kept for audit even when unparseable. */
  raw: string;
}

/**
 * Pull a plausible MT5 login out of a dirty "User Id" cell: strips an
 * "XM - " / "XM- " style broker prefix, then accepts the remainder only if
 * it's all digits, 5-11 digits long (confirmed against real data: Elefin's
 * own logins are 11 digits, XM's are ~9). Rejects "NA", "Elefin", and
 * similar junk rather than inventing a login from partial digits. A login
 * on the short end of that range (see `isLoginLengthSuspicious`) is still
 * returned — the caller decides whether to flag it for review.
 */
export function extractMt5Login(raw: unknown): Mt5LoginExtraction {
  if (raw == null || raw === "") return { login: null, raw: "" };
  const text = String(raw).trim();
  const stripped = text.replace(/^[a-z]{2,10}\s*-\s*/i, "").trim();
  const digitsOnly = stripped.replace(/\D/g, "");
  if (digitsOnly.length >= 5 && digitsOnly.length <= 11 && digitsOnly === stripped) {
    return { login: digitsOnly, raw: text };
  }
  return { login: null, raw: text };
}

/** Real logins run 8-11 digits (Elefin 11, XM ~9); shorter is accepted but worth a glance. */
export function isLoginLengthSuspicious(login: string | null): boolean {
  return login != null && login.length < 8;
}

export interface CapitalParse {
  value: number | null;
  raw: string;
}

/** Parse "170", "25k", "1.5L" (lakh) style capital figures; blank/unreadable text keeps its raw form and a null value rather than a guess. */
export function parseCapital(raw: unknown): CapitalParse {
  if (raw == null || raw === "") return { value: null, raw: "" };
  if (typeof raw === "number" && Number.isFinite(raw)) return { value: raw, raw: String(raw) };
  const text = String(raw).trim();
  const m = text.match(/^([\d,.]+)\s*([kKlL]?)$/);
  if (!m || !m[1]) return { value: null, raw: text };
  const num = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(num)) return { value: null, raw: text };
  const suffix = (m[2] ?? "").toLowerCase();
  const multiplier = suffix === "k" ? 1_000 : suffix === "l" ? 100_000 : 1;
  return { value: num * multiplier, raw: text };
}

/** Store phone numbers as plain digit strings — never a JS number, which silently drops a leading zero. */
export function normalizePhone(raw: unknown): string | null {
  if (raw == null || raw === "") return null;
  const digits = String(raw).replace(/\D/g, "");
  return digits || null;
}

export function normalizeEmail(raw: unknown): string | null {
  if (raw == null) return null;
  const text = String(raw).trim().toLowerCase();
  return text && text.includes("@") ? text : null;
}
