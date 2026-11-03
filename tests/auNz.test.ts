// Australia and New Zealand: due dates, the trip log in km, the business
// schedule and IR10, the TPAR, PAYG instalments, provisional tax with tax
// withheld by clients, and the GST threshold.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeBooks } from './support/books.ts';
import { getBooks, one } from '../backend/db.ts';
import { abnError, saveContact, saveEntry } from '../backend/entries.ts';
import { recordPayment, saveInvoice } from '../backend/invoices.ts';
import { incomeReturnReport, profitAndLoss } from '../backend/reports.ts';
import { carYear, saveTrip } from '../backend/trips.ts';
import { setYearInputs } from '../backend/taxYear.ts';
import { deadlines, gstThreshold, paygInstalments, provisionalTax, taxWithheld, tparReport } from '../backend/auNzTax.ts';
import { basDue, nzGstDue, paygDue, provisionalDue } from '../src/shared/dueDates.ts';
import { incomeYearLabel, incomeYearOf, incomeYearRange } from '../src/shared/incomeYear.ts';
import { auIncomeTax, auTaxYear } from '../src/shared/auTaxYears.ts';
import { nzTaxYear } from '../src/shared/nzTaxYears.ts';

const cat = (name: string) => one<{ id: number }>(getBooks().db, 'SELECT id FROM categories WHERE name = ?', name)!.id;
const bank = () => one<{ id: number }>(getBooks().db, "SELECT id FROM accounts WHERE kind = 'bank' ORDER BY id LIMIT 1")!.id;
const spend = (date: string, amount: number, category: string, extra: Record<string, unknown> = {}) =>
  saveEntry({ date, kind: 'expense', amount, accountId: bank(), categoryId: cat(category), ...extra } as any);
const earn = (date: string, amount: number, extra: Record<string, unknown> = {}) =>
  saveEntry({ date, kind: 'income', amount, accountId: bank(), categoryId: cat('Sales'), ...extra } as any);
const profit = (from: string, to: string) => {
  const r = profitAndLoss({ from, to, basis: 'cash' });
  return { income: r.totals.income, net: r.totals.net };
};

test('income years and due dates', () => {
  assert.deepEqual(incomeYearRange(2026, '07-01'), { from: '2025-07-01', to: '2026-06-30' });
  assert.deepEqual(incomeYearRange(2026, '04-01'), { from: '2025-04-01', to: '2026-03-31' });
  assert.equal(incomeYearOf('2026-06-30', '07-01'), 2026);
  assert.equal(incomeYearOf('2026-07-01', '07-01'), 2027);
  assert.equal(incomeYearLabel(2026, '07-01'), '2025-26');
  // BAS: quarterly the 28th (Oct–Dec on 28 Feb; 28 Feb 2027 is a Sunday), monthly the 21st.
  assert.equal(basDue('2026-07-01', '2026-09-30'), '2026-10-28');
  assert.equal(basDue('2026-10-01', '2026-12-31'), '2027-03-01');
  assert.equal(basDue('2026-08-01', '2026-08-31'), '2026-09-21');
  assert.equal(basDue('2025-07-01', '2026-06-30'), '2026-11-02'); // 31 Oct 2026 is a Saturday
  // NZ GST: 7 May for March, 15 January for November.
  assert.equal(nzGstDue('2026-03-31'), '2026-05-07');
  assert.equal(nzGstDue('2025-11-30'), '2026-01-15');
  assert.equal(nzGstDue('2026-09-30'), '2026-10-28');
  assert.deepEqual(provisionalDue(2027), ['2026-08-28', '2027-01-15', '2027-05-07']);
  assert.deepEqual(paygDue(2027), ['2026-10-28', '2027-03-01', '2027-04-28', '2027-07-28']);
});

test('the year tables', () => {
  assert.equal(auTaxYear(2026).rules.centsPerKm, 880);
  assert.equal(auTaxYear(2027).rules.centsPerKm, 910);
  assert.equal(auTaxYear(2028).status, 'unchecked');
  assert.equal(nzTaxYear(2026).rules.kmRates.petrol.tier1, 1200);
  assert.equal(nzTaxYear(2027).status, 'unchecked'); // rates not out yet
  // $60,000 in 2025-26: 16% of $26,800 plus 30% of $15,000, plus 2% Medicare.
  assert.equal(auIncomeTax(6_000_000, 2026), 428_800 + 450_000 + 120_000);
  // ATO's own example ABN.
  assert.equal(abnError('51 824 753 556'), null);
  assert.match(abnError('51 824 753 557')!, /check out/);
  assert.match(abnError('1234')!, /11 digits/);
});

