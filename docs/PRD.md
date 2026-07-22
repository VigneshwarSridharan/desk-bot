# Desk Bot — Product Requirements Document (PRD)

| | |
|---|---|
| **Product** | Desk Bot — Ambient AI Desk Display |
| **Version** | 2.0 (Phase 2 planning) |
| **Status** | Draft for review |
| **Last updated** | 2026-07-22 |
| **Owner** | Vigneshwar Sridharan |

---

## 1. Overview

Desk Bot is a 24/7 always-on ambient AI assistant delivered as a PWA on a dedicated Android device kept on the user's desk. The screen is never idle and never static: on every cycle (default 10 minutes), an AI agent reasons about what is most relevant *right now* — an urgent reminder, an upcoming meeting, a portfolio move, breaking news, or the weather — fetches the data it needs, and paints a brand-new full-screen UI as raw HTML.

**Core thesis: the AI is the app.** There are no fixed screens or templates. The interface is regenerated fresh each cycle, so the display is always contextual, always current, and never boring.

### 1.1 What exists today (Phase 1 + 1.5 — shipped and verified)

- React + Vite PWA shell with screen wake lock, fullscreen manifest, and offline fallback clock.
- Node.js/Express backend with SQLite persistence (`node:sqlite`).
- Two-phase agentic loop on the Vercel AI SDK:
  - **Context Agent** — calls tools (reminders, events, tasks, portfolio, news, weather) and selects the content type via priority rules.
  - **Render Agent** — generates a complete, self-contained dark-theme HTML document sized to the device screen.
- Server-side cron scheduling; frontend polls `/api/latest` and crossfades the new display into an iframe.
- Pluggable LLM layer: Claude, OpenAI, OpenRouter, Z.ai, Google, or any OpenAI-compatible endpoint (Ollama, Groq, etc.), configurable per agent role via `.env`.
- Admin panel (slide-up) for portfolio, reminders, events, tasks, and settings.
- Cycle history with no-repeat logic (never show the same content type as the last 2 cycles).
- Rate-limit retry with backoff; single-flight guard so cycles never overlap.

### 1.2 What Phase 2 adds (this PRD)

Phase 2 replaces the original "integrate N third-party APIs" plan with a single high-leverage integration — **the user's email inbox** — plus calendar sync, resilient news, and a token-efficient rendering system that preserves UI variety.

---

## 2. Problem statement

1. **Manual data entry defeats ambience.** Today the user must hand-enter portfolio holdings, tasks, and events. An ambient assistant should learn these from the information streams the user already has.
2. **Per-service integrations don't scale.** Brokers (Zerodha, Groww, Angel One), task tools (Linear, Jira), billers, and banks each need bespoke APIs, auth, and maintenance. But nearly all of them already push their data to one place: **email** — order confirmations, contract notes, statements, invites, bills, renewal notices.
3. **Raw HTML generation is token-expensive.** Generating every pixel of boilerplate CSS from scratch each cycle costs tokens and money. Naïve fixes (fixed templates) would destroy the product's core promise of a dynamic, never-repeating UI.
4. **Sensitive documents are locked.** Financial emails commonly carry password-protected PDFs (statements, contract notes). Without a password-resolution strategy, the richest data source stays unreadable.

---

## 3. Goals and non-goals

### 3.1 Goals

| # | Goal | Measure |
|---|------|---------|
| G1 | Eliminate manual data entry for events, tasks, transactions, and bills by ingesting them from email and calendar | ≥ 80% of displayable items originate from ingestion, not manual entry |
| G2 | Keep every rendered screen visually distinct from recent ones | No two consecutive cycles produce near-identical layouts |
| G3 | Reduce render-phase token usage without sacrificing variety | ≥ 40% reduction in render-agent output tokens vs. Phase 1.5 baseline |
| G4 | Read password-protected attachments automatically wherever possible | ≥ 90% of protected PDFs from configured senders opened without user intervention |
| G5 | Never let ingestion or extraction failures degrade the display | Display cycle success rate ≥ 99%; ingestion failures are skipped and logged |
| G6 | Treat identity data (DOB, PAN, mobile, account numbers) and document passwords as first-class secrets | All such fields encrypted at rest; zero secrets in plaintext DB columns or git |

### 3.2 Non-goals (Phase 2)

