/**
 * Create the first CRM owner from SEED_OWNER_* in .env.
 * No-op if `crm_users` already has any document.
 *
 *   npm run db:seed                       (from repo root)
 *   npm run seed --workspace @elefin/web
 */
import path from "node:path";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import { connect, disconnect, CrmUser } from "@elefin/db";

dotenv.config({ path: path.resolve(import.meta.dirname, "../../../.env") });

async function main() {
  await connect();

  const existing = await CrmUser.estimatedDocumentCount();
  if (existing > 0) {
    console.log(`crm_users already has ${existing} document(s); nothing to seed.`);
    return;
  }

  const email = (process.env.SEED_OWNER_EMAIL ?? "owner@example.com")
    .toLowerCase()
    .trim();
  const password = process.env.SEED_OWNER_PASSWORD;
  if (!password || password.length < 8) {
    throw new Error("Set SEED_OWNER_PASSWORD (>= 8 chars) in .env before seeding.");
  }

  await CrmUser.create({
    email,
    passwordHash: await bcrypt.hash(password, 12),
    name: process.env.SEED_OWNER_NAME ?? "Owner",
    role: "owner",
    isActive: true,
  });

  console.log(`Created owner: ${email}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => disconnect());
