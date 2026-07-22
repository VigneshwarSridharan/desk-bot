import { test, describe, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createBaseTables, runMigrations } from '../src/store/migrations.js';

function makeDb() {
  const db = new DatabaseSync(':memory:');
  createBaseTables(db);
  runMigrations(db);
  return db;
}

function seedAccount(db, id = 'acct-1', historyId = null) {
  db.prepare(`
    INSERT INTO mail_accounts (id, emailAddress, label, status, historyId) VALUES (?, ?, 'personal', 'connected', ?)
  `).run(id, `${id}@example.com`, historyId);
  return id;
}

function seedAllowlist(db, accountId, entries) {
  const insert = db.prepare('INSERT INTO allowlist_entries (id, accountId, pattern, kind, type) VALUES (?, ?, ?, ?, ?)');
  entries.forEach((e, i) => insert.run(`al-${i}`, accountId, e.pattern, e.kind || 'sender', e.type || 'transactional'));
}

function b64url(str) {
  return Buffer.from(str, 'utf-8').toString('base64url');
}

function rawMessage({ id, sender, subject, bodyText = '', attachments = [], listUnsubscribe, inReplyTo }) {
  const headers = [
    { name: 'From', value: sender },
    { name: 'Subject', value: subject },
  ];
  if (listUnsubscribe) headers.push({ name: 'List-Unsubscribe', value: listUnsubscribe });
  if (inReplyTo) headers.push({ name: 'In-Reply-To', value: inReplyTo });
  const parts = [{ mimeType: 'text/plain', body: { data: b64url(bodyText) } }];
  for (const a of attachments) {
    parts.push({
      filename: a.filename,
      mimeType: a.mimeType || 'application/pdf',
      body: { attachmentId: a.attachmentId || 'att-1', size: a.size ?? 1000 },
    });
  }
  return { id, payload: { mimeType: 'multipart/mixed', headers, parts } };
}

// A fake mailbox that simulates Gmail's own server-side `q=` filtering: only
// messages whose sender appears in one of the query's `from:` clauses are
// ever returned by the messages.list mock, exactly like real Gmail would
// filter before this module ever sees a message id.
function mailbox() {
  return [
    rawMessage({ id: 'm-zerodha', sender: 'noreply@zerodha.com', subject: 'Contract note', bodyText: 'Bought 10 HDFCBANK' }),
    rawMessage({ id: 'm-airtel', sender: 'billing@airtel.in', subject: 'Your bill is ready', bodyText: 'Amount due: 599' }),
    rawMessage({ id: 'm-spam', sender: 'winner@lottery.biz', subject: 'You have won!', bodyText: 'Claim now' }),
    rawMessage({ id: 'm-offlist', sender: 'friend@gmail.com', subject: 'Hey', bodyText: 'lunch?' }),
  ];
}

function matchesQuery(message, query) {
  // Extract each `from:x` clause and check the sender against it — a stand-in
  // for Gmail's real query engine, sufficient to prove gmail.js never asks
  // for anything outside the compiled allowlist query.
  const fromClauses = [...query.matchAll(/from:([^\s)]+)/g)].map((m) => m[1]);
  if (!fromClauses.length) return true;
  return fromClauses.some((f) => message.payload.headers.find((h) => h.name === 'From')?.value === f);
}

let testDb;
let getMock;
let getAccessTokenMock;

beforeEach(() => {
  testDb = makeDb();
  getAccessTokenMock = mock.fn(async () => 'access-token-123');
  mock.module('../src/store/db.js', { defaultExport: testDb });
  mock.module('../src/google/auth.js', {
    namedExports: { getAccessToken: (...args) => getAccessTokenMock(...args) },
  });
});

afterEach(() => {
  mock.reset();
});

async function loadGmail() {
  return import(`../src/google/gmail.js?t=${Date.now()}-${Math.random()}`);
}

