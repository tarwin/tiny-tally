// The demo books for each country: they seed without errors, and the parts
// the screenshots and guide show are there and add up.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeBooks } from './support/books.ts';
import { all, getBooks, one } from '../backend/db.ts';
import { DEMO_NAMES, DEMO_SETUP, seedDemo } from '../backend/demo.ts';
import { assetRegister } from '../backend/assets.ts';
import { carYear } from '../backend/trips.ts';
import { inGstReport, profitAndLoss } from '../backend/reports.ts';
import { trialBalance } from '../backend/ledger.ts';
import { gstNumberError } from '../src/shared/india.ts';
import { taxWithheld } from '../backend/auNzTax.ts';
import { incomeYearOf, incomeYearRange } from '../src/shared/incomeYear.ts';

const TODAY = '2026-11-03';

for (const c of ['AU', 'NZ', 'US', 'IN'] as const) {
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
      if (c !== 'IN') {
        const reg = assetRegister(last);
        assert.equal(reg.rows.length, 1);
        assert.ok(reg.totals.claimed > 0);
        assert.equal(reg.journal?.upToDate, true);
        assert.ok(carYear(last).trips.length > 20);
      }
      const lodged = all<any>(db, 'SELECT id FROM tax_returns WHERE lodged_at IS NOT NULL');
      if (c === 'US') assert.equal(lodged.length, 0);
      else assert.equal(lodged.length, c === 'AU' ? 4 : c === 'IN' ? 12 : 6);
      if (c === 'NZ') assert.ok(taxWithheld(from, to).total > 0);
      const instalments = one<{ n: number }>(db,
        c === 'IN'
          ? "SELECT COUNT(*) AS n FROM entries e JOIN categories c ON c.id = e.category_id WHERE c.name = 'Income Tax Payment'"
          : "SELECT COUNT(*) AS n FROM entries e JOIN categories c ON c.id = e.category_id WHERE c.report_line = 'estimated-tax'")!.n;
      assert.ok(instalments >= 3);
    });
    b.close();
  });
}

test('the Indian demo shows what Indian books need', async () => {
  const b = await makeBooks({ name: DEMO_NAMES.IN, ...DEMO_SETUP.IN });
  b.run(() => {
    seedDemo(TODAY, 'IN');
    const { db } = getBooks();
    const count = (sql: string) => one<{ n: number }>(db, sql)!.n;
    // Every approved invoice and credit note says where it's supplied, with a GST-legal number.
    assert.equal(count("SELECT COUNT(*) AS n FROM invoices WHERE doc_type IN ('invoice', 'credit') AND status = 'sent' AND place_of_supply IS NULL"), 0);
    for (const { number } of all<{ number: string }>(db, "SELECT number FROM invoices WHERE doc_type IN ('invoice', 'credit')")) {
      assert.equal(gstNumberError(number), null);
    }
    // Exports in two currencies, carrying no GST.
    const currencies = all<{ currency: string }>(db, 'SELECT DISTINCT currency FROM invoices WHERE currency IS NOT NULL').map((x) => x.currency).sort();
    assert.deepEqual(currencies, ['GBP', 'USD']);
    assert.equal(count('SELECT COUNT(*) AS n FROM invoices WHERE currency IS NOT NULL AND tax <> 0'), 0);
    // Payments that landed at other rates, both ways.
    assert.ok(count("SELECT COUNT(*) AS n FROM entries e JOIN categories c ON c.id = e.category_id WHERE c.name = 'Exchange Gains'") > 0);
    assert.ok(count("SELECT COUNT(*) AS n FROM entries e JOIN categories c ON c.id = e.category_id WHERE c.name = 'Exchange Losses'") > 0);
    // TDS from the festival, and all three heads of GST.
    assert.ok(count("SELECT COUNT(*) AS n FROM entries e JOIN accounts a ON a.id = e.account_id WHERE a.holds = 'client-wht'") > 0);
    const { from, to } = incomeYearRange(incomeYearOf(TODAY, '04-01') - 1, '04-01');
    const gst = inGstReport({ from, to }).figures;
    // Goods at 5% beside services at 18%, on sales and on purchases (bills cover the last six months).
    const byRate = inGstReport({ from, to: TODAY }).byRate;
    assert.deepEqual(byRate.map((r: any) => r.ratePpm), [50_000, 180_000]);
    assert.ok(byRate[0].sales > 0 && byRate[0].purchases > 0);
    assert.equal(count("SELECT COUNT(*) AS n FROM entries e JOIN categories c ON c.id = e.category_id WHERE c.name = 'Meals & Entertainment' AND e.tax_amount <> 0"), 0);
    assert.ok(gst.cgst > 0 && Math.abs(gst.cgst - gst.sgst) <= 1, `cgst ${gst.cgst}, sgst ${gst.sgst}`);
    assert.ok(gst.igst > 0);
    assert.ok(gst.zero > 0);
    assert.ok(gst.itc > 0);
    const tb = trialBalance(TODAY);
    assert.equal(tb.debit, tb.credit);
  });
  b.close();
});
