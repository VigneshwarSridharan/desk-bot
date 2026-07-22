import { test, describe, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createBaseTables, runMigrations } from '../src/store/migrations.js';

function makeDb() {
  const db = new DatabaseSync(':memory:');
  createBaseTables(db);
  runMigrations(db);
  return db;
}

let testDb;
let postMock;
let getMock;
let originalEnv;

beforeEach(() => {
  originalEnv = {
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    VAULT_KEY: process.env.VAULT_KEY,
  };
  process.env.GOOGLE_CLIENT_ID = 'test-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  process.env.VAULT_KEY = randomBytes(32).toString('base64');

  testDb = makeDb();
  postMock = mock.fn();
  getMock = mock.fn();
  mock.module('axios', { defaultExport: { post: postMock, get: getMock } });
  mock.module('../src/store/db.js', { defaultExport: testDb });
});

afterEach(() => {
  for (const [k, v] of Object.entries(originalEnv)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  mock.reset();
});

async function loadAuth() {
  return import(`../src/google/auth.js?t=${Date.now()}-${Math.random()}`);
}

function tokenResponse(overrides = {}) {
  return {
    data: {
      access_token: 'access-123',
      refresh_token: 'refresh-456',
      expires_in: 3600,
      scope: 'gmail.readonly calendar.readonly',
      ...overrides,
    },
  };
}

describe('getAuthUrl', () => {
  test('includes client id, both read-only scopes, and offline access', async () => {
    const { getAuthUrl } = await loadAuth();
    const url = new URL(getAuthUrl('nonce-1'));
    assert.equal(url.searchParams.get('client_id'), 'test-client-id');
    assert.equal(url.searchParams.get('access_type'), 'offline');
    assert.equal(url.searchParams.get('state'), 'nonce-1');
    const scope = url.searchParams.get('scope');
    assert.ok(scope.includes('gmail.readonly'));
    assert.ok(scope.includes('calendar.readonly'));
  });

  test('throws a clear error when client credentials are missing', async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    const { getAuthUrl } = await loadAuth();
    assert.throws(() => getAuthUrl('x'), /GOOGLE_CLIENT_ID/);
  });
});

describe('connectAccount', () => {
  test('creates a mail_accounts row and an encrypted oauth_tokens row per service', async () => {
    postMock.mock.mockImplementation(async () => tokenResponse());
    getMock.mock.mockImplementation(async () => ({ data: { emailAddress: 'me@example.com' } }));

    const { connectAccount } = await loadAuth();
    const { accountId, emailAddress } = await connectAccount({ code: 'auth-code', label: 'personal' });

    assert.equal(emailAddress, 'me@example.com');
    const account = testDb.prepare('SELECT * FROM mail_accounts WHERE id = ?').get(accountId);
    assert.equal(account.emailAddress, 'me@example.com');
    assert.equal(account.label, 'personal');
    assert.equal(account.status, 'connected');

    const tokenRows = testDb.prepare('SELECT * FROM oauth_tokens WHERE accountId = ?').all(accountId);
    assert.equal(tokenRows.length, 2);
    assert.deepEqual(tokenRows.map((r) => r.service).sort(), ['gcal', 'gmail']);
    for (const row of tokenRows) {
      assert.ok(row.refreshTokenEnc.startsWith('v1:'));
      assert.ok(!row.refreshTokenEnc.includes('refresh-456'));
    }
  });

  test('reconnecting the same email reuses the existing account id', async () => {
    postMock.mock.mockImplementation(async () => tokenResponse());
    getMock.mock.mockImplementation(async () => ({ data: { emailAddress: 'me@example.com' } }));

    const { connectAccount } = await loadAuth();
    const first = await connectAccount({ code: 'code-1' });
    const second = await connectAccount({ code: 'code-2' });

    assert.equal(first.accountId, second.accountId);
    assert.equal(testDb.prepare('SELECT COUNT(*) AS c FROM mail_accounts').get().c, 1);
    assert.equal(testDb.prepare('SELECT COUNT(*) AS c FROM oauth_tokens WHERE accountId = ?').get(first.accountId).c, 2);
  });

  test('throws when Google omits a refresh token', async () => {
    postMock.mock.mockImplementation(async () => tokenResponse({ refresh_token: undefined }));
    const { connectAccount } = await loadAuth();
    await assert.rejects(() => connectAccount({ code: 'auth-code' }), /refresh token/);
    assert.equal(testDb.prepare('SELECT COUNT(*) AS c FROM mail_accounts').get().c, 0);
  });
});

