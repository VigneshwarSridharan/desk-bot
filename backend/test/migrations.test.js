import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createBaseTables, runMigrations } from '../src/store/migrations.js';

function tableNames(db) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name);
}

function columnNames(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
}

const NEW_TABLES = [
  'bills', 'mail_accounts', 'allowlist_entries', 'oauth_tokens',
  'processed_emails', 'digest_items', 'identity_vault', 'document_passwords',
];

describe('fresh database', () => {
  test('initializes to the final schema in one pass', () => {
    const db = new DatabaseSync(':memory:');
    createBaseTables(db);
    runMigrations(db);

    const tables = tableNames(db);
    for (const t of NEW_TABLES) assert.ok(tables.includes(t), `missing table ${t}`);
    assert.ok(tables.includes('schema_version'));

    assert.deepEqual(
      db.prepare('SELECT version FROM schema_version ORDER BY version').all().map((r) => r.version),
      [1, 2, 3],
    );

    assert.ok(columnNames(db, 'tasks').includes('sourceEmailId'));
    assert.ok(columnNames(db, 'events').includes('source'));
    assert.ok(columnNames(db, 'events').includes('sourceRef'));
    assert.ok(columnNames(db, 'portfolio').includes('source'));
    assert.ok(columnNames(db, 'portfolio').includes('sourceEmailId'));
    assert.ok(columnNames(db, 'history').includes('layoutFingerprint'));
    assert.ok(columnNames(db, 'mail_accounts').includes('authFailCount'));
    assert.ok(columnNames(db, 'mail_accounts').includes('lastError'));
  });

  test('booting twice is a no-op', () => {
    const db = new DatabaseSync(':memory:');
    createBaseTables(db);
    runMigrations(db);
    runMigrations(db);
    runMigrations(db);

    assert.deepEqual(
      db.prepare('SELECT version FROM schema_version ORDER BY version').all().map((r) => r.version),
      [1, 2, 3],
    );
  });
});

describe('copied Phase 1.5 database', () => {
  function makePhase15Db() {
    const db = new DatabaseSync(':memory:');
    // Exact Phase 1.5 baseline — no schema_version, no P2 columns/tables.
    db.exec(`
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE portfolio (
        id TEXT PRIMARY KEY, symbol TEXT NOT NULL, name TEXT DEFAULT '',
        type TEXT DEFAULT 'stock', quantity REAL DEFAULT 0, avgPrice REAL DEFAULT 0,
        exchange TEXT DEFAULT '', watchlistOnly INTEGER DEFAULT 0,
        added_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE reminders (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, time TEXT NOT NULL,
        days TEXT DEFAULT 'daily', active INTEGER DEFAULT 1, note TEXT DEFAULT ''
      );
      CREATE TABLE events (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, date TEXT NOT NULL,
        time TEXT, description TEXT DEFAULT '', type TEXT DEFAULT 'event'
      );
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, due TEXT,
        priority TEXT DEFAULT 'medium', source TEXT DEFAULT 'manual', done INTEGER DEFAULT 0
      );
      CREATE TABLE history (
        id TEXT PRIMARY KEY, type TEXT NOT NULL, summary TEXT DEFAULT '',
        timestamp TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE display_cache (
        id INTEGER PRIMARY KEY DEFAULT 1, html TEXT DEFAULT '', contentType TEXT DEFAULT '',
        decision TEXT DEFAULT '', timestamp TEXT DEFAULT '', generating INTEGER DEFAULT 0
      );
    `);
    db.prepare('INSERT INTO tasks (id, title, due, priority, source, done) VALUES (?, ?, ?, ?, ?, ?)')
      .run('t1', 'Review PR #42', '2026-07-25', 'high', 'manual', 0);
    db.prepare('INSERT INTO events (id, title, date, time, description, type) VALUES (?, ?, ?, ?, ?, ?)')
      .run('e1', 'Team sync', '2026-07-23', '10:00', '', 'event');
    db.prepare('INSERT INTO portfolio (id, symbol, name, type, quantity, avgPrice, exchange, watchlistOnly) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run('p1', 'HDFCBANK', '', 'stock', 10, 1520, 'NSE', 0);
    db.prepare('INSERT INTO history (id, type, summary, timestamp) VALUES (?, ?, ?, ?)')
      .run('h1', 'market_news', 'Nifty 50 drop', '2026-07-20T10:00:00.000Z');
    return db;
  }

  test('upgrades in place with all existing rows intact', () => {
    const db = makePhase15Db();

    createBaseTables(db); // IF NOT EXISTS — no-op against the pre-existing tables
    runMigrations(db);

    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get('t1');
    assert.equal(task.title, 'Review PR #42');
    assert.equal(task.priority, 'high');
    assert.equal(task.sourceEmailId, null);

    const event = db.prepare('SELECT * FROM events WHERE id = ?').get('e1');
    assert.equal(event.title, 'Team sync');
    assert.equal(event.source, 'manual');
    assert.equal(event.sourceRef, null);

    const holding = db.prepare('SELECT * FROM portfolio WHERE id = ?').get('p1');
    assert.equal(holding.symbol, 'HDFCBANK');
    assert.equal(holding.source, 'manual');

    const historyRow = db.prepare('SELECT * FROM history WHERE id = ?').get('h1');
    assert.equal(historyRow.summary, 'Nifty 50 drop');
    assert.equal(historyRow.layoutFingerprint, null);

    for (const t of NEW_TABLES) assert.ok(tableNames(db).includes(t));
  });

  test('re-running migrations against an upgraded DB is a no-op', () => {
    const db = makePhase15Db();
    createBaseTables(db);
    runMigrations(db);
    const before = db.prepare('SELECT * FROM tasks WHERE id = ?').get('t1');

    runMigrations(db);
    const after = db.prepare('SELECT * FROM tasks WHERE id = ?').get('t1');

    assert.deepEqual(before, after);
    assert.deepEqual(
      db.prepare('SELECT version FROM schema_version ORDER BY version').all().map((r) => r.version),
      [1, 2, 3],
    );
  });
});
