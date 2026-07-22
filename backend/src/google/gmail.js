// Gmail fetch per ENGINEERING.md §3.2 / PRD F1.2 step 1.
//
// This module's job stops at "fetch scoped, capped, parsed candidate
// messages" — prefiltering (ingest/prefilter.js), extraction, and storage are
// later tasks (9/10). It never calls the Google APIs directly except through
// google/auth.js's getAccessToken(), per ENGINEERING §1 rule A4.
//
// Allowlist entries compile to a single Gmail search query so the *server*
// does the sender/label filtering; scoping is enforced by never asking Gmail
// for anything outside the allowlist in the first place.
//
// Sync strategy: once an account has a stored `historyId`, only messages
// added since then are listed (users.history.list). A missing or expired
// historyId (Gmail 404s on an old one) falls back to a full `q=` search.
// historyId only advances when a run fetches everything it saw — a
// message-count-capped run leaves it untouched so the overflow is retried
// (and re-deduped downstream via processed_emails) next time.

import axios from 'axios';
import db from '../store/db.js';
import { getAccessToken } from './auth.js';

const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

export const MAX_MESSAGES_PER_RUN = 50;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_BODY_CHARS = 20_000;
const QUERY_WINDOW = 'newer_than:7d';

/** Builds the Gmail search query for an account's allowlist entries, or null if the allowlist is empty. */
export function compileAllowlistQuery(entries) {
  const clauses = entries
    .filter((e) => e?.pattern)
    .map((e) => (e.kind === 'label' ? `label:${e.pattern}` : `from:${e.pattern}`));
  if (!clauses.length) return null;
  return `(${clauses.join(' OR ')}) -in:spam -in:trash ${QUERY_WINDOW}`;
}

async function listMessageIdsByQuery(accessToken, query, limit) {
  const ids = [];
  let pageToken;
  do {
    const { data } = await axios.get(`${GMAIL_BASE}/messages`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { q: query, maxResults: Math.min(limit - ids.length, 100), pageToken },
    });
    for (const m of data.messages || []) ids.push(m.id);
    pageToken = data.nextPageToken;
  } while (pageToken && ids.length < limit);
  return ids;
}

async function listMessageIdsByHistory(accessToken, startHistoryId) {
  const ids = [];
  let latestHistoryId = startHistoryId;
  let pageToken;
  do {
    const { data } = await axios.get(`${GMAIL_BASE}/history`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { startHistoryId, historyTypes: 'messageAdded', pageToken },
    });
    for (const entry of data.history || []) {
      for (const added of entry.messagesAdded || []) {
        if (added.message?.id) ids.push(added.message.id);
      }
    }
    if (data.historyId) latestHistoryId = data.historyId;
    pageToken = data.nextPageToken;
  } while (pageToken);
  return { ids: [...new Set(ids)], historyId: latestHistoryId };
}

