# Elefin Partner CRM

Back-office CRM dashboard for an **Elefin introducing-broker / referral partner** —
track the traders under your referral code(s): signups, funding, trading activity,
commission, PnL, churn, plus per-trader drill-down.

Design & scope: [`project-structure-plan.md`](./project-structure-plan.md).

## Stack

| | |
|---|---|
| Web | Next.js (App Router) + React 19 + TypeScript + Tailwind v4 |
| DB | MongoDB (Mongoose, `Decimal128` money, time-series snapshots) |
| Sync | Node worker (`node-cron`) → Elefin Client Data API (read-only, ≤60/min) |
| Auth | Email + password, JWT session cookie (`jose`) + bcrypt, RBAC |

Monorepo via npm workspaces. Shared packages ship TypeScript source
(`transpilePackages` in Next, `tsx` in the worker) — no per-package build.

```
packages/db             Mongoose models + connect() + migrate-mongo
packages/elefin-client   typed wrapper over the Elefin API + rate limiter
packages/domain          pure KPI / trading-stats / snapshot math
apps/web                 the dashboard (Next.js)
apps/worker              sync + snapshot + alerts jobs
scripts/                 one-off importers (xlsx, snapshot backfill)
```

## Phase 0 — getting it running

```bash
# 1. install
npm install

# 2. config
cp .env.example .env         # set SESSION_SECRET, SEED_OWNER_PASSWORD, and (optional) ELEFIN_API_*

# 3. database
npm run db:up                # mongo in docker on :27017
npm run db:migrate           # collections + indexes
npm run db:seed              # create the first owner from SEED_OWNER_*

# 4. run
npm run dev                  # web on http://localhost:3000
npm run dev:worker           # sync worker (runs /me on boot)
```

Health check: `curl localhost:3000/api/health`.
Run one worker job by hand: `npm run job --workspace @elefin/worker -- me`.

## Production (PM2)

