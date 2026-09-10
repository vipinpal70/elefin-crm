import { Schema, model, models } from "../mongoose";
import type { InferSchemaType, Model } from "mongoose";
import { Decimal128, baseSchemaOptions, SIDES } from "../shared";

/**
 * One currently-open position, from a per-minute platform snapshot.
 * `asOf === null` means UNKNOWN (sync stalled), not "flat".
 * Rows not seen in the latest sync for a login are deleted by the worker.
 */
const positionSchema = new Schema(
  {
    _id: { type: String, required: true },

    login: { type: String, required: true, index: true },
    clientId: { type: Number, default: null, index: true },

    symbol: { type: String, default: null },
    side: { type: String, enum: SIDES, default: null },
    volumeLots: { type: Decimal128, default: "0" },

    openPrice: { type: Decimal128, default: null },
    currentPrice: { type: Decimal128, default: null },
    openAt: { type: Date, default: null },
    unrealizedPnl: { type: Decimal128, default: "0" },

    asOf: { type: Date, default: null },

    raw: { type: Schema.Types.Mixed, select: false },
    syncedAt: { type: Date, default: () => new Date() },
  },
  { ...baseSchemaOptions, _id: false },
);

export type PositionDoc = InferSchemaType<typeof positionSchema> & {
  _id: string;
};

export const Position: Model<PositionDoc> =
  (models.Position as Model<PositionDoc>) ??
  model<PositionDoc>("Position", positionSchema, "positions");
