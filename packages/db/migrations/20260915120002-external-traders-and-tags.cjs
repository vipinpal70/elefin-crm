/**
 * Sheet import feature (sheet-plan.md): external_traders, external_trades,
 * import_runs collections, plus a tags index on clients.
 */
module.exports = {
  async up(db) {
    const names = (await db.listCollections().toArray()).map((c) => c.name);
    for (const name of ["external_traders", "external_trades", "import_runs"]) {
      if (!names.includes(name)) await db.createCollection(name);
    }

    await db.collection("external_traders").createIndexes([
      { key: { email: 1 } },
      { key: { mt5Login: 1 } },
      { key: { brokerNormalized: 1 } },
      { key: { linkedClientId: 1 } },
      { key: { brokerNormalized: 1, needsReview: 1 } },
    ]);

    await db.collection("external_trades").createIndexes([
      { key: { broker: 1 } },
      { key: { login: 1 } },
      { key: { externalTraderId: 1 } },
      { key: { login: 1, closeAt: -1 } },
    ]);

    await db.collection("import_runs").createIndexes([
      { key: { kind: 1, createdAt: -1 } },
    ]);

    await db.collection("clients").createIndexes([{ key: { tags: 1 } }]);
  },
  async down(db) {
    await db
      .collection("clients")
      .dropIndex({ tags: 1 })
      .catch(() => {});
    for (const name of ["external_traders", "external_trades", "import_runs"]) {
      await db.collection(name).dropIndexes().catch(() => {});
    }
  },
};
