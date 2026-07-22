# Desk Bot — Phase 2 Task Breakdown

| | |
|---|---|
| **Version** | 1.0 |
| **Related docs** | [PRD.md](./PRD.md) · [ERD.md](./ERD.md) · [ENGINEERING.md](./ENGINEERING.md) |
| **Last updated** | 2026-07-22 |

Tasks are ordered so that each one builds on completed work — follow the **Depends on** lines for execution order. Task numbers match the session task tracker. Every task ends with acceptance criteria; a task is not done until its **Accept** line passes.

**Sizes:** **S** (≤ ½ day) · **M** (~1 day) · **L** (2–3 days)

**Status legend:** ⬜ not started · 🟨 in progress · ✅ done

---

## Phase M1 — Foundations

Safety and resilience groundwork: schema, secrets, render safety, news resilience. No external integrations yet.

### ✅ Task 1 — DB migrations: schema_version + new tables/columns (M)
**Depends on:** —
- Add a `schema_version` table to `db.js` with ordered, idempotent migrations
- Migration 001: `source`, `sourceRef`/`sourceEmailId` columns on `tasks`, `events`, `portfolio` (DEFAULT `'manual'`); `layoutFingerprint` on `history`
- Migration 002: create `bills`, `mail_accounts`, `allowlist_entries`, `oauth_tokens`, `processed_emails`, `digest_items`, `identity_vault`, `document_passwords`
- Additive only — `ALTER TABLE ADD COLUMN`, never destructive
- **Accept:** a copied Phase 1.5 database upgrades in place on boot with all existing rows intact; a fresh database initializes to the same final schema; booting twice is a no-op.

### ✅ Task 2 — Encrypted vault module + key generation (M)
**Depends on:** 1
- `store/vault.js`: AES-256-GCM with per-value 12-byte IV, stored as `v1:<iv>:<tag>:<ciphertext>`
- `putSecret`/`getSecret` API only — no route or agent ever sees ciphertext or the key
- `vault_check` sentinel row detects a missing/wrong `VAULT_KEY` and fails loudly
- `npm run gen-vault-key` script appends a base64 32-byte key to `.env` if absent
- Unit tests: encrypt/decrypt round-trip, tamper detection, wrong-key detection
- **Accept:** round-trip returns the original value; flipping one ciphertext byte throws; starting with the wrong key against a non-empty vault logs a clear error and disables ingestion features instead of returning garbage.

### ✅ Task 3 — Render-output validator (M)
**Depends on:** —
- `agent/validator.js`: parseable HTML, self-contained (Chart.js CDN allowlist only), no `<form>`/inline `on*=` handlers, dimensions match settings
- Hook into `displayAgent.js`: validation failure → one render retry with failure reasons appended → keep previous display on second failure
- Unit tests with accept/reject HTML fixtures
- **Accept:** a fixture with an inline `onclick` is rejected; a valid weather page passes; when the render agent returns broken HTML twice, `display_cache` still holds the previous display and the cycle logs the failure without crashing.

### ✅ Task 4 — RSS news fallback (S)
**Depends on:** —
- `news/rss.js` with shipped default finance/tech/AI feeds; `RSS_FEEDS` env override
- Normalize RSS items to the exact article shape NewsAPI returns
- `fetchNews.js` falls back transparently on NewsAPI error / 429 / missing key
- **Accept:** with `NEWS_API_KEY` removed, `fetch_news` still returns normalized articles from RSS and the context agent consumes them unchanged; with NewsAPI healthy, RSS is never called.

> **Milestone M1:** bad renders can never reach the screen, secrets have an encrypted home, and news survives quota exhaustion.

---

## Phase M2 — Google plumbing

OAuth foundation shared by Gmail and Calendar, plus the first real sync.

