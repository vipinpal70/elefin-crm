import { Schema, model, models } from "../mongoose";
import type { InferSchemaType, Model } from "mongoose";
import { baseSchemaOptions, ROLES } from "../shared";

/** A CRM login. Separate from the Elefin API credential. */
const crmUserSchema = new Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: { type: String, required: true, select: false },
    name: { type: String, default: "" },
    role: { type: String, enum: ROLES, default: "viewer", index: true },
    isActive: { type: Boolean, default: true },
    lastLoginAt: { type: Date, default: null },
  },
  baseSchemaOptions,
);

export type CrmUserDoc = InferSchemaType<typeof crmUserSchema>;

export const CrmUser: Model<CrmUserDoc> =
  (models.CrmUser as Model<CrmUserDoc>) ??
  model<CrmUserDoc>("CrmUser", crmUserSchema, "crm_users");
