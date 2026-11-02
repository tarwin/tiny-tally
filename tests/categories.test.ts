import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fakeApp } from './support/app.ts';
import { makeBooks } from './support/books.ts';
import { getBooks, one } from '../backend/db.ts';
import { api } from '../backend/main.ts';
import { saveEntry } from '../backend/entries.ts';
import { saveBudget } from '../backend/budgets.ts';
import { profitAndLoss } from '../backend/reports.ts';

test('sub-categories: one level, same side and type, and the P&L rolls them up', async () => {
  fakeApp();
  const b = await makeBooks({ country: 'AU', fiscalYearStart: '07-01', taxEnabled: true });
  const call = (name: string, params: unknown) => api[name](params, null as any, { window: b.win } as any) as Promise<any>;
  const cat = (name: string) => b.run(() => one<{ id: number }>(getBooks().db, 'SELECT id FROM categories WHERE name = ?', name)!.id);

  const car = await call('categories.save', { name: 'Car', kind: 'expense' });
  const fuel = await call('categories.save', { name: 'Fuel', kind: 'expense', parentId: car });
  await call('categories.save', { name: 'Parking', kind: 'expense', parentId: car });

  await assert.rejects(call('categories.save', { name: 'Diesel', kind: 'expense', parentId: fuel }), /one level deep/);
  await assert.rejects(call('categories.save', { name: 'Fares', kind: 'income', parentId: car }), /different type/);
  await assert.rejects(call('categories.save', { name: 'Car loan', kind: 'expense', class: 'loan', parentId: car }), /different type/);
  await assert.rejects(call('categories.save', { id: car, name: 'Car', kind: 'expense', parentId: cat('Travel') }), /sub-categories of its own/);

  const list = await call('categories.list', {});
  const names = list.filter((c: any) => c.kind === 'expense').map((c: any) => c.path);
  assert.deepEqual(names.slice(names.indexOf('Car'), names.indexOf('Car') + 3), ['Car', 'Car › Fuel', 'Car › Parking']);

  b.run(() => {
    const bank = one<{ id: number }>(getBooks().db, 'SELECT id FROM accounts LIMIT 1')!.id;
    const spend = (categoryId: number, amount: number) =>
      saveEntry({ date: '2026-07-10', kind: 'expense', amount, accountId: bank, categoryId, taxCode: 'FRE' } as any);
    spend(fuel, 8000);
    spend(cat('Parking'), 2000);
    spend(car, 500); // straight on the parent
    saveBudget({ cells: [{ categoryId: fuel, month: '2026-07', amount: 9000 }] });
    const r = profitAndLoss({ from: '2026-07-01', to: '2026-07-31', basis: 'cash', budget: true });
    const row = r.expense.find((x) => x.name === 'Car')!;
    assert.equal(row.total, 10500);
    assert.equal(row.budget, 9000);
    assert.deepEqual(row.children!.map((c) => [c.name, c.total]), [['Fuel', 8000], ['Parking', 2000], ['Car (other)', 500]]);
    assert.equal(r.totals.expense, 10500);
    assert.equal(r.expense.length, 1);
  });
  b.close();
});
