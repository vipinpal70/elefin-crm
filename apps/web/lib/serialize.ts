/**
 * Convert Mongoose `.lean()` output into JSON-safe primitives:
 * Decimal128 -> number, ObjectId -> string, Date -> ISO string.
 * Use before passing DB docs to client components or `@elefin/domain`.
 */
type Bsonish = { _bsontype?: string; toString(): string; $numberDecimal?: string };

function isDecimal(v: unknown): v is Bsonish {
  return (
    typeof v === "object" &&
    v !== null &&
    (("_bsontype" in v && (v as Bsonish)._bsontype === "Decimal128") ||
      "$numberDecimal" in v)
  );
}

function isObjectId(v: unknown): v is Bsonish {
  return (
    typeof v === "object" &&
    v !== null &&
    "_bsontype" in v &&
    ((v as Bsonish)._bsontype === "ObjectId" ||
      (v as Bsonish)._bsontype === "ObjectID")
  );
}

export function plain<T = unknown>(value: unknown): T {
  if (value == null) return value as T;
  if (value instanceof Date) return value.toISOString() as T;
  if (isDecimal(value)) {
    return Number(value.$numberDecimal ?? value.toString()) as T;
  }
  if (isObjectId(value)) return value.toString() as T;
  if (Array.isArray(value)) return value.map((v) => plain(v)) as T;
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = plain(v);
    return out as T;
  }
  return value as T;
}
