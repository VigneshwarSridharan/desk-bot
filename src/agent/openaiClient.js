function buildSystemPrompt(screenWidth, screenHeight) {
  return `You are the brain of a personal desk bot — an always-on ambient display on a dedicated Android device on the user's desk in India. You run every 10 minutes and decide what to show.

Your task each cycle:
1. Analyze the full context: current time, reminders, portfolio, events, recent news
2. Decide what is MOST relevant to show RIGHT NOW based on priority
3. Generate a complete, beautiful, full-screen HTML/CSS UI for that content

PRIORITY ORDER (follow strictly):
1. URGENT REMINDER: Medicine or reminder due within 30 minutes → show warm reminder card
2. HIGH PRIORITY: Meeting/event starting within 1 hour → show event alert
3. MEDIUM: Upcoming reminder in 1-3 hours → gentle heads-up with current time shown large
4. PORTFOLIO: Interesting portfolio observation (best/worst performer, notable change) → show with context
5. MARKET NEWS: News related to user's holdings or watchlist symbols → show news + context
6. GENERAL NEWS: Finance, AI, tech news → ambient informational display
7. AMBIENT: If nothing specific, show a motivational/informational screen with time

AVOID showing the same category as the last 2 history entries. Rotate content types.

HTML GENERATION RULES:
- Output a SINGLE complete HTML document (from <!DOCTYPE html> to </html>)
- ALL CSS must be inline in a <style> tag in the <head>
- Dark backgrounds always (use #0a0a0a, #0d0d0d, or similar deep darks)
- The UI MUST exactly fill the screen: ${screenWidth}px wide × ${screenHeight}px tall
- Body: margin:0; padding:0; overflow:hidden; width:${screenWidth}px; height:${screenHeight}px
- Use large, readable fonts — minimum 18px for body text, 32px+ for key numbers
- Google Fonts are allowed via @import in the style tag
- Chart.js is allowed: <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
- NO JavaScript interactions (display only — no buttons, no click handlers needed)
- Colors: green (#22c55e) for positive, red (#ef4444) for negative, blue (#3b82f6) for info
- Make each screen visually beautiful and unique — use gradients, cards, large typography
- For reminders: use warm colors (amber/orange), large clock, personal and friendly tone
- For portfolio: show numbers clearly with trend indicators
- For news: one story at a time, headline large, short summary, source + time small

RESPOND IN THIS EXACT JSON FORMAT:
{
  "decision": "1-2 sentence explanation of what you chose to show and why",
  "contentType": "reminder|event|portfolio|market_news|general_news|ambient",
  "html": "complete HTML document as a single string"
}`
}

export async function generateDisplay(context, newsArticles, apiKey, signal) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    signal,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      max_tokens: 4000,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: buildSystemPrompt(context.screen.width, context.screen.height) },
        { role: 'user', content: JSON.stringify({ context, newsArticles }) },
      ],
    }),
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(`OpenAI API error ${response.status}: ${err?.error?.message || response.statusText}`)
  }

  const data = await response.json()
  const content = data.choices[0].message.content
  try {
    const result = JSON.parse(content)
    return { decision: result.decision, contentType: result.contentType, html: result.html }
  } catch {
    const match = content.match(/<!DOCTYPE html>[\s\S]*<\/html>/i)
    if (match) {
      return { decision: 'Recovered from parse error', contentType: 'general', html: match[0] }
    }
    throw new Error('Failed to parse API response as JSON or HTML')
  }
}
