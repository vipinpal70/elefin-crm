import { Schema, model, models, Types } from "../mongoose";
import type { InferSchemaType, Model } from "mongoose";
import { baseSchemaOptions } from "../shared";

/**
 * A free-text note on a client, optionally a dated follow-up task
 * (`dueAt` set, `doneAt` null == open).
 */
const clientNoteSchema = new Schema(
  {
    clientId: { type: Number, required: true, index: true },
    authorId: { type: Types.ObjectId, ref: "CrmUser", required: true },
    body: { type: String, required: true, trim: true, maxlength: 4000 },
    dueAt: { type: Date, default: null },
    doneAt: { type: Date, default: null },
  },
  baseSchemaOptions,
);

clientNoteSchema.index({ clientId: 1, createdAt: -1 });
clientNoteSchema.index({ dueAt: 1, doneAt: 1 });

export type ClientNoteDoc = InferSchemaType<typeof clientNoteSchema>;

export const ClientNote: Model<ClientNoteDoc> =
  (models.ClientNote as Model<ClientNoteDoc>) ??
  model<ClientNoteDoc>("ClientNote", clientNoteSchema, "client_notes");
