import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeBooks } from './support/books.ts';
import { getBooks, one } from '../backend/db.ts';
import { saveEntry } from '../backend/entries.ts';
import { budgetFor, getBudget, saveBudget } from '../backend/budgets.ts';
import { profitAndLoss } from '../backend/reports.ts';

const cat = (name: string) => one<{ id: number }>(getBooks().db, 'SELECT id FROM categories WHERE name = ?', name)!.id;

test('a budget is pro-rated by the days a range covers', async () => {
  const b = await makeBooks({ country: 'AU', fiscalYearStart: '07-01', taxEnabled: true });
  b.run(() => {
    const rent = cat('Rent');
    // 3000 in June (30 days), 3100 in July (31 days).
    saveBudget({ cells: [{ categoryId: rent, month: '2026-06', amount: 300000 }, { categoryId: rent, month: '2026-07', amount: 310000 }] });
    assert.equal(budgetFor('2026-06-01', '2026-06-30').get(rent), 300000);
    assert.equal(budgetFor('2026-06-01', '2026-06-10').get(rent), 100000);
    // 21–30 June is 10/30 of June, 1–10 July is 10/31 of July.
    assert.equal(budgetFor('2026-06-21', '2026-07-10').get(rent), 200000);
    assert.equal(budgetFor('2026-08-01', '2026-08-31').get(rent), undefined);
  });
  b.close();
});

test('saving: zero clears a month, and only income and expense categories', async () => {
  const b = await makeBooks({ country: 'AU', fiscalYearStart: '07-01', taxEnabled: true });
  b.run(() => {
    const rent = cat('Rent');
    saveBudget({ cells: [{ categoryId: rent, month: '2026-07', amount: 5000 }, { categoryId: rent, month: '2026-08', amount: 6000 }] });
    saveBudget({ cells: [{ categoryId: rent, month: '2026-07', amount: 0 }] });
    const { months, rows } = getBudget('2026-07');
    assert.equal(months[0], '2026-07');
    assert.equal(months[11], '2027-06');
    assert.deepEqual(rows, [{ categoryId: rent, amounts: [0, 6000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] }]);
    assert.throws(() => saveBudget({ cells: [{ categoryId: cat('Owner Drawings'), month: '2026-07', amount: 100 }] }), /can't have a budget/);
    assert.throws(() => saveBudget({ cells: [{ categoryId: rent, month: '2026-13', amount: 100 }] }), /month/);
    assert.throws(() => saveBudget({ cells: [{ categoryId: rent, month: '2026-07', amount: -1 }] }), /negative/);
  });
  b.close();
});

test('the Profit & Loss shows budgets beside actuals, including budgeted categories with no activity', async () => {
  const b = await makeBooks({ country: 'AU', fiscalYearStart: '07-01', taxEnabled: true });
  b.run(() => {
    const bank = one<{ id: number }>(getBooks().db, 'SELECT id FROM accounts LIMIT 1')!.id;
    saveEntry({ date: '2026-07-10', kind: 'income', amount: 110000, accountId: bank, categoryId: cat('Sales') } as any);
    saveBudget({
      cells: [
        { categoryId: cat('Sales'), month: '2026-07', amount: 120000 },
        { categoryId: cat('Travel'), month: '2026-07', amount: 30000 },
      ],
    });
    const r = profitAndLoss({ from: '2026-07-01', to: '2026-07-31', basis: 'cash', budget: true });
    assert.deepEqual(r.income.map((x) => [x.name, x.total, x.budget]), [['Sales', 100000, 120000]]);
    assert.deepEqual(r.expense.map((x) => [x.name, x.total, x.budget]), [['Travel', 0, 30000]]);
    assert.equal(r.totals.budgetNet, 90000);
    // Without asking, no budget figures.
    assert.equal(profitAndLoss({ from: '2026-07-01', to: '2026-07-31', basis: 'cash' }).totals.budgetNet, undefined);
  });
  b.close();
});
