import { createElefinApi, ElefinApiError, type ElefinApi, type RequestOpts } from "@elefin/elefin-client";
import { ApiCallLog, type SyncJob } from "@elefin/db";
import { log } from "./logger";

// Keep individual log docs bounded — a full trades/clients page can run to
// tens of KB; cap it well under Mongo's 16MB doc limit and under what's
// pleasant to render on the /api-log page.
const MAX_BODY_CHARS = 200_000;
const PREVIEW_ROWS = 20;

type Query = RequestOpts["query"];

/** Best-effort clientId/login/email, parsed from the endpoint/params alone. */
function extractContext(endpoint: string, query?: Query) {
  let clientId: number | null = null;
  let login: string | null = null;
  let email: string | null = null;

  const clientMatch = endpoint.match(/^\/clients\/(\d+)$/);
  if (clientMatch?.[1]) clientId = Number(clientMatch[1]);

  const accountMatch = endpoint.match(/^\/accounts\/([^/]+)/);
  if (accountMatch?.[1]) login = decodeURIComponent(accountMatch[1]);

  const rawEmail = query?.email;
  if (typeof rawEmail === "string") email = rawEmail.toLowerCase();

  return { clientId, login, email };
}

/** Rows out of either a bare array or the {data:[...], meta} paginated envelope. */
function rowsOf(body: unknown): unknown[] | null {
  if (Array.isArray(body)) return body;
  const inner = body && typeof body === "object" ? (body as Record<string, unknown>).data : null;
  return Array.isArray(inner) ? inner : null;
}

/** Store the body whole when it's reasonably small; otherwise a bounded preview. */
function summarizeBody(body: unknown): {
  body: unknown;
  truncated: boolean;
  rowCount: number | null;
} {
  const rows = rowsOf(body);
  const rowCount = rows?.length ?? null;

  let json: string;
  try {
    json = JSON.stringify(body) ?? "null";
  } catch {
    return { body: "[unserializable response]", truncated: true, rowCount };
  }
  if (json.length <= MAX_BODY_CHARS) return { body, truncated: false, rowCount };

  if (rows) {
    const preview = rows.slice(0, PREVIEW_ROWS);
    const shown = Array.isArray(body)
      ? preview
      : { ...(body as Record<string, unknown>), data: preview };
    return { body: shown, truncated: true, rowCount };
  }
  return { body: `${json.slice(0, MAX_BODY_CHARS)}…(truncated)`, truncated: true, rowCount };
}

/**
 * An Elefin API client whose every call is recorded to `api_call_logs` — the
 * /api-log page shows exactly what Elefin sent back for a given job run,
 * filterable by client. Wraps the low-level `request()` (which every typed
 * method funnels through), so it needs no changes in @elefin/elefin-client
 * and covers every endpoint uniformly.
 *
 * Logging is best-effort: a write failure is swallowed (logged locally) and
 * never affects the sync job itself.
 */
export function createLoggedElefinApi(job: SyncJob): ElefinApi {
  const api = createElefinApi();
  const original = api.request.bind(api) as (path: string, opts?: RequestOpts) => Promise<unknown>;

  const wrapped = async (path: string, opts?: RequestOpts): Promise<unknown> => {
    const requestedAt = new Date();
    const started = Date.now();
    const ctx = extractContext(path, opts?.query);

    try {
      const body = await original(path, opts);
      const { body: storedBody, truncated, rowCount } = summarizeBody(body);
      await ApiCallLog.create({
        job,
        endpoint: path,
        params: opts?.query ?? null,
        ok: true,
        httpStatus: 200,
        rateLimitRemaining: api.lastRateLimitRemaining,
        durationMs: Date.now() - started,
        ...ctx,
        body: storedBody,
        bodyTruncated: truncated,
        bodyRowCount: rowCount,
        requestedAt,
      }).catch((err: unknown) => log.warn(`api-log write failed: ${(err as Error).message}`));
      return body;
    } catch (err) {
      const isApiErr = err instanceof ElefinApiError;
      await ApiCallLog.create({
        job,
        endpoint: path,
        params: opts?.query ?? null,
        ok: false,
        httpStatus: isApiErr ? err.status : null,
        errorCode: isApiErr ? err.code : null,
        errorMessage: (err as Error).message,
        rateLimitRemaining: api.lastRateLimitRemaining,
        durationMs: Date.now() - started,
        ...ctx,
        requestedAt,
      }).catch((e: unknown) => log.warn(`api-log write failed: ${(e as Error).message}`));
      throw err;
    }
  };

  api.request = wrapped as typeof api.request;
  return api;
}
