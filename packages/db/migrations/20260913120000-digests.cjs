/** Phase 7: daily digest store. */
module.exports = {
  async up(db) {
    const names = (await db.listCollections().toArray()).map((c) => c.name);
    if (!names.includes("digests")) await db.createCollection("digests");
    await db.collection("digests").createIndexes([
      { key: { generatedAt: -1 } },
      { key: { generatedAt: 1 }, expireAfterSeconds: 60 * 60 * 24 * 90 },
    ]);
  },
  async down(db) {
    await db.collection("digests").dropIndexes().catch(() => {});
  },
};
