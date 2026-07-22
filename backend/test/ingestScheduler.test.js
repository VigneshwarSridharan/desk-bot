import { test, describe, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

let syncAllCalendarsMock;
let runIngestionPipelineMock;

beforeEach(() => {
  syncAllCalendarsMock = mock.fn(async () => []);
  runIngestionPipelineMock = mock.fn(async () => []);
  mock.module('../src/google/gcal.js', {
    namedExports: { syncAllCalendars: (...args) => syncAllCalendarsMock(...args) },
  });
  mock.module('../src/ingest/pipeline.js', {
    namedExports: { runIngestionPipeline: (...args) => runIngestionPipelineMock(...args) },
  });
});

afterEach(() => {
  mock.reset();
});

async function loadScheduler() {
  return import(`../src/ingestScheduler.js?t=${Date.now()}-${Math.random()}`);
}

describe('runIngestCycle', () => {
  test('invokes syncAllCalendars and runIngestionPipeline', async () => {
    const { runIngestCycle } = await loadScheduler();
    await runIngestCycle();
    assert.equal(syncAllCalendarsMock.mock.callCount(), 1);
    assert.equal(runIngestionPipelineMock.mock.callCount(), 1);
  });

  test('a slow cycle in progress causes the next tick to skip (single-flight guard)', async () => {
    let resolveFirst;
    syncAllCalendarsMock.mock.mockImplementation(() => new Promise((resolve) => { resolveFirst = resolve; }));

    const { runIngestCycle } = await loadScheduler();
    const first = runIngestCycle();
    const second = runIngestCycle();
    await second;
    assert.equal(syncAllCalendarsMock.mock.callCount(), 1);
    assert.equal(runIngestionPipelineMock.mock.callCount(), 0);

    resolveFirst();
    await first;
    assert.equal(runIngestionPipelineMock.mock.callCount(), 1);
  });

  test('an error in the calendar sync does not throw out of the cycle, and the mail pipeline still runs', async () => {
    syncAllCalendarsMock.mock.mockImplementation(async () => {
      throw new Error('gcal down');
    });
    const { runIngestCycle } = await loadScheduler();
    await assert.doesNotReject(() => runIngestCycle());
    assert.equal(runIngestionPipelineMock.mock.callCount(), 1);
  });

  test('an error in the mail pipeline does not throw out of the cycle', async () => {
    runIngestionPipelineMock.mock.mockImplementation(async () => {
      throw new Error('ingestion down');
    });
    const { runIngestCycle } = await loadScheduler();
    await assert.doesNotReject(() => runIngestCycle());
  });
});

describe('isIngestRunning', () => {
  test('reflects the single-flight guard state', async () => {
    let resolveFirst;
    syncAllCalendarsMock.mock.mockImplementation(() => new Promise((resolve) => { resolveFirst = resolve; }));

    const { runIngestCycle, isIngestRunning } = await loadScheduler();
    assert.equal(isIngestRunning(), false);
    const first = runIngestCycle();
    assert.equal(isIngestRunning(), true);
    resolveFirst();
    await first;
    assert.equal(isIngestRunning(), false);
  });
});
