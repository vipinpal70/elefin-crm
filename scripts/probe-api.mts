/**
 * One-off: probe every Elefin endpoint with the current .env credential and
 * print what actually comes back (status, shape, first row). Read-only.
 *
 *   npm run probe:api
 */
import path from "node:path";
import dotenv from "dotenv";
import { createElefinApi, ElefinApiError } from "@elefin/elefin-client";

dotenv.config({ path: path.resolve(import.meta.dirname, "../.env") });

const api = createElefinApi();

async function probe(label: string, fn: () => Promise<unknown>) {
  try {
    const data = await fn();
    const preview = JSON.stringify(data, null, 2);
    console.log(`\n### ${label} — OK`);
    console.log(preview.length > 2000 ? preview.slice(0, 2000) + "\n…(truncated)" : preview);
    return data;
  } catch (err) {
    if (err instanceof ElefinApiError) {
      console.log(`\n### ${label} — ${err.code} (HTTP ${err.status ?? "?"}): ${err.message}`);
    } else {
      console.log(`\n### ${label} — threw: ${(err as Error).message}`);
    }
    return null;
  }
}

const me = (await probe("GET /me", () => api.me())) as
  | { totals?: { clients?: number } }
  | null;

const clients = (await probe("GET /clients?per_page=3", () =>
  api.listClients({ per_page: 3 }),
)) as { data?: Array<Record<string, unknown>>; meta?: unknown } | null;

const first = clients?.data?.[0] as Record<string, unknown> | undefined;
if (first) {
  console.log(`\n>>> first client keys: ${Object.keys(first).join(", ")}`);
  const id = first.client_id ?? first.id;
  const login =
    (first.accounts as { logins?: string[] } | undefined)?.logins?.[0] ??
    (typeof first.accounts_logins === "string"
      ? String(first.accounts_logins).split(",")[0]?.trim()
      : undefined);

  if (id != null) {
    const detail = (await probe(`GET /clients/${id}`, () => api.getClient(id as number))) as
      | Record<string, unknown>
      | null;
    const acc = (detail?.accounts as { items?: Array<Record<string, unknown>> } | undefined)
      ?.items?.[0];
    if (acc) console.log(`\n>>> account item keys: ${Object.keys(acc).join(", ")}`);
  }

  if (login) {
    await probe(`GET /accounts/${login}`, () => api.getAccount(login));
    const trades = (await probe(`GET /accounts/${login}/trades?limit=3`, () =>
      api.listTrades(login, { limit: 3 }),
    )) as { data?: Array<Record<string, unknown>> } | null;
    const t = trades?.data?.[0];
    if (t) console.log(`\n>>> trade keys: ${Object.keys(t).join(", ")}`);
    await probe(`GET /accounts/${login}/positions`, () => api.listPositions(login));
  }
}

const email = first?.email;
if (typeof email === "string" && email.includes("@")) {
  await probe(`GET /clients/lookup?email=${email}`, () => api.lookup(email));
}

console.log(`\nDone. Reported total clients: ${me?.totals?.clients ?? "?"}`);
