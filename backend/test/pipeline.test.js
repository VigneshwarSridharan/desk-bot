// Ingestion pipeline tests (Task 10 Accept line): fetch -> prefilter ->
// extract -> store, dedup-safe re-runs, fact rejection, and crash isolation.
// Reuses the Task 9 golden email fixtures for realistic routing/extraction
// input, but mocks extractAgent directly (the fixture corpus already proves
// extractAgent's own behavior in extractAgent.test.js).

import { test, describe, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createBaseTables, runMigrations } from '../src/store/migrations.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, 'fixtures/emails');

function fixture(name) {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, `${name}.json`), 'utf-8'));
}

function makeDb() {
  const db = new DatabaseSync(':memory:');
  createBaseTables(db);
  runMigrations(db);
  return db;
}

function seedAccount(db, id = 'acct-1') {
  db.prepare(`INSERT INTO mail_accounts (id, emailAddress, label, status) VALUES (?, ?, 'personal', 'connected')`).run(id, `${id}@example.com`);
  return id;
}

function seedAllowlist(db, accountId, entries) {
  const insert = db.prepare('INSERT INTO allowlist_entries (id, accountId, pattern, kind, type) VALUES (?, ?, ?, ?, ?)');
  entries.forEach((e, i) => insert.run(`al-${accountId}-${i}`, accountId, e.pattern, e.kind || 'sender', e.type || 'transactional'));
}

function toMessage(id, fixtureEmail) {
  return { id, ...fixtureEmail };
}

let testDb;
let fetchAccountMessagesMock;
let extractTransactionalMock;
let extractDigestMock;

beforeEach(() => {
  testDb = makeDb();
  fetchAccountMessagesMock = mock.fn(async () => ({ messages: [], skipped: [], capped: false }));
  extractTransactionalMock = mock.fn(async () => ({ outcome: 'skipped', reason: 'extract-failed' }));
  extractDigestMock = mock.fn(async () => ({ outcome: 'skipped', reason: 'extract-failed' }));

  mock.module('../src/store/db.js', { defaultExport: testDb });
  mock.module('../src/google/gmail.js', {
    namedExports: { fetchAccountMessages: (...args) => fetchAccountMessagesMock(...args) },
  });
  mock.module('../src/agent/extractAgent.js', {
    namedExports: {
      extractTransactional: (...args) => extractTransactionalMock(...args),
      extractDigest: (...args) => extractDigestMock(...args),
    },
  });
  mock.module('../src/agent/modelProvider.js', {
    namedExports: { getModelForRole: () => 'fake-model' },
  });
});

afterEach(() => {
  mock.reset();
});

async function loadPipeline() {
  return import(`../src/ingest/pipeline.js?t=${Date.now()}-${Math.random()}`);
}

describe('processAccount — prefilter short-circuits before any LLM call', () => {
  test('marketing discard: recorded as skipped, extractTransactional never called', async () => {
    const accountId = seedAccount(testDb);
    const f = fixture('marketing-discard');
    seedAllowlist(testDb, accountId, f.allowlist);
    fetchAccountMessagesMock.mock.mockImplementation(async () => ({
      messages: [toMessage('m-1', f.email)], skipped: [], capped: false,
    }));

    const { processAccount } = await loadPipeline();
    const result = await processAccount(accountId);

    assert.equal(result.skipped, 1);
    assert.equal(result.extracted, 0);
    assert.equal(extractTransactionalMock.mock.callCount(), 0);
    const row = testDb.prepare('SELECT * FROM processed_emails WHERE gmailMessageId = ?').get('m-1');
    assert.equal(row.outcome, 'skipped');
    assert.equal(row.reason, 'marketing');
  });

  test('thread discard: recorded as skipped with reason thread', async () => {
    const accountId = seedAccount(testDb);
    const f = fixture('thread-discard');
    seedAllowlist(testDb, accountId, f.allowlist);
    fetchAccountMessagesMock.mock.mockImplementation(async () => ({
      messages: [toMessage('m-1', f.email)], skipped: [], capped: false,
    }));

    const { processAccount } = await loadPipeline();
    await processAccount(accountId);

    const row = testDb.prepare('SELECT * FROM processed_emails WHERE gmailMessageId = ?').get('m-1');
    assert.equal(row.reason, 'thread');
  });

  test('not-allowlisted discard: defense in depth', async () => {
    const accountId = seedAccount(testDb);
    const f = fixture('not-allowlisted');
    seedAllowlist(testDb, accountId, f.allowlist);
    fetchAccountMessagesMock.mock.mockImplementation(async () => ({
      messages: [toMessage('m-1', f.email)], skipped: [], capped: false,
    }));

    const { processAccount } = await loadPipeline();
    await processAccount(accountId);

    const row = testDb.prepare('SELECT * FROM processed_emails WHERE gmailMessageId = ?').get('m-1');
    assert.equal(row.reason, 'not-allowlisted');
  });
});

