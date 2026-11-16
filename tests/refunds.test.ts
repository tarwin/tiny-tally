// Refunds: money back on a category's other side. A supplier's refund is
// income on an expense category; it comes off that expense and its GST.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fakeApp } from './support/app.ts';
import { makeBooks } from './support/books.ts';
import { getBooks, one } from '../backend/db.ts';
import { api } from '../backend/main.ts';
import { listEntries, saveEntry } from '../backend/entries.ts';
import { commitImport } from '../backend/importer.ts';
import { basReport, profitAndLoss } from '../backend/reports.ts';
import { trialBalance } from '../backend/ledger.ts';
import { parseIif } from '../src/lib/import/iif.ts';

const cat = (name: string) => one<{ id: number }>(getBooks().db, 'SELECT id FROM categories WHERE name = ?', name)!.id;
const bank = () => one<{ id: number }>(getBooks().db, "SELECT id FROM accounts WHERE kind = 'bank' ORDER BY id LIMIT 1")!.id;
const entry = (kind: 'income' | 'expense', amount: number, category: string, refund = false) =>
  saveEntry({ date: '2026-08-10', kind, amount, accountId: bank(), categoryId: cat(category), refund });

test('a refund comes off its category, the P&L and the BAS, and the books still balance', async () => {
  const b = await makeBooks({ country: 'AU', fiscalYearStart: '07-01', taxEnabled: true, taxRatePpm: 100_000 });
  b.run(() => {
    entry('expense', 11_000, 'Office Supplies');
    entry('income', 2_200, 'Office Supplies', true); // the supplier gave $22 back
    entry('income', 11_000, 'Sales');
    entry('expense', 5_500, 'Sales', true); // we gave a customer $55 back

    const { rows } = listEntries({});
    assert.deepEqual(rows.map((r: any) => [r.kind, r.amount, r.refund, r.taxAmount]), [
      ['expense', 5_500, true, 500],
      ['income', 11_000, false, 1_000],
      ['income', 2_200, true, 200],
      ['expense', 11_000, false, 1_000],
    ]);
    // The bank sees money in and out as it happened.
    const reg = listEntries({ accountId: bank() });
    assert.deepEqual([reg.inflow, reg.outflow], [13_200, 16_500]);

    const pl = profitAndLoss({ from: '2026-07-01', to: '2027-06-30', basis: 'cash' });
    assert.deepEqual([pl.totals.income, pl.totals.expense], [5_000, 8_000]);

    const bas = basReport({ from: '2026-07-01', to: '2026-09-30', basis: 'cash' }).figures;
    assert.deepEqual([bas.G1, bas['1A'], bas.G11, bas['1B']], [5_500, 500, 8_800, 800]);

    const tb = trialBalance('2027-06-30');
    assert.equal(tb.debit, tb.credit);
  });
  b.close();
});

test('a refund has to say so, and goes on the other side', async () => {
  const b = await makeBooks({ country: 'AU', fiscalYearStart: '07-01', taxEnabled: true });
  b.run(() => {
    assert.throws(() => entry('income', 1_000, 'Office Supplies'), /is an expense category/);
    assert.throws(() => entry('income', 1_000, 'Sales', true), /goes on an expense category/);
    assert.throws(() => entry('expense', 1_000, 'Rent', true), /goes on an income category/);
  });
  b.close();
});

test("a category that's been used can't change sides", async () => {
  fakeApp();
  const b = await makeBooks({ country: 'AU', fiscalYearStart: '07-01', taxEnabled: true });
  const call = (name: string, params: unknown) => api[name](params, null as any, { window: b.win } as any) as Promise<any>;
  const id = await call('categories.save', { name: 'Odd jobs', kind: 'expense' });
  await call('categories.save', { id, name: 'Odd jobs', kind: 'income' }); // nothing in it yet
  b.run(() => entry('income', 1_000, 'Odd jobs'));
  await assert.rejects(call('categories.save', { id, name: 'Odd jobs', kind: 'expense' }), /stays an income category/);
  b.close();
});

