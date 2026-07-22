// Context agent (Task 11 / ENGINEERING §5.3): get_bills/get_digest tools are
// wired into the agent's tool loop, and select_content accepts the new
// "bill" and "inbox_digest" contentType values. Uses the AI SDK's
// MockLanguageModelV3 test harness (ai/test) to drive a real generateText
// tool loop without hitting a real LLM.

import { test, describe, mock } from 'node:test';
import assert from 'node:assert/strict';
import { MockLanguageModelV3 } from 'ai/test';

const getBillsDueSoonMock = mock.fn(() => [
  { id: 'b-1', vendor: 'Airtel', amount: 599, currency: 'INR', dueDate: '2026-07-23', status: 'due' },
]);
const getActiveDigestItemsMock = mock.fn(() => [
  { id: 'd-1', headline: 'Big product news', sourceSender: 'newsletter@example.com', receivedAt: '2026-07-22T00:00:00.000Z' },
]);

mock.module('../src/store/db.js', {
  namedExports: {
    getBillsDueSoon: (...args) => getBillsDueSoonMock(...args),
    getActiveDigestItems: (...args) => getActiveDigestItemsMock(...args),
    // The other tools contextAgent wires in also import from db.js — stub
    // just enough for the module graph to load; these tools aren't
    // exercised by this test file.
    getReminders: () => [],
    getUpcomingEvents: () => [],
    getTasks: () => [],
    getPortfolio: () => ({ holdings: [], watchlist: [] }),
    getAllSettings: () => ({}),
  },
});

const { runContextAgent } = await import('../src/agent/contextAgent.js');

function toolCallResponse(toolName, input) {
  return {
    finishReason: 'tool-calls',
    usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
    content: [{ type: 'tool-call', toolCallId: `${toolName}-1`, toolName, input: JSON.stringify(input) }],
    warnings: [],
  };
}

describe('runContextAgent — bills/digest tools', () => {
  test('calls get_bills then select_content with contentType "bill"', async () => {
    getBillsDueSoonMock.mock.resetCalls();
    let step = 0;
    const model = new MockLanguageModelV3({
      doGenerate: async () => {
        step += 1;
        if (step === 1) return toolCallResponse('get_bills', {});
        return toolCallResponse('select_content', {
          contentType: 'bill',
          decision: 'Bill due tomorrow',
          contextData: { vendor: 'Airtel' },
        });
      },
    });

    const result = await runContextAgent(model, 'prompt');

    assert.equal(getBillsDueSoonMock.mock.callCount(), 1);
    assert.equal(result.contentType, 'bill');
    assert.equal(result.decision, 'Bill due tomorrow');
  });

  test('calls get_digest then select_content with contentType "inbox_digest"', async () => {
    getActiveDigestItemsMock.mock.resetCalls();
    let step = 0;
    const model = new MockLanguageModelV3({
      doGenerate: async () => {
        step += 1;
        if (step === 1) return toolCallResponse('get_digest', {});
        return toolCallResponse('select_content', {
          contentType: 'inbox_digest',
          decision: 'Nothing higher priority, showing inbox digest',
          contextData: {},
        });
      },
    });

    const result = await runContextAgent(model, 'prompt');

    assert.equal(getActiveDigestItemsMock.mock.callCount(), 1);
    assert.equal(result.contentType, 'inbox_digest');
  });

  test('rejects a contentType outside the enum instead of silently accepting it', async () => {
    const model = new MockLanguageModelV3({
      doGenerate: async () => toolCallResponse('select_content', {
        contentType: 'not_a_real_type',
        decision: 'bogus',
        contextData: {},
      }),
    });

    const result = await runContextAgent(model, 'prompt');
    // Invalid tool input never satisfies the schema, so select_content's
    // execute never runs and no content is selected for this cycle.
    assert.equal(result, null);
  });
});
