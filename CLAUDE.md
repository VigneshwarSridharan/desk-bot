# CLAUDE.md — Desk Bot

## Project Overview

**Desk Bot** is a 24/7 always-on ambient AI assistant PWA installed on a dedicated Android device kept on the user's desk. The screen is never idle — it always shows something relevant, contextual, and useful.

The core concept: **the AI is the app**. Every 10 minutes, the AI agent wakes up, reasons about what to show, fetches relevant data, and generates a full-screen HTML/CSS UI dynamically. There are no fixed templates — the UI is painted fresh each cycle based on what's most relevant at that moment.

---

## Tech Stack

| Layer        | Technology                                                                         |
| ------------ | ---------------------------------------------------------------------------------- |
| App Shell    | React + Vite (PWA)                                                                 |
| Styling      | Tailwind CSS v4                                                                    |
| Backend      | Node.js + Express + Vercel AI SDK (`ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai`)   |
| LLM          | Pluggable — default Claude (claude-sonnet-4-6); switchable via Settings            |
| Data Storage | SQLite via `node:sqlite` (built-in Node.js v22+)                                  |
| Agentic Loop | Vercel AI SDK `generateText` with tool-use (multi-step reasoning)                 |
| News / Web   | NewsAPI (newsapi.org)                                                              |
| Weather      | Open-Meteo (free, no API key)                                                     |
| Hosting      | Local device or self-hosted                                                        |

---

## Project Structure

```
desk-bot/
├── backend/                   # Node.js/Express backend (agentic loop + data)
│   ├── src/
│   │   ├── index.js           # Express server entry, mounts routes, starts cron
│   │   ├── agent/
│   │   │   └── displayAgent.js  # Vercel AI SDK generateText + tools (agentic loop)
│   │   ├── tools/
│   │   │   ├── fetchNews.js   # NewsAPI: finance + general news
│   │   │   ├── getWeather.js  # Open-Meteo weather (free)
│   │   │   ├── getPortfolio.js
│   │   │   ├── getReminders.js  # Urgency flags (urgent / soon / later)
│   │   │   ├── getEvents.js
│   │   │   └── getTasks.js
│   │   ├── store/
│   │   │   └── db.js          # node:sqlite — schema init + CRUD helpers
│   │   ├── routes/
│   │   │   ├── agent.js       # POST /api/cycle, GET /api/latest
│   │   │   ├── portfolio.js
│   │   │   ├── reminders.js
│   │   │   ├── events.js
│   │   │   ├── tasks.js
│   │   │   └── settings.js
│   │   └── scheduler.js       # node-cron: fires agent on cycleIntervalMinutes
│   ├── data/                  # SQLite DB (gitignored)
│   └── package.json
│
├── frontend/                  # React PWA (Vite + Tailwind v4)
│   ├── public/
│   │   ├── manifest.json      # PWA manifest (fullscreen, dark theme)
│   │   └── icons/             # PWA icons (192, 512)
│   ├── src/
│   │   ├── main.jsx
│   │   ├── App.jsx            # Root — mounts DisplayScreen + ManagePanel, wires wake lock
│   │   │
│   │   ├── api/               # HTTP wrappers — frontend talks to backend only
│   │   │   ├── client.js      # fetch wrapper (baseURL from VITE_API_URL)
│   │   │   ├── agent.js       # triggerCycle(), getLatestDisplay()
│   │   │   ├── portfolio.js
│   │   │   ├── reminders.js
│   │   │   ├── events.js
│   │   │   ├── tasks.js
│   │   │   └── settings.js
│   │   │
│   │   ├── components/
│   │   │   ├── DisplayScreen.jsx  # Full-screen display: iframe + status bar + welcome
│   │   │   ├── ManagePanel.jsx    # Slide-up admin panel (Portfolio/Reminders/Events/Tasks/Settings tabs)
│   │   │   └── FallbackClock.jsx  # Fallback clock shown if backend unreachable
│   │   │
│   │   ├── hooks/
│   │   │   ├── useAgentLoop.js    # React hook — drives agentLoop, exposes state + controls
│   │   │   └── useWakeLock.js     # Screen Wake Lock API — keeps display always on
│   │   │
│   │   └── index.css          # Global styles + Tailwind v4 import
│   │
│   ├── .env                   # VITE_API_URL (gitignored)
│   ├── index.html
│   ├── vite.config.js         # Vite + React + Tailwind v4 + VitePWA
│   └── package.json
│
├── CLAUDE.md                  # This file
└── README.md
```

