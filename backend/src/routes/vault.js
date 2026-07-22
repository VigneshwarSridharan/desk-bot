// Encrypted identity vault API (ENGINEERING.md §6 / PRD F2, G6): masked
// reads, plaintext-over-localhost writes (encrypted at rest), and a
// confirm-gated full wipe. No route ever returns a decrypted value in full
// — only `putSecret`/`getSecret` (store/vault.js) cross the plaintext
// boundary, and only this route calls them.

import { Router } from 'express';
import db from '../store/db.js';
import { putSecret, getSecret, deleteSecret } from '../store/vault.js';

const router = Router();

export const VAULT_FIELDS = ['name', 'dob', 'mobile', 'pan', 'accountNumbers'];

function mask(value) {
  const str = String(value);
  if (str.length <= 4) return '•'.repeat(str.length);
  return `${str.slice(0, 2)}${'•'.repeat(Math.max(3, str.length - 5))}${str.slice(-3)}`;
}

router.get('/', (req, res) => {
  const fields = {};
  for (const key of VAULT_FIELDS) {
    const value = getSecret(db, key);
    fields[key] = { set: !!value, masked: value ? mask(value) : null };
  }
  res.json(fields);
});

router.put('/', (req, res) => {
  const updates = req.body || {};
  for (const [key, value] of Object.entries(updates)) {
    if (!VAULT_FIELDS.includes(key)) continue;
    if (value === '' || value === null || value === undefined) {
      deleteSecret(db, key);
    } else {
      putSecret(db, key, String(value));
    }
  }
  res.json({ ok: true });
});

router.delete('/', (req, res) => {
  if (req.body?.confirm !== 'DELETE') {
    return res.status(400).json({
      error: { code: 'confirm_required', message: 'Pass { "confirm": "DELETE" } to wipe all vault data' },
    });
  }
  for (const key of VAULT_FIELDS) deleteSecret(db, key);
  db.exec('DELETE FROM document_passwords');
  db.exec('DELETE FROM oauth_tokens');
  res.json({ ok: true });
});

export default router;
