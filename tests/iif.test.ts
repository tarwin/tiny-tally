import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseIif } from '../src/lib/import/iif.ts';

const row = (...cells: string[]) => cells.join('\t');
const lists = [
  row('!HDR', 'PROD', 'VER'),
  row('HDR', 'Reckon Accounts Enterprise', 'Version 35.0D'),
  row('!ACCNT', 'NAME', 'ACCNTTYPE', 'OBAMOUNT'),
  row('ACCNT', 'Business Cheque', 'BANK', '"1,250.00"'),
  row('ACCNT', 'Sales', 'INC', '"-12,632.28"'),
  row('!VEND', 'NAME'),
  row('VEND', 'Officeworks'),
  row('!CUSTNAMEDICT', 'INDEX', 'LABEL'),
  row('CUSTNAMEDICT', '0', 'Field'),
  row('ENDCUSTNAMEDICT'),
  row('!TAXCODE', 'NAME'),
  row('TAXCODE', 'GST'),
];

test('a lists export says it has no transactions, and hides the housekeeping records', () => {
  const p = parseIif(lists.join('\r\n'));
  assert.equal(p.hasTransactions, false);
  assert.equal(p.product, 'Reckon Accounts');
  assert.deepEqual([p.accounts.length, p.categories.length, p.contacts.length, p.entries.length], [1, 1, 1, 0]);
  assert.deepEqual(p.skipped, []);
});

test('a file with transaction blocks imports them', () => {
  const p = parseIif([
    row('!ACCNT', 'NAME', 'ACCNTTYPE'),
    row('ACCNT', 'Business Cheque', 'BANK'),
    row('ACCNT', 'Office Supplies', 'EXP'),
    row('!TRNS', 'TRNSID', 'TRNSTYPE', 'DATE', 'ACCNT', 'AMOUNT'),
    row('!SPL', 'SPLID', 'TRNSTYPE', 'DATE', 'ACCNT', 'AMOUNT'),
    row('!ENDTRNS'),
    row('TRNS', '1', 'CHECK', '2/3/2026', 'Business Cheque', '-100.00'),
    row('SPL', '2', 'CHECK', '2/3/2026', 'Office Supplies', '100.00'),
    row('ENDTRNS'),
  ].join('\n'));
  assert.equal(p.hasTransactions, true);
  assert.equal(p.product, 'QuickBooks Desktop');
  assert.deepEqual(p.entries.map((e) => [e.date, e.kind, e.amount]), [['2026-02-03', 'expense', 10000]]);
});

const taxed = (rows: [string, string, string][]) => [
  row('!ACCNT', 'NAME', 'ACCNTTYPE'),
  row('ACCNT', 'Cheque', 'BANK'),
  row('ACCNT', 'Office', 'EXP'),
  row('ACCNT', 'GST Payable', 'OCLIAB'),
  row('!TRNS', 'TRNSID', 'TRNSTYPE', 'DATE', 'ACCNT', 'AMOUNT'),
  row('!SPL', 'SPLID', 'TRNSTYPE', 'DATE', 'ACCNT', 'AMOUNT'),
  row('!ENDTRNS'),
  ...rows.flatMap(([id, net, tax]) => [
    row('TRNS', id, 'CHECK', '2/3/2026', 'Cheque', String(-Number(net) - Number(tax))),
    row('SPL', `${id}a`, 'CHECK', '2/3/2026', 'Office', net),
    row('SPL', `${id}b`, 'CHECK', '2/3/2026', 'GST Payable', tax),
    row('ENDTRNS'),
  ]),
].join('\n');

test('a separate tax line folds into the purchase, not onto a category of its own', () => {
  const p = parseIif(taxed([['1', '100.00', '10.00']]));
  assert.deepEqual(p.entries.map((e) => [e.amount, e.taxAmount, e.taxCode, e.categoryKey]), [[11000, 1000, 'GST', 'expense:Office']]);
  assert.equal(p.categories.some((c) => c.key.includes('GST')), false);
  assert.equal(p.taxReview.fit, 1);
});

test('tax that does not fit one rate offers real examples, both ways', () => {
  const file = taxed([['1', '100.00', '10.00'], ['2', '200.00', '20.00'], ['3', '100.00', '40.00']]);
  const merged = parseIif(file);
  assert.equal(merged.taxReview.inferred, 3);
  assert.ok(merged.taxReview.fit < 0.9);
  const odd = merged.taxReview.examples[0];
  assert.deepEqual(odd.merge, [{ label: 'Office', amount: 14000, tax: 4000 }]);
  assert.deepEqual(odd.separate.map((l) => [l.label, l.amount, l.tax]).sort(), [['GST Payable', 4000, 0], ['Office', 10000, 0]]);
  const apart = parseIif(file, undefined, undefined, 'separate');
  const third = apart.entries.filter((e) => e.ref.startsWith('3'));
  assert.deepEqual(third.map((e) => [e.amount, e.taxAmount ?? null, e.categoryKey]).sort(), [[10000, 0, 'expense:Office'], [4000, null, 'expense:GST Payable']].sort());
});

test('paying the tax itself stays as it is', () => {
  const p = parseIif([
    row('!ACCNT', 'NAME', 'ACCNTTYPE'),
    row('ACCNT', 'Cheque', 'BANK'),
    row('ACCNT', 'GST Payable', 'OCLIAB'),
    row('!TRNS', 'TRNSID', 'TRNSTYPE', 'DATE', 'ACCNT', 'AMOUNT'),
    row('!SPL', 'SPLID', 'TRNSTYPE', 'DATE', 'ACCNT', 'AMOUNT'),
    row('!ENDTRNS'),
    row('TRNS', '1', 'CHECK', '2/3/2026', 'Cheque', '-500.00'),
    row('SPL', '1a', 'CHECK', '2/3/2026', 'GST Payable', '500.00'),
    row('ENDTRNS'),
  ].join('\n'));
  assert.deepEqual(p.entries.map((e) => [e.amount, e.taxAmount ?? null, e.categoryKey]), [[50000, null, 'expense:GST Payable']]);
});
