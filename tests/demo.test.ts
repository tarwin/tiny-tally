// The demo books for each country: they seed without errors, and the parts
// the screenshots and guide show are there and add up.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeBooks } from './support/books.ts';
import { all, getBooks, one } from '../backend/db.ts';
import { DEMO_NAMES, DEMO_SETUP, seedDemo } from '../backend/demo.ts';
import { assetRegister } from '../backend/assets.ts';
import { carYear } from '../backend/trips.ts';
import { profitAndLoss } from '../backend/reports.ts';
import { taxWithheld } from '../backend/auNzTax.ts';
import { incomeYearOf, incomeYearRange } from '../src/shared/incomeYear.ts';

const TODAY = '2026-11-03';

for (const c of ['AU', 'NZ', 'US'] as const) {
  test(`demo books: ${c}`, async () => {
    const b = await makeBooks({ name: DEMO_NAMES[c], ...DEMO_SETUP[c] });
    b.run(() => {
      seedDemo(TODAY, c);
      const { db } = getBooks();
      const ys = DEMO_SETUP[c].fiscalYearStart;
      const last = incomeYearOf(TODAY, ys) - 1;
      const { from, to } = incomeYearRange(last, ys);
      const pl = profitAndLoss({ from, to, basis: 'cash' });
      assert.ok(pl.totals.income > 10_000_000, `income ${pl.totals.income}`);
      assert.ok(pl.totals.net > 0, `profit ${pl.totals.net}`);
      // Every journal balances, and last year's depreciation is posted and current.
      assert.equal(one<{ t: number }>(db, 'SELECT COALESCE(SUM(amount), 0) AS t FROM journal_lines')!.t, 0);
      const reg = assetRegister(last);
      assert.equal(reg.rows.length, 1);
      assert.ok(reg.totals.claimed > 0);
      assert.equal(reg.journal?.upToDate, true);
      assert.ok(carYear(last).trips.length > 20);
      const lodged = all<any>(db, 'SELECT id FROM tax_returns WHERE lodged_at IS NOT NULL');
      if (c === 'US') assert.equal(lodged.length, 0);
      else assert.equal(lodged.length, c === 'AU' ? 4 : 6);
      if (c === 'NZ') assert.ok(taxWithheld(from, to).total > 0);
      const instalments = one<{ n: number }>(db,
        "SELECT COUNT(*) AS n FROM entries e JOIN categories c ON c.id = e.category_id WHERE c.report_line = 'estimated-tax'")!.n;
      assert.ok(instalments >= 3);
    });
    b.close();
  });
}
