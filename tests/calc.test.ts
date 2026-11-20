import { test } from 'node:test';
import assert from 'node:assert/strict';
import { amountText, cleanPasted, evaluate, plainNumber } from '../src/shared/calc.ts';

test('arithmetic, precedence and brackets', () => {
  assert.equal(evaluate('1 + 2 × 3'), 7);
  assert.equal(evaluate('(1 + 2) * 3'), 9);
  assert.equal(evaluate('10 ÷ 4'), 2.5);
  assert.equal(evaluate('-5 + -(2 - 7)'), 0);
  assert.equal(evaluate('0.1 + 0.2'), 0.3);
  assert.equal(evaluate('1,234.50 + 1'), 1235.5);
  assert.equal(evaluate('.5 * 4'), 2);
});

test('percent, as on a desk calculator', () => {
  assert.equal(evaluate('200 + 10%'), 220);
  assert.equal(evaluate('200 - 10%'), 180);
  assert.equal(evaluate('200 * 10%'), 20);
  assert.equal(evaluate('15%'), 0.15);
  // GST in a GST-inclusive $110: a tenth of the ex-GST amount.
  assert.equal(evaluate('110 / 11'), 10);
});

test('incomplete or invalid is null', () => {
  for (const e of ['', '1 +', '(1 + 2', '1 / 0', '2 ** 3', 'abc', '1..2', ')']) assert.equal(evaluate(e), null, e);
});

test('pasting numbers in', () => {
  assert.equal(cleanPasted('$1,234.50'), '1234.50');
  assert.equal(evaluate(cleanPasted('AU$1,234.50')), 1234.5);
  assert.equal(evaluate(cleanPasted('(1,234.50)')), -1234.5);
  assert.equal(evaluate(cleanPasted('1,234.50-')), -1234.5);
  assert.equal(evaluate(cleanPasted(' 99.95 AUD ')), 99.95);
  assert.equal(cleanPasted('12 × 3'), '12×3');
});

test('copying a result', () => {
  assert.equal(plainNumber(1234.5), '1234.5');
  assert.equal(plainNumber(0.1 + 0.2), '0.3');
  assert.equal(plainNumber(-0), '0');
});

test('amounts pasted into number fields', () => {
  assert.equal(amountText('A$1,234.50'), '1,234.50');
  assert.equal(amountText('1,234.50 AUD'), '1,234.50');
  assert.equal(amountText('(12.50)'), '-12.50');
  assert.equal(amountText('4.d'), null);
  assert.equal(amountText('Invoice 12'), null);
});
