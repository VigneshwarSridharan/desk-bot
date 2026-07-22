// Vault API (Task 12 / ENGINEERING §6, PRD G6): masked reads, encrypted
// writes, and a confirm-gated full wipe. Uses a real in-memory DB + real
// VAULT_KEY so store/vault.js's actual encryption runs, since masking
// correctness (never leaking the plaintext) is the whole point here.

import { test, describe, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createBaseTables, runMigrations } from '../src/store/migrations.js';
import { putSecret } from '../src/store/vault.js';

function makeDb() {
  const db = new DatabaseSync(':memory:');
  createBaseTables(db);
  runMigrations(db);
  return db;
}

const testDb = makeDb();
process.env.VAULT_KEY = randomBytes(32).toString('base64');

mock.module('../src/store/db.js', { defaultExport: testDb });
const { default: vaultRoutes } = await import('../src/routes/vault.js');

let server;
let baseUrl;

before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/vault', vaultRoutes);
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/vault`;
});

after(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => {
  testDb.exec("DELETE FROM identity_vault; DELETE FROM document_passwords; DELETE FROM oauth_tokens; DELETE FROM mail_accounts;");
  putSecret(testDb, '__vault_check__', 'vault-ok');
});

describe('GET /api/vault', () => {
  test('reports unset fields with no masked value', async () => {
    const res = await fetch(baseUrl);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.pan.set, false);
    assert.equal(body.pan.masked, null);
  });

  test('never returns the plaintext value, only a masked form', async () => {
    await fetch(baseUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pan: 'ABCDE1234F' }),
    });
    const res = await fetch(baseUrl);
    const body = await res.json();
    assert.equal(body.pan.set, true);
    assert.notEqual(body.pan.masked, 'ABCDE1234F');
    assert.match(body.pan.masked, /^AB•+34F$/);

    const row = testDb.prepare("SELECT valueEnc FROM identity_vault WHERE key = 'pan'").get();
    assert.ok(row.valueEnc.startsWith('v1:'));
  });
});

describe('PUT /api/vault', () => {
  test('upserts only known vault fields, ignoring unknown keys', async () => {
    const res = await fetch(baseUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dob: '1990-01-15', notAField: 'x' }),
    });
    assert.equal(res.status, 200);

    const row = testDb.prepare("SELECT key FROM identity_vault WHERE key = 'notAField'").get();
    assert.equal(row, undefined);
    const dobRow = testDb.prepare("SELECT valueEnc FROM identity_vault WHERE key = 'dob'").get();
    assert.ok(dobRow);
  });

  test('an empty string clears a previously-set field', async () => {
    await fetch(baseUrl, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mobile: '9876543210' }),
    });
    await fetch(baseUrl, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mobile: '' }),
    });
    const res = await fetch(baseUrl);
    const body = await res.json();
    assert.equal(body.mobile.set, false);
  });
});

describe('DELETE /api/vault', () => {
  test('requires an explicit confirm token', async () => {
    const res = await fetch(baseUrl, { method: 'DELETE' });
    assert.equal(res.status, 400);
  });

  test('wipes identity fields, document passwords, and oauth tokens when confirmed', async () => {
    await fetch(baseUrl, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pan: 'ABCDE1234F' }),
    });
    testDb.prepare(`INSERT INTO document_passwords (id, senderPattern, passwordEnc) VALUES ('dp-1', 'x@y.com', 'v1:a:b:c')`).run();
    testDb.prepare(`INSERT INTO mail_accounts (id, emailAddress, status) VALUES ('acct-1', 'a@b.com', 'connected')`).run();
    testDb.prepare(`INSERT INTO oauth_tokens (id, accountId, service, refreshTokenEnc) VALUES ('tok-1', 'acct-1', 'gmail', 'v1:a:b:c')`).run();

    const res = await fetch(baseUrl, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: 'DELETE' }),
    });
    assert.equal(res.status, 200);

    assert.equal(testDb.prepare("SELECT COUNT(*) AS c FROM identity_vault WHERE key = 'pan'").get().c, 0);
    assert.equal(testDb.prepare('SELECT COUNT(*) AS c FROM document_passwords').get().c, 0);
    assert.equal(testDb.prepare('SELECT COUNT(*) AS c FROM oauth_tokens').get().c, 0);
    // The vault_check sentinel itself is untouched by a data wipe.
    assert.ok(testDb.prepare("SELECT 1 FROM identity_vault WHERE key = '__vault_check__'").get());
  });
});
