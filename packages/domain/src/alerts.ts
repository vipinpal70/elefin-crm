/**
 * Alert rule definitions (project-structure-plan.md §7.11). The evaluators are
 * implemented in Phase 4 against `clients` + `client_daily`; this file fixes the
 * catalogue, thresholds and dedupe-key strategy so the worker and UI agree.
 *
 * Kept free of `@elefin/db` so this package stays pure; the union mirrors
 * `ALERT_SEVERITIES` there.
 */
export type AlertSeverity = "info" | "warning" | "critical";
export type AlertType =
  | "big_deposit"
  | "big_withdrawal"
  | "funded_never_traded"
  | "gone_dormant"
  | "balance_wipeout"
  | "margin_pressure"
  | "new_whale"
  | "first_trade"
  | "integration_down"
  | "partner_code_changed";

export interface AlertRule {
  type: AlertType;
  severity: AlertSeverity;
  description: string;
  /** Tunable numbers, overridable from Settings. */
  defaults: Record<string, number>;
}

export const ALERT_RULES: Record<AlertType, AlertRule> = {
  big_deposit: {
    type: "big_deposit",
    severity: "info",
    description: "A client deposited a large amount in the last 24h.",
    defaults: { minUsd: 500, windowHours: 24 },
  },
  big_withdrawal: {
    type: "big_withdrawal",
    severity: "warning",
    description: "A large withdrawal, or ≥90% of balance, in the last 24h.",
    defaults: { minUsd: 300, pctOfBalance: 90, windowHours: 24 },
  },
  funded_never_traded: {
    type: "funded_never_traded",
    severity: "warning",
    description: "Funded but has never placed a trade.",
    defaults: { fundedForDays: 7 },
  },
  gone_dormant: {
    type: "gone_dormant",
    severity: "warning",
    description: "Was active; no trade for N days.",
    defaults: { days: 30 },
  },
  balance_wipeout: {
    type: "balance_wipeout",
    severity: "critical",
    description: "Equity fell ≥90% from its peak.",
    defaults: { dropPct: 90 },
  },
  margin_pressure: {
    type: "margin_pressure",
    severity: "critical",
    description: "Free margin is a small fraction of equity.",
    defaults: { freeMarginPctOfEquity: 15 },
  },
  new_whale: {
    type: "new_whale",
    severity: "info",
    description: "Net deposit crossed the whale threshold.",
    defaults: { netDepositUsd: 500 },
  },
  first_trade: {
    type: "first_trade",
    severity: "info",
    description: "Client placed their first-ever trade.",
    defaults: {},
  },
  integration_down: {
    type: "integration_down",
    severity: "critical",
    description: "The Elefin key returned 401, or a sync has stalled.",
    defaults: { staleAfterHours: 6 },
  },
  partner_code_changed: {
    type: "partner_code_changed",
    severity: "warning",
    description: "No longer affiliated with your partner code (left / switched IB).",
    defaults: {},
  },
};

export interface AlertDraft {
  type: AlertType;
  clientId: number | null;
  severity: AlertSeverity;
  title: string;
  dedupeKey: string;
  payload: Record<string, unknown>;
}

/* ── evaluation ───────────────────────────────────────────── */

const DAY = 86_400_000;

export interface AlertClientInput {
  _id: number;
  name: string;
  fundingIsFunded: boolean;
  fundingNetDeposit: number;
  accountsBalance: number;
  accountsEquity: number;
  tradingTrades: number;
  tradingLastTradeAt: number | null; // epoch ms
  fundingFirstDepositAt: number | null;
  firstTradeAt: number | null; // epoch ms, min(trades.closeAt)
  /** Still affiliated with our referral code at Elefin? See partner-code-change-plan.md. */
  partnerStatus: "active" | "departed";
}

export interface AlertTxnInput {
  id: string;
  clientId: number | null;
  clientName?: string;
  type: "deposit" | "withdrawal";
  amount: number;
  occurredAt: number; // epoch ms
}

export interface AlertAccountInput {
  login: string;
  clientId: number | null;
  clientName?: string;
  equity: number;
  freeMargin: number;
}

export interface AlertInput {
  now: number;
  thresholds: Partial<Record<AlertType, Record<string, number>>>;
  clients: AlertClientInput[];
  recentTxns: AlertTxnInput[];
  accounts: AlertAccountInput[];
  integrationDown: { reason: string; at: number } | null;
}