async function fetchCurrentHistoryId(accessToken) {
  const { data } = await axios.get(`${GMAIL_BASE}/profile`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return data.historyId;
}

async function getMessage(accessToken, id) {
  const { data } = await axios.get(`${GMAIL_BASE}/messages/${id}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    params: { format: 'full' },
  });
  return data;
}

function getHeader(headers, name) {
  const match = (headers || []).find((h) => h.name?.toLowerCase() === name.toLowerCase());
  return match?.value || '';
}

function decodeBase64Url(data) {
  if (!data) return '';
  return Buffer.from(data, 'base64url').toString('utf-8');
}

function stripHtml(html) {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

// Walks the MIME tree for the best text body: prefer text/plain, fall back to
// a stripped text/html part.
function extractBodyText(payload) {
  let plain = '';
  let html = '';
  function walk(part) {
    if (!part) return;
    const mimeType = part.mimeType || '';
    if (mimeType === 'text/plain' && part.body?.data && !plain) {
      plain = decodeBase64Url(part.body.data);
    } else if (mimeType === 'text/html' && part.body?.data && !html) {
      html = decodeBase64Url(part.body.data);
    }
    for (const child of part.parts || []) walk(child);
  }
  walk(payload);
  const text = plain || (html ? stripHtml(html) : '');
  return text.slice(0, MAX_BODY_CHARS);
}

function extractAttachments(payload) {
  const attachments = [];
  function walk(part) {
    if (!part) return;
    if (part.filename && part.body?.attachmentId) {
      const size = part.body.size || 0;
      attachments.push({
        filename: part.filename,
        mimeType: part.mimeType || '',
        attachmentId: part.body.attachmentId,
        size,
        oversize: size > MAX_ATTACHMENT_BYTES,
      });
    }
    for (const child of part.parts || []) walk(child);
  }
  walk(payload);
  return attachments;
}

function parseMessage(raw) {
  const headers = raw.payload?.headers;
  return {
    id: raw.id,
    sender: getHeader(headers, 'From'),
    subject: getHeader(headers, 'Subject'),
    listUnsubscribe: getHeader(headers, 'List-Unsubscribe') || null,
    inReplyTo: getHeader(headers, 'In-Reply-To') || null,
    references: getHeader(headers, 'References') || null,
    bodyText: extractBodyText(raw.payload),
    attachments: extractAttachments(raw.payload),
  };
}

/**
 * Fetches allowlist-scoped candidate messages for one connected account.
 * Returns `{ accountId, messages, skipped, capped }` — `skipped` entries carry
 * `{ id, reason: 'cap' }` for messages beyond MAX_MESSAGES_PER_RUN this run.
 */
export async function fetchAccountMessages(accountId) {
  const account = db.prepare('SELECT id, historyId FROM mail_accounts WHERE id = ?').get(accountId);
  if (!account) throw new Error(`Unknown mail account ${accountId}`);

  const allowlist = db.prepare('SELECT pattern, kind FROM allowlist_entries WHERE accountId = ?').all(accountId);
  const query = compileAllowlistQuery(allowlist);
  if (!query) return { accountId, messages: [], skipped: [], capped: false };

  const accessToken = await getAccessToken(accountId);

  let messageIds;
  let historyId = null;
  if (account.historyId) {
    try {
      const result = await listMessageIdsByHistory(accessToken, account.historyId);
      messageIds = result.ids;
      historyId = result.historyId;
    } catch (err) {
      if (err.response?.status === 404) {
        // historyId too old — Gmail expires these; fall back to a full search.
        messageIds = await listMessageIdsByQuery(accessToken, query, MAX_MESSAGES_PER_RUN + 1);
      } else {
        throw err;
      }
    }
  } else {
    messageIds = await listMessageIdsByQuery(accessToken, query, MAX_MESSAGES_PER_RUN + 1);
  }

  const capped = messageIds.length > MAX_MESSAGES_PER_RUN;
  const idsToFetch = messageIds.slice(0, MAX_MESSAGES_PER_RUN);
  const skipped = capped
    ? messageIds.slice(MAX_MESSAGES_PER_RUN).map((id) => ({ id, reason: 'cap' }))
    : [];

  const messages = [];
  for (const id of idsToFetch) {
    messages.push(parseMessage(await getMessage(accessToken, id)));
  }

  if (!historyId) historyId = await fetchCurrentHistoryId(accessToken);
  // Only advance the watermark when nothing was left behind by the cap —
  // otherwise the capped overflow would never be retried.
  if (!capped) {
    db.prepare('UPDATE mail_accounts SET historyId = ? WHERE id = ?').run(historyId, accountId);
  }

  return { accountId, messages, skipped, capped };
}

/** Re-fetches and parses a single message by ID — used to reprocess a
 * previously-locked message right after its password is resolved, without
 * waiting for the next incremental sync to happen to surface it again. */
export async function fetchSingleMessage(accountId, messageId) {
  const accessToken = await getAccessToken(accountId);
  return parseMessage(await getMessage(accessToken, messageId));
}

/** Downloads one attachment's raw bytes for a given message. */
export async function fetchAttachmentData(accountId, messageId, attachmentId) {
  const accessToken = await getAccessToken(accountId);
  const { data } = await axios.get(
    `${GMAIL_BASE}/messages/${messageId}/attachments/${attachmentId}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  return Buffer.from(data.data, 'base64url');
}

/** Fetches for every connected account; one account's failure never blocks the others. */
export async function fetchAllAccountMessages() {
  const accounts = db.prepare("SELECT id FROM mail_accounts WHERE status = 'connected'").all();
  const results = [];
  for (const { id } of accounts) {
    try {
      results.push(await fetchAccountMessages(id));
    } catch (err) {
      console.error(`[gmail] fetch failed for account ${id}: ${err.message}`);
      results.push({ accountId: id, error: err.message });
    }
  }
  return results;
}
