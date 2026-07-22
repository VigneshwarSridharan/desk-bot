// Ingestion admin API per ENGINEERING.md §6: activity, manual trigger, fact
// rejection (Task 10), and the locked-document password queue (Task 12).

import { Router } from 'express';
import db from '../store/db.js';
import { runIngestCycle, isIngestRunning } from '../ingestScheduler.js';
import { rejectFact, reprocessMessage } from '../ingest/pipeline.js';
import { storePassword, normalizeSender } from '../ingest/passwords.js';

const router = Router();

router.get('/activity', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const rows = db.prepare('SELECT * FROM processed_emails ORDER BY processedAt DESC LIMIT ?').all(limit);
  res.json(rows.map((row) => ({ ...row, factRefs: JSON.parse(row.factRefs || '[]') })));
});

router.post('/run', (req, res) => {
  if (isIngestRunning()) {
    return res.status(409).json({ error: { code: 'busy', message: 'Ingestion is already running' } });
  }
  runIngestCycle().catch((err) => console.error('[ingest-route] manual run failed:', err.message));
  res.json({ ok: true, started: true });
});

router.delete('/facts/:ref', (req, res) => {
  const removed = rejectFact(req.params.ref);
  if (!removed) return res.status(404).json({ error: { code: 'not_found', message: 'Fact not found' } });
  res.json({ ok: true });
});

router.get('/locked', (req, res) => {
  const rows = db.prepare(`
    SELECT * FROM processed_emails WHERE outcome = 'skipped' AND reason = 'locked' ORDER BY processedAt DESC
  `).all();
  res.json(rows.map((row) => ({ ...row, factRefs: JSON.parse(row.factRefs || '[]') })));
});

router.post('/locked/:emailId/password', async (req, res) => {
  const { emailId } = req.params;
  const { password } = req.body || {};
  if (!password) {
    return res.status(400).json({ error: { code: 'bad_request', message: 'password is required' } });
  }

  const row = db.prepare('SELECT sender FROM processed_emails WHERE gmailMessageId = ?').get(emailId);
  if (!row) return res.status(404).json({ error: { code: 'not_found', message: 'Locked email not found' } });

  // Stored up front so it's persisted (and available to every future
  // document from this sender) even if this particular reprocess attempt
  // fails for an unrelated reason.
  storePassword(db, normalizeSender(row.sender), password);

  try {
    const outcome = await reprocessMessage(emailId);
    res.json({ ok: true, outcome });
  } catch (err) {
    console.error(`[ingest-route] reprocessing ${emailId} failed:`, err.message);
    res.status(502).json({ error: { code: 'reprocess_failed', message: err.message } });
  }
});

export default router;
