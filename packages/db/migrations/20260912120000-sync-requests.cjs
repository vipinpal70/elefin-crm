/** Phase 6: UI-triggered job queue. */
module.exports = {
  async up(db) {
    await db.collection("sync_requests").createIndexes([
      { key: { status: 1 } },
      { key: { status: 1, createdAt: 1 } },
      { key: { createdAt: 1 }, expireAfterSeconds: 60 * 60 * 24 * 7 },
    ]);
  },
  async down(db) {
    await db.collection("sync_requests").dropIndexes().catch(() => {});
  },
};
