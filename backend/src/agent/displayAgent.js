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
import { validateDisplayHtml } from "./validator.js";
import { computeLayoutFingerprint } from "./primitives/index.js";

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

// Token instrumentation (ENGINEERING §12): logs the AI SDK's reported usage for
// each render call so per-cycle cost is visible in the logs and comparable
// before/after the primitives rework — no schema change needed for this.
function logRenderUsage(usage) {
  if (!usage) return;
  const { inputTokens, outputTokens, totalTokens } = usage;
  console.log(
    `[agent] Render usage: input=${inputTokens ?? "?"} output=${outputTokens ?? "?"} total=${totalTokens ?? "?"}`
  );
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
    const recentFingerprints = getHistory()
      .slice(0, 5)
      .map((h) => h.layoutFingerprint)
      .filter(Boolean);

    let { html, usage } = await withRateLimitRetry(() =>
      runRenderAgent(renderModel, contextResult, settings, { recentFingerprints })
    );
    logRenderUsage(usage);

    let validation = validateDisplayHtml(html, settings);
    if (!validation.valid) {
      console.warn(
        `[agent] Render validation failed: ${validation.reasons.join("; ")} — retrying once`
      );
      ({ html, usage } = await withRateLimitRetry(() =>
        runRenderAgent(renderModel, contextResult, settings, {
          retryContext: { reasons: validation.reasons },
          recentFingerprints,
        })
      ));
      logRenderUsage(usage);
      validation = validateDisplayHtml(html, settings);
    }

    if (!validation.valid) {
      console.error(
        `[agent] Render validation failed twice: ${validation.reasons.join("; ")} — keeping previous display`
      );
      setGenerating(false);
      return;
    }

    // Persist result
    const layoutFingerprint = computeLayoutFingerprint(html);
    saveDisplay({ html, contentType, decision });
    addToHistory(contentType, decision.slice(0, 120), layoutFingerprint);
    console.log(`[agent] Display rendered: ${contentType} (fingerprint ${layoutFingerprint.slice(0, 8)})`);

  } catch (err) {
    console.error("[agent] Cycle failed:", err.message);
    setGenerating(false);
    throw err;
  } finally {
    isRunning = false;
  }
}
