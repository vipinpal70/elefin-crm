import { Schema, model, models, Types } from "../mongoose";
import type { InferSchemaType, Model } from "mongoose";
import { baseSchemaOptions, SYNC_JOBS } from "../shared";

/**
 * A one-off job run requested from the UI. The worker polls this collection,
 * runs the job (so all API pacing stays in one process), and marks it done.
 */
const syncRequestSchema = new Schema(
  {
    job: { type: String, enum: SYNC_JOBS, required: true },
    status: {
      type: String,
      enum: ["pending", "running", "done", "failed"],
      default: "pending",
      index: true,
    },
    requestedBy: { type: Types.ObjectId, ref: "CrmUser", default: null },
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
    result: { type: Schema.Types.Mixed, default: null },
    error: { type: String, default: null },
  },
  baseSchemaOptions,
);

syncRequestSchema.index({ status: 1, createdAt: 1 });
// auto-expire finished requests after 7 days
syncRequestSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 7 });

export type SyncRequestDoc = InferSchemaType<typeof syncRequestSchema>;

export const SyncRequest: Model<SyncRequestDoc> =
  (models.SyncRequest as Model<SyncRequestDoc>) ??
  model<SyncRequestDoc>("SyncRequest", syncRequestSchema, "sync_requests");
