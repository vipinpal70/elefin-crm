import type { SyncJob } from "@elefin/db";
import type { Job } from "../runner";
import { syncMe } from "./sync-me";
import { syncClients } from "./sync-clients";
import { syncAccounts } from "./sync-accounts";
import { syncTransactions } from "./sync-transactions";
import { syncTrades } from "./sync-trades";
import { syncPositions } from "./sync-positions";
import { snapshotJob } from "./build-snapshots";
import { runAlerts } from "./run-alerts";
import { digestJob } from "./digest";

export const JOBS: Record<SyncJob, Job> = {
  me: syncMe,
  clients: syncClients,
  accounts: syncAccounts,
  transactions: syncTransactions,
  trades: syncTrades,
  positions: syncPositions,
  snapshot: snapshotJob,
  alerts: runAlerts,
  digest: digestJob,
};
