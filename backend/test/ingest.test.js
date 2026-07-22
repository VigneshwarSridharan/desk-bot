import { test, describe, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { createBaseTables, runMigrations } from '../src/store/migrations.js';

function makeDb() {
  const db = new DatabaseSync(':memory:');
  createBaseTables(db);
  runMigrations(db);
  return db;
}

const testDb = makeDb();
const runIngestCycleMock = mock.fn(async () => {});
let ingestRunning = false;
const rejectFactMock = mock.fn(() => true);
const reprocessMessageMock = mock.fn(async () => 'extracted');
const storePasswordMock = mock.fn(() => {});

mock.module('../src/store/db.js', { defaultExport: testDb });
mock.module('../src/ingestScheduler.js', {
  namedExports: {
    runIngestCycle: (...args) => runIngestCycleMock(...args),
    isIngestRunning: () => ingestRunning,
  },
});
mock.module('../src/ingest/pipeline.js', {
  namedExports: {
    rejectFact: (...args) => rejectFactMock(...args),
    reprocessMessage: (...args) => reprocessMessageMock(...args),
  },
});
mock.module('../src/ingest/passwords.js', {
  namedExports: {
    storePassword: (...args) => storePasswordMock(...args),
    normalizeSender: (sender) => String(sender || '').toLowerCase(),
  },
});

const { default: ingestRoutes } = await import('../src/routes/ingest.js');

let server;
let baseUrl;

before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/ingest', ingestRoutes);
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/ingest`;
});

after(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => {
  testDb.exec('DELETE FROM processed_emails; DELETE FROM mail_accounts;');
  testDb.prepare(`INSERT INTO mail_accounts (id, emailAddress, label, status) VALUES ('acct-1', 'acct-1@example.com', 'personal', 'connected')`).run();
  runIngestCycleMock.mock.resetCalls();
  rejectFactMock.mock.resetCalls();
  rejectFactMock.mock.mockImplementation(() => true);
  reprocessMessageMock.mock.resetCalls();
  reprocessMessageMock.mock.mockImplementation(async () => 'extracted');
  storePasswordMock.mock.resetCalls();
  ingestRunning = false;
});

function seedProcessedEmail(overrides = {}) {
  testDb.prepare(`
    INSERT INTO processed_emails (gmailMessageId, accountId, sender, subject, outcome, reason, factRefs)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    overrides.gmailMessageId || 'm-1',
    overrides.accountId || 'acct-1',
    overrides.sender || 'billing@airtel.in',
    overrides.subject || 'Your bill',
    overrides.outcome || 'extracted',
    overrides.reason || null,
    JSON.stringify(overrides.factRefs || ['bill:b-1']),
  );
}

describe('GET /api/ingest/activity', () => {
  test('lists recent processed emails with parsed factRefs', async () => {
    seedProcessedEmail();
    const res = await fetch(`${baseUrl}/activity`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.length, 1);
    assert.deepEqual(body[0].factRefs, ['bill:b-1']);
  });

  test('respects the limit query param, capped at 200', async () => {
    for (let i = 0; i < 5; i += 1) seedProcessedEmail({ gmailMessageId: `m-${i}` });
    const res = await fetch(`${baseUrl}/activity?limit=2`);
    const body = await res.json();
    assert.equal(body.length, 2);
  });
});

describe('POST /api/ingest/run', () => {
  test('triggers a manual ingestion cycle', async () => {
    const res = await fetch(`${baseUrl}/run`, { method: 'POST' });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.started, true);
    assert.equal(runIngestCycleMock.mock.callCount(), 1);
  });

  test('409s when a cycle is already running', async () => {
    ingestRunning = true;
    const res = await fetch(`${baseUrl}/run`, { method: 'POST' });
    assert.equal(res.status, 409);
    assert.equal(runIngestCycleMock.mock.callCount(), 0);
  });
});

describe('DELETE /api/ingest/facts/:ref', () => {
  test('rejects a fact', async () => {
    const res = await fetch(`${baseUrl}/facts/bill:b-1`, { method: 'DELETE' });
    assert.equal(res.status, 200);
    assert.equal(rejectFactMock.mock.calls[0].arguments[0], 'bill:b-1');
  });

  test('404s when the fact is not found', async () => {
    rejectFactMock.mock.mockImplementation(() => false);
    const res = await fetch(`${baseUrl}/facts/bill:missing`, { method: 'DELETE' });
    assert.equal(res.status, 404);
  });
});

describe('GET /api/ingest/locked', () => {
  test('lists only skipped-with-reason-locked emails', async () => {
    seedProcessedEmail({ gmailMessageId: 'm-locked', outcome: 'skipped', reason: 'locked', factRefs: [] });
    seedProcessedEmail({ gmailMessageId: 'm-ok', outcome: 'extracted', reason: null });
    seedProcessedEmail({ gmailMessageId: 'm-unreadable', outcome: 'skipped', reason: 'unreadable', factRefs: [] });

    const res = await fetch(`${baseUrl}/locked`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.length, 1);
    assert.equal(body[0].gmailMessageId, 'm-locked');
  });
});

describe('POST /api/ingest/locked/:emailId/password', () => {
  test('stores the password and reprocesses the message', async () => {
    seedProcessedEmail({ gmailMessageId: 'm-locked', sender: 'billing@vendor.com', outcome: 'skipped', reason: 'locked', factRefs: [] });

    const res = await fetch(`${baseUrl}/locked/m-locked/password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'the-real-password' }),
    });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.outcome, 'extracted');
    assert.equal(storePasswordMock.mock.calls[0].arguments[1], 'billing@vendor.com');
    assert.equal(storePasswordMock.mock.calls[0].arguments[2], 'the-real-password');
    assert.equal(reprocessMessageMock.mock.calls[0].arguments[0], 'm-locked');
  });

  test('400s when no password is provided', async () => {
    seedProcessedEmail({ gmailMessageId: 'm-locked', outcome: 'skipped', reason: 'locked', factRefs: [] });
    const res = await fetch(`${baseUrl}/locked/m-locked/password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
    assert.equal(reprocessMessageMock.mock.callCount(), 0);
  });

  test('404s for an unknown email id', async () => {
    const res = await fetch(`${baseUrl}/locked/does-not-exist/password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'x' }),
    });
    assert.equal(res.status, 404);
  });

  test('502s when reprocessing throws', async () => {
    seedProcessedEmail({ gmailMessageId: 'm-locked', sender: 'billing@vendor.com', outcome: 'skipped', reason: 'locked', factRefs: [] });
    reprocessMessageMock.mock.mockImplementation(async () => { throw new Error('gmail api down'); });

    const res = await fetch(`${baseUrl}/locked/m-locked/password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'x' }),
    });
    assert.equal(res.status, 502);
  });
});
