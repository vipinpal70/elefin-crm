import { Schema, model, models } from "../mongoose";
import type { InferSchemaType, Model } from "mongoose";
import { baseSchemaOptions, BROKERS, MATCH_METHODS } from "../shared";

/**
 * One person imported from a roster-style upload (a lead/community sheet
 * like "5x-data.xlsx"). Every uploaded row lands here first with
 * `confirmed: false` — a "TC" (to-confirm) holding area — regardless of how
 * confidently it was matched. A human then confirms it into one of two
 * places: "Elefin" (the suggested/chosen `linkedClientId` gets the tags and
 * this doc is deleted — a linked person doesn't get a parallel record, see
 * sheet-plan.md §4.1/§5) or "XM" (this doc just flips to `confirmed: true`
 * and shows up in the XM book). Nothing is ever auto-applied at upload time.
 */
const externalTraderSchema = new Schema(
  {
    name: { type: String, default: "" },
    email: { type: String, default: null, index: true },
    phone: { type: String, default: null },

    /** Exactly what the sheet said, and our best-effort normalized bucket. */
    brokerRaw: { type: String, default: null },
    brokerNormalized: { type: String, enum: BROKERS, default: "unknown", index: true },

    /** Parsed candidate MT5 login (digits only, plausible length) and the original cell text. */
    mt5Login: { type: String, default: null, index: true },
    mt5LoginRaw: { type: String, default: null },

    discordId: { type: String, default: null },
    status: { type: String, default: null },

    tradingCapital: { type: Number, default: null },
    tradingCapitalRaw: { type: String, default: null },

    remarks: { type: String, default: null },

    tags: { type: [String], default: [] },

    /** True once a human has confirmed this row into the XM book (see `confirmExternalTrader`). */
    confirmed: { type: Boolean, default: false, index: true },

    /** Suggested match from upload time — a hint for the confirm step, not yet applied. */
    linkedClientId: { type: Number, default: null, index: true },
    matchMethod: { type: String, enum: MATCH_METHODS, default: null },

    needsReview: { type: Boolean, default: false },
    reviewReason: { type: String, default: null },

    /** Which upload most recently created/updated this row. */
    sourceImportId: { type: Schema.Types.ObjectId, ref: "ImportRun", default: null },

    /** Original sheet row, kept for debugging / reprocessing. */
    raw: { type: Schema.Types.Mixed, select: false },
  },
  baseSchemaOptions,
);

externalTraderSchema.index({ confirmed: 1, brokerNormalized: 1, needsReview: 1 });

export type ExternalTraderDoc = InferSchemaType<typeof externalTraderSchema>;

export const ExternalTrader: Model<ExternalTraderDoc> =
  (models.ExternalTrader as Model<ExternalTraderDoc>) ??
  model<ExternalTraderDoc>("ExternalTrader", externalTraderSchema, "external_traders");
