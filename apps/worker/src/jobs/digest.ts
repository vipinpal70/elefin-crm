import {
  Alert,
  BookDaily,
  ClientNote,
  Client,
  Digest,
  FundingEvent,
} from "@elefin/db";
import { log } from "../logger";
import type { Job } from "../runner";

const usd = (n: number) =>
  `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

/** Decimal128 (or anything stringy) -> number. */
const num = (v: unknown): number => {
  const s = (v as { toString?: () => string })?.toString?.() ?? v;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Compose a once-a-day summary: what changed, what needs doing, where the book
 * stands. Stored as a `Digest` doc and, if `DIGEST_WEBHOOK_URL` is set, POSTed
 * as `{ text, ... }` (Slack / Discord / Telegram-bridge compatible).
 */
export const digestJob: Job = async () => {
  const now = new Date();
  const since = new Date(now.getTime() - 24 * 3_600_000);
  const endOfToday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59),
  );
  const dateKey = now.toISOString().slice(0, 10);

  const [newAlerts, dueNotes, latestBook, bigDeposits] = await Promise.all([
    Alert.find({ createdAt: { $gte: since } }, { type: 1, severity: 1, title: 1 })
      .sort({ severity: 1 })
      .lean(),
    ClientNote.find(
      { dueAt: { $ne: null, $lte: endOfToday }, doneAt: null },
      { clientId: 1, body: 1, dueAt: 1 },
    )
      .sort({ dueAt: 1 })
      .lean(),
    BookDaily.findOne({ "meta.referralCode": "*" }).sort({ date: -1 }).lean(),
    FundingEvent.find(
      { type: "deposit", status: "success", occurredAt: { $gte: since } },
      { clientId: 1, amount: 1 },
    )
      .sort({ amount: -1 })
      .limit(3)
      .lean(),
  ]);

  const sevCount = newAlerts.reduce<Record<string, number>>((m, a) => {
    m[a.severity] = (m[a.severity] ?? 0) + 1;
    return m;
  }, {});

  const depIds = [
    ...new Set(bigDeposits.map((d) => d.clientId).filter((x): x is number => x != null)),
    ...new Set(dueNotes.map((n) => n.clientId)),
  ];
  const names = new Map(
    (await Client.find({ _id: { $in: depIds } }, { name: 1 }).lean()).map((c) => [
      c._id,
      c.name ?? `#${c._id}`,
    ]),
  );

  const b = latestBook;
  const lines: string[] = [
    `Elefin digest — ${dateKey}`,
    "",
    "Book:",
    b
      ? `  ${b.clientsTotal} clients (${b.clientsFunded} funded, ${b.clientsActiveTraders} active) · ` +
        `net deposit ${usd(num(b.netDepositCum))} · commission ${usd(num(b.commissionCum))} · ` +
        `client PnL ${usd(num(b.clientPnlCum))}`
      : "  (no snapshot yet)",
    "",
    `New alerts (24h): ${newAlerts.length}` +
      (newAlerts.length
        ? ` — ${sevCount.critical ?? 0} critical, ${sevCount.warning ?? 0} warning`
        : ""),
    ...newAlerts.slice(0, 5).map((a) => `  • ${a.title}`),
    "",
    `Follow-ups due: ${dueNotes.length}`,
    ...dueNotes
      .slice(0, 8)
      .map(
        (n) =>
          `  • ${n.dueAt ? new Date(n.dueAt).toISOString().slice(0, 10) : ""} ` +
          `${names.get(n.clientId) ?? `#${n.clientId}`} — ${n.body.slice(0, 80)}`,
      ),
    "",
    `Big deposits (24h): ${bigDeposits.length}`,
    ...bigDeposits.map(
      (d) =>
        `  • ${d.clientId != null ? names.get(d.clientId) ?? `#${d.clientId}` : "?"} ` +
        `${usd(num(d.amount))}`,
    ),
  ];
  const text = lines.join("\n");

  const payload = {
    date: dateKey,
    book: b
      ? {
          clients: b.clientsTotal,
          funded: b.clientsFunded,
          active: b.clientsActiveTraders,
          netDepositCum: num(b.netDepositCum),
          commissionCum: num(b.commissionCum),
          clientPnlCum: num(b.clientPnlCum),
        }
      : null,
    newAlerts: newAlerts.length,
    alertsBySeverity: sevCount,
    followUpsDue: dueNotes.length,
    bigDeposits: bigDeposits.length,
  };

  await Digest.updateOne(
    { _id: dateKey },
    { $set: { generatedAt: new Date(), text, payload, deliveredAt: null, deliveryError: null } },
    { upsert: true },
  );

  const url = process.env.DIGEST_WEBHOOK_URL;
  let delivered = false;
  if (url) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, ...payload }),
      });
      if (!res.ok) throw new Error(`webhook ${res.status}`);
      await Digest.updateOne({ _id: dateKey }, { $set: { deliveredAt: new Date() } });
      delivered = true;
    } catch (err) {
      await Digest.updateOne(
        { _id: dateKey },
        { $set: { deliveryError: err instanceof Error ? err.message : String(err) } },
      );
      log.warn(`digest webhook failed: ${(err as Error).message}`);
    }
  }

  log.info(
    `digest ${dateKey}: ${newAlerts.length} new alerts, ${dueNotes.length} follow-ups due` +
      (url ? ` · webhook ${delivered ? "sent" : "failed"}` : ""),
  );

  return { docsUpserted: 1, meta: payload };
};
