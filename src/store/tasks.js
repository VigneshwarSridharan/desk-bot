const KEY = 'deskbot_tasks'

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

export function getTasks() {
  return load()
}

export function getActiveTasks() {
  return load().filter((t) => !t.done)
}

export function addTask(task) {
  const tasks = load()
  tasks.push({ priority: 'medium', done: false, source: 'manual', due: null, ...task, id: crypto.randomUUID() })
  save(tasks)
}

export function removeTask(id) {
  save(load().filter((t) => t.id !== id))
}

export function toggleTask(id) {
  save(load().map((t) => (t.id === id ? { ...t, done: !t.done } : t)))
}

export function updateTask(id, updates) {
  save(load().map((t) => (t.id === id ? { ...t, ...updates } : t)))
}