- **No direct broker / task-tool APIs.** Linear sync, Jira sync, and broker APIs (Zerodha/Groww/Angel One) are explicitly dropped — email ingestion supersedes them.
- **No additional LLM providers** (Gemini as a dedicated provider is dropped; it remains reachable via the existing pluggable layer if needed).
- **No two-way actions.** Desk Bot reads email and calendar; it does not send email, accept invites, or pay bills.
- **No multi-user / multi-device support.** One user, one dedicated device.
- **No password cracking.** If a document password cannot be derived from known formulas or stored entries, we ask the user — we never brute-force.

---

## 4. Users and context

**Primary persona:** A working professional (software engineer / investor) in India who keeps a dedicated Android device on their desk. They receive broker contract notes, bank statements, credit-card bills, meeting invites, and delivery notifications by email. They glance at the desk display dozens of times a day and want it to surface the *one thing that matters most right now* without being asked.

**Usage context:** The device is always on, always plugged in, mounted or propped on the desk. Interaction is almost entirely passive (glancing); active interaction is limited to the slide-up admin panel for occasional configuration.

---

## 5. Product principles

1. **Ambient first.** The display must always show something useful. Any subsystem failure degrades to a less-informed display, never a broken one.
2. **The AI decides.** Priority rules guide, but the agent reasons about context. No hardcoded "weather at 8am" rules.
3. **Fresh every cycle.** Variety is a feature. Composition may reuse primitives; the composed result must not repeat.
4. **One integration, many sources.** Prefer reading the user's existing streams (email, calendar) over adding per-service APIs.
5. **Secrets are sacred.** Identity data and passwords are encrypted at rest, scoped minimally, and never leave the backend.
6. **Fail quiet, log loud.** Skip what can't be processed; record why; never block the render cycle.

---

## 6. Phase 2 feature requirements

### F1 — Gmail ingestion (flagship)

One integration that replaces per-service APIs by reading notification emails and their attachments, extracting structured facts, and feeding them into the existing data stores (tasks, events, portfolio, bills).

#### F1.1 Connection & scope

- OAuth 2.0 with **read-only** Gmail scope (`gmail.readonly`).
- **Multiple mailboxes supported** (e.g. personal + work): each connected account has its own OAuth token, allowlist, and connection status; all extracted facts are tagged with their source account.
- Ingestion is **scoped, not full-inbox**: user configures an allowlist of senders and/or labels per account in the admin panel. Only matching messages are ever fetched.
- Refresh tokens stored encrypted at rest (same vault as F2), one per account.
- Per-account connection status, granted scope, and a one-tap **disconnect/revoke** visible in the admin panel.

#### F1.2 Ingestion pipeline

Runs on its **own schedule, decoupled from the display cycle** (default: hourly; configurable; future: Gmail push notifications). Pipeline stages:

1. **Fetch** new messages from allowlisted senders/labels since the last run.
2. **Pre-filter (cheap, no LLM):** sender allowlist + keyword/header heuristics discard marketing, spam, and threads before any tokens are spent. Senders tagged `newsletter` bypass the marketing discard and route to the digest path (F1.5) instead.
3. **Dedup:** a `processed_emails` table records Gmail message IDs; a message is never processed twice. Extracted facts carry a source-message reference so re-runs cannot double-count (e.g., the same contract note can never add the same trade twice).
4. **Extract (LLM):** an extraction agent classifies intent (transaction, bill, event, task, delivery, statement, other) and pulls structured fields into the existing data models. Attachments (PDFs) are text-extracted first; the LLM structures the result.
5. **Store:** facts land in the existing SQLite stores (`tasks`, `events`, `portfolio`, new `bills`) tagged with `source: 'email'`, so the Context Agent consumes them through the same tools it already uses.
6. **Skip & log:** any unreadable, undecryptable, or unclassifiable message is skipped with a logged reason. Ingestion failures never block or delay the display cycle.

#### F1.3 Password-protected attachments

Resolution chain, in order:

1. **Formula match:** The email body usually states the password logic ("your password is your PAN followed by DOB in DDMMYYYY"). The extraction agent reads this logic and computes the password from the user's stored identity fields (name, DOB, mobile, PAN, account numbers — see F2). A built-in lookup of well-known sender formulas (e.g., major brokers/banks) supplements this.
2. **Stored per-sender password:** if a password for this sender was previously saved, try it.
3. **Ask the user once:** if both fail, surface a prompt in the admin panel ("Statement from HDFC is locked — enter password"). The entered password is saved (encrypted) per sender and reused for all future documents from that sender.
4. **Never brute-force.** No guessing beyond the above. Undecryptable documents are skipped and listed in the admin panel.

#### F1.4 Known limitations (accepted for Phase 2)

