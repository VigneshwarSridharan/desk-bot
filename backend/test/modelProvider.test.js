// getModelForRole is fully generic over the role prefix, so the "extract"
// role (ENGINEERING §5.1) needs no new branching — this pins that
// EXTRACT_LLM_PROVIDER/MODEL/API_KEY/BASE_URL resolve exactly like
// CONTEXT_LLM_*/RENDER_LLM_* already do.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { getModelForRole } from '../src/agent/modelProvider.js';

const ENV_KEYS = [
  'LLM_PROVIDER', 'LLM_MODEL',
  'EXTRACT_LLM_PROVIDER', 'EXTRACT_LLM_MODEL', 'EXTRACT_LLM_API_KEY', 'EXTRACT_LLM_BASE_URL',
  'ANTHROPIC_API_KEY', 'OPENAI_API_KEY',
];
let savedEnv;

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe('getModelForRole("extract")', () => {
  test('falls back to the global provider/key when no per-role override is set', () => {
    delete process.env.EXTRACT_LLM_PROVIDER;
    delete process.env.EXTRACT_LLM_MODEL;
    process.env.LLM_PROVIDER = 'claude';
    process.env.ANTHROPIC_API_KEY = 'test-key';

    assert.doesNotThrow(() => getModelForRole('extract'));
  });

  test('uses EXTRACT_LLM_PROVIDER/MODEL/API_KEY when set, independent of context/render', () => {
    process.env.EXTRACT_LLM_PROVIDER = 'openai';
    process.env.EXTRACT_LLM_MODEL = 'gpt-4o-mini';
    process.env.EXTRACT_LLM_API_KEY = 'test-openai-key';
    delete process.env.OPENAI_API_KEY;

    assert.doesNotThrow(() => getModelForRole('extract'));
  });

  test('throws a clear error when the resolved provider has no API key configured', () => {
    process.env.EXTRACT_LLM_PROVIDER = 'openai';
    delete process.env.EXTRACT_LLM_API_KEY;
    delete process.env.OPENAI_API_KEY;

    assert.throws(() => getModelForRole('extract'), /No openai API key configured/);
  });
});
