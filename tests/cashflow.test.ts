import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeBooks } from './support/books.ts';
import { getBooks, one, run } from '../backend/db.ts';
import { saveContact, saveEntry } from '../backend/entries.ts';
import { recordPayment, saveInvoice } from '../backend/invoices.ts';
import { saveJournal } from '../backend/journals.ts';
import { cashFlow } from '../backend/reports.ts';

const cat = (name: string) => one<{ id: number }>(getBooks().db, 'SELECT id FROM categories WHERE name = ?', name)!.id;

test('cash flow: every kind of movement, and opening plus movements comes to closing', async () => {
  const b = await makeBooks({ country: 'AU', fiscalYearStart: '07-01', taxEnabled: true });
  b.run(() => {
    const { db } = getBooks();
    const bank = one<{ id: number }>(db, 'SELECT id FROM accounts LIMIT 1')!.id;
    run(db, "UPDATE accounts SET opening_balance = 1000000, opening_date = '2025-01-01' WHERE id = ?", bank);
    // A card first tracked during the period, already owing 500.
    const card = one<{ id: number }>(db,
      "INSERT INTO accounts (name, kind, opening_balance, opening_date, sort) VALUES ('Card', 'credit_card', -50000, '2026-08-01', 1) RETURNING id")!.id;
    const laptop = one<{ id: number }>(db, "INSERT INTO categories (name, kind, class) VALUES ('Laptops', 'expense', 'asset') RETURNING id")!.id;
    const e = (date: string, kind: 'income' | 'expense', amount: number, categoryId: number, accountId = bank) =>
      saveEntry({ date, kind, amount, accountId, categoryId } as any);

    // Before the period: part of the opening cash.
    e('2026-06-15', 'income', 200000, cat('Sales'));

    e('2026-07-05', 'income', 110000, cat('Sales'));
    e('2026-07-06', 'expense', 22000, cat('Rent'), card);
    saveEntry({ date: '2026-07-20', kind: 'transfer', amount: 22000, accountId: bank, toAccountId: card } as any);
    e('2026-07-21', 'expense', 30000, cat('Owner Drawings'));
    e('2026-07-22', 'income', 100000, cat('Loan Received'));
    e('2026-07-23', 'expense', 55000, laptop);
    e('2026-07-24', 'expense', 40000, cat('GST / BAS Payment'));
    const client = saveContact({ kind: 'customer', name: 'Client' });
    const inv = saveInvoice({
      contactId: client, issueDate: '2026-07-01', dueDate: '2026-07-31', pricesIncludeTax: false, status: 'sent',
      lines: [{ description: 'Work', qtyMilli: 1000, unitPrice: 100000, categoryId: cat('Sales'), taxCode: 'GST' }],
    } as any);
    recordPayment({ invoiceId: inv, date: '2026-07-25', amount: 33000, accountId: bank });
    const supplier = saveContact({ kind: 'vendor', name: 'Supplier' });
    const bill = saveInvoice({
      docType: 'bill', contactId: supplier, issueDate: '2026-07-01', dueDate: '2026-07-31', pricesIncludeTax: true, status: 'sent',
      lines: [{ description: 'Parts', qtyMilli: 1000, unitPrice: 11000, categoryId: cat('Office Supplies'), taxCode: 'GST' }],
    } as any);
    recordPayment({ invoiceId: bill, date: '2026-07-26', amount: 11000, accountId: bank });
    // Depreciation moves no cash.
    saveJournal({ date: '2026-07-31', lines: [{ account: `cat:${cat('Equipment')}`, amount: 10000 }, { account: 'accumdep', amount: -10000 }] });

    const r = cashFlow({ from: '2026-07-01', to: '2026-09-30' });
    assert.deepEqual(r.operating.lines, [
      { label: 'Received from customers and other income', amount: 143000 },
      { label: 'Paid to suppliers and for expenses', amount: -33000 },
      { label: 'GST / BAS Payment', amount: -40000 },
    ]);
    assert.deepEqual(r.investing, { lines: [{ label: 'Laptops', amount: -55000 }], total: -55000 });
    assert.deepEqual(r.financing.lines, [{ label: 'Loan Received', amount: 100000 }, { label: 'Owner Drawings', amount: -30000 }]);
    assert.equal(r.net, 70000 - 55000 + 70000);
    assert.equal(r.opening, 1200000);
    assert.equal(r.started, -50000);
    assert.equal(r.opening + r.net + r.started, r.closing);
  });
  b.close();
});