test('Australia: cents per km up to 5,000 km, the business schedule and working from home', async () => {
  const b = await makeBooks({ country: 'AU', fiscalYearStart: '07-01', taxEnabled: false });
  b.run(() => {
    earn('2025-08-01', 10_000_000);
    spend('2025-08-02', 300_000, 'Motor Vehicle');
    spend('2025-08-03', 100_000, 'Contractors');
    saveTrip({ date: '2025-09-01', distanceTenths: 40_000, purpose: 'Site visits' });
    saveTrip({ date: '2026-06-01', distanceTenths: 20_000, purpose: 'Site visits' });
    saveTrip({ date: '2026-07-01', distanceTenths: 1_000, purpose: 'Next year' });
    const car = carYear(2026);
    assert.equal(car.unit, 'km');
    assert.equal(car.distanceTenths, 60_000);
    assert.equal(car.claim.capped, true);
    assert.equal(car.claim.deduction, 440_000); // 5,000 km at 88c

    setYearInputs({ year: 2026, homeOfficeHours: 1000 });
    const year = { from: '2025-07-01', to: '2026-06-30', basis: 'cash' as const };
    let r = incomeReturnReport(year);
    const line = (key: string) => r.lines.find((l) => l.key === key);
    assert.equal(line('au-other-income')?.total, 10_000_000);
    assert.equal(line('au-contractors')?.total, 100_000);
    assert.equal(line('au-motor-vehicle')?.total, 440_000);
    assert.deepEqual(r.car.notDeducted.map((c) => c.name), ['Motor Vehicle']);
    assert.equal(line('au-other-expenses')?.total, 70_000); // 1,000 hours at 70c
    assert.equal(r.totals.net, 10_000_000 - 100_000 - 440_000 - 70_000);

    // A logbook: actual costs at the business share.
    setYearInputs({ year: 2026, vehicleMethod: 'actual', vehicleBusinessPct: 60 });
    r = incomeReturnReport(year);
    assert.equal(line('au-motor-vehicle')?.total, 180_000);
  });
  b.close();
});

test('Australia: TPAR, and PAYG instalments by the rate', async () => {
  const b = await makeBooks({ country: 'AU', fiscalYearStart: '07-01', taxEnabled: true, taxRatePpm: 100_000 });
  b.run(() => {
    const sparky = saveContact({ kind: 'vendor', name: 'Sparky', is1099: true, tin: '51824753556', address: '1 High St' });
    const nobody = saveContact({ kind: 'vendor', name: 'No ABN Co', is1099: true });
    spend('2025-09-01', 110_000, 'Contractors', { contactId: sparky, taxCode: 'GST' });
    spend('2025-10-01', 22_000, 'Contractors', { contactId: nobody, taxCode: 'GST' });
    spend('2026-08-01', 55_000, 'Contractors', { contactId: sparky, taxCode: 'GST' }); // next year
    const t = tparReport({ year: 2026 });
    assert.equal(t.due, '2026-08-28');
    const s = t.payees.find((p) => p.name === 'Sparky')!;
    assert.equal(s.abn, '51 824 753 556');
    assert.equal(s.gross, 110_000);
    assert.equal(s.gst, 10_000);
    assert.deepEqual(t.payees.find((p) => p.name === 'No ABN Co')!.missing, ['ABN', 'address']);

    // 10% of instalment income (sales before GST): $20,000 in Q1, $10,000 in Q2.
    earn('2025-08-01', 2_200_000, { taxCode: 'GST' });
    earn('2025-11-01', 1_100_000, { taxCode: 'GST' });
    spend('2025-10-20', 200_000, 'Income Tax Payment');
    setYearInputs({ year: 2026, paygOption: 'rate', paygRatePct: 10 });
    const p = paygInstalments({ year: 2026, today: '2026-01-10' }, profit);
    assert.deepEqual(p.quarters.slice(0, 2).map((q) => q.amount), [200_000, 100_000]);
    assert.equal(p.installments[0].state, 'paid');
    assert.equal(p.installments[1].due, '2026-03-02'); // 28 Feb 2026 is a Saturday
    assert.equal(p.next?.number, 2);
    const due = deadlines({ today: '2026-02-20' }, profit);
    assert.ok(due.some((d) => d.key === 'payg-2026-2' && d.amount === 100_000));
    assert.ok(due.some((d) => d.title === 'BAS for Oct–Dec 2025'));
  });
  b.close();
});

