/**
 * Baseline: create the two time-series collections and every index from
 * project-structure-plan.md §5. Index specs and (auto) names match the Mongoose
 * schema declarations, so running this is idempotent alongside dev auto-indexing.
 */

const TS_OPTS = {
  timeseries: { timeField: "date", metaField: "meta", granularity: "hours" },
};

module.exports = {
  async up(db) {
    const existing = (await db.listCollections().toArray()).map((c) => c.name);
    for (const name of ["client_daily", "book_daily"]) {
      if (!existing.includes(name)) await db.createCollection(name, TS_OPTS);
    }

    await db.collection("clients").createIndexes([
      { key: { referralCode: 1, registeredAt: -1 } },
      { key: { fundingIsFunded: 1 } },
      { key: { status: 1 } },
      { key: { country: 1 } },
      { key: { tradingLastTradeAt: 1 } },
      { key: { logins: 1 } },
      { key: { name: "text", email: "text" }, name: "client_text" },
    ]);

    await db.collection("accounts").createIndexes([
      { key: { clientId: 1 } },
      { key: { lastTradeAt: 1 } },
    ]);

    await db.collection("trades").createIndexes([
      { key: { login: 1, closeAt: -1 } },
      { key: { clientId: 1, closeAt: -1 } },
      { key: { symbol: 1 } },
      { key: { closeAt: 1 } },
    ]);

    await db.collection("positions").createIndexes([
      { key: { login: 1 } },
      { key: { clientId: 1 } },
    ]);

    await db.collection("crm_users").createIndexes([
      { key: { email: 1 }, unique: true },
      { key: { role: 1 } },
    ]);

    await db.collection("sync_runs").createIndexes([
      { key: { job: 1, startedAt: -1 } },
      { key: { startedAt: 1 }, expireAfterSeconds: 60 * 60 * 24 * 90 },
    ]);

    await db
      .collection("saved_views")
      .createIndexes([{ key: { userId: 1, page: 1 } }]);

    await db.collection("alerts").createIndexes([
      { key: { type: 1, clientId: 1, dedupeKey: 1 }, unique: true },
      { key: { acknowledgedAt: 1, createdAt: -1 } },
    ]);

    await db.collection("audit_log").createIndexes([
      { key: { userId: 1, at: -1 } },
      { key: { at: 1 }, expireAfterSeconds: 60 * 60 * 24 * 400 },
    ]);
  },

  async down(db) {
    const drop = async (coll, keys) => {
      for (const key of keys) {
        await db
          .collection(coll)
          .dropIndex(key)
          .catch(() => {});
      }
    };
    await drop("clients", [
      { referralCode: 1, registeredAt: -1 },
      { fundingIsFunded: 1 },
      { status: 1 },
      { country: 1 },
      { tradingLastTradeAt: 1 },
      { logins: 1 },
      "client_text",
    ]);
    await drop("accounts", [{ clientId: 1 }, { lastTradeAt: 1 }]);
    await drop("trades", [
      { login: 1, closeAt: -1 },
      { clientId: 1, closeAt: -1 },
      { symbol: 1 },
      { closeAt: 1 },
    ]);
    await drop("positions", [{ login: 1 }, { clientId: 1 }]);
    await drop("crm_users", [{ email: 1 }, { role: 1 }]);
    await drop("sync_runs", [{ job: 1, startedAt: -1 }, { startedAt: 1 }]);
    await drop("saved_views", [{ userId: 1, page: 1 }]);
    await drop("alerts", [
      { type: 1, clientId: 1, dedupeKey: 1 },
      { acknowledgedAt: 1, createdAt: -1 },
    ]);
    await drop("audit_log", [{ userId: 1, at: -1 }, { at: 1 }]);
  },
};
