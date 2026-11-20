// A clean import clears the lists a file brings before bringing them in,
// and leaves everything else in the books alone.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeBooks } from './support/books.ts';
import { all, getBooks, one, run } from '../backend/db.ts';
import { saveEntry } from '../backend/entries.ts';
import { DEMO_NAMES, DEMO_SETUP, seedDemo } from '../backend/demo.ts';
import { trialBalance } from '../backend/ledger.ts';
import { commitImport } from '../backend/importer.ts';
import { cleanLists, type ImportBatch, type ImportPlan } from '../src/shared/import.ts';

const db = () => getBooks().db;
const n = (table: string) => one<{ n: number }>(db(), `SELECT COUNT(*) AS n FROM ${table}`)!.n;
const names = (table: string) => all<{ name: string }>(db(), `SELECT name FROM ${table} ORDER BY name`).map((r) => r.name);

const batch: ImportBatch = {
  source: 'qbm',
  accounts: [{ key: 'chq', name: 'Cheque', kind: 'bank' }],
  categories: [
    { key: 'fees', name: 'Consulting fees', kind: 'income' },
    { key: 'soft', name: 'Software', kind: 'expense' },
  ],
  contacts: [{ name: 'Acme Pty Ltd', kind: 'customer' }],
  entries: [
    { ref: 'q1', date: '2026-08-01', kind: 'income', amount: 50_000, accountKey: 'chq', categoryKey: 'fees', contactName: 'Acme Pty Ltd' },
    { ref: 'q2', date: '2026-08-02', kind: 'expense', amount: 3_000, accountKey: 'chq', categoryKey: 'soft' },
  ],
  skipped: [],
};

const plan = (clean: boolean, accounts: ImportPlan['accounts'] = {}): ImportPlan => ({
  batch,
  accounts,
  categories: {},
  fallbackCategory: { income: null, expense: null },
  clean,
});

test('the lists a clean import clears are the ones the file has', () => {
  assert.deepEqual(cleanLists(batch), ['entries', 'contacts', 'categories', 'accounts']);
  assert.deepEqual(cleanLists({ ...batch, entries: [], accounts: [] }), ['contacts', 'categories']);
});

test('a clean import replaces transactions, contacts, categories and accounts, and keeps the rest', async () => {
  const b = await makeBooks({ country: 'AU', fiscalYearStart: '07-01', taxEnabled: true });
  b.run(() => {
    // What's there before: an old account with a transaction, a contact, a rule, an item, a template.
    const old = one<{ id: number }>(db(), "INSERT INTO accounts (name, kind, opening_balance, opening_date) VALUES ('Old bank', 'bank', 0, '2026-01-01') RETURNING id")!.id;
    const rent = one<{ id: number }>(db(), "SELECT id FROM categories WHERE name = 'Rent'")!.id;
    saveEntry({ date: '2026-07-15', kind: 'expense', amount: 99_900, accountId: old, categoryId: rent } as any);
    run(db(), "INSERT INTO contacts (kind, name) VALUES ('vendor', 'Old Landlord')");
    run(db(), "INSERT INTO rules (pattern, kind, category_id) VALUES ('RENT', 'expense', ?)", rent);
    run(db(), "INSERT INTO items (kind, name, unit_price, category_id) VALUES ('expense', 'Widget', 1000, ?)", rent);
    const templates = n('invoice_templates');
    const settingsBefore = all(db(), "SELECT key, value FROM meta WHERE key NOT LIKE 'depreciation%' ORDER BY key");

    const result = commitImport(plan(true));

    assert.equal(result.cleared?.entries, 1);
    assert.equal(result.entriesCreated, 2);
    // Only what the file brought.
    assert.deepEqual(names('accounts'), ['Cheque']);
    assert.deepEqual(names('categories'), ['Consulting fees', 'Software']);
    assert.deepEqual(names('contacts'), ['Acme Pty Ltd']);
    assert.equal(n('entries'), 2);
    // Rules went with their category; the item stays, without one.
    assert.equal(n('rules'), 0);
    assert.equal(one<{ c: number | null }>(db(), "SELECT category_id AS c FROM items WHERE name = 'Widget'")!.c, null);
    // Setup is untouched.
    assert.equal(n('invoice_templates'), templates);
    assert.deepEqual(all(db(), "SELECT key, value FROM meta WHERE key NOT LIKE 'depreciation%' ORDER BY key"), settingsBefore);
  });
  b.close();
});

test('a clean import keeps an account the file is matched to', async () => {
  const b = await makeBooks({ country: 'AU', fiscalYearStart: '07-01', taxEnabled: true });
  b.run(() => {
    const mine = one<{ id: number }>(db(), "INSERT INTO accounts (name, kind, opening_balance, opening_date) VALUES ('My bank', 'bank', 0, '2026-01-01') RETURNING id")!.id;
    run(db(), "INSERT INTO accounts (name, kind, opening_balance, opening_date) VALUES ('Spare', 'bank', 0, '2026-01-01')");
    const result = commitImport(plan(true, { chq: { existingId: mine } }));
    assert.equal(result.entriesCreated, 2);
    assert.deepEqual(names('accounts'), ['My bank']);
  });
  b.close();
});

test('without clean, nothing is cleared', async () => {
  const b = await makeBooks({ country: 'AU', fiscalYearStart: '07-01', taxEnabled: true });
  b.run(() => {
    const before = n('categories');
    const result = commitImport(plan(false));
    assert.equal(result.cleared, undefined);
    assert.equal(n('categories'), before + 2);
  });
  b.close();
});

test('a clean import over well-used books: invoices, payments, reconciliations, assets, journals', async () => {
  const b = await makeBooks({ name: DEMO_NAMES.AU, ...DEMO_SETUP.AU });
  b.run(() => {
    seedDemo('2026-11-03', 'AU');
    run(db(), "DELETE FROM meta WHERE key = 'lock_date'");
    const full: ImportBatch = {
      ...batch,
      documents: [{
        ref: 'd1', docType: 'invoice', number: 'QB-1', contactName: 'Acme Pty Ltd', issueDate: '2026-08-01', dueDate: '2026-08-15',
        pricesIncludeTax: false, lines: [{ description: 'Work', categoryKey: 'fees', qtyMilli: 1000, unitPrice: 50_000, net: 50_000, tax: 5_000, taxCode: 'GST' }],
      }],
      journals: [{ date: '2026-08-31', memo: 'Accrual', lines: [{ categoryKey: 'soft', amount: 1_000 }, { system: 'accruals', amount: -1_000 }] }],
    };
    for (const t of ['entries', 'invoices', 'journals', 'reconciliations', 'assets']) assert.ok(n(t) > 0, `demo has ${t}`);
    const assets = n('assets');

    const result = commitImport({ ...plan(true), batch: full });

    assert.equal(result.failedCount, 0, JSON.stringify(result.failed));
    assert.equal(n('entries'), 2);
    assert.equal(n('invoices'), 1);
    assert.equal(n('journals'), 1);
    assert.equal(n('reconciliations'), 0);
    assert.deepEqual(names('accounts'), ['Cheque']);
    // Assets are setup, not a list this file brings: kept, without their old purchase link.
    assert.equal(n('assets'), assets);
    const tb = trialBalance('2027-06-30');
    assert.equal(tb.debit, tb.credit);
  });
  b.close();
});
