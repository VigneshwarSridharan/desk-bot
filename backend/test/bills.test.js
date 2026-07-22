import { test, describe, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { createBaseTables, runMigrations } from '../src/store/migrations.js';

function makeDb() {
  const db = new DatabaseSync(':memory:');
  createBaseTables(db);
  runMigrations(db);
  return db;
}

const testDb = makeDb();
mock.module('../src/store/db.js', { defaultExport: testDb });

const { default: billsRoutes } = await import('../src/routes/bills.js');

let server;
let baseUrl;

before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/bills', billsRoutes);
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/bills`;
});

after(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => {
  testDb.exec('DELETE FROM bills;');
});

function seedBill(overrides = {}) {
  const id = overrides.id || 'bill-1';
  testDb.prepare(`
    INSERT INTO bills (id, vendor, amount, currency, dueDate, status, sourceEmailId)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    overrides.vendor || 'Airtel',
    overrides.amount ?? 599,
    overrides.currency || 'INR',
    overrides.dueDate || '2026-08-01',
    overrides.status || 'due',
    overrides.sourceEmailId || 'm-1',
  );
  return id;
}

describe('GET /api/bills', () => {
  test('lists bills ordered by due date', async () => {
    seedBill({ id: 'b-2', dueDate: '2026-08-10' });
    seedBill({ id: 'b-1', dueDate: '2026-08-01' });

    const res = await fetch(baseUrl);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.length, 2);
    assert.equal(body[0].id, 'b-1');
  });
});

describe('PATCH /api/bills/:id', () => {
  test('marks a bill paid', async () => {
    const id = seedBill();
    const res = await fetch(`${baseUrl}/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'paid' }),
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.status, 'paid');

    const row = testDb.prepare('SELECT status FROM bills WHERE id = ?').get(id);
    assert.equal(row.status, 'paid');
  });

  test('ignores unknown fields', async () => {
    const id = seedBill();
    const res = await fetch(`${baseUrl}/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceEmailId: 'hacked', status: 'paid' }),
    });
    assert.equal(res.status, 200);
    const row = testDb.prepare('SELECT * FROM bills WHERE id = ?').get(id);
    assert.equal(row.sourceEmailId, 'm-1');
    assert.equal(row.status, 'paid');
  });

  test('404s for an unknown bill', async () => {
    const res = await fetch(`${baseUrl}/does-not-exist`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'paid' }),
    });
    assert.equal(res.status, 404);
  });
});
