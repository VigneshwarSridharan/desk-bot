import { test, describe, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createBaseTables, runMigrations } from '../src/store/migrations.js';

function makeDb() {
  const db = new DatabaseSync(':memory:');
  createBaseTables(db);
  runMigrations(db);
  return db;
}

function seedAccount(db, id = 'acct-1') {
  db.prepare(`
    INSERT INTO mail_accounts (id, emailAddress, label, status) VALUES (?, ?, 'personal', 'connected')
  `).run(id, `${id}@example.com`);
  return id;
}

let testDb;
let getMock;
let getAccessTokenMock;

beforeEach(() => {
  testDb = makeDb();
  getMock = mock.fn(async () => ({ data: { items: [] } }));
  getAccessTokenMock = mock.fn(async () => 'access-token-123');
  mock.module('axios', { defaultExport: { get: getMock } });
  mock.module('../src/store/db.js', { defaultExport: testDb });
  mock.module('../src/google/auth.js', {
    namedExports: { getAccessToken: (...args) => getAccessTokenMock(...args) },
  });
});

afterEach(() => {
  mock.reset();
});

async function loadGcal() {
  return import(`../src/google/gcal.js?t=${Date.now()}-${Math.random()}`);
}

function googleEvent(overrides = {}) {
  const today = new Date();
  today.setDate(today.getDate() + 1);
  const date = today.toISOString().slice(0, 10);
  return {
    id: 'g-event-1',
    status: 'confirmed',
    summary: 'Team sync',
    description: 'Weekly sync',
    start: { dateTime: `${date}T14:00:00+05:30` },
    ...overrides,
  };
}

