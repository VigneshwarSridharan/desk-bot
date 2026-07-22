import { test, describe, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  getConnections, startGoogleConnect, disconnectAccount, getAllowlist, saveAllowlist,
} from '../src/api/connections.js';

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

let calls;

beforeEach(() => {
  calls = [];
  global.fetch = mock.fn(async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : undefined });
    return jsonResponse(calls.at(-1).response ?? {});
  });
});

describe('getConnections', () => {
  test('lists accounts with status, never touching the API directly from a component', async () => {
    global.fetch = mock.fn(async () => jsonResponse([
      { id: 'acct-1', emailAddress: 'me@example.com', label: 'personal', status: 'connected', connectedAt: '2026-07-01T00:00:00.000Z' },
    ]));
    const accounts = await getConnections();
    assert.equal(accounts.length, 1);
    assert.equal(accounts[0].status, 'connected');
    const [url, opts] = global.fetch.mock.calls[0].arguments;
    assert.match(String(url), /\/api\/connections$/);
    assert.equal(opts.method, 'GET');
  });
});

describe('startGoogleConnect', () => {
  test('requests a consent URL, optionally scoped by label', async () => {
    global.fetch = mock.fn(async () => jsonResponse({ url: 'https://accounts.google.com/o/oauth2/v2/auth?mock=1' }));
    const { url } = await startGoogleConnect('work');
    assert.ok(url.startsWith('https://accounts.google.com'));
    const [reqUrl] = global.fetch.mock.calls[0].arguments;
    assert.match(String(reqUrl), /\/api\/connections\/google\/start\?label=work$/);
  });

  test('omits the label param when none is given', async () => {
    global.fetch = mock.fn(async () => jsonResponse({ url: 'https://accounts.google.com/mock' }));
    await startGoogleConnect();
    const [reqUrl] = global.fetch.mock.calls[0].arguments;
    assert.match(String(reqUrl), /\/api\/connections\/google\/start$/);
  });
});

describe('disconnectAccount', () => {
  test('issues a DELETE, adding ?purge=true only when requested', async () => {
    global.fetch = mock.fn(async () => jsonResponse({ ok: true }));
    await disconnectAccount('acct-1', false);
    const [firstUrl, firstOpts] = global.fetch.mock.calls[0].arguments;
    assert.equal(firstOpts.method, 'DELETE');
    assert.match(String(firstUrl), /\/api\/connections\/acct-1$/);

    await disconnectAccount('acct-1', true);
    const [secondUrl] = global.fetch.mock.calls[1].arguments;
    assert.match(String(secondUrl), /\/api\/connections\/acct-1\?purge=true$/);
  });
});

describe('allowlist editing', () => {
  test('adding a transactional and a newsletter sender persists both via one PUT', async () => {
    const saved = [
      { id: 'e1', accountId: 'acct-1', pattern: 'noreply@zerodha.com', kind: 'sender', type: 'transactional' },
      { id: 'e2', accountId: 'acct-1', pattern: 'digest@newsletter.com', kind: 'sender', type: 'newsletter' },
    ];
    global.fetch = mock.fn(async () => jsonResponse(saved));

    const result = await saveAllowlist('acct-1', [
      { pattern: 'noreply@zerodha.com', kind: 'sender', type: 'transactional' },
      { pattern: 'digest@newsletter.com', kind: 'sender', type: 'newsletter' },
    ]);

    assert.equal(result.length, 2);
    assert.deepEqual(result.map((e) => e.type).sort(), ['newsletter', 'transactional']);

    const [url, opts] = global.fetch.mock.calls[0].arguments;
    assert.equal(opts.method, 'PUT');
    assert.match(String(url), /\/api\/connections\/acct-1\/allowlist$/);
    const sentBody = JSON.parse(opts.body);
    assert.equal(sentBody.entries.length, 2);
    assert.equal(sentBody.entries[0].type, 'transactional');
    assert.equal(sentBody.entries[1].type, 'newsletter');
  });

  test('fetches the current allowlist for an account', async () => {
    global.fetch = mock.fn(async () => jsonResponse([{ id: 'e1', pattern: 'a@b.com', kind: 'sender', type: 'transactional' }]));
    const entries = await getAllowlist('acct-1');
    assert.equal(entries.length, 1);
    const [url] = global.fetch.mock.calls[0].arguments;
    assert.match(String(url), /\/api\/connections\/acct-1\/allowlist$/);
  });
});
