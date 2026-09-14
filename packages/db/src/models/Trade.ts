import { Schema, model, models } from "../mongoose";
import type { InferSchemaType, Model } from "mongoose";
import { Decimal128, baseSchemaOptions, SIDES } from "../shared";

/**
 * One closed position (a completed round-trip trade). `_id` is the stable
 * `trade_ticket_id` from the API, so a re-sync upserts rather than duplicates.
 * Shape mirrors GET /accounts/{login}/trades (probed 2026-09-07):
 * `instrument`->symbol, `type` BUY/SELL->side, `net_profit`->netPnl.
 */
const tradeSchema = new Schema(
  {
    _id: { type: String, required: true },

    login: { type: String, required: true },
    clientId: { type: Number, default: null },

    symbol: { type: String, default: null },
    side: { type: String, enum: SIDES, default: null },
    volumeLots: { type: Decimal128, default: "0" },

    openPrice: { type: Decimal128, default: null },
    closePrice: { type: Decimal128, default: null },
    openAt: { type: Date, default: null },
    closeAt: { type: Date, default: null },
    holdingDurationSeconds: { type: Number, default: null },

    stopLoss: { type: Decimal128, default: null },
    takeProfit: { type: Decimal128, default: null },

    profit: { type: Decimal128, default: "0" },
    commission: { type: Decimal128, default: "0" },
    brokerCommission: { type: Decimal128, default: "0" },
    swap: { type: Decimal128, default: "0" },
    /** `net_profit` as reported by the API (profit + swap + broker fees). */
    netPnl: { type: Decimal128, default: "0" },
    /**
     * True when the API has never returned a `profit`/`net_profit` for this
     * ticket (a confirmed, ongoing Elefin bug — see map.ts). `profit`/`netPnl`
     * are then the schema default "0", a placeholder, not a real $0 trade.
     * Cleared for good the first time a real value arrives.
     */
    profitMissing: { type: Boolean, default: false },
    currency: { type: String, default: "USD" },

    raw: { type: Schema.Types.Mixed, select: false },
    syncedAt: { type: Date, default: () => new Date() },
  },
  { ...baseSchemaOptions, _id: false },
);

tradeSchema.index({ login: 1, closeAt: -1 });
tradeSchema.index({ clientId: 1, closeAt: -1 });
tradeSchema.index({ symbol: 1 });
tradeSchema.index({ closeAt: 1 });

export type TradeDoc = InferSchemaType<typeof tradeSchema> & { _id: string };

export const Trade: Model<TradeDoc> =
  (models.Trade as Model<TradeDoc>) ??
  model<TradeDoc>("Trade", tradeSchema, "trades");
