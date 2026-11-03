// The asset register: depreciation by country, sales, and the year's journal.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeBooks } from './support/books.ts';
import { all, getBooks, one } from '../backend/db.ts';
import { saveEntry } from '../backend/entries.ts';
import { assetRegister, postDepreciation, saveAsset, sellAsset } from '../backend/assets.ts';
import { incomeReturnReport, profitAndLoss, scheduleCReport } from '../backend/reports.ts';
import { depreciationYear, type AssetIn } from '../src/shared/depreciation.ts';

const cat = (name: string) => one<{ id: number }>(getBooks().db, 'SELECT id FROM categories WHERE name = ?', name)!.id;
const bank = () => one<{ id: number }>(getBooks().db, "SELECT id FROM accounts WHERE kind = 'bank' ORDER BY id LIMIT 1")!.id;
const limits = () => ({ writeOff: 2_000_000 });
const asset = (a: Partial<AssetIn>): AssetIn => ({ id: 1, name: 'Thing', bought: '2025-10-01', cost: 300_000, businessPct: 100, method: 'dv', ...a });

test('Australia: diminishing value, prime cost and the small business pool', () => {
  // 200% / 4 years = 50%, for 273 of 365 days.
  let [r] = depreciationYear('AU', [asset({ lifeYears: 4 })], 2026, '07-01', limits);
  assert.equal(r.depreciation, Math.round(300_000 * 0.5 * 273 / 365));
  [r] = depreciationYear('AU', [asset({ lifeYears: 4 })], 2027, '07-01', limits);
  assert.equal(r.opening, 300_000 - 112_192);
  assert.equal(r.depreciation, Math.round(r.opening * 0.5));
  [r] = depreciationYear('AU', [asset({ method: 'pc', lifeYears: 4, businessPct: 60 })], 2027, '07-01', limits);
  assert.equal(r.depreciation, 75_000);
  assert.equal(r.claimed, 45_000);
  // Pool: 15%, then 30%; the third year the pool's under $20,000, so it all goes.
  const pool = [asset({ method: 'pool', cost: 3_000_000 })];
  assert.equal(depreciationYear('AU', pool, 2026, '07-01', limits)[0].depreciation, 450_000);
  assert.equal(depreciationYear('AU', pool, 2027, '07-01', limits)[0].depreciation, 765_000);
  [r] = depreciationYear('AU', pool, 2028, '07-01', limits);
  assert.equal(r.depreciation, 1_785_000);
  assert.equal(r.closing, 0);
  assert.equal(depreciationYear('AU', pool, 2029, '07-01', limits).length, 0);
  // Sold the next year for $2,000: depreciation to the day it went, then the balancing adjustment.
  [r] = depreciationYear('AU', [asset({ lifeYears: 4, sold: '2026-12-31', proceeds: 200_000 })], 2027, '07-01', limits);
  assert.equal(r.depreciation, Math.round(187_808 * 0.5 * 184 / 365));
  assert.equal(r.disposal!.adjustment, 200_000 - (187_808 - r.depreciation));
});

test('New Zealand by the month, none in the year sold; US MACRS', () => {
  // October to March: 6 months at 50% DV.
  let [r] = depreciationYear('NZ', [asset({ ratePct: 50, bought: '2025-10-15' })], 2026, '04-01', limits);
  assert.equal(r.depreciation, 75_000);
  [r] = depreciationYear('NZ', [asset({ ratePct: 50, bought: '2025-10-15', sold: '2026-05-01', proceeds: 400_000 })], 2027, '04-01', limits);
  assert.equal(r.depreciation, 0);
  // A gain stops at the cost: 3,000 − 2,250 left = 750 recovered, not 1,750.
  assert.equal(r.disposal!.adjustment, 75_000);
  const macrs = [asset({ method: 'macrs5', cost: 100_000, bought: '2025-03-01' })];
  assert.deepEqual([2025, 2026, 2027].map((y) => depreciationYear('US', macrs, y, '01-01', limits)[0].depreciation), [20_000, 32_000, 19_200]);
  // Sold in year 3: half of that year's percentage.
  [r] = depreciationYear('US', [{ ...macrs[0], sold: '2027-06-01', proceeds: 50_000 }], 2027, '01-01', limits);
  assert.equal(r.depreciation, 9_600);
  assert.equal(r.disposal!.adjustment, 50_000 - (48_000 - 9_600));
});

