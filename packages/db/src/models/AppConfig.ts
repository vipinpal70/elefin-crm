import { Schema, model, models } from "../mongoose";
import type { InferSchemaType, Model } from "mongoose";
import { baseSchemaOptions } from "../shared";

/**
 * Singleton config blobs, keyed by name (e.g. "alerts" -> tunable thresholds).
 * Read with a catalogue default as fallback; written from Settings.
 */
const appConfigSchema = new Schema(
  {
    _id: { type: String, required: true },
    data: { type: Schema.Types.Mixed, default: {} },
    updatedBy: { type: Schema.Types.ObjectId, ref: "CrmUser", default: null },
  },
  { ...baseSchemaOptions, _id: false },
);

export type AppConfigDoc = InferSchemaType<typeof appConfigSchema> & {
  _id: string;
};

export const AppConfig: Model<AppConfigDoc> =
  (models.AppConfig as Model<AppConfigDoc>) ??
  model<AppConfigDoc>("AppConfig", appConfigSchema, "app_config");
