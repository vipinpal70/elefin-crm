import { Schema, model, models } from "../mongoose";
import type { InferSchemaType, Model } from "mongoose";
import { baseSchemaOptions } from "../shared";

/**
 * Tiny cursor store for incremental syncs. `_id` is the stream name
 * (e.g. "transactions", "trades:12345789574"); `cursor` is the high-water mark
 * timestamp we last pulled up to.
 */
const syncStateSchema = new Schema(
  {
    _id: { type: String, required: true },
    cursor: { type: Date, default: null },
    lastRunAt: { type: Date, default: null },
    meta: { type: Schema.Types.Mixed, default: {} },
  },
  { ...baseSchemaOptions, _id: false },
);

export type SyncStateDoc = InferSchemaType<typeof syncStateSchema> & {
  _id: string;
};

export const SyncState: Model<SyncStateDoc> =
  (models.SyncState as Model<SyncStateDoc>) ??
  model<SyncStateDoc>("SyncState", syncStateSchema, "sync_state");
