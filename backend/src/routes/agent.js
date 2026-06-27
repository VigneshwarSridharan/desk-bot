import { Router } from 'express';
import { getDisplayCache } from '../store/db.js';
import { runDisplayAgent } from '../agent/displayAgent.js';

const router = Router();

// POST /api/cycle — trigger a new agent cycle in the background
router.post('/cycle', async (req, res) => {
  res.json({ started: true });
  // fire-and-forget
  runDisplayAgent().catch((err) => console.error('[route] cycle error:', err.message));
});

// GET /api/latest — get the latest rendered display
router.get('/latest', (req, res) => {
  const cache = getDisplayCache();
  res.json({
    html: cache?.html || null,
    contentType: cache?.contentType || null,
    decision: cache?.decision || null,
    timestamp: cache?.timestamp || null,
    generating: !!(cache?.generating),
  });
});

export default router;
