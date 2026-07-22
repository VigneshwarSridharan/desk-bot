// Pipeline PDF-attachment integration (Task 12 Accept line): a contract-note
// PDF whose email states "password is your PAN + DOB" opens automatically
// using vault fields; an unresolvable PDF lands in the locked queue and
// entering its password once processes it (and every future document from
// that sender) via reprocessMessage. Mirrors test/pipeline.test.js's mocking
// conventions but wires in real fixture PDF buffers so attachments.js's and
// passwords.js's actual logic runs end to end.

import { test, describe, before, after, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createBaseTables, runMigrations } from '../src/store/migrations.js';
import { putSecret } from '../src/store/vault.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PDFS_DIR = join(__dirname, 'fixtures/pdfs');

function loadPdf(name) {
  return readFileSync(join(PDFS_DIR, name));
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

const ZERODHA_ALLOWLIST = [{ pattern: 'noreply@zerodha.com', kind: 'sender', type: 'transactional' }];

function contractNoteMessage(id, attachmentId, overrides = {}) {
  return {
    id,
    sender: 'noreply@zerodha.com',
    subject: 'Contract Note',
    listUnsubscribe: null,
    inReplyTo: null,
    references: null,
    bodyText: 'Please find attached your contract note. The password is your PAN followed by your date of birth in DDMMYYYY format.',
    attachments: [{ filename: 'contract-note.pdf', mimeType: 'application/pdf', attachmentId, size: 2000, oversize: false }],
    ...overrides,
  };
}

let originalVaultKey;
before(() => {
  originalVaultKey = process.env.VAULT_KEY;
  process.env.VAULT_KEY = randomBytes(32).toString('base64');
});
after(() => {
  if (originalVaultKey === undefined) delete process.env.VAULT_KEY;
  else process.env.VAULT_KEY = originalVaultKey;
});

let testDb;
let fetchAccountMessagesMock;
let fetchAttachmentDataMock;
let fetchSingleMessageMock;
let extractTransactionalMock;

beforeEach(() => {
  testDb = makeDb();
  putSecret(testDb, 'pan', 'ABCDE1234F');
  putSecret(testDb, 'dob', '1990-01-15');

  fetchAccountMessagesMock = mock.fn(async () => ({ messages: [], skipped: [], capped: false }));
  fetchAttachmentDataMock = mock.fn(async () => { throw new Error('no attachment stubbed'); });
  fetchSingleMessageMock = mock.fn(async () => { throw new Error('no single-message stub'); });
  extractTransactionalMock = mock.fn(async () => ({ outcome: 'skipped', reason: 'extract-failed' }));

  mock.module('../src/store/db.js', { defaultExport: testDb });
  mock.module('../src/google/gmail.js', {
    namedExports: {
      fetchAccountMessages: (...args) => fetchAccountMessagesMock(...args),
      fetchAttachmentData: (...args) => fetchAttachmentDataMock(...args),
      fetchSingleMessage: (...args) => fetchSingleMessageMock(...args),
    },
  });
  mock.module('../src/agent/extractAgent.js', {
    namedExports: {
      extractTransactional: (...args) => extractTransactionalMock(...args),
      extractDigest: async () => ({ outcome: 'skipped', reason: 'extract-failed' }),
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

describe('processMessage — password-protected attachment resolves via the email hint', () => {
  test('the attachment text supersedes bodyText-only facts', async () => {
    const accountId = seedAccount(testDb);
    seedAllowlist(testDb, accountId, ZERODHA_ALLOWLIST);
    const message = contractNoteMessage('m-1', 'att-1');

    fetchAccountMessagesMock.mock.mockImplementation(async () => ({ messages: [message], skipped: [], capped: false }));
    fetchAttachmentDataMock.mock.mockImplementation(async () => loadPdf('contract-note-locked.pdf'));
    extractTransactionalMock.mock.mockImplementation(async (model, input) => {
      if (input.attachmentText) {
        assert.match(input.attachmentText, /TCS/);
        return {
          outcome: 'extracted', intent: 'transaction', confidence: 0.95,
          passwordHint: null, facts: [{ type: 'trade', symbol: 'TCS', side: 'buy', quantity: 5, price: 3200 }],
        };
      }
      return {
        outcome: 'extracted', intent: 'transaction', confidence: 0.6,
        passwordHint: 'The password is your PAN followed by your date of birth in DDMMYYYY format.',
        facts: [],
      };
    });

    const { processAccount } = await loadPipeline();
    const result = await processAccount(accountId);

    assert.equal(result.extracted, 1);
    assert.equal(extractTransactionalMock.mock.callCount(), 2);
    const holding = testDb.prepare('SELECT * FROM portfolio').get();
    assert.equal(holding.symbol, 'TCS');
    assert.equal(holding.quantity, 5);

    const row = testDb.prepare('SELECT * FROM processed_emails WHERE gmailMessageId = ?').get('m-1');
    assert.equal(row.outcome, 'extracted');

    // The winning password is now on file for this sender.
    const stored = testDb.prepare('SELECT * FROM document_passwords WHERE senderPattern = ?').get('noreply@zerodha.com');
    assert.ok(stored);
  });
});

describe('processMessage — unreadable (image-only) attachment', () => {
  test('is skipped with reason unreadable, no extra extraction call', async () => {
    const accountId = seedAccount(testDb);
    seedAllowlist(testDb, accountId, ZERODHA_ALLOWLIST);
    const message = contractNoteMessage('m-2', 'att-2');

    fetchAccountMessagesMock.mock.mockImplementation(async () => ({ messages: [message], skipped: [], capped: false }));
    fetchAttachmentDataMock.mock.mockImplementation(async () => loadPdf('image-only.pdf'));
    extractTransactionalMock.mock.mockImplementation(async () => ({
      outcome: 'extracted', intent: 'transaction', confidence: 0.8, passwordHint: null, facts: [],
    }));

    const { processAccount } = await loadPipeline();
    const result = await processAccount(accountId);

    assert.equal(result.skipped, 1);
    assert.equal(extractTransactionalMock.mock.callCount(), 1); // only the bodyText-only pass
    const row = testDb.prepare('SELECT * FROM processed_emails WHERE gmailMessageId = ?').get('m-2');
    assert.equal(row.outcome, 'skipped');
    assert.equal(row.reason, 'unreadable');
  });
});

describe('processMessage — unresolvable password lands in the locked queue', () => {
  test('is skipped with reason locked when no candidate password works', async () => {
    const accountId = seedAccount(testDb);
    seedAllowlist(testDb, accountId, [{ pattern: 'billing@random-vendor.com', kind: 'sender', type: 'transactional' }]);
    const message = contractNoteMessage('m-3', 'att-3', {
      sender: 'billing@random-vendor.com',
      bodyText: 'Your statement is attached.', // no password hint at all
    });

    fetchAccountMessagesMock.mock.mockImplementation(async () => ({ messages: [message], skipped: [], capped: false }));
    fetchAttachmentDataMock.mock.mockImplementation(async () => loadPdf('unresolvable-locked.pdf'));
    extractTransactionalMock.mock.mockImplementation(async () => ({
      outcome: 'extracted', intent: 'statement', confidence: 0.8, passwordHint: null, facts: [],
    }));

    const { processAccount } = await loadPipeline();
    const result = await processAccount(accountId);

    assert.equal(result.skipped, 1);
    const row = testDb.prepare('SELECT * FROM processed_emails WHERE gmailMessageId = ?').get('m-3');
    assert.equal(row.outcome, 'skipped');
    assert.equal(row.reason, 'locked');
  });

  test('reprocessMessage: entering the password once unlocks it, and it is stored for future documents from that sender', async () => {
    const accountId = seedAccount(testDb);
    seedAllowlist(testDb, accountId, [{ pattern: 'billing@random-vendor.com', kind: 'sender', type: 'transactional' }]);
    const message = contractNoteMessage('m-4', 'att-4', {
      sender: 'billing@random-vendor.com',
      bodyText: 'Your statement is attached.',
    });

    fetchAccountMessagesMock.mock.mockImplementation(async () => ({ messages: [message], skipped: [], capped: false }));
    fetchAttachmentDataMock.mock.mockImplementation(async () => loadPdf('unresolvable-locked.pdf'));
    extractTransactionalMock.mock.mockImplementation(async () => ({
      outcome: 'extracted', intent: 'statement', confidence: 0.8, passwordHint: null,
      facts: [{ type: 'task', title: 'Review statement', due: null, priority: 'low' }],
    }));

    const { processAccount, reprocessMessage } = await loadPipeline();
    await processAccount(accountId);
    assert.equal(testDb.prepare('SELECT * FROM processed_emails WHERE gmailMessageId = ?').get('m-4').reason, 'locked');

    // The user enters the real password once (this is what routes/ingest.js
    // does before calling reprocessMessage).
    const { storePassword } = await import('../src/ingest/passwords.js');
    storePassword(testDb, 'billing@random-vendor.com', 'xyzzy-totally-unrelated-42');

    fetchSingleMessageMock.mock.mockImplementation(async () => message);
    const outcome = await reprocessMessage('m-4');

    assert.equal(outcome, 'extracted');
    const row = testDb.prepare('SELECT * FROM processed_emails WHERE gmailMessageId = ?').get('m-4');
    assert.equal(row.outcome, 'extracted');
    assert.equal(testDb.prepare('SELECT COUNT(*) AS c FROM tasks').get().c, 1);

    // A second, different message from the same sender resolves immediately
    // via the now-stored password, with no user interaction and no hint.
    fetchAccountMessagesMock.mock.mockImplementation(async () => ({
      messages: [contractNoteMessage('m-5', 'att-5', { sender: 'billing@random-vendor.com', bodyText: 'Another statement.' })],
      skipped: [], capped: false,
    }));
    fetchAttachmentDataMock.mock.mockImplementation(async () => loadPdf('unresolvable-locked.pdf'));
    const second = await processAccount(accountId);
    assert.equal(second.extracted, 1);
  });
});
