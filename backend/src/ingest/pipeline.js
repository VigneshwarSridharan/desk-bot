// Ingestion pipeline per ENGINEERING.md §4 / PRD F1.2: orchestrates
// fetch -> prefilter -> extract -> store for every connected account, on the
// ingestion cron (decoupled from the display cycle per ENGINEERING §1 rule A2).
//
// Every fetched message is recorded exactly once in `processed_emails`
// (keyed by gmailMessageId), regardless of outcome — that row is the single
// source of truth for "already handled": a message already present there is
// never re-fetched/re-extracted/re-stored, which is what keeps a repeated
// pipeline run from ever duplicating facts. Store writers additionally
// upsert on a natural key per fact type as defense-in-depth (ENGINEERING
// §4.3), but the processed_emails guard is what actually makes re-runs safe.
//
// Attachments (PDF text + password chain) are Task 12 — this pipeline only
// ever passes bodyText to the extract agent; a message with attachments is
// still processed on its body text alone until attachments.js lands.
//
// One message failing never blocks the rest of the run (ENGINEERING §8): a
// thrown error is caught, logged, and recorded as a skip with reason 'error'.

import crypto from 'node:crypto';
import db from '../store/db.js';
import { fetchAccountMessages } from '../google/gmail.js';
import { prefilterMessage } from './prefilter.js';
import { extractTransactional, extractDigest } from '../agent/extractAgent.js';
import { getModelForRole } from '../agent/modelProvider.js';

const DIGEST_TEXT_CAP = 8000;
const DIGEST_EXPIRY_DAYS = 5;

const FACT_TABLES = {
  bill: 'bills',
  task: 'tasks',
  event: 'events',
  trade: 'portfolio',
  digest: 'digest_items',
};

function alreadyProcessed(gmailMessageId) {
  return !!db.prepare('SELECT 1 FROM processed_emails WHERE gmailMessageId = ?').get(gmailMessageId);
}

// Upsert rather than plain insert: digest_items has a hard FK on
// processed_emails.gmailMessageId, so the newsletter/transactional paths
// write a stub row *before* writing facts (satisfying the FK) and then
// update it with the final outcome/factRefs once facts are written.
function upsertProcessedEmail({ gmailMessageId, accountId, sender, subject, outcome, reason, factRefs }) {
  const existing = db.prepare('SELECT 1 FROM processed_emails WHERE gmailMessageId = ?').get(gmailMessageId);
  if (existing) {
    db.prepare(`
      UPDATE processed_emails SET accountId = ?, sender = ?, subject = ?, outcome = ?, reason = ?, factRefs = ?
      WHERE gmailMessageId = ?
    `).run(accountId, sender || '', subject || '', outcome, reason || null, JSON.stringify(factRefs || []), gmailMessageId);
  } else {
    db.prepare(`
      INSERT INTO processed_emails (gmailMessageId, accountId, sender, subject, outcome, reason, factRefs)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(gmailMessageId, accountId, sender || '', subject || '', outcome, reason || null, JSON.stringify(factRefs || []));
  }
}

function upsertBill(fact, sourceEmailId) {
  const existing = db.prepare(`
    SELECT id FROM bills WHERE sourceEmailId = ? AND vendor = ? AND dueDate = ? AND amount = ?
  `).get(sourceEmailId, fact.vendor, fact.dueDate, fact.amount);
  if (existing) return existing.id;

  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO bills (id, vendor, amount, currency, dueDate, status, sourceEmailId)
    VALUES (?, ?, ?, ?, ?, 'due', ?)
  `).run(id, fact.vendor, fact.amount, fact.currency || 'INR', fact.dueDate, sourceEmailId);
  return id;
}

function upsertTaskFact(fact, sourceEmailId) {
  const due = fact.due ?? null;
  const existing = db.prepare(`
    SELECT id FROM tasks WHERE sourceEmailId = ? AND title = ? AND COALESCE(due, '') = COALESCE(?, '')
  `).get(sourceEmailId, fact.title, due);
  if (existing) return existing.id;

  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO tasks (id, title, due, priority, source, sourceEmailId, done)
    VALUES (?, ?, ?, ?, 'email', ?, 0)
  `).run(id, fact.title, due, fact.priority || 'medium', sourceEmailId);
  return id;
}

function upsertEventFact(fact, sourceEmailId) {
  const time = fact.time ?? null;
  const existing = db.prepare(`
    SELECT id FROM events WHERE sourceRef = ? AND title = ? AND date = ?
  `).get(sourceEmailId, fact.title, fact.date);
  if (existing) return existing.id;

  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO events (id, title, date, time, description, type, source, sourceRef)
    VALUES (?, ?, ?, ?, '', 'event', 'email', ?)
  `).run(id, fact.title, fact.date, time, sourceEmailId);
  return id;
}

