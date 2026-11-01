// Run with `pnpm test` (Node's own runner; Node 23+ runs .ts directly).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { periodRange, previousPeriod, splitYearStart, taxPeriods, yearStartFor } from '../src/lib/periods.ts';

const day = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
};
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

test('splitYearStart falls back to 1 January for anything invalid', () => {
  assert.deepEqual(splitYearStart('07-01'), { month: 7, day: 1 });
  assert.deepEqual(splitYearStart('04-06'), { month: 4, day: 6 });
  for (const bad of ['', '7', '13-01', '02-29', '00-10', '07-1']) assert.deepEqual(splitYearStart(bad), { month: 1, day: 1 });
});

test('yearStartFor either side of each boundary', () => {
  const cases: [string, string, string][] = [
    ['01-01', '2026-01-01', '2026-01-01'],
    ['01-01', '2025-12-31', '2025-01-01'],
    ['07-01', '2026-07-01', '2026-07-01'],
    ['07-01', '2026-06-30', '2025-07-01'],
    ['04-01', '2026-04-01', '2026-04-01'],
    ['04-01', '2026-03-31', '2025-04-01'],
    ['04-06', '2026-04-06', '2026-04-06'],
    ['04-06', '2026-04-05', '2025-04-06'],
  ];
  for (const [ys, on, want] of cases) assert.equal(iso(yearStartFor(on, ys)), want, `${ys} on ${on}`);
});

test('this and last financial year', () => {
  assert.deepEqual(periodRange('thisYear', '07-01', day('2026-11-01')), { from: '2026-07-01', to: '2027-06-30' });
  assert.deepEqual(periodRange('lastYear', '07-01', day('2026-11-01')), { from: '2025-07-01', to: '2026-06-30' });
  assert.deepEqual(periodRange('thisYear', '01-01', day('2026-11-01')), { from: '2026-01-01', to: '2026-12-31' });
  assert.deepEqual(periodRange('thisYear', '04-01', day('2026-03-31')), { from: '2025-04-01', to: '2026-03-31' });
  assert.deepEqual(periodRange('thisYear', '04-06', day('2026-04-05')), { from: '2025-04-06', to: '2026-04-05' });
  assert.deepEqual(periodRange('thisYear', '04-06', day('2026-04-06')), { from: '2026-04-06', to: '2027-04-05' });
});

test('quarterly periods from 1 July (unchanged from the month-only version)', () => {
  const p = taxPeriods('quarterly', '07-01', 3, day('2026-11-01'));
  assert.deepEqual(
    p.map((x) => [x.label, x.from, x.to, x.current]),
    [
      ['Q2 FY27 (Oct–Dec 2026)', '2026-10-01', '2026-12-31', true],
      ['Q1 FY27 (Jul–Sep 2026)', '2026-07-01', '2026-09-30', false],
      ['Q4 FY26 (Apr–Jun 2026)', '2026-04-01', '2026-06-30', false],
    ],
  );
});

test('monthly and annual periods', () => {
  assert.deepEqual(
    taxPeriods('monthly', '07-01', 2, day('2026-07-15')).map((x) => [x.label, x.from, x.to]),
    [
      ['Jul 2026', '2026-07-01', '2026-07-31'],
      ['Jun 2026', '2026-06-01', '2026-06-30'],
    ],
  );
  assert.deepEqual(
    taxPeriods('annual', '07-01', 1, day('2026-07-15')).map((x) => [x.label, x.from, x.to]),
    [['FY27 (Jul 2026–Jun 2027)', '2026-07-01', '2027-06-30']],
  );
  assert.deepEqual(
    taxPeriods('annual', '01-01', 2, day('2026-07-15')).map((x) => [x.label, x.from, x.to]),
    [
      ['2026', '2026-01-01', '2026-12-31'],
      ['2025', '2025-01-01', '2025-12-31'],
    ],
  );
});

test('periods from a mid-month start (6 April)', () => {
  assert.deepEqual(
    taxPeriods('monthly', '04-06', 2, day('2026-05-05')).map((x) => [x.label, x.from, x.to]),
    [
      ['6 Apr–5 May 2026', '2026-04-06', '2026-05-05'],
      ['6 Mar–5 Apr 2026', '2026-03-06', '2026-04-05'],
    ],
  );
  assert.deepEqual(
    taxPeriods('quarterly', '04-06', 2, day('2026-07-06')).map((x) => [x.label, x.from, x.to]),
    [
      ['Q2 FY27 (6 Jul–5 Oct 2026)', '2026-07-06', '2026-10-05'],
      ['Q1 FY27 (6 Apr–5 Jul 2026)', '2026-04-06', '2026-07-05'],
    ],
  );
  assert.deepEqual(
    taxPeriods('quarterly', '04-06', 1, day('2026-01-05')).map((x) => [x.label, x.from, x.to]),
    [['Q3 FY26 (6 Oct 2025–5 Jan 2026)', '2025-10-06', '2026-01-05']],
  );
});

test('previousPeriod', () => {
  assert.deepEqual(previousPeriod('2026-07-01', '2027-06-30'), { from: '2025-07-01', to: '2026-06-30' });
  assert.deepEqual(previousPeriod('2026-10-01', '2026-12-31'), { from: '2026-07-01', to: '2026-09-30' });
  // Over 29 Feb 2028: still a year back, not a day out.
  assert.deepEqual(previousPeriod('2028-04-06', '2029-04-05'), { from: '2027-04-06', to: '2028-04-05' });
  // Not whole months: same number of days.
  assert.deepEqual(previousPeriod('2026-03-10', '2026-03-16'), { from: '2026-03-03', to: '2026-03-09' });
});

test('NZ 2-monthly periods line up with a 1 April year', () => {
  assert.deepEqual(
    taxPeriods('two-monthly', '04-01', 3, day('2026-11-01')).map((x) => [x.label, x.from, x.to, x.current]),
    [
      ['Oct–Nov 2026', '2026-10-01', '2026-11-30', true],
      ['Aug–Sep 2026', '2026-08-01', '2026-09-30', false],
      ['Jun–Jul 2026', '2026-06-01', '2026-07-31', false],
    ],
  );
});

test('NZ 6-monthly periods cross the calendar year', () => {
  assert.deepEqual(
    taxPeriods('six-monthly', '04-01', 2, day('2027-01-15')).map((x) => [x.label, x.from, x.to]),
    [
      ['Oct 2026–Mar 2027', '2026-10-01', '2027-03-31'],
      ['Apr–Sep 2026', '2026-04-01', '2026-09-30'],
    ],
  );
});
