import { Router } from 'express';
import crypto from 'node:crypto';
import db from '../store/db.js';
import { getAuthUrl, connectAccount, revokeAccount } from '../google/auth.js';

const router = Router();

// Loopback OAuth flow, single backend process — an in-memory nonce set is
// enough to prevent a stale/forged callback from completing.
const pendingStates = new Set();

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function connectionPage(title, message) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body style="font-family: sans-serif; background:#0a0a0a; color:#eee; padding:2rem;">
<h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>
</body></html>`;
}

router.get('/', (req, res) => {
  const accounts = db.prepare(`
    SELECT id, emailAddress, label, status, connectedAt, lastError FROM mail_accounts ORDER BY connectedAt ASC
  `).all();
  res.json(accounts);
});

router.get('/google/start', (req, res) => {
  const { label } = req.query;
  try {
    const nonce = crypto.randomUUID();
    pendingStates.add(nonce);
    const state = label ? `${nonce}:${label}` : nonce;
    res.json({ url: getAuthUrl(state) });
  } catch (err) {
    res.status(500).json({ error: { code: 'oauth_config', message: err.message } });
  }
});

router.get('/google/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) {
    return res.status(400).send(connectionPage('Connection failed', String(error)));
  }
  if (!code || !state) {
    return res.status(400).send(connectionPage('Connection failed', 'Missing authorization code or state.'));
  }
  const [nonce, label] = String(state).split(':');
  if (!pendingStates.has(nonce)) {
    return res.status(400).send(connectionPage('Connection failed', 'This connection request expired or was already used. Try connecting again.'));
  }
  pendingStates.delete(nonce);

  try {
    const { emailAddress } = await connectAccount({ code, label });
    res.send(connectionPage('Connected', `${emailAddress} is now connected. You can close this tab.`));
  } catch (err) {
    res.status(500).send(connectionPage('Connection failed', err.message));
  }
});

router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const purge = req.query.purge === 'true';
  const account = db.prepare('SELECT id FROM mail_accounts WHERE id = ?').get(id);
  if (!account) return res.status(404).json({ error: { code: 'not_found', message: 'Account not found' } });

  await revokeAccount(id);

  if (purge) {
    db.prepare('DELETE FROM digest_items WHERE accountId = ?').run(id);
    db.prepare('DELETE FROM processed_emails WHERE accountId = ?').run(id);
    db.prepare('DELETE FROM allowlist_entries WHERE accountId = ?').run(id);
    db.prepare('DELETE FROM mail_accounts WHERE id = ?').run(id);
  } else {
    db.prepare("UPDATE mail_accounts SET status = 'revoked' WHERE id = ?").run(id);
  }

  res.json({ ok: true });
});

router.get('/:id/allowlist', (req, res) => {
  const { id } = req.params;
  const account = db.prepare('SELECT id FROM mail_accounts WHERE id = ?').get(id);
  if (!account) return res.status(404).json({ error: { code: 'not_found', message: 'Account not found' } });

  const entries = db.prepare('SELECT * FROM allowlist_entries WHERE accountId = ? ORDER BY pattern ASC').all(id);
  res.json(entries);
});

router.put('/:id/allowlist', (req, res) => {
  const { id } = req.params;
  const account = db.prepare('SELECT id FROM mail_accounts WHERE id = ?').get(id);
  if (!account) return res.status(404).json({ error: { code: 'not_found', message: 'Account not found' } });

  const entries = Array.isArray(req.body?.entries) ? req.body.entries : [];
  db.prepare('DELETE FROM allowlist_entries WHERE accountId = ?').run(id);
  const insert = db.prepare('INSERT INTO allowlist_entries (id, accountId, pattern, kind, type) VALUES (?, ?, ?, ?, ?)');
  for (const entry of entries) {
    if (!entry?.pattern) continue;
    insert.run(
      crypto.randomUUID(),
      id,
      entry.pattern,
      entry.kind === 'label' ? 'label' : 'sender',
      entry.type === 'newsletter' ? 'newsletter' : 'transactional',
    );
  }

  res.json(db.prepare('SELECT * FROM allowlist_entries WHERE accountId = ? ORDER BY pattern ASC').all(id));
});

export default router;
