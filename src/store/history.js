const KEY = 'deskbot_history'
const MAX = 10

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || []
  } catch {
    return []
  }
}

function save(data) {
  localStorage.setItem(KEY, JSON.stringify(data))
}

export function getHistory() {
  return load()
}

export function addToHistory(entry) {
  const history = load()
  history.unshift({ ...entry, id: crypto.randomUUID(), timestamp: new Date().toISOString() })
  save(history.slice(0, MAX))
}

export function getLastN(n) {
  return load().slice(0, n)
}

export function clearHistory() {
  save([])
}
