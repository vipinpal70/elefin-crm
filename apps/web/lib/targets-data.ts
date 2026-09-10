import { connect, AppConfig } from "@elefin/db";
import { cached } from "@elefin/cache";
import type { BookPoint } from "./book-daily";

export interface TargetRow {
  key: "signups" | "fundedClients" | "netDeposits";
  label: string;
  fmt: "num" | "usd";
  target: number;
  actual: number;
  pace: number; // expected by today
  onTrack: boolean;
}

export interface TargetsView {
  month: string; // "2026-09"
  daysElapsed: number;
  daysInMonth: number;
  rows: TargetRow[];
}

export interface TargetConfig {
  signups: number;
  fundedClients: number;
  netDeposits: number;
}

export async function readTargetConfig(): Promise<TargetConfig> {
  return cached("target-config", { ttl: 300, tags: ["config"] }, loadTargetConfig);
}

async function loadTargetConfig(): Promise<TargetConfig> {
  await connect();
  const cfg = await AppConfig.findById("targets").lean();
  const t = (cfg?.data ?? {}) as Record<string, unknown>;
  return {
    signups: Number(t.signups) || 0,
    fundedClients: Number(t.fundedClients) || 0,
    netDeposits: Number(t.netDeposits) || 0,
  };
}

/** Month-to-date progress vs the configured targets, from `book_daily`. */
export async function fetchTargets(series: BookPoint[]): Promise<TargetsView | null> {
  const targets = await readTargetConfig();
  if (!targets.signups && !targets.fundedClients && !targets.netDeposits) return null;

  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const monthStr = `${y}-${String(m + 1).padStart(2, "0")}`;
  const monthStart = `${monthStr}-01`;
  const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const daysElapsed = now.getUTCDate();
  const paceFrac = daysElapsed / daysInMonth;

  const inMonth = series.filter((p) => p.date >= monthStart);
  const signups = inMonth.reduce((s, p) => s + p.newSignups, 0);
  const netDeposits =
    Math.round(inMonth.reduce((s, p) => s + p.netFlowDay, 0) * 100) / 100;
  const before = [...series].reverse().find((p) => p.date < monthStart);
  const last = inMonth.at(-1);
  const fundedClients = last
    ? Math.max(0, last.clientsFunded - (before?.clientsFunded ?? last.clientsFunded))
    : 0;

  const mk = (
    key: TargetRow["key"],
    label: string,
    fmt: TargetRow["fmt"],
    target: number,
    actual: number,
  ): TargetRow => ({
    key,
    label,
    fmt,
    target,
    actual,
    pace: Math.round(target * paceFrac * 100) / 100,
    onTrack: actual >= target * paceFrac,
  });

  const rows: TargetRow[] = [];
  if (targets.signups) rows.push(mk("signups", "New signups", "num", targets.signups, signups));
  if (targets.fundedClients)
    rows.push(mk("fundedClients", "Newly funded", "num", targets.fundedClients, fundedClients));
  if (targets.netDeposits)
    rows.push(mk("netDeposits", "Net deposits", "usd", targets.netDeposits, netDeposits));

  return { month: monthStr, daysElapsed, daysInMonth, rows };
}
