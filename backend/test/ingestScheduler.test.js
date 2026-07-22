import { test, describe, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

let syncAllCalendarsMock;

beforeEach(() => {
  syncAllCalendarsMock = mock.fn(async () => []);
  mock.module('../src/google/gcal.js', {
    namedExports: { syncAllCalendars: (...args) => syncAllCalendarsMock(...args) },
  });
});

afterEach(() => {
  mock.reset();
});

async function loadScheduler() {
  return import(`../src/ingestScheduler.js?t=${Date.now()}-${Math.random()}`);
}

describe('runIngestCycle', () => {
  test('invokes syncAllCalendars', async () => {
    const { runIngestCycle } = await loadScheduler();
    await runIngestCycle();
    assert.equal(syncAllCalendarsMock.mock.callCount(), 1);
  });

  test('a slow cycle in progress causes the next tick to skip (single-flight guard)', async () => {
    let resolveFirst;
    syncAllCalendarsMock.mock.mockImplementation(() => new Promise((resolve) => { resolveFirst = resolve; }));

    const { runIngestCycle } = await loadScheduler();
    const first = runIngestCycle();
    const second = runIngestCycle();
    await second;
    assert.equal(syncAllCalendarsMock.mock.callCount(), 1);

    resolveFirst();
    await first;
  });

  test('an error in the sync does not throw out of the cycle', async () => {
    syncAllCalendarsMock.mock.mockImplementation(async () => {
      throw new Error('gcal down');
    });
    const { runIngestCycle } = await loadScheduler();
    await assert.doesNotReject(() => runIngestCycle());
  });
});
