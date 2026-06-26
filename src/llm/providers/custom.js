import { SYSTEM_PROMPT } from '../prompts/deciderPrompt'

export async function generate(context, newsArticles, config, signal) {
  const { apiKey, baseUrl, model } = config

  if (!baseUrl) throw new Error('Custom provider: Base URL is required')
  if (!model) throw new Error('Custom provider: Model is required')

  const endpoint = baseUrl.endsWith('/chat/completions')
    ? baseUrl
    : baseUrl.replace(/\/$/, '') + '/chat/completions'

  const headers = {
    'Content-Type': 'application/json',
    'Accept-Language': 'en-US,en',
  }
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`

  const response = await fetch(endpoint, {
    method: 'POST',
    signal,
    headers,
    body: JSON.stringify({
      model,
      max_tokens: 4000,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify({ context, newsArticles }) },
      ],
    }),
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(`Custom provider error ${response.status}: ${err?.error?.message || response.statusText}`)
  }

  const data = await response.json()
  const msg = data.choices[0].message
  const content = msg.content || msg.reasoning_content || ''
  return parseResponse(content)
}

function parseResponse(content) {
  if (!content) throw new Error('Empty response from model')
  const stripped = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()

  // Primary parse
  try {
    const result = JSON.parse(stripped)
    return { decision: result.decision, contentType: result.contentType, html: result.html }
  } catch {
    // Some models emit bare backslashes in CSS (e.g. `color: red;\  next-prop`)
    // which are invalid JSON escapes. Escape them and retry before falling back.
    try {
      const sanitized = stripped.replace(/\\(?!["\\/bfnrtu])/g, '\\\\')
      const result = JSON.parse(sanitized)
      return { decision: result.decision, contentType: result.contentType, html: result.html }
    } catch {
      // Last resort: pull the HTML out of the raw string
      const match = content.match(/<!DOCTYPE html>[\s\S]*<\/html>/i)
      if (match) return { decision: 'Recovered from parse error', contentType: 'general', html: match[0] }
      throw new Error('Failed to parse response as JSON or HTML')
    }
  }
}
