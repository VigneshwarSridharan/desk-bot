import { generateText, tool, stepCountIs } from "ai";
import { z } from "zod";
import { fetchNewsTool } from "../tools/fetchNews.js";
import { getWeatherTool } from "../tools/getWeather.js";
import { getPortfolioTool } from "../tools/getPortfolio.js";
import { getRemindersTool } from "../tools/getReminders.js";
import { getEventsTool } from "../tools/getEvents.js";
import { getTasksTool } from "../tools/getTasks.js";
import { getBillsTool } from "../tools/getBills.js";
import { getDigestTool } from "../tools/getDigest.js";

const CONTEXT_SYSTEM_PROMPT = `You are the brain of a personal desk bot — an always-on ambient display on a dedicated Android device on the user's desk in India. You run every 10 minutes and decide what to show.

Your task each cycle:
1. Use the available tools to gather relevant data (reminders, tasks, events, bills, portfolio, news, weather, inbox digest)
2. Decide what is MOST relevant to show RIGHT NOW based on priority

PRIORITY ORDER (follow strictly):
1. URGENT REMINDER: Medicine or reminder due within 30 minutes → choose "reminder"
2. HIGH PRIORITY: Meeting/event starting within 1 hour → choose "event"
3. MEDIUM: Upcoming reminder in 1-3 hours → choose "reminder"
4. TASKS: High-priority tasks due today or overdue → choose "task"
5. BILL: A bill due within 3 days (or overdue) → choose "bill"
6. WEATHER: Show when it's morning (5–10am), rain/storm/extreme heat/cold, or not shown recently → choose "weather"
7. PORTFOLIO: Interesting portfolio observation (best/worst performer, notable context) → choose "portfolio"
8. MARKET NEWS: News related to user's holdings or watchlist symbols → choose "market_news"
9. GENERAL NEWS: Finance, AI, tech news → choose "general_news"
10. INBOX DIGEST: Newsletter headlines from the inbox, when nothing higher-priority is eligible → choose "inbox_digest"
11. AMBIENT: If nothing specific → choose "ambient"

AVOID choosing the same category as the last 2 recent history entries. Rotate content types.

TOOL USAGE STRATEGY:
- Always start by checking reminders and events (they have highest priority)
- Check tasks if no urgent reminders/events
- Check bills for anything due within 3 days or overdue
- For portfolio/news content, fetch portfolio first, then relevant news
- For weather, call get_weather
- Only call get_digest when nothing higher-priority was found
- Call select_content LAST with all relevant gathered data

Once you have gathered enough data, call select_content with:
- The chosen contentType
- A 1-2 sentence decision explaining why
- The raw contextData (all data needed to render the screen — only the relevant portion)

Do NOT generate any HTML. Call select_content as your final action.`;

export async function runContextAgent(model, initialPrompt) {
  let selectContentResult = null;

  const selectContentTool = tool({
    description:
      "Signal your content decision. Call this as your LAST action after gathering data. " +
      "Pass the contentType, your reasoning, and all relevant context data.",
    inputSchema: z.object({
      contentType: z.enum([
        "reminder",
        "event",
        "task",
        "bill",
        "weather",
        "portfolio",
        "market_news",
        "general_news",
        "inbox_digest",
        "ambient",
      ]),
      decision: z
        .string()
        .describe("1-2 sentence explanation of what you chose to show and why"),
      contextData: z
        .record(z.unknown())
        .describe(
          "All the raw data needed for rendering — e.g. reminder details, weather object, news article, task list, etc.",
        ),
    }),
    execute: async (args) => {
      selectContentResult = args;
      return { acknowledged: true };
    },
  });

  const result = await generateText({
    model,
    maxRetries: 0,
    system: CONTEXT_SYSTEM_PROMPT,
    prompt: initialPrompt,
    stopWhen: stepCountIs(10),
    tools: {
      get_reminders: getRemindersTool,
      get_events: getEventsTool,
      get_tasks: getTasksTool,
      get_bills: getBillsTool,
      get_digest: getDigestTool,
      get_portfolio: getPortfolioTool,
      get_weather: getWeatherTool,
      fetch_news: fetchNewsTool,
      select_content: selectContentTool,
    },
  });

  const allToolCalls = result.steps.flatMap((s) => s.toolCalls ?? []);
  const called = allToolCalls.some((c) => c.toolName === "select_content");
  if (!called || !selectContentResult) {
    return null;
  }

  return selectContentResult;
}
