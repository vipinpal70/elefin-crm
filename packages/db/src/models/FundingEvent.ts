import { Schema, model, models } from "../mongoose";
import type { InferSchemaType, Model } from "mongoose";
import { Decimal128, baseSchemaOptions, TXN_TYPES } from "../shared";

/**
 * One deposit or withdrawal, from GET /transactions?type=deposit|withdrawal
 * (book-wide ledger, probed 2026-09-07). `_id` is the API's stable id
 * (e.g. "DEP-NEU4FE" / "WDR-06EE35"), so a re-sync upserts — never duplicates.
 */
const fundingEventSchema = new Schema(
  {
    _id: { type: String, required: true },

    clientId: { type: Number, default: null },
    login: { type: String, default: null },
    type: { type: String, enum: TXN_TYPES, required: true },
    status: { type: String, default: "success" },

    currency: { type: String, default: "USD" },
    amount: { type: Decimal128, default: "0" },
    fee: { type: Decimal128, default: "0" },

    paymentMethod: { type: String, default: null },
    paidCurrency: { type: String, default: null },
    paidAmount: { type: Decimal128, default: null },
    exchangeRate: { type: Decimal128, default: null },

    /** `created_at` from the API — when the transaction happened. */
    occurredAt: { type: Date, default: null },
    apiUpdatedAt: { type: Date, default: null },

    raw: { type: Schema.Types.Mixed, select: false },
    syncedAt: { type: Date, default: () => new Date() },
  },
  { ...baseSchemaOptions, _id: false },
);

fundingEventSchema.index({ type: 1, occurredAt: -1 });
fundingEventSchema.index({ clientId: 1, occurredAt: -1 });
fundingEventSchema.index({ status: 1 });
fundingEventSchema.index({ occurredAt: 1 });
fundingEventSchema.index({ login: 1 });

export type FundingEventDoc = InferSchemaType<typeof fundingEventSchema> & {
  _id: string;
};

export const FundingEvent: Model<FundingEventDoc> =
  (models.FundingEvent as Model<FundingEventDoc>) ??
  model<FundingEventDoc>("FundingEvent", fundingEventSchema, "funding_events");