describe('processAccount — transactional extraction writes facts', () => {
  test('a bill fact is written to bills and referenced in processed_emails.factRefs', async () => {
    const accountId = seedAccount(testDb);
    const f = fixture('bill-airtel');
    seedAllowlist(testDb, accountId, f.allowlist);
    fetchAccountMessagesMock.mock.mockImplementation(async () => ({
      messages: [toMessage('m-1', f.email)], skipped: [], capped: false,
    }));
    extractTransactionalMock.mock.mockImplementation(async () => f.expected);

    const { processAccount } = await loadPipeline();
    const result = await processAccount(accountId);

    assert.equal(result.extracted, 1);
    const bill = testDb.prepare('SELECT * FROM bills').get();
    assert.equal(bill.vendor, 'Airtel');
    assert.equal(bill.amount, 599);
    assert.equal(bill.sourceEmailId, 'm-1');

    const row = testDb.prepare('SELECT * FROM processed_emails WHERE gmailMessageId = ?').get('m-1');
    assert.equal(row.outcome, 'extracted');
    assert.deepEqual(JSON.parse(row.factRefs), [`bill:${bill.id}`]);
  });

  test('a trade fact creates a new portfolio holding tagged with source email', async () => {
    const accountId = seedAccount(testDb);
    const f = fixture('trade-contract-note');
    seedAllowlist(testDb, accountId, f.allowlist);
    fetchAccountMessagesMock.mock.mockImplementation(async () => ({
      messages: [toMessage('m-1', f.email)], skipped: [], capped: false,
    }));
    extractTransactionalMock.mock.mockImplementation(async () => f.expected);

    const { processAccount } = await loadPipeline();
    await processAccount(accountId);

    const holding = testDb.prepare('SELECT * FROM portfolio').get();
    assert.equal(holding.symbol, 'HDFCBANK');
    assert.equal(holding.quantity, 10);
    assert.equal(holding.avgPrice, 1520);
    assert.equal(holding.source, 'email');
    assert.equal(holding.sourceEmailId, 'm-1');
  });

  test('a second buy of the same symbol updates quantity and recomputes the weighted average price', async () => {
    const accountId = seedAccount(testDb);
    const f = fixture('trade-contract-note');
    seedAllowlist(testDb, accountId, f.allowlist);
    extractTransactionalMock.mock.mockImplementation(async () => f.expected);

    fetchAccountMessagesMock.mock.mockImplementation(async () => ({
      messages: [toMessage('m-1', f.email)], skipped: [], capped: false,
    }));
    const { processAccount } = await loadPipeline();
    await processAccount(accountId);

    extractTransactionalMock.mock.mockImplementation(async () => ({
      ...f.expected,
      facts: [{ type: 'trade', symbol: 'HDFCBANK', side: 'buy', quantity: 10, price: 1540 }],
    }));
    fetchAccountMessagesMock.mock.mockImplementation(async () => ({
      messages: [toMessage('m-2', f.email)], skipped: [], capped: false,
    }));
    await processAccount(accountId);

    const holding = testDb.prepare('SELECT * FROM portfolio').get();
    assert.equal(holding.quantity, 20);
    assert.equal(holding.avgPrice, 1530); // (10*1520 + 10*1540) / 20
  });

  test('an event fact is written with source email and sourceRef', async () => {
    const accountId = seedAccount(testDb);
    const f = fixture('event-invite');
    seedAllowlist(testDb, accountId, f.allowlist);
    fetchAccountMessagesMock.mock.mockImplementation(async () => ({
      messages: [toMessage('m-1', f.email)], skipped: [], capped: false,
    }));
    extractTransactionalMock.mock.mockImplementation(async () => f.expected);

    const { processAccount } = await loadPipeline();
    await processAccount(accountId);

    const event = testDb.prepare("SELECT * FROM events WHERE source = 'email'").get();
    assert.equal(event.title, 'Quarterly Review');
    assert.equal(event.sourceRef, 'm-1');
  });

  test('low-confidence classification is skipped, no facts written', async () => {
    const accountId = seedAccount(testDb);
    const f = fixture('low-confidence');
    seedAllowlist(testDb, accountId, f.allowlist);
    fetchAccountMessagesMock.mock.mockImplementation(async () => ({
      messages: [toMessage('m-1', f.email)], skipped: [], capped: false,
    }));
    extractTransactionalMock.mock.mockImplementation(async () => f.expected);

    const { processAccount } = await loadPipeline();
    const result = await processAccount(accountId);

    assert.equal(result.skipped, 1);
    assert.equal(testDb.prepare('SELECT COUNT(*) AS c FROM bills').get().c, 0);
  });
});