function installGetMock({ messages = mailbox(), history = null, historyIdOnProfile = 'H-100' } = {}) {
  getMock = mock.fn(async (url, config) => {
    if (url.endsWith('/messages') && !url.includes('/messages/')) {
      const query = config.params.q;
      const matched = messages.filter((m) => matchesQuery(m, query));
      return { data: { messages: matched.map((m) => ({ id: m.id })) } };
    }
    if (url.endsWith('/history')) {
      if (history?.notFound) {
        const err = new Error('historyId expired');
        err.response = { status: 404 };
        throw err;
      }
      return { data: history || { history: [], historyId: 'H-100' } };
    }
    if (url.endsWith('/profile')) {
      return { data: { historyId: historyIdOnProfile } };
    }
    const idMatch = url.match(/\/messages\/([^/?]+)/);
    if (idMatch) {
      const found = messages.find((m) => m.id === idMatch[1]);
      if (!found) throw new Error(`no fixture message for id ${idMatch[1]}`);
      return { data: found };
    }
    throw new Error(`unexpected URL in test: ${url}`);
  });
  mock.module('axios', { defaultExport: { get: getMock } });
}

describe('compileAllowlistQuery', () => {
  test('builds an OR query from sender and label entries with the standard suffix', async () => {
    const { compileAllowlistQuery } = await loadGmail();
    const query = compileAllowlistQuery([
      { pattern: 'noreply@zerodha.com', kind: 'sender' },
      { pattern: 'desk-bot', kind: 'label' },
    ]);
    assert.equal(query, '(from:noreply@zerodha.com OR label:desk-bot) -in:spam -in:trash newer_than:7d');
  });

  test('returns null for an empty allowlist', async () => {
    const { compileAllowlistQuery } = await loadGmail();
    assert.equal(compileAllowlistQuery([]), null);
  });
});

