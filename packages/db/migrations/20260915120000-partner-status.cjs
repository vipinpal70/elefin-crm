/** Partner-code change detection: partnerStatus on clients, affiliated on accounts. */
module.exports = {
  async up(db) {
    await db.collection("clients").createIndexes([
      { key: { partnerStatus: 1 } },
    ]);
  },
  async down(db) {
    await db
      .collection("clients")
      .dropIndex({ partnerStatus: 1 })
      .catch(() => {});
  },
};