describe('processAccount — newsletter digest path', () => {
  test('headline items land in digest_items, capped input text is passed to extractDigest', async () => {
    const accountId = seedAccount(testDb);
    const f = fixture('newsletter-digest');
    seedAllowlist(testDb, accountId, f.allowlist);
    const longBody = 'x'.repeat(9000);
    fetchAccountMessagesMock.mock.mockImplementation(async () => ({
      messages: [toMessage('m-1', { ...f.email, bodyText: longBody })], skipped: [], capped: false,
    }));
    extractDigestMock.mock.mockImplementation(async () => f.expected);

    const { processAccount } = await loadPipeline();
    const result = await processAccount(accountId);

    assert.equal(result.extracted, 1);
    assert.equal(extractDigestMock.mock.calls[0].arguments[1].strippedText.length, 8000);
    const items = testDb.prepare('SELECT * FROM digest_items').all();
    assert.equal(items.length, 3);
    assert.equal(items[0].sourceEmailId, 'm-1');
    assert.ok(items[0].expiresAt > items[0].receivedAt);
  });
});

describe('processAccount — idempotency (Task 10 Accept line)', () => {
  test('processing the same message twice never duplicates facts or re-calls the model', async () => {
    const accountId = seedAccount(testDb);
    const f = fixture('bill-airtel');
    seedAllowlist(testDb, accountId, f.allowlist);
    fetchAccountMessagesMock.mock.mockImplementation(async () => ({
      messages: [toMessage('m-1', f.email)], skipped: [], capped: false,
    }));
    extractTransactionalMock.mock.mockImplementation(async () => f.expected);

    const { processAccount } = await loadPipeline();
    await processAccount(accountId);
    const second = await processAccount(accountId);

    assert.equal(second.extracted, 0);
    assert.equal(second.skipped, 0);
    assert.equal(extractTransactionalMock.mock.callCount(), 1);
    assert.equal(testDb.prepare('SELECT COUNT(*) AS c FROM bills').get().c, 1);
  });

  test('a capped message is recorded with reason cap and skipped on the retry too', async () => {
    const accountId = seedAccount(testDb);
    seedAllowlist(testDb, accountId, [{ pattern: 'x@y.com', kind: 'sender', type: 'transactional' }]);
    fetchAccountMessagesMock.mock.mockImplementation(async () => ({
      messages: [], skipped: [{ id: 'm-over', reason: 'cap' }], capped: true,
    }));

    const { processAccount } = await loadPipeline();
    const first = await processAccount(accountId);
    const second = await processAccount(accountId);

    assert.equal(first.skipped, 1);
    assert.equal(second.skipped, 0);
    const row = testDb.prepare('SELECT * FROM processed_emails WHERE gmailMessageId = ?').get('m-over');
    assert.equal(row.reason, 'cap');
  });
});