test('New Zealand: tax withheld by a client, provisional tax and the two-tier km rates', async () => {
  const b = await makeBooks({ country: 'NZ', fiscalYearStart: '04-01', taxEnabled: true, taxRatePpm: 150_000 });
  b.run(() => {
    const client = saveContact({ kind: 'customer', name: 'Studio', whtRatePpm: 200_000 });
    assert.equal(one<any>(getBooks().db, 'SELECT wht_rate_ppm AS r FROM contacts WHERE id = ?', client).r, 200_000);
    const inv = saveInvoice({
      contactId: client, issueDate: '2025-06-01', dueDate: '2025-06-30', pricesIncludeTax: false, status: 'sent',
      lines: [{ description: 'Work', qtyMilli: 1000, unitPrice: 100_000, categoryId: cat('Sales'), taxCode: 'GST' }],
    } as any);
    // $1,000 + $150 GST; 20% of the $1,000 kept back: $950 arrives.
    recordPayment({ invoiceId: inv, date: '2025-06-20', amount: 95_000, withheld: 20_000, accountId: bank() });
    assert.equal(one<any>(getBooks().db, "SELECT status FROM invoices WHERE id = ?", inv).status !== 'void', true);
    const w = taxWithheld('2025-04-01', '2026-03-31');
    assert.equal(w.total, 20_000);
    // All of the income counts, not just what arrived.
    assert.equal(profit('2025-04-01', '2026-03-31').income, 100_000);
    assert.throws(() => recordPayment({ invoiceId: inv, date: '2025-06-21', amount: 1, withheld: 0, accountId: bank() }), /more than/);

    // Standard method: last year's $6,000 plus 5%, in thirds.
    setYearInputs({ year: 2026, priorYearTax: 600_000 });
    spend('2025-08-20', 210_000, 'Income Tax Payment');
    const p = provisionalTax({ year: 2026, today: '2025-12-01' }, profit);
    assert.equal(p.provisional, 630_000);
    assert.deepEqual(p.installments.map((i) => i.amount), [210_000, 210_000, 210_000]);
    assert.deepEqual(p.installments.map((i) => i.state), ['paid', 'upcoming', 'upcoming']);
    assert.equal(p.terminalDue, '2027-02-08'); // 7 Feb 2027 is a Sunday
    // Under $5,000 last year: none.
    setYearInputs({ year: 2026, priorYearTax: 400_000 });
    assert.equal(provisionalTax({ year: 2026, today: '2025-12-01' }, profit).provisional, 0);

    // 20,000 km in the year, 12,000 for business: Tier 1 on 60% of 14,000, Tier 2 on the rest.
    saveTrip({ date: '2025-05-01', distanceTenths: 60_000, purpose: 'Deliveries' });
    saveTrip({ date: '2025-11-01', distanceTenths: 60_000, purpose: 'Deliveries' });
    setYearInputs({ year: 2026, vehicleTotalTenths: 200_000 });
    const car = carYear(2026);
    assert.equal(car.claim.tier1Tenths, 84_000);
    assert.equal(car.claim.tier2Tenths, 36_000);
    assert.equal(car.claim.deduction, 8_400 * 120 + 3_600 * 37);
    assert.equal(car.loggedPct, 60);
  });
  b.close();
});

test('GST threshold for books not registered', async () => {
  const b = await makeBooks({ country: 'AU', fiscalYearStart: '07-01', taxEnabled: false });
  b.run(() => {
    earn('2026-01-10', 4_000_000);
    earn('2026-09-10', 4_000_000);
    const r = gstThreshold({ today: '2026-10-01' });
    assert.equal(r.threshold, 7_500_000);
    assert.equal(r.turnover, 8_000_000);
    assert.equal(r.level, 'over');
    assert.equal(gstThreshold({ today: '2027-02-01' }).turnover, 4_000_000);
  });
  b.close();
});
