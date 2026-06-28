import { Router } from 'express';
import {
  getReminders, addReminder, removeReminder, updateReminder, toggleReminder,
} from '../store/db.js';

const router = Router();

router.get('/', (req, res) => res.json(getReminders()));

router.post('/', (req, res) => {
  const id = addReminder(req.body);
  res.json({ id });
});

router.put('/:id', (req, res) => {
  updateReminder(req.params.id, req.body);
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  removeReminder(req.params.id);
  res.json({ ok: true });
});

router.patch('/:id/toggle', (req, res) => {
  toggleReminder(req.params.id);
  res.json({ ok: true });
});

export default router;
