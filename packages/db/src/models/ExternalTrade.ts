import { Schema, model, models } from "../mongoose";
import type { InferSchemaType, Model } from "mongoose";
import { Decimal128, baseSchemaOptions, SIDES } from "../shared";

/**
 * One closed trade from an uploaded broker trade-history export (e.g. XM's
 * "traderTrades.csv"). `_id` is `"<broker>:<their trade id>"` so a re-upload
 * upserts instead of duplicating, the same convention as `Trade._id` for
 * Elefin's own `trade_ticket_id`. Linked to `ExternalTrader` by MT5 login
 * when one exists for it.
 */
const externalTradeSchema = new Schema(
  {
    _id: { type: String, required: true },

    broker: { type: String, required: true, index: true },
    login: { type: String, required: true, index: true },
    externalTraderId: {
      type: Schema.Types.ObjectId,
      ref: "ExternalTrader",
      default: null,
      index: true,
    },

    symbol: { type: String, default: null },
    side: { type: String, enum: SIDES, default: null },
    volumeLots: { type: Decimal128, default: "0" },
    openPrice: { type: Decimal128, default: null },
    closePrice: { type: Decimal128, default: null },
    openAt: { type: Date, default: null },
    closeAt: { type: Date, default: null },

    commission: { type: Decimal128, default: "0" },
    affiliateCommission: { type: Decimal128, default: "0" },

    /** Broker-specific extras, kept as-is rather than forced into Trade's shape. */
    accountType: { type: String, default: null },
    accountCurrency: { type: String, default: "USD" },
    campaign: { type: String, default: null },

    raw: { type: Schema.Types.Mixed, select: false },
    importedAt: { type: Date, default: () => new Date() },
  },
  { ...baseSchemaOptions, _id: false },
);

externalTradeSchema.index({ login: 1, closeAt: -1 });

export type ExternalTradeDoc = InferSchemaType<typeof externalTradeSchema> & {
  _id: string;
};

export const ExternalTrade: Model<ExternalTradeDoc> =
  (models.ExternalTrade as Model<ExternalTradeDoc>) ??
  model<ExternalTradeDoc>("ExternalTrade", externalTradeSchema, "external_trades");
