import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseInvoiceHandoff } from '../src/shared/invoiceHandoff.ts';

const file = (o: unknown) => JSON.stringify(o);

test('a Tiny Time hand-off is read and tidied', () => {
  const h = parseInvoiceHandoff('﻿' + file({
    tallyInvoice: 1,
    source: 'Tiny Time',
    customer: { name: '  Climate and Wildfire Institute ', address: '1 Fire Rd' },
    number: 'CW-3',
    issueDate: '2026-11-03',
    dueDays: 30,
    currency: 'usd',
    lines: [
      { description: 'CWI Database: Programming', quantity: 7, unitPrice: 250 },
      { description: 'Discount 5%', quantity: 1, unitPrice: -87.5 },
      { description: 'no price', quantity: 1 },
      { description: 'zero hours', quantity: 0, unitPrice: 250 },
    ],
  }));
  assert.equal(h.customer.name, 'Climate and Wildfire Institute');
  assert.equal(h.currency, 'USD');
  assert.equal(h.dueDays, 30);
  assert.deepEqual(h.lines.map((l) => l.unitPrice), [250, -87.5]);
});

test('bad hand-off files say what is wrong', () => {
  assert.throws(() => parseInvoiceHandoff('nope'), /valid JSON/);
  assert.throws(() => parseInvoiceHandoff(file({ customer: { name: 'A' } })), /isn't a Tiny Tally invoice/);
  assert.throws(() => parseInvoiceHandoff(file({ tallyInvoice: 2, customer: { name: 'A' }, lines: [] })), /newer version/);
  assert.throws(() => parseInvoiceHandoff(file({ tallyInvoice: 1, customer: {}, lines: [] })), /no customer/);
  assert.throws(() => parseInvoiceHandoff(file({ tallyInvoice: 1, customer: { name: 'A' }, lines: [] })), /no lines/);
});

test('optional fields fall back', () => {
  const h = parseInvoiceHandoff(file({ tallyInvoice: 1, customer: { name: 'A' }, issueDate: '3/11/2026', dueDays: -4, lines: [{ quantity: '1.5', unitPrice: '100' }] }));
  assert.equal(h.issueDate, null);
  assert.equal(h.dueDays, null);
  assert.equal(h.number, '');
  assert.equal(h.source, 'another app');
  assert.deepEqual(h.customer, { name: 'A', address: '', taxId: '', state: null, country: null });
  assert.deepEqual(h.lines, [{ description: '', quantity: 1.5, unitPrice: 100, hsn: '' }]);
});
