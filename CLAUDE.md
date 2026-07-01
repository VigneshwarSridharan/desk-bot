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
| LLM          | Pluggable via environment variables — Claude (claude-sonnet-4-6) by default        |
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
│   │   │   ├── displayAgent.js  # Orchestrates context + render agent phases (two-phase agentic loop)
│   │   │   ├── contextAgent.js  # Phase 1: gather data, decide content type
│   │   │   ├── renderAgent.js   # Phase 2: generate full-screen HTML
│   │   │   └── modelProvider.js # LLM model builder with per-agent-role provider/model selection
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
│   │   │   ├── DisplayScreen.jsx  # Full-screen display: iframe + status bar
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

Provider and model selection is configured entirely via environment variables (`.env`), not the Settings UI. The provider layer lives in `backend/src/agent/modelProvider.js` with two key functions:

**`getModelForRole(role)`** — resolves provider + model for a given agent role (`"context"` or `"render"`):
- Checks for per-role provider override: `CONTEXT_LLM_PROVIDER` / `RENDER_LLM_PROVIDER`, falls back to `LLM_PROVIDER` (default: `'claude'`)
- Checks for per-role model override: `CONTEXT_LLM_MODEL` / `RENDER_LLM_MODEL`, falls back to global `LLM_MODEL`, then to provider-specific default models
- Supports per-role API key / base URL overrides: `CONTEXT_LLM_API_KEY`/`CONTEXT_LLM_BASE_URL`, etc.
- Precedence: per-role model > global model > provider default

Supported providers and their default models:
```
claude      → createAnthropic({ apiKey })('claude-sonnet-4-6')
openai      → createOpenAI({ apiKey })('gpt-4o')
openrouter  → createOpenRouter({ apiKey })('openai/gpt-4-turbo')
zai         → createOpenAI({ baseURL: 'https://api.z.ai/api/paas/v4', apiKey })('glm-4.5-flash')
google      → google({ apiKey })('gemini-2.0-flash')
custom      → createOpenAI({ baseURL, apiKey })(customModel)   // Ollama, Groq, Cerebras, etc.
```

This design allows the context agent and render agent to use different models or even different providers, optimized for their specific roles (e.g., a cheaper/faster model for rendering, a more capable model for reasoning).

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

Non-credential settings only (API keys and provider/model selection are now `.env` only):

```js
{
  weatherLat: '',
  weatherLon: '',
  weatherCity: '',
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

API keys and provider/model selection are strictly environment-based (no longer configurable via the Settings UI or stored in the database).

```
PORT=3001
FRONTEND_URL=http://localhost:5173

# Global default provider (both agents use this unless overridden)
LLM_PROVIDER=claude

# Global default model (optional) — overrides provider's default
# LLM_MODEL=claude-opus-4-1

# Per-agent-role overrides (optional)
# CONTEXT_LLM_PROVIDER=openai
# CONTEXT_LLM_MODEL=gpt-4o
# CONTEXT_LLM_API_KEY=...
# CONTEXT_LLM_BASE_URL=...
# RENDER_LLM_PROVIDER=claude
# RENDER_LLM_MODEL=claude-sonnet-4-6
# RENDER_LLM_API_KEY=...
# RENDER_LLM_BASE_URL=...

# Credentials for selected provider(s) — REQUIRED
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
OPENROUTER_API_KEY=sk-or-...
ZAI_API_KEY=...
CUSTOM_BASE_URL=http://localhost:11434/v1
CUSTOM_API_KEY=ollama
CUSTOM_MODEL=llama3

# Other required keys
NEWS_API_KEY=...

# Weather location (seeded into database on first start)
WEATHER_LAT=13.0827
WEATHER_LON=80.2707
WEATHER_CITY=Chennai
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
- [x] Settings page (weather, cycle interval, screen size; credentials and provider via .env)

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
- **LLM is pluggable via environment** — provider and model selection via `.env` (resolved in `backend/src/agent/modelProvider.js`), allowing per-agent-role customization
- **Dark theme** — user prefers data-dense dark UI
- **Single device** — Android mobile/tablet, portrait or landscape
- **Claude as default** — matches the CLAUDE.md spec; OpenAI available as a fallback
