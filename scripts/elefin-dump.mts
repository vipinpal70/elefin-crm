/**
 * Dump EVERY Elefin API response for one trader to disk, verbatim — for
 * diagnosing/evidencing upstream API bugs (e.g. the ongoing null-profit
 * issue, see README "Known upstream issue" / the elefin-net-profit-bug memory).
 *
 *   npm run elefin:dump                                       # default: subhashbetal@gmail.com
 *   npm run elefin:dump -- --email someone@example.com
 *   npm run elefin:dump -- --login 12345790671
 *   npm run elefin:dump -- --from 2026-08-01T00:00:00Z --to 2026-10-01T00:00:00Z
 *   npm run elefin:dump -- --out-dir data/elefin-dump
 *
 * Writes one file per HTTP response under
 *   <out-dir>/<email-or-login>/<timestamp>/<NN>-<label>.json
 * each = { label, endpoint, params, requested_at, http_status, ok, error,
 *          rate_limit_remaining, body }   (body = the raw response payload,
 *          one level unwrapped from the {success,message,data} envelope —
 *          same as everywhere else in this repo)
 * plus a _manifest.json listing every call.
 *
 * Endpoints hit: /me, /clients/lookup, /clients (paged fallback),
 * /accounts/{login}, /accounts/{login}/positions,
 * /accounts/{login}/trades (every page), /transactions?type=deposit|withdrawal (every page).
 *
 * Retries/backoff/pacing are handled by @elefin/elefin-client itself
 * (RateLimiter + 429/5xx/network retry) — this script just records the
 * outcome of each call, good or bad.
 */
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(import.meta.dirname, "../.env") });

const { createElefinApi, ElefinApiError } = await import("@elefin/elefin-client");

const ARGV = process.argv.slice(2);
const argVal = (name: string, def: string | null): string | null => {
  const i = ARGV.indexOf(name);
  return i >= 0 && ARGV[i + 1] ? ARGV[i + 1]! : def;
};

const EMAIL = (argVal("--email", "subhashbetal@gmail.com") ?? "").toLowerCase();
const ONLY_LOGIN = argVal("--login", null);
const FROM = argVal("--from", "2026-08-01T00:00:00Z")!;
const TO = argVal("--to", "2026-10-01T00:00:00Z")!;
const OUT_ROOT = path.resolve(process.cwd(), argVal("--out-dir", "data/elefin-dump")!);
const SLEEP_MS = Number(argVal("--sleep", "0")); // extra pacing on top of the client's own limiter
const PAGE = 200;

const slug = (s: string) => String(s).replace(/[^a-z0-9._@-]+/gi, "_").slice(0, 80);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const stamp = new Date().toISOString().replace(/[:.]/g, "-");

const api = createElefinApi();

type ApiParams = Record<string, string | number | boolean | undefined | null>;

interface CallSummary {
  n: number;
  label: string;
  endpoint: string;
  params: ApiParams | null;
  ok: boolean;
  http_status: number | null;
  file: string;
}

