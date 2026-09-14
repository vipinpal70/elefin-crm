import { Schema, model, models } from "../mongoose";
import type { InferSchemaType, Model } from "mongoose";
import { Decimal128, baseSchemaOptions } from "../shared";

/**
 * One real MT5 trading account. `_id` is the MT5 login — always a string,
 * never cast to a number (leading-digit significance, exceeds 32-bit).
 */
const accountSchema = new Schema(
  {
    _id: { type: String, required: true },

    clientId: { type: Number, required: true, index: true },

    accountType: { type: String, default: null },
    platformGroup: { type: String, default: null },
    currency: { type: String, default: "USD" },
    openedAt: { type: Date, default: null },

    balance: { type: Decimal128, default: "0" },
    equity: { type: Decimal128, default: "0" },
    credit: { type: Decimal128, default: "0" },
    margin: { type: Decimal128, default: "0" },
    freeMargin: { type: Decimal128, default: "0" },
    leverage: { type: Number, default: null },
    tradingEnabled: { type: Boolean, default: true },

    totalDeposit: { type: Decimal128, default: "0" },
    totalWithdrawal: { type: Decimal128, default: "0" },
    netDeposit: { type: Decimal128, default: "0" },
    lots: { type: Decimal128, default: "0" },
    trades: { type: Number, default: 0 },
    netProfit: { type: Decimal128, default: "0" },
    lastTradeAt: { type: Date, default: null, index: true },
    commission: { type: Decimal128, default: "0" },

    /** Elefin's own flag: still affiliated with our partner code (`accounts.items[].affiliated`). */
    affiliated: { type: Boolean, default: true },

    /** `updated_at` as reported by the API (distinct from our timestamps). */
    apiUpdatedAt: { type: Date, default: null },

    raw: { type: Schema.Types.Mixed, select: false },
    lastSyncedAt: { type: Date, default: null },
  },
  { ...baseSchemaOptions, _id: false },
);

export type AccountDoc = InferSchemaType<typeof accountSchema> & { _id: string };

export const Account: Model<AccountDoc> =
  (models.Account as Model<AccountDoc>) ??
  model<AccountDoc>("Account", accountSchema, "accounts");