describe('fetchAccountMessages', () => {
  test('only allowlisted-sender messages are ever fetched, spam and off-list mail excluded', async () => {
    const accountId = seedAccount(testDb);
    seedAllowlist(testDb, accountId, [
      { pattern: 'noreply@zerodha.com' },
      { pattern: 'billing@airtel.in' },
    ]);
    installGetMock();

    const { fetchAccountMessages } = await loadGmail();
    const result = await fetchAccountMessages(accountId);

    assert.equal(result.messages.length, 2);
    const senders = result.messages.map((m) => m.sender).sort();
    assert.deepEqual(senders, ['billing@airtel.in', 'noreply@zerodha.com']);
    assert.ok(!senders.includes('winner@lottery.biz'));
    assert.ok(!senders.includes('friend@gmail.com'));
  });

  test('parses subject and body text from the message payload', async () => {
    const accountId = seedAccount(testDb);
    seedAllowlist(testDb, accountId, [{ pattern: 'noreply@zerodha.com' }]);
    installGetMock();

    const { fetchAccountMessages } = await loadGmail();
    const { messages } = await fetchAccountMessages(accountId);

    assert.equal(messages[0].subject, 'Contract note');
    assert.equal(messages[0].bodyText, 'Bought 10 HDFCBANK');
  });

  test('flags an attachment over the 10 MB cap without dropping the message', async () => {
    const accountId = seedAccount(testDb);
    seedAllowlist(testDb, accountId, [{ pattern: 'stmt@bank.com' }]);
    const big = rawMessage({
      id: 'm-stmt',
      sender: 'stmt@bank.com',
      subject: 'Statement',
      bodyText: 'See attached',
      attachments: [{ filename: 'statement.pdf', size: 11 * 1024 * 1024 }],
    });
    installGetMock({ messages: [big] });

    const { fetchAccountMessages } = await loadGmail();
    const { messages } = await fetchAccountMessages(accountId);

    assert.equal(messages[0].attachments.length, 1);
    assert.equal(messages[0].attachments[0].oversize, true);
  });

  test('caps at 50 messages per run, skips the rest with reason "cap", and does not advance historyId', async () => {
    const accountId = seedAccount(testDb);
    seedAllowlist(testDb, accountId, [{ pattern: 'noreply@zerodha.com' }]);
    const many = Array.from({ length: 55 }, (_, i) =>
      rawMessage({ id: `m-${i}`, sender: 'noreply@zerodha.com', subject: `msg ${i}`, bodyText: 'x' }));
    installGetMock({ messages: many });

    const { fetchAccountMessages } = await loadGmail();
    const result = await fetchAccountMessages(accountId);

    assert.equal(result.messages.length, 50);
    assert.equal(result.capped, true);
    assert.equal(result.skipped.length, 5);
    assert.ok(result.skipped.every((s) => s.reason === 'cap'));

    const account = testDb.prepare('SELECT historyId FROM mail_accounts WHERE id = ?').get(accountId);
    assert.equal(account.historyId, null);
  });

  test('first run has no historyId, sets one afterwards from the profile', async () => {
    const accountId = seedAccount(testDb);
    seedAllowlist(testDb, accountId, [{ pattern: 'noreply@zerodha.com' }]);
    installGetMock({ historyIdOnProfile: 'H-200' });

    const { fetchAccountMessages } = await loadGmail();
    await fetchAccountMessages(accountId);

    const account = testDb.prepare('SELECT historyId FROM mail_accounts WHERE id = ?').get(accountId);
    assert.equal(account.historyId, 'H-200');
  });

  test('a second run with no new mail (empty history) fetches nothing', async () => {
    const accountId = seedAccount(testDb, 'acct-1', 'H-100');
    seedAllowlist(testDb, accountId, [{ pattern: 'noreply@zerodha.com' }]);
    installGetMock({ history: { history: [], historyId: 'H-101' } });

    const { fetchAccountMessages } = await loadGmail();
    const result = await fetchAccountMessages(accountId);

    assert.equal(result.messages.length, 0);
    assert.equal(result.skipped.length, 0);
    const account = testDb.prepare('SELECT historyId FROM mail_accounts WHERE id = ?').get(accountId);
    assert.equal(account.historyId, 'H-101');
  });

  test('an account with a stored historyId uses history.list, only fetching newly added messages', async () => {
    const accountId = seedAccount(testDb, 'acct-1', 'H-100');
    seedAllowlist(testDb, accountId, [{ pattern: 'noreply@zerodha.com' }]);
    const newMessage = rawMessage({ id: 'm-new', sender: 'noreply@zerodha.com', subject: 'New trade', bodyText: 'Sold 5 INFY' });
    installGetMock({
      messages: [newMessage],
      history: { history: [{ messagesAdded: [{ message: { id: 'm-new' } }] }], historyId: 'H-110' },
    });

    const { fetchAccountMessages } = await loadGmail();
    const result = await fetchAccountMessages(accountId);

    assert.equal(result.messages.length, 1);
    assert.equal(result.messages[0].id, 'm-new');
    const account = testDb.prepare('SELECT historyId FROM mail_accounts WHERE id = ?').get(accountId);
    assert.equal(account.historyId, 'H-110');
  });

  test('falls back to a full query when the stored historyId has expired (404)', async () => {
    const accountId = seedAccount(testDb, 'acct-1', 'H-stale');
    seedAllowlist(testDb, accountId, [{ pattern: 'noreply@zerodha.com' }, { pattern: 'billing@airtel.in' }]);
    installGetMock({ history: { notFound: true }, historyIdOnProfile: 'H-300' });

    const { fetchAccountMessages } = await loadGmail();
    const result = await fetchAccountMessages(accountId);

    assert.equal(result.messages.length, 2);
    const account = testDb.prepare('SELECT historyId FROM mail_accounts WHERE id = ?').get(accountId);
    assert.equal(account.historyId, 'H-300');
  });

  test('an account with no allowlist entries fetches nothing and never calls Gmail', async () => {
    const accountId = seedAccount(testDb);
    installGetMock();

    const { fetchAccountMessages } = await loadGmail();
    const result = await fetchAccountMessages(accountId);

    assert.equal(result.messages.length, 0);
    assert.equal(getMock.mock.callCount(), 0);
  });
});

describe('fetchAllAccountMessages', () => {
  test('fetches only connected accounts, and one failure does not block the others', async () => {
    seedAccount(testDb, 'acct-connected');
    seedAllowlist(testDb, 'acct-connected', [{ pattern: 'noreply@zerodha.com' }]);
    testDb.prepare(`
      INSERT INTO mail_accounts (id, emailAddress, label, status) VALUES ('acct-revoked', 'x@example.com', '', 'revoked')
    `).run();
    installGetMock();
    getAccessTokenMock.mock.mockImplementation(async () => { throw new Error('token refresh failed'); });

    const { fetchAllAccountMessages } = await loadGmail();
    const results = await fetchAllAccountMessages();

    assert.equal(results.length, 1);
    assert.equal(results[0].accountId, 'acct-connected');
    assert.ok(results[0].error);
  });
});