describe('syncAccountCalendar', () => {
  test('inserts a new gcal event tagged with source and sourceRef', async () => {
    const accountId = seedAccount(testDb);
    getMock.mock.mockImplementation(async () => ({ data: { items: [googleEvent()] } }));

    const { syncAccountCalendar } = await loadGcal();
    const result = await syncAccountCalendar(accountId);

    assert.equal(result.synced, 1);
    const row = testDb.prepare("SELECT * FROM events WHERE source = 'gcal'").get();
    assert.equal(row.title, 'Team sync');
    assert.equal(row.time, '14:00');
    assert.equal(row.sourceRef, `${accountId}:g-event-1`);
    assert.equal(getAccessTokenMock.mock.calls[0].arguments[0], accountId);
  });

  test('handles all-day events (date only, no time)', async () => {
    const accountId = seedAccount(testDb);
    getMock.mock.mockImplementation(async () => ({
      data: { items: [googleEvent({ id: 'g-allday', start: { date: '2026-08-01' }, summary: 'Holiday' })] },
    }));

    const { syncAccountCalendar } = await loadGcal();
    await syncAccountCalendar(accountId);

    const row = testDb.prepare("SELECT * FROM events WHERE sourceRef = ?").get(`${accountId}:g-allday`);
    assert.equal(row.date, '2026-08-01');
    assert.equal(row.time, null);
  });

  test('re-running with the same event updates it in place, never duplicates', async () => {
    const accountId = seedAccount(testDb);
    getMock.mock.mockImplementation(async () => ({ data: { items: [googleEvent()] } }));
    const { syncAccountCalendar } = await loadGcal();

    await syncAccountCalendar(accountId);
    getMock.mock.mockImplementation(async () => ({
      data: { items: [googleEvent({ summary: 'Team sync (renamed)' })] },
    }));
    await syncAccountCalendar(accountId);

    const rows = testDb.prepare("SELECT * FROM events WHERE source = 'gcal'").all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].title, 'Team sync (renamed)');
  });

  test('reconciles deletions: an event dropped from Google disappears locally on the next run', async () => {
    const accountId = seedAccount(testDb);
    getMock.mock.mockImplementation(async () => ({ data: { items: [googleEvent()] } }));
    const { syncAccountCalendar } = await loadGcal();
    await syncAccountCalendar(accountId);
    assert.equal(testDb.prepare("SELECT COUNT(*) AS c FROM events WHERE source = 'gcal'").get().c, 1);

    getMock.mock.mockImplementation(async () => ({ data: { items: [] } }));
    const result = await syncAccountCalendar(accountId);

    assert.equal(result.removed, 1);
    assert.equal(testDb.prepare("SELECT COUNT(*) AS c FROM events WHERE source = 'gcal'").get().c, 0);
  });

  test('a cancelled event is treated as a deletion, not upserted', async () => {
    const accountId = seedAccount(testDb);
    getMock.mock.mockImplementation(async () => ({
      data: { items: [googleEvent({ status: 'cancelled' })] },
    }));

    const { syncAccountCalendar } = await loadGcal();
    const result = await syncAccountCalendar(accountId);

    assert.equal(result.synced, 1);
    assert.equal(testDb.prepare("SELECT COUNT(*) AS c FROM events").get().c, 0);
  });

  test('calendar wins: a matching email-extracted event is dropped in favor of the gcal row', async () => {
    const accountId = seedAccount(testDb);
    const event = googleEvent();
    const emailEventId = crypto.randomUUID();
    testDb.prepare(`
      INSERT INTO events (id, title, date, time, description, type, source)
      VALUES (?, 'Team Sync', ?, '14:30', 'from an invite email', 'event', 'email')
    `).run(emailEventId, event.start.dateTime.slice(0, 10));

    getMock.mock.mockImplementation(async () => ({ data: { items: [event] } }));
    const { syncAccountCalendar } = await loadGcal();
    await syncAccountCalendar(accountId);

    assert.equal(testDb.prepare('SELECT * FROM events WHERE id = ?').get(emailEventId), undefined);
    const rows = testDb.prepare("SELECT * FROM events").all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].source, 'gcal');
  });

  test('leaves an email event alone when title or time falls outside the dedup window', async () => {
    const accountId = seedAccount(testDb);
    const event = googleEvent();
    const emailEventId = crypto.randomUUID();
    testDb.prepare(`
      INSERT INTO events (id, title, date, time, description, type, source)
      VALUES (?, 'Unrelated meeting', ?, '14:00', '', 'event', 'email')
    `).run(emailEventId, event.start.dateTime.slice(0, 10));

    getMock.mock.mockImplementation(async () => ({ data: { items: [event] } }));
    const { syncAccountCalendar } = await loadGcal();
    await syncAccountCalendar(accountId);

    assert.ok(testDb.prepare('SELECT * FROM events WHERE id = ?').get(emailEventId));
  });
});

describe('syncAllCalendars', () => {
  test('syncs only connected accounts', async () => {
    seedAccount(testDb, 'acct-connected');
    testDb.prepare(`
      INSERT INTO mail_accounts (id, emailAddress, label, status) VALUES ('acct-revoked', 'x@example.com', '', 'revoked')
    `).run();
    getMock.mock.mockImplementation(async () => ({ data: { items: [] } }));

    const { syncAllCalendars } = await loadGcal();
    const results = await syncAllCalendars();

    assert.equal(results.length, 1);
    assert.equal(results[0].accountId, 'acct-connected');
  });

  test("one account's failure does not block the others", async () => {
    seedAccount(testDb, 'acct-1');
    seedAccount(testDb, 'acct-2');
    getAccessTokenMock.mock.mockImplementation(async (accountId) => {
      if (accountId === 'acct-1') throw new Error('token refresh failed');
      return 'access-token-ok';
    });
    getMock.mock.mockImplementation(async () => ({ data: { items: [] } }));

    const { syncAllCalendars } = await loadGcal();
    const results = await syncAllCalendars();

    assert.equal(results.length, 2);
    const failed = results.find((r) => r.accountId === 'acct-1');
    const ok = results.find((r) => r.accountId === 'acct-2');
    assert.ok(failed.error);
    assert.equal(ok.synced, 0);
  });
});
