/** Phase 5: client notes + saved-views indexes. */
module.exports = {
  async up(db) {
    await db.collection("client_notes").createIndexes([
      { key: { clientId: 1, createdAt: -1 } },
      { key: { dueAt: 1, doneAt: 1 } },
    ]);
    await db.collection("saved_views").createIndexes([
      { key: { userId: 1, page: 1 } },
      { key: { page: 1, isShared: 1 } },
    ]);
  },
  async down(db) {
    await db.collection("client_notes").dropIndexes().catch(() => {});
    await db
      .collection("saved_views")
      .dropIndex({ page: 1, isShared: 1 })
      .catch(() => {});
  },
};
