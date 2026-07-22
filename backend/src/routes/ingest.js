// Ingestion admin API per ENGINEERING.md §6 (Task 10 scope: activity, manual
// trigger, fact rejection — the locked-document queue is Task 12).

import { Router } from 'express';
import db from '../store/db.js';
import { runIngestCycle, isIngestRunning } from '../ingestScheduler.js';
import { rejectFact } from '../ingest/pipeline.js';

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

export default router;
