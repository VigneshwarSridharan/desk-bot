// Google OAuth (shared by Gmail + Calendar) per ENGINEERING.md §3.1.
// The device is a kiosk; consent happens in a browser via the admin panel,
// which redirects back to this backend's loopback callback.
//
// This is the ONLY module that speaks to Google's OAuth endpoints. Nothing
// else should reach out to accounts.google.com / oauth2.googleapis.com /
// gmail.googleapis.com directly — google/gmail.js and google/gcal.js (later
// tasks) call getAccessToken() here instead.
//
// Refresh tokens are encrypted (store/vault.js) before they ever touch
// SQLite. Access tokens live in memory only, per ENGINEERING §3.1.

import axios from 'axios';
import crypto from 'node:crypto';
import db from '../store/db.js';
import { encrypt, decrypt } from '../store/vault.js';

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar.readonly',
];

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const PROFILE_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/profile';

const MAX_AUTH_FAILURES = 3;
const TOKEN_SERVICES = ['gmail', 'gcal'];

// accountId -> { accessToken, expiresAt } — never persisted.
const accessTokenCache = new Map();

function requireClientConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set');
  }
  return { clientId, clientSecret };
}

function redirectUri() {
  if (process.env.GOOGLE_REDIRECT_URI) return process.env.GOOGLE_REDIRECT_URI;
  const port = process.env.PORT || 8000;
  return `http://localhost:${port}/api/connections/google/callback`;
}

function formPost(url, params) {
  return axios.post(url, new URLSearchParams(params).toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
}

/** Builds the Google consent URL. `state` round-trips through the callback (CSRF nonce, optional label). */
export function getAuthUrl(state) {
  const { clientId } = requireClientConfig();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state: state || '',
  });
  return `${AUTH_URL}?${params.toString()}`;
}

async function exchangeCodeForTokens(code) {
  const { clientId, clientSecret } = requireClientConfig();
  const { data } = await formPost(TOKEN_URL, {
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri(),
    grant_type: 'authorization_code',
  });
  return data; // { access_token, refresh_token, expires_in, scope, token_type }
}

async function fetchGmailEmailAddress(accessToken) {
  const { data } = await axios.get(PROFILE_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return data.emailAddress;
}

function cacheAccessToken(accountId, { access_token: accessToken, expires_in: expiresIn }) {
  accessTokenCache.set(accountId, {
    accessToken,
    // Refresh a minute early so callers never hand out a token about to expire.
    expiresAt: Date.now() + (expiresIn ? expiresIn * 1000 : 3600 * 1000) - 60_000,
  });
}

function upsertOauthToken(accountId, service, refreshTokenEnc, scope) {
  const existing = db.prepare('SELECT id FROM oauth_tokens WHERE accountId = ? AND service = ?').get(accountId, service);
  if (existing) {
    db.prepare(`
      UPDATE oauth_tokens SET refreshTokenEnc = ?, scope = ?, updatedAt = datetime('now') WHERE id = ?
    `).run(refreshTokenEnc, scope || '', existing.id);
  } else {
    db.prepare(`
      INSERT INTO oauth_tokens (id, accountId, service, refreshTokenEnc, scope) VALUES (?, ?, ?, ?, ?)
    `).run(crypto.randomUUID(), accountId, service, refreshTokenEnc, scope || '');
  }
}

/**
 * Completes the OAuth flow: exchanges the authorization code, resolves the
 * account's email address, and persists an encrypted refresh token.
 * Creates a new mail_accounts row, or reconnects an existing one matched by
 * emailAddress (preserving its allowlist and audit history).
 */
export async function connectAccount({ code, label }) {
  const tokens = await exchangeCodeForTokens(code);
  if (!tokens.refresh_token) {
    throw new Error(
      'Google did not return a refresh token. Revoke Desk Bot\'s access at myaccount.google.com/permissions and reconnect.',
    );
  }
  const emailAddress = await fetchGmailEmailAddress(tokens.access_token);

  const existingAccount = db.prepare('SELECT id, label FROM mail_accounts WHERE emailAddress = ?').get(emailAddress);
  let accountId;
  if (existingAccount) {
    accountId = existingAccount.id;
    db.prepare(`
      UPDATE mail_accounts SET status = 'connected', label = ?, authFailCount = 0, lastError = NULL WHERE id = ?
    `).run(label || existingAccount.label || '', accountId);
  } else {
    accountId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO mail_accounts (id, emailAddress, label, status) VALUES (?, ?, ?, 'connected')
    `).run(accountId, emailAddress, label || '');
  }

  const refreshTokenEnc = encrypt(tokens.refresh_token);
  for (const service of TOKEN_SERVICES) {
    upsertOauthToken(accountId, service, refreshTokenEnc, tokens.scope);
  }

  cacheAccessToken(accountId, tokens);

  return { accountId, emailAddress };
}

/** Refreshes and caches an access token for `accountId`, tracking consecutive failures. */
export async function refreshAccessToken(accountId) {
  const tokenRow = db.prepare('SELECT refreshTokenEnc FROM oauth_tokens WHERE accountId = ? LIMIT 1').get(accountId);
  if (!tokenRow) {
    throw new Error(`No OAuth token stored for account ${accountId}`);
  }
  const { clientId, clientSecret } = requireClientConfig();
  const refreshToken = decrypt(tokenRow.refreshTokenEnc);

  try {
    const { data } = await formPost(TOKEN_URL, {
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    });
    cacheAccessToken(accountId, data);
    db.prepare('UPDATE mail_accounts SET authFailCount = 0, lastError = NULL WHERE id = ?').run(accountId);
    return data.access_token;
  } catch (err) {
    const account = db.prepare('SELECT authFailCount, status FROM mail_accounts WHERE id = ?').get(accountId);
    const failCount = (account?.authFailCount || 0) + 1;
    const message = err.response?.data?.error_description || err.response?.data?.error || err.message;
    db.prepare(`
      UPDATE mail_accounts SET authFailCount = ?, lastError = ?, status = ? WHERE id = ?
    `).run(failCount, message, failCount >= MAX_AUTH_FAILURES ? 'error' : account?.status, accountId);
    throw err;
  }
}

/** Returns a valid access token for `accountId`, refreshing it if missing/expired. */
export async function getAccessToken(accountId) {
  const cached = accessTokenCache.get(accountId);
  if (cached && cached.expiresAt > Date.now()) return cached.accessToken;
  return refreshAccessToken(accountId);
}

/** Revokes the refresh token at Google (best-effort) and deletes the local token row(s). */
export async function revokeAccount(accountId) {
  const tokenRow = db.prepare('SELECT refreshTokenEnc FROM oauth_tokens WHERE accountId = ? LIMIT 1').get(accountId);
  if (tokenRow) {
    try {
      const refreshToken = decrypt(tokenRow.refreshTokenEnc);
      await formPost(REVOKE_URL, { token: refreshToken });
    } catch (err) {
      console.error(`[google-auth] revoke failed for account ${accountId}: ${err.message}`);
    }
  }
  db.prepare('DELETE FROM oauth_tokens WHERE accountId = ?').run(accountId);
  accessTokenCache.delete(accountId);
}

export function clearAccessTokenCache() {
  accessTokenCache.clear();
}
