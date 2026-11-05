// The date format each set of books chooses, and where it starts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeBooks } from './support/books.ts';
import { getSettings, updateSettings } from '../backend/settings.ts';
import { dateDisplay, formatDay, formatShortDay } from '../src/lib/dates.ts';
import { taxPeriods } from '../src/lib/periods.ts';
import { COUNTRIES, type Country } from '../src/shared/countries.ts';

test('each format, whatever the device language', () => {
  assert.equal(formatDay('2026-05-10', 'dmy'), '10 May 2026');
  assert.equal(formatDay('2026-05-10', 'mdy'), 'May 10, 2026');
  assert.equal(formatDay('2026-05-10', 'ymd'), '2026-05-10');
});

test('short dates drop this year', () => {
  const year = new Date().getFullYear();
  assert.equal(formatShortDay(`${year}-05-10`, 'dmy'), '10 May');
  assert.equal(formatShortDay(`${year}-05-10`, 'mdy'), 'May 10');
  assert.equal(formatShortDay(`${year}-05-10`, 'ymd'), '05-10');
  assert.equal(formatShortDay('2019-05-10', 'dmy'), '10 May 19');
  assert.equal(formatShortDay('2019-05-10', 'mdy'), 'May 10, 19');
  assert.equal(formatShortDay('2019-05-10', 'ymd'), '2019-05-10');
});

test('formatDay follows the open books', () => {
  dateDisplay.format = 'dmy';
  assert.equal(formatDay('2026-01-02'), '2 Jan 2026');
  dateDisplay.format = 'mdy';
  assert.equal(formatDay('2026-01-02'), 'Jan 2, 2026');
  dateDisplay.format = null;
});

test('a period that starts mid-month reads in the same order', () => {
  const at = new Date(2026, 5, 20);
  const label = () => taxPeriods('quarterly', '04-06', 1, at)[0].label;
  dateDisplay.format = 'mdy';
  assert.match(label(), /Apr 6–Jul 5, 2026/);
  dateDisplay.format = 'dmy';
  assert.match(label(), /6 Apr–5 Jul 2026/);
  dateDisplay.format = null;
});

test('books start with their country\'s order, and can change it', async () => {
  const start: Record<Country, string> = { AU: 'dmy', CA: 'mdy', GB: 'dmy', IN: 'dmy', NZ: 'dmy', US: 'mdy' };
  for (const country of Object.keys(COUNTRIES) as Country[]) {
    const b = await makeBooks({ name: 'Test', country, fiscalYearStart: COUNTRIES[country].fiscalYearStart, taxEnabled: false });
    b.run(() => {
      assert.equal(getSettings().dateFormat, start[country], country);
      updateSettings({ dateFormat: 'ymd' });
      assert.equal(getSettings().dateFormat, 'ymd');
      assert.throws(() => updateSettings({ dateFormat: 'ydm' as any }));
    });
    b.close();
  }
});
