import { generateText, tool, stepCountIs } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";
import {
  getAllSettings,
  setGenerating,
  saveDisplay,
  addToHistory,
  getHistory,
} from "../store/db.js";
import { fetchNewsTool } from "../tools/fetchNews.js";
import { getWeatherTool } from "../tools/getWeather.js";
import { getPortfolioTool } from "../tools/getPortfolio.js";
import { getRemindersTool } from "../tools/getReminders.js";
import { getEventsTool } from "../tools/getEvents.js";
import { getTasksTool } from "../tools/getTasks.js";

const SYSTEM_PROMPT = `You are the brain of a personal desk bot — an always-on ambient display on a dedicated Android device on the user's desk in India. You run every 10 minutes and decide what to show.

Your task each cycle:
1. Use the available tools to gather relevant data (reminders, tasks, events, portfolio, news, weather)
2. Decide what is MOST relevant to show RIGHT NOW based on priority
3. Call render_display with a complete, beautiful, full-screen HTML/CSS UI

PRIORITY ORDER (follow strictly):
1. URGENT REMINDER: Medicine or reminder due within 30 minutes → show warm reminder card
2. HIGH PRIORITY: Meeting/event starting within 1 hour → show event alert
3. MEDIUM: Upcoming reminder in 1-3 hours → gentle heads-up with current time shown large
4. TASKS: High-priority tasks due today or overdue → show task list with urgency
5. WEATHER: Show when it's morning (5–10am), rain/storm/extreme heat/cold, or not shown recently
6. PORTFOLIO: Interesting portfolio observation (best/worst performer, notable context)
7. MARKET NEWS: News related to user's holdings or watchlist symbols
8. GENERAL NEWS: Finance, AI, tech news
9. AMBIENT: If nothing specific, show motivational/informational screen with time

AVOID showing the same category as the last 2 recent history entries. Rotate content types.

TOOL USAGE STRATEGY:
- Always start by checking reminders and events (they have highest priority)
- Check tasks if no urgent reminders/events
- For portfolio/news content, fetch portfolio first, then relevant news
- For weather, call get_weather
- Call render_display LAST with the complete HTML

HTML GENERATION RULES:
- Output a SINGLE complete HTML document (from <!DOCTYPE html> to </html>)
- ALL CSS must be inline in a <style> tag in the <head>
- Dark backgrounds always (use #0a0a0a, #0d0d0d, or similar deep darks)
- Body: margin:0; padding:0; overflow:hidden; width:100vw; height:100vh
- Use large, readable fonts — minimum 18px for body text, 32px+ for key numbers
- Google Fonts are allowed via @import in the style tag
- Chart.js is allowed: <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
- NO JavaScript interactions (display only — no click handlers needed)
- Colors: green (#22c55e) for positive, red (#ef4444) for negative, blue (#3b82f6) for info
- Make each screen visually beautiful and unique — use gradients, cards, large typography
- For reminders: use warm colors (amber/orange), large clock, personal and friendly tone
- For portfolio: show numbers clearly with trend indicators
- For news: one story at a time, headline large, short summary, source + time small
- For tasks: show priority tasks clearly, use color to indicate urgency
- For weather: show temperature large (48px+), description, feels-like, humidity, wind speed; 3-day forecast row at bottom`;

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
  // Use .chat() to force the Chat Completions API (/chat/completions) instead
  // of the Responses API (/responses) that @ai-sdk/openai v4 uses by default.
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

Start by checking reminders and events for urgency, then decide what to show and call render_display.`;
}

async function withRateLimitRetry(fn, maxAttempts = 4) {
  const delays = [15_000, 30_000, 60_000]; // ms between attempts on 429
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

    const renderDisplayTool = tool({
      description:
        "Render the final display. Call this as your LAST action with the complete HTML document and metadata.",
      inputSchema: z.object({
        html: z
          .string()
          .describe(
            "Complete self-contained HTML document from <!DOCTYPE html> to </html>",
          ),
        contentType: z.enum([
          "reminder",
          "event",
          "task",
          "weather",
          "portfolio",
          "market_news",
          "general_news",
          "ambient",
        ]),
        decision: z
          .string()
          .describe(
            "1-2 sentence explanation of what you chose to show and why",
          ),
      }),
      execute: async ({ html, contentType, decision }) => {
        saveDisplay({ html, contentType, decision });
        addToHistory(contentType, decision.slice(0, 120));
        console.log(`[agent] Display rendered: ${contentType}`);
        return { success: true };
      },
    });

    const result = await withRateLimitRetry(() => generateText({
      model,
      maxRetries: 0,
      system: SYSTEM_PROMPT,
      prompt: buildInitialPrompt(settings),
      stopWhen: stepCountIs(10),
      tools: {
        get_reminders: getRemindersTool,
        get_events: getEventsTool,
        get_tasks: getTasksTool,
        get_portfolio: getPortfolioTool,
        get_weather: getWeatherTool,
        fetch_news: fetchNewsTool,
        render_display: renderDisplayTool,
      },
    }));

    // Safety check — if model never called render_display, log warning
    const allToolCalls = result.steps.flatMap((s) => s.toolCalls || []);
    const rendered = allToolCalls.some((c) => c.toolName === "render_display");
    if (!rendered) {
      console.warn(
        "[agent] render_display was never called — max steps reached without output",
      );
      setGenerating(false);
    }
  } catch (err) {
    console.error("[agent] Cycle failed:", err.message);
    setGenerating(false);
    throw err;
  } finally {
    isRunning = false;
  }
}
