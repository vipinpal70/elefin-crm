import {
  Account,
  Alert,
  AppConfig,
  Client,
  FundingEvent,
  SyncRun,
  Trade,
  toNumber,
} from "@elefin/db";
import {
  evaluateAlerts,
  type AlertDraft,
  type AlertInput,
  type AlertType,
} from "@elefin/domain";
import { log } from "../logger";
import type { Job } from "../runner";

const ms = (d: Date | string | null | undefined) =>
  d ? new Date(d).getTime() : null;

/** Alert types whose alert should vanish once the condition clears. */
const STATEFUL: AlertType[] = [
  "funded_never_traded",
  "gone_dormant",
  "balance_wipeout",
  "margin_pressure",
  "new_whale",
];

export const runAlerts: Job = async () => {
  const now = Date.now();

  const cfg = await AppConfig.findById("alerts").lean();
  const thresholds = (cfg?.data ?? {}) as AlertInput["thresholds"];

  const [clientDocs, firstTrades, txnDocs, acctDocs, meRun, latestRun] =
    await Promise.all([
      Client.find(
        {},
        {
          name: 1,
          fundingIsFunded: 1,
          fundingNetDeposit: 1,
          accountsBalance: 1,
          accountsEquity: 1,
          tradingTrades: 1,
          tradingLastTradeAt: 1,
          fundingFirstDepositAt: 1,
        },
      ).lean(),
      Trade.aggregate<{ _id: number; first: Date }>([
        { $match: { clientId: { $ne: null }, closeAt: { $ne: null } } },
        { $group: { _id: "$clientId", first: { $min: "$closeAt" } } },
      ]),
      FundingEvent.find(
        {
          status: "success",
          occurredAt: { $gte: new Date(now - 48 * 3_600_000) },
        },
        { clientId: 1, type: 1, amount: 1, occurredAt: 1 },
      ).lean(),
      Account.find({ equity: { $gt: 5 } }, { clientId: 1, equity: 1, freeMargin: 1 }).lean(),
      SyncRun.findOne({ job: "me" }).sort({ startedAt: -1 }).lean(),
      SyncRun.findOne({}).sort({ startedAt: -1 }).lean(),
    ]);

  const firstTradeAt = new Map(firstTrades.map((r) => [r._id, ms(r.first)]));

  const input: AlertInput = {
    now,
    thresholds,
    clients: clientDocs.map((c) => ({
      _id: c._id,
      name: c.name ?? "",
      fundingIsFunded: !!c.fundingIsFunded,
      fundingNetDeposit: toNumber(c.fundingNetDeposit),
      accountsBalance: toNumber(c.accountsBalance),
      accountsEquity: toNumber(c.accountsEquity),
      tradingTrades: c.tradingTrades ?? 0,
      tradingLastTradeAt: ms(c.tradingLastTradeAt),
      fundingFirstDepositAt: ms(c.fundingFirstDepositAt),
      firstTradeAt: firstTradeAt.get(c._id) ?? null,
    })),
    recentTxns: txnDocs.map((t) => ({
      id: String(t._id),
      clientId: t.clientId ?? null,
      type: (t.type as "deposit" | "withdrawal") ?? "deposit",
      amount: toNumber(t.amount),
      occurredAt: ms(t.occurredAt) ?? now,
    })),
    accounts: acctDocs.map((a) => ({
      login: a._id,
      clientId: a.clientId ?? null,
      equity: toNumber(a.equity),
      freeMargin: toNumber(a.freeMargin),
    })),
    integrationDown: integrationProblem(meRun, latestRun, now, thresholds),
  };

  const drafts = evaluateAlerts(input);

  // upsert without disturbing acknowledged/snoozed state
  let created = 0;
  for (const d of drafts) {
    const res = await Alert.updateOne(
      { type: d.type, clientId: d.clientId, dedupeKey: d.dedupeKey },
      {
        $setOnInsert: {
          severity: d.severity,
          title: d.title,
          payload: d.payload,
        },
        $set: { lastSeenAt: new Date() },
      },
      { upsert: true },
    );
    if (res.upsertedCount) created += 1;
  }

  // auto-resolve stateful alerts whose condition no longer fires
  const producedKeys = new Set(
    drafts.map((d) => `${d.type}|${d.clientId}|${d.dedupeKey}`),
  );
  const stale = await Alert.find(
    { type: { $in: STATEFUL }, acknowledgedAt: null },
    { type: 1, clientId: 1, dedupeKey: 1 },
  ).lean();
  const staleIds = stale
    .filter((a) => !producedKeys.has(`${a.type}|${a.clientId}|${a.dedupeKey}`))
    .map((a) => a._id);
  let resolved = 0;
  if (staleIds.length) {
    const r = await Alert.deleteMany({ _id: { $in: staleIds } });
    resolved = r.deletedCount ?? 0;
  }

  const byType = drafts.reduce<Record<string, number>>((m, d) => {
    m[d.type] = (m[d.type] ?? 0) + 1;
    return m;
  }, {});

  log.info(
    `alerts: ${drafts.length} active (${created} new), ${resolved} auto-resolved · ` +
      Object.entries(byType)
        .map(([k, v]) => `${k}=${v}`)
        .join(" "),
  );

  return {
    docsUpserted: created,
    meta: { active: drafts.length, created, resolved, byType },
  };
};

function integrationProblem(
  meRun: { status?: string; startedAt?: Date; error?: string | null } | null,
  latestRun: { startedAt?: Date } | null,
  now: number,
  thresholds: AlertInput["thresholds"],
): { reason: string; at: number } | null {
  if (meRun?.status === "failed") {
    return {
      reason: meRun.error || "the /me health check failed",
      at: ms(meRun.startedAt) ?? now,
    };
  }
  const staleHours = thresholds.integration_down?.staleAfterHours ?? 6;
  const last = ms(latestRun?.startedAt);
  if (last != null && now - last > staleHours * 3_600_000) {
    const hrs = Math.round((now - last) / 3_600_000);
    return { reason: `no successful sync in ${hrs}h`, at: last };
  }
  return null;
}
