# Partner-code change detection — plan

_Drafted: 2026-09-14 — for review, not yet implemented._

## Table of contents

1. [The problem](#1-the-problem)
2. [What I verified against the live API today](#2-what-i-verified-against-the-live-api-today)
3. [Proposed design](#3-proposed-design)
4. [Data model changes](#4-data-model-changes)
5. [Detection pipeline (worker)](#5-detection-pipeline-worker)
6. [UI changes](#6-ui-changes)
7. [Alerts integration](#7-alerts-integration)
8. [Edge cases and assumptions still to validate](#8-edge-cases-and-assumptions-still-to-validate)
9. [Open decisions — need your call](#9-open-decisions--need-your-call)
10. [Implementation task list](#10-implementation-task-list)
11. [Rollout & testing](#11-rollout--testing)

---

## 1. The problem

A client trades under our referral code, so Elefin's API returns them under our
partner scope and we sync their data. Elefin lets a client **change their partner
code at any time** — switch to a different IB, or none. Once that happens:

- They may keep trading normally at the broker — nothing about *their* activity
  changes.
- But they are no longer "ours": no more commission accrues, and continuing to
  count them in book-wide KPIs, dashboards and outreach is misleading.
- **Today the CRM has no way to know this happened.** We only ever `upsert`
  client rows; nothing ever gets removed or flagged, so a client who left
  looks identical to one who is just quiet for a while (`tradingLastTradeAt`
  stale, same as a dormant-but-still-ours client).

You want a **label on the client** ("still with us" vs "left our code"), visible
on the client list and profile, filterable, so the team can see at a glance who
is no longer a live part of the book.

## 2. What I verified against the live API today

Before proposing a design I checked what Elefin's API actually exposes, live,
against our real key (`scripts/_investigate-churn*.mts`, not committed —
throwaway probes):

| Endpoint | Returns `affiliated`? | Notes |
|---|---|---|
| `GET /clients` (list) | **No** | Top-level client rows have no `affiliated` field — this endpoint is implicitly "your current clients" |
| `GET /clients/{id}` | No at the top level, **yes on each `accounts.items[]` entry** | `accounts.items[0].affiliated === true` for a normal client, confirmed live |
| `GET /accounts/{login}` | **Yes**, top-level | `affiliated: true` confirmed live |
| `GET /clients/lookup?email=` | **Yes**, top-level | `affiliated: true` confirmed live |

This is the key finding: **`accounts.items[].affiliated` is already present in the
exact payload `sync-accounts` fetches every 6 hours today** — `mapAccount()` in
`apps/worker/src/jobs/map.ts` just doesn't read it yet. Capturing it costs
**zero additional API calls**.

The one thing I could not verify: **our entire book (277 clients) currently
matches Elefin's live count exactly (`me.totals.clients === 277`, 0 clients in
our DB missing from a fresh live `/clients` pull)** — nobody has left yet in
this book, so I cannot observe first-hand what `GET /clients/{id}` does for a
client who *has* left (does it keep returning 200 with `affiliated: false` on
their accounts, or start 403/404ing for that one client?). Section 8 covers how
the design stays correct either way.

## 3. Proposed design

Three independent signals, combined, from cheapest/fastest to most authoritative:

1. **Primary — the `affiliated` flag** (from `sync-accounts`, already fetched,
   free). If Elefin keeps answering `GET /clients/{id}` for a departed client
   and just flips `accounts.items[].affiliated` to `false`, this is the direct,
   authoritative signal. Latency: up to 6h (the `sync-accounts` cadence).
2. **Early warning — disappearance from the `/clients` list.** `sync-clients`
   runs every 15 min and already re-fetches the full current list. A client
   who was in our DB but is **not** in this run's result set is a strong early
   signal (that endpoint is implicitly "clients currently under your code").
   Latency: ~15–30 min (see the consecutive-miss rule below).
3. **Confirming — per-client `/clients/{id}` failures.** `sync-accounts`
   already catches per-client errors without failing the whole run (see its
   existing try/catch). If `GET /clients/{id}` starts returning 403/404 for
   one specific, previously-working client while every other client in the
   same run still succeeds, that is corroborating evidence of departure (as
   opposed to a general outage, which fails broadly).

None of these alone is bulletproof against a one-off API hiccup, so a client
is only ever labelled **departed** once at least one *authoritative* signal
fires (1 or 3), or signal 2 persists for two consecutive `sync-clients` runs
**and** is corroborated by 1 or 3 on the next `sync-accounts` pass. See the
state machine in §5.

## 4. Data model changes

Add to `Client` (`packages/db/src/models/Client.ts`):

| Field | Type | Meaning |
|---|---|---|
| `partnerStatus` | `"active" \| "departed"` (default `"active"`) | the label |
| `partnerStatusReason` | `String \| null` | which signal confirmed it: `"affiliated_false"`, `"missing_from_list"`, `"lookup_failed"` |
| `departedAt` | `Date \| null` | when it flipped to `departed` |
| `missingSince` | `Date \| null` | first tick `sync-clients` didn't see them (internal — powers the consecutive-miss rule; cleared on reappearance) |
| `lastSeenInListAt` | `Date \| null` | last time `sync-clients` saw them, for staleness debugging |

Add to `Account` (`packages/db/src/models/Account.ts`):

| Field | Type | Meaning |
|---|---|---|
| `affiliated` | `Boolean` (default `true`) | Elefin's own per-account flag, straight from `accounts.items[].affiliated` / `GET /accounts/{login}` |

A migration adds these with sane defaults for existing rows (everyone starts
`"active"` / `affiliated: true`, since — per §2 — that is true of the whole
book today).

## 5. Detection pipeline (worker)

**`sync-clients` (every 15 min, unchanged cadence)** — after upserting the
rows the API returned, compute the delta against what's in our DB:

```
knownIds   = Client._id currently in our DB
returnedIds = client_id of every row this run got back from /clients
missingIds  = knownIds - returnedIds
```

- For `missingIds`: if `missingSince` is unset, set it to now (first miss —
  don't do anything else yet). If `missingSince` is already older than one
  `sync-clients` interval (i.e. this is the **second** consecutive miss),
  leave a note for `sync-accounts` to prioritise a confirming check (a
  lightweight `pendingConfirmation: true`-style query is enough — no new
  collection needed, just a query on `missingSince` age).
- For any row that *does* come back and previously had `missingSince` set:
  clear `missingSince` (false alarm — they reappeared).

**`sync-accounts` (every 6h, unchanged cadence)** — for every client, when
mapping `accounts.items[]`:

- Store `affiliated` on each `Account` doc (new field, §4).
- Compute the client's rollup: `departed = every one of their accounts has
  affiliated === false` (conservative — one dissenting account keeps them
  `active`; log a warning if accounts disagree, since that would be
  unexpected and worth a human look).
- If `departed` and `partnerStatus` is still `"active"` → flip it, set
  `departedAt`, `partnerStatusReason = "affiliated_false"`.
- If a specific client's `GET /clients/{id}` call fails with 403/404 in this
  run (already caught, just not acted on today) **and** that client already
  has `missingSince` set from the list-diff above → flip to `departed`,
  `partnerStatusReason = "lookup_failed"`.
- If neither of the above but `missingSince` has been set for **2+
  consecutive `sync-clients` runs** with no reappearance and no contradicting
  `affiliated: true` this run → flip to `departed`,
  `partnerStatusReason = "missing_from_list"` (the weakest of the three
  signals, used only when the other two didn't already resolve it one way or
  the other).
- **Win-back:** if a `"departed"` client reappears in `/clients` (handled in
  `sync-clients`) or their accounts show `affiliated: true` again → flip back
  to `"active"`, clear `departedAt`/`missingSince`, log it (a client
  returning to your code is good news worth knowing about, not just silently
  undoing the flag).

This adds **no new API calls** in the common case — it's pure bookkeeping on
data both jobs already fetch. It only reuses the standard "one client at a
time" style of `sync-accounts`, so it has no impact on its ~5–10 minute
runtime.

## 6. UI changes

- **`/clients` list** — a small pill next to the existing status badge:
  `LEFT` (muted/red) when `partnerStatus === "departed"`; nothing extra shown
  for `active` (keeps the common case visually quiet). New filter option
  "Partner status: With us / Departed / All" (default "With us", so churned
  clients don't clutter the default view — same pattern as `/clients`'
  existing status/funded/activity filters).
- **`/clients/{id}` profile** — a banner (same visual language as the
  existing Elefin-API-issue banner added this week) when departed: *"This
  client is no longer affiliated with your partner code (left
  {departedAt}). Historical data below is unaffected; commission has stopped
  accruing."*
- **Dashboard** — optional: a KPI card "Departed (30d)" next to the existing
  book KPIs, and/or fold into the existing "Needs attention" section via the
  alert in §7 (recommended over a dedicated card — reuses what's already
  built rather than adding another tile).
- **CSV export** (`/api/clients/export`) — add the `partnerStatus` column.

## 7. Alerts integration

Add one new alert type to the existing catalogue (`@elefin/domain`
`ALERT_RULES`, evaluated by `run-alerts.ts` — same mechanism as "gone dormant",
"funded-never-traded", etc., so it gets acknowledge/snooze/watchlist for free):

- **`partner_code_changed`** (severity `warning`) — fires once, the run after
  `partnerStatus` flips to `"departed"`. Title: *"{name} is no longer under
  your referral code."* Auto-resolves (per the existing alert-resolution
  pattern) if the client rejoins.

This means the churn shows up on `/alerts` and the dashboard's "Needs
attention" panel immediately, with no separate notification system to build.

## 8. Edge cases and assumptions still to validate

- **Unverified: what `GET /clients/{id}` actually does for a departed
  client.** Section 3/5 is designed to work whether it degrades to
  `affiliated: false` (ideal) or starts failing (403/404, handled) — but I
  can't be certain until a real departure happens. First real occurrence
  should be spot-checked by hand (`npm run elefin:dump -- --login <their
  login>`, or the new `/api-log` page) to confirm which path fired, and this
  plan adjusted if reality differs.
- **Mixed-affiliation accounts.** If a client's multiple accounts ever
  disagree on `affiliated`, the conservative rule (§5) keeps them `active`
  and just logs it — worth watching the logs after rollout rather than
  guessing the right behaviour up front.
- **PII-masked books.** None of this depends on `clients.pii` — `affiliated`
  is on the account object, not gated behind the PII ability.
- **Cost.** Zero extra steady-state API calls. The only new call is the
  already-existing `GET /clients/{id}` retry behaviour on a specific
  departure — nothing periodic or per-client added.
- **Historical data stays put.** A departed client's trades/funding/PnL
  history is never deleted — only the label changes. Dashboard KPIs
  (book-wide sums) would need a decision (§9) on whether a departed client
  still counts toward "current book" totals.

## 9. Open decisions — need your call

1. **Do dashboard KPIs (Clients, Funded, Net deposits, etc.) exclude departed
   clients going forward, or keep including them for historical
   continuity?** Recommendation: exclude from the *current* KPI cards (so
   "Clients: 277" reads as "clients currently under you"), but never touch
   `book_daily`'s already-recorded history (so past trend charts don't
   retroactively change).
2. **Two-state label (`With us` / `Left`) or three-state, exposing the
   unconfirmed "possibly left, confirming" window too?** Recommendation:
   two-state in the UI — the confirmation window (§5) is an internal
   safeguard against false positives, not something worth showing the team
   before it's certain.
3. **Detection latency** — comfortable with up to ~6h to confirm a departure
   (tied to `SYNC_ACCOUNTS_CRON`), or do you want that job to run more often
   for this book? (Trade-off: `sync-accounts` costs 1 API call per client —
   running it, say, hourly instead of every 6h means ~6,600 calls/day
   instead of ~1,100 for a 277-client book.)
4. **Alert severity/behaviour** — `warning` and auto-resolve on rejoin (as
   drafted), or `critical` since it directly affects revenue?

## 10. Implementation task list

Once approved:

- [ ] Migration: `partnerStatus`/`partnerStatusReason`/`departedAt`/
      `missingSince`/`lastSeenInListAt` on `Client`; `affiliated` on `Account`.
- [ ] `mapAccount()` (`apps/worker/src/jobs/map.ts`): capture `item.affiliated`.
- [ ] `sync-clients.ts`: compute `missingIds`, set/clear `missingSince`.
- [ ] `sync-accounts.ts`: per-client affiliation rollup + status state machine
      (§5), including the win-back path and the 403/404-while-others-succeed
      corroboration.
- [ ] `@elefin/domain`: `partner_code_changed` alert rule; `run-alerts.ts`
      wiring.
- [ ] `apps/web/lib/clients-query.ts` + `clients-data.ts`: `partnerStatus`
      filter + column.
- [ ] `/clients` page: badge + filter dropdown.
- [ ] `/clients/{id}` page: departed banner.
- [ ] `/api/clients/export`: new column.
- [ ] (If §9.1 says exclude) `bookKpis()` / dashboard queries: filter to
      `partnerStatus: "active"` for the current-book KPIs only.
- [ ] Tests: `@elefin/domain` alert-rule unit test; a small fixture test for
      the `sync-clients` missing-id diff logic.
- [ ] README: document the new field + detection mechanism (same section
      style as this week's "Known upstream issue" note).

## 11. Rollout & testing

Since nobody in the current book has actually left yet, there is no real data
to validate against pre-launch. Plan:

1. Ship the `affiliated` capture (`mapAccount`) and the label plumbing first,
   inert (everyone stays `active`, matching reality) — safe to deploy
   immediately, zero visible change.
2. Manually fabricate one test case against a **non-production** login if
   Elefin's sandbox/docs allow simulating a partner-code change; otherwise,
   wait for the first real occurrence and treat it as the validation run —
   spot-check via `/api-log` (§8) that the signal that fired matches what
   this plan assumed, and adjust the state machine if not.
3. Announce the new filter/badge once at least one real transition has been
   observed and confirmed correct.
