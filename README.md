# Desk Bot

An always-on AI ambient display for your desk. Powered by GPT-4o.

## Setup

### Prerequisites
- Node.js 18+
- OpenAI API key (platform.openai.com)
- NewsAPI key (newsapi.org — free tier)

### Run locally
```
npm install
npm run dev
```

### Deploy
```
npm run build
```
Deploy the `dist/` folder to Vercel or Netlify (HTTPS required for Wake Lock API)

### Android Device Setup
1. Open the deployed URL in Chrome on your Android device
2. Tap ⋮ → "Add to Home screen" → Install
3. Open the app from home screen (runs fullscreen)
4. Settings → Display → Screen timeout → Never
5. Open Desk Bot, tap anywhere → Settings → add your API keys → Save
6. The bot starts automatically — place your device on your desk

### Usage
- Tap anywhere on the display to open the management panel
- Add your stocks and mutual funds in the Portfolio tab
- Set your daily reminders (medicines, etc.) in the Reminders tab
- Add upcoming events and tasks in the Events tab
- The AI refreshes the display every 10 minutes automatically

## Architecture
- Frontend: React + Vite PWA
- AI: OpenAI GPT-4o (generates display UI)
- News: NewsAPI.org
- Storage: Browser LocalStorage (all data stays on device)
- Display: AI-generated full-screen HTML rendered in sandboxed iframe
