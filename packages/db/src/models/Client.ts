import { Schema, model, models } from "../mongoose";
import type { InferSchemaType, Model } from "mongoose";
import { Decimal128, baseSchemaOptions, STATUSES } from "../shared";

/**
 * One referred client. `_id` is the Elefin numeric client_id.
 * Aggregates come pre-computed from GET /clients and GET /clients/{id}.
 */
const clientSchema = new Schema(
  {
    _id: { type: Number, required: true },

    name: { type: String, default: "" },
    email: { type: String, default: null },
    phone: { type: String, default: null },
    country: { type: String, default: "Unknown", index: true },
    status: { type: String, enum: STATUSES, default: "active", index: true },

    emailMasked: { type: Boolean, default: true },
    phoneMasked: { type: Boolean, default: true },

    registeredAt: { type: Date, default: null },
    referredAt: { type: Date, default: null },
    referralCode: { type: String, default: null },

    fundingCurrency: { type: String, default: "USD" },
    fundingDeposits: { type: Decimal128, default: "0" },
    fundingWithdrawals: { type: Decimal128, default: "0" },
    fundingNetDeposit: { type: Decimal128, default: "0" },
    fundingDepositCount: { type: Number, default: 0 },
    fundingFirstDepositAt: { type: Date, default: null },
    fundingLastDepositAt: { type: Date, default: null },
    fundingIsFunded: { type: Boolean, default: false, index: true },

    accountsCount: { type: Number, default: 0 },
    accountsBalance: { type: Decimal128, default: "0" },
    accountsEquity: { type: Decimal128, default: "0" },
    accountsCredit: { type: Decimal128, default: "0" },
    logins: { type: [String], default: [] },

    tradingLots: { type: Decimal128, default: "0" },
    tradingTrades: { type: Number, default: 0 },
    tradingNetProfit: { type: Decimal128, default: "0" },
    tradingLastTradeAt: { type: Date, default: null, index: true },

    commissionEarned: { type: Decimal128, default: "0" },

    /** Raw API payload of the last sync, kept for debugging / reprocessing. */
    raw: { type: Schema.Types.Mixed, select: false },

    firstSeenAt: { type: Date, default: () => new Date() },
    lastSyncedAt: { type: Date, default: null },
  },
  { ...baseSchemaOptions, _id: false },
);

clientSchema.index({ referralCode: 1, registeredAt: -1 });
clientSchema.index({ logins: 1 });
clientSchema.index({ name: "text", email: "text" }, { name: "client_text" });

export type ClientDoc = InferSchemaType<typeof clientSchema> & { _id: number };

export const Client: Model<ClientDoc> =
  (models.Client as Model<ClientDoc>) ??
  model<ClientDoc>("Client", clientSchema, "clients");
