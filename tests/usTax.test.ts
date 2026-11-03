// US year-end and through-the-year tax: the per-year figures, 1099-NEC,
// estimated tax, mileage and home office on Schedule C, sales tax rates and
// sales by state.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeBooks } from './support/books.ts';
import { getBooks, one, run } from '../backend/db.ts';
import { saveContact, saveEntry } from '../backend/entries.ts';
import { saveInvoice } from '../backend/invoices.ts';
import { salesTaxReport, scheduleCReport } from '../backend/reports.ts';
import { updateSettings } from '../backend/settings.ts';
import { estimatedTax, nec1099Report, nexusReport, saveTaxRate } from '../backend/usTax.ts';
import { saveTrip } from '../backend/trips.ts';
import { setYearInputs } from '../backend/taxYear.ts';
import { homeOfficeDeduction, mileageRate, selfEmploymentTax, usTaxYear } from '../src/shared/usTaxYears.ts';
import { US_STATES } from '../src/shared/usStates.ts';

const cat = (name: string) => one<{ id: number }>(getBooks().db, 'SELECT id FROM categories WHERE name = ?', name)!.id;
const bank = () => one<{ id: number }>(getBooks().db, "SELECT id FROM accounts WHERE kind = 'bank' ORDER BY id LIMIT 1")!.id;
function card() {
  return one<{ id: number }>(getBooks().db,
    "INSERT INTO accounts (name, kind, opening_date, sort) VALUES ('Card', 'credit_card', '2024-01-01', 1) RETURNING id")!.id;
}
const spend = (date: string, amount: number, category: string, extra: Record<string, unknown> = {}) =>
  saveEntry({ date, kind: 'expense', amount, accountId: bank(), categoryId: cat(category), ...extra } as any);
const earn = (date: string, amount: number, extra: Record<string, unknown> = {}) =>
  saveEntry({ date, kind: 'income', amount, accountId: bank(), categoryId: cat('Sales'), ...extra } as any);

test('the figures are kept by tax year, and later years say they are unchecked', () => {
  assert.equal(usTaxYear(2025).rules.nec1099Threshold, 60_000);
  assert.equal(usTaxYear(2026).rules.nec1099Threshold, 200_000);
  // 72.5¢ to June, 76¢ from July 2026 (Announcement 2026-11).
  assert.equal(mileageRate('2025-08-01'), 700);
  assert.equal(mileageRate('2026-06-30'), 725);
  assert.equal(mileageRate('2026-07-01'), 760);
  assert.equal(usTaxYear(2026).status, 'checked');
  const later = usTaxYear(2027);
  assert.equal(later.status, 'unchecked');
  // Its own due dates, off weekends: Jan 31, 2028 is a Monday; Jan 15, 2028 a Saturday.
  assert.equal(later.rules.nec1099Due, '2028-01-31');
  assert.deepEqual(later.rules.estimatedDue, ['2027-04-15', '2027-06-15', '2027-09-15', '2028-01-17']);
  assert.equal(mileageRate('2027-03-01'), 760);
  // Every checked year's dates are weekdays.
  for (const y of [2024, 2025, 2026]) {
    for (const d of [...usTaxYear(y).rules.estimatedDue, usTaxYear(y).rules.nec1099Due]) {
      assert.ok(![0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay()), d);
    }
  }
});

test('self-employment tax and the simplified home office', () => {
  // $50,000 profit: 92.35% is $46,175; 15.3% of that is $7,064.78.
  assert.deepEqual(selfEmploymentTax(5_000_000, 2026), { tax: 706_478, netEarnings: 4_617_500 });
  // Under $400 of net earnings, none.
  assert.equal(selfEmploymentTax(40_000, 2026).tax, 0);
  // Social Security stops at the wage base ($184,500 in 2026); Medicare doesn't.
  const big = selfEmploymentTax(30_000_000, 2026);
  assert.equal(big.tax, Math.round(18_450_000 * 0.124 + big.netEarnings * 0.029));
  // Wages use up the base first.
  assert.ok(selfEmploymentTax(5_000_000, 2026, 18_000_000).tax < 706_478);
  assert.equal(homeOfficeDeduction(200, 2026), 100_000);
  assert.equal(homeOfficeDeduction(450, 2026), 150_000);
  // 50 states and DC; the four with no sales tax have no threshold.
  assert.equal(US_STATES.length, 51);
  assert.deepEqual(US_STATES.filter((s) => !s.sales).map((s) => s.code), ['DE', 'MT', 'NH', 'OR']);
});

