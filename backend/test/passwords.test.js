// Password-resolution chain (Task 12 / ENGINEERING §4.2 / PRD F1.3):
// hint-derived candidates, known-sender formula table, stored per-sender
// passwords, and the ≤8-candidate cap. Uses a real in-memory DB (for
// document_passwords) and a real VAULT_KEY (for the encrypted store), so
// the whole chain runs as it would in production, with a fake
// `tryPassword` standing in for the actual PDF-opening attempt.

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createBaseTables, runMigrations } from '../src/store/migrations.js';
import { putSecret } from '../src/store/vault.js';
import {
  candidatesFromHint, normalizeSender, resolveAttachmentPassword,
  getStoredPassword, storePassword, MAX_CANDIDATES,
} from '../src/ingest/passwords.js';

let originalVaultKey;
before(() => {
  originalVaultKey = process.env.VAULT_KEY;
  process.env.VAULT_KEY = randomBytes(32).toString('base64');
});
after(() => {
  if (originalVaultKey === undefined) delete process.env.VAULT_KEY;
  else process.env.VAULT_KEY = originalVaultKey;
});

function makeDb() {
  const db = new DatabaseSync(':memory:');
  createBaseTables(db);
  runMigrations(db);
  return db;
}

let db;
beforeEach(() => {
  db = makeDb();
});

describe('normalizeSender', () => {
  test('extracts the email address out of a "Name <email>" header', () => {
    assert.equal(normalizeSender('Zerodha <noreply@Zerodha.com>'), 'noreply@zerodha.com');
  });

  test('lowercases and trims a bare address', () => {
    assert.equal(normalizeSender('  Person@Example.COM '), 'person@example.com');
  });
});

describe('candidatesFromHint', () => {
  const vault = { pan: 'ABCDE1234F', dob: '1990-01-15', mobile: '+91 98765 43210', accountNumbers: null };

  test('composes PAN + DOB in the order the hint mentions them', () => {
    const hint = 'The password is your PAN followed by your date of birth in DDMMYYYY format.';
    const candidates = candidatesFromHint(hint, vault);
    assert.ok(candidates.includes('ABCDE1234F15011990'));
  });

  test('respects hint order when DOB is mentioned before PAN', () => {
    const hint = 'Use your date of birth followed by PAN.';
    const candidates = candidatesFromHint(hint, vault);
    assert.ok(candidates.includes('15011990ABCDE1234F'));
  });

  test('returns no candidates when a required vault field is missing', () => {
    const hint = 'Password is your account number.';
    const candidates = candidatesFromHint(hint, vault); // accountNumbers is null
    assert.deepEqual(candidates, []);
  });

  test('returns no candidates when the hint mentions no known field', () => {
    assert.deepEqual(candidatesFromHint('Ask the sender directly.', vault), []);
  });

  test('returns no candidates for an empty hint', () => {
    assert.deepEqual(candidatesFromHint(null, vault), []);
    assert.deepEqual(candidatesFromHint('', vault), []);
  });
});

describe('stored per-sender password', () => {
  test('round-trips through storePassword/getStoredPassword, encrypted at rest', () => {
    storePassword(db, 'noreply@zerodha.com', 'my-secret-pw');
    assert.equal(getStoredPassword(db, 'noreply@zerodha.com'), 'my-secret-pw');

    const row = db.prepare('SELECT passwordEnc FROM document_passwords WHERE senderPattern = ?').get('noreply@zerodha.com');
    assert.ok(row.passwordEnc.startsWith('v1:'));
    assert.notEqual(row.passwordEnc, 'my-secret-pw');
  });

  test('storing again for the same sender updates rather than duplicates', () => {
    storePassword(db, 'noreply@zerodha.com', 'first');
    storePassword(db, 'noreply@zerodha.com', 'second');
    assert.equal(getStoredPassword(db, 'noreply@zerodha.com'), 'second');
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM document_passwords').get().c, 1);
  });

  test('returns null for an unknown sender', () => {
    assert.equal(getStoredPassword(db, 'nobody@example.com'), null);
  });
});

describe('resolveAttachmentPassword', () => {
  test('resolves via the email hint formula and persists the winning password', async () => {
    putSecret(db, 'pan', 'ABCDE1234F');
    putSecret(db, 'dob', '1990-01-15');

    const tried = [];
    const password = await resolveAttachmentPassword({
      db,
      sender: 'noreply@zerodha.com',
      passwordHint: 'Password is your PAN followed by DOB in DDMMYYYY format.',
      tryPassword: async (candidate) => {
        tried.push(candidate);
        return candidate === 'ABCDE1234F15011990';
      },
    });

    assert.equal(password, 'ABCDE1234F15011990');
    assert.ok(tried.includes('ABCDE1234F15011990'));
    assert.equal(getStoredPassword(db, 'noreply@zerodha.com'), 'ABCDE1234F15011990');
  });

  test('falls back to the known-sender formula table when there is no usable hint', async () => {
    putSecret(db, 'pan', 'ABCDE1234F');
    putSecret(db, 'dob', '1990-01-15');

    const password = await resolveAttachmentPassword({
      db,
      sender: 'statements@zerodha.com',
      passwordHint: null,
      tryPassword: async (candidate) => candidate === 'ABCDE1234F15011990',
    });

    assert.equal(password, 'ABCDE1234F15011990');
  });

  test('falls back to a previously stored password when hint/known-table candidates are exhausted', async () => {
    storePassword(db, 'billing@some-random-vendor.com', 'previously-entered-pw');

    const password = await resolveAttachmentPassword({
      db,
      sender: 'billing@some-random-vendor.com',
      passwordHint: null, // no hint, and not in the known-sender table
      tryPassword: async (candidate) => candidate === 'previously-entered-pw',
    });

    assert.equal(password, 'previously-entered-pw');
  });

  test('returns null (queue for the user) when every tier is exhausted', async () => {
    const password = await resolveAttachmentPassword({
      db,
      sender: 'billing@unknown-vendor.com',
      passwordHint: 'Password is your account number.', // vault has no accountNumbers -> no candidates
      tryPassword: async () => false,
    });

    assert.equal(password, null);
    assert.equal(getStoredPassword(db, 'billing@unknown-vendor.com'), null);
  });

  test('never tries more than MAX_CANDIDATES attempts total', async () => {
    putSecret(db, 'pan', 'ABCDE1234F');
    putSecret(db, 'dob', '1990-01-15');
    putSecret(db, 'mobile', '9876543210');
    storePassword(db, 'many-candidates@example.com', 'stored-pw-too');

    let attempts = 0;
    const password = await resolveAttachmentPassword({
      db,
      sender: 'many-candidates@example.com',
      passwordHint: 'Try your PAN, then your DOB, then your mobile number.',
      tryPassword: async () => { attempts += 1; return false; },
    });

    assert.equal(password, null);
    assert.ok(attempts <= MAX_CANDIDATES, `expected <= ${MAX_CANDIDATES} attempts, got ${attempts}`);
  });
});
