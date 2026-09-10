import { Schema, model, models, Types } from "../mongoose";
import type { InferSchemaType, Model } from "mongoose";
import { baseSchemaOptions } from "../shared";

/** A named set of filters a user pinned on a page. */
const savedViewSchema = new Schema(
  {
    userId: { type: Types.ObjectId, ref: "CrmUser", required: true },
    page: { type: String, required: true },
    name: { type: String, required: true },
    filters: { type: Schema.Types.Mixed, default: {} },
    isShared: { type: Boolean, default: false },
  },
  baseSchemaOptions,
);

savedViewSchema.index({ userId: 1, page: 1 });

export type SavedViewDoc = InferSchemaType<typeof savedViewSchema>;

export const SavedView: Model<SavedViewDoc> =
  (models.SavedView as Model<SavedViewDoc>) ??
  model<SavedViewDoc>("SavedView", savedViewSchema, "saved_views");
