// Date ranges, built in the user's local calendar as YYYY-MM-DD.
import type { TaxFrequency } from '../shared/countries';
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export { iso as toIso };

export type PeriodKey = 'thisMonth' | 'lastMonth' | 'thisQuarter' | 'thisYear' | 'lastYear' | 'all';

export const PERIOD_OPTIONS: { label: string; value: PeriodKey }[] = [
  { label: 'This month', value: 'thisMonth' },
  { label: 'Last month', value: 'lastMonth' },
  { label: 'This quarter', value: 'thisQuarter' },
  { label: 'This financial year', value: 'thisYear' },
  { label: 'Last financial year', value: 'lastYear' },
  { label: 'All dates', value: 'all' },
];

/** A financial year start, 'MM-DD'. The day is 1–28 so every year has it. */
export type YearStart = string;

export const DEFAULT_YEAR_START: YearStart = '01-01';

export function splitYearStart(ys: YearStart): { month: number; day: number } {
  const m = /^(\d{2})-(\d{2})$/.exec(ys);
  const month = m ? Number(m[1]) : 1;
  const day = m ? Number(m[2]) : 1;
  return month >= 1 && month <= 12 && day >= 1 && day <= 28 ? { month, day } : { month: 1, day: 1 };
}

export function joinYearStart(month: number, day: number): YearStart {
  return `${pad(month)}-${pad(day)}`;
}

export const YEAR_START_DAYS = Array.from({ length: 28 }, (_, i) => ({ label: String(i + 1), value: i + 1 }));

/** The first day of the financial year that `on` falls in. */
export function yearStartFor(on: Date | string, ys: YearStart): Date {
  const d = typeof on === 'string' ? fromIso(on) : on;
  const { month, day } = splitYearStart(ys);
  const thisYear = new Date(d.getFullYear(), month - 1, day);
  return d >= thisYear ? thisYear : new Date(d.getFullYear() - 1, month - 1, day);
}

/** Adds whole months, keeping the day of the month (always 1–28 here). */
const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const fromIso = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

export function periodRange(key: PeriodKey, ys: YearStart = DEFAULT_YEAR_START, now = new Date()): { from?: string; to?: string } {
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (key) {
    case 'thisMonth':
      return { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)) };
    case 'lastMonth':
      return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) };
    case 'thisQuarter': {
      const q = Math.floor(m / 3) * 3;
      return { from: iso(new Date(y, q, 1)), to: iso(new Date(y, q + 3, 0)) };
    }
    case 'thisYear':
    case 'lastYear': {
      let start = yearStartFor(startOfDay(now), ys);
      if (key === 'lastYear') start = addMonths(start, -12);
      return { from: iso(start), to: iso(addDays(addMonths(start, 12), -1)) };
    }
    default:
      return {};
  }
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface TaxPeriod {
  label: string;
  from: string;
  to: string;
  /** still running (ends after today) */
  current: boolean;
}

/** How a period's dates read: "Jul 2026" for a whole month, else "6 Apr–5 May 2026". */
function span(start: Date, end: Date) {
  const sameYear = start.getFullYear() === end.getFullYear();
  if (start.getDate() === 1 && addDays(end, 1).getDate() === 1) {
    return start.getMonth() === end.getMonth() && sameYear
      ? `${MONTH_SHORT[start.getMonth()]} ${start.getFullYear()}`
      : `${MONTH_SHORT[start.getMonth()]}${sameYear ? '' : ' ' + start.getFullYear()}–${MONTH_SHORT[end.getMonth()]} ${end.getFullYear()}`;
  }
  return `${start.getDate()} ${MONTH_SHORT[start.getMonth()]}${sameYear ? '' : ' ' + start.getFullYear()}–${end.getDate()} ${MONTH_SHORT[end.getMonth()]} ${end.getFullYear()}`;
}

/** "2026" for a calendar year, else "FY27" for the year ending in 2027. */
function yearLabel(fyStart: Date, ys: YearStart) {
  return ys === '01-01' ? String(fyStart.getFullYear()) : `FY${String(fyStart.getFullYear() + 1).slice(2)}`;
}

const MONTHS_IN: Record<TaxFrequency, number> = { monthly: 1, 'two-monthly': 2, quarterly: 3, 'six-monthly': 6, annual: 12 };

/**
 * Tax periods, newest first, aligned to the financial year. Quarters are
 * numbered within the financial year (Q1 = first three months).
 */
export function taxPeriods(frequency: TaxFrequency, ys: YearStart, count = 12, now = new Date()): TaxPeriod[] {
  const months = MONTHS_IN[frequency];
  const today = startOfDay(now);
  // Find the period containing today, then walk back.
  const fyStart = yearStartFor(today, ys);
  let index = 0;
  while (addMonths(fyStart, (index + 1) * months) <= today) index++;
  let start = addMonths(fyStart, index * months);
  const out: TaxPeriod[] = [];
  for (let i = 0; i < count; i++) {
    const end = addDays(addMonths(start, months), -1);
    const fy = yearStartFor(start, ys);
    let label: string;
    if (months === 1 || months === 2 || months === 6) label = span(start, end);
    else if (months === 3) {
      const q = Math.round(((start.getFullYear() - fy.getFullYear()) * 12 + start.getMonth() - fy.getMonth()) / 3) + 1;
      label = `Q${q} ${yearLabel(fy, ys)} (${span(start, end)})`;
    } else label = ys === '01-01' ? yearLabel(fy, ys) : `${yearLabel(fy, ys)} (${span(start, end)})`;
    out.push({ label, from: iso(start), to: iso(end), current: end >= today });
    start = addMonths(start, -months);
  }
  return out;
}

/** The same-length period immediately before [from, to] (for comparisons). */
export function previousPeriod(from: string, to: string) {
  const start = fromIso(from);
  const next = addDays(fromIso(to), 1);
  // Whole months from the same day (1 Jul–30 Jun, 6 Apr–5 Apr)? Shift by the
  // month count, so leap years don't push it a day. Otherwise by day count.
  if (start.getDate() <= 28 && next.getDate() === start.getDate()) {
    const months = (next.getFullYear() - start.getFullYear()) * 12 + next.getMonth() - start.getMonth();
    return { from: iso(addMonths(start, -months)), to: iso(addDays(start, -1)) };
  }
  const days = Math.round((Date.UTC(next.getFullYear(), next.getMonth(), next.getDate()) - Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())) / 86400000);
  return { from: iso(addDays(start, -days)), to: iso(addDays(start, -1)) };
}
