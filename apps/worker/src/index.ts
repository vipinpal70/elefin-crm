import cron from "node-cron";
import { connect, disconnect } from "@elefin/db";
import { env, hasElefinCreds } from "./env";
import { log } from "./logger";
import { runJob } from "./runner";
import { JOBS } from "./jobs";
import { drainSyncRequests } from "./queue";

const SCHEDULE: Array<{ job: keyof typeof JOBS; cron: string }> = [
  { job: "clients", cron: env.crons.clients },
  { job: "accounts", cron: env.crons.accounts },
  { job: "transactions", cron: env.crons.transactions },
  { job: "trades", cron: env.crons.trades },
  { job: "positions", cron: env.crons.positions },
  { job: "snapshot", cron: env.crons.snapshot },
  { job: "alerts", cron: env.crons.alerts },
  { job: "digest", cron: env.crons.digest },
];

// Jobs to run once on boot (the multi-minute account sweep waits for its cron).
const BOOT_JOBS: Array<keyof typeof JOBS> = [
  "clients",
  "transactions",
  "positions",
  "snapshot",
  "alerts",
  "digest",
];

let shuttingDown = false;
// A job whose previous run is still going skips the next cron tick.
const running = new Set<string>();

async function main() {
  if (!env.mongoUri) {
    log.error("MONGODB_URI is not set. Copy .env.example to .env.");
    process.exit(1);
  }
  await connect();
  log.info(`worker up · env=${env.nodeEnv} · elefin creds=${hasElefinCreds() ? "yes" : "no"}`);

  if (env.runOnBoot) {
    if (hasElefinCreds()) {
      await runJob("me", JOBS.me);
      for (const job of BOOT_JOBS) await runJob(job, JOBS[job]);
    } else {
      log.warn("skipping API jobs on boot — ELEFIN_API_KEY / ELEFIN_API_SECRET not set");
    }
  }

  let scheduled = 0;
  for (const { job, cron: expr } of SCHEDULE) {
    if (!expr) {
      log.info(`schedule: ${job} disabled (no cron)`);
      continue;
    }
    if (!cron.validate(expr)) {
      log.warn(`schedule: ${job} has an invalid cron "${expr}" — skipped`);
      continue;
    }
    cron.schedule(expr, () => {
      if (shuttingDown) return;
      if (running.has(job)) {
        log.warn(`schedule: ${job} still running — skipping this tick`);
        return;
      }
      running.add(job);
      void runJob(job, JOBS[job]).finally(() => running.delete(job));
    });
    scheduled += 1;
    log.info(`schedule: ${job} @ "${expr}"`);
  }

  if (scheduled === 0) log.warn("no jobs scheduled — worker will idle");

  // UI-requested one-off jobs: drain on boot, then poll every 30s.
  await drainSyncRequests().catch((e) => log.error("queue drain failed", e));
  cron.schedule("*/1 * * * *", () => {
    if (!shuttingDown) void drainSyncRequests().catch((e) => log.error("queue drain failed", e));
  });
  log.info("queue: polling sync_requests every 1 min");
}

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info(`${signal} received, shutting down`);
  await disconnect().catch(() => undefined);
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

main().catch((err) => {
  log.error("fatal", err);
  process.exit(1);
});
