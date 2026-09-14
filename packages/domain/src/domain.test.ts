import { test } from "node:test";
import assert from "node:assert/strict";

import { n, sum, sumBy, round, ratio, pct } from "./money";
import {
  utcDayStart,
  utcDayKey,
  addUtcDays,
  eachUtcDay,
  isoWeekKey,
  daysBetween,
} from "./time";
import { bookKpis, conversionFunnel } from "./kpis";
import { tradingStats, netOf } from "./metrics/trading";
import { evaluateAlerts, type AlertInput } from "./alerts";

/* ── money ──────────────────────────────────────────────── */

test("money: n() coerces and defends", () => {
  assert.equal(n(3), 3);
  assert.equal(n("2.5"), 2.5);
  assert.equal(n(null), 0);
  assert.equal(n(undefined), 0);
  assert.equal(n(""), 0);
  assert.equal(n("not a number"), 0);
  assert.equal(n(NaN), 0);
});

test("money: sum / sumBy / round / ratio / pct", () => {
  assert.equal(sum([1, "2", null, 3]), 6);
  assert.equal(sumBy([{ v: 1 }, { v: "2" }], (x) => x.v), 3);
  assert.equal(round(1.005, 2), 1.01);
  assert.equal(round(2.345, 2), 2.35);
  assert.equal(ratio(1, 4), 0.25);
  assert.equal(ratio(1, 0), 0); // no divide-by-zero
  assert.equal(pct(1, 4), 25);
  assert.equal(pct(0, 0), 0);
});

/* ── time ───────────────────────────────────────────────── */

test("time: UTC day helpers", () => {
  const d = "2026-09-10T13:45:00Z";
  assert.equal(utcDayStart(d).toISOString(), "2026-09-10T00:00:00.000Z");
  assert.equal(utcDayKey(d), "2026-09-10");
  assert.equal(addUtcDays(utcDayStart(d), 1).toISOString(), "2026-09-11T00:00:00.000Z");
  assert.equal(daysBetween("2026-09-01", "2026-09-10"), 9);
});

test("time: eachUtcDay is inclusive", () => {
  const days = eachUtcDay("2026-09-08", "2026-09-10");
  assert.deepEqual(
    days.map((d) => d.toISOString().slice(0, 10)),
    ["2026-09-08", "2026-09-09", "2026-09-10"],
  );
});

test("time: isoWeekKey", () => {
  // 2026-01-01 is a Thursday -> ISO week 1
  assert.equal(isoWeekKey("2026-01-01"), "2026-W01");
  assert.equal(isoWeekKey("2026-09-10"), isoWeekKey("2026-09-07")); // same Mon-Sun week
});

/* ── bookKpis ───────────────────────────────────────────── */

const NOW = Date.UTC(2026, 8, 10); // 2026-09-10

const clientsFixture = [
  {
    fundingIsFunded: true,
    fundingDeposits: 200,
    fundingWithdrawals: 50,
    fundingNetDeposit: 150,
    tradingLots: 2,
    tradingTrades: 10,
    tradingNetProfit: -30,
    tradingLastTradeAt: new Date(NOW - 2 * 86_400_000).toISOString(), // active
    commissionEarned: 4,
    accountsBalance: 120,
    accountsEquity: 120,
  },
  {
    fundingIsFunded: true,
    fundingDeposits: 100,
    fundingWithdrawals: 0,
    fundingNetDeposit: 100,
    tradingLots: 0,
    tradingTrades: 0,
    tradingNetProfit: 0,
    tradingLastTradeAt: null,
    commissionEarned: 0,
    accountsBalance: 100,
    accountsEquity: 100,
  },
  {
    fundingIsFunded: false,
    fundingDeposits: 0,
    fundingWithdrawals: 0,
    fundingNetDeposit: 0,
    tradingLots: 1,
    tradingTrades: 5,
    tradingNetProfit: 40,
    tradingLastTradeAt: new Date(NOW - 60 * 86_400_000).toISOString(), // dormant, but not funded
    commissionEarned: 2,
    accountsBalance: 40,
    accountsEquity: 40,
  },
];

