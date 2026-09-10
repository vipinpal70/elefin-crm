# Elefin Partner CRM — Project Structure Plan

_Last updated: 2026-08-31_

A back-office CRM dashboard for an **Elefin introducing broker / referral partner** to
monitor the traders signed up under their referral code(s): who joined, who funded,
who is trading, how much commission they generate, how much they are winning or
losing, and which relationships need attention.

---

## Table of contents

1. [Why we are building this](#1-why-we-are-building-this)
2. [Who uses it](#2-who-uses-it)
3. [Data source — the Elefin Client Data API](#3-data-source--the-elefin-client-data-api)
4. [Architecture overview](#4-architecture-overview)
5. [Data model](#5-data-model)
6. [Cross-cutting features (search, filters, date range)](#6-cross-cutting-features)
7. [Page-by-page specification](#7-page-by-page-specification)
8. [KPI & metric definitions](#8-kpi--metric-definitions)
9. [Chart catalogue](#9-chart-catalogue)
10. [Proposed repository structure](#10-proposed-repository-structure)
11. [Non-functional requirements](#11-non-functional-requirements)
12. [Delivery phases](#12-delivery-phases)
13. [Open questions for stakeholders](#13-open-questions-for-stakeholders)

---

## 1. Why we are building this

The partner refers clients to Elefin (a forex / CFD broker) with a **referral code**
(e.g. `YASH`). Elefin pays the partner **commission** based on the volume those
referred clients trade. Today the only visibility is a flat spreadsheet export
(`docs/elefin_clients.xlsx`) and a read-only API. That is not enough to run the
business.

**Problems this CRM solves:**

| Problem today | What the CRM gives |
| --- | --- |
| No trend view — the API only returns *current* snapshots, no history | Daily snapshots stored locally so we can chart growth, deposits, commission over time |
| Can't tell if the book is growing or shrinking | Net new signups vs. churned clients per day/week/month |
| Can't see the signup → funded → active-trader funnel | Conversion funnel + cohort retention |
| Whales and at-risk clients are buried in 180+ rows | KPI cards, watchlists, alerts, sortable/filterable table |
| No per-trader drill-down | Client profile + full trading history, per-day PnL, per-symbol stats, equity curve |
| Commission is opaque | Commission page: earned to date, by client, by code, trend, per-lot yield |
| "Are my clients losing money?" (a leading indicator of churn and of future commission) | Book-wide client PnL, "total lost" metric, losers vs. winners |

**Primary goal:** one screen that answers _"is my referral book healthy this week,
and who do I need to call?"_ — backed by pages that let the team drill all the way
down to a single trade.

**Grounded in the current data** (`docs/elefin_clients.xlsx`, 183 clients):
- 183 referred clients, ~99% under code `YASH`, 2 under `474U-IU5JKX`, ~74% India.
- 57 funded (31%), 39 have placed a trade (21%), the rest are dead leads.
- Lifetime deposits ≈ $8,849, withdrawals ≈ $1,612, net deposits ≈ $7,236.
- Commission earned ≈ $90.18 total; 1,144 trades; ≈ 101 lots.
- Book-wide client trading PnL ≈ **−$2,251** (clients are net losing).
- Concentration: one client (`Vijayant Patel`) drove 67 of 101 lots and $18.25 of
  the $90 commission; three clients account for most of the net deposits.

The dashboard must make all of the above obvious at a glance and let us watch it
move day to day.

---

## 2. Who uses it

| Role | Needs | Access |
| --- | --- | --- |
| **Partner / owner** | Everything. Revenue, growth, whales, churn. | Full |
| **Team member / analyst** | Client list, drill-downs, exports, watchlists. | Full read, no user admin |
| **Viewer (optional)** | Read-only dashboard for an investor/manager. | Dashboard + analytics only |

Auth is a **simple email + password login** for these CRM users, with logout and
session cookies. This is completely separate from the Elefin API credential, which
never leaves the server.

---

## 3. Data source — the Elefin Client Data API

Base URL `https://el.theloginarea.com/api/v1` · Auth `Authorization: Bearer {key}.{secret}`
· Read-only · JSON · UTC · USD · **60 requests / minute**.

### 3.1 Endpoints we consume

| Endpoint | Gives us | Used for |
| --- | --- | --- |
| `GET /me` | Key abilities, partner identity, `data_availability` (how far back trades/txns go), totals | Health check on startup + Sync Status page |
| `GET /clients` | Paginated referred clients with **pre-aggregated** funding, account and trading totals | The core nightly/'15-min' sync → `clients` + `accounts` summary |
| `GET /clients/lookup?email=` | `affiliated: true/false` for one email | "Is this lead mine?" quick check |
| `GET /clients/{id}` | One client + per-account breakdown under `accounts.items[]` + `commission_earned` | Client detail page |
| `GET /accounts/{login}` | One MT5 account: balance, equity, lifetime deposits, lots, last trade, commission, `client_id` | Account panel + reconciliation |
| `GET /accounts/{login}/trades` | **Closed** positions, 1 row per position, stable `trade_ticket_id`, filters: `from`, `to`, `symbol`, paginated | Trading history, per-day PnL, per-symbol stats, equity curve |
| `GET /accounts/{login}/positions` | Currently **open** positions, snapshot with `as_of` (refreshed ~1/min) | Open Positions page (treat stale/null `as_of` as *unknown*, not *flat*) |

### 3.2 Constraints that shape the design

- **No history in the API.** Every list is a live snapshot. Growth / deposit /
  commission trend lines only exist if **we snapshot them ourselves** every day.
  (Exceptions we *can* backfill: signups from `registered_at` / `referred_at`, and
  per-day PnL from trade `close` timestamps.)
- **Rate limit 60/min.** All API access goes through a **server-side sync worker**
  that paces requests (~1 req / 1.1 s for bulk). The browser never calls Elefin.
- **Scope is implicit in the key.** Every list is already filtered to our referred
  clients. `404` = "not ours or doesn't exist" (don't show as "deleted");
  `403 unaffiliated` on trades/positions; a sudden `401` = key deactivated/expired
  (surface on Sync Status, alert the owner).
- **PII may be masked.** If the key lacks `clients.pii`, `email` / `phone` come back
  masked — store the masked form, show a "PII not granted" badge, never use masked
  values as identifiers.
- **Types.** MT5 logins are **strings** (never cast). Money fields are decimals —
  use `numeric`/`decimal`, never binary floats. Timestamps are UTC ISO-8601.
- **Withheld fields are absent, not null.** Read a missing key as "not granted".

---

## 4. Architecture overview

```
                    ┌──────────────────────────────────────────┐
                    │            Elefin Client Data API         │
                    │   https://el.theloginarea.com/api/v1      │
                    └───────────────▲──────────────────────────┘
                                    │ Bearer {key}.{secret}, ≤60/min, paced
                                    │
        ┌───────────────────────────┴───────────────────────────┐
        │                    SYNC WORKER (Node)                  │
        │  • /me health check      • /clients full page-through  │
        │  • per-account /trades & /positions   • rate limiter   │
        │  • upserts raw docs + computes daily snapshots         │
        │  • schedules: clients 15 min · trades hourly ·         │
        │    positions 1–5 min (optional) · snapshot 1×/day 00:05│
        └───────────────────────────┬───────────────────────────┘
                                    │ upsert
                    ┌───────────────▼──────────────┐
                    │        MongoDB               │
                    │  clients, accounts, trades,   │
                    │  positions, funding_events,   │
                    │  client_daily, book_daily     │  ← time-series collections
                    │  sync_runs, crm_users, ...    │
                    └───────────────▲──────────────┘
                                    │ internal API (server only)
                    ┌───────────────┴──────────────┐
                    │   WEB APP (Next.js / React)   │
                    │  session auth · dashboard ·   │
                    │  tables · charts · exports    │
                    └───────────────▲──────────────┘
                                    │ HTTPS + session cookie
                              ┌─────┴─────┐
                              │  Browser  │  (CRM users only)
                              └───────────┘
```

**Recommended stack** (swap freely — nothing below is load-bearing):

| Layer | Choice | Why |
| --- | --- | --- |
| Web app | **Next.js (App Router) + TypeScript + React** | One repo for UI + internal API routes |
| UI kit | **Tailwind CSS + shadcn/ui** | Fast, consistent, accessible primitives |
| Tables | **TanStack Table** | Sorting, column filters, pagination for the client list |
| Charts | **Recharts** (or visx for the custom histogram/equity curve) | Bar, line, area, funnel, heatmap |
| Data fetching | **TanStack Query** | Caching, background refresh of the dashboard |
| Database | **MongoDB** (Atlas or self-hosted 7.x+) | Flexible docs match the API's nested shapes; native **time-series collections** for `client_daily` / `book_daily`; `Decimal128` for money |
| ODM | **Mongoose** (schemas, validation, typed models) — or the native `mongodb` driver for the hot read paths | One schema definition shared by app + worker |
| Index / migrations | **`migrate-mongo`** for index creation + data migrations (Mongo is schemaless, but indexes and back-fills still need versioning) | Repeatable setup |
| Search | **Atlas Search** if on Atlas, else a compound **text index** on `name`/`email` + exact-match indexes on ids/`login` | Global ⌘K search |
| Sync worker | **Node script** on `node-cron` (or BullMQ + Redis if it grows) | Paced API pulls, snapshotting |
| Auth | **Auth.js credentials provider** (or Lucia) + HTTP-only session cookie; **MongoDB adapter** for sessions/users | Simple email/password login/logout, RBAC |
| Secrets | `.env` / platform secret store | Elefin `key.secret`, `MONGODB_URI`, session secret |
| Deploy | Docker Compose (app + worker + mongo + redis) on one VPS, or Vercel + MongoDB Atlas + worker on Railway/Fly | Small book, low ops |

---

## 5. Data model

MongoDB. Money fields are **`Decimal128`** (lots too — treat as decimal, never
float). All dates stored as UTC `Date` / ISO strings. "PK" below = the document
`_id`; "ref" = a plain field holding another document's `_id` (no FK enforcement —
the sync worker keeps them consistent). Every collection carries `syncedAt`.
Prefer **upsert on the natural key** so a re-sync is idempotent.

### 5.1 Synced-from-API collections

**`clients`** — one doc per referred client (from `/clients` + `/clients/{id}`).
`_id` = `client_id` (Elefin numeric id).
| Field | Notes |
| --- | --- |
| `name`, `email`, `phone`, `country` | `email`/`phone` may be masked; `emailMasked` / `phoneMasked` bool |
| `status` | `active` / `suspended` / `inactive` |
| `registeredAt`, `referredAt` | drives signup charts |
| `referralCode` | `YASH`, `474U-IU5JKX`, … (indexed) |
| `fundingCurrency` | usually `USD` |
| `fundingDeposits`, `fundingWithdrawals`, `fundingNetDeposit` | lifetime, USD, `Decimal128` |
| `fundingDepositCount`, `fundingFirstDepositAt`, `fundingLastDepositAt` | |
| `fundingIsFunded` | bool — has ≥1 successful deposit |
| `accountsCount` | number of real MT5 accounts |
| `accountsBalance`, `accountsEquity`, `accountsCredit` | summed across accounts |
| `tradingLots`, `tradingTrades`, `tradingNetProfit` | lifetime, from closed trades |
| `tradingLastTradeAt` | dormancy clock |
| `commissionEarned` | commission attributable to this client |
| `logins: string[]` | denormalised MT5 logins for fast search |
| `firstSeenAt`, `lastSyncedAt` | CRM bookkeeping |

_Indexes:_ `{referralCode:1, registeredAt:-1}`, `{fundingIsFunded:1}`,
`{status:1}`, `{country:1}`, `{tradingLastTradeAt:1}`, `{logins:1}`, text index on
`{name, email}`.

**`accounts`** — one doc per real MT5 account (from `/clients/{id}.accounts.items[]`,
`/accounts/{login}`). `_id` = `login` (**string**, never cast).
`clientId` (ref) · `accountType` · `platformGroup` · `currency` · `openedAt`
· `balance` · `equity` · `credit` · `margin` · `freeMargin` · `leverage`
· `tradingEnabled` · `totalDeposit` · `totalWithdrawal` · `netDeposit` · `lots`
· `trades` · `netProfit` · `lastTradeAt` · `commission` · `updatedAt` · `lastSyncedAt`.
_Indexes:_ `{clientId:1}`, `{lastTradeAt:1}`.

**`trades`** — one doc per closed position (from `/accounts/{login}/trades`).
`_id` = `tradeTicketId` (**string**). `login` (ref) · `clientId` (ref) · `symbol`
· `side` (buy/sell) · `volumeLots` · `openPrice` · `closePrice` · `openAt`
· `closeAt` · `profit` · `commission` · `swap` · `netPnl` (`profit + commission +
swap`) · `syncedAt`.
_Indexes:_ `{login:1, closeAt:-1}`, `{clientId:1, closeAt:-1}`, `{symbol:1}`,
`{closeAt:1}`.

**`positions`** — one doc per currently-open position (from
`/accounts/{login}/positions`). `_id` = `tradeTicketId`. `login` (ref) · `clientId`
· `symbol` · `side` · `volumeLots` · `openPrice` · `currentPrice` · `openAt`
· `unrealizedPnl` · `asOf` (snapshot time — `null` = *unknown*, not *flat*)
· `syncedAt`. Docs older than the current sync for that login are deleted.

**`funding_events`** _(derived / optional)_ — the API exposes aggregates, not a
ledger. If a transactions endpoint is later granted, store deposits/withdrawals
doc-by-doc here (`type`, `amount`, `currency`, `paidAmount`, `paidCurrency`,
`exchangeRate`, `occurredAt`). Until then, "funding over time" is reconstructed
from the daily snapshot deltas below.

### 5.2 CRM-owned collections

**`client_daily`** — **time-series collection** (`timeField: date`,
`metaField: clientId`, `granularity: hours`). The history the API doesn't give us:
one doc per client per day.
`clientId` · `date` · `isFunded` · `fundingDeposits` · `fundingWithdrawals`
· `fundingNetDeposit` · `accountsBalance` · `accountsEquity` · `tradingLots`
· `tradingTrades` · `tradingNetProfit` · `commissionEarned` · `status`
→ powers every trend line (deposits/day = today − yesterday, etc.).

**`book_daily`** — **time-series collection** (`timeField: date`,
`metaField: referralCode` so the book can be sliced per code). One doc per day
(× code).
`date` · `referralCode` · `clientsTotal` · `clientsFunded` · `clientsActiveTraders`
· `newSignups` · `churned` · `netChange` · `depositsCum` · `withdrawalsCum`
· `netDepositCum` · `balanceTotal` · `equityTotal` · `lotsCum` · `tradesCum`
· `clientPnlCum` · `commissionCum` · `depositsDay` · `withdrawalsDay`
· `commissionDay` · `clientPnlDay`.

**`crm_users`** — `_id` · `email` (unique) · `passwordHash` · `name` · `role`
(`owner`/`analyst`/`viewer`) · `isActive` · `lastLoginAt` · `createdAt`.

**`sync_runs`** — `_id` · `job` (`clients`/`trades`/`positions`/`snapshot`/`me`)
· `startedAt` · `finishedAt` · `status` (`ok`/`partial`/`failed`) · `apiCalls`
· `docsUpserted` · `error` · `rateLimitRemainingMin`. TTL index (~90 d).

**`saved_views`** — `_id` · `userId` · `page` · `name` · `filters` (object)
· `isShared`.

**`alerts`** _(generated)_ — `_id` · `type` · `clientId` · `severity` · `payload`
(object) · `createdAt` · `acknowledgedBy` · `acknowledgedAt`. Unique index on
`{type, clientId, dedupeKey}` so the same alert isn't re-created each sync.

**`audit_log`** — `_id` · `userId` · `action` · `entity` · `entityId` · `at`
· `meta`. TTL index per retention policy.

---

## 6. Cross-cutting features

These appear on most pages via a shared top bar / filter bar.

### 6.1 Global search (⌘K / top bar)
- Searches **clients** by name, email (unmasked or masked prefix), `client_id`,
  MT5 `login`, phone, country.
- Grouped results: Clients · Accounts · "Go to page".
- Enter on a client → Client Detail; on a login → Trading History for that account.
- Backed by a MongoDB **text index** on `name`/`email` (or Atlas Search for
  typo-tolerance) + exact-match indexes on `_id`, `logins`, `phone`.
- Also a dedicated **"Is this lead mine?"** box that calls `/clients/lookup` live
  (the one endpoint that's cheap and real-time).

### 6.2 Filter bar (persisted per page, saveable as a view)
| Filter | Values | Applies to |
| --- | --- | --- |
| **Date range** | Presets (Today, 7d, 30d, MTD, QTD, YTD, All) + custom picker; compare-to-previous toggle | Trend charts, "in period" KPIs, activity tables |
| Referral code | `YASH`, `474U-IU5JKX`, … multi-select | Everything |
| Status | active / suspended / inactive | Client-scoped views |
| Funded | funded only / not funded / all | Client-scoped views |
| Activity | traded ever / traded in range / dormant (no trade ≥30/60/90d) / never traded | Client-scoped views |
| Country | multi-select from data | Client-scoped views |
| Deposit band | $0 / $1–100 / $100–500 / $500+ | Client-scoped views |
| Symbol | e.g. `XAUUSD` | Trading history, per-symbol analytics |
| Account type / platform group | from data | Accounts, trading history |

### 6.3 Other shared behaviours
- **CSV / XLSX export** on every table (respects current filters).
- **Empty / loading / error / stale states** standardised: skeletons on load,
  "data as of {last_synced_at}" stamp in the header, amber banner if the last
  sync failed or is >X hours old, "PII not granted" badge where relevant.
- **Currency** shown as USD; **timezone** toggle (UTC ↔ local) with UTC default.
- **Density toggle** (comfortable / compact) for tables.

---

## 7. Page-by-page specification

Route prefix `/` for the app; `/api/*` for internal endpoints. All pages except
`/login` require a session.

### 7.1 `/login` — Sign in

**Purpose:** gate the CRM to authorised users.

```
                 ┌───────────────────────────────┐
                 │            [ Elefin ]          │
                 │        Partner CRM             │
                 │                                │
                 │   Email     [______________]   │
                 │   Password  [______________]   │
                 │   [ ] Remember me              │
                 │        (  Sign in  )           │
                 │   Forgot password?             │
                 └───────────────────────────────┘
```
- Email + password, rate-limited, generic error on failure, lockout after N tries.
- On success → `/` (Dashboard). Session cookie, HTTP-only, `SameSite=Lax`.
- **Logout**: button in the user menu (top-right avatar) → clears session → `/login`.
- No public sign-up. Users are created by an `owner` in Settings.
- Optional later: 2FA (TOTP), SSO.

### 7.2 `/` — Dashboard (Overview)

**Purpose:** the one-screen health check. Everything respects the global date range.

```
┌───────────────────────────────────────────────────────────────────────────────┐
│  Elefin Partner CRM         [ ⌘K search ]      Code:[YASH ▾]  Range:[30d ▾] ⟳  │
│  Data as of 2026-08-31 09:12 UTC · last sync OK                                │
├───────────────────────────────────────────────────────────────────────────────┤
│ ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌──────┐ │
│ │ Clients   │ │ Funded    │ │ Active    │ │ Net       │ │ Commission│ │ Client│ │
│ │   183     │ │   57      │ │ traders   │ │ deposits  │ │  earned   │ │  PnL  │ │
│ │ +14 (30d) │ │ 31.1%     │ │   39      │ │ $7,236    │ │  $90.18   │ │-$2,251│ │
│ │ ▲ vs prev │ │ ▲ +6      │ │ 21.3%     │ │ ▲ +$1,430 │ │ ▲ +$22.40 │ │ ▼     │ │
│ └───────────┘ └───────────┘ └───────────┘ └───────────┘ └───────────┘ └──────┘ │
│  (row 2 KPIs: Total deposits · Total withdrawals · Total lost · Lots · Trades  │
│   · Avg deposit/funded client · Commission per lot · Dormant clients)          │
├───────────────────────────────────────────┬───────────────────────────────────┤
│  Referral book growth (bar = net change,  │  Signup → Funded → Active funnel   │
│  line = cumulative clients)               │  ┌───────────────┐  183            │
│  ▁▂▅▃▆█▄▂▅  ── cumulative ──               │  ┌──────────┐     57  (31%)       │
│                                           │  ┌─────┐          39  (21%)       │
├───────────────────────────────────────────┼───────────────────────────────────┤
│  Deposits vs withdrawals over time        │  Commission earned over time      │
│  (grouped bars + net line)                │  (area, cumulative + per-day bars) │
├───────────────────────────────────────────┴───────────────────────────────────┤
│  Needs attention                     │  Top clients by commission             │
│  • 3 clients withdrew ≥90% this wk    │  1 Vijayant Patel   67.0 lots  $18.25  │
│  • 5 funded, never traded (>14d)      │  2 Pratik Honavar    1.9 lots   $8.59  │
│  • 1 big deposit ($808) — call        │  3 VION D'Souza      3.2 lots   $4.90  │
│  • 8 dormant 30d+ (were active)       │  … (link: full list)                  │
└──────────────────────────────────────┴───────────────────────────────────────┘
```

**KPI cards (row 1):** Total clients · Funded clients (+ %) · Active traders (+ %)
· Net deposits · Commission earned · Client PnL ("total lost" when negative).
**KPI cards (row 2):** Total deposits · Total withdrawals · Total lost (see §8)
· Total lots · Total trades · Avg deposit per funded client · Commission per lot
· Dormant clients. Each card shows the value, the in-range delta, and ▲/▼ vs the
previous equal period.

**Widgets:**
- **Referral book growth** — bar chart of net client change per day/week (new −
  churned), overlaid cumulative line. This is the "traders increasing or
  decreasing under my referral code" chart.
- **Conversion funnel** — Signed up → Funded → Active trader, counts + rates.
- **Deposits vs withdrawals over time** — grouped bars + net line.
- **Commission earned over time** — cumulative area + per-day bars.
- **Needs attention** — top 4–6 generated alerts (links to Alerts page).
- **Top clients by commission** (and a toggle for by volume / by net deposit).

**Data source:** `book_daily` for trends & KPIs; `alerts`; `clients` for the
top-lists. All cheap local reads.

### 7.3 `/clients` — Client list (the book)

**Purpose:** the working list. Find, segment, sort, export, act.

```
┌───────────────────────────────────────────────────────────────────────────────┐
│  Clients (183)   [search…]  Filters: Code▾ Status▾ Funded▾ Activity▾ Country▾  │
│                                              [Save view]  [Export CSV]         │
├─────┬───────────────┬─────────┬────────┬──────────┬────────┬────────┬──────────┤
│  id │ Name          │ Country │ Funded │ Net dep. │ Lots   │ Trades │ Comm.    │
├─────┼───────────────┼─────────┼────────┼──────────┼────────┼────────┼──────────┤
│39388│ Vijayant Patel│ India   │  ✅    │  $314.56 │ 67.01  │  126   │ $18.25   │
│32955│ Aditya Prasad │ India   │  ✅    │  $761.32 │  0.00  │    0   │  $0.00   │
│66246│ vilas saini   │ Unknown │  ❌    │   $0.00  │  0.00  │    0   │  $0.00   │
│ …   │               │         │        │          │        │        │          │
├─────┴───────────────┴─────────┴────────┴──────────┴────────┴────────┴──────────┤
│  Rows 1–50 of 183      ‹ prev  1 2 3 4  next ›        Density: ▢ compact       │
└───────────────────────────────────────────────────────────────────────────────┘
```

- **Columns (sortable, toggle-able):** id, name, email (masked badge), country,
  referral code, status, registered_at, funded, first deposit, deposits,
  withdrawals, net deposit, deposit count, accounts, balance, equity, lots,
  trades, net profit, last trade, dormancy (days since last trade), commission
  earned, commission per lot.
- **Row click** → Client Detail. **Hover** → mini popover (contact + last activity).
- **Bulk select** → export, add to watchlist, tag.
- **Quick segments** (chips above table): _Funded, never traded_ · _Dormant 30d+_
  · _Withdrew everything_ · _Whales ($500+ net dep)_ · _Winners_ · _Losers_ ·
  _Multi-account_.
- **Data source:** `clients` table, server-side pagination/sort/filter.

### 7.4 `/clients/{id}` — Client detail

**Purpose:** the full picture of one relationship.

```
┌───────────────────────────────────────────────────────────────────────────────┐
│  ‹ Clients   Vijayant Patel   #39388   [active]   Code YASH   India            │
│  vij•••@gmail.com  ·  +•• ••• (PII not granted)      [Watchlist +] [Export]    │
├───────────────────────────────────────────────────────────────────────────────┤
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ │
│ │Net dep.  │ │Balance   │ │Equity    │ │Lots      │ │Net PnL   │ │Commission│ │
│ │ $314.56  │ │ $430.97  │ │ $430.97  │ │  67.01   │ │ +$116.24 │ │  $18.25  │ │
│ └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘ │
├───────────────────────────────────────────────────────────────────────────────┤
│  Tabs:  Overview | Accounts (1) | Trading history | Funding | Timeline        │
├───────────────────────────────────────────────────────────────────────────────┤
│  OVERVIEW                                                                      │
│   • Registered 2026-08-XX · referred same day · first deposit 2026-08-26       │
│   • Deposits $555.56 (4) · Withdrawals $241.00 · Net $314.56                   │
│   • Equity curve (mini)         ╱╲___╱╲╱                                       │
│   • Balance vs net-deposit over time (from client_daily)                      │
│   • Per-symbol split (donut): XAUUSD 78% · EURUSD 14% · …                      │
├───────────────────────────────────────────────────────────────────────────────┤
│  ACCOUNTS tab: table of MT5 logins → type, group, leverage, balance, equity,  │
│   credit, margin, free margin, trading_enabled, deposits, withdrawals, lots,  │
│   trades, net_profit, last_trade_at, commission. Row → Trading history.       │
└───────────────────────────────────────────────────────────────────────────────┘
```

- **Overview tab:** identity + status, funding summary, `commission_earned`,
  balance vs net-deposit line (from `client_daily`), mini equity curve, per-symbol
  donut, dormancy indicator, notes field (CRM-owned, free text).
- **Accounts tab:** one row per real MT5 account with every field from
  `/clients/{id}.accounts.items[]`; click → Trading History scoped to that login.
- **Trading history tab:** embeds §7.5 for this client's account(s).
- **Funding tab:** deposits/withdrawals summary, deposit count, first/last deposit,
  net-deposit-over-time from `client_daily` deltas (until a real ledger exists).
- **Timeline tab:** merged event feed — registered, first deposit, first trade,
  big deposit, big withdrawal, went dormant, alert fired.
- **Data source:** `clients`, `accounts`, `client_daily`, `trades` (aggregated),
  plus an on-demand `/clients/{id}` refresh button (paced through the worker).

### 7.5 `/accounts/{login}/history` — Trader trading history

**Purpose:** the deep trading analysis the user asked for — full history, per-day
PnL histogram, totals, and the supporting stats. Reachable from a client or a
search on the MT5 login.

```
┌───────────────────────────────────────────────────────────────────────────────┐
│  ‹ Vijayant Patel   Account 12345…  XAUUSD-heavy   Range:[All ▾]  Symbol:[All▾]│
├───────────────────────────────────────────────────────────────────────────────┤
│ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌────┐ │
│ │ Trades  │ │ Win rate│ │ Net PnL │ │ Volume  │ │ Profit  │ │ Avg win │ │Max │ │
│ │  126    │ │  54%    │ │+$116.24 │ │67.01 lot│ │ factor  │ │ /loss   │ │ DD │ │
│ │         │ │         │ │         │ │         │ │  1.18   │ │+$21/−$17│ │12% │ │
│ └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘ └────┘ │
├───────────────────────────────────────────────────────────────────────────────┤
│  Daily PnL histogram (one bar per day, green=profit / red=loss)                │
│      +$  ▁ ▃ █ ▂    ▅ ▁          ▆                                             │
│      -$        ▂  ▇   ▃  █ ▁  ▄                                                │
│      └────────────────────────────────────────── date ──────────────┘         │
│  [ toggle: daily | weekly ]   [ cumulative equity curve overlay ]             │
├───────────────────────────────────────────────────────────────────────────────┤
│  Cumulative equity / running PnL (line/area)                                   │
│      ╱╲    ╱╲__╱╲___╱╱                                                        │
├───────────────────────────────────────────────────────────────────────────────┤
│  By symbol            │  By weekday / hour heatmap  │  Lots traded over time   │
│  XAUUSD  92 tr +$140  │   Mon ..  Tue ..  Wed ..     │  ..                      │
│  EURUSD  20 tr -$18   │   (trade count / PnL cells)  │  (weekly lots)           │
├───────────────────────────────────────────────────────────────────────────────┤
│  Trades (126)                              [ Export CSV ]                       │
│  ticket │ symbol │ side │ lots │ open→close price │ opened │ closed │ profit    │
│  …one row per closed position, newest first, paginated…                        │
└───────────────────────────────────────────────────────────────────────────────┘
```

- **KPI cards:** Total trades · Win rate · Net PnL · Volume (lots) · Gross profit /
  gross loss · Profit factor · Avg win / avg loss · Expectancy per trade · Largest
  win / largest loss · Max drawdown · Avg holding time · Commission + swap paid.
- **Daily PnL histogram** — one bar per calendar day (UTC or local), green above /
  red below zero, from `trades` grouped by `close_at::date`. Weekly toggle.
- **Cumulative equity curve** — running sum of `net_pnl` by close time.
- **By symbol** — table + bar: trades, lots, net PnL, win rate per instrument.
- **Activity heatmap** — trades / PnL by weekday × hour (spots session patterns).
- **Lots over time** — volume trend (also feeds commission expectations).
- **Open positions strip** (if any) — from `positions`, with `as_of` stamp; amber
  if stale/null.
- **Trades table** — full closed-trade list: `trade_ticket_id`, symbol, side,
  volume, open/close price, open/close time, profit, commission, swap, net PnL.
  Filter by symbol + date range; sortable; CSV export.
- **Data source:** `trades`, `positions`, `accounts` locally; "Refresh from Elefin"
  button enqueues a paced `/accounts/{login}/trades` re-pull (respects
  `data_availability.trades_from`).

### 7.6 `/analytics` — Trends & analytics

**Purpose:** the "how is the book moving" analysis, deeper than the dashboard.
Sub-tabs:

- **Growth** — new signups per day/week/month (bar) from `registered_at`; net
  change (new − churned); cumulative book size; growth rate %; signups by referral
  code (stacked); signups by country (map / bar).
- **Conversion** — funnel Signed up → Funded → First trade → Active (traded in
  last 30d); time-to-fund and time-to-first-trade distributions; conversion by
  cohort (signup week) and by referral code.
- **Retention / cohorts** — cohort grid (signup month × months-since), % still
  active, % still funded; churn curve.
- **Funding** — deposits, withdrawals, net deposits over time; deposit size
  distribution (histogram — lots of ~$100/$101.01 first deposits in the data);
  repeat-deposit rate; withdrawal ratio; net deposit by cohort.
- **Trading activity** — book-wide lots & trades per day/week; active traders per
  week; average trades per active client; symbol popularity across the book;
  book-wide client PnL over time.
- **Commission** — see dedicated page §7.7 (this tab links out).

**Data source:** `book_daily`, `client_daily`, `clients`, `trades`.

### 7.7 `/commission` — Commission & earnings

**Purpose:** what the partner actually gets paid, and what drives it.

```
┌───────────────────────────────────────────────────────────────────────────────┐
│  Commission        Range:[MTD ▾]   Code:[All ▾]                               │
├───────────────────────────────────────────────────────────────────────────────┤
│  Earned to date $90.18  │  In range $22.40  │  Per lot $0.89  │  Per funded   │
│                         │                   │                │ client $1.58  │
├───────────────────────────────────────────────────────────────────────────────┤
│  Commission over time (cumulative area + per-day bars)                         │
├───────────────────────────────────────────────────────────────────────┬───────┤
│  By client (table: commission, lots, trades, comm/lot, net dep.)       │ By    │
│   Vijayant Patel  $18.25 · 67.0 lots                                   │ code  │
│   Pratik Honavar   $8.59 ·  1.9 lots                                   │ YASH  │
│   VION D'Souza     $4.90 ·  3.2 lots                                   │ $87.. │
│   …                                                                    │ 474U  │
├───────────────────────────────────────────────────────────────────────┴───────┤
│  Concentration: top client = 20% of commission · top 5 = 55% (risk flag)      │
└───────────────────────────────────────────────────────────────────────────────┘
```

- KPIs: earned to date · earned in range (from `client_daily` deltas) · commission
  per lot · commission per funded client · projected next-30d (simple run-rate).
- Commission over time; by client; by referral code; concentration / dependency
  warning; "commission at risk" = commission from clients now dormant or
  withdrawing.
- **Note:** the commission model (per-lot rate, tiers, revenue share) isn't in the
  API — see open questions §13. Until confirmed, we report `commission_earned` as
  given and derive per-lot yield empirically.

### 7.8 `/funding` — Deposits & withdrawals

**Purpose:** cash flow of the book.

- KPIs: total deposits · total withdrawals · net deposits · funded clients ·
  avg first deposit · repeat-deposit rate · withdrawal ratio (wd ÷ dep).
- Charts: deposits vs withdrawals over time (grouped bars + net line); deposit
  size histogram; net deposit by cohort; cumulative net deposit.
- Tables: recent large deposits (call list); recent large withdrawals (save list);
  clients who withdrew ≥90% of deposits (churn risk).
- **Data source:** `client_daily` deltas + `clients`. Upgrades to a true ledger if
  a transactions endpoint is granted.

### 7.9 `/positions` — Open positions (near-live)

**Purpose:** what's exposed right now across the book.

- Table: client, login, symbol, side, lots, open price, current price, unrealised
  PnL, opened at, `as_of`.
- KPIs: accounts with open risk · total open lots · aggregate unrealised PnL ·
  most-exposed symbol.
- Per-account `as_of` freshness badge; global banner if the positions sync is
  stale or `as_of` is null ("unknown, not flat").
- Refresh cadence 1–5 min (config); this is the only page that polls.
- **Data source:** `positions` table (worker-fed).

### 7.10 `/referral-codes` — Codes / sub-affiliates

**Purpose:** compare performance across codes (`YASH` vs `474U-IU5JKX`, and any
future team members).

- Per-code cards & table: clients, funded, active, net deposits, lots, trades,
  client PnL, commission, conversion %, commission per client.
- Stacked growth chart by code; share-of-book donut.
- **Data source:** `clients` grouped by `referral_code`, `book_daily` if we split
  snapshots per code (recommended).

### 7.11 `/alerts` — Alerts & watchlist

**Purpose:** the action queue — "who do I call today".

- **Generated alert types** (run after each sync):
  | Type | Rule (tunable) |
  | --- | --- |
  | Big deposit | deposit ≥ $500 in last 24h |
  | Big withdrawal | withdrawal ≥ $300 or ≥ 90% of balance in 24h |
  | Funded, never traded | funded, 0 trades, funded ≥ 7 days ago |
  | Gone dormant | was active, no trade in 30 / 60 / 90 days |
  | Balance wipeout | equity fell ≥ 90% from peak |
  | Margin pressure | free margin < X% of equity (from `accounts`) |
  | New whale | net deposit crossed $500 |
  | First trade | client placed their first-ever trade |
  | Key/sync problem | `/me` 401, or sync failed / stale |
- Each alert: severity, client link, context, "acknowledge" + "snooze", assignee.
- **Manual watchlist**: star any client; watchlist tab with the same table as
  `/clients` filtered to starred.
- **Data source:** `alerts`, `clients`, `client_daily`.

### 7.12 `/sync` — Data & sync status (admin)

**Purpose:** trust the numbers.

- `/me` panel: partner id/name, key abilities (`clients.read`, `clients.pii`?),
  `rate_limit_per_minute`, `expires_at` (warn if near), `data_availability`
  (`trades_from`, `transactions_from`), totals reported by Elefin vs. our counts
  (reconciliation).
- `sync_runs` table: job, started, duration, status, API calls used, rows
  upserted, error; rate-limit headroom chart.
- Manual triggers (owner only): "sync clients now", "re-pull trades for account…",
  "rebuild snapshots".
- Banner rules that feed the global "stale data" warning.

### 7.13 `/settings` — Settings

- **Users** (owner only): list, invite (create with temp password), role, disable,
  reset password. Backed by `crm_users`; writes to `audit_log`.
- **Profile**: name, email, password change, timezone preference, default referral
  code filter, default date range.
- **Alert thresholds**: edit the tunable numbers in §7.11.
- **API credential**: status only (never displays the secret) — connected/among
  abilities/expiry, "test connection" (calls `/me`), instructions to rotate via
  Elefin. Stored server-side in secrets, not the DB.
- **Data**: snapshot retention, export all (ZIP of CSVs).

---

## 8. KPI & metric definitions

Precise so the numbers are unambiguous. "In range" = filtered by the global date
range; deltas compare to the previous equal-length period.

| Metric | Definition |
| --- | --- |
| **Total clients** | `count(clients)` for selected referral code(s) |
| **New signups (in range)** | `count(clients where registered_at in range)` |
| **Churned (in range)** | clients who moved from active→inactive: `status ∈ {inactive,suspended}` **or** (was funded AND withdrawals ≥ 95% of deposits AND no trade in ≥60d) — first time that becomes true within range |
| **Net change** | new signups − churned |
| **Funded clients** | `count(clients where funding_is_funded)`; **rate** = funded ÷ total |
| **Active traders** | `count(clients where trading_trades > 0)`; **active in range** = a trade with `close_at in range` |
| **Dormant clients** | funded AND `trading_last_trade_at` older than 30/60/90d (configurable) |
| **Total deposits** | `Σ funding_deposits` (lifetime) or `Σ client_daily deposit deltas` (in range) |
| **Total withdrawals** | `Σ funding_withdrawals` (lifetime) / daily deltas (in range) |
| **Net deposits** | deposits − withdrawals |
| **Avg first deposit** | mean of first deposit amount across funded clients |
| **Withdrawal ratio** | withdrawals ÷ deposits (book or per client) |
| **Total lots** | `Σ trading_lots` (book) / `Σ volume_lots` of trades in range |
| **Total trades** | `Σ trading_trades` / `count(trades where close_at in range)` |
| **Client PnL (book)** | `Σ trading_net_profit` across clients (or `Σ net_pnl` of trades in range). Negative = clients losing. |
| **Total lost** | **the loss side of client PnL.** Primary definition: `Σ trading_net_profit for clients where trading_net_profit < 0` (gross losses of losing clients). Shown alongside **Net client PnL** (`Σ` over all, currently ≈ −$2,251) and **Withdrawn** (`Σ withdrawals`). The dashboard labels which one each card uses; confirm the intended meaning in §13. |
| **Commission earned** | `Σ commission_earned` (lifetime) / `Σ client_daily commission deltas` (in range) |
| **Commission per lot** | commission earned ÷ lots (book or per client) |
| **Commission per funded client** | commission earned ÷ funded clients |
| **Commission at risk** | `Σ commission_earned` for clients now dormant or with withdrawal ratio ≥ 90% |
| **Conversion: signup→funded** | funded ÷ signups (optionally per cohort) |
| **Conversion: funded→active** | active traders ÷ funded |
| **Time to fund** | `funding_first_deposit_at − registered_at` (distribution) |
| **Win rate (account)** | winning trades ÷ total trades |
| **Profit factor** | gross profit ÷ gross loss (abs) |
| **Expectancy / trade** | net PnL ÷ trade count |
| **Max drawdown** | largest peak-to-trough drop of the cumulative equity curve |
| **Avg holding time** | mean `close_at − open_at` |
| **Book balance / equity** | `Σ accounts_balance` / `Σ accounts_equity` |

---

## 9. Chart catalogue

| Chart | Type | X | Y / series | Source | Where |
| --- | --- | --- | --- | --- | --- |
| Referral book growth | Bar + line combo | day/week | net change (bars), cumulative clients (line) | `book_daily` | Dashboard, Analytics |
| New signups | Bar (stack by code) | day/week/month | signup count | `clients.registered_at` | Analytics |
| Conversion funnel | Funnel | stage | count / rate | `clients` | Dashboard, Analytics |
| Cohort retention | Heatmap grid | signup month × month N | % active | `client_daily` | Analytics |
| Deposits vs withdrawals | Grouped bar + net line | day/week | deposits, withdrawals, net | `client_daily` deltas | Dashboard, Funding |
| Deposit size distribution | Histogram | amount band | client count | `clients` | Funding, Analytics |
| Net deposit (cumulative) | Area | day | cumulative net deposit | `book_daily` | Funding |
| Commission over time | Area (cum) + bars (daily) | day | commission | `client_daily` deltas | Dashboard, Commission |
| Commission by client | Horizontal bar | client | commission | `clients` | Commission |
| Commission by code | Donut / bar | code | commission | `clients` | Commission, Referral codes |
| Book-wide client PnL | Line | day | cumulative client PnL | `book_daily` | Analytics |
| **Daily PnL histogram (per account)** | Diverging bar | day | net PnL (green/red) | `trades` grouped by `close_at::date` | Trading history |
| Equity curve (per account) | Line / area | close time | running Σ net_pnl | `trades` | Trading history, Client detail |
| PnL by symbol | Bar + table | symbol | net PnL, trades, lots | `trades` | Trading history |
| Activity heatmap | Heatmap | weekday × hour | trade count / PnL | `trades` | Trading history |
| Lots over time (per account) | Bar | day/week | Σ lots | `trades` | Trading history |
| Open exposure by symbol | Bar | symbol | open lots / unrealised PnL | `positions` | Positions |
| Signups by country | Map or bar | country | client count | `clients` | Analytics |
| Rate-limit headroom | Line | time | `X-RateLimit-Remaining` | `sync_runs` | Sync status |

All charts: colour-blind-safe palette, green=gain/red=loss only for PnL, direct
labels over legends where possible, empty-state text, respect the date range,
tooltip with exact values, keyboard-navigable, light/dark aware.

---

## 10. Proposed repository structure

Monorepo, npm workspaces (or pnpm/Turborepo). Web app + worker share the DB schema
and types.

```
elefin_crm/
├── docs/
│   ├── elefin-client-data-api V2.html      # upstream API reference (given)
│   ├── elefin_clients.xlsx                  # sample export (given)
│   └── project-structure-plan.md            # this file (or keep at repo root)
├── README.md
├── docker-compose.yml                       # app + worker + mongo + redis
├── .env.example                             # ELEFIN_API_KEY, ELEFIN_API_SECRET, MONGODB_URI, SESSION_SECRET, ...
├── package.json                             # workspaces: apps/*, packages/*
│
├── packages/
│   ├── db/                                  # Mongoose connection + models + migrations
│   │   ├── src/connect.ts                   # memoised mongoose connection (safe for Next.js hot reload)
│   │   ├── src/models/{Client,Account,Trade,Position,ClientDaily,BookDaily,CrmUser,SyncRun,SavedView,Alert,AuditLog}.ts
│   │   ├── src/index.ts                     # re-exports models + types
│   │   ├── migrations/                      # migrate-mongo: index creation, back-fills
│   │   └── migrate-mongo-config.js
│   ├── elefin-client/                       # typed wrapper over the Elefin API
│   │   ├── src/client.ts                    # fetch + Bearer auth + retry (429/5xx only)
│   │   ├── src/rate-limiter.ts              # ≤60/min, ~1 req/1.1s bulk
│   │   ├── src/endpoints.ts                 # me, clients, clientById, lookup, account, trades, positions
│   │   └── src/types.ts                     # response envelope + entity types
│   ├── domain/                              # pure business logic, no I/O
│   │   ├── src/kpis.ts                      # KPI formulas from §8
│   │   ├── src/alerts.ts                    # alert rules from §7.11
│   │   ├── src/snapshots.ts                 # build client_daily / book_daily
│   │   └── src/metrics/trading.ts           # win rate, profit factor, drawdown, equity curve
│   └── ui/                                  # shared React components (optional)
│       └── src/{KpiCard,DataTable,DateRangePicker,charts/*}.tsx
│
├── apps/
│   ├── web/                                 # Next.js App Router
│   │   ├── app/
│   │   │   ├── (auth)/login/page.tsx
│   │   │   ├── (app)/layout.tsx             # top bar, filter bar, auth guard
│   │   │   ├── (app)/page.tsx               # Dashboard
│   │   │   ├── (app)/clients/page.tsx
│   │   │   ├── (app)/clients/[id]/page.tsx
│   │   │   ├── (app)/accounts/[login]/history/page.tsx
│   │   │   ├── (app)/analytics/page.tsx
│   │   │   ├── (app)/commission/page.tsx
│   │   │   ├── (app)/funding/page.tsx
│   │   │   ├── (app)/positions/page.tsx
│   │   │   ├── (app)/referral-codes/page.tsx
│   │   │   ├── (app)/alerts/page.tsx
│   │   │   ├── (app)/sync/page.tsx
│   │   │   ├── (app)/settings/page.tsx
│   │   │   └── api/                         # internal endpoints (server → DB only)
│   │   │       ├── auth/[...nextauth]/route.ts
│   │   │       ├── clients/route.ts         # list w/ filters+pagination
│   │   │       ├── clients/[id]/route.ts
│   │   │       ├── accounts/[login]/trades/route.ts
│   │   │       ├── metrics/overview/route.ts
│   │   │       ├── metrics/analytics/route.ts
│   │   │       ├── search/route.ts
│   │   │       ├── lookup/route.ts          # proxied live /clients/lookup
│   │   │       ├── export/route.ts
│   │   │       └── sync/trigger/route.ts    # owner-only manual sync
│   │   ├── lib/{auth,rbac,filters,format}.ts
│   │   ├── components/
│   │   └── middleware.ts                    # session gate
│   │
│   └── worker/                              # sync + snapshot + alerts
│       ├── src/index.ts                     # scheduler (node-cron / BullMQ)
│       ├── src/jobs/sync-me.ts
│       ├── src/jobs/sync-clients.ts         # page through /clients, upsert clients+accounts
│       ├── src/jobs/sync-trades.ts          # per account /trades since data_availability / last cursor
│       ├── src/jobs/sync-positions.ts       # optional, 1–5 min
│       ├── src/jobs/build-snapshots.ts      # 00:05 UTC → client_daily, book_daily
│       ├── src/jobs/run-alerts.ts           # after each sync
│       └── src/lib/{cursor,reconcile,log}.ts
│
└── scripts/
    ├── import-xlsx.ts                       # one-off: load docs/elefin_clients.xlsx to seed/backfill
    └── backfill-snapshots.ts               # rebuild book_daily from registered_at + trades history
```

**Notes**
- Keep `project-structure-plan.md` wherever the team prefers — repo root (current)
  or `docs/`.
- `packages/db` owns the Mongoose models and the single `connect()` helper; the web
  app imports it from server components / route handlers only, the worker imports
  it directly. Never import it into a client component.
- `packages/domain` is pure and unit-tested (plain objects in, numbers out — no
  Mongoose); the web app and worker both import it so KPI math is defined once.
- The worker is a separate process/container so a slow API pull never blocks page
  loads.
- If Next.js API routes feel heavy, the same `app/api` handlers can move to a
  standalone Fastify service later without touching `packages/*`.

---

## 11. Non-functional requirements

| Area | Requirement |
| --- | --- |
| **Rate limiting** | Central limiter in `packages/elefin-client`; ≤60/min, ~1 req/1.1 s for bulk; obey `Retry-After` on 429; exponential backoff on 5xx; **never retry** 401/403/404 |
| **Sync cadence** | `/me` on worker start + hourly · `/clients` every 15 min · `/accounts/{login}/trades` hourly (incremental via `from` = last close cursor) · `/positions` 1–5 min (opt-in) · snapshots 00:05 UTC daily |
| **Freshness** | Every page header shows `last_synced_at`; amber banner if newest sync > 2× its interval or last run failed |
| **Money** | `Decimal128` in MongoDB, `decimal.js` in code, never float; convert to string/number only at the view layer; display USD with thousands separators, 2 dp |
| **Time** | Store UTC `Date`; display UTC by default with a local toggle; date-only filters `YYYY-MM-DD` |
| **IDs** | MT5 `login` is a string everywhere — as `_id`, in URLs, in JSON; never parsed as a number |
| **PII** | Respect `clients.pii`; store masked values as-is; "PII not granted" badge; PII fields excluded from exports unless the ability is present and the user is `owner`/`analyst`; access to unmasked PII written to `audit_log` |
| **AuthN** | Email+password, bcrypt/argon2 hashes, HTTP-only `SameSite=Lax` session cookie, idle + absolute session timeout, login rate-limit + lockout |
| **AuthZ** | `owner` (all + user admin + manual sync + rotate creds view) · `analyst` (all read + exports + ack alerts) · `viewer` (dashboard + analytics read-only) |
| **Auditing** | `audit_log` for logins, exports, user changes, manual syncs, PII reveals, threshold edits |
| **Secrets** | Elefin `key.secret`, `SESSION_SECRET`, `MONGODB_URI` in env/secret store, never in DB, never sent to the browser, never logged |
| **Errors** | 401 from Elefin → mark integration down, alert owner, keep serving last-good data · partial sync → `status = partial`, continue · surface all in `/sync` |
| **Performance** | Dashboard from pre-aggregated `book_daily` time-series (< 50 ms) · client list server-paginated (range/`_id` cursor, not `skip` on large sets) · aggregation pipelines backed by the §5 indexes, checked with `explain()` · trade tables virtualised · charts downsampled beyond ~500 points |
| **Backup** | Nightly `mongodump` (or Atlas continuous backup); the `client_daily` / `book_daily` snapshots are the irreplaceable data (API can't recreate history) |
| **Observability** | Structured logs, `sync_runs` metrics, health endpoint, optional Sentry |
| **Accessibility** | Keyboard nav, focus states, WCAG AA contrast, chart data available as a table, light/dark |
| **Testing** | Unit: `packages/domain` (KPIs, alerts, trading metrics) · contract tests for `elefin-client` against recorded fixtures · e2e: login, dashboard, client drill-down, export |

---

## 12. Delivery phases

**Phase 0 — Foundations (scaffold)**
Monorepo, `packages/db` (Mongoose models + `connect()` + `migrate-mongo` indexes),
`elefin-client` with rate limiter + `/me`, Docker Compose (mongo + redis),
auth (login/logout, one seeded owner), empty app shell with top/filter bar.

**Phase 1 — MVP (core visibility)**
- `sync-clients` job (clients + accounts), `import-xlsx` seed.
- Dashboard: row-1 KPI cards + book-growth chart + conversion funnel + top clients.
- `/clients` list with filters, sort, pagination, CSV export.
- `/clients/{id}` Overview + Accounts tabs.
- Global search.
- `/sync` status page.

**Phase 2 — Trading depth**
- `sync-trades` job + `trades` table + incremental cursor.
- `/accounts/{login}/history`: KPI cards, **daily PnL histogram**, equity curve,
  by-symbol, trades table, exports.
- Client detail: Trading history + Funding + Timeline tabs.

**Phase 3 — Analytics & history**
- `build-snapshots` + `backfill-snapshots`; `client_daily` / `book_daily`.
- `/analytics` (growth, conversion, retention, funding, activity).
- `/funding`, `/commission`, `/referral-codes`.
- Date-range "compare to previous" everywhere; saved views.

**Phase 4 — Action layer**
- `run-alerts` + `/alerts` + watchlist + acknowledge/snooze.
- `/positions` near-live page.
- `/settings`: users, thresholds, credential status, retention.
- Audit log, RBAC hardening, backups, Sentry.

**Phase 5 — Nice-to-haves**
Notes/tasks per client, email/Telegram alert digests, 2FA, PDF report export,
per-code sub-login for team members, projections/targets.

---

## 13. Open questions for stakeholders

1. **"Total lost" — which meaning?** (a) gross losses of losing clients,
   (b) net client trading PnL across the book, (c) total withdrawn, or (d) value of
   churned clients. Default assumption: (a), with (b) and (c) shown alongside.
2. **Commission model.** Per-lot rate? Tiered by volume? Any revenue-share on
   client losses? Needed for projections and "commission per lot" targets.
3. **Multiple referral codes / team.** Is `474U-IU5JKX` a sub-affiliate, a second
   personal code, or test data? Do team members each get a code and a scoped login?
4. **API key abilities.** Does our key carry `clients.pii`? What's `expires_at`?
   What are `data_availability.trades_from` / `transactions_from` (how far back can
   we backfill history)?
5. **Is a transactions/ledger endpoint available** beyond the 7 documented? It
   would turn `/funding` from snapshot-deltas into a real ledger.
6. **Churn definition.** Confirm the rule (status change vs. withdrew-everything vs.
   dormant N days) and N.
7. **Refresh expectations.** Is 15-min client data / hourly trades acceptable, or
   is near-real-time needed (changes cadence and infra)?
8. **Users & roles.** Who needs access on day one, and does anyone need read-only?
9. **Historical baseline.** Should we import `docs/elefin_clients.xlsx` as the
   2026-08-31 snapshot so trend charts have a starting point?
10. **Hosting & compliance.** Where does this run, and are there data-residency /
    retention rules for client PII?
```
