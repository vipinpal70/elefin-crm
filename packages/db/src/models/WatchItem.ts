import { Schema, model, models, Types } from "../mongoose";
import type { InferSchemaType, Model } from "mongoose";
import { baseSchemaOptions } from "../shared";

/** A client a CRM user has starred to keep an eye on. */
const watchItemSchema = new Schema(
  {
    userId: { type: Types.ObjectId, ref: "CrmUser", required: true },
    clientId: { type: Number, required: true },
    note: { type: String, default: "" },
  },
  baseSchemaOptions,
);

watchItemSchema.index({ userId: 1, clientId: 1 }, { unique: true });
watchItemSchema.index({ userId: 1, createdAt: -1 });

export type WatchItemDoc = InferSchemaType<typeof watchItemSchema>;

export const WatchItem: Model<WatchItemDoc> =
  (models.WatchItem as Model<WatchItemDoc>) ??
  model<WatchItemDoc>("WatchItem", watchItemSchema, "watchlist");
