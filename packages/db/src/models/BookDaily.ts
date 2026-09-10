import { Schema, model, models } from "../mongoose";
import type { InferSchemaType, Model } from "mongoose";
import { Decimal128, timeseriesSchemaOptions } from "../shared";

/**
 * Daily whole-book roll-up, one doc per UTC day per referral code
 * (`meta.referralCode === "*"` is the all-codes total).
 * Powers the dashboard KPI cards and every trend chart.
 */
const bookDailySchema = new Schema(
  {
    date: { type: Date, required: true },
    meta: {
      referralCode: { type: String, required: true },
    },

    clientsTotal: { type: Number, default: 0 },
    clientsFunded: { type: Number, default: 0 },
    clientsActiveTraders: { type: Number, default: 0 },
    newSignups: { type: Number, default: 0 },
    churned: { type: Number, default: 0 },
    netChange: { type: Number, default: 0 },
    tradesCum: { type: Number, default: 0 },

    depositsCum: { type: Decimal128, default: "0" },
    withdrawalsCum: { type: Decimal128, default: "0" },
    netDepositCum: { type: Decimal128, default: "0" },
    balanceTotal: { type: Decimal128, default: "0" },
    equityTotal: { type: Decimal128, default: "0" },
    lotsCum: { type: Decimal128, default: "0" },
    clientPnlCum: { type: Decimal128, default: "0" },
    commissionCum: { type: Decimal128, default: "0" },

    depositsDay: { type: Decimal128, default: "0" },
    withdrawalsDay: { type: Decimal128, default: "0" },
    commissionDay: { type: Decimal128, default: "0" },
    clientPnlDay: { type: Decimal128, default: "0" },
  },
  timeseriesSchemaOptions("date", "meta"),
);

export type BookDailyDoc = InferSchemaType<typeof bookDailySchema>;

export const BookDaily: Model<BookDailyDoc> =
  (models.BookDaily as Model<BookDailyDoc>) ??
  model<BookDailyDoc>("BookDaily", bookDailySchema, "book_daily");
