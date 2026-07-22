// Bills API per ENGINEERING.md §6 — GET list, PATCH mark-paid/edit. Bills are
// written by the ingestion pipeline (ingest/pipeline.js); this route only
// reads and updates them for the admin panel.

import { Router } from 'express';
import db from '../store/db.js';

const router = Router();

const UPDATABLE_FIELDS = ['vendor', 'amount', 'currency', 'dueDate', 'status'];

router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM bills ORDER BY dueDate ASC').all());
});

router.patch('/:id', (req, res) => {
  const { id } = req.params;
  const bill = db.prepare('SELECT id FROM bills WHERE id = ?').get(id);
  if (!bill) return res.status(404).json({ error: { code: 'not_found', message: 'Bill not found' } });

  const fields = [];
  const values = [];
  for (const [key, value] of Object.entries(req.body || {})) {
    if (UPDATABLE_FIELDS.includes(key)) {
      fields.push(`${key} = ?`);
      values.push(value);
    }
  }
  if (fields.length) {
    values.push(id);
    db.prepare(`UPDATE bills SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }

  res.json(db.prepare('SELECT * FROM bills WHERE id = ?').get(id));
});

export default router;