---

## Core Agent Loop

Every 10 minutes (server-side cron, configurable in Settings):

```
Backend (backend/src/agent/displayAgent.js):
1. node-cron fires → runDisplayAgent()
2. LLM reasons via Vercel AI SDK generateText with tools:
   a. get_reminders()  → urgency-flagged reminders (urgent/soon/later)
   b. get_events()     → today's events, minutesFromNow
   c. get_tasks()      → pending tasks by priority
   d. get_portfolio()  → holdings + watchlist
   e. fetch_news()     → NewsAPI articles for chosen topics
   f. get_weather()    → Open-Meteo current + 3-day forecast
   g. render_display() → saves { html, contentType, decision } to SQLite
3. display_cache.generating = 0 → frontend poll detects completion

Frontend (frontend/src/hooks/useAgentLoop.js):
1. Mount → GET /api/latest → show cached HTML immediately
2. POST /api/cycle → poll GET /api/latest every 3s
3. When generating=false → update iframe with crossfade
4. Sleep → repeat
```

**Agentic advantage**: The LLM decides which tools to call based on current time and priority. It won't fetch portfolio data if there's an urgent reminder — it goes straight to `render_display`.

---

## LLM Provider Abstraction

The LLM layer is fully swappable via the Settings tab. Provider routing lives in `backend/src/agent/displayAgent.js`:

```js
// buildModel(settings) — routes to Vercel AI SDK provider
claude  → createAnthropic({ apiKey })('claude-sonnet-4-6')
openai  → createOpenAI({ apiKey })('gpt-4o')
zai     → createOpenAI({ baseURL: 'https://api.z.ai/...', apiKey })('glm-4.7:cloud')
custom  → createOpenAI({ baseURL, apiKey })(customModel)   // Ollama, etc.
```

Default provider: **Claude** (`claude-sonnet-4-6`). Switch to OpenAI in the Settings tab.

---

## Master Decider Prompt

Lives in `backend/src/agent/displayAgent.js` (SYSTEM_PROMPT constant).

### Priority order (highest to lowest)

```
CRITICAL  → Reminders due within 30 minutes
HIGH      → Events/meetings starting within 1 hour
MEDIUM    → Upcoming reminders in 1–3 hours
TASKS     → High-priority tasks due today or overdue
PORTFOLIO → Interesting portfolio observations
MARKET    → News related to holdings/watchlist
GENERAL   → Finance, AI, tech news
AMBIENT   → Motivational/informational + time
```

### Rules

- Never repeat the last 2 cycle content types
- HTML must fill exactly `screen.width × screen.height`
- Dark theme (`#0a0a0a` / `#0d0d0d`)
- Minimum 18px body text, 32px+ for key numbers
- Chart.js via CDN allowed; no click handlers

### Response format (JSON)

```json
{
  "decision": "1-2 sentence explanation",
  "contentType": "reminder|event|task|portfolio|market_news|general_news|ambient",
  "html": "complete self-contained HTML document"
}
```

### User prompt structure (built by `contextBuilder.js`)

```json
{
  "currentTime": "2:30 PM",
  "currentDate": "Friday, June 26, 2026",
  "dayOfWeek": "Friday",
  "screen": { "width": 412, "height": 892 },
  "portfolio": {
    "holdings": [{ "symbol": "HDFCBANK", "type": "stock", "quantity": 10, "avgPrice": 1520 }],
    "watchlist": [{ "symbol": "NIFTY50" }]
  },
  "reminders": {
    "urgentNext3Hours": [{ "title": "Take medicine", "time": "14:00" }],
    "allToday": [...]
  },
  "events": { "upcoming": [...], "todayCount": 1 },
  "tasks": [
    { "title": "Review PR #42", "priority": "high", "due": "2026-06-26", "done": false }
  ],
  "recentHistory": [
    { "type": "market_news", "summary": "Nifty 50 drop" },
    { "type": "portfolio", "summary": "Portfolio up 2.3%" }
  ]
}
```

---

## Data Models (localStorage, Phase 1)

### Portfolio Holding (`store/portfolio.js`)