test("bookKpis: counts, rates and totals", () => {
  const k = bookKpis(clientsFixture, { asOf: new Date(NOW), dormantAfterDays: 30 });
  assert.equal(k.clientsTotal, 3);
  assert.equal(k.clientsFunded, 2);
  assert.equal(k.fundedRate, 66.7);
  assert.equal(k.activeTraders, 2); // clients with tradingTrades > 0
  assert.equal(k.totalDeposits, 300);
  assert.equal(k.totalWithdrawals, 50);
  assert.equal(k.netDeposits, 250);
  assert.equal(k.totalLots, 3);
  assert.equal(k.totalTrades, 15);
  assert.equal(k.clientPnl, 10); // -30 + 0 + 40
  assert.equal(k.totalLost, -30); // only the negative one
  assert.equal(k.commissionEarned, 6);
  assert.equal(k.commissionPerLot, 2);
});

test("bookKpis: dormant = funded + no trade in window", () => {
  const k = bookKpis(clientsFixture, { asOf: new Date(NOW), dormantAfterDays: 30 });
  // client 2 is funded with a null last-trade -> dormant; client 1 traded 2d ago -> not
  assert.equal(k.dormantClients, 1);
});

test("conversionFunnel: stages and rates", () => {
  const f = conversionFunnel(clientsFixture, { asOf: new Date(NOW), dormantAfterDays: 30 });
  assert.deepEqual(
    f.map((s) => s.key),
    ["signed_up", "funded", "traded", "active"],
  );
  assert.equal(f[0]!.count, 3);
  assert.equal(f[1]!.count, 2);
  assert.equal(f[2]!.count, 2);
  assert.equal(f[0]!.rateOfTop, 100);
});

/* ── tradingStats ───────────────────────────────────────── */

const trades = [
  { symbol: "XAUUSD", side: "buy", volumeLots: 1, netPnl: 10, openAt: "2026-09-01T00:00:00Z", closeAt: "2026-09-01T01:00:00Z" },
  { symbol: "XAUUSD", side: "sell", volumeLots: 1, netPnl: -4, openAt: "2026-09-02T00:00:00Z", closeAt: "2026-09-02T02:00:00Z" },
  { symbol: "EURUSD", side: "buy", volumeLots: 2, netPnl: 6, openAt: "2026-09-02T03:00:00Z", closeAt: "2026-09-02T04:00:00Z" },
  { symbol: "XAUUSD", side: "sell", volumeLots: 1, netPnl: -12, openAt: "2026-09-03T00:00:00Z", closeAt: "2026-09-03T01:00:00Z" },
];

test("tradingStats: core metrics", () => {
  const s = tradingStats(trades);
  assert.equal(s.trades, 4);
  assert.equal(s.wins, 2);
  assert.equal(s.losses, 2);
  assert.equal(s.netPnl, 0); // 10 - 4 + 6 - 12
  assert.equal(s.grossProfit, 16);
  assert.equal(s.grossLoss, 16);
  assert.equal(s.profitFactor, 1); // 16 / 16
  assert.equal(s.largestWin, 10);
  assert.equal(s.largestLoss, -12);
  assert.equal(s.totalLots, 5);
  assert.equal(s.winRate, 0.5);
});

test("tradingStats: profitFactor is null with no losses", () => {
  const s = tradingStats([{ netPnl: 5, closeAt: "2026-09-01T00:00:00Z" }]);
  assert.equal(s.profitFactor, null);
});

test("tradingStats: equity curve and daily buckets", () => {
  const s = tradingStats(trades);
  assert.equal(s.equityCurve.at(-1)!.cum, 0);
  assert.equal(s.equityCurve[0]!.cum, 10);
  // three distinct close-days
  assert.equal(s.dailyPnl.length, 3);
  assert.equal(s.dailyPnl.find((d) => d.date === "2026-09-02")!.pnl, 2); // -4 + 6
  // sorted by closeAt the running cum is 10, 6, 12, 0 -> peak 12, trough 0
  assert.equal(s.maxDrawdown, 12);
});

