import { Schema, model, models } from "../mongoose";
import type { InferSchemaType, Model } from "mongoose";
import {
  baseSchemaOptions,
  SYNC_JOBS,
  SYNC_STATUSES,
} from "../shared";

/** One execution of a worker job. Auto-expires after 90 days. */
const syncRunSchema = new Schema(
  {
    job: { type: String, enum: SYNC_JOBS, required: true },
    status: { type: String, enum: SYNC_STATUSES, default: "running" },
    startedAt: { type: Date, default: () => new Date() },
    finishedAt: { type: Date, default: null },
    durationMs: { type: Number, default: null },

    apiCalls: { type: Number, default: 0 },
    docsUpserted: { type: Number, default: 0 },
    rateLimitRemainingMin: { type: Number, default: null },

    error: { type: String, default: null },
    meta: { type: Schema.Types.Mixed, default: {} },
  },
  baseSchemaOptions,
);

syncRunSchema.index({ job: 1, startedAt: -1 });
syncRunSchema.index({ startedAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });

export type SyncRunDoc = InferSchemaType<typeof syncRunSchema>;

export const SyncRun: Model<SyncRunDoc> =
  (models.SyncRun as Model<SyncRunDoc>) ??
  model<SyncRunDoc>("SyncRun", syncRunSchema, "sync_runs");
