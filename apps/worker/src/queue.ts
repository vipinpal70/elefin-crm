import { SyncRequest, type SyncJob } from "@elefin/db";
import { log } from "./logger";
import { runJob } from "./runner";
import { JOBS } from "./jobs";

let draining = false;

/**
 * Run any UI-requested jobs. Claims one `pending` request at a time
 * (atomic findOneAndUpdate) so multiple workers won't double-run it.
 */
export async function drainSyncRequests(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    for (;;) {
      const req = await SyncRequest.findOneAndUpdate(
        { status: "pending" },
        { $set: { status: "running", startedAt: new Date() } },
        { sort: { createdAt: 1 }, new: true },
      );
      if (!req) break;

      const job = req.job as SyncJob;
      log.info(`queue: running requested job "${job}" (${req._id})`);
      const out = await runJob(job, JOBS[job]);
      await SyncRequest.updateOne(
        { _id: req._id },
        {
          $set: {
            status: out.status === "failed" ? "failed" : "done",
            finishedAt: new Date(),
            result: {
              status: out.status,
              durationMs: out.durationMs,
              apiCalls: out.apiCalls,
              docsUpserted: out.docsUpserted,
            },
            error: out.error,
          },
        },
      );
    }
  } finally {
    draining = false;
  }
}
