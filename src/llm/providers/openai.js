import { SYSTEM_PROMPT } from '../prompts/deciderPrompt'

export async function generate(context, newsArticles, config, signal) {
  const { apiKey } = config
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
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify({ context, newsArticles }) },
      ],
    }),
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(`OpenAI API error ${response.status}: ${err?.error?.message || response.statusText}`)
  }

  const data = await response.json()
  return parseResponse(data.choices[0].message.content)
}

function parseResponse(content) {
  try {
    const result = JSON.parse(content)
    return { decision: result.decision, contentType: result.contentType, html: result.html }
  } catch {
    const match = content.match(/<!DOCTYPE html>[\s\S]*<\/html>/i)
    if (match) return { decision: 'Recovered from parse error', contentType: 'general', html: match[0] }
    throw new Error('Failed to parse OpenAI response as JSON or HTML')
  }
}
