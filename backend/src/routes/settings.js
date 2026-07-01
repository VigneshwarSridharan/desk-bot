import { Router } from 'express';
import { getAllSettings, saveAllSettings } from '../store/db.js';
import { restartScheduler } from '../scheduler.js';

const router = Router();

router.get('/', (req, res) => {
  const settings = getAllSettings();
  res.json(settings);
});

router.put('/', (req, res) => {
  const incoming = req.body;
  const current = getAllSettings();

  const merged = { ...current, ...incoming };
  saveAllSettings(merged);

  // If interval changed, reschedule cron
  if (incoming.cycleIntervalMinutes && Number(incoming.cycleIntervalMinutes) !== current.cycleIntervalMinutes) {
    restartScheduler();
  }

  res.json({ ok: true });
});

export default router;