describe('processAccount — crash isolation', () => {
  test('one message throwing during extraction is skipped with reason error; the rest still process', async () => {
    const accountId = seedAccount(testDb);
    const billFixture = fixture('bill-airtel');
    const eventFixture = fixture('event-invite');
    seedAllowlist(testDb, accountId, [...billFixture.allowlist, ...eventFixture.allowlist]);
    fetchAccountMessagesMock.mock.mockImplementation(async () => ({
      messages: [toMessage('m-bad', billFixture.email), toMessage('m-good', eventFixture.email)],
      skipped: [], capped: false,
    }));
    extractTransactionalMock.mock.mockImplementation(async (model, input) => {
      if (input.sender === billFixture.email.sender) throw new Error('model exploded');
      return eventFixture.expected;
    });

    const { processAccount } = await loadPipeline();
    const result = await processAccount(accountId);

    assert.equal(result.errors, 1);
    assert.equal(result.extracted, 1);
    const badRow = testDb.prepare('SELECT * FROM processed_emails WHERE gmailMessageId = ?').get('m-bad');
    assert.equal(badRow.outcome, 'skipped');
    assert.equal(badRow.reason, 'error');
    assert.ok(testDb.prepare('SELECT * FROM events').get());
  });
});

describe('rejectFact', () => {
  test('deletes the fact row and marks the source email user-rejected; a re-run never recreates it', async () => {
    const accountId = seedAccount(testDb);
    const f = fixture('bill-airtel');
    seedAllowlist(testDb, accountId, f.allowlist);
    fetchAccountMessagesMock.mock.mockImplementation(async () => ({
      messages: [toMessage('m-1', f.email)], skipped: [], capped: false,
    }));
    extractTransactionalMock.mock.mockImplementation(async () => f.expected);

    const { processAccount, rejectFact } = await loadPipeline();
    await processAccount(accountId);
    const bill = testDb.prepare('SELECT * FROM bills').get();

    const removed = rejectFact(`bill:${bill.id}`);
    assert.equal(removed, true);
    assert.equal(testDb.prepare('SELECT COUNT(*) AS c FROM bills').get().c, 0);
    const row = testDb.prepare('SELECT * FROM processed_emails WHERE gmailMessageId = ?').get('m-1');
    assert.equal(row.outcome, 'skipped');
    assert.equal(row.reason, 'user-rejected');

    // A re-run of the pipeline over the same message must never resurrect the rejected fact.
    await processAccount(accountId);
    assert.equal(testDb.prepare('SELECT COUNT(*) AS c FROM bills').get().c, 0);
    assert.equal(extractTransactionalMock.mock.callCount(), 1);
  });

  test('returns false for an unknown ref', async () => {
    seedAccount(testDb);
    const { rejectFact } = await loadPipeline();
    assert.equal(rejectFact('bill:does-not-exist'), false);
    assert.equal(rejectFact('not-a-valid-ref'), false);
  });
});

describe('runIngestionPipeline', () => {
  test('processes only connected accounts; one account failing never blocks the others', async () => {
    seedAccount(testDb, 'acct-ok');
    testDb.prepare(`INSERT INTO mail_accounts (id, emailAddress, label, status) VALUES ('acct-bad', 'bad@example.com', '', 'connected')`).run();
    testDb.prepare(`INSERT INTO mail_accounts (id, emailAddress, label, status) VALUES ('acct-revoked', 'x@example.com', '', 'revoked')`).run();

    fetchAccountMessagesMock.mock.mockImplementation(async (accountId) => {
      if (accountId === 'acct-bad') throw new Error('gmail api down');
      return { messages: [], skipped: [], capped: false };
    });

    const { runIngestionPipeline } = await loadPipeline();
    const results = await runIngestionPipeline();

    assert.equal(results.length, 2);
    const bad = results.find((r) => r.accountId === 'acct-bad');
    const ok = results.find((r) => r.accountId === 'acct-ok');
    assert.ok(bad.error);
    assert.equal(ok.extracted, 0);
  });
});
