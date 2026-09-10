/** Phase 4: watchlist unique index + alert helper indexes. */
module.exports = {
  async up(db) {
    await db.collection("watchlist").createIndexes([
      { key: { userId: 1, clientId: 1 }, unique: true },
      { key: { userId: 1, createdAt: -1 } },
    ]);
    await db.collection("alerts").createIndexes([
      { key: { snoozedUntil: 1 } },
      { key: { severity: 1, createdAt: -1 } },
    ]);
  },
  async down(db) {
    await db.collection("watchlist").dropIndexes().catch(() => {});
    await db
      .collection("alerts")
      .dropIndex({ snoozedUntil: 1 })
      .catch(() => {});
    await db
      .collection("alerts")
      .dropIndex({ severity: 1, createdAt: -1 })
      .catch(() => {});
  },
};
