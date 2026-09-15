/**
 * "TC" (to-confirm) staging (per user request, 2026-09-15): every uploaded
 * roster row now lands in external_traders unconfirmed and only moves into
 * the Elefin or XM book once a human explicitly confirms it. Rows created
 * before this change were committed under the old direct-apply flow, so
 * they're backfilled as already-confirmed rather than surfacing as a
 * backlog of "unconfirmed" work that was, in fact, already decided.
 */
module.exports = {
  async up(db) {
    await db
      .collection("external_traders")
      .updateMany({ confirmed: { $exists: false } }, { $set: { confirmed: true } });

    await db
      .collection("external_traders")
      .dropIndex({ brokerNormalized: 1, needsReview: 1 })
      .catch(() => {});
    await db.collection("external_traders").createIndexes([
      { key: { confirmed: 1, brokerNormalized: 1, needsReview: 1 } },
    ]);
  },
  async down(db) {
    await db
      .collection("external_traders")
      .dropIndex({ confirmed: 1, brokerNormalized: 1, needsReview: 1 })
      .catch(() => {});
    await db.collection("external_traders").createIndexes([
      { key: { brokerNormalized: 1, needsReview: 1 } },
    ]);
    await db
      .collection("external_traders")
      .updateMany({}, { $unset: { confirmed: "" } });
  },
};
