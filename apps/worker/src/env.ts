import path from "node:path";
import dotenv from "dotenv";

// Load the repo-root .env regardless of where the process is started from.
dotenv.config({ path: path.resolve(import.meta.dirname, "../../../.env") });

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  mongoUri: process.env.MONGODB_URI ?? "",
  runOnBoot: (process.env.WORKER_RUN_ON_BOOT ?? "true") !== "false",
  crons: {
    clients: process.env.SYNC_CLIENTS_CRON ?? "",
    accounts: process.env.SYNC_ACCOUNTS_CRON ?? "",
    transactions: process.env.SYNC_TRANSACTIONS_CRON ?? "",
    trades: process.env.SYNC_TRADES_CRON ?? "",
    positions: process.env.SYNC_POSITIONS_CRON ?? "",
    snapshot: process.env.SNAPSHOT_CRON ?? "",
    alerts: process.env.ALERTS_CRON ?? "",
    digest: process.env.DIGEST_CRON ?? "",
  },
  elefin: {
    baseUrl: process.env.ELEFIN_API_BASE_URL ?? "",
    key: process.env.ELEFIN_API_KEY ?? "",
    secret: process.env.ELEFIN_API_SECRET ?? "",
  },
};

export function hasElefinCreds(): boolean {
  return Boolean(env.elefin.key && env.elefin.secret);
}
