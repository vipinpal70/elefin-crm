/** API-log page: raw Elefin responses per worker job call. Auto-expires after 14 days. */
module.exports = {
  async up(db) {
    const names = (await db.listCollections().toArray()).map((c) => c.name);
    if (!names.includes("api_call_logs")) await db.createCollection("api_call_logs");
    await db.collection("api_call_logs").createIndexes([
      { key: { requestedAt: -1 } },
      { key: { job: 1, requestedAt: -1 } },
      { key: { clientId: 1, requestedAt: -1 } },
      { key: { login: 1, requestedAt: -1 } },
      { key: { requestedAt: 1 }, expireAfterSeconds: 60 * 60 * 24 * 14 },
    ]);
  },
  async down(db) {
    await db.collection("api_call_logs").dropIndexes().catch(() => {});
  },
};