describe('refreshAccessToken', () => {
  async function seedAccount() {
    postMock.mock.mockImplementation(async () => tokenResponse());
    getMock.mock.mockImplementation(async () => ({ data: { emailAddress: 'me@example.com' } }));
    const { connectAccount } = await loadAuth();
    return connectAccount({ code: 'auth-code' });
  }

  test('resets the failure counter on success', async () => {
    const { accountId } = await seedAccount();
    testDb.prepare('UPDATE mail_accounts SET authFailCount = 2 WHERE id = ?').run(accountId);

    const auth = await loadAuth();
    postMock.mock.mockImplementation(async () => tokenResponse({ access_token: 'refreshed-token' }));
    const token = await auth.refreshAccessToken(accountId);

    assert.equal(token, 'refreshed-token');
    const account = testDb.prepare('SELECT authFailCount, status FROM mail_accounts WHERE id = ?').get(accountId);
    assert.equal(account.authFailCount, 0);
    assert.equal(account.status, 'connected');
  });

  test('flips status to error after 3 consecutive failures', async () => {
    const { accountId } = await seedAccount();
    const auth = await loadAuth();
    postMock.mock.mockImplementation(async () => {
      throw new Error('invalid_grant');
    });

    for (let i = 1; i <= 3; i += 1) {
      await assert.rejects(() => auth.refreshAccessToken(accountId));
      const account = testDb.prepare('SELECT authFailCount, status FROM mail_accounts WHERE id = ?').get(accountId);
      assert.equal(account.authFailCount, i);
      assert.equal(account.status, i >= 3 ? 'error' : 'connected');
    }
  });
});

describe('revokeAccount', () => {
  test('calls the Google revoke endpoint and deletes the token rows', async () => {
    postMock.mock.mockImplementation(async () => tokenResponse());
    getMock.mock.mockImplementation(async () => ({ data: { emailAddress: 'me@example.com' } }));
    const auth = await loadAuth();
    const { accountId } = await auth.connectAccount({ code: 'auth-code' });

    postMock.mock.resetCalls();
    postMock.mock.mockImplementation(async () => ({ data: {} }));
    await auth.revokeAccount(accountId);

    const revokeCall = postMock.mock.calls.find((c) => c.arguments[0].includes('/revoke'));
    assert.ok(revokeCall, 'expected a call to the revoke endpoint');
    assert.equal(testDb.prepare('SELECT COUNT(*) AS c FROM oauth_tokens WHERE accountId = ?').get(accountId).c, 0);
  });

  test('still deletes token rows even if the revoke call fails', async () => {
    postMock.mock.mockImplementation(async () => tokenResponse());
    getMock.mock.mockImplementation(async () => ({ data: { emailAddress: 'me@example.com' } }));
    const auth = await loadAuth();
    const { accountId } = await auth.connectAccount({ code: 'auth-code' });

    postMock.mock.resetCalls();
    postMock.mock.mockImplementation(async () => {
      throw new Error('network error');
    });
    await assert.doesNotReject(() => auth.revokeAccount(accountId));
    assert.equal(testDb.prepare('SELECT COUNT(*) AS c FROM oauth_tokens WHERE accountId = ?').get(accountId).c, 0);
  });
});
