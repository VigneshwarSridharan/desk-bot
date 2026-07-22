// Third agent role (ENGINEERING.md §5.1/§5.2): a single generateText call
// (no tool loop) that classifies + extracts structured facts from one
// allowlisted, prefiltered email, or pulls headline items from a
// newsletter digest. Model comes from getModelForRole("extract") — the
// EXTRACT_LLM_PROVIDER/MODEL/API_KEY/BASE_URL overrides already work via
// modelProvider.js's generic per-role resolution.
//
// Prompt rule: omit a fact rather than guess a field. Malformed JSON gets
// one "fix your JSON" retry; still-malformed output resolves to a skip, not
// a throw — extraction failures must never block the ingestion pipeline.

import { generateText } from 'ai';
import { z } from 'zod';

const CONFIDENCE_THRESHOLD = 0.5;
const DIGEST_MIN_ITEMS = 2;
const DIGEST_MAX_ITEMS = 4;

const FactSchema = z.union([
  z.object({
    type: z.literal('bill'),
    vendor: z.string(),
    amount: z.number(),
    currency: z.string().optional().default('INR'),
    dueDate: z.string(),
  }),
  z.object({
    type: z.literal('event'),
    title: z.string(),
    date: z.string(),
    time: z.string().nullable().optional().default(null),
  }),
  z.object({
    type: z.literal('task'),
    title: z.string(),
    due: z.string().nullable().optional().default(null),
    priority: z.string().optional().default('medium'),
  }),
  z.object({
    type: z.literal('trade'),
    symbol: z.string(),
    side: z.enum(['buy', 'sell']),
    quantity: z.number(),
    price: z.number(),
  }),
]);

const TRANSACTIONAL_SYSTEM_PROMPT = `You classify and extract structured facts from a single allowlisted email for a personal desk assistant.

Respond with ONLY a JSON object (no markdown fences, no explanation) of this exact shape:
{
  "intent": "transaction|bill|event|task|delivery|statement|other",
  "confidence": 0.0,
  "passwordHint": "verbatim sentence describing an attachment password, or null",
  "facts": [
    { "type": "bill",  "vendor": "", "amount": 0, "currency": "INR", "dueDate": "YYYY-MM-DD" },
    { "type": "event", "title": "", "date": "YYYY-MM-DD", "time": "HH:MM or null" },
    { "type": "task",  "title": "", "due": "YYYY-MM-DD or null", "priority": "high|medium|low" },
    { "type": "trade", "symbol": "", "side": "buy|sell", "quantity": 0, "price": 0 }
  ]
}

Rules:
- Omit a fact entirely rather than guess a field you are not confident about.
- facts may be empty — not every email carries a structured fact (e.g. a delivery notice).
- confidence reflects how sure you are of the intent classification, 0.0-1.0.
- passwordHint is null unless the email states how an attachment's password is derived.`;

const DIGEST_SYSTEM_PROMPT = `You extract headline items from a newsletter email for a personal desk assistant's inbox digest.

Respond with ONLY a JSON object (no markdown fences, no explanation) of this exact shape:
{ "items": ["headline 1", "headline 2"] }

Rules:
- Produce ${DIGEST_MIN_ITEMS}-${DIGEST_MAX_ITEMS} short headline items, each a single sentence.
- Only include real news/updates from the newsletter body — no ads, no boilerplate, no footer text.`;

function stripFences(text) {
  let trimmed = String(text ?? '').trim();
  if (trimmed.startsWith('```')) {
    trimmed = trimmed.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '').trim();
  }
  return trimmed;
}

function tryParseJson(text) {
  try {
    return JSON.parse(stripFences(text));
  } catch {
    return null;
  }
}

function normalizeFacts(rawFacts) {
  if (!Array.isArray(rawFacts)) return [];
  const facts = [];
  for (const raw of rawFacts) {
    const result = FactSchema.safeParse(raw);
    if (result.success) facts.push(result.data);
  }
  return facts;
}

const VALID_INTENTS = ['transaction', 'bill', 'event', 'task', 'delivery', 'statement', 'other'];

function parseTransactionalResponse(text) {
  const json = tryParseJson(text);
  if (!json || typeof json !== 'object') return null;
  const { intent, confidence } = json;
  if (!VALID_INTENTS.includes(intent) || typeof confidence !== 'number') return null;
  return {
    intent,
    confidence,
    passwordHint: typeof json.passwordHint === 'string' ? json.passwordHint : null,
    facts: normalizeFacts(json.facts),
  };
}

function parseDigestResponse(text) {
  const json = tryParseJson(text);
  if (!json || !Array.isArray(json.items)) return null;
  const items = json.items.filter((i) => typeof i === 'string' && i.trim()).map((i) => i.trim());
  if (!items.length) return null;
  return { items: items.slice(0, DIGEST_MAX_ITEMS) };
}

async function callModel(model, system, prompt) {
  const result = await generateText({ model, maxRetries: 0, system, prompt });
  return result.text;
}

// One "fix your JSON" retry on malformed/unparseable output, per ENGINEERING
// §5.2. Never throws — a still-malformed second attempt resolves to null so
// the caller can skip+log rather than block the pipeline.
async function runWithJsonRetry(model, system, prompt, parseFn) {
  const first = await callModel(model, system, prompt);
  const parsed = parseFn(first);
  if (parsed) return parsed;

  const retryPrompt = `${prompt}\n\nYour previous response was not valid JSON matching the required schema:\n${first}\n\nRespond again with ONLY the corrected JSON — no markdown fences, no explanation.`;
  const retry = await callModel(model, system, retryPrompt);
  return parseFn(retry);
}

function buildTransactionalPrompt({ sender, subject, bodyText, attachmentText }) {
  return `Sender: ${sender}
Subject: ${subject}
Body:
${bodyText || '(empty)'}${attachmentText ? `\n\nAttachment text:\n${attachmentText}` : ''}`;
}

function buildDigestPrompt({ sender, strippedText }) {
  return `Sender: ${sender}
Newsletter text:
${strippedText || '(empty)'}`;
}

/**
 * Transactional-mode extraction (ENGINEERING §5.2). Input:
 * `{sender, subject, bodyText, attachmentText?}`. Returns
 * `{ outcome: 'extracted', intent, confidence, passwordHint, facts }` or
 * `{ outcome: 'skipped', reason: 'extract-failed'|'low-confidence', ... }`.
 */
export async function extractTransactional(model, input) {
  const prompt = buildTransactionalPrompt(input);
  const parsed = await runWithJsonRetry(model, TRANSACTIONAL_SYSTEM_PROMPT, prompt, parseTransactionalResponse);
  if (!parsed) return { outcome: 'skipped', reason: 'extract-failed' };

  if (parsed.confidence < CONFIDENCE_THRESHOLD) {
    return {
      outcome: 'skipped',
      reason: 'low-confidence',
      intent: 'other',
      confidence: parsed.confidence,
      passwordHint: null,
      facts: [],
    };
  }

  return { outcome: 'extracted', ...parsed };
}

/**
 * Digest-mode extraction (ENGINEERING §5.2). Input: `{sender,
 * strippedText}`. Returns `{ outcome: 'extracted', items }` or
 * `{ outcome: 'skipped', reason: 'extract-failed' }`.
 */
export async function extractDigest(model, input) {
  const prompt = buildDigestPrompt(input);
  const parsed = await runWithJsonRetry(model, DIGEST_SYSTEM_PROMPT, prompt, parseDigestResponse);
  if (!parsed) return { outcome: 'skipped', reason: 'extract-failed' };
  return { outcome: 'extracted', items: parsed.items };
}
