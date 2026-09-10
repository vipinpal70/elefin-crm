/** One-off: reset a CRM user's password.  npm run set:password -- <email> <newPassword> */
import path from "node:path";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import { connect, disconnect, CrmUser } from "@elefin/db";

dotenv.config({ path: path.resolve(import.meta.dirname, "../.env") });

const [email, password] = process.argv.slice(2);
if (!email || !password || password.length < 8) {
  console.error("usage: npm run set:password -- <email> <newPassword(min 8)>");
  process.exit(1);
}

await connect();
const res = await CrmUser.updateOne(
  { email: email.toLowerCase().trim() },
  { $set: { passwordHash: await bcrypt.hash(password, 12) } },
);
console.log(res.matchedCount ? `Updated password for ${email}` : `No user: ${email}`);
await disconnect();
