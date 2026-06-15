const KEY = 'deskbot_events'

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

export function getEvents() {
  return load()
}

export function addEvent(event) {
  const events = load()
  events.push({ time: null, description: '', type: 'event', ...event, id: crypto.randomUUID() })
  save(events)
}

export function removeEvent(id) {
  save(load().filter((e) => e.id !== id))
}

export function updateEvent(id, updates) {
  save(load().map((e) => (e.id === id ? { ...e, ...updates } : e)))
}

export function getUpcomingEvents(days = 7) {
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  const cutoff = new Date(now)
  cutoff.setDate(cutoff.getDate() + days)

  return load()
    .filter((e) => {
      const d = new Date(e.date)
      return d >= now && d < cutoff
    })
    .sort((a, b) => a.date.localeCompare(b.date))
}
