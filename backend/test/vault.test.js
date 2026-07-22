import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createBaseTables, runMigrations } from '../src/store/migrations.js';
import {
  encrypt, decrypt, putSecret, getSecret, deleteSecret, checkVaultKey, isVaultDisabled,
} from '../src/store/vault.js';

function makeKey() {
  return randomBytes(32).toString('base64');
}

function makeDb() {
  const db = new DatabaseSync(':memory:');
  createBaseTables(db);
  runMigrations(db);
  return db;
}

let originalVaultKey;

beforeEach(() => {
  originalVaultKey = process.env.VAULT_KEY;
});

afterEach(() => {
  if (originalVaultKey === undefined) delete process.env.VAULT_KEY;
  else process.env.VAULT_KEY = originalVaultKey;
});

describe('encrypt/decrypt', () => {
  test('round-trip returns the original value', () => {
    process.env.VAULT_KEY = makeKey();
    const encoded = encrypt('super-secret-value');
    assert.equal(decrypt(encoded), 'super-secret-value');
  });

  test('encodes as v1:<iv>:<tag>:<ciphertext>', () => {
    process.env.VAULT_KEY = makeKey();
    const encoded = encrypt('hello');
    const parts = encoded.split(':');
    assert.equal(parts.length, 4);
    assert.equal(parts[0], 'v1');
  });

  test('flipping one ciphertext byte throws', () => {
    process.env.VAULT_KEY = makeKey();
    const encoded = encrypt('super-secret-value');
    const [v, iv, tag, ciphertext] = encoded.split(':');
    const bytes = Buffer.from(ciphertext, 'base64');
    bytes[0] ^= 0xff; // flip a bit — GCM auth tag must reject this
    const tampered = [v, iv, tag, bytes.toString('base64')].join(':');
    assert.throws(() => decrypt(tampered));
  });

  test('decrypting with the wrong key throws', () => {
    process.env.VAULT_KEY = makeKey();
    const encoded = encrypt('super-secret-value');
    process.env.VAULT_KEY = makeKey();
    assert.throws(() => decrypt(encoded));
  });

  test('missing VAULT_KEY throws a clear error', () => {
    delete process.env.VAULT_KEY;
    assert.throws(() => encrypt('x'), /VAULT_KEY is not set/);
  });

  test('malformed VAULT_KEY length throws a clear error', () => {
    process.env.VAULT_KEY = Buffer.from('too-short').toString('base64');
    assert.throws(() => encrypt('x'), /must decode to 32 bytes/);
  });
});

describe('putSecret/getSecret', () => {
  test('round-trips through identity_vault', () => {
    process.env.VAULT_KEY = makeKey();
    const db = makeDb();
    putSecret(db, 'pan', 'ABCDE1234F');
    assert.equal(getSecret(db, 'pan'), 'ABCDE1234F');
  });

  test('getSecret returns null for an unknown key', () => {
    process.env.VAULT_KEY = makeKey();
    const db = makeDb();
    assert.equal(getSecret(db, 'nope'), null);
  });

  test('putSecret upserts on repeated writes', () => {
    process.env.VAULT_KEY = makeKey();
    const db = makeDb();
    putSecret(db, 'mobile', '9999999999');
    putSecret(db, 'mobile', '8888888888');
    assert.equal(getSecret(db, 'mobile'), '8888888888');
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM identity_vault WHERE key = ?').get('mobile').c, 1);
  });

  test('never stores plaintext in the table', () => {
    process.env.VAULT_KEY = makeKey();
    const db = makeDb();
    putSecret(db, 'dob', '1990-01-01');
    const row = db.prepare('SELECT valueEnc FROM identity_vault WHERE key = ?').get('dob');
    assert.ok(row.valueEnc.startsWith('v1:'));
    assert.ok(!row.valueEnc.includes('1990-01-01'));
  });

  test('deleteSecret removes the row', () => {
    process.env.VAULT_KEY = makeKey();
    const db = makeDb();
    putSecret(db, 'pan', 'ABCDE1234F');
    deleteSecret(db, 'pan');
    assert.equal(getSecret(db, 'pan'), null);
  });
});

describe('checkVaultKey', () => {
  test('establishes a sentinel on a fresh vault', () => {
    process.env.VAULT_KEY = makeKey();
    const db = makeDb();
    const result = checkVaultKey(db);
    assert.equal(result.ok, true);
    assert.equal(result.fresh, true);
    assert.equal(isVaultDisabled(), false);
  });

  test('passes on subsequent boots with the same key', () => {
    process.env.VAULT_KEY = makeKey();
    const db = makeDb();
    checkVaultKey(db);
    const result = checkVaultKey(db);
    assert.equal(result.ok, true);
    assert.equal(result.fresh, false);
    assert.equal(isVaultDisabled(), false);
  });

  test('wrong key against a non-empty vault fails loudly instead of returning garbage', () => {
    process.env.VAULT_KEY = makeKey();
    const db = makeDb();
    checkVaultKey(db); // establishes sentinel + baseline data
    putSecret(db, 'pan', 'ABCDE1234F');

    process.env.VAULT_KEY = makeKey(); // simulate a lost/rotated key
    const result = checkVaultKey(db);

    assert.equal(result.ok, false);
    assert.ok(result.error);
    assert.equal(isVaultDisabled(), true);
  });

  test('missing VAULT_KEY fails loudly without throwing', () => {
    const db = makeDb();
    delete process.env.VAULT_KEY;
    const result = checkVaultKey(db);
    assert.equal(result.ok, false);
    assert.equal(isVaultDisabled(), true);
  });
});
