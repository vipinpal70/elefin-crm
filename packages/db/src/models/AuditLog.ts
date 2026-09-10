import { Schema, model, models, Types } from "../mongoose";
import type { InferSchemaType, Model } from "mongoose";
import { jsonSchemaConfig } from "../shared";

/** Append-only trail: logins, exports, user changes, manual syncs, PII reveals. */
const auditLogSchema = new Schema(
  {
    userId: { type: Types.ObjectId, ref: "CrmUser", default: null },
    action: { type: String, required: true },
    entity: { type: String, default: null },
    entityId: { type: String, default: null },
    at: { type: Date, default: () => new Date() },
    ip: { type: String, default: null },
    meta: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: false, toJSON: jsonSchemaConfig },
);

auditLogSchema.index({ userId: 1, at: -1 });
// Retention: 400 days (also serves range queries on `at`). Adjust per compliance.
auditLogSchema.index({ at: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 400 });

export type AuditLogDoc = InferSchemaType<typeof auditLogSchema>;

export const AuditLog: Model<AuditLogDoc> =
  (models.AuditLog as Model<AuditLogDoc>) ??
  model<AuditLogDoc>("AuditLog", auditLogSchema, "audit_log");
