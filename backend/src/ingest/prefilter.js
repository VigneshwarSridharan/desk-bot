// Cheap, no-LLM message routing per ENGINEERING.md §4.1 / PRD F1.2 step 2.
//
// Runs after google/gmail.js fetch and before agent/extractAgent.js. Pure
// function of a parsed message + that account's allowlist entries — no I/O,
// no DB writes (the caller records processed_emails with the outcome).

function normalizeSenderAddress(sender) {
  const match = String(sender || '').match(/<([^>]+)>/);
  return (match ? match[1] : sender || '').trim().toLowerCase();
}

// Gmail's server-side query already scoped the fetch to (senders OR labels)
// for this account — a message reaching here is expected to match one of
// them. gmail.js doesn't carry labelIds on the parsed message, so a sender
// pattern mismatch can't disprove a label match; only genuinely discard when
// there are no label entries that could explain how this message was fetched.
function matchAllowlistEntry(message, allowlistEntries) {
  const senderEntries = allowlistEntries.filter((e) => (e.kind || 'sender') === 'sender');
  const labelEntries = allowlistEntries.filter((e) => e.kind === 'label');

  const senderAddr = normalizeSenderAddress(message.sender);
  const senderMatch = senderEntries.find((e) => e.pattern?.toLowerCase() === senderAddr);
  if (senderMatch) return senderMatch;

  if (labelEntries.length > 0) return { pattern: null, kind: 'label', type: 'transactional' };

  return null;
}

/**
 * Routes a fetched message per ENGINEERING §4.1:
 *  - sender not in allowlist → discard, reason 'not-allowlisted' (defense in depth)
 *  - allowlist type 'newsletter' → newsletter path
 *  - `List-Unsubscribe` present on a transactional sender → discard, reason 'marketing'
 *  - `In-Reply-To`/`References` present (thread) → discard, reason 'thread'
 *  - else → transactional path
 *
 * Returns `{ route: 'discard'|'newsletter'|'transactional', reason? }`.
 */
export function prefilterMessage(message, allowlistEntries = []) {
  const entry = matchAllowlistEntry(message, allowlistEntries);
  if (!entry) return { route: 'discard', reason: 'not-allowlisted' };

  if (entry.type === 'newsletter') return { route: 'newsletter' };

  if (message.listUnsubscribe) return { route: 'discard', reason: 'marketing' };
  if (message.inReplyTo || message.references) return { route: 'discard', reason: 'thread' };

  return { route: 'transactional' };
}