```js
{ id, symbol, name, type: 'stock'|'mutual_fund', quantity, avgPrice, exchange, watchlistOnly, added_at }
```

### Reminder (`store/reminders.js`)

```js
{ id, title, time: 'HH:MM', days: 'daily'|string[], active: true, note: '' }
```

### Event (`store/events.js`)

```js
{ id, title, date: 'YYYY-MM-DD', time: 'HH:MM'|null, description: '', type: 'event'|'task' }
```

### Task (`store/tasks.js`)

```js
{ id, title, due: 'YYYY-MM-DD'|null, priority: 'high'|'medium'|'low', source: 'manual', done: false }
```

### Cycle History (`store/history.js`)

```js
{ id, type: string, summary: string, timestamp: ISO8601 }  // max 10 entries
```

### Settings (`store/settings.js`)

```js
{
  llmProvider: 'claude',      // 'claude' | 'openai'
  claudeApiKey: '',
  openaiApiKey: '',
  newsApiKey: '',
  cycleIntervalMinutes: 10,
  screenWidth: number,
  screenHeight: number,
}
```

---

## PWA & Always-On Requirements

- `manifest.json` → `display: fullscreen`, `orientation: any`
- `useWakeLock.js` → `navigator.wakeLock.request('screen')` on mount; reacquires on `visibilitychange`
- `vite.config.js` → `vite-plugin-pwa` with `autoUpdate` service worker
- No auto-lock handling: guide user to disable Android auto-lock (Settings → Display → Screen timeout → Never)

---

## Environment Variables

**Frontend** (`frontend/.env`):
```
VITE_API_URL=http://localhost:3001   # Backend URL
```

**Backend** (`backend/.env`):
```
PORT=3001
FRONTEND_URL=http://localhost:5173
# API keys are stored in SQLite via Settings tab — env vars optional (override for CI/Docker)
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
NEWS_API_KEY=
```

---

## Development Commands

```bash
# Frontend (React PWA)
cd frontend
npm install
npm run dev       # Vite dev server on :5173
npm run build     # Production PWA build
npm run lint      # ESLint

# Backend (Node.js)
cd backend
npm install
npm run dev       # node --watch on :3001
npm start         # Production start
```

Both must run simultaneously. Backend serves API + runs agent; frontend serves the PWA shell.

---

## Phase Plan

### Phase 1 — Self-Contained

- [x] PWA shell with wake lock
- [x] Admin panel (portfolio, reminders, events, tasks, settings)
- [x] Agent loop (10-min cycle + cache + crossfade)
- [x] Pluggable LLM layer (Claude default, OpenAI switchable)
- [x] Decider prompt + HTML injection via iframe
- [x] News from NewsAPI (finance + general)
- [x] Cycle history (no-repeat logic)
- [x] Settings page (switch LLM provider, API keys, screen size)

### Phase 1.5 — Backend + Agentic (Current)

- [x] Node.js/Express backend with SQLite persistence
- [x] Vercel AI SDK agentic loop (multi-step tool-use)
- [x] Server-side scheduling (node-cron replaces client setInterval)
- [x] API keys stored server-side (no longer in browser localStorage)
- [x] Frontend polls backend for display updates
- [x] Weather tool (Open-Meteo, free, no key)

### Phase 2 — External Integrations (Later)

- [ ] Google Calendar sync (events)
- [ ] Linear sync (work tasks)
- [ ] Broker API (Zerodha / Groww / Angel One) for live portfolio
- [ ] RSS fallback for news
- [ ] Gemini provider
- [ ] Pre-built UI component library (reduce token usage)

---

## Key Decisions

- **AI generates raw HTML** → pre-built components later (Phase 2)
- **Backend required** — Express + SQLite; API keys live server-side for security
- **Agentic tool-use** — LLM calls tools iteratively rather than receiving a giant context dump
- **Vercel AI SDK** — provider-agnostic; supports Claude, OpenAI, and any OpenAI-compatible endpoint
- **LLM is pluggable** — never hardcode a provider except in `backend/src/agent/displayAgent.js`
- **Dark theme** — user prefers data-dense dark UI
- **Single device** — Android mobile/tablet, portrait or landscape
- **Claude as default** — matches the CLAUDE.md spec; OpenAI available as a fallback
