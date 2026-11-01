import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COUNTRIES, countryProfile } from '../src/shared/countries.ts';

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
