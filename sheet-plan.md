# Sheet import, cross-broker linking & tags — plan

_Drafted: 2026-09-15 · updated 2026-09-15 (§9: broker-scoped `/elefin` and
`/xm` route trees + sidebar, replacing the original `/clients` +
`/traders` split) — for review, not yet implemented._

## Table of contents

1. [What you asked for](#1-what-you-asked-for)
2. [What's actually in the two files you shared](#2-whats-actually-in-the-two-files-you-shared)
3. [The real challenge: data quality](#3-the-real-challenge-data-quality)
4. [Proposed architecture](#4-proposed-architecture)
5. [Matching & linking rules](#5-matching--linking-rules)
6. [Tagging](#6-tagging)
7. [Upload pipeline (UI + flow)](#7-upload-pipeline-ui--flow)
8. [Data model — exact fields](#8-data-model--exact-fields)
9. [Broker-scoped routes & sidebar](#9-broker-scoped-routes--sidebar)
10. [Open decisions — need your call](#10-open-decisions--need-your-call)
11. [Implementation task list (phased)](#11-implementation-task-list-phased)
12. [Rollout & testing](#12-rollout--testing)

---

## 1. What you asked for

- Upload an Excel/CSV file → extract each trader/client → save to the DB.
- If a row's broker is **Elefin**, link it to the client we already have (match
  by MT5 login, or by email).
- If it's **XM** (or another broker), also upload their trade-export sheet and
  save that data, again trying to map by MT5 login or email.
- Add **custom tags** to each trader (starting list: `5x`, `Indicator`,
  `Propfirm`, `Gold`, `BTC`) and be able to filter/search by tag.

## 2. What's actually in the two files you shared

I read both files in full before writing this plan — the shapes are quite
different from each other, which drives most of the design below.

### `traderTrades.csv` — an XM trade-history export

- **19,650 rows, 252 distinct MT4/MT5 logins.** This is a *trade-level*
  export (one row per closed trade) — the XM equivalent of our own `trades`
  collection — **not** a client roster. There is no name, email, or client id
  anywhere in this file — only the MT5 login.
- Columns: `Trade #, MT4/MT5 ID, Account Type, Account Currency, Account
  Brand, Campaign, Open Time, Close Time, Trade Category, Trade Type,
  Instrument, Instrument Group, Lots, Open Price, Close Price, Total Comm.,
  Affiliate Comm.`
- `Account Brand` is `XM Global` for every row.
- `Campaign` is one of 3 fixed labels (`custom partner code`, `Default Trader
  Campaign`, `StandardAcc`) — an XM affiliate-campaign name, not a per-client
  code.
- Instruments include real GOLD trades (`GOLD`, `GOLD.i#`, `GOLD24-7.i#`,
  `GOLDmicro`, `GOLD#` — 5 variants) and BTC trades (`BTCUSD`, `BTCUSD#`) —
  directly relevant to the `Gold`/`BTC` tags.
- **Parsing gotchas, confirmed by hand:** `Lots`/`Open Price`/`Close Price`/
  the two commission columns are quoted strings with thousand-separator
  commas (e.g. `"4,300.85"`) — a naive comma-split (or `awk -F','`) silently
  misaligns columns; needs a real CSV parser. Dates are `DD/MM/YYYY
  HH:MM:SS` (unambiguous — day values above 12 appear, e.g. `14/09/2026`).
  One trailing row is entirely blank and should just be skipped.

### `5x-data.xlsx` — a lead/roster sheet for a group called "5x"

- **517 rows, 1 sheet.** Columns: `Name, Number, Email, Trading Capital ($),
  Broker/Prop Firm, User Id, Discord Id, Status, Current Remarks, Volume,
  Additional Remark.`
- This is a **person-level CRM/lead sheet** (name, phone, email, which broker
  they trade with, their MT5 login when known, onboarding status) — the
  opposite shape from the trades file. `Broker/Prop Firm` is exactly the
  column that tells us, per row, whether someone is Elefin, XM, or something
  else — there is no single "this whole file is broker X" assumption to make.
- **`Broker/Prop Firm` is free text and inconsistent:** `Elefin` (67),
  `elefin` (21), `ELEFIN` (2), `elffin`/`ellfin` (1 each, typos) — 91 Elefin
  variants total. `XM` (46), `Xm` (26), `xm` (20), `Xm360` (1) — 93 XM
  variants. Plus ~40 other one-off values (`Coinswitch`, `Vantage`,
  `Exness`, `Delta Exchange`, `funded squad`, `Fortress / XM / Zuperior`,
  `I only trade propfoms`, …) and 276 blank rows (mostly `Status =
  "Not Interested"` leads who never named a broker).
- **`User Id` (the MT5 login column) is only populated for 119/517 rows**,
  and is itself dirty: real numeric logins (`400951024`, `351957210`, …,
  mostly 9 digits), but also the literal strings `"NA"`/`"Na"`, one row where
  someone typed `"Elefin"` *into the User Id cell*, prefixed forms like
  `"XM - 322240538"` and `"XM- 324271887"` (inconsistent spacing/dash), and
  one implausibly short value (`12915`, 5 digits, vs. the ~9-digit norm —
  flagged as suspect, not trusted blindly).
- **`Trading Capital ($)` mixes numbers and shorthand text** (`170`, `700`,
  but also `"25k"`).
- **`Status`** is a lead-funnel field with heavy case/spelling drift:
  `Not Interested` (271, the majority), blank (107), `Verified` (77),
  `User(s) under Referral` (29 across 3 spelling variants), `Duplicate Lead`
  (12), `Not Connected` (12 across 2 variants), plus a few singletons.
- **`Volume`** is misleadingly named — it actually holds `Active`/`Inactive`
  (46 / 17), not a number.
- **Email is present for 516/517 rows** — the most reliable identity field —
  but **64 emails appear more than once in this same file** (2–3× each): the
  sheet itself has internal duplicates before we even touch our own DB.

**Bottom line:** the two files only share one join key — **MT5 login** — and
neither file alone has both identity (name/email) and trades. `5x-data.xlsx`
rows with `Broker = XM` plus `traderTrades.csv` can be joined by MT5 login to
reconstruct an XM "client + trade history" view, the same way Elefin's
`Client` + `Account` + `Trade` fit together today.

## 3. The real challenge: data quality

This is a hand-maintained lead sheet, not a system export — it will never be
100% clean, and I don't think we should pretend otherwise or silently
"fix" ambiguous rows. The plan below is built around **never guessing
silently**: normalize what's confidently normalizable, and surface everything
else for a human decision rather than mis-linking someone to the wrong
client or fabricating an MT5 login out of a typo.

Concretely, the import has to:
- Normalize broker free text (case/typo tolerant) without false-matching
  `"Fortress / XM / Zuperior"` as a clean XM row.
- Extract a plausible MT5 login from a dirty cell (strip an `"XM -"` /
  `"XM-"` prefix, reject `"NA"`/non-numeric junk, flag implausible lengths)
  without ever inventing a login that isn't really there.
- Parse `"25k"`-style capital shorthand, falling back to storing the raw text
  when it can't confidently parse a number — never drop or corrupt it.
- Treat the 64 in-file duplicate emails as *the same person* (merge, not
  duplicate) both within one upload and across repeated uploads of an
  updated version of the same sheet.

## 4. Proposed architecture

### 4.1 New collections, not new fields on `Client`/`Account`/`Trade`

I recommend keeping this **entirely separate** from the live-synced Elefin
collections, joined by an explicit link field, rather than writing uploaded
rows into `clients`/`accounts`/`trades` directly:

- `Client._id` is Elefin's own numeric `client_id` — there's no equivalent
  ID for an XM-only person, so we'd have to invent one anyway.
- Every book-wide number this CRM already shows (dashboard KPIs, alerts,
  `book_daily` snapshots, the partner-status work from last week) assumes
  every `Client` document came from the live Elefin API. Mixing in
  hand-typed spreadsheet rows would mean auditing all of that code to make
  sure a synthetic record can't silently skew a real KPI — high effort, high
  risk, for data we already know is messy.
- The worker's sync jobs `upsert` by Elefin's own IDs on a schedule; manual
  uploads are a completely different cadence and trust level and deserve
  their own lane.

So: two new collections, cross-linked to `Client`/`Account` when a confident
match exists.

- **`ExternalTrader`** — one document per uploaded *person* (from a
  roster-style file like `5x-data.xlsx`). Holds identity, the raw
  broker/MT5/capital text alongside best-effort parsed versions, tags, and
  `linkedClientId` (Elefin's `Client._id`) when matched.
- **`ExternalTrade`** — one document per uploaded *trade* (from a
  trade-export file like `traderTrades.csv`), keyed by `login`, linked to an
  `ExternalTrader` when one exists for that login.

A person who *is* matched to a real `Client` doesn't need a parallel record
— they already have a profile on `/elefin/clients/{id}` (see §9). So `ExternalTrader` really
only carries the people we *can't* fully resolve into the live Elefin data
(XM traders, unmatched Elefin leads, other brokers) — see §5.

### 4.2 A pluggable broker/format registry, not one hardcoded parser

`traderTrades.csv`'s column layout is XM's own fixed export format; a future
Exness or Vantage export (both appear in the roster's "other brokers" list)
would have a different one. I'd register each trade-file format under a
`broker` key (`xm` today) with its own column mapping, so adding another
broker later is "write one new mapping module," not a rewrite. Same idea for
the number of *roster* templates we support (see open decision in §10 about
free-form column mapping vs. today's fixed template).

## 5. Matching & linking rules

For every roster row (from `5x-data.xlsx` or a future roster upload):

1. **Normalize the broker text** (trim, lowercase, strip punctuation) against
   a small alias table:
   - `elefin`, `elfin`, `elffin`, `ellfin` → **`elefin`**
   - `xm`, `xm global`, `xm360` → **`xm`**
   - anything else non-blank → kept verbatim as `brokerRaw`, normalized
     bucket `"other"` (a multi-broker cell like `"Delta and xm"` also
     matches `xm` as a *secondary* signal, but is bucketed `"other"` overall
     since it's not unambiguously one broker)
   - blank → `"unknown"`
2. **Extract a candidate MT5 login** from `User Id`: strip a leading
   `XM\s*-\s*` (or similar) prefix, keep the result only if it's all digits
   and 5–10 digits long; otherwise treat as absent and record the original
   text for manual review (covers `"NA"`, `"Elefin"`, and the suspiciously
   short `12915` case — flagged, not silently trusted).
3. **If normalized broker = `elefin`:**
   - Try the candidate MT5 login against `Account._id` first. A hit gives
     `Account.clientId` → **linked** (`matchMethod: "mt5_login"`).
   - Else try the row's email (lowercased) against `Client.email`. A hit →
     **linked** (`matchMethod: "email"`). Note: some clients' emails are
     stored masked (`emailMasked: true`, no `clients.pii` grant) — those
     can't be matched this way, and the row is reported as *"Elefin per the
     sheet, but not found — check spelling or PII access"* rather than
     silently dropped.
   - No match either way → still saved (as `ExternalTrader`,
     `brokerNormalized: "elefin"`, `linkedClientId: null`) so the lead isn't
     lost, flagged for manual review.
4. **If normalized broker = `xm` (or `other`/`unknown`):** saved as
   `ExternalTrader` unlinked to any `Client` (there's no live Elefin
   record for them). If a matching `ExternalTrade` login exists (from a
   trade-export upload), it's linked by login automatically.
5. **De-duplication, in-file and across uploads:** the dedupe key is the
   parsed MT5 login when present, else the lowercased email. Re-uploading
   the same (or an updated) sheet **updates** the existing `ExternalTrader`
   by that key rather than creating a duplicate; the 64 same-file duplicate
   emails collapse to one record (last row in the file wins for field
   values, with a note "N source rows merged").

Every row's outcome is one of: **linked to an existing client**, **saved as
a new/updated external trader**, or **flagged for manual review** (ambiguous
broker + no login/email match, or a suspicious login) — never a silent
guess.

## 6. Tagging

- `5x`, `Indicator`, `Propfirm`, `Gold`, `BTC` to start, but I'd make the tag
  *catalogue* editable from Settings (same pattern already used for alert
  thresholds and monthly targets — an `AppConfig` document — rather than a
  hardcoded list), since you said "a few custom tags," implying this list
  will grow.
- Tags live on **whichever record is the person's primary one**: if a roster
  row resolves to a real `Client`, the tag goes on `Client.tags` directly (so
  it's filterable right there on the `/elefin/clients` page you already use
  every day); otherwise it goes on `ExternalTrader.tags`.
- Every row imported from `5x-data.xlsx` gets the `5x` tag automatically
  (whichever record it lands on); `Gold`/`BTC` could additionally be
  **auto-suggested** (not auto-applied) from `traderTrades.csv` — a trader
  with any Gold-family or BTC instrument in their trade history gets the tag
  pre-ticked in the review step, but a human still confirms it. `Indicator`
  and `Propfirm` have no signal in either file, so those stay fully manual.
- Filtering: a tag multi-select on `/elefin/clients` (alongside the existing
  status/funded/activity filters) and on `/xm/clients` (§9), plus the
  existing global search (`/` or ⌘K) extended to match on tag name.

## 7. Upload pipeline (UI + flow)

New **owner-only** admin page, `/imports`:

1. **Choose an import type** — "Trader roster" (person rows, e.g.
   `5x-data.xlsx`) or "Trade history — XM" (trade rows, e.g.
   `traderTrades.csv`). Explicit choice rather than auto-detecting from file
   content, since the two shapes need completely different handling and a
   wrong guess would be a bad way to find out.
2. **Upload the file** (`.xlsx` or `.csv`, roster or trade-history per the
   chosen type).
3. **Preview, not commit.** The server parses it and returns a report before
   touching the database: total rows; how many would link to an existing
   Elefin client (and to whom); how many would create/update an
   `ExternalTrader`/`ExternalTrade`; how many are flagged for review, with
   the specific reason (bad login, ambiguous broker, masked email, duplicate
   email within the file); default tags about to be applied. Flagged rows
   are editable inline (fix a login, pick the right client from a search box,
   or exclude the row) before committing.
4. **Commit.** Only after this review does anything get written, in one
   transaction-like batch. An `ImportRun` record (mirrors `SyncRun` for the
   worker) keeps who uploaded what, when, and the outcome counts, so a bad
   upload can be traced back later.
5. **Re-upload is safe.** Uploading a newer version of the same sheet later
   updates existing linked records via the dedupe key from §5.4 rather than
   duplicating them.

## 8. Data model — exact fields

**`ExternalTrader`** (new collection `external_traders`):

| Field | Type | Notes |
|---|---|---|
| `_id` | ObjectId | auto |
| `name` | String | |
| `email` | String, lower-cased, indexed | primary dedupe key when no login |
| `phone` | String | normalized to a string (never a number — avoids Excel leading-zero loss) |
| `brokerRaw` | String | exactly what was in the sheet |
| `brokerNormalized` | `"elefin" \| "xm" \| "other" \| "unknown"` | |
| `mt5Login` | String, indexed | parsed candidate; null if unparseable |
| `mt5LoginRaw` | String | original cell text, for audit when parsing rejected it |
| `discordId` | String | |
| `status` | String | raw, plus a normalized lowercase copy for filtering |
| `tradingCapital` | Number, nullable | parsed |
| `tradingCapitalRaw` | String | original text (`"25k"` etc.) |
| `remarks` | String | |
| `tags` | `[String]`, indexed | |
| `linkedClientId` | Number, nullable, indexed | Elefin `Client._id` |
| `matchMethod` | `"mt5_login" \| "email" \| "manual" \| null` | |
| `needsReview` | Boolean | |
| `reviewReason` | String, nullable | |
| `sourceImportId` | ObjectId ref `ImportRun` | which upload last touched this row |
| `raw` | Mixed, `select:false` | the original row, like every other model in this repo |
| `createdAt`/`updatedAt` | Date | |

**`ExternalTrade`** (new collection `external_trades`):

| Field | Type | Notes |
|---|---|---|
| `_id` | String | `"<broker>:<their trade id>"`, e.g. `"xm:1237536005"` — stable, re-upload-safe |
| `broker` | String | `"xm"` today |
| `login` | String, indexed | |
| `externalTraderId` | ObjectId, nullable | linked `ExternalTrader` by login |
| `symbol`, `side`, `volumeLots`, `openPrice`, `closePrice`, `openAt`, `closeAt`, `commission`, `affiliateCommission` | mirrors `Trade`'s shape where it makes sense | |
| `accountType`, `accountCurrency`, `campaign` | String | broker-specific extras |
| `raw` | Mixed, `select:false` | |

**`Client`** (existing collection, additive): `tags: [String]`, indexed.

**`AppConfig`** (existing collection, new doc): `_id: "tags"`, `data: { catalogue: string[] }`.

**`ImportRun`** (new collection, mirrors `SyncRun`): who, when, file name,
import type, row/matched/created/flagged counts, status.

## 9. Broker-scoped routes & sidebar

**Updated per your latest message — this replaces the first draft's
"`/clients` stays as-is, unlinked traders get their own `/traders` page"
default.** Instead, each broker gets its own URL prefix and its own sidebar
group, so the app reads as "Elefin's book" and "XM's book" side by side, with
a shared Admin group underneath for the cross-broker/operational pages:

```
ELEFIN
  Dashboard        /elefin/dashboard        (today's /)
  Clients          /elefin/clients          (today's /clients)
  Analytics        /elefin/analytics
  Commission       /elefin/commission
  Funding          /elefin/funding
  Positions        /elefin/positions
  Referral codes   /elefin/referral-codes
  Alerts           /elefin/alerts

XM
  Dashboard        /xm/dashboard            (new)
  Clients          /xm/clients              (new)

ADMIN
  Imports          /imports                 (new, cross-broker)
  Sync status      /elefin/sync             (today's /sync)
  API log          /elefin/api-log          (today's /api-log)
  Settings         /settings                (unchanged — users, tag catalogue, both brokers)
```

- **Every existing Elefin page moves under `/elefin`** — `/clients/{id}` →
  `/elefin/clients/{id}`, `/accounts/{login}/history` →
  `/elefin/accounts/{login}/history`, and so on. `app-nav.tsx` already
  groups items by a `group` label (used for today's "Admin" section) — this
  extends the same mechanism to "Elefin" and "XM" groups instead of one flat
  list.
- **New XM section**, backed by §8's `ExternalTrader`/`ExternalTrade`
  collections: `/xm/dashboard` is a real aggregate view, not just a client
  count — the trade file carries `Total Comm.`/`Affiliate Comm.` per trade,
  so total commission/lots/trades-this-book are all computable the same way
  the Elefin dashboard's KPIs are. `/xm/clients` lists every
  `ExternalTrader` with `brokerNormalized: "xm"`; `/xm/clients/{id}` is
  their profile — identity from the roster, trade history/stats from
  `ExternalTrade`, the same tag UI as the Elefin profile.
- **`/imports` and `/settings` stay unprefixed** — uploads can be either
  kind, and the tag catalogue and user list apply across both sections.
- A person who *is* linked to a real Elefin `Client` still only has one
  profile, at `/elefin/clients/{id}` — `/xm/clients` isn't "unlinked traders
  only," it's "everyone we've imported who trades XM," so a linked person's
  row still appears there too, with a badge linking through to their Elefin
  profile, rather than maintaining two separate profile pages for one
  person.

**Three things I need your call on to lock this in** (folded into §10 as
decisions 4a–4c): singular `/client` (as you sketched) vs. the existing
plural `/clients`; whether *all* of today's Elefin pages move under
`/elefin` or just dashboard + clients; and whether old URLs
(`/`, `/clients`, …) get a redirect to their new home or just stop working.

**Deferred (not in this round unless you want it now):** a full XM
trading-history/stats page mirroring `/elefin/accounts/{login}/history` for
`ExternalTrade` data — the trade file clearly supports it (lots, prices,
commission, open/close times are all there), but it's a second page's worth
of work on top of the import+tagging ask. I'd rather ship linking/tagging
first and come back to this if you want XM trading stats inside the CRM too.

## 10. Open decisions — need your call

1. **Review-before-commit, or import-then-flag?** I've recommended a preview
   step that blocks nothing from being written until you confirm it (safer,
   given how messy the roster sheet is) — the alternative is "import
   everything automatically, list the flagged rows afterward for cleanup."
   The second is faster to use but risks a bad row (e.g. a mistyped MT5
   login) getting linked to the wrong client before anyone notices.
2. **Column mapping: hardcode today's two templates, or build a generic
   mapper?** Hardcoding `5x-data.xlsx`'s exact 11 columns and
   `traderTrades.csv`'s exact 17 columns is faster to ship. A generic
   "match my columns to your fields, let me adjust" step is more work now
   but means any *future* roster/trade sheet (a different community, a
   different broker's export) doesn't need a code change to import. I'd
   default to hardcoding the two known templates first and generalize later
   if a third sheet shape actually shows up — say if you'd rather build the
   general version now.
3. **Auto-tag suggestions from trade data (Gold/BTC)** — pre-tick, but still
   require confirmation (as drafted in §6), or fully automatic with no human
   step?
4. ~~`/traders` as its own page vs. folding into `/clients`~~ — **settled by
   your last message**: separate `/elefin/*` and `/xm/*` route trees instead
   of either option (§9). Three follow-on details from that, still open:
   - **4a. Singular `/client` (as you sketched) vs. the app's existing
     plural `/clients`.** Renaming to singular touches the route folder, the
     nav label, and every internal link like `href="/clients/${id}"` across
     roughly 10 files. I'd default to keeping the existing plural
     (`/elefin/clients`) under the new prefix to minimize that mechanical
     rename — say so if you specifically want it singular.
   - **4b. Do *all* of today's Elefin pages move under `/elefin/*`**
     (analytics, commission, funding, positions, referral-codes, alerts,
     sync, api-log — my default, for one consistent "everything Elefin
     lives under `/elefin`" rule), **or only dashboard + clients** as
     literally listed in your sketch, leaving the rest where they are?
   - **4c. Redirects from the old URLs** (`/` → `/elefin/dashboard`,
     `/clients` → `/elefin/clients`, …)? For a small internal team I'd
     default to skipping this (cheap to just re-bookmark) rather than build
     a redirect map — say so if you'd rather old links keep working.
5. **Who can upload?** I've assumed owner-only (matches every other
   data-mutating admin action in this app) — confirm, or open it to
   analysts too?
6. **XM trading-history page (§9's deferred item)** — worth doing in this
   same round, or later?

## 11. Implementation task list (phased)

**Phase 1 — import, link, tag, filter (the core ask):**

- [ ] Add the `xlsx` package (reads `.xlsx` and `.csv` alike) as a
      dependency.
- [ ] Migration + models: `ExternalTrader`, `ExternalTrade`, `ImportRun`;
      `Client.tags` field + index; seed `AppConfig("tags")` with the initial
      5 tags.
- [ ] Parsing modules: `parseRosterUpload()` (today's `5x-data.xlsx`
      template) and `parseXmTradesUpload()` (today's `traderTrades.csv`
      template) — column mapping, broker normalization, MT5-login
      extraction, capital-shorthand parsing, date parsing (`DD/MM/YYYY`).
- [ ] Matching engine (§5): MT5-login-first, email-fallback, against
      `Account`/`Client`; dedupe-key resolution against existing
      `ExternalTrader`s.
- [ ] Routing restructure (§9): move existing Elefin pages under `/elefin/*`
      (scope per decision 4b), update every internal `Link`/`redirect` that
      points at the old paths, rewrite `app-nav.tsx` into Elefin/XM/Admin
      groups.
- [ ] New `/xm/dashboard` (aggregate KPIs from `ExternalTrade`) and
      `/xm/clients` + `/xm/clients/{id}` (roster identity + trade
      history/stats from `ExternalTrade`).
- [ ] `/imports` page: upload, preview report (matched / created / flagged,
      with reasons and inline row fixes), commit action, `ImportRun` history.
- [ ] Tag catalogue in Settings (add/remove available tags).
- [ ] `/elefin/clients`: tag filter + column + CSV export column;
      add/remove tags on `/elefin/clients/{id}`.
- [ ] Global search extended to `ExternalTrader`.
- [ ] Tests: broker-normalization and MT5-login-extraction unit tests
      against the actual messy values found in `5x-data.xlsx` (the `"XM -
      322240538"`, `"NA"`, `"Elefin"`-in-the-login-cell, `12915` cases from
      §2/§3), and a dedupe-by-email fixture test.

**Phase 2 — deferred, only if wanted:**

- [ ] Generic column-mapper UI for future roster/trade sheets (open decision 2).
- [ ] Full XM trading-history/stats page (open decision 6).
- [ ] Auto-tag-and-apply from trade instruments without a confirm step
      (open decision 3, if you'd rather skip the manual tick).
- [ ] Additional broker trade-export parsers (Exness, Vantage, … — seen as
      "other" brokers in the roster) if you get exports for them.
- [ ] Merge/flag duplicate `ExternalTrader`s discovered *after* import (e.g.
      the same person entered under two different emails).

## 12. Rollout & testing

1. Ship against a copy of your two real files first (not production data) —
   run the parser + matcher in isolation and print the same kind of report
   the `/imports` preview will show, so we can sanity-check the counts
   (expect: ~90 Elefin-flavoured rows, ~93 XM-flavoured rows, ~40 other, 276
   blank/no-broker; 252 distinct XM logins across 19,650 trades) before any
   UI exists.
2. Dry-run the Elefin-side matching against the live `Client`/`Account`
   collections (read-only) to see how many of the ~90 Elefin rows actually
   resolve to a real client today, and eyeball a sample of the "flagged for
   review" rows to confirm the reasons make sense.
3. Only then build the `/imports` UI on top of an already-verified parser +
   matcher, and do the first real commit through the review step by hand.
