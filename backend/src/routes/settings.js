import { Router } from 'express';
import { getAllSettings, saveAllSettings } from '../store/db.js';
import { restartScheduler } from '../scheduler.js';

const router = Router();

router.get('/', (req, res) => {
  const settings = getAllSettings();
  // Never expose API keys over the wire — send empty strings as placeholders
  // so the frontend knows a key is set without revealing it
  const safe = { ...settings };
  for (const key of ['claudeApiKey', 'openaiApiKey', 'zaiApiKey', 'customApiKey', 'newsApiKey']) {
    if (safe[key]) safe[key] = '••••••••';
  }
  res.json(safe);
});

router.put('/', (req, res) => {
  const incoming = req.body;
  const current = getAllSettings();

  // If a placeholder was sent back, keep the existing value
  const merged = { ...current };
  for (const [key, value] of Object.entries(incoming)) {
    if (value === '••••••••') continue; // placeholder — don't overwrite
    merged[key] = value;
  }

  saveAllSettings(merged);

  // If interval changed, reschedule cron
  if (incoming.cycleIntervalMinutes && Number(incoming.cycleIntervalMinutes) !== current.cycleIntervalMinutes) {
    restartScheduler();
  }

  res.json({ ok: true });
});

// Special endpoint to update a single API key (sent separately for security)
router.put('/key', (req, res) => {
  const { key, value } = req.body;
  const allowed = ['claudeApiKey', 'openaiApiKey', 'zaiApiKey', 'customApiKey', 'newsApiKey'];
  if (!allowed.includes(key)) return res.status(400).json({ error: 'Invalid key name' });
  saveAllSettings({ [key]: value });
  res.json({ ok: true });
});

export default router;
