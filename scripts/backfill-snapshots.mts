/**
 * Rebuild the ENTIRE book_daily history from source (clients.registeredAt,
 * funding_events.occurredAt, trades.closeAt). Safe to re-run — each (code, day)
 * is deleted then re-inserted.
 *
 *   npm run backfill:snapshots
 */
import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(import.meta.dirname, "../.env") });

const { connect, disconnect } = await import("@elefin/db");
const { buildSnapshots } = await import(
  "../apps/worker/src/jobs/build-snapshots.ts"
);

await connect();
const res = await buildSnapshots({ full: true });
console.log(
  `backfilled ${res.rowsWritten} book_daily rows · codes [${res.codes.join(", ")}] · ${res.from}..${res.to}`,
);
await disconnect();