// Portfolio holds one aggregate row per symbol (not a transaction log), so a
// trade fact updates the existing holding's quantity/avgPrice rather than
// inserting a new row per trade. A buy recomputes the weighted-average
// price; a sell reduces quantity (never below zero).
function upsertTradeFact(fact, sourceEmailId) {
  const symbol = fact.symbol.toUpperCase();
  const existing = db.prepare(`
    SELECT id, quantity, avgPrice FROM portfolio WHERE symbol = ? AND watchlistOnly = 0
  `).get(symbol);

  if (existing) {
    let quantity = existing.quantity;
    let avgPrice = existing.avgPrice;
    if (fact.side === 'buy') {
      const totalCost = existing.quantity * existing.avgPrice + fact.quantity * fact.price;
      quantity = existing.quantity + fact.quantity;
      avgPrice = quantity > 0 ? totalCost / quantity : 0;
    } else {
      quantity = Math.max(0, existing.quantity - fact.quantity);
    }
    db.prepare(`
      UPDATE portfolio SET quantity = ?, avgPrice = ?, source = 'email', sourceEmailId = ? WHERE id = ?
    `).run(quantity, avgPrice, sourceEmailId, existing.id);
    return existing.id;
  }

  const id = crypto.randomUUID();
  const quantity = fact.side === 'buy' ? fact.quantity : 0;
  db.prepare(`
    INSERT INTO portfolio (id, symbol, name, type, quantity, avgPrice, exchange, watchlistOnly, source, sourceEmailId)
    VALUES (?, ?, '', 'stock', ?, ?, '', 0, 'email', ?)
  `).run(id, symbol, quantity, fact.price, sourceEmailId);
  return id;
}

