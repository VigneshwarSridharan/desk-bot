import { test, describe, mock, before, after, beforeEach } from 'node:test';
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
const getAuthUrlMock = mock.fn(() => 'https://accounts.google.com/o/oauth2/v2/auth?mock=1');
const connectAccountMock = mock.fn(async () => ({ accountId: 'new-account', emailAddress: 'me@example.com' }));
// Mirrors the one real invariant callers rely on: revocation always clears
// the token rows, regardless of the purge flag (see google/auth.js).
const revokeAccountMock = mock.fn(async (accountId) => {
  testDb.prepare('DELETE FROM oauth_tokens WHERE accountId = ?').run(accountId);
});

mock.module('../src/store/db.js', { defaultExport: testDb });
mock.module('../src/google/auth.js', {
  namedExports: {
    getAuthUrl: (...args) => getAuthUrlMock(...args),
    connectAccount: (...args) => connectAccountMock(...args),
    revokeAccount: (...args) => revokeAccountMock(...args),
  },
});

const { default: connectionsRoutes } = await import('../src/routes/connections.js');

let server;
let baseUrl;

before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/connections', connectionsRoutes);
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/connections`;
});

after(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => {
  testDb.exec('DELETE FROM oauth_tokens; DELETE FROM allowlist_entries; DELETE FROM mail_accounts;');
  getAuthUrlMock.mock.resetCalls();
  connectAccountMock.mock.resetCalls();
  revokeAccountMock.mock.resetCalls();
});

function seedAccount(overrides = {}) {
  const id = overrides.id || 'acct-1';
  testDb.prepare(`
    INSERT INTO mail_accounts (id, emailAddress, label, status) VALUES (?, ?, ?, ?)
  `).run(id, overrides.emailAddress || 'seed@example.com', overrides.label || 'personal', overrides.status || 'connected');
  testDb.prepare(`
    INSERT INTO oauth_tokens (id, accountId, service, refreshTokenEnc) VALUES (?, ?, 'gmail', 'v1:x:y:z')
  `).run(`${id}-tok`, id);
  return id;
}

describe('GET /api/connections', () => {
  test('lists accounts without any token material', async () => {
    seedAccount();
    const res = await fetch(baseUrl);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.length, 1);
    assert.equal(body[0].emailAddress, 'seed@example.com');
    assert.equal('refreshTokenEnc' in body[0], false);
    assert.equal('valueEnc' in body[0], false);
  });
});

describe('GET /api/connections/google/start', () => {
  test('returns a consent URL', async () => {
    const res = await fetch(`${baseUrl}/google/start?label=work`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.ok(body.url.startsWith('https://accounts.google.com'));
    assert.equal(getAuthUrlMock.mock.callCount(), 1);
  });
});

describe('GET /api/connections/google/callback', () => {
  test('rejects a callback with no matching pending state', async () => {
    const res = await fetch(`${baseUrl}/google/callback?code=abc&state=unknown-nonce`);
    assert.equal(res.status, 400);
    assert.equal(connectAccountMock.mock.callCount(), 0);
  });

  test('completes the flow for a state minted by google/start', async () => {
    const startRes = await fetch(`${baseUrl}/google/start`);
    const { url } = await startRes.json();
    // getAuthUrl is mocked, so recover the nonce from the call args instead of the URL.
    const state = getAuthUrlMock.mock.calls.at(-1).arguments[0];

    const res = await fetch(`${baseUrl}/google/callback?code=auth-code&state=${state}`);
    assert.equal(res.status, 200);
    assert.equal(connectAccountMock.mock.callCount(), 1);
    assert.equal(connectAccountMock.mock.calls[0].arguments[0].code, 'auth-code');

    // Replaying the same state must fail — it's single-use.
    const replay = await fetch(`${baseUrl}/google/callback?code=auth-code&state=${state}`);
    assert.equal(replay.status, 400);
  });
});

describe('DELETE /api/connections/:id', () => {
  test('revokes at Google and deletes the token row, keeping the account by default', async () => {
    const id = seedAccount();
    const res = await fetch(`${baseUrl}/${id}`, { method: 'DELETE' });
    assert.equal(res.status, 200);
    assert.equal(revokeAccountMock.mock.callCount(), 1);
    assert.equal(revokeAccountMock.mock.calls[0].arguments[0], id);

    const account = testDb.prepare('SELECT status FROM mail_accounts WHERE id = ?').get(id);
    assert.equal(account.status, 'revoked');
  });

  test('purge=true also deletes the mail_accounts row', async () => {
    const id = seedAccount();
    const res = await fetch(`${baseUrl}/${id}?purge=true`, { method: 'DELETE' });
    assert.equal(res.status, 200);
    assert.equal(testDb.prepare('SELECT * FROM mail_accounts WHERE id = ?').get(id), undefined);
  });

  test('404s for an unknown account', async () => {
    const res = await fetch(`${baseUrl}/does-not-exist`, { method: 'DELETE' });
    assert.equal(res.status, 404);
    assert.equal(revokeAccountMock.mock.callCount(), 0);
  });
});

describe('allowlist CRUD', () => {
  test('PUT replaces entries, GET returns them with types', async () => {
    const id = seedAccount();
    const putRes = await fetch(`${baseUrl}/${id}/allowlist`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entries: [
          { pattern: 'noreply@zerodha.com', type: 'transactional' },
          { pattern: 'digest@newsletter.com', type: 'newsletter' },
        ],
      }),
    });
    assert.equal(putRes.status, 200);

    const getRes = await fetch(`${baseUrl}/${id}/allowlist`);
    const entries = await getRes.json();
    assert.equal(entries.length, 2);
    assert.deepEqual(entries.map((e) => e.type).sort(), ['newsletter', 'transactional']);
  });

  test('404s for an unknown account', async () => {
    const res = await fetch(`${baseUrl}/does-not-exist/allowlist`);
    assert.equal(res.status, 404);
  });
});
