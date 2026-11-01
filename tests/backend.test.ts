// The backend against real books files: tax returns, reports and the ledger.
// Every expected figure here is worked out by hand from the transactions, so
// a change that moves a number on a tax return fails loudly.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeBooks } from './support/books.ts';
import { one, getBooks } from '../backend/db.ts';
import { saveContact, saveEntry } from '../backend/entries.ts';
import { getInvoice, recordPayment, saveInvoice } from '../backend/invoices.ts';
import { saveItem } from '../backend/items.ts';
import { balanceSheet, trialBalance } from '../backend/ledger.ts';
import {
  basReport,
  byContact,
  monthlyTotals,
  nzGstReport,
  profitAndLoss,
  reopenTaxReturn,
  salesTaxReport,
  saveTaxReturn,
  scheduleCReport,
} from '../backend/reports.ts';
import { getSettings } from '../backend/settings.ts';

const cat = (name: string) => one<{ id: number }>(getBooks().db, 'SELECT id FROM categories WHERE name = ?', name)!.id;
const bank = () => one<{ id: number }>(getBooks().db, 'SELECT id FROM accounts ORDER BY id LIMIT 1')!.id;

function money(date: string, kind: 'income' | 'expense', amount: number, category: string, extra: { taxCode?: string; contactId?: number } = {}) {
  return saveEntry({ date, kind, amount, accountId: bank(), categoryId: cat(category), ...extra } as any);
}

/** AU books for the July–September 2026 quarter (GST 10%). */
async function auQuarter() {
  const b = await makeBooks({ country: 'AU', fiscalYearStart: '07-01', taxEnabled: true });
  const ids = b.run(() => {
    const acme = saveContact({ kind: 'customer', name: 'Acme' });
    const landlord = saveContact({ kind: 'vendor', name: 'Landlord' });
    money('2026-08-05', 'income', 110000, 'Sales', { contactId: acme }); // GST 10000
    money('2026-08-06', 'income', 50000, 'Sales', { taxCode: 'FRE' });
    money('2026-08-07', 'income', 200000, 'Sales', { taxCode: 'EXP' });
    money('2026-08-08', 'expense', 220000, 'Rent', { contactId: landlord }); // GST 20000
    money('2026-08-09', 'expense', 330000, 'Equipment', { taxCode: 'CAP' }); // GST 30000
    money('2026-08-10', 'expense', 99900, 'Owner Drawings');
    const invoice = saveInvoice({
      contactId: acme,
      issueDate: '2026-08-15',
      dueDate: '2099-01-01',
      pricesIncludeTax: false,
      status: 'sent',
      lines: [{ description: 'Design', qtyMilli: 1000, unitPrice: 100000, categoryId: cat('Sales'), taxCode: 'GST' }],
    } as any);
    // Half paid inside the quarter.
    recordPayment({ invoiceId: invoice, date: '2026-09-20', amount: 55000, accountId: bank() });
    return { acme, invoice };
  });
  return { ...b, ...ids };
}

const Q = { from: '2026-07-01', to: '2026-09-30' };

test('AU BAS on a cash basis counts only the part of an invoice that was paid', async () => {
  const b = await auQuarter();
  const { figures, untagged } = b.run(() => basReport({ ...Q, basis: 'cash' }));
  assert.deepEqual(figures, { G1: 415000, G2: 200000, G3: 50000, G4: 0, G10: 330000, G11: 220000, '1A': 15000, '1B': 50000 });
  assert.equal(untagged, 0);
  b.close();
});

test('AU BAS on an accrual basis counts the whole invoice when issued', async () => {
  const b = await auQuarter();
  const { figures } = b.run(() => basReport({ ...Q, basis: 'accrual' }));
  assert.deepEqual(figures, { G1: 470000, G2: 200000, G3: 50000, G4: 0, G10: 330000, G11: 220000, '1A': 20000, '1B': 50000 });
  b.close();
});

test('Profit & Loss leaves out tax and owner drawings', async () => {
  const b = await auQuarter();
  b.run(() => {
    const cash = profitAndLoss({ ...Q, basis: 'cash' });
    assert.equal(cash.totals.income, 400000);
    assert.equal(cash.totals.expense, 500000);
    assert.equal(cash.totals.net, -100000);
    assert.deepEqual(cash.other.map((o: any) => [o.name, o.total]), [['Owner Drawings', 99900]]);
    assert.equal(profitAndLoss({ ...Q, basis: 'accrual' }).totals.income, 450000);
  });
  b.close();
});

test('sales by customer and the monthly chart add up to the Profit & Loss', async () => {
  const b = await auQuarter();
  b.run(() => {
    for (const basis of ['cash', 'accrual'] as const) {
      const pnl = profitAndLoss({ ...Q, basis }).totals;
      assert.equal(byContact({ ...Q, basis, kind: 'income' }).total, pnl.income, basis);
      assert.equal(byContact({ ...Q, basis, kind: 'expense' }).total, pnl.expense, basis);
      const months = monthlyTotals({ ...Q, basis });
      assert.deepEqual(months.map((m) => m.month), ['2026-07', '2026-08', '2026-09']);
      assert.equal(months.reduce((s, m) => s + m.income, 0), pnl.income, basis);
      assert.equal(months.reduce((s, m) => s + m.expense, 0), pnl.expense, basis);
    }
    const sales = byContact({ ...Q, basis: 'cash', kind: 'income' });
    // Acme: 1000 ex GST in August, plus the paid half of the invoice (500 ex GST).
    assert.equal(sales.rows.find((r) => r.name === 'Acme')!.total, 150000);
    assert.equal(sales.rows.find((r) => r.id === 0)!.total, 250000);
  });
  b.close();
});

