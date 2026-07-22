// get_bills context-agent tool (Task 11 / ENGINEERING §5.3): due/overdue/
// unknown bills within 14 days, with the BILL priority rule's "due within 3
// days" flag the context agent uses to promote a bill to MEDIUM priority.

import { test, describe, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createBaseTables, runMigrations } from '../src/store/migrations.js';

function makeDb() {
  const db = new DatabaseSync(':memory:');
  createBaseTables(db);
  runMigrations(db);
  return db;
}

const testDb = makeDb();

function getBillsDueSoon(days = 14) {
  const future = new Date();
  future.setDate(future.getDate() + days);
  const futureStr = future.toISOString().slice(0, 10);
  return testDb.prepare(`
    SELECT * FROM bills
    WHERE status != 'paid' AND (dueDate IS NULL OR dueDate <= ?)
    ORDER BY (dueDate IS NULL), dueDate ASC
  `).all(futureStr);
}

mock.module('../src/store/db.js', {
  namedExports: { getBillsDueSoon },
});

const { getBillsTool } = await import('../src/tools/getBills.js');

function isoDaysFromNow(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function seedBill(overrides = {}) {
  const id = overrides.id || crypto.randomUUID();
  testDb.prepare(`
    INSERT INTO bills (id, vendor, amount, currency, dueDate, status, sourceEmailId)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    overrides.vendor || 'Airtel',
    overrides.amount ?? 599,
    overrides.currency || 'INR',
    overrides.dueDate === undefined ? isoDaysFromNow(1) : overrides.dueDate,
    overrides.status || 'due',
    overrides.sourceEmailId ?? null,
  );
  return id;
}

beforeEach(() => {
  testDb.exec('DELETE FROM bills');
});

describe('getBillsTool', () => {
  test('a bill due tomorrow is flagged dueWithin3Days', async () => {
    seedBill({ dueDate: isoDaysFromNow(1) });
    const result = await getBillsTool.execute({});
    assert.equal(result.total, 1);
    assert.equal(result.dueWithin3Days.length, 1);
    assert.equal(result.overdue.length, 0);
  });

  test('a bill due in 10 days lands in dueSoon, not dueWithin3Days', async () => {
    seedBill({ dueDate: isoDaysFromNow(10) });
    const result = await getBillsTool.execute({});
    assert.equal(result.dueSoon.length, 1);
    assert.equal(result.dueWithin3Days.length, 0);
  });

  test('an overdue bill is flagged overdue', async () => {
    seedBill({ dueDate: isoDaysFromNow(-2) });
    const result = await getBillsTool.execute({});
    assert.equal(result.overdue.length, 1);
    assert.equal(result.overdue[0].isOverdue, true);
  });

  test('a bill with no due date lands in unknown', async () => {
    seedBill({ dueDate: null });
    const result = await getBillsTool.execute({});
    assert.equal(result.unknown.length, 1);
  });

  test('paid bills are excluded entirely', async () => {
    seedBill({ status: 'paid', dueDate: isoDaysFromNow(1) });
    const result = await getBillsTool.execute({});
    assert.equal(result.total, 0);
  });

  test('bills due more than 14 days out are excluded', async () => {
    seedBill({ dueDate: isoDaysFromNow(20) });
    const result = await getBillsTool.execute({});
    assert.equal(result.total, 0);
  });
});
