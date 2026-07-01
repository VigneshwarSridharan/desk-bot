import {
  getAllSettings,
  setGenerating,
  saveDisplay,
  addToHistory,
  getHistory,
} from "../store/db.js";
import { getModelForRole } from "./modelProvider.js";
import { runContextAgent } from "./contextAgent.js";
import { runRenderAgent } from "./renderAgent.js";

function buildInitialPrompt(settings) {
  const now = new Date();
  const timeStr = now.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
  const dateStr = now.toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const history = getHistory()
    .slice(0, 3)
    .map((h) => `${h.type}: ${h.summary}`);

  return `Current time: ${timeStr}
Current date: ${dateStr}
Screen: ${settings.screenWidth || 412}×${settings.screenHeight || 892}px
Recent display history (avoid repeating): ${history.length ? history.join("; ") : "none"}

Start by checking reminders and events for urgency, then decide what to show and call select_content.`;
}

async function withRateLimitRetry(fn, maxAttempts = 4) {
  const delays = [15_000, 30_000, 60_000];
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const is429 =
        err?.statusCode === 429 ||
        err?.status === 429 ||
        err?.message?.includes("Too Many Requests") ||
        err?.message?.includes("rate limit");
      if (is429 && attempt < maxAttempts) {
        const wait = delays[attempt - 1] ?? 60_000;
        console.warn(`[agent] Rate limited (attempt ${attempt}/${maxAttempts}), retrying in ${wait / 1000}s…`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      throw err;
    }
  }
}

let isRunning = false;

export async function runDisplayAgent() {
  if (isRunning) {
    console.log("[agent] Cycle already in progress, skipping");
    return;
  }

  isRunning = true;
  setGenerating(true);
  console.log("[agent] Starting display cycle");

  try {
    const settings = getAllSettings();
    const initialPrompt = buildInitialPrompt(settings);

    // Phase 1: Context Agent — gather data and decide content type
    console.log("[agent] Running context agent");
    const contextModel = getModelForRole("context");
    const contextResult = await withRateLimitRetry(() =>
      runContextAgent(contextModel, initialPrompt)
    );

    if (!contextResult) {
      console.warn("[agent] Context agent never called select_content — aborting cycle");
      setGenerating(false);
      return;
    }

    const { contentType, decision } = contextResult;
    console.log(`[agent] Context agent selected: ${contentType}`);

    // Phase 2: Render Agent — generate full-screen HTML from context
    console.log("[agent] Running render agent");
    const renderModel = getModelForRole("render");
    const html = await withRateLimitRetry(() =>
      runRenderAgent(renderModel, contextResult, settings)
    );

    // Persist result
    saveDisplay({ html, contentType, decision });
    addToHistory(contentType, decision.slice(0, 120));
    console.log(`[agent] Display rendered: ${contentType}`);

  } catch (err) {
    console.error("[agent] Cycle failed:", err.message);
    setGenerating(false);
    throw err;
  } finally {
    isRunning = false;
  }
}
