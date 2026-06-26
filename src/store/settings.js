const KEY = 'deskbot_settings'

const DEFAULTS = {
  llmProvider: import.meta.env.VITE_LLM_PROVIDER || 'claude',
  claudeApiKey: import.meta.env.VITE_CLAUDE_API_KEY || '',
  openaiApiKey: import.meta.env.VITE_OPENAI_API_KEY || '',
  zaiApiKey: import.meta.env.VITE_ZAI_API_KEY || '',
  customApiKey: import.meta.env.VITE_LLM_API_KEY || '',
  customBaseUrl: import.meta.env.VITE_LLM_BASE_URL || '',
  customModel: import.meta.env.VITE_LLM_MODEL || '',
  newsApiKey: import.meta.env.VITE_NEWS_API_KEY || '',
  weatherLat: import.meta.env.VITE_WEATHER_LAT || '',
  weatherLon: import.meta.env.VITE_WEATHER_LON || '',
  weatherCity: import.meta.env.VITE_WEATHER_CITY || '',
  cycleIntervalMinutes: 10,
  screenWidth: typeof window !== 'undefined' ? window.innerWidth : 0,
  screenHeight: typeof window !== 'undefined' ? window.innerHeight : 0,
}

function load() {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY)) || {}) }
  } catch {
    return { ...DEFAULTS }
  }
}

export function getSettings() {
  return load()
}

export function saveSettings(settings) {
  localStorage.setItem(KEY, JSON.stringify({ ...load(), ...settings }))
}

export function updateSetting(key, value) {
  const current = load()
  current[key] = value
  localStorage.setItem(KEY, JSON.stringify(current))
}

export function hasRequiredKeys() {
  const s = load()
  if (s.llmProvider === 'openai') return Boolean(s.openaiApiKey)
  if (s.llmProvider === 'zai') return Boolean(s.zaiApiKey)
  if (s.llmProvider === 'custom' || s.llmProvider === 'ollama') return Boolean(s.customBaseUrl && s.customModel)
  return Boolean(s.claudeApiKey)
}