test('1099-NEC: marked vendors over the threshold, card payments left out, others suggested', async () => {
  const b = await makeBooks({ country: 'US', taxEnabled: false });
  b.run(() => {
    const ann = saveContact({ kind: 'vendor', name: 'Ann Lee Design', is1099: true, legalName: 'Ann Lee', tin: '123-45-6789', address: '1 Main St' });
    const bob = saveContact({ kind: 'vendor', name: 'Bob', is1099: true });
    const corp = saveContact({ kind: 'vendor', name: 'Big Agency' });
    assert.throws(() => saveContact({ kind: 'vendor', name: 'Typo', tin: '12-345' }), /9 digits/);
    const visa = card();
    spend('2025-03-01', 70_000, 'Contractors', { contactId: ann });
    spend('2025-04-01', 50_000, 'Contractors', { contactId: bob });
    spend('2025-05-01', 90_000, 'Contractors', { contactId: bob, accountId: visa });
    spend('2025-06-01', 80_000, 'Professional Fees', { contactId: corp });
    spend('2026-02-01', 150_000, 'Contractors', { contactId: ann });

    const r2025 = nec1099Report({ year: 2025 });
    assert.equal(r2025.threshold, 60_000);
    assert.equal(r2025.due, '2026-02-02');
    const byName = Object.fromEntries(r2025.payees.map((p) => [p.name, p]));
    assert.equal(byName['Ann Lee Design'].paid, 70_000);
    assert.equal(byName['Ann Lee Design'].needsForm, true);
    assert.deepEqual(byName['Ann Lee Design'].missing, []);
    // Bob's card payment is a 1099-K matter.
    assert.equal(byName.Bob.paid, 50_000);
    assert.equal(byName.Bob.byCard, 90_000);
    assert.equal(byName.Bob.needsForm, false);
    assert.deepEqual(byName.Bob.missing, ['TIN', 'address']);
    assert.deepEqual(r2025.suggested.map((s) => s.name), ['Big Agency']);

    // $1,500 is under 2026's $2,000.
    const r2026 = nec1099Report({ year: 2026 });
    assert.equal(r2026.payees.find((p) => p.name === 'Ann Lee Design')!.needsForm, false);
  });
  b.close();
});

test('Schedule C: the mileage rate replaces car costs, parking stays, and home office is capped at the profit', async () => {
  const b = await makeBooks({ country: 'US', taxEnabled: false });
  b.run(() => {
    run(getBooks().db, "INSERT INTO categories (name, kind, report_line) VALUES ('Parking', 'expense', 'parking-tolls')");
    earn('2026-02-01', 200_000);
    spend('2026-02-02', 30_000, 'Car & Truck');
    spend('2026-02-03', 2_000, 'Parking');
    saveTrip({ date: '2026-06-30', distanceTenths: 1000, purpose: 'Client visit' }); // 100 mi × 72.5¢
    saveTrip({ date: '2026-07-01', distanceTenths: 1000, purpose: 'Client visit' }); // 100 mi × 76¢
    assert.throws(() => saveTrip({ date: '2026-07-02', distanceTenths: 10, purpose: ' ' }), /what the trip was for/);
    const year = { from: '2026-01-01', to: '2026-12-31', basis: 'cash' as const };

    let sc = scheduleCReport(year);
    const car = () => sc.lines.find((l) => l.key === 'car-truck')!;
    assert.equal(sc.vehicle.method, 'mileage');
    assert.equal(sc.vehicle.mileageDeduction, 14_850);
    assert.equal(car().total, 14_850 + 2_000);
    assert.deepEqual(sc.vehicle.notDeducted.map((c) => c.name), ['Car & Truck']);
    assert.equal(sc.lines.filter((l) => l.line === '9').length, 1);

    setYearInputs({ year: 2026, vehicleMethod: 'actual', homeOfficeSqFt: 200 });
    sc = scheduleCReport(year);
    assert.equal(car().total, 32_000);
    assert.equal(sc.totals.homeOffice, 100_000);
    assert.equal(sc.totals.netProfit, 200_000 - 32_000 - 100_000);

    // The simplified method can't make a loss.
    setYearInputs({ year: 2026, homeOfficeSqFt: 300 });
    spend('2026-03-01', 100_000, 'Rent');
    sc = scheduleCReport(year);
    assert.equal(sc.totals.homeOffice, 68_000);
    assert.equal(sc.homeOffice.limited, true);
    assert.equal(sc.totals.netProfit, 0);
  });
  b.close();
});

