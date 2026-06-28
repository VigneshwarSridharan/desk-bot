import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '../../data/desk-bot.db');

const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS portfolio (
    id           TEXT PRIMARY KEY,
    symbol       TEXT NOT NULL,
    name         TEXT DEFAULT '',
    type         TEXT DEFAULT 'stock',
    quantity     REAL DEFAULT 0,
    avgPrice     REAL DEFAULT 0,
    exchange     TEXT DEFAULT '',
    watchlistOnly INTEGER DEFAULT 0,
    added_at     TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS reminders (
    id     TEXT PRIMARY KEY,
    title  TEXT NOT NULL,
    time   TEXT NOT NULL,
    days   TEXT DEFAULT 'daily',
    active INTEGER DEFAULT 1,
    note   TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS events (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    date        TEXT NOT NULL,
    time        TEXT,
    description TEXT DEFAULT '',
    type        TEXT DEFAULT 'event'
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id       TEXT PRIMARY KEY,
    title    TEXT NOT NULL,
    due      TEXT,
    priority TEXT DEFAULT 'medium',
    source   TEXT DEFAULT 'manual',
    done     INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS history (
    id        TEXT PRIMARY KEY,
    type      TEXT NOT NULL,
    summary   TEXT DEFAULT '',
    timestamp TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS display_cache (
    id          INTEGER PRIMARY KEY DEFAULT 1,
    html        TEXT DEFAULT '',
    contentType TEXT DEFAULT '',
    decision    TEXT DEFAULT '',
    timestamp   TEXT DEFAULT '',
    generating  INTEGER DEFAULT 0
  );
`);

// Seed display_cache row if not present
const cacheRow = db.prepare('SELECT id FROM display_cache WHERE id = 1').get();
if (!cacheRow) {
  db.prepare('INSERT INTO display_cache (id) VALUES (1)').run();
}

// Seed default settings — env vars win on first start (INSERT OR IGNORE skips on subsequent starts)
const defaults = {
  llmProvider: process.env.LLM_PROVIDER || 'claude',
  claudeApiKey: process.env.ANTHROPIC_API_KEY || '',
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  zaiApiKey: process.env.ZAI_API_KEY || '',
  customApiKey: process.env.CUSTOM_API_KEY || '',
  customBaseUrl: process.env.CUSTOM_BASE_URL || '',
  customModel: process.env.CUSTOM_MODEL || '',
  newsApiKey: process.env.NEWS_API_KEY || '',
  weatherLat: process.env.WEATHER_LAT || '',
  weatherLon: process.env.WEATHER_LON || '',
  weatherCity: process.env.WEATHER_CITY || '',
  cycleIntervalMinutes: '10',
  screenWidth: '412',
  screenHeight: '892',
};
const insertDefault = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [key, value] of Object.entries(defaults)) {
  insertDefault.run(key, String(value));
}

// ─── Settings ────────────────────────────────────────────────────────────────

export function getAllSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const obj = {};
  for (const { key, value } of rows) obj[key] = value;
  if (obj.cycleIntervalMinutes) obj.cycleIntervalMinutes = Number(obj.cycleIntervalMinutes);
  if (obj.screenWidth) obj.screenWidth = Number(obj.screenWidth);
  if (obj.screenHeight) obj.screenHeight = Number(obj.screenHeight);
  return obj;
}

export function saveAllSettings(obj) {
  const upsert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  for (const [key, value] of Object.entries(obj)) {
    upsert.run(key, String(value ?? ''));
  }
}

// ─── Portfolio ────────────────────────────────────────────────────────────────

export function getPortfolio() {
  const rows = db.prepare('SELECT * FROM portfolio ORDER BY added_at ASC').all();
  return {
    holdings: rows.filter((r) => !r.watchlistOnly).map(toPortfolioItem),
    watchlist: rows.filter((r) => r.watchlistOnly).map(toPortfolioItem),
  };
}

function toPortfolioItem(r) {
  return { ...r, watchlistOnly: !!r.watchlistOnly };
}

export function addPortfolioItem(item) {
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO portfolio (id, symbol, name, type, quantity, avgPrice, exchange, watchlistOnly)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, item.symbol, item.name || '', item.type || 'stock', item.quantity || 0, item.avgPrice || 0, item.exchange || '', item.watchlistOnly ? 1 : 0);
  return id;
}

export function removePortfolioItem(id) {
  db.prepare('DELETE FROM portfolio WHERE id = ?').run(id);
}

export function updatePortfolioItem(id, updates) {
  const allowed = ['symbol', 'name', 'type', 'quantity', 'avgPrice', 'exchange', 'watchlistOnly'];
  const fields = [];
  const values = [];
  for (const [k, v] of Object.entries(updates)) {
    if (allowed.includes(k)) {
      fields.push(`${k} = ?`);
      values.push(k === 'watchlistOnly' ? (v ? 1 : 0) : v);
    }
  }
  if (!fields.length) return;
  values.push(id);
  db.prepare(`UPDATE portfolio SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

// ─── Reminders ────────────────────────────────────────────────────────────────

export function getReminders() {
  return db.prepare('SELECT * FROM reminders ORDER BY time ASC').all().map((r) => ({
    ...r,
    active: !!r.active,
    days: r.days === 'daily' ? 'daily' : JSON.parse(r.days),
  }));
}

export function addReminder(item) {
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO reminders (id, title, time, days, active, note)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, item.title, item.time, Array.isArray(item.days) ? JSON.stringify(item.days) : (item.days || 'daily'), 1, item.note || '');
  return id;
}

export function removeReminder(id) {
  db.prepare('DELETE FROM reminders WHERE id = ?').run(id);
}

export function updateReminder(id, updates) {
  const allowed = ['title', 'time', 'days', 'active', 'note'];
  const fields = [];
  const values = [];
  for (const [k, v] of Object.entries(updates)) {
    if (allowed.includes(k)) {
      fields.push(`${k} = ?`);
      if (k === 'days') values.push(Array.isArray(v) ? JSON.stringify(v) : v);
      else if (k === 'active') values.push(v ? 1 : 0);
      else values.push(v);
    }
  }
  if (!fields.length) return;
  values.push(id);
  db.prepare(`UPDATE reminders SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

export function toggleReminder(id) {
  db.prepare('UPDATE reminders SET active = CASE WHEN active = 1 THEN 0 ELSE 1 END WHERE id = ?').run(id);
}

// ─── Events ──────────────────────────────────────────────────────────────────

export function getEvents() {
  return db.prepare('SELECT * FROM events ORDER BY date ASC, time ASC').all();
}

export function getUpcomingEvents(days = 7) {
  const today = new Date().toISOString().slice(0, 10);
  const future = new Date();
  future.setDate(future.getDate() + days);
  const end = future.toISOString().slice(0, 10);
  return db.prepare('SELECT * FROM events WHERE date >= ? AND date <= ? ORDER BY date ASC, time ASC').all(today, end);
}

export function addEvent(item) {
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO events (id, title, date, time, description, type)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, item.title, item.date, item.time || null, item.description || '', item.type || 'event');
  return id;
}

export function removeEvent(id) {
  db.prepare('DELETE FROM events WHERE id = ?').run(id);
}

export function updateEvent(id, updates) {
  const allowed = ['title', 'date', 'time', 'description', 'type'];
  const fields = [];
  const values = [];
  for (const [k, v] of Object.entries(updates)) {
    if (allowed.includes(k)) { fields.push(`${k} = ?`); values.push(v); }
  }
  if (!fields.length) return;
  values.push(id);
  db.prepare(`UPDATE events SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

// ─── Tasks ────────────────────────────────────────────────────────────────────

export function getTasks() {
  return db.prepare('SELECT * FROM tasks ORDER BY done ASC, priority ASC, due ASC').all().map((r) => ({
    ...r, done: !!r.done,
  }));
}

export function addTask(item) {
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO tasks (id, title, due, priority, source, done)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, item.title, item.due || null, item.priority || 'medium', item.source || 'manual', 0);
  return id;
}

export function removeTask(id) {
  db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
}

export function updateTask(id, updates) {
  const allowed = ['title', 'due', 'priority', 'done'];
  const fields = [];
  const values = [];
  for (const [k, v] of Object.entries(updates)) {
    if (allowed.includes(k)) {
      fields.push(`${k} = ?`);
      values.push(k === 'done' ? (v ? 1 : 0) : v);
    }
  }
  if (!fields.length) return;
  values.push(id);
  db.prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

export function toggleTask(id) {
  db.prepare('UPDATE tasks SET done = CASE WHEN done = 1 THEN 0 ELSE 1 END WHERE id = ?').run(id);
}

// ─── History ─────────────────────────────────────────────────────────────────

export function getHistory() {
  return db.prepare('SELECT * FROM history ORDER BY timestamp DESC LIMIT 10').all();
}

export function addToHistory(type, summary) {
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO history (id, type, summary, timestamp) VALUES (?, ?, ?, ?)').run(
    id, type, summary || '', new Date().toISOString(),
  );
  // Purge oldest beyond 10
  db.exec(`
    DELETE FROM history WHERE id NOT IN (
      SELECT id FROM history ORDER BY timestamp DESC LIMIT 10
    )
  `);
}

// ─── Display Cache ────────────────────────────────────────────────────────────

export function getDisplayCache() {
  return db.prepare('SELECT * FROM display_cache WHERE id = 1').get();
}

export function setGenerating(flag) {
  db.prepare('UPDATE display_cache SET generating = ? WHERE id = 1').run(flag ? 1 : 0);
}

export function saveDisplay({ html, contentType, decision }) {
  db.prepare(`
    UPDATE display_cache
    SET html = ?, contentType = ?, decision = ?, timestamp = ?, generating = 0
    WHERE id = 1
  `).run(html, contentType, decision, new Date().toISOString());
}

export default db;
