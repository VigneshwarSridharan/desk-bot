// PDF attachment text extraction (Task 12 / ENGINEERING §4.2): readable,
// password-protected, and image-only (unreadable) PDFs. Uses real fixture
// PDFs under test/fixtures/pdfs/ rather than mocking pdfjs-dist, since the
// whole point of this module is the actual parsing behavior.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readPdfAttachment, tryPdfPassword, isPdfAttachment } from '../src/ingest/attachments.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PDFS_DIR = join(__dirname, 'fixtures/pdfs');

function loadPdf(name) {
  return readFileSync(join(PDFS_DIR, name));
}

describe('isPdfAttachment', () => {
  test('matches by mimeType', () => {
    assert.equal(isPdfAttachment({ mimeType: 'application/pdf', filename: 'statement' }), true);
  });

  test('matches by filename extension when mimeType is generic', () => {
    assert.equal(isPdfAttachment({ mimeType: 'application/octet-stream', filename: 'note.PDF' }), true);
  });

  test('rejects a non-PDF attachment', () => {
    assert.equal(isPdfAttachment({ mimeType: 'image/png', filename: 'photo.png' }), false);
  });
});

describe('readPdfAttachment', () => {
  test('returns extracted text for a readable, unencrypted PDF', async () => {
    const result = await readPdfAttachment(loadPdf('statement-plain.pdf'));
    assert.equal(result.status, 'ok');
    assert.match(result.text, /Contract Note/);
  });

  test('reports password-required for an encrypted PDF', async () => {
    const result = await readPdfAttachment(loadPdf('contract-note-locked.pdf'));
    assert.equal(result.status, 'password-required');
  });

  test('reports unreadable for an image-only PDF with no text layer', async () => {
    const result = await readPdfAttachment(loadPdf('image-only.pdf'));
    assert.equal(result.status, 'unreadable');
  });
});

describe('tryPdfPassword', () => {
  test('succeeds with the correct password', async () => {
    const result = await tryPdfPassword(loadPdf('contract-note-locked.pdf'), 'ABCDE1234F15011990');
    assert.equal(result.status, 'ok');
    assert.match(result.text, /TCS/);
  });

  test('reports incorrect-password for a wrong candidate', async () => {
    const result = await tryPdfPassword(loadPdf('contract-note-locked.pdf'), 'wrong-guess');
    assert.equal(result.status, 'incorrect-password');
  });

  test('repeated attempts against the same buffer each get their own copy (no false failures)', async () => {
    const buffer = loadPdf('contract-note-locked.pdf');
    const first = await tryPdfPassword(buffer, 'still-wrong');
    const second = await tryPdfPassword(buffer, 'ABCDE1234F15011990');
    assert.equal(first.status, 'incorrect-password');
    assert.equal(second.status, 'ok');
  });
});
