const KEY = 'deskbot_reminders'

const DAY_MAP = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

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

export function getReminders() {
  return load()
}

export function addReminder(reminder) {
  const reminders = load()
  reminders.push({ active: true, note: '', ...reminder, id: crypto.randomUUID() })
  save(reminders)
}

export function removeReminder(id) {
  save(load().filter((r) => r.id !== id))
}

export function updateReminder(id, updates) {
  save(load().map((r) => (r.id === id ? { ...r, ...updates } : r)))
}

export function toggleReminder(id) {
  save(load().map((r) => (r.id === id ? { ...r, active: !r.active } : r)))
}

export function getActiveRemindersForNow() {
  const now = new Date()
  const todayKey = DAY_MAP[now.getDay()]
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const windowEnd = nowMinutes + 180

  return load().filter((r) => {
    if (!r.active) return false
    const isToday = r.days === 'daily' || (Array.isArray(r.days) && r.days.includes(todayKey))
    if (!isToday) return false
    const [h, m] = r.time.split(':').map(Number)
    const reminderMinutes = h * 60 + m
    return reminderMinutes >= nowMinutes && reminderMinutes <= windowEnd
  })
}
