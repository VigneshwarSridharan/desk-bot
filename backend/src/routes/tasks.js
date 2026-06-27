import { Router } from 'express';
import { getTasks, addTask, removeTask, updateTask, toggleTask } from '../store/db.js';

const router = Router();

router.get('/', (req, res) => res.json(getTasks()));

router.post('/', (req, res) => {
  const id = addTask(req.body);
  res.json({ id });
});

router.put('/:id', (req, res) => {
  updateTask(req.params.id, req.body);
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  removeTask(req.params.id);
  res.json({ ok: true });
});

router.patch('/:id/toggle', (req, res) => {
  toggleTask(req.params.id);
  res.json({ ok: true });
});

export default router;