function upsertDigestItem(headline, message, accountId) {
  const existing = db.prepare(`
    SELECT id FROM digest_items WHERE sourceEmailId = ? AND headline = ?
  `).get(message.id, headline);
  if (existing) return existing.id;

  const id = crypto.randomUUID();
  const receivedAt = new Date();
  const expiresAt = new Date(receivedAt.getTime() + DIGEST_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
  db.prepare(`
    INSERT INTO digest_items (id, headline, sourceSender, accountId, sourceEmailId, receivedAt, expiresAt)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, headline, message.sender, accountId, message.id, receivedAt.toISOString(), expiresAt.toISOString());
  return id;
}

function writeFact(fact, sourceEmailId) {
  switch (fact.type) {
    case 'bill': return `bill:${upsertBill(fact, sourceEmailId)}`;
    case 'task': return `task:${upsertTaskFact(fact, sourceEmailId)}`;
    case 'event': return `event:${upsertEventFact(fact, sourceEmailId)}`;
    case 'trade': return `trade:${upsertTradeFact(fact, sourceEmailId)}`;
    default: return null;
  }
}

async function processMessage(accountId, message, allowlist) {
  const routing = prefilterMessage(message, allowlist);
  if (routing.route === 'discard') {
    upsertProcessedEmail({
      gmailMessageId: message.id, accountId, sender: message.sender, subject: message.subject,
      outcome: 'skipped', reason: routing.reason, factRefs: [],
    });
    return 'skipped';
  }

  const model = getModelForRole('extract');

  if (routing.route === 'newsletter') {
    const strippedText = (message.bodyText || '').slice(0, DIGEST_TEXT_CAP);
    const result = await extractDigest(model, { sender: message.sender, strippedText });
    if (result.outcome === 'skipped') {
      upsertProcessedEmail({
        gmailMessageId: message.id, accountId, sender: message.sender, subject: message.subject,
        outcome: 'skipped', reason: result.reason, factRefs: [],
      });
      return 'skipped';
    }
    // Stub row first — digest_items.sourceEmailId FK requires the parent row to exist.
    upsertProcessedEmail({
      gmailMessageId: message.id, accountId, sender: message.sender, subject: message.subject,
      outcome: 'extracted', reason: null, factRefs: [],
    });
    const factRefs = result.items.map((headline) => `digest:${upsertDigestItem(headline, message, accountId)}`);
    upsertProcessedEmail({
      gmailMessageId: message.id, accountId, sender: message.sender, subject: message.subject,
      outcome: 'extracted', reason: null, factRefs,
    });
    return 'extracted';
  }

  const result = await extractTransactional(model, {
    sender: message.sender,
    subject: message.subject,
    bodyText: message.bodyText,
  });
  if (result.outcome === 'skipped') {
    upsertProcessedEmail({
      gmailMessageId: message.id, accountId, sender: message.sender, subject: message.subject,
      outcome: 'skipped', reason: result.reason, factRefs: [],
    });
    return 'skipped';
  }
  upsertProcessedEmail({
    gmailMessageId: message.id, accountId, sender: message.sender, subject: message.subject,
    outcome: 'extracted', reason: null, factRefs: [],
  });
  const factRefs = result.facts.map((fact) => writeFact(fact, message.id)).filter(Boolean);
  upsertProcessedEmail({
    gmailMessageId: message.id, accountId, sender: message.sender, subject: message.subject,
    outcome: 'extracted', reason: null, factRefs,
  });
  return 'extracted';
}

/** Fetches and processes one connected account's new mail. Returns a run summary. */
export async function processAccount(accountId) {
  const { messages, skipped } = await fetchAccountMessages(accountId);
  const allowlist = db.prepare('SELECT pattern, kind, type FROM allowlist_entries WHERE accountId = ?').all(accountId);

  let extracted = 0;
  let skippedCount = 0;
  let errors = 0;

  for (const skip of skipped) {
    if (alreadyProcessed(skip.id)) continue;
    upsertProcessedEmail({
      gmailMessageId: skip.id, accountId, sender: '', subject: '',
      outcome: 'skipped', reason: skip.reason, factRefs: [],
    });
    skippedCount += 1;
  }

  for (const message of messages) {
    if (alreadyProcessed(message.id)) continue;
    try {
      const outcome = await processMessage(accountId, message, allowlist);
      if (outcome === 'extracted') extracted += 1;
      else skippedCount += 1;
    } catch (err) {
      console.error(`[ingest] ${message.id} error: ${err.message}`);
      upsertProcessedEmail({
        gmailMessageId: message.id, accountId, sender: message.sender, subject: message.subject,
        outcome: 'skipped', reason: 'error', factRefs: [],
      });
      errors += 1;
    }
  }

  return { accountId, extracted, skipped: skippedCount, errors };
}

/** Runs the full pipeline over every connected account; one account's failure never blocks the others. */
export async function runIngestionPipeline() {
  const accounts = db.prepare("SELECT id FROM mail_accounts WHERE status = 'connected'").all();
  const results = [];
  for (const { id } of accounts) {
    try {
      results.push(await processAccount(id));
    } catch (err) {
      console.error(`[ingest] pipeline failed for account ${id}: ${err.message}`);
      results.push({ accountId: id, error: err.message });
    }
  }
  return results;
}

/**
 * Rejects a previously extracted fact (ENGINEERING §4.3 / §6 `DELETE
 * /api/ingest/facts/:ref`): deletes the fact's row and marks its source
 * email `outcome:'skipped', reason:'user-rejected'` so it is never
 * resurrected. `ref` is `"<factType>:<id>"` as produced by writeFact/
 * upsertDigestItem above. Returns false if the ref is malformed or the row
 * was already gone.
 */
export function rejectFact(ref) {
  const [factType, id] = String(ref).split(':');
  const table = FACT_TABLES[factType];
  if (!table || !id) return false;

  const result = db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
  if (result.changes === 0) return false;

  const rows = db.prepare('SELECT gmailMessageId, factRefs FROM processed_emails').all();
  for (const row of rows) {
    let refs = [];
    try {
      refs = JSON.parse(row.factRefs || '[]');
    } catch {
      refs = [];
    }
    if (refs.includes(ref)) {
      db.prepare(`
        UPDATE processed_emails SET outcome = 'skipped', reason = 'user-rejected' WHERE gmailMessageId = ?
      `).run(row.gmailMessageId);
      break;
    }
  }
  return true;
}
