// Golden fixture regression suite for extractAgent (ENGINEERING §10 / Task 9
// Accept line): every fixture's stated model response must classify and
// extract to its expected JSON, and the two-attempt "fix your JSON" retry
// must behave exactly as specified.

import { test, describe, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, 'fixtures/emails');

function loadFixtures() {
  return readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(FIXTURES_DIR, f), 'utf-8')));
}

function responseText(value) {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

let generateTextMock;

beforeEach(() => {
  generateTextMock = mock.fn(async () => ({ text: '{}' }));
  mock.module('ai', {
    namedExports: { generateText: (...args) => generateTextMock(...args) },
  });
});

afterEach(() => {
  mock.reset();
});

async function loadExtractAgent() {
  return import(`../src/agent/extractAgent.js?t=${Date.now()}-${Math.random()}`);
}

const extractableFixtures = loadFixtures().filter((f) => f.mode);

describe('extractAgent — golden fixtures', () => {
  for (const fixture of extractableFixtures) {
    test(`${fixture.id}: classifies and extracts to its expected JSON`, async () => {
      let call = 0;
      generateTextMock.mock.mockImplementation(async () => {
        call += 1;
        const value = call === 1 ? fixture.modelResponse : (fixture.retryModelResponse ?? fixture.modelResponse);
        return { text: responseText(value) };
      });

      const { extractTransactional, extractDigest } = await loadExtractAgent();

      const result = fixture.mode === 'transactional'
        ? await extractTransactional('fake-model', {
            sender: fixture.email.sender,
            subject: fixture.email.subject,
            bodyText: fixture.email.bodyText,
            attachmentText: fixture.attachmentText || undefined,
          })
        : await extractDigest('fake-model', {
            sender: fixture.email.sender,
            strippedText: fixture.strippedText,
          });

      assert.deepEqual(result, fixture.expected);
    });
  }

  test('malformed fixtures call the model at most twice (one retry)', async () => {
    const fixture = extractableFixtures.find((f) => f.id === 'malformed-twice');
    let call = 0;
    generateTextMock.mock.mockImplementation(async () => {
      call += 1;
      return { text: call === 1 ? fixture.modelResponse : fixture.retryModelResponse };
    });

    const { extractTransactional } = await loadExtractAgent();
    await extractTransactional('fake-model', {
      sender: fixture.email.sender,
      subject: fixture.email.subject,
      bodyText: fixture.email.bodyText,
    });

    assert.equal(generateTextMock.mock.callCount(), 2);
  });

  test('a well-formed first response never triggers a retry call', async () => {
    const fixture = extractableFixtures.find((f) => f.id === 'bill-airtel');
    generateTextMock.mock.mockImplementation(async () => ({ text: responseText(fixture.modelResponse) }));

    const { extractTransactional } = await loadExtractAgent();
    await extractTransactional('fake-model', {
      sender: fixture.email.sender,
      subject: fixture.email.subject,
      bodyText: fixture.email.bodyText,
    });

    assert.equal(generateTextMock.mock.callCount(), 1);
  });
});

describe('extractAgent — fact normalization', () => {
  test('drops a fact that fails schema validation instead of guessing missing fields', async () => {
    generateTextMock.mock.mockImplementation(async () => ({
      text: JSON.stringify({
        intent: 'bill',
        confidence: 0.8,
        passwordHint: null,
        facts: [
          { type: 'bill', vendor: 'Airtel' }, // missing amount/dueDate — dropped, not guessed
          { type: 'bill', vendor: 'Jio', amount: 399, dueDate: '2026-08-05' },
        ],
      }),
    }));

    const { extractTransactional } = await loadExtractAgent();
    const result = await extractTransactional('fake-model', {
      sender: 'billing@jio.com',
      subject: 'Bill',
      bodyText: 'body',
    });

    assert.equal(result.outcome, 'extracted');
    assert.equal(result.facts.length, 1);
    assert.equal(result.facts[0].vendor, 'Jio');
  });
});
