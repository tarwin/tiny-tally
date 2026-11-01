import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseRate, ratePercent } from '../src/lib/money.ts';

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
