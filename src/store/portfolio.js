const KEY = 'deskbot_portfolio'

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || { holdings: [], watchlist: [] }
  } catch {
    return { holdings: [], watchlist: [] }
  }
}

function save(data) {
  localStorage.setItem(KEY, JSON.stringify(data))
}

export function getPortfolio() {
  return load()
}

export function addHolding(holding) {
  const data = load()
  data.holdings.push({ ...holding, id: crypto.randomUUID(), watchlistOnly: false })
  save(data)
}

export function removeHolding(id) {
  const data = load()
  data.holdings = data.holdings.filter((h) => h.id !== id)
  save(data)
}

export function updateHolding(id, updates) {
  const data = load()
  data.holdings = data.holdings.map((h) => (h.id === id ? { ...h, ...updates } : h))
  save(data)
}

export function addToWatchlist(item) {
  const data = load()
  data.watchlist.push({ ...item, id: crypto.randomUUID(), watchlistOnly: true })
  save(data)
}

export function removeFromWatchlist(id) {
  const data = load()
  data.watchlist = data.watchlist.filter((w) => w.id !== id)
  save(data)
}
