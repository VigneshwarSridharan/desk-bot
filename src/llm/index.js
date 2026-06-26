import { generate as claudeGenerate } from './providers/claude'
import { generate as openaiGenerate } from './providers/openai'
import { generate as zaiGenerate } from './providers/zai'
import { generate as customGenerate } from './providers/custom'

const PROVIDERS = {
  claude: claudeGenerate,
  openai: openaiGenerate,
  zai: zaiGenerate,
  custom: customGenerate,
  ollama: customGenerate,
}

const API_KEY_FIELD = {
  claude: 'claudeApiKey',
  openai: 'openaiApiKey',
  zai: 'zaiApiKey',
  custom: 'customApiKey',
  ollama: 'customApiKey',
}

export async function generateDisplay(context, newsArticles, settings, signal) {
  const provider = settings.llmProvider || 'claude'
  const generate = PROVIDERS[provider]
  if (!generate) throw new Error(`Unknown LLM provider: ${provider}`)

  const apiKey = settings[API_KEY_FIELD[provider] || 'claudeApiKey'] || ''
  const isCustom = provider === 'custom' || provider === 'ollama'
  if (!apiKey && !isCustom) throw new Error('No API key configured')

  const config = {
    apiKey,
    baseUrl: settings.customBaseUrl || '',
    model: settings.customModel || '',
  }

  return generate(context, newsArticles, config, signal)
}
