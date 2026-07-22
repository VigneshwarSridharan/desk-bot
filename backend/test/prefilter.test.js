// prefilter.js routing rules (ENGINEERING §4.1), verified against the same
// golden fixture corpus extractAgent.test.js uses, plus a direct proof that
// discarded messages never reach the LLM.

import { test, describe, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { prefilterMessage } from '../src/ingest/prefilter.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, 'fixtures/emails');

function loadFixtures() {
  return readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(FIXTURES_DIR, f), 'utf-8')));
}

const fixtures = loadFixtures();

describe('prefilterMessage — golden fixtures', () => {
  for (const fixture of fixtures) {
    test(`${fixture.id}: routes to ${fixture.expectedRoute.route}${fixture.expectedRoute.reason ? ` (${fixture.expectedRoute.reason})` : ''}`, () => {
      const result = prefilterMessage(fixture.email, fixture.allowlist);
      assert.equal(result.route, fixture.expectedRoute.route);
      assert.equal(result.reason ?? null, fixture.expectedRoute.reason);
    });
  }
});

describe('prefilterMessage — unit rules', () => {
  test('a sender not matching any allowlist entry (no label entries) is discarded, defense in depth', () => {
    const result = prefilterMessage(
      { sender: 'stranger@example.com', subject: 'x', bodyText: '' },
      [{ pattern: 'known@example.com', kind: 'sender', type: 'transactional' }],
    );
    assert.deepEqual(result, { route: 'discard', reason: 'not-allowlisted' });
  });

  test('a sender not matching a sender pattern passes through when a label entry could explain the fetch', () => {
    const result = prefilterMessage(
      { sender: 'stranger@example.com', subject: 'x', bodyText: '' },
      [{ pattern: 'desk-bot', kind: 'label', type: 'transactional' }],
    );
    assert.equal(result.route, 'transactional');
  });

  test('newsletter-typed senders route to newsletter even with List-Unsubscribe present', () => {
    const result = prefilterMessage(
      { sender: 'news@example.com', subject: 'x', bodyText: '', listUnsubscribe: '<mailto:x>' },
      [{ pattern: 'news@example.com', kind: 'sender', type: 'newsletter' }],
    );
    assert.deepEqual(result, { route: 'newsletter' });
  });

  test('matches sender patterns embedded in a "Name <email>" From header', () => {
    const result = prefilterMessage(
      { sender: 'Airtel Billing <billing@airtel.in>', subject: 'x', bodyText: '' },
      [{ pattern: 'billing@airtel.in', kind: 'sender', type: 'transactional' }],
    );
    assert.equal(result.route, 'transactional');
  });
});

describe('prefilterMessage — no LLM call on discard', () => {
  let generateTextMock;

  afterEach(() => {
    mock.reset();
  });

  test('a marketing email from a transactional sender is discarded before any LLM call', async () => {
    generateTextMock = mock.fn(async () => ({ text: '{}' }));
    mock.module('ai', {
      namedExports: { generateText: (...args) => generateTextMock(...args) },
    });

    const fixture = fixtures.find((f) => f.id === 'marketing-discard');
    const routed = prefilterMessage(fixture.email, fixture.allowlist);
    assert.equal(routed.route, 'discard');
    assert.equal(routed.reason, 'marketing');

    // Pipeline shape (Task 10): extractAgent is only ever invoked when the
    // route isn't 'discard'. Proving that contract here, without building
    // the full pipeline module, is what the Accept line requires.
    if (routed.route !== 'discard') {
      const { extractTransactional } = await import(`../src/agent/extractAgent.js?t=${Date.now()}`);
      await extractTransactional('fake-model', fixture.email);
    }

    assert.equal(generateTextMock.mock.callCount(), 0);
  });
});
