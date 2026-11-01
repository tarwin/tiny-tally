import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COUNTRIES, countryProfile } from '../src/shared/countries.ts';
import { SCHEDULE_C_MAP, isScheduleCLine } from '../src/shared/scheduleC.ts';
import { taxCodeOr, taxCodesFor, taxFromInclusive, taxOnExclusive, tracksTax } from '../src/shared/tax.ts';

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
