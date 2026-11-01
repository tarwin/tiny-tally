import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toCsv } from '../src/shared/csv.ts';

test('toCsv keeps formula-looking text as text, and numbers as numbers', () => {
  assert.equal(toCsv([['=HYPERLINK("x")', '+1 call', '@SUM(A1)', '-cmd', '-12.50', '12', 'plain']]),
    `"'=HYPERLINK(""x"")",'+1 call,'@SUM(A1),'-cmd,-12.50,12,plain\r\n`);
});