const money = (n: number) =>
  `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Threshold lookup with the catalogue default as fallback. */
function thr(t: AlertInput["thresholds"], type: AlertType, key: string): number {
  return t[type]?.[key] ?? ALERT_RULES[type].defaults[key] ?? 0;
}

/**
 * Pure alert evaluation. The worker feeds current data; each draft's `dedupeKey`
 * is chosen so a genuinely new occurrence makes a new alert and an ongoing one
 * stays a single row.
 */
export function evaluateAlerts(input: AlertInput): AlertDraft[] {
  const { now, thresholds: T, clients, recentTxns, accounts, integrationDown } = input;
  const out: AlertDraft[] = [];
  const byId = new Map(clients.map((c) => [c._id, c]));
  const nameOf = (id: number | null, fallback?: string) =>
    (id != null ? byId.get(id)?.name : undefined) || fallback || (id != null ? `#${id}` : "book");

  // point-in-time: big deposit / withdrawal
  for (const tx of recentTxns) {
    if (tx.type === "deposit") {
      const min = thr(T, "big_deposit", "minUsd");
      const winMs = thr(T, "big_deposit", "windowHours") * 3_600_000;
      if (tx.amount >= min && now - tx.occurredAt <= winMs) {
        out.push({
          type: "big_deposit",
          clientId: tx.clientId,
          severity: "info",
          title: `${nameOf(tx.clientId, tx.clientName)} deposited ${money(tx.amount)}`,
          dedupeKey: tx.id,
          payload: { txnId: tx.id, amount: tx.amount, at: tx.occurredAt },
        });
      }
    } else {
      const min = thr(T, "big_withdrawal", "minUsd");
      const pct = thr(T, "big_withdrawal", "pctOfBalance");
      const winMs = thr(T, "big_withdrawal", "windowHours") * 3_600_000;
      const c = tx.clientId != null ? byId.get(tx.clientId) : undefined;
      const balBefore = (c?.accountsBalance ?? 0) + tx.amount;
      const bigByPct = balBefore > 0 && tx.amount >= (pct / 100) * balBefore;
      if ((tx.amount >= min || bigByPct) && now - tx.occurredAt <= winMs) {
        out.push({
          type: "big_withdrawal",
          clientId: tx.clientId,
          severity: "warning",
          title: `${nameOf(tx.clientId, tx.clientName)} withdrew ${money(tx.amount)}${
            bigByPct ? " (most of the balance)" : ""
          }`,
          dedupeKey: tx.id,
          payload: { txnId: tx.id, amount: tx.amount, at: tx.occurredAt, bigByPct },
        });
      }
    }
  }

  for (const c of clients) {
    // no longer under our referral code
    if (c.partnerStatus === "departed") {
      out.push({
        type: "partner_code_changed",
        clientId: c._id,
        severity: "warning",
        title: `${c.name || `#${c._id}`} is no longer under your referral code`,
        dedupeKey: "",
        payload: {},
      });
    }

    // funded, never traded
    const fundedForDays = thr(T, "funded_never_traded", "fundedForDays");
    if (
      c.fundingIsFunded &&
      c.tradingTrades === 0 &&
      c.fundingFirstDepositAt != null &&
      now - c.fundingFirstDepositAt >= fundedForDays * DAY
    ) {
      const days = Math.floor((now - c.fundingFirstDepositAt) / DAY);
      out.push({
        type: "funded_never_traded",
        clientId: c._id,
        severity: "warning",
        title: `${c.name || `#${c._id}`} funded ${days}d ago, never traded`,
        dedupeKey: "",
        payload: { fundedDaysAgo: days, netDeposit: c.fundingNetDeposit },
      });
    }

    // gone dormant
    const dormDays = thr(T, "gone_dormant", "days");
    if (
      c.tradingTrades > 0 &&
      c.tradingLastTradeAt != null &&
      now - c.tradingLastTradeAt >= dormDays * DAY
    ) {
      const days = Math.floor((now - c.tradingLastTradeAt) / DAY);
      out.push({
        type: "gone_dormant",
        clientId: c._id,
        severity: "warning",
        title: `${c.name || `#${c._id}`} inactive ${days}d`,
        dedupeKey: dayKey(c.tradingLastTradeAt),
        payload: { dormantDays: days, lastTradeAt: c.tradingLastTradeAt },
      });
    }

    // balance wipeout (proxy: equity vs net deposited)
    const dropPct = thr(T, "balance_wipeout", "dropPct");
    if (
      c.fundingIsFunded &&
      c.fundingNetDeposit > 20 &&
      c.accountsEquity <= (1 - dropPct / 100) * c.fundingNetDeposit
    ) {
      out.push({
        type: "balance_wipeout",
        clientId: c._id,
        severity: "critical",
        title: `${c.name || `#${c._id}`} down to ${money(c.accountsEquity)} of ${money(
          c.fundingNetDeposit,
        )} net deposited`,
        dedupeKey: "",
        payload: { equity: c.accountsEquity, netDeposit: c.fundingNetDeposit },
      });
    }

    // new whale
    const whaleUsd = thr(T, "new_whale", "netDepositUsd");
    if (c.fundingNetDeposit >= whaleUsd) {
      out.push({
        type: "new_whale",
        clientId: c._id,
        severity: "info",
        title: `${c.name || `#${c._id}`} — ${money(c.fundingNetDeposit)} net deposited`,
        dedupeKey: "",
        payload: { netDeposit: c.fundingNetDeposit },
      });
    }

    // first trade (within the last 2 days)
    if (c.firstTradeAt != null && now - c.firstTradeAt <= 2 * DAY) {
      out.push({
        type: "first_trade",
        clientId: c._id,
        severity: "info",
        title: `${c.name || `#${c._id}`} placed their first trade`,
        dedupeKey: "",
        payload: { firstTradeAt: c.firstTradeAt },
      });
    }
  }

  // margin pressure — per account
  const fmPct = thr(T, "margin_pressure", "freeMarginPctOfEquity");
  for (const a of accounts) {
    if (a.equity > 5 && a.freeMargin < (fmPct / 100) * a.equity) {
      out.push({
        type: "margin_pressure",
        clientId: a.clientId,
        severity: "critical",
        title: `${nameOf(a.clientId, a.clientName)} · account ${a.login} free margin ${money(
          a.freeMargin,
        )} of ${money(a.equity)}`,
        dedupeKey: a.login,
        payload: { login: a.login, equity: a.equity, freeMargin: a.freeMargin },
      });
    }
  }

  if (integrationDown) {
    out.push({
      type: "integration_down",
      clientId: null,
      severity: "critical",
      title: `Elefin sync problem: ${integrationDown.reason}`,
      dedupeKey: dayKey(integrationDown.at),
      payload: integrationDown,
    });
  }

  return out;
}
