import cron from 'node-cron';
import { getAllSettings } from './store/db.js';
import { runDisplayAgent } from './agent/displayAgent.js';

let currentTask = null;

function intervalToExpression(minutes) {
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    return `0 */${hours} * * *`;
  }
  return `*/${minutes} * * * *`;
}

export function startScheduler() {
  const settings = getAllSettings();
  const minutes = Number(settings.cycleIntervalMinutes) || 10;
  const expression = intervalToExpression(minutes);

  console.log(`[scheduler] Starting — every ${minutes} minute(s) (${expression})`);

  currentTask = cron.schedule(expression, () => {
    console.log('[scheduler] Triggering agent cycle');
    runDisplayAgent().catch((err) => console.error('[scheduler] Agent error:', err.message));
  });
}

export function restartScheduler() {
  if (currentTask) {
    currentTask.stop();
    currentTask = null;
  }
  startScheduler();
}
