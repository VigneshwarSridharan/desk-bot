import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import {
  getAllSettings,
  setGenerating,
  saveDisplay,
  addToHistory,
  getHistory,
} from "../store/db.js";
import { runContextAgent } from "./contextAgent.js";
import { runRenderAgent } from "./renderAgent.js";

function buildBaseModel(settings) {
  const provider = process.env.LLM_PROVIDER || settings.llmProvider || "claude";

  if (provider === "claude") {
    const apiKey = process.env.ANTHROPIC_API_KEY || settings.claudeApiKey;
    if (!apiKey) throw new Error("No Claude API key configured");
    return createAnthropic({ apiKey })("claude-sonnet-4-6");
  }

  if (provider === "openai") {
    const apiKey = process.env.OPENAI_API_KEY || settings.openaiApiKey;
    if (!apiKey) throw new Error("No OpenAI API key configured");
    return createOpenAI({ apiKey }).chat("gpt-4o");
  }

  if (provider === "zai") {
    const apiKey = process.env.ZAI_API_KEY || settings.zaiApiKey;
    if (!apiKey) throw new Error("No Z.ai API key configured");
    return createOpenAI({ baseURL: "https://api.z.ai/api/paas/v4", apiKey }).chat(
      "glm-4.5-flash",
    );
  }

  // custom / ollama — any OpenAI-compatible endpoint
  const baseURL =
    process.env.CUSTOM_BASE_URL ||
    settings.customBaseUrl ||
    "http://localhost:11434/v1";
  const apiKey =
    process.env.CUSTOM_API_KEY || settings.customApiKey || "ollama";
  const modelId = process.env.CUSTOM_MODEL || settings.customModel || "llama3";
  return createOpenAI({ baseURL, apiKey }).chat(modelId);
}

function buildModel(settings) {
  return buildBaseModel(settings);
}

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
    const model = buildModel(settings);
    const initialPrompt = buildInitialPrompt(settings);

    // Phase 1: Context Agent — gather data and decide content type
    console.log("[agent] Running context agent");
    const contextResult = await withRateLimitRetry(() =>
      runContextAgent(model, initialPrompt)
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
    const html = await withRateLimitRetry(() =>
      runRenderAgent(model, contextResult, settings)
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
