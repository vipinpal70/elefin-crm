/**
 * Phase 2: the funding ledger (GET /transactions) and the incremental-sync
 * cursor store. Index specs match the Mongoose schemas.
 */
module.exports = {
  async up(db) {
    await db.collection("funding_events").createIndexes([
      { key: { type: 1, occurredAt: -1 } },
      { key: { clientId: 1, occurredAt: -1 } },
      { key: { status: 1 } },
      { key: { occurredAt: 1 } },
      { key: { login: 1 } },
    ]);

    // extra trade indexes are already covered by the baseline migration
    // (login+closeAt, clientId+closeAt, symbol, closeAt)

    // sync_state needs no secondary indexes (all lookups are by _id)
    const names = (await db.listCollections().toArray()).map((c) => c.name);
    if (!names.includes("sync_state")) await db.createCollection("sync_state");
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
    await drop("funding_events", [
      { type: 1, occurredAt: -1 },
      { clientId: 1, occurredAt: -1 },
      { status: 1 },
      { occurredAt: 1 },
      { login: 1 },
    ]);
  },
};
