import { SyncRun, type SyncJob } from "@elefin/db";
import { log } from "./logger";

export interface JobResult {
  apiCalls?: number;
  docsUpserted?: number;
  rateLimitRemainingMin?: number | null;
  meta?: Record<string, unknown>;
  /** Set true if the job completed but with skipped/failed sub-steps. */
  partial?: boolean;
}

export type Job = (ctx: { signal: AbortSignal }) => Promise<JobResult | void>;

export interface JobOutcome {
  runId: string;
  status: "ok" | "partial" | "failed";
  durationMs: number;
  apiCalls: number;
  docsUpserted: number;
  error: string | null;
}

/** Run a job with SyncRun bookkeeping and consistent logging. Never throws. */
export async function runJob(job: SyncJob, fn: Job): Promise<JobOutcome> {
  const run = await SyncRun.create({ job, status: "running", startedAt: new Date() });
  const startedAt = Date.now();
  const controller = new AbortController();
  log.info(`> ${job} started`);

  try {
    const res = (await fn({ signal: controller.signal })) ?? {};
    const durationMs = Date.now() - startedAt;
    await SyncRun.updateOne(
      { _id: run._id },
      {
        $set: {
          status: res.partial ? "partial" : "ok",
          finishedAt: new Date(),
          durationMs,
          apiCalls: res.apiCalls ?? 0,
          docsUpserted: res.docsUpserted ?? 0,
          rateLimitRemainingMin: res.rateLimitRemainingMin ?? null,
          meta: res.meta ?? {},
        },
      },
    );
    log.info(
      `= ${job} ${res.partial ? "partial" : "ok"} in ${(durationMs / 1000).toFixed(1)}s ` +
        `(${res.apiCalls ?? 0} calls, ${res.docsUpserted ?? 0} docs)`,
    );
    return {
      runId: String(run._id),
      status: res.partial ? "partial" : "ok",
      durationMs,
      apiCalls: res.apiCalls ?? 0,
      docsUpserted: res.docsUpserted ?? 0,
      error: null,
    };
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const message = err instanceof Error ? err.message : String(err);
    await SyncRun.updateOne(
      { _id: run._id },
      { $set: { status: "failed", finishedAt: new Date(), durationMs, error: message } },
    );
    log.error(`x ${job} failed after ${(durationMs / 1000).toFixed(1)}s: ${message}`);
    return {
      runId: String(run._id),
      status: "failed",
      durationMs,
      apiCalls: 0,
      docsUpserted: 0,
      error: message,
    };
  }
}