const row = (...cells: string[]) => cells.join('\t');
const file = [
  row('!ACCNT', 'NAME', 'ACCNTTYPE'),
  row('ACCNT', 'Cheque', 'BANK'),
  row('ACCNT', 'Travel', 'EXP'),
  row('ACCNT', 'Travel:Meals', 'EXP'),
  row('ACCNT', 'Travel:Air:Domestic', 'EXP'),
  row('ACCNT', 'Utilities', 'EXP'),
  row('ACCNT', 'Utilities:Meals', 'EXP'),
  row('ACCNT', 'Sales', 'INC'),
  row('ACCNT', 'Sales:Fees', 'EXP'),
  row('!TRNS', 'TRNSID', 'TRNSTYPE', 'DATE', 'ACCNT', 'AMOUNT'),
  row('!SPL', 'SPLID', 'TRNSTYPE', 'DATE', 'ACCNT', 'AMOUNT'),
  row('!ENDTRNS'),
  row('TRNS', '1', 'CHECK', '2/3/2026', 'Cheque', '-50.00'),
  row('SPL', '1a', 'CHECK', '2/3/2026', 'Travel:Meals', '50.00'),
  row('ENDTRNS'),
  // Money back on an expense account: a refund, not an income category.
  row('TRNS', '2', 'DEPOSIT', '2/4/2026', 'Cheque', '20.00'),
  row('SPL', '2a', 'DEPOSIT', '2/4/2026', 'Travel:Meals', '-20.00'),
  row('ENDTRNS'),
].join('\n');

test('QuickBooks sub-accounts become sub-categories, and money back on one is a refund', async () => {
  const p = parseIif(file);
  const shown = (c: (typeof p.categories)[number]) =>
    `${c.kind} ${c.parent ? `${p.categories.find((x) => x.key === c.parent)!.name} › ` : ''}${c.name}`;
  assert.deepEqual(p.categories.map(shown), [
    'expense Travel',
    'expense Travel › Meals',
    'expense Travel › Air: Domestic', // one level deep
    'expense Utilities',
    'expense Utilities › Meals',
    'income Sales',
    'expense Sales: Fees', // its parent is income, so it stays on its own
  ]);
  assert.deepEqual(p.entries.map((e) => [e.kind, e.categoryKey, !!e.refund]), [
    ['expense', 'expense:Travel:Meals', false],
    ['income', 'expense:Travel:Meals', true],
  ]);

  const b = await makeBooks({ country: 'AU', fiscalYearStart: '07-01', taxEnabled: false });
  b.run(() => {
    const db = getBooks().db;
    const plan = {
      batch: p,
      accounts: Object.fromEntries(p.accounts.map((a) => [a.key, { create: true as const }])),
      // "Travel" is one of the books' own, so its sub-categories go inside that.
      categories: Object.fromEntries(p.categories.map((c) => [c.key, c.key === 'expense:Travel' ? { existingId: cat('Travel') } : { create: true as const }])),
      fallbackCategory: { income: null, expense: null },
    };
    const r = commitImport(plan);
    assert.equal(r.failedCount, 0);
    const paths = (db.prepare(
      `SELECT CASE WHEN p.id IS NULL THEN c.name ELSE p.name || ' › ' || c.name END AS path
       FROM categories c LEFT JOIN categories p ON p.id = c.parent_id WHERE c.parent_id IS NOT NULL ORDER BY c.id`,
    ).all() as { path: string }[]).map((x) => x.path);
    // Two "Meals": the second is told apart by its parent.
    assert.deepEqual(paths, ['Travel › Meals', 'Travel › Air: Domestic', 'Utilities › Meals (Utilities)']);
    assert.ok(one(db, "SELECT id FROM categories WHERE name = 'Sales: Fees' AND parent_id IS NULL"));

    const { rows } = listEntries({});
    assert.deepEqual(rows.map((e: any) => [e.kind, e.categoryName, e.refund]), [['income', 'Meals', true], ['expense', 'Meals', false]]);
    const pl = profitAndLoss({ from: '2026-01-01', to: '2026-12-31', basis: 'cash' });
    assert.deepEqual([pl.totals.income, pl.totals.expense], [0, 3_000]);

    // Again: nothing new, and the sub-categories are found where they went.
    const again = commitImport({ ...plan, accounts: { Cheque: { existingId: one<{ id: number }>(db, "SELECT id FROM accounts WHERE name = 'Cheque'")!.id } } });
    assert.deepEqual([again.entriesCreated, again.duplicates, again.categoriesCreated], [0, 2, 0]);
  });
  b.close();
});
