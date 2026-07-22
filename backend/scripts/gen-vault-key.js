#!/usr/bin/env node
// Generates a base64 32-byte VAULT_KEY and writes it into backend/.env,
// leaving any existing non-empty VAULT_KEY untouched.

import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '../.env');

let content = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
const match = content.match(/^VAULT_KEY=(.*)$/m);

if (match && match[1].trim()) {
  console.log('VAULT_KEY already set in backend/.env — leaving it unchanged.');
  process.exit(0);
}

const key = randomBytes(32).toString('base64');

if (match) {
  content = content.replace(/^VAULT_KEY=.*$/m, `VAULT_KEY=${key}`);
} else {
  if (content && !content.endsWith('\n')) content += '\n';
  content += `VAULT_KEY=${key}\n`;
}

writeFileSync(envPath, content);
console.log('Generated VAULT_KEY and saved it to backend/.env');