- **Image-only/scanned attachments** are out of scope (no OCR in Phase 2); they are skipped and logged. OCR is a Phase 3 candidate.
- Extraction accuracy is best-effort; every extracted fact keeps a link to its source email so the user can audit and correct via the admin panel.

#### F1.5 Newsletter digest

Newsletters carry real signal (feature launches, product updates, changelogs) but are not transactional facts — they get their own path:

- **Opt-in per sender:** allowlist entries carry a type, `transactional` (default) or `newsletter`. Only senders the user explicitly tags `newsletter` are digested; marketing mail from untagged senders is still discarded by the pre-filter.
- **Headline extraction, not fact extraction:** the extraction agent pulls 2–4 bullet items per newsletter ("Portal X launched feature Y") into a `digest_items` store, each with source sender and date. No amounts/dates/tasks are inferred from newsletters.
- **Token discipline:** newsletters are long and image-heavy, so HTML is stripped to text and capped in length before the extraction pass; the cheap `extract`-role model handles them.
- **Ambient display slot:** digest items surface as an `inbox_digest` content type ("From your inbox: …") at the low-priority end of the ladder — alongside GENERAL news, never competing with reminders, events, or bills.
- **Auto-expiry:** digest items expire after 5 days; stale product news is never shown.

---

### F2 — Encrypted identity vault

A dedicated secure store for the sensitive data F1 needs.

- **Contents:** user identity fields (full name, DOB, mobile number, PAN, account numbers), per-sender document passwords, Gmail OAuth tokens.
- **Encryption at rest:** AES-256-GCM application-level encryption before any write to SQLite. Key material comes from `VAULT_KEY` in `.env` (generated on setup, never committed, never stored in the DB).
- **Isolation:** lives in its own tables (`identity_vault`, `document_passwords`), fully separate from the plaintext `settings` table — the sensitivity boundary is obvious in the schema.
- **Access:** decrypted values are used in-memory by the ingestion pipeline only. They are never sent to the frontend, never included in LLM prompts except the minimum needed to compute a password, and never logged.
- **User control:** the admin panel shows what is stored (masked), allows editing, and offers "delete all vault data."

---

### F3 — Google Calendar sync

- OAuth 2.0 with read-only Calendar scope; token stored in the vault (F2).
- Sync on the ingestion schedule (not the display cycle): upcoming events for the next 7 days merged into the `events` store with `source: 'gcal'`, deduped by calendar event ID.
- Manual events continue to work; the Context Agent sees a single unified events list.
- Covers the invite use case end-to-end with email ingestion: an invite email may arrive first, the calendar entry is authoritative — calendar wins on conflict.

---

### F4 — Composable UI primitives (token-efficient rendering)

Cuts render-agent token spend **without** fixed templates.

- A library of small, parameterized HTML/CSS snippets — stat card, list row, timeline item, chart macro (Chart.js), progress bar, badge, big-number tile, weather strip — is injected into the render agent's context as building blocks.
- The agent **composes freely each cycle**: it chooses which primitives to use, their arrangement, quantity, color accents, and copy. Variety comes from composition, not per-pixel regeneration; boilerplate CSS is written once in the primitive definitions.
- The agent may still write custom HTML when no primitive fits — primitives are a vocabulary, not a cage.
- Anti-repetition: the cycle history (existing) is extended to record a layout fingerprint (primitive set + arrangement hash); the render prompt instructs the agent to avoid the last N fingerprints.
- Target: ≥ 40% reduction in render output tokens at equal or better perceived variety.

---

### F5 — Render-output validation

A lightweight, non-LLM sanity gate between the render agent and the display cache:

- Output is a parseable, self-contained HTML document (no external requests beyond the allowed Chart.js CDN).
- Fits the configured screen dimensions (no horizontal overflow; body sized to `screen.width × screen.height`).
- No script content beyond the allowed chart initialization; no click handlers; no forms.
- **On failure:** retry the render once; if it fails again, keep the previous cached display and log the failure. A bad generation must never sit on the desk for 10 minutes.

---

### F6 — RSS fallback for news

- Configurable RSS feed list in settings (sensible defaults: finance, tech, AI).
- `fetch_news` transparently falls back to RSS when NewsAPI is rate-limited (free tier: 100 req/day), errors, or is unconfigured.
- Same normalized article shape either way; the Context Agent doesn't know or care which source served it.

---

### F7 — Admin panel additions

New/updated tabs in the slide-up panel:

