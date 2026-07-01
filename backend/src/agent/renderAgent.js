import { generateText } from "ai";

const RENDER_SYSTEM_PROMPT = `You are a UI renderer for a personal desk bot — an always-on ambient display on a dedicated Android device. Your only job is to generate a beautiful, full-screen HTML document based on the content type and data provided.

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
- For weather: show temperature large (48px+), description, feels-like, humidity, wind speed; 3-day forecast row at bottom
- For events: show event name large, time prominently, countdown or start time
- For ambient: show current time large, motivational or informational content

Respond with ONLY the HTML document. No markdown fences, no explanation, no preamble.`;

export async function runRenderAgent(model, contextResult, settings) {
  const { contentType, decision, contextData } = contextResult;

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

  const renderPrompt = `Content type to render: ${contentType}
Decision: ${decision}
Current time: ${timeStr}
Current date: ${dateStr}
Screen dimensions: ${settings.screenWidth || 412}×${settings.screenHeight || 892}px

Context data:
${JSON.stringify(contextData, null, 2)}

Generate the complete HTML display now.`;

  const result = await generateText({
    model,
    maxRetries: 0,
    system: RENDER_SYSTEM_PROMPT,
    prompt: renderPrompt,
  });

  let html = result.text.trim();
  if (html.startsWith("```")) {
    html = html.replace(/^```[a-z]*\n?/, "").replace(/\n?```$/, "").trim();
  }

  return html;
}
