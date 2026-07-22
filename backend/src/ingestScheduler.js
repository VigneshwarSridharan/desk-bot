// Second cron loop, decoupled from the display cycle (ENGINEERING §1, rule A2/A3).
// Drives Calendar sync (Task 6) and the Gmail ingestion pipeline (Task 10)
// on the same tick — one account/subsystem failing never blocks the other.

import cron from 'node-cron';
import { syncAllCalendars } from './google/gcal.js';
import { runIngestionPipeline } from './ingest/pipeline.js';

let currentTask = null;
let isRunning = false;

function intervalToExpression(minutes) {
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    return `0 */${hours} * * *`;
  }
  return `*/${minutes} * * * *`;
}

export async function runIngestCycle() {
  if (isRunning) {
    console.log('[ingest-scheduler] Previous cycle still running — skipping this tick');
    return;
  }
  isRunning = true;
  try {
    await syncAllCalendars();
  } catch (err) {
    console.error('[ingest-scheduler] calendar sync error:', err.message);
  }
  try {
    await runIngestionPipeline();
  } catch (err) {
    console.error('[ingest-scheduler] mail ingestion error:', err.message);
  } finally {
    isRunning = false;
  }
}

export function isIngestRunning() {
  return isRunning;
}

export function startIngestScheduler() {
  const minutes = Number(process.env.INGEST_INTERVAL_MINUTES) || 60;
  const expression = intervalToExpression(minutes);

  console.log(`[ingest-scheduler] Starting — every ${minutes} minute(s) (${expression})`);

  currentTask = cron.schedule(expression, () => {
    console.log('[ingest-scheduler] Triggering ingestion cycle');
    runIngestCycle();
  });
}

export function stopIngestScheduler() {
  if (currentTask) {
    currentTask.stop();
    currentTask = null;
  }
}
