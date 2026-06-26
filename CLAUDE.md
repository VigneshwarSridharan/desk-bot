# CLAUDE.md — Desk Bot

## Project Overview

**Desk Bot** is a 24/7 always-on ambient AI assistant PWA installed on a dedicated Android device kept on the user's desk. The screen is never idle — it always shows something relevant, contextual, and useful.

The core concept: **the AI is the app**. Every 10 minutes, the AI agent wakes up, reasons about what to show, fetches relevant data, and generates a full-screen HTML/CSS UI dynamically. There are no fixed templates — the UI is painted fresh each cycle based on what's most relevant at that moment.

---

## Tech Stack

| Layer        | Technology                                                            |
| ------------ | --------------------------------------------------------------------- |
| App Shell    | React + Vite (PWA)                                                    |
| Styling      | Tailwind CSS v4                                                       |
| LLM          | Pluggable — default Claude (claude-sonnet-4-6); switchable via Settings |
| Data Storage | localStorage (Phase 1)                                                |
| News / Web   | NewsAPI (newsapi.org)                                                 |
| Hosting      | Local device or self-hosted                                           |

---

## Project Structure

```
desk-bot/
├── public/
│   ├── manifest.json          # PWA manifest (fullscreen, dark theme)
│   └── icons/                 # PWA icons (192, 512)
├── src/
│   ├── main.jsx
│   ├── App.jsx                # Root — mounts DisplayScreen + ManagePanel, wires wake lock
│   │
│   ├── agent/
│   │   ├── agentLoop.js       # Core 10-min agent loop (startLoop / runCycle)
│   │   ├── contextBuilder.js  # Assembles full context payload for LLM
│   │   └── newsClient.js      # NewsAPI: fetchFinanceNews + fetchGeneralNews
│   │
│   ├── llm/
│   │   ├── index.js           # LLM provider factory (routes to claude/openai)
│   │   ├── providers/
│   │   │   ├── claude.js      # Anthropic Claude provider (default)
│   │   │   └── openai.js      # OpenAI GPT-4o provider
│   │   └── prompts/
│   │       └── deciderPrompt.js  # Master system prompt shared by all providers
│   │
│   ├── store/
│   │   ├── settings.js        # Settings CRUD (llmProvider, apiKeys, cycle interval)
│   │   ├── portfolio.js       # Holdings & watchlist CRUD
│   │   ├── reminders.js       # Reminders CRUD + due-time logic
│   │   ├── events.js          # Events CRUD + getUpcomingEvents(days)
│   │   ├── tasks.js           # Tasks CRUD (priority, due date, done toggle)
│   │   └── history.js         # Cycle history — last N shown, no-repeat logic
│   │
│   ├── components/
│   │   ├── DisplayScreen.jsx  # Full-screen display: iframe + status bar + welcome
│   │   ├── ManagePanel.jsx    # Slide-up admin panel (Portfolio/Reminders/Events/Tasks/Settings tabs)
│   │   └── FallbackClock.jsx  # Fallback clock shown if agent errors with no cache
│   │
│   ├── hooks/
│   │   ├── useAgentLoop.js    # React hook — drives agentLoop, exposes state + controls
│   │   └── useWakeLock.js     # Screen Wake Lock API — keeps display always on
│   │
│   └── index.css              # Global styles + Tailwind v4 import
│
├── .env.example               # API key template
├── CLAUDE.md                  # This file
└── vite.config.js             # Vite + React + Tailwind v4 + VitePWA
```

---

## Core Agent Loop

Every 10 minutes (configurable in Settings):

```
1. contextBuilder.js   → Gather: time, screen size, portfolio, reminders,
                          events, tasks, recent cycle history
2. newsClient.js       → Fetch finance + general news (if NewsAPI key set)
3. llm/index.js        → Route to active provider → receive: { decision, contentType, html }
4. store/history.js    → Log this cycle (what was shown, timestamp)
5. useAgentLoop.js     → Push HTML to DisplayScreen iframe with crossfade
6. Sleep → repeat
```

**Priority override**: The context builder flags reminders due in the next 3 hours as `urgentNext3Hours` so the LLM can bump them to top priority.

---

## LLM Provider Abstraction

The LLM layer is fully swappable via the Settings tab. Each provider implements the same interface:

```js
// src/llm/providers/{claude,openai}.js
async function generate(context, newsArticles, apiKey, signal) {
  // returns: { decision: string, contentType: string, html: string }
}
```

`src/llm/index.js` is the factory — it reads `settings.llmProvider` and routes to the right provider. Adding a new LLM = one file in `providers/` + one line in `index.js`.

Default provider: **Claude** (`claude-sonnet-4-6`). Switch to OpenAI in the Settings tab.

---

## Master Decider Prompt

Shared by all providers in `src/llm/prompts/deciderPrompt.js`.

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

## Environment Variables (`.env`)

```
VITE_LLM_API_KEY=        # Not used — keys are stored in localStorage via Settings tab
VITE_NEWS_API_KEY=        # Not used — same
```

Keys are entered in the admin panel (Settings tab) and persisted to localStorage. No server-side env vars needed in Phase 1.

---

## Development Commands

```bash
npm install
npm run dev       # Local dev server
npm run build     # Production PWA build
npm run preview   # Preview production build
npm run lint      # ESLint
```

---

## Phase Plan

### Phase 1 — Self-Contained (Current)

- [x] PWA shell with wake lock
- [x] Admin panel (portfolio, reminders, events, tasks, settings)
- [x] Agent loop (10-min cycle + cache + crossfade)
- [x] Pluggable LLM layer (Claude default, OpenAI switchable)
- [x] Context builder (time, portfolio, reminders, events, tasks, history)
- [x] Decider prompt + HTML injection via iframe
- [x] News from NewsAPI (finance + general)
- [x] Cycle history (no-repeat logic)
- [x] Settings page (switch LLM provider, API keys, screen size)

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
- **No backend** in Phase 1 — everything runs client-side in the PWA
- **LLM is pluggable** — never hardcode a provider except in `llm/providers/`
- **Dark theme** — user prefers data-dense dark UI
- **Single device** — Android mobile/tablet, portrait or landscape
- **Claude as default** — matches the CLAUDE.md spec; OpenAI available as a fallback