test('Australia: the year’s journal reaches the P&L and the business schedule', async () => {
  const b = await makeBooks({ country: 'AU', fiscalYearStart: '07-01', taxEnabled: true, taxRatePpm: 100_000 });
  b.run(() => {
    // A $3,300 laptop booked to Equipment (an expense), put in the register at $3,000 before GST.
    const entry = saveEntry({ date: '2025-10-01', kind: 'expense', amount: 3_300_000 / 10, accountId: bank(), categoryId: cat('Equipment'), taxCode: 'CAP' } as any);
    const id = saveAsset({ name: 'Laptop', bought: '2025-10-01', cost: 300_000, method: 'dv', lifeYears: 4, categoryId: cat('Equipment'), entryId: entry });
    let reg = assetRegister(2026);
    assert.equal(reg.rows[0].depreciation, 112_192);
    assert.equal(reg.purchases.length, 0);
    assert.equal(reg.journal, null);
    postDepreciation(2026);
    reg = assetRegister(2026);
    assert.equal(reg.journal?.upToDate, true);
    const pl = profitAndLoss({ from: '2025-07-01', to: '2026-06-30', basis: 'cash' });
    const line = (name: string) => (pl.expense as any[]).find((r) => r.name === name)?.total ?? 0;
    assert.equal(line('Equipment'), 0);
    assert.equal(line('Depreciation'), 112_192);
    const p8 = incomeReturnReport({ from: '2025-07-01', to: '2026-06-30', basis: 'cash' });
    assert.equal(p8.lines.find((l: any) => l.key === 'au-depreciation')?.total, 112_192);
    // A change makes the journal out of date until it's posted again.
    saveAsset({ id, name: 'Laptop', bought: '2025-10-01', cost: 300_000, method: 'dv', lifeYears: 3, categoryId: cat('Equipment'), entryId: entry });
    assert.equal(assetRegister(2026).journal?.upToDate, false);
    postDepreciation(2026);
    assert.equal(all(getBooks().db, 'SELECT id FROM journals').length, 1);
    // Sold the next year for $1,100 with GST: the sale money and the asset come off, the rest is a gain or loss.
    postDepreciation(2027);
    sellAsset({ id, date: '2027-03-01', amount: 110_000, accountId: bank() });
    reg = assetRegister(2028);
    assert.equal(reg.rows.length, 0);
    reg = assetRegister(2027);
    assert.equal(reg.rows[0].disposal!.proceeds, 100_000);
    postDepreciation(2027);
    const bal = (key: string) => one<{ t: number }>(getBooks().db,
      `SELECT COALESCE(SUM(amount), 0) AS t FROM journal_lines WHERE ${key}`)!.t;
    // Every journal balances, and accumulated depreciation is back to nothing.
    assert.equal(bal('1 = 1'), 0);
    assert.equal(bal("system = 'accumdep'"), 0);
    assert.equal(bal(`category_id = ${cat('Business Assets')}`), 0);
  });
  b.close();
});

test('US: a gain on equipment sold stays off Schedule C', async () => {
  const b = await makeBooks({ country: 'US', fiscalYearStart: '01-01', taxEnabled: false });
  b.run(() => {
    const entry = saveEntry({ date: '2025-02-01', kind: 'expense', amount: 100_000, accountId: bank(), categoryId: cat('Equipment & Assets') } as any);
    const id = saveAsset({ name: 'Camera', bought: '2025-02-01', cost: 100_000, method: 'expense', categoryId: cat('Equipment & Assets'), entryId: entry });
    postDepreciation(2025);
    let c = scheduleCReport({ from: '2025-01-01', to: '2025-12-31', basis: 'cash' });
    assert.equal(c.lines.find((l: any) => l.key === 'depreciation')?.total, 100_000);
    sellAsset({ id, date: '2026-05-01', amount: 30_000, accountId: bank() });
    postDepreciation(2026);
    c = scheduleCReport({ from: '2026-01-01', to: '2026-12-31', basis: 'cash' });
    assert.equal(c.unmapped.length, 0);
    assert.equal(c.lines.find((l: any) => l.key === 'other-income'), undefined);
  });
  b.close();
});