test('estimated tax: projected from profit so far, against payments in the year', async () => {
  const b = await makeBooks({ country: 'US', taxEnabled: false });
  b.run(() => {
    earn('2026-01-10', 2_500_000);
    spend('2026-01-14', 100_000, 'Income Tax Payment'); // last year's fourth payment
    spend('2026-04-10', 200_000, 'Income Tax Payment');
    spend('2026-06-10', 200_000, 'Income Tax Payment');
    setYearInputs({ year: 2026, incomeTaxPct: 10 });
    const net = (from: string, to: string) => scheduleCReport({ from, to, basis: 'cash' }).totals.netProfit;

    // At the end of June: half the year gone, so double the profit.
    const r = estimatedTax({ year: 2026, today: '2026-07-02' }, net);
    assert.equal(r.projected, true);
    assert.equal(r.profitSoFar, 2_500_000);
    assert.ok(Math.abs(r.profit - 5_000_000) < 30_000, String(r.profit));
    assert.equal(r.incomeTax, Math.round(((r.profit - r.selfEmployment.halfDeduction) * 10) / 100));
    assert.equal(r.projectedTax, r.selfEmployment.tax + r.incomeTax);
    // January's payment was for 2025.
    assert.deepEqual(r.payments.map((p) => p.date), ['2026-04-10', '2026-06-10']);
    // About $11,700 for the year is $2,900 a quarter: $2,000 by April 15 falls short.
    assert.equal(r.installments[0].cumulativeTarget, Math.round(r.target / 4));
    assert.equal(r.installments[0].state, 'overdue');
    assert.equal(r.installments[2].due, '2026-09-15');
    assert.equal(r.next?.number, 3);

    // The safe harbor caps it at last year's tax.
    setYearInputs({ year: 2026, priorYearTax: 600_000 });
    const capped = estimatedTax({ year: 2026, today: '2026-07-02' }, net);
    assert.equal(capped.target, 600_000);
    assert.equal(capped.installments[2].short, 50_000);
    assert.deepEqual(capped.installments.map((i) => i.state), ['paid', 'paid', 'upcoming', 'upcoming']);
    assert.equal(capped.hasCategory, true);
  });
  b.close();
});

test('sales tax rates: invoices and sales at another rate are totalled on their own', async () => {
  const b = await makeBooks({ country: 'US', taxEnabled: true, taxRatePpm: 88_750 });
  b.run(() => {
    updateSettings({ taxRateName: 'Brooklyn, NY', homeState: 'NY' });
    const jc = saveTaxRate({ name: 'Jersey City, NJ', state: 'NJ', ratePpm: 66_250 });
    const client = saveContact({ kind: 'customer', name: 'NJ Client', state: 'nj', taxRateId: jc });
    const inv = saveInvoice({
      contactId: client, issueDate: '2026-03-01', dueDate: '2026-03-31', pricesIncludeTax: false, status: 'sent', taxRateId: jc,
      lines: [{ description: 'Work', qtyMilli: 1000, unitPrice: 100_000, categoryId: cat('Sales'), taxCode: 'TAX' }],
    } as any);
    assert.equal(one<any>(getBooks().db, 'SELECT tax FROM invoices WHERE id = ?', inv).tax, 6_625);
    // Changing the rate later doesn't change the saved invoice when it's saved again on the same rate.
    saveTaxRate({ id: jc, name: 'Jersey City, NJ', state: 'NJ', ratePpm: 70_000 });
    saveInvoice({
      id: inv, contactId: client, issueDate: '2026-03-01', dueDate: '2026-03-31', pricesIncludeTax: false, taxRateId: jc,
      lines: [{ description: 'Work', qtyMilli: 1000, unitPrice: 100_000, categoryId: cat('Sales'), taxCode: 'TAX' }],
    } as any);
    assert.equal(one<any>(getBooks().db, 'SELECT tax FROM invoices WHERE id = ?', inv).tax, 6_625);
    earn('2026-03-05', 108_875, { taxCode: 'TAX' });

    const r = salesTaxReport({ from: '2026-01-01', to: '2026-03-31', basis: 'accrual' });
    assert.deepEqual(r.byRate.map((x) => [x.name, x.taxableSales, x.taxCollected]), [
      ['Jersey City, NJ', 100_000, 6_625],
      ['Brooklyn, NY', 100_000, 8_875],
    ]);
    assert.equal(r.totals.taxCollected, 15_500);

    // Sales by state: NJ counted, NY is home.
    const nexus = nexusReport({ year: 2026 });
    const nj = nexus.states.find((s) => s.code === 'NJ')!;
    assert.equal(nj.thisYear.sales, 100_000);
    assert.equal(nj.thisYear.transactions, 1);
    assert.equal(nj.level, 'under');
    assert.equal(nexus.states.find((s) => s.code === 'NY')?.level, 'home');
    assert.equal(nexus.unknown.sales, 100_000);
  });
  b.close();
});

test("a payee's TIN is kept out of the change history", async () => {
  const { beginBatch, endBatch } = await import('../backend/changelog.ts');
  const b = await makeBooks({ country: 'US' });
  b.run(() => {
    const batch = beginBatch('contacts.save');
    saveContact({ kind: 'vendor', name: 'Ann', is1099: true, tin: '123-45-6789' });
    endBatch(batch);
    const row = one<{ after: string }>(getBooks().db, "SELECT after FROM change_log WHERE table_name = 'contacts' ORDER BY id DESC LIMIT 1")!;
    assert.ok(row.after.includes('(TIN)'));
    assert.ok(!row.after.includes('6789'));
  });
  b.close();
});
