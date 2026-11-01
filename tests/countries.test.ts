import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COUNTRIES, countryProfile } from '../src/shared/countries.ts';
import { SCHEDULE_C_MAP, isScheduleCLine } from '../src/shared/scheduleC.ts';
import { nzBoxesFor, taxCodeOr, taxCodesFor, taxFromInclusive, taxOnExclusive, tracksTax } from '../src/shared/tax.ts';
import { RETURN_FORMS, adjustmentGst, adjustmentTotals } from '../src/shared/taxReturns.ts';

test('ABN checksum', () => {
  const { check } = COUNTRIES.AU.taxId;
  assert.equal(check(''), null);
  assert.equal(check('51 824 753 556'), null);
  assert.match(check('51 824 753 557')!, /doesn't look right/);
  assert.match(check('5182475355')!, /11 digits/);
});

test('NZ GST (IRD) number check digit, using the IRD examples', () => {
  const { check } = COUNTRIES.NZ.taxId;
  for (const ok of ['49091850', '35901981', '49098576', '136410132', '49-091-850']) assert.equal(check(ok), null, ok);
  for (const bad of ['136410133', '9125568', '1234567890']) assert.notEqual(check(bad), null, bad);
});

test('EIN format', () => {
  const { check } = COUNTRIES.US.taxId;
  assert.equal(check('12-3456789'), null);
  assert.equal(check('123456789'), null);
  assert.notEqual(check('12-345678'), null);
});

test('unknown country falls back to Australia', () => {
  assert.equal(countryProfile('XX').code, 'AU');
  assert.equal(countryProfile('NZ').code, 'NZ');
});

test('only GST countries get GST categories', () => {
  const names = (c: 'AU' | 'NZ' | 'US') => [...COUNTRIES[c].categories.income, ...COUNTRIES[c].categories.expense].map((x) => x.name);
  assert.ok(names('AU').includes('GST / BAS Payment'));
  assert.ok(names('NZ').includes('GST Payment'));
  assert.equal(names('US').filter((n) => /GST|BAS/.test(n)).length, 0);
});

test('US sales tax: charged on sales only, purchases carry none', () => {
  const tax = COUNTRIES.US.tax!;
  assert.deepEqual(taxCodesFor(tax, 'income').map((t) => t.code), ['TAX', 'NON', 'NTR']);
  assert.deepEqual(taxCodesFor(tax, 'expense').map((t) => t.code), ['NTR']);
  assert.equal(tracksTax(tax, 'income'), true);
  assert.equal(tracksTax(tax, 'expense'), false);
  // An Australian code on US books falls back to the side's default.
  assert.equal(taxCodeOr(tax, 'income', 'GST'), 'TAX');
  assert.equal(taxCodeOr(tax, 'expense', 'TAX'), 'NTR');
  assert.equal(taxCodeOr(COUNTRIES.AU.tax, 'expense', 'CAP'), 'CAP');
  assert.equal(taxCodeOr(null, 'income', 'GST'), null);
});

test('US rates to three decimals', () => {
  // 8.875% on $100.00 exclusive is $8.88; inside $108.88 it's the same.
  assert.equal(taxOnExclusive(10000, 'TAX', 88_750), 888);
  assert.equal(taxFromInclusive(10888, 'TAX', 88_750), 888);
  // Australia's 10% still works out at 1/11.
  assert.equal(taxFromInclusive(11000, 'GST', COUNTRIES.AU.tax!.defaultRatePpm), 1000);
});

test('every US P&L category is on a Schedule C line of its own kind', () => {
  for (const kind of ['income', 'expense'] as const) {
    for (const c of COUNTRIES.US.categories[kind]) {
      if (c.class) {
        assert.equal(c.reportLine, undefined, c.name);
        continue;
      }
      assert.ok(isScheduleCLine(c.reportLine), c.name);
      assert.equal(SCHEDULE_C_MAP[c.reportLine!].kind, kind, c.name);
    }
  }
  assert.equal(COUNTRIES.US.categories.expense.find((c) => c.name === 'Meals & Entertainment')?.reportLine, '24b');
  assert.equal(SCHEDULE_C_MAP['24b'].deductiblePct, 50);
});

test('NZ GST return boxes (GST101A, IR375)', () => {
  assert.deepEqual(nzBoxesFor('income', 'GST'), ['5']);
  assert.deepEqual(nzBoxesFor('income', 'ZER'), ['5', '6']);
  assert.deepEqual(nzBoxesFor('income', 'EXE'), []);
  assert.deepEqual(nzBoxesFor('expense', 'GST'), ['11']);
  assert.deepEqual(nzBoxesFor('expense', 'EXE'), []);
  // $115 GST sales, $200 exports, $23 of purchases, $1 adjustment, $2 credit adjustment.
  const form = RETURN_FORMS['nz-gst'];
  const box = (code: string) => form.rows({ '5': 31500, '6': 20000, '11': 2300 }, { box9: 100, box13: 200 }, 'two-monthly').find((r) => r.code === code)!.value;
  assert.equal(box('7'), 11500);
  assert.equal(box('8'), 1500);
  assert.equal(box('10'), 1600);
  assert.equal(box('12'), 300);
  assert.equal(box('14'), 500);
  assert.equal(box('15'), 1100);
  assert.equal(form.net({ '5': 0, '6': 0, '11': 2300 }, {}), -300);
});

test('BAS keeps whole dollars and the Simpler BAS labels', () => {
  const form = RETURN_FORMS.bas;
  const f = { G1: 1100099, G2: 0, G3: 0, G4: 0, G10: 0, G11: 0, '1A': 100099, '1B': 50050 };
  assert.equal(form.net(f, { t7: 12599 }), 100000 - 50000 + 12500);
  assert.deepEqual(form.rows(f, {}, 'quarterly').map((r) => r.code).slice(0, 3), ['G1', '1A', '1B']);
  assert.ok(form.rows(f, {}, 'monthly').some((r) => r.code === 'G11'));
});

test('NZ GST adjustments (IR372)', () => {
  // $460 of phone (category 7) this period, $2,300 of entertainment (category 9) this year.
  const ctx = { period: { 7: 46000 }, yearToDate: { 7: 92000, 9: 230000 } };
  assert.equal(adjustmentGst({ type: 'private-use', description: '', categoryId: 7, percent: 30 }, ctx), 1800);
  // Entertainment is always half, over the year to date.
  assert.equal(adjustmentGst({ type: 'entertainment', description: '', categoryId: 9, percent: 80 }, ctx), 15000);
  assert.equal(adjustmentGst({ type: 'bad-debt', description: '', amount: 11500 }, ctx), 1500);
  assert.equal(adjustmentGst({ type: 'customs', description: '', amount: 4321 }, ctx), 4321);
  assert.deepEqual(
    adjustmentTotals([
      { type: 'private-use', description: '', categoryId: 7, percent: 30 },
      { type: 'customs', description: '', amount: 4321 },
      { type: 'bad-debt', description: '', amount: 11500 },
    ], ctx),
    { box9: 1800, box13: 5821 },
  );
  assert.ok(RETURN_FORMS['nz-gst'].adjustments!.every((a) => a.box === '9' || a.box === '13'));
});