### ✅ Task 5 — Google OAuth + connections routes (L)
**Depends on:** 1, 2
- `google/auth.js`: loopback OAuth flow, scopes `gmail.readonly` + `calendar.readonly`, refresh tokens encrypted per account (`oauth_tokens`), access tokens in memory only, refresh on 401, 3 consecutive failures → account `status:'error'`
- `routes/connections.js`: `GET /api/connections`, `google/start`, `google/callback`, `DELETE /:id?purge=`, allowlist CRUD with `transactional|newsletter` type
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` in `.env`
- **Accept:** completing consent creates a `mail_accounts` row with an encrypted token; `GET /api/connections` never returns token material; disconnect revokes at Google and deletes the token row.

### ✅ Task 6 — Google Calendar sync (M)
**Depends on:** 5
- `google/gcal.js`: pull `now … +7d` events per account on the ingestion cron
- Upsert into `events` with `source:'gcal'`, `sourceRef = eventId`; reconcile deletions by re-listing the window
- Calendar-wins dedup against email-extracted events (title + date ± 1 h)
- **Accept:** a real invite appears in `events` within one ingestion interval; deleting it in Google removes the local row on the next run; re-running sync never duplicates.

### ✅ Task 7 — Connections tab in ManagePanel (M)
**Depends on:** 5
- `frontend/src/api/connections.js` wrapper
- Connections tab: connect/disconnect accounts, status badges, per-account sender/label allowlist editor with `transactional|newsletter` selector
- **Accept:** a user can connect an account, add `noreply@zerodha.com` as `transactional` and a newsletter sender as `newsletter`, see status, and disconnect — all without touching the API directly.

> **Milestone M2:** real calendar invites reach the desk display with zero manual entry.

---

## Phase M3 — Email core

The flagship: mail in, structured facts out, bills on screen.

### ✅ Task 8 — Gmail fetch: allowlist query + historyId sync (M)
**Depends on:** 5
- `google/gmail.js`: compile allowlist → Gmail query (`from:… OR label:…`, always `-in:spam -in:trash`, `newer_than:7d`)
- Incremental sync via per-account `historyId`, full-query fallback on expiry
- Caps: ≤ 50 messages/run, ≤ 10 MB attachment, body truncated to 20k chars; over-cap items skipped with `reason:'cap'`
- **Accept:** only allowlisted-sender messages are ever fetched (verified against a mock mailbox containing spam and off-list mail); a second run with no new mail fetches nothing.

### ✅ Task 9 — Prefilter + extract agent + `extract` model role (L)
**Depends on:** 8
- `ingest/prefilter.js`: allowlist defense-in-depth, `newsletter` routing, `List-Unsubscribe` → discard `'marketing'`, thread headers → discard `'thread'`
- `agent/extractAgent.js`: transactional + digest JSON modes per ENGINEERING §5.2, `confidence < 0.5` → skip, omit-rather-than-guess prompt rule, one JSON-fix retry
- `modelProvider.js` gains the `extract` role with `EXTRACT_LLM_*` env overrides
- Golden fixture corpus under `test/fixtures/emails/` as the extraction regression suite
- **Accept:** every golden fixture classifies and extracts to its expected JSON; a marketing email from a transactional sender is discarded before any LLM call; malformed model output is retried once then skipped with `reason:'extract-failed'`.

### ✅ Task 10 — Ingestion pipeline + scheduler + store writers + bills (L)
**Depends on:** 9
- `ingest/pipeline.js`: fetch → prefilter → extract → store per account; every message recorded in `processed_emails` with outcome + reason; failures skip-and-log, never block
- `ingestScheduler.js`: second cron on `INGEST_INTERVAL_MINUTES` (default 60), single-flight guard
- Dedup-safe store writers: upsert on `(sourceEmailId, factType, naturalKey)`; all writes tagged `source:'email'`
- `routes/bills.js` (`GET`, `PATCH` mark-paid) and `routes/ingest.js` (activity, `POST /run` manual trigger, `DELETE /facts/:ref` reject)
- **Accept:** processing the same fixture mailbox twice produces identical stores (zero duplicates); a rejected fact never reappears on re-run; a mid-pipeline crash on one message still processes the rest and the display cycle is unaffected.

### ✅ Task 11 — Context agent bills/digest tools + Activity tab (M)
**Depends on:** 10
- `contextAgent.js`: new `get_bills()` (due/unknown, next 14 days) and `get_digest()` tools; priority ladder gains `BILL — due ≤ 3 days → MEDIUM`; `select_content` enum + `bill`, `inbox_digest`
- Frontend: `api/ingest.js` + `api/bills.js` wrappers; Activity/Review tab (recent runs, skipped items with reasons, one-tap fact reject)
- **Accept:** with a bill due tomorrow seeded and no urgent reminders, a display cycle selects `bill` and renders it; the Activity tab shows the source email for the bill and rejecting the fact removes it from the display on the next cycle.

> **Milestone M3:** plain notification emails become tasks/events/bills on the display with zero duplicates and a full audit trail.

---

## Phase M4 — Locked documents & newsletters

Unlock the richest data source; put inbox signal in the ambient slot.

### 🟨 Task 12 — PDF attachments + password resolution chain (L)
**Depends on:** 2, 10
- `ingest/attachments.js`: PDF text extraction; image-only PDFs skipped with `reason:'unreadable'` (OCR is Phase 3)
- `ingest/passwords.js` chain: email-stated formula (via `passwordHint`) → known-sender formula table → stored per-sender password → user prompt queue; ≤ 8 candidates total, never brute-force; successful passwords persisted encrypted to `document_passwords`
- Locked queue: `GET /api/ingest/locked`, `POST /locked/:emailId/password` (store + requeue)
- Vault tab: masked identity fields (name, DOB, mobile, PAN, account numbers), edit, "delete all vault data"
- **Accept:** a fixture contract-note PDF whose email states "password is your PAN + DOB" opens automatically using vault fields; an unresolvable PDF appears in the locked queue, and entering its password once processes it and every future document from that sender.

### ⬜ Task 13 — Newsletter digest path (M)
**Depends on:** 10
- Newsletter branch in the pipeline: strip HTML → cap 8k chars → extractAgent digest mode → 2–4 headlines into `digest_items`
- 5-day expiry with purge on each ingestion run
- `inbox_digest` content type flows through `get_digest()` to the display's ambient band
- **Accept:** a fixture product newsletter yields headline items tagged with sender + date; expired items are purged and never rendered; digest content only appears when nothing higher-priority is eligible.

> **Milestone M4:** password-protected statements parse themselves, and newsletters surface as "From your inbox" ambient cards.

---

## Phase M5 — Rendering economy

Cut tokens without repeating a single layout.

### ⬜ Task 14 — Composable UI primitives + layout fingerprints + token instrumentation (L)
**Depends on:** —
- `agent/primitives/`: snippet library (statCard, listRow, timeline, chartMacro, progressBar, badge, bigNumber, weatherStrip), each carrying a `data-prim` attribute; `index.js` builds the prompt block
- Render prompt rework: primitives as vocabulary not cage — compose any subset, custom HTML allowed, vary layout/arrangement/accent every cycle
- `layoutFingerprint = sha1(sorted primitive names + grid signature)` stored on `history`; last 5 fingerprints fed to the prompt as "avoid these"
- Record AI SDK token `usage` per cycle; 100-cycle A/B script vs. pre-primitives baseline
- **Accept:** 100-cycle A/B shows ≥ 40% reduction in render output tokens; a 10-cycle loop with a stubbed model produces 10 distinct fingerprints; validator (Task 3) still passes every primitive-composed output.

> **Milestone M5:** the display costs 40% less to paint and still never repeats itself.

---

## Progress

| Phase | Tasks | Done |
|---|---|---|
| M1 — Foundations | 1–4 | 4/4 |
| M2 — Google plumbing | 5–7 | 3/3 |
| M3 — Email core | 8–11 | 4/4 |
| M4 — Locked docs & newsletters | 12–13 | 0/2 |
| M5 — Rendering economy | 14 | 0/1 |
| **Total** | **14** | **11/14** |
