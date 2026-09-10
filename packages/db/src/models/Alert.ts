import { Schema, model, models, Types } from "../mongoose";
import type { InferSchemaType, Model } from "mongoose";
import { baseSchemaOptions, ALERT_SEVERITIES } from "../shared";

/**
 * A generated action item ("who do I call today"). The unique key on
 * (type, clientId, dedupeKey) stops the same alert being recreated each sync —
 * pick `dedupeKey` so it changes only when a genuinely new occurrence happens
 * (e.g. the deposit id, or the ISO week).
 */
const alertSchema = new Schema(
  {
    type: { type: String, required: true, index: true },
    clientId: { type: Number, default: null, index: true },
    severity: { type: String, enum: ALERT_SEVERITIES, default: "info" },
    dedupeKey: { type: String, default: "" },
    title: { type: String, default: "" },
    payload: { type: Schema.Types.Mixed, default: {} },
    lastSeenAt: { type: Date, default: null },

    acknowledgedBy: { type: Types.ObjectId, ref: "CrmUser", default: null },
    acknowledgedAt: { type: Date, default: null },
    snoozedUntil: { type: Date, default: null },
  },
  baseSchemaOptions,
);

alertSchema.index({ type: 1, clientId: 1, dedupeKey: 1 }, { unique: true });
alertSchema.index({ acknowledgedAt: 1, createdAt: -1 });

export type AlertDoc = InferSchemaType<typeof alertSchema>;

export const Alert: Model<AlertDoc> =
  (models.Alert as Model<AlertDoc>) ??
  model<AlertDoc>("Alert", alertSchema, "alerts");
