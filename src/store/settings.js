const KEY = 'deskbot_settings'

const DEFAULTS = {
  openaiApiKey: '',
  newsApiKey: '',
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
  return Boolean(load().openaiApiKey)
}
