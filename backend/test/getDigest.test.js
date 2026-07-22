// get_digest context-agent tool (Task 11 / ENGINEERING §5.3): unexpired
// newsletter digest headlines for the ambient inbox_digest band.

import { test, describe, mock, beforeEach } from 'node:test';
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

const testDb = makeDb();

function getActiveDigestItems() {
  const now = new Date().toISOString();
  return testDb.prepare(`
    SELECT * FROM digest_items
    WHERE expiresAt IS NULL OR expiresAt >= ?
    ORDER BY receivedAt DESC
  `).all(now);
}

mock.module('../src/store/db.js', {
  namedExports: { getActiveDigestItems },
});

const { getDigestTool } = await import('../src/tools/getDigest.js');

function seedEmail(id) {
  testDb.prepare(`
    INSERT INTO mail_accounts (id, emailAddress, label, status) VALUES ('acct-1', 'a@example.com', '', 'connected')
  `).run();
  testDb.prepare(`
    INSERT INTO processed_emails (gmailMessageId, accountId, sender, subject, outcome)
    VALUES (?, 'acct-1', 'newsletter@example.com', 'Weekly digest', 'extracted')
  `).run(id);
}

function seedDigestItem(overrides = {}) {
  const id = overrides.id || crypto.randomUUID();
  testDb.prepare(`
    INSERT INTO digest_items (id, headline, sourceSender, accountId, sourceEmailId, receivedAt, expiresAt)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    overrides.headline || 'Headline',
    overrides.sourceSender || 'newsletter@example.com',
    overrides.accountId ?? null,
    overrides.sourceEmailId ?? null,
    overrides.receivedAt || new Date().toISOString(),
    overrides.expiresAt === undefined ? null : overrides.expiresAt,
  );
  return id;
}

beforeEach(() => {
  testDb.exec('DELETE FROM digest_items; DELETE FROM processed_emails; DELETE FROM mail_accounts;');
});

describe('getDigestTool', () => {
  test('returns an unexpired item', async () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    seedDigestItem({ headline: 'Still fresh', expiresAt: future });
    const result = await getDigestTool.execute({});
    assert.equal(result.count, 1);
    assert.equal(result.items[0].headline, 'Still fresh');
  });

  test('omits an expired item', async () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    seedDigestItem({ headline: 'Stale', expiresAt: past });
    const result = await getDigestTool.execute({});
    assert.equal(result.count, 0);
  });

  test('an item with no expiry is treated as unexpired', async () => {
    seedDigestItem({ headline: 'No expiry', expiresAt: null });
    const result = await getDigestTool.execute({});
    assert.equal(result.count, 1);
  });

  test('an email-linked digest item still surfaces its source sender', async () => {
    const emailId = 'msg-1';
    seedEmail(emailId);
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    seedDigestItem({ headline: 'From a real email', sourceEmailId: emailId, expiresAt: future });
    const result = await getDigestTool.execute({});
    assert.equal(result.items[0].sourceSender, 'newsletter@example.com');
  });
});
