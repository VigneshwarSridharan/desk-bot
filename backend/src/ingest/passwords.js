// Password-resolution chain for locked PDF attachments (ENGINEERING.md §4.2
// / PRD F1.3): email-stated formula -> known-sender formula table -> stored
// per-sender password -> (caller) queue for the user. Never brute-forces —
// at most MAX_CANDIDATES attempts total across every tier.
//
// Formulas are computed over the user's own identity vault fields (PAN,
// DOB, mobile, account numbers) — the password itself is never guessed,
// only derived from a stated rule, a known institution formula, or a value
// the user previously entered once.

import crypto from 'node:crypto';
import { getSecret, encrypt, decrypt } from '../store/vault.js';

export const MAX_CANDIDATES = 8;

export const VAULT_FIELD_KEYS = ['name', 'dob', 'mobile', 'pan', 'accountNumbers'];

// A handful of illustrative known-sender formulas (ENGINEERING §4.2 step 2).
// Real formulas vary by institution — this table is meant to be extended as
// senders are onboarded, not to be exhaustive.
const KNOWN_SENDER_FORMULAS = [
  { pattern: /zerodha\.com$/i, fields: ['pan', 'dob'] },
  { pattern: /icicidirect\.com$/i, fields: ['pan', 'dob'] },
  { pattern: /hdfcbank\.(net|com)$/i, fields: ['dob'] },
];

const FIELD_HINT_PATTERNS = [
  { key: 'pan', re: /\bpan\b/i },
  { key: 'dob', re: /\b(dob|date of birth|birth ?date)\b/i },
  { key: 'mobile', re: /\b(mobile|phone)\b/i },
  { key: 'accountNumbers', re: /\b(account\s*(number|no)|folio)\b/i },
];

export function normalizeSender(sender) {
  const match = String(sender || '').match(/<([^>]+)>/);
  const email = match ? match[1] : sender;
  return String(email || '').trim().toLowerCase();
}

function formatDob(dob, format) {
  const [y, m, d] = String(dob).split('-');
  if (!y || !m || !d) return null;
  if (format === 'DDMM') return `${d}${m}`;
  return `${d}${m}${y}`;
}

// Each field yields one or more plausible string variants — the caller
// combines these across fields to build full candidate passwords.
function fieldVariants(key, vault) {
  const value = vault[key];
  if (!value) return [];
  switch (key) {
    case 'pan':
      return [...new Set([value.toUpperCase(), value.toLowerCase()])];
    case 'dob': {
      const long = formatDob(value, 'DDMMYYYY');
      const short = formatDob(value, 'DDMM');
      return [long, short].filter(Boolean);
    }
    case 'mobile':
    case 'accountNumbers': {
      const digits = value.replace(/\D/g, '');
      return digits ? [...new Set([digits.slice(-4), digits])] : [];
    }
    default:
      return [];
  }
}

function cartesian(lists) {
  return lists.reduce((acc, list) => acc.flatMap((prefix) => list.map((v) => prefix + v)), ['']);
}

function candidatesFromFields(fields, vault) {
  const lists = fields.map((key) => fieldVariants(key, vault));
  if (lists.some((l) => l.length === 0)) return []; // a required vault field is missing — can't compute this formula
  return cartesian(lists);
}

// Detects which vault fields a verbatim password-hint sentence references,
// in the order they're mentioned, then composes candidates the same way as
// a known-sender formula.
export function candidatesFromHint(hint, vault) {
  if (!hint) return [];
  const order = FIELD_HINT_PATTERNS
    .map((f) => ({ key: f.key, index: hint.search(f.re) }))
    .filter((m) => m.index !== -1)
    .sort((a, b) => a.index - b.index)
    .map((m) => m.key);
  if (!order.length) return [];
  return candidatesFromFields(order, vault);
}

function candidatesFromKnownSender(sender, vault) {
  const match = KNOWN_SENDER_FORMULAS.find((f) => f.pattern.test(sender));
  return match ? candidatesFromFields(match.fields, vault) : [];
}

function loadVaultFields(db) {
  const fields = {};
  for (const key of VAULT_FIELD_KEYS) fields[key] = getSecret(db, key);
  return fields;
}

export function getStoredPassword(db, senderPattern) {
  const row = db.prepare('SELECT passwordEnc FROM document_passwords WHERE senderPattern = ?').get(senderPattern);
  return row ? decrypt(row.passwordEnc) : null;
}

export function storePassword(db, senderPattern, password) {
  const passwordEnc = encrypt(password);
  const existing = db.prepare('SELECT id FROM document_passwords WHERE senderPattern = ?').get(senderPattern);
  if (existing) {
    db.prepare(`UPDATE document_passwords SET passwordEnc = ?, lastUsedAt = datetime('now') WHERE id = ?`)
      .run(passwordEnc, existing.id);
  } else {
    db.prepare(`INSERT INTO document_passwords (id, senderPattern, passwordEnc, lastUsedAt) VALUES (?, ?, ?, datetime('now'))`)
      .run(crypto.randomUUID(), senderPattern, passwordEnc);
  }
}

function dedupCapped(list, cap) {
  const seen = new Set();
  const out = [];
  for (const candidate of list) {
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    out.push(candidate);
    if (out.length >= cap) break;
  }
  return out;
}

/**
 * Resolution chain (ENGINEERING §4.2): tries, in order, candidates derived
 * from the email's own password hint, a known-sender formula table, and a
 * previously stored per-sender password — at most MAX_CANDIDATES attempts
 * total, never brute-forced. `tryPassword(candidate)` should attempt to
 * actually open the document and resolve true/false. On success the
 * winning candidate is persisted (encrypted) for this sender so future
 * documents resolve on the stored-password tier alone. Returns the winning
 * password, or null if every tier is exhausted (caller should queue for
 * the user).
 */
export async function resolveAttachmentPassword({ db, sender, passwordHint, tryPassword }) {
  const senderKey = normalizeSender(sender);
  const vault = loadVaultFields(db);

  const candidates = [
    ...candidatesFromHint(passwordHint, vault),
    ...candidatesFromKnownSender(senderKey, vault),
  ];
  const stored = getStoredPassword(db, senderKey);
  if (stored) candidates.push(stored);

  const unique = dedupCapped(candidates, MAX_CANDIDATES);
  for (const candidate of unique) {
    // eslint-disable-next-line no-await-in-loop
    if (await tryPassword(candidate)) {
      storePassword(db, senderKey, candidate);
      return candidate;
    }
  }
  return null;
}