async function main() {
  const outDir = path.join(OUT_ROOT, slug(ONLY_LOGIN || EMAIL), stamp);
  fs.mkdirSync(outDir, { recursive: true });
  console.log(`\n  Elefin dump  ->  ${path.relative(process.cwd(), outDir)}`);
  console.log(
    `  target: ${ONLY_LOGIN ? "login " + ONLY_LOGIN : "email " + EMAIL}   range ${FROM} .. ${TO}\n`,
  );

  const calls: CallSummary[] = [];
  let n = 0;

  async function dump(
    label: string,
    endpoint: string,
    params?: ApiParams,
  ): Promise<{ ok: boolean; body: unknown }> {
    n += 1;
    const requestedAt = new Date().toISOString();
    let body: unknown = null;
    let ok = false;
    let httpStatus: number | null = null;
    let error: string | null = null;

    try {
      body = await api.request(endpoint, { query: params });
      ok = true;
      httpStatus = 200;
    } catch (err) {
      if (err instanceof ElefinApiError) {
        httpStatus = err.status;
        error = `${err.code}: ${err.message}`;
      } else {
        error = (err as Error).message;
      }
    }

    const record = {
      label,
      endpoint,
      params: params ?? null,
      requested_at: requestedAt,
      http_status: httpStatus,
      ok,
      error,
      rate_limit_remaining: api.lastRateLimitRemaining,
      body,
    };
    const file = path.join(outDir, `${String(n).padStart(2, "0")}-${slug(label)}.json`);
    fs.writeFileSync(file, JSON.stringify(record, null, 2));
    calls.push({
      n,
      label,
      endpoint,
      params: params ?? null,
      ok,
      http_status: httpStatus,
      file: path.basename(file),
    });
    console.log(
      `  ${ok ? "ok " : "ERR"}  ${String(n).padStart(2)}  ${label}   ` +
        `(${endpoint}${params ? " " + JSON.stringify(params) : ""})` +
        (error ? `  — ${error}` : ""),
    );
    if (SLEEP_MS > 0) await sleep(SLEEP_MS);
    return { ok, body };
  }

  // rows out of either shape: a bare array, or the {data:[...], meta} envelope
  // this client's request() leaves for a paginated endpoint.
  const rowsOf = (body: unknown): Record<string, unknown>[] => {
    if (Array.isArray(body)) return body as Record<string, unknown>[];
    const inner = body && typeof body === "object" ? (body as Record<string, unknown>).data : null;
    return Array.isArray(inner) ? (inner as Record<string, unknown>[]) : [];
  };
  const lastPageOf = (body: unknown): number | null => {
    const meta = body && typeof body === "object" ? (body as Record<string, unknown>).meta : null;
    const lp = meta && typeof meta === "object" ? (meta as Record<string, unknown>).last_page : null;
    return typeof lp === "number" ? lp : null;
  };

  // 1. /me
  await dump("me", "/me");

  // 2. resolve the client
  let client: Record<string, unknown> | null = null;
  const lk = await dump("clients-lookup", "/clients/lookup", { email: EMAIL });
  if (lk.ok && lk.body && typeof lk.body === "object") {
    const b = lk.body as Record<string, unknown> | Record<string, unknown>[];
    if (Array.isArray(b)) {
      client =
        b.find((c) => String(c.email ?? "").toLowerCase() === EMAIL) ?? b[0] ?? null;
    } else if (b.email != null || b.client_id != null) {
      client = b;
    }
  }
  if (!client) {
    // paged fallback over /clients
    for (let page = 1; page <= 20; page += 1) {
      const r = await dump(`clients-page-${page}`, "/clients", { page, per_page: 100 });
      if (!r.ok) break;
      const rows = rowsOf(r.body);
      const hit = rows.find(
        (c) =>
          String(c.email ?? "").toLowerCase() === EMAIL ||
          (ONLY_LOGIN &&
            ((c.accounts as { logins?: unknown[] } | undefined)?.logins ?? [])
              .map(String)
              .includes(String(ONLY_LOGIN))),
      );
      if (hit) {
        client = hit;
        break;
      }
      const lastPage = lastPageOf(r.body);
      if (rows.length < 100 || (lastPage != null && page >= lastPage)) break;
    }
  }

  const logins: string[] = ONLY_LOGIN
    ? [String(ONLY_LOGIN)]
    : ((client?.accounts as { logins?: unknown[] } | undefined)?.logins ?? []).map(String);

  if (!logins.length) {
    console.log("\n  ! could not resolve any MT5 login for this trader — stopping after client lookup.\n");
  }

  // 3. per-login: account, positions, all trade pages
  for (const login of logins) {
    await dump(`account-${login}`, `/accounts/${encodeURIComponent(login)}`);
    await dump(`positions-${login}`, `/accounts/${encodeURIComponent(login)}/positions`);
    for (let page = 1; page <= 100; page += 1) {
      const r = await dump(`trades-${login}-p${page}`, `/accounts/${encodeURIComponent(login)}/trades`, {
        page,
        limit: PAGE,
        from: FROM,
        to: TO,
      });
      if (!r.ok) break;
      const rows = rowsOf(r.body);
      const lastPage = lastPageOf(r.body);
      if (rows.length < PAGE || (lastPage != null && page >= lastPage)) break;
    }
  }

  // 4. transactions (deposits + withdrawals), all pages
  for (const type of ["deposit", "withdrawal"]) {
    for (let page = 1; page <= 100; page += 1) {
      const r = await dump(`transactions-${type}-p${page}`, "/transactions", {
        type,
        from: FROM,
        to: TO,
        page,
        limit: PAGE,
      });
      if (!r.ok) break;
      const rows = rowsOf(r.body);
      const lastPage = lastPageOf(r.body);
      if (rows.length < PAGE || (lastPage != null && page >= lastPage)) break;
    }
  }

  const manifest = {
    email: EMAIL,
    login_arg: ONLY_LOGIN,
    resolved_client_id: client?.client_id ?? null,
    resolved_name: client?.name ?? null,
    logins,
    range: { from: FROM, to: TO },
    generated_at: new Date().toISOString(),
    call_count: calls.length,
    calls,
  };
  fs.writeFileSync(path.join(outDir, "_manifest.json"), JSON.stringify(manifest, null, 2));

  console.log(`\n  ${calls.length} responses stored  ·  ${calls.filter((c) => !c.ok).length} errors`);
  console.log(`  manifest -> ${path.relative(process.cwd(), path.join(outDir, "_manifest.json"))}\n`);
}

main().catch((err) => {
  console.error("\n  elefin-dump failed:", err instanceof Error ? err.stack : err, "\n");
  process.exit(1);
});
