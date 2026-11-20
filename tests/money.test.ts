import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatMoney, parseMoney, parseRate, ratePercent } from '../src/lib/money.ts';

test('tax rates typed as a percent', () => {
  assert.equal(parseRate('8.875'), 88_750);
  assert.equal(parseRate(' 7.25 % '), 72_500);
  assert.equal(parseRate('10'), 100_000);
  assert.equal(parseRate('.5'), 5_000);
  assert.equal(parseRate('0'), 0);
  for (const bad of ['', 'abc', '51', '-1', '8.12345', '100']) assert.equal(parseRate(bad), null, bad);
  assert.equal(ratePercent(88_750), '8.875');
  assert.equal(ratePercent(100_000), '10');
});

test('rupees group in lakhs and crores', () => {
  assert.match(formatMoney(12_345_678_50, 'INR'), /1,23,45,678\.50/);
});

test('amounts typed or pasted', () => {
  const cases: [string, number | null][] = [
    ['12.50', 1250], ['1,234.50', 123450], ['4.', 400], ['-7', -700], ['(12.50)', -1250],
    ['$12.50', 1250], ['A$12.50', 1250], ['-$3', -300], ['AUD 12.50', 1250], ['12.50 AUD', 1250], ['€ 40', 4000],
    ['4.d', null], ['12abc34', null], ['abc', null], ['', null], ['-', null], ['.', null], ['12 apples', null],
  ];
  for (const [text, want] of cases) assert.equal(parseMoney(text, 'AUD'), want, text);
});
