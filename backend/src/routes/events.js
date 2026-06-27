import { Router } from 'express';
import { getEvents, addEvent, removeEvent, updateEvent } from '../store/db.js';

const router = Router();

router.get('/', (req, res) => res.json(getEvents()));

router.post('/', (req, res) => {
  const id = addEvent(req.body);
  res.json({ id });
});

router.put('/:id', (req, res) => {
  updateEvent(req.params.id, req.body);
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  removeEvent(req.params.id);
  res.json({ ok: true });
});

export default router;
