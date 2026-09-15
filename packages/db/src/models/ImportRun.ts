import { Schema, model, models, Types } from "../mongoose";
import type { InferSchemaType, Model } from "mongoose";
import { baseSchemaOptions, IMPORT_KINDS, IMPORT_STATUSES } from "../shared";

/**
 * One upload of a roster or trade-history sheet — mirrors `SyncRun` for the
 * worker's own jobs, so a manual upload has the same kind of audit trail.
 *
 * A `"roster"` upload gets a review gate: `rows` holds the parsed +
 * broker/MT5-matched preview while `status: "preview"`, nothing else is
 * written to the DB yet, and a separate commit step (per row, or all at
 * once) creates/updates `Client.tags` or `ExternalTrader` and flips this to
 * `"committed"`. A `"xm_trades"` upload has no such ambiguity (a trade
 * either belongs to a login or it doesn't) so it commits immediately and
 * `rows` stays empty — only the summary counts matter.
 */
const importRunSchema = new Schema(
  {
    kind: { type: String, enum: IMPORT_KINDS, required: true },
    status: { type: String, enum: IMPORT_STATUSES, default: "preview" },
    fileName: { type: String, required: true },
    uploadedBy: { type: Types.ObjectId, ref: "CrmUser", required: true },

    totalRows: { type: Number, default: 0 },
    linkedCount: { type: Number, default: 0 },
    createdCount: { type: Number, default: 0 },
    updatedCount: { type: Number, default: 0 },
    flaggedCount: { type: Number, default: 0 },
    skippedCount: { type: Number, default: 0 },

    /** Parsed + matched rows, only populated for a "roster" import while status === "preview". */
    rows: { type: [Schema.Types.Mixed], default: [], select: false },

    error: { type: String, default: null },
    committedAt: { type: Date, default: null },
  },
  baseSchemaOptions,
);

importRunSchema.index({ kind: 1, createdAt: -1 });

export type ImportRunDoc = InferSchemaType<typeof importRunSchema>;

export const ImportRun: Model<ImportRunDoc> =
  (models.ImportRun as Model<ImportRunDoc>) ??
  model<ImportRunDoc>("ImportRun", importRunSchema, "import_runs");