`ecosystem.config.cjs` runs the web app (`next start -p 3000`) and the sync
worker as two long-lived services under [PM2](https://pm2.keymetrics.io/).

```bash
npm ci
cp .env.example .env && $EDITOR .env      # MONGODB_URI, ELEFIN_API_*, SESSION_SECRET…
npm run db:migrate
npm run db:seed                            # first owner (skips if users exist)

npm run pm2:start                          # builds the web app, then starts both
pm2 save && pm2 startup                    # optional: restart both on server reboot
```

| script | does |
|---|---|
| `npm run pm2:start` | `mkdir -p logs` → `npm run build` → `pm2 start ecosystem.config.cjs` |
| `npm run pm2:restart` | rebuild + `pm2 restart … --update-env` |
| `npm run pm2:reload` | zero-downtime reload (web) |
| `npm run pm2:stop` / `pm2:delete` | stop / remove both |
| `npm run pm2:logs` / `pm2:status` | tail logs / show status |

Both processes are `fork` mode, `instances: 1` (the worker's cron scheduler and
`sync_requests` queue must stay single-runner), auto-restart with a crash-loop
guard, and `max_memory_restart`. Logs land in `./logs/{web,worker}.{out,err}.log`.
Each process reads the repo-root `.env` itself; PM2 only pins `NODE_ENV=production`
and `TZ=UTC`.

### Phase 0 — foundations (done)

- Login / logout, session cookie, route protection (middleware + server guard).
- App shell: top bar, left nav, all routes present.
- Worker scaffold: `runJob` + SyncRun bookkeeping, cron scheduler.

### Phase 1 — core visibility (done)

- **`sync-clients`** — pages `GET /clients`, upserts `clients` + `accounts` stubs
  (~2 API calls). Runs on worker boot + every 15 min.
- **`sync-accounts`** — `GET /clients/{id}` per client for full per-account
  detail (leverage, platform group, per-account lots / PnL / commission).
  ~1 call/client (~6 min for 266). Runs every 6 h; trigger by hand with
  `npm run job --workspace @elefin/worker -- accounts`.
- **`/clients`** — server-paginated, filterable (code, status, funded, activity,
  country, free-text), sortable table + CSV export (`/api/clients/export`).
- **`/clients/{id}`** — profile, KPI cards, funding summary, accounts table.
- **Global search** (`/` or ⌘K) — clients by name/email/id, accounts by login.
- **Dashboard** — live KPIs, conversion funnel, by-referral-code table, top
  clients by commission.
- `npm run probe:api` — dumps every endpoint's live shape (diagnostics).

### Phase 2 — trades, funding ledger, positions (done)

- **`sync-transactions`** — book-wide `GET /transactions?type=deposit|withdrawal`
  → `funding_events`, upsert by the API's stable id (`DEP-…` / `WDR-…`).
  Incremental via a `sync_state` cursor with a 2-day overlap. ~2 calls; boot +
  every 20 min.
- **`sync-trades`** — per-account `GET /accounts/{login}/trades` for accounts that
  have traded; `from` = local max `closeAt` (−1h) else `data_availability`.
  Upsert by `trade_ticket_id`. ~90 calls (~2 min); hourly.
- **`sync-positions`** — per-account `GET …/positions` (accounts with risk);
  replaces the open set when
  `as_of` is non-null. Runs on boot + every 2 min (`SYNC_POSITIONS_CRON`).
- **`/accounts/{login}/history`** — full trading analysis: 12 KPI cards (win rate,
  profit factor, expectancy, drawdown, …), daily-PnL diverging bars, cumulative
  PnL curve, by-instrument table, trades table. Filters: date range + symbol.
  CSV export.
- **`/funding`** — book-wide deposit/withdrawal ledger. Filters: date range, type,
  status, payment method, free-text. KPI totals + CSV export.
- **`/clients/{id}`** — now shows the client's daily-PnL + equity charts, open
  positions, and per-client funding history.
- `@elefin/domain` `tradingStats()` — pure win-rate / PF / drawdown / equity-curve
  / daily-PnL / by-symbol math, shared by the pages.

Dedupe: every synced row upserts on its natural key (`trade_ticket_id`,
`DEP-`/`WDR-` id, MT5 `login`, `client_id`) so re-runs never duplicate.

### Phase 3 — snapshots, trends & analytics (done)

- **`build-snapshots`** — reconstructs `book_daily` from source: signups from
  `clients.registeredAt`, funded / active counts from each client's first deposit
  / first trade, and deposit / withdrawal / trade / lot / PnL flows per day (+
  cumulative). Balance, equity and commission have no history — only the latest
  day carries their current totals; those lines fill in as snapshots accumulate.
  Idempotent (delete + insert per code + day). Boot + daily @ 00:05.
- **`npm run backfill:snapshots`** — rebuild the entire `book_daily` history.
- **Dashboard** — real trend charts: signups / week, deposits vs withdrawals /
  week (bars + net line), net-deposit and client-PnL curves.
- **`/analytics`** — Growth (signups, cumulative clients, active traders, by
  country), Conversion funnel, Funding (flows, cumulative net, deposit-size
  histogram), Trading activity (PnL / week, cumulative PnL / trades / lots).
- **`/commission`** — earned-to-date, per-lot, per-funded-client, top-client
  share, commission-at-risk; commission-over-time; by-code; top-50 earners.
- **`/referral-codes`** — per-code performance table + signups-by-code chart.
- Charts are hand-built client components (`components/charts/time-series.tsx`,
  `equity-curve.tsx`) — one shared y-axis, no chart library.

### Phase 4 — the action layer (done)

- **`run-alerts`** — evaluates nine rules (big deposit / withdrawal, funded-never-
  traded, gone dormant, balance wipeout, margin pressure, new whale, first trade,
  integration down) against `clients` / `funding_events` / `accounts` / `sync_runs`.
  Upserts with `$setOnInsert` so acknowledging is never undone; stateful alerts
  auto-resolve when the condition clears. Boot + every 15 min (`ALERTS_CRON`).
  Thresholds come from `app_config` (editable in Settings) with catalogue
  fallbacks in `@elefin/domain`.
- **`/alerts`** — severity counts, filter chips, severity-sorted table with
  Acknowledge / Snooze 7d / Reopen, plus the signed-in user's watchlist.
- **Watchlist** — `★ Watch` on any client profile → `WatchItem`; listed on `/alerts`.
- **`/positions`** — open-risk KPIs + table + staleness banner
  (empty list ≠ "flat" when `as_of` is stale).
- **`/settings`** (owner-only sections) — API-credential status via `/me`
  (secret never shown), user management (create / reset password / enable-disable),
  editable alert thresholds, activity log. Everyone can change their own password.
- **Audit log** (`audit_log`) — login / logout / alert actions / watch / user
  changes / threshold edits; shown in Settings.

Backups: `mongodump` (or Atlas continuous backup).

### Phase 5 — CRM polish (done)

- **Notes & follow-ups** — free-text notes on a client, optionally a dated
  follow-up task (`client_notes`). Shown on the profile with done / delete;
  open-note count badges on the client list; **Open follow-ups** section on
  `/alerts` (soonest first, overdue in red).
- **Cohort retention** — on `/analytics`: a signup-week × week-N grid of the
  % of each funded cohort that traded in week N, computed straight from
  `trades` + `clients` (no `client_daily` needed).
- **Saved views** — name the current filter set on `/clients` or `/funding`
  (`saved_views`); reload it from the Views bar; owner/analyst can share.

### Phase 6 — operational hardening (done)

- **Manual sync triggers** — owner buttons on `/sync` write a `sync_requests`
  row; the worker drains the queue (boot + every minute) so all API pacing
  stays in one process. Request history + outcomes shown on the page.
- **`/sync` reconciliation** — local vs API client count (Δ flagged), row
  counts, transaction cursor, credential panel, a stale-worker banner.
- **Dashboard "Needs attention"** — the top open critical/warning alerts and
  open follow-ups, surfaced on `/`.
- **KPI period deltas** — ▲/▼ "vs prev 30d" on the dashboard KPI cards
  (`periodDeltas` over `book_daily`), red/green by whether the move is good.
- **Domain unit tests** — `npm test` (17 tests) covers `money`, `time`,
  `bookKpis`, `conversionFunnel`, `tradingStats`, `evaluateAlerts`.

### Phase 7 — targets, digest, more tests (done)

- **Monthly targets & pace** — set signup / newly-funded / net-deposit targets
  in Settings (`app_config` "targets"). The dashboard shows month-to-date
  progress bars with a pace marker and on-track / behind-pace status
  (`lib/targets-data.ts`, MTD from `book_daily`).
- **Daily digest** — a `digest` worker job (boot + `DIGEST_CRON`, 07:00) composes
  a briefing: book KPIs, new alerts by severity, follow-ups due today, big
  deposits. Stored as a `Digest` doc and shown on the dashboard; if
  `DIGEST_WEBHOOK_URL` is set it also POSTs `{ text, ... }` (Slack / Discord /
  Telegram-bridge compatible).
- **Elefin API client tests** — `npm test` in `@elefin/elefin-client` (13 tests):
  envelope unwrap, terminal 401/403/404, 429 / 5xx / network retry,
  `bad_response`, rate-limit-header read, pagination helpers, `RateLimiter`
  spacing + `penalise`, missing-credential guard.

`npm test` at the repo root runs every workspace's suite (30 tests).

Still not wired: 2FA, Sentry, PDF export, `client_daily` per-client snapshots.
