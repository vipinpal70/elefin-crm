import { Schema, model, models } from "../mongoose";
import type { InferSchemaType, Model } from "mongoose";
import {
  Decimal128,
  timeseriesSchemaOptions,
  STATUSES,
} from "../shared";

/**
 * Daily per-client snapshot — the history the API does not expose.
 * Time-series collection (timeField `date`, metaField `meta.clientId`).
 * Write exactly one doc per client per UTC day; trends are computed as deltas.
 */
const clientDailySchema = new Schema(
  {
    date: { type: Date, required: true },
    meta: {
      clientId: { type: Number, required: true },
      referralCode: { type: String, default: null },
    },

    isFunded: { type: Boolean, default: false },
    status: { type: String, enum: STATUSES, default: "active" },

    fundingDeposits: { type: Decimal128, default: "0" },
    fundingWithdrawals: { type: Decimal128, default: "0" },
    fundingNetDeposit: { type: Decimal128, default: "0" },

    accountsBalance: { type: Decimal128, default: "0" },
    accountsEquity: { type: Decimal128, default: "0" },

    tradingLots: { type: Decimal128, default: "0" },
    tradingTrades: { type: Number, default: 0 },
    tradingNetProfit: { type: Decimal128, default: "0" },

    commissionEarned: { type: Decimal128, default: "0" },
  },
  timeseriesSchemaOptions("date", "meta"),
);

export type ClientDailyDoc = InferSchemaType<typeof clientDailySchema>;

export const ClientDaily: Model<ClientDailyDoc> =
  (models.ClientDaily as Model<ClientDailyDoc>) ??
  model<ClientDailyDoc>("ClientDaily", clientDailySchema, "client_daily");
