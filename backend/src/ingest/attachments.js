// PDF attachment text extraction (ENGINEERING.md §4.2 / Task 12): reads an
// attachment's text layer via pdfjs-dist. Image-only (scanned) PDFs have no
// text layer at all — Phase 2 has no OCR (that's a Phase 3 candidate per
// PRD F1.3), so those are reported as 'unreadable' rather than guessed at.

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

export function isPdfAttachment(attachment) {
  const mimeType = attachment?.mimeType || '';
  const filename = attachment?.filename || '';
  return mimeType === 'application/pdf' || /\.pdf$/i.test(filename);
}

// pdfjs transfers/detaches the buffer it's handed between internal "worker"
// messages, so a second attempt against the same attachment (e.g. trying
// candidate passwords one after another) needs its own independent copy —
// `new Uint8Array(buffer)` on a Buffer/TypedArray copies into a fresh
// ArrayBuffer rather than sharing the existing one.
async function extractText(buffer, password) {
  const data = new Uint8Array(buffer);
  const doc = await getDocument({
    data,
    password,
    useWorkerFetch: false,
    isEvalSupported: false,
    verbosity: 0,
  }).promise;

  let text = '';
  for (let i = 1; i <= doc.numPages; i += 1) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((item) => item.str || '').join(' ') + '\n';
  }
  return text.trim();
}

/**
 * Attempts to read a PDF's text layer without a password. Returns:
 * - `{ status: 'ok', text }` — readable, non-empty text
 * - `{ status: 'password-required' }` — encrypted, needs a password
 * - `{ status: 'unreadable' }` — opens fine but has no text layer (image-only/scanned), or is otherwise unparseable
 */
export async function readPdfAttachment(buffer) {
  try {
    const text = await extractText(buffer, undefined);
    return text ? { status: 'ok', text } : { status: 'unreadable' };
  } catch (err) {
    if (err?.name === 'PasswordException') return { status: 'password-required' };
    return { status: 'unreadable' };
  }
}

/**
 * Attempts to read a PDF's text layer with one candidate password. Returns
 * the same shape as `readPdfAttachment`, plus `{ status: 'incorrect-password' }`.
 */
export async function tryPdfPassword(buffer, password) {
  try {
    const text = await extractText(buffer, password);
    return text ? { status: 'ok', text } : { status: 'unreadable' };
  } catch (err) {
    if (err?.name === 'PasswordException') return { status: 'incorrect-password' };
    return { status: 'unreadable' };
  }
}
