import { SYSTEM_PROMPT } from '../prompts/deciderPrompt'

export async function generate(context, newsArticles, config, signal) {
  const { apiKey } = config
  const response = await fetch('https://api.z.ai/api/paas/v4/chat/completions', {
    method: 'POST',
    signal,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Accept-Language': 'en-US,en',
    },
    body: JSON.stringify({
      model: 'glm-5.2',
      max_tokens: 4000,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify({ context, newsArticles }) },
      ],
    }),
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(`Z.ai API error ${response.status}: ${err?.error?.message || response.statusText}`)
  }

  const data = await response.json()
  const msg = data.choices[0].message
  const content = msg.content || msg.reasoning_content || ''
  return parseResponse(content)
}

function parseResponse(content) {
  if (!content) throw new Error('Empty response from Z.ai model')
  const stripped = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  try {
    const result = JSON.parse(stripped)
    return { decision: result.decision, contentType: result.contentType, html: result.html }
  } catch {
    try {
      const sanitized = stripped.replace(/\\(?!["\\/bfnrtu])/g, '\\\\')
      const result = JSON.parse(sanitized)
      return { decision: result.decision, contentType: result.contentType, html: result.html }
    } catch {
      const match = content.match(/<!DOCTYPE html>[\s\S]*<\/html>/i)
      if (match) return { decision: 'Recovered from parse error', contentType: 'general', html: match[0] }
      throw new Error('Failed to parse Z.ai response as JSON or HTML')
    }
  }
}
