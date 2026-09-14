import { Schema, model, models } from "../mongoose";
import type { InferSchemaType, Model } from "mongoose";
import { SYNC_JOBS, jsonSchemaConfig } from "../shared";

/**
 * One Elefin API call made by a worker job — endpoint, params, and the raw
 * response (or error) verbatim, for the /api-log page ("what did Elefin
 * actually send back for this job run"). Written by
 * apps/worker/src/api-logger.ts, which wraps every sync job's API client.
 * High-volume, debug-grade data — auto-expires after 14 days.
 */
const apiCallLogSchema = new Schema(
  {
    job: { type: String, enum: SYNC_JOBS, required: true },
    endpoint: { type: String, required: true },
    params: { type: Schema.Types.Mixed, default: null },

    ok: { type: Boolean, required: true },
    httpStatus: { type: Number, default: null },
    errorCode: { type: String, default: null },
    errorMessage: { type: String, default: null },
    rateLimitRemaining: { type: Number, default: null },
    durationMs: { type: Number, default: null },

    // Best-effort context, parsed from the endpoint/params — lets the log
    // page filter by client without re-parsing every row.
    clientId: { type: Number, default: null },
    login: { type: String, default: null },
    email: { type: String, default: null },

    // The raw response body (one level unwrapped from the {success,message,
    // data} envelope, same as everywhere else). Large payloads are truncated
    // to a preview rather than stored whole.
    body: { type: Schema.Types.Mixed, default: null },
    bodyTruncated: { type: Boolean, default: false },
    bodyRowCount: { type: Number, default: null },

    requestedAt: { type: Date, default: () => new Date() },
  },
  { timestamps: false, toJSON: jsonSchemaConfig },
);

apiCallLogSchema.index({ requestedAt: -1 });
apiCallLogSchema.index({ job: 1, requestedAt: -1 });
apiCallLogSchema.index({ clientId: 1, requestedAt: -1 });
apiCallLogSchema.index({ login: 1, requestedAt: -1 });
// Retention: 14 days — this is a debug trail, not business data.
apiCallLogSchema.index({ requestedAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 14 });

export type ApiCallLogDoc = InferSchemaType<typeof apiCallLogSchema>;

export const ApiCallLog: Model<ApiCallLogDoc> =
  (models.ApiCallLog as Model<ApiCallLogDoc>) ??
  model<ApiCallLogDoc>("ApiCallLog", apiCallLogSchema, "api_call_logs");
