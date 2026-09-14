/**
 * Backfill partnerStatus/affiliated onto pre-existing documents. Mongoose
 * schema defaults are only applied by the document layer (new Model(),
 * .save(), etc.) — a raw .lean() find on a document stored before the field
 * existed just omits it. Application logic already treats "absent" the same
 * as "active"/true everywhere, so this is a hygiene fix, not a bug fix: makes
 * a plain `{ partnerStatus: "active" }` query behave as expected too.
 */
module.exports = {
  async up(db) {
    await db
      .collection("clients")
      .updateMany({ partnerStatus: { $exists: false } }, { $set: { partnerStatus: "active" } });
    await db
      .collection("accounts")
      .updateMany({ affiliated: { $exists: false } }, { $set: { affiliated: true } });
  },
  async down() {
    // Not reversible in a meaningful way — leave the backfilled values as-is.
  },
};
