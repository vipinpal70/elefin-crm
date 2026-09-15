/**
 * Parser for the "5x-data.xlsx"-style roster template — a person per row:
 * Name, Number, Email, Trading Capital ($), Broker/Prop Firm, User Id,
 * Discord Id, Status, Current Remarks, Volume, Additional Remark.
 *
 * Hardcoded to this exact column layout for now (sheet-plan.md §10 decision
 * 2) — a different roster shape would need its own parser, or a future
 * generic column-mapper.
 */
import ExcelJS from "exceljs";
import type { Broker } from "@elefin/db";
import {
  normalizeBroker,
  extractMt5Login,
  parseCapital,
  normalizePhone,
  normalizeEmail,
} from "./normalize";

export const ROSTER_HEADERS = [
  "Name",
  "Number",
  "Email",
  "Trading Capital ($)",
  "Broker/Prop Firm",
  "User Id",
  "Discord Id",
  "Status",
  "Current Remarks",
  "Volume",
  "Additional Remark",
] as const;

export interface RosterRow {
  rowNumber: number;
  name: string;
  email: string | null;
  phone: string | null;
  brokerRaw: string;
  brokerNormalized: Broker;
  mt5Login: string | null;
  mt5LoginRaw: string;
  discordId: string | null;
  status: string | null;
  volume: string | null;
  tradingCapital: number | null;
  tradingCapitalRaw: string;
  remarks: string | null;
  raw: Record<string, string>;
}

export interface ParsedRoster {
  headers: string[];
  /** False if the file's header row doesn't match ROSTER_HEADERS — parsing still proceeds positionally, but the caller should warn. */
  headersMatch: boolean;
  rows: RosterRow[];
}

function cellText(v: ExcelJS.CellValue): string {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
    return String(v);
  }
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    const anyV = v as { richText?: { text: string }[]; result?: unknown; text?: unknown };
    if (Array.isArray(anyV.richText)) return anyV.richText.map((r) => r.text).join("");
    if ("result" in anyV) return String(anyV.result ?? "");
    if ("text" in anyV) return String(anyV.text ?? "");
  }
  return String(v);
}

export async function parseRosterFile(buffer: Buffer): Promise<ParsedRoster> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const ws = wb.worksheets[0];
  if (!ws) return { headers: [], headersMatch: false, rows: [] };

  const headers: string[] = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (cell, colNumber) => {
    headers[colNumber - 1] = cellText(cell.value).trim();
  });
  const headersMatch = ROSTER_HEADERS.every((h, i) => headers[i] === h);

  const rows: RosterRow[] = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const get = (col: number) => cellText(row.getCell(col).value).trim();

    const name = get(1);
    const phoneRaw = get(2);
    const emailRaw = get(3);
    const capitalRaw = get(4);
    const brokerRaw = get(5);
    const userIdRaw = get(6);
    const discordId = get(7);
    const status = get(8);
    const remarks = get(9);
    const volume = get(10);
    const additionalRemark = get(11);

    // skip a fully blank row
    if (!name && !phoneRaw && !emailRaw && !userIdRaw) return;

    const broker = normalizeBroker(brokerRaw);
    const login = extractMt5Login(userIdRaw);
    const capital = parseCapital(capitalRaw);

    rows.push({
      rowNumber,
      name,
      email: normalizeEmail(emailRaw),
      phone: normalizePhone(phoneRaw),
      brokerRaw: broker.raw,
      brokerNormalized: broker.normalized,
      mt5Login: login.login,
      mt5LoginRaw: login.raw,
      discordId: discordId || null,
      status: status || null,
      volume: volume || null,
      tradingCapital: capital.value,
      tradingCapitalRaw: capital.raw,
      remarks: [remarks, additionalRemark].filter(Boolean).join(" · ") || null,
      raw: {
        name,
        number: phoneRaw,
        email: emailRaw,
        capital: capitalRaw,
        broker: brokerRaw,
        userId: userIdRaw,
        discordId,
        status,
        remarks,
        volume,
        additionalRemark,
      },
    });
  });

  return { headers, headersMatch, rows };
}
