/**
 * Parser for XM's "traderTrades.csv"-style trade-history export — one
 * closed trade per row: Trade #, MT4/MT5 ID, Account Type, Account
 * Currency, Account Brand, Campaign, Open Time, Close Time, Trade
 * Category, Trade Type, Instrument, Instrument Group, Lots, Open Price,
 * Close Price, Total Comm., Affiliate Comm.
 *
 * Confirmed by hand against the real file: numeric columns are quoted
 * strings with thousand-separator commas (`"4,300.85"`), and dates are
 * DD/MM/YYYY HH:MM:SS (unambiguous — day values above 12 appear).
 */
import { parse } from "csv-parse/sync";

export interface XmTradeRow {
  ticketId: string;
  login: string;
  accountType: string | null;
  accountCurrency: string;
  campaign: string | null;
  openAt: Date | null;
  closeAt: Date | null;
  symbol: string | null;
  side: "buy" | "sell" | null;
  volumeLots: number;
  openPrice: number | null;
  closePrice: number | null;
  commission: number;
  affiliateCommission: number;
  raw: Record<string, string>;
}

const numOf = (s: string | undefined): number => {
  const n = Number(String(s ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
};

const numOrNull = (s: string | undefined): number | null => {
  const t = String(s ?? "").trim();
  if (!t || t === "-") return null;
  const n = Number(t.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};

function parseXmDate(s: string | undefined): Date | null {
  const t = String(s ?? "").trim();
  if (!t || t === "-") return null;
  const m = t.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [, dd, mm, yyyy, hh, min, ss] = m as unknown as string[];
  const d = new Date(
    Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(min), Number(ss)),
  );
  return Number.isNaN(d.getTime()) ? null : d;
}

export function parseXmTradesFile(csvText: string): XmTradeRow[] {
  const records = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
  }) as Array<Record<string, string>>;

  const rows: XmTradeRow[] = [];
  for (const r of records) {
    const login = String(r["MT4/MT5 ID"] ?? "").trim();
    const ticketId = String(r["Trade #"] ?? "").trim();
    if (!login || !ticketId) continue; // e.g. the one blank trailing row seen in practice

    const type = String(r["Trade Type"] ?? "").trim().toLowerCase();
    rows.push({
      ticketId,
      login,
      accountType: r["Account Type"]?.trim() || null,
      accountCurrency: r["Account Currency"]?.trim() || "USD",
      campaign: r["Campaign"]?.trim() || null,
      openAt: parseXmDate(r["Open Time"]),
      closeAt: parseXmDate(r["Close Time"]),
      symbol: r["Instrument"]?.trim() || null,
      side: type === "buy" ? "buy" : type === "sell" ? "sell" : null,
      volumeLots: numOf(r["Lots"]),
      openPrice: numOrNull(r["Open Price"]),
      closePrice: numOrNull(r["Close Price"]),
      commission: numOf(r["Total Comm."]),
      affiliateCommission: numOf(r["Affiliate Comm."]),
      raw: r,
    });
  }
  return rows;
}
