import { SYSTEM_PROMPT } from '../prompts/deciderPrompt'

export async function generate(context, newsArticles, config, signal) {
  const { apiKey } = config
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal,
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [
        { role: 'user', content: JSON.stringify({ context, newsArticles }) },
      ],
    }),
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(`Claude API error ${response.status}: ${err?.error?.message || response.statusText}`)
  }

  const data = await response.json()
  return parseResponse(data.content[0].text)
}

function parseResponse(content) {
  // Strip markdown code fences if Claude wraps the JSON
  const stripped = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  try {
    const result = JSON.parse(stripped)
    return { decision: result.decision, contentType: result.contentType, html: result.html }
  } catch {
    const match = content.match(/<!DOCTYPE html>[\s\S]*<\/html>/i)
    if (match) return { decision: 'Recovered from parse error', contentType: 'general', html: match[0] }
    throw new Error('Failed to parse Claude response as JSON or HTML')
  }
}
