import { Schema, model, models } from "../mongoose";
import type { InferSchemaType, Model } from "mongoose";
import { baseSchemaOptions } from "../shared";

/** A generated daily summary. `_id` is the UTC date (YYYY-MM-DD). */
const digestSchema = new Schema(
  {
    _id: { type: String, required: true },
    generatedAt: { type: Date, default: () => new Date() },
    text: { type: String, default: "" },
    payload: { type: Schema.Types.Mixed, default: {} },
    deliveredAt: { type: Date, default: null },
    deliveryError: { type: String, default: null },
  },
  { ...baseSchemaOptions, _id: false },
);

digestSchema.index({ generatedAt: -1 });
// keep 90 days
digestSchema.index({ generatedAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });

export type DigestDoc = InferSchemaType<typeof digestSchema> & { _id: string };

export const Digest: Model<DigestDoc> =
  (models.Digest as Model<DigestDoc>) ??
  model<DigestDoc>("Digest", digestSchema, "digests");
