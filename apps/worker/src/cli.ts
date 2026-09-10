/**
 * Run one job by hand:
 *   npm run job --workspace @elefin/worker -- me
 *   (me | clients | accounts | transactions | trades | positions | snapshot | alerts)
 */
import "./env"; // loads repo-root .env before anything reads process.env
import { connect, disconnect, type SyncJob } from "@elefin/db";
import { log } from "./logger";
import { runJob } from "./runner";
import { JOBS } from "./jobs";

const arg = process.argv[2] as SyncJob | undefined;

if (!arg || !(arg in JOBS)) {
  log.error(`usage: job <${Object.keys(JOBS).join(" | ")}>`);
  process.exit(1);
}

await connect();
await runJob(arg, JOBS[arg]);
await disconnect();