test("tradingStats: bySymbol", () => {
  const s = tradingStats(trades);
  const xau = s.bySymbol.find((r) => r.symbol === "XAUUSD")!;
  assert.equal(xau.trades, 3);
  assert.equal(xau.netPnl, -6);
});

test("netOf: falls back to profit + commission + swap", () => {
  assert.equal(netOf({ netPnl: 7 }), 7);
  assert.equal(netOf({ profit: 5, commission: -1, swap: -0.5 }), 3.5);
});

/* ── evaluateAlerts ─────────────────────────────────────── */

function baseInput(overrides: Partial<AlertInput> = {}): AlertInput {
  return {
    now: NOW,
    thresholds: {},
    clients: [],
    recentTxns: [],
    accounts: [],
    integrationDown: null,
    ...overrides,
  };
}

test("evaluateAlerts: big deposit inside the window", () => {
  const out = evaluateAlerts(
    baseInput({
      recentTxns: [
        { id: "DEP-1", clientId: 1, type: "deposit", amount: 800, occurredAt: NOW - 3_600_000 },
        { id: "DEP-2", clientId: 2, type: "deposit", amount: 100, occurredAt: NOW - 3_600_000 }, // below min
        { id: "DEP-3", clientId: 3, type: "deposit", amount: 900, occurredAt: NOW - 5 * 86_400_000 }, // too old
      ],
      clients: [{ ...clientStub(1) }, { ...clientStub(2) }, { ...clientStub(3) }],
    }),
  );
  const big = out.filter((a) => a.type === "big_deposit");
  assert.equal(big.length, 1);
  assert.equal(big[0]!.dedupeKey, "DEP-1");
});

test("evaluateAlerts: funded-never-traded and new-whale", () => {
  const out = evaluateAlerts(
    baseInput({
      clients: [
        {
          ...clientStub(1),
          fundingIsFunded: true,
          tradingTrades: 0,
          fundingFirstDepositAt: NOW - 20 * 86_400_000,
          fundingNetDeposit: 750,
        },
      ],
    }),
  );
  const types = out.map((a) => a.type).sort();
  assert.ok(types.includes("funded_never_traded"));
  assert.ok(types.includes("new_whale"));
});

test("evaluateAlerts: dormant dedupeKey tracks the last trade day", () => {
  const lastTrade = Date.UTC(2026, 7, 1); // 2026-08-01
  const out = evaluateAlerts(
    baseInput({
      clients: [
        {
          ...clientStub(1),
          tradingTrades: 12,
          tradingLastTradeAt: lastTrade,
        },
      ],
      thresholds: { gone_dormant: { days: 20 } },
    }),
  );
  const d = out.find((a) => a.type === "gone_dormant");
  assert.ok(d);
  assert.equal(d!.dedupeKey, "2026-08-01");
});

test("evaluateAlerts: partner_code_changed fires for a departed client only", () => {
  const out = evaluateAlerts(
    baseInput({
      clients: [
        { ...clientStub(1), partnerStatus: "departed" },
        { ...clientStub(2) }, // still active
      ],
    }),
  );
  const fired = out.filter((a) => a.type === "partner_code_changed");
  assert.equal(fired.length, 1);
  assert.equal(fired[0]!.clientId, 1);
  assert.equal(fired[0]!.severity, "warning");
});

test("evaluateAlerts: integration_down is emitted when set", () => {
  const out = evaluateAlerts(
    baseInput({ integrationDown: { reason: "401", at: NOW } }),
  );
  assert.equal(out.filter((a) => a.type === "integration_down").length, 1);
});

function clientStub(id: number) {
  return {
    _id: id,
    name: `C${id}`,
    fundingIsFunded: false,
    fundingNetDeposit: 0,
    accountsBalance: 0,
    accountsEquity: 0,
    tradingTrades: 0,
    tradingLastTradeAt: null,
    fundingFirstDepositAt: null,
    firstTradeAt: null,
    partnerStatus: "active" as const,
  };
}
