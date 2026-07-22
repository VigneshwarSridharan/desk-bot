// Encrypted secrets store (identity fields, per-sender document passwords,
// OAuth tokens). AES-256-GCM, per-value random 12-byte IV, encoded as
// `v1:<iv b64>:<authTag b64>:<ciphertext b64>` in a TEXT column.
//
// Functions take a caller-supplied `db` (a node:sqlite DatabaseSync instance)
// so they can run against any database, same pattern as migrations.js.
// No route or agent should ever see ciphertext or VAULT_KEY — only
// putSecret/getSecret cross that boundary.

import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const KEY_LENGTH = 32;

const SENTINEL_KEY = '__vault_check__';
const SENTINEL_VALUE = 'vault-ok';

let vaultDisabled = false;

function loadKey() {
  const b64 = process.env.VAULT_KEY;
  if (!b64) {
    throw new Error('VAULT_KEY is not set — run `npm run gen-vault-key` to generate one.');
  }
  const key = Buffer.from(b64, 'base64');
  if (key.length !== KEY_LENGTH) {
    throw new Error(`VAULT_KEY must decode to ${KEY_LENGTH} bytes, got ${key.length}`);
  }
  return key;
}

export function encrypt(plaintext) {
  const key = loadKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
}

export function decrypt(encoded) {
  const parts = String(encoded).split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('Unrecognized vault ciphertext format');
  }
  const key = loadKey();
  const [, ivB64, tagB64, ciphertextB64] = parts;
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const ciphertext = Buffer.from(ciphertextB64, 'base64');
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

export function putSecret(db, key, value) {
  const valueEnc = encrypt(value);
  db.prepare(`
    INSERT INTO identity_vault (key, valueEnc, updatedAt)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET valueEnc = excluded.valueEnc, updatedAt = excluded.updatedAt
  `).run(key, valueEnc);
}

export function getSecret(db, key) {
  const row = db.prepare('SELECT valueEnc FROM identity_vault WHERE key = ?').get(key);
  if (!row) return null;
  return decrypt(row.valueEnc);
}

export function deleteSecret(db, key) {
  db.prepare('DELETE FROM identity_vault WHERE key = ?').run(key);
}

// Verifies VAULT_KEY against a sentinel row, establishing it on first run.
// Never throws — a missing/wrong key is a disable-and-log condition, not a
// crash, so callers can run this unconditionally at boot.
export function checkVaultKey(db) {
  try {
    const row = db.prepare('SELECT valueEnc FROM identity_vault WHERE key = ?').get(SENTINEL_KEY);
    if (!row) {
      putSecret(db, SENTINEL_KEY, SENTINEL_VALUE);
      vaultDisabled = false;
      return { ok: true, fresh: true };
    }
    const value = decrypt(row.valueEnc);
    if (value !== SENTINEL_VALUE) {
      throw new Error('vault sentinel value mismatch');
    }
    vaultDisabled = false;
    return { ok: true, fresh: false };
  } catch (err) {
    vaultDisabled = true;
    console.error(`[vault] VAULT_KEY is missing or incorrect — vault-backed features (ingestion, Google sync, stored document passwords) are disabled: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

export function isVaultDisabled() {
  return vaultDisabled;
}