- **Connections:** Gmail + Calendar connect/disconnect, status, granted scopes, sender/label allowlist editor.
- **Vault:** masked identity fields (edit), per-sender passwords (add/remove), "delete all vault data."
- **Ingestion activity:** recent runs, items extracted, skipped items with reasons (including "locked document — tap to enter password").
- **Review queue:** extracted facts pending user confirmation (optional strict mode where nothing enters the data stores unconfirmed; default is auto-accept with audit trail).

---

## 7. System design summary

```
                    ┌─────────────────────────────────────────────┐
                    │                Backend (Node)               │
                    │                                             │
  Gmail ──OAuth──▶  │  Ingestion cron (hourly)                    │
  GCal  ──OAuth──▶  │   fetch → pre-filter → dedup → extract      │
                    │        │ (vault: identities, passwords)     │
                    │        ▼                                    │
                    │   SQLite: tasks / events / portfolio /      │
                    │           bills  (+ source tags)            │
                    │        ▲                                    │
                    │  Display cron (10 min)                      │
                    │   Context Agent ──tools──▶ stores, news,    │
                    │        │                   weather          │
                    │        ▼                                    │
                    │   Render Agent (+ primitives library)       │
                    │        ▼                                    │
                    │   Validator ──ok──▶ display_cache           │
                    └─────────────────────────────────────────────┘
                                         ▲ poll /api/latest
                              Frontend PWA (iframe + crossfade)
```

Key structural decisions:

- **Two independent crons.** Ingestion (hourly) and display (10 min) never block each other; the display agent always reads whatever is already in the stores.
- **Ingestion feeds existing tools.** No new Context Agent tools are needed for email data — extracted facts flow into the same stores the agent already queries. (`get_bills` is the one new tool.)
- **Extraction is a third agent role.** `getModelForRole("extract")` joins `context` and `render`, with the same per-role provider/model/key overrides — a cheap model can do extraction.

### 7.1 New data models

```js
// identity_vault (encrypted values)
{ key: 'fullName'|'dob'|'mobile'|'pan'|'accountNumber:<label>', valueEnc: <ciphertext> }

// document_passwords (encrypted values)
{ id, senderPattern, passwordEnc, lastUsedAt, createdAt }

// mail_accounts (tokens encrypted in vault)
{ id, emailAddress, label: 'personal'|'work'|..., allowlist: { senders: [{ pattern, type: 'transactional'|'newsletter' }], labels: [] }, status, connectedAt }

// digest_items (from newsletter senders; auto-expire after 5 days)
{ id, headline, sourceSender, accountId, receivedAt, expiresAt, sourceEmailId }

// processed_emails
{ gmailMessageId, accountId, sender, subject, processedAt, outcome: 'extracted'|'skipped', reason, factRefs: [] }

// bills
{ id, vendor, amount, currency, dueDate, status: 'due'|'paid'|'unknown', sourceEmailId }

// existing stores gain:  source: 'manual'|'email'|'gcal',  sourceRef
```

### 7.2 New environment variables

```
VAULT_KEY=                # 32-byte key, generated at setup, never committed
GOOGLE_CLIENT_ID=         # OAuth app (Gmail + Calendar)
GOOGLE_CLIENT_SECRET=
INGEST_INTERVAL_MINUTES=60
EXTRACT_LLM_PROVIDER=     # optional per-role override, as with context/render
EXTRACT_LLM_MODEL=
RSS_FEEDS=                # comma-separated, optional (defaults provided)
```

---

## 8. Security & privacy requirements

| # | Requirement |
|---|-------------|
| S1 | Gmail and Calendar scopes are read-only; ingestion reads only allowlisted senders/labels |
| S2 | All vault contents (identity fields, document passwords, OAuth tokens) encrypted at rest with AES-256-GCM; key in `.env` only |
| S3 | Vault values never reach the frontend, logs, or git; API responses mask them |
| S4 | Email bodies/attachments are sent to the configured LLM for extraction — the user explicitly acknowledges this at connect time, and the provider is user-chosen (a local model via the `custom` provider keeps everything on-network) |
| S5 | No password brute-forcing; resolution limited to formula, stored entry, or user prompt |
| S6 | One-tap revoke: disconnecting Gmail/Calendar deletes tokens; "delete all vault data" wipes vault tables |
| S7 | Raw email content is not persisted after extraction — only structured facts + message ID references |

---

## 9. Performance & reliability requirements

| # | Requirement |
|---|-------------|
| P1 | Display cycle end-to-end ≤ 90s p95 (context + render + validate) |
| P2 | Display cycle success ≥ 99%; on any failure the previous display persists |
| P3 | Render token usage reduced ≥ 40% vs. Phase 1.5 baseline (measured over 100 cycles) |
| P4 | Ingestion run processes a typical day's matched email (≤ 50 messages) within one interval |
| P5 | NewsAPI outage or quota exhaustion is invisible to the user (RSS fallback) |
| P6 | All third-party failures (Gmail API, Calendar, news, weather) degrade gracefully — skip, log, continue |