test('the ledger balances: trial balance and balance sheet', async () => {
  const b = await auQuarter();
  b.run(() => {
    const tb = trialBalance(Q.to);
    assert.equal(tb.debit, tb.credit);
    assert.ok(tb.debit > 0);
    const bs = balanceSheet({ asOf: Q.to, yearStart: Q.from });
    assert.equal(bs.totals.assets, bs.totals.liabilities + bs.totals.equity);
  });
  b.close();
});

test('invoice payments: part paid, no overpaying, then paid', async () => {
  const b = await auQuarter();
  b.run(() => {
    assert.equal(getInvoice(b.invoice).status, 'partial');
    assert.throws(() => recordPayment({ invoiceId: b.invoice, date: '2026-09-25', amount: 55001, accountId: bank() }));
    recordPayment({ invoiceId: b.invoice, date: '2026-09-25', amount: 55000, accountId: bank() });
    assert.equal(getInvoice(b.invoice).status, 'paid');
  });
  b.close();
});

test('lodging a return locks its period until it is reopened', async () => {
  const b = await auQuarter();
  b.run(() => {
    saveTaxReturn({ periodStart: Q.from, periodEnd: Q.to, basis: 'cash', lodge: true, acknowledged: true });
    assert.equal(getSettings().lockDate, Q.to);
    assert.throws(() => money('2026-09-15', 'expense', 1000, 'Rent'), /locked/);
    money('2026-10-01', 'expense', 1000, 'Rent');
    const id = one<{ id: number }>(getBooks().db, 'SELECT id FROM tax_returns')!.id;
    reopenTaxReturn(id);
    assert.equal(getSettings().lockDate, null);
    money('2026-09-15', 'expense', 1000, 'Rent');
  });
  b.close();
});

test('NZ GST return: Box 5 includes zero-rated sales, Box 6 is the zero-rated part', async () => {
  const b = await makeBooks({ country: 'NZ', fiscalYearStart: '04-01', taxEnabled: true });
  b.run(() => {
    money('2026-05-04', 'income', 115000, 'Sales'); // GST 15000
    money('2026-05-05', 'income', 50000, 'Sales', { taxCode: 'ZER' });
    money('2026-05-06', 'expense', 230000, 'Rent'); // GST 30000
    money('2026-05-07', 'expense', 10000, 'Owner Drawings');
    const { figures, untagged } = nzGstReport({ from: '2026-05-01', to: '2026-06-30', basis: 'cash' });
    assert.deepEqual(figures, { '5': 165000, '6': 50000, '11': 230000 });
    assert.equal(untagged, 0);
  });
  b.close();
});

test('US sales tax at 8.875% and Schedule C with half of meals deductible', async () => {
  const b = await makeBooks({ country: 'US', fiscalYearStart: '01-01', taxEnabled: true, taxRatePpm: 88750 });
  b.run(() => {
    const client = saveContact({ kind: 'customer', name: 'Client' });
    saveInvoice({
      contactId: client,
      issueDate: '2025-03-01',
      dueDate: '2025-03-31',
      pricesIncludeTax: false,
      status: 'sent',
      lines: [{ description: 'Work', qtyMilli: 1000, unitPrice: 100000, categoryId: cat('Sales'), taxCode: 'TAX' }],
    } as any);
    money('2025-04-01', 'income', 5000, 'Interest Income');
    money('2025-04-02', 'expense', 20000, 'Meals & Entertainment');
    money('2025-04-03', 'expense', 100000, 'Rent');
    const year = { from: '2025-01-01', to: '2025-12-31', basis: 'accrual' as const };

    const st = salesTaxReport(year);
    assert.deepEqual(st.totals, { taxableSales: 100000, nonTaxableSales: 5000, taxCollected: 8875, totalSales: 105000 });

    const sc = scheduleCReport(year);
    assert.deepEqual(sc.totals, { grossIncome: 105000, totalExpenses: 110000, netProfit: -5000 });
    assert.equal(sc.lines.find((l) => l.label.toLowerCase().includes('meals'))!.deductible, 10000);
    assert.deepEqual(sc.unmapped, []);
  });
  b.close();
});

test('items keep to their own side', async () => {
  const b = await makeBooks({ country: 'AU', fiscalYearStart: '07-01', taxEnabled: true });
  b.run(() => {
    assert.throws(() => saveItem({ kind: 'income', name: 'Rent?', unitPrice: 100, priceIncludesTax: false, categoryId: cat('Rent') }), /income category/);
    const id = saveItem({ kind: 'expense', name: 'Desk hire', unitPrice: 5500, priceIncludesTax: true, categoryId: cat('Rent'), taxCode: 'GST' });
    assert.equal(one<any>(getBooks().db, 'SELECT tax_code FROM items WHERE id = ?', id).tax_code, 'GST');
  });
  b.close();
});