---

## 10. Success metrics

- **Ambient usefulness:** % of cycles showing ingested (non-manual) content when such content exists.
- **Extraction quality:** % of extracted facts not corrected/deleted by the user in the review queue.
- **Password automation:** % of protected PDFs opened without a user prompt (target ≥ 90% for configured senders).
- **Cost:** average token spend per display cycle and per ingestion run (target: render −40%).
- **Reliability:** display cycle success rate (target ≥ 99%); staleness incidents (display older than 2× interval) per week.
- **Variety:** repeated layout-fingerprint rate across any rolling 10-cycle window (target: 0).

---

## 11. Rollout plan

| Milestone | Scope | Exit criteria |
|-----------|-------|---------------|
| **M1 — Foundations** | Vault (F2), render validation (F5), RSS fallback (F6) | Vault CRUD + encryption tests pass; bad render never displayed; news survives NewsAPI quota exhaustion |
| **M2 — Calendar** | Google OAuth plumbing + Calendar sync (F3), Connections tab | Real invites appear on the display within one ingestion interval |
| **M3 — Email core** | Gmail ingestion pipeline (F1.1–F1.2), dedup, extraction agent, bills store, ingestion activity UI | Plain-text notification emails become tasks/events/bills with zero duplicates across re-runs |
| **M4 — Locked documents** | Password resolution chain (F1.3), password prompt flow, review queue | Protected contract note/statement PDFs from configured senders parsed automatically; unresolvable ones surfaced for one-time entry |
| **M5 — Rendering economy** | Primitives library + layout fingerprints (F4), token instrumentation | −40% render tokens over 100-cycle A/B vs. baseline, with no fingerprint repeats in any 10-cycle window |

Each milestone ships independently; the display experience keeps working throughout.

---

## 12. Risks & mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Extraction hallucinates facts (wrong amount/date) | Wrong info glanced at all day | Source-linked audit trail; optional strict review queue; conservative extraction prompt ("omit when unsure") |
| Full-inbox anxiety / privacy concerns | User distrust, abandonment | Read-only scope, sender/label allowlist, local-LLM option, one-tap revoke, no raw-email persistence |
| Password formula changes by sender | Locked documents pile up | Fallback chain ends in a user prompt; stored per-sender passwords updatable in the panel |
| Primitives homogenize the UI over time | Kills the core "never boring" promise | Fingerprint anti-repetition; primitives are optional vocabulary; periodic variety audit vs. G2 |
| Gmail API quotas / token expiry | Ingestion silently stops | Ingestion health surfaced in the panel; token refresh handling; alert display card when ingestion is stale > 24h |
| `VAULT_KEY` loss | Vault unrecoverable | Documented at setup: key backup instruction; vault data is re-enterable (not irreplaceable) |

---

## 13. Decisions (resolved 2026-07-22)

1. **Review queue default: auto-accept with audit.** Extracted facts go live immediately with a full audit trail; every item is correctable/deletable in the review queue. Re-evaluate only if M3 extraction accuracy proves poor — strict confirm-first remains available as an opt-in setting.
2. **Gmail delivery: interval polling.** Ingestion polls on a configurable interval (`INGEST_INTERVAL_MINUTES`, default 60). Pub/Sub push stays in the Phase 3 backlog.
3. **Bills join the priority ladder.** `bill` becomes a Context Agent content type, ranked MEDIUM when due within 3 days (between TASKS and PORTFOLIO).
4. **OCR: local Tesseract first.** Phase 3 starts with local Tesseract for scanned/image attachments (private, free); a vision-capable LLM is the later upgrade path if accuracy falls short.
5. **Multi-mailbox: in scope.** Multiple Gmail accounts (e.g. personal + work) are supported. Each account has its own OAuth token, sender/label allowlist, and connection status; extracted facts are tagged with the source account.

---

## 14. Out-of-scope backlog (Phase 3 candidates)

- OCR for scanned/image attachments — local Tesseract first, vision LLM as later upgrade (per §13.4)
- Gmail push notifications (Pub/Sub) for near-real-time ingestion (per §13.2)
- Voice announcements for CRITICAL items
- Two-way actions (RSVP, mark bill paid)
- Multi-device / household mode
- On-device (fully local) LLM profile as a first-class preset
