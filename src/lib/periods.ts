// Date ranges, built in the user's local calendar as YYYY-MM-DD.
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export type PeriodKey = 'thisMonth' | 'lastMonth' | 'thisQuarter' | 'thisYear' | 'lastYear' | 'all';

export const PERIOD_OPTIONS: { label: string; value: PeriodKey }[] = [
  { label: 'This month', value: 'thisMonth' },
  { label: 'Last month', value: 'lastMonth' },
  { label: 'This quarter', value: 'thisQuarter' },
  { label: 'This financial year', value: 'thisYear' },
  { label: 'Last financial year', value: 'lastYear' },
  { label: 'All dates', value: 'all' },
];

/** fiscalStart: 1–12, the month the financial year begins. */
export function periodRange(key: PeriodKey, fiscalStart = 1, now = new Date()): { from?: string; to?: string } {
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
      const startMonth = fiscalStart - 1;
      let startYear = m >= startMonth ? y : y - 1;
      if (key === 'lastYear') startYear--;
      return { from: iso(new Date(startYear, startMonth, 1)), to: iso(new Date(startYear + 1, startMonth, 0)) };
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

/**
 * BAS periods, newest first, aligned to the financial year. Quarters are
 * numbered within the financial year (Q1 = first three months).
 */
export function taxPeriods(frequency: 'monthly' | 'quarterly' | 'annual', fiscalStart: number, count = 12, now = new Date()): TaxPeriod[] {
  const months = frequency === 'monthly' ? 1 : frequency === 'quarterly' ? 3 : 12;
  const today = iso(now);
  // Find the period containing today, then walk back.
  const fsIndex = fiscalStart - 1;
  const monthsSinceFyStart = (now.getMonth() - fsIndex + 12) % 12;
  let start = new Date(now.getFullYear(), now.getMonth() - (monthsSinceFyStart % months), 1);
  const out: TaxPeriod[] = [];
  for (let i = 0; i < count; i++) {
    const end = new Date(start.getFullYear(), start.getMonth() + months, 0);
    const fyStartYear = start.getMonth() >= fsIndex ? start.getFullYear() : start.getFullYear() - 1;
    const fyLabel = fsIndex === 0 ? String(fyStartYear) : `FY${String(fyStartYear + 1).slice(2)}`;
    let label: string;
    if (months === 1) label = `${MONTH_SHORT[start.getMonth()]} ${start.getFullYear()}`;
    else if (months === 3) {
      const q = Math.floor(((start.getMonth() - fsIndex + 12) % 12) / 3) + 1;
      label = `Q${q} ${fyLabel} (${MONTH_SHORT[start.getMonth()]}–${MONTH_SHORT[end.getMonth()]} ${end.getFullYear()})`;
    } else label = fsIndex === 0 ? `${fyStartYear}` : `${fyLabel} (${MONTH_SHORT[start.getMonth()]} ${start.getFullYear()}–${MONTH_SHORT[end.getMonth()]} ${end.getFullYear()})`;
    out.push({ label, from: iso(start), to: iso(end), current: iso(end) >= today });
    start = new Date(start.getFullYear(), start.getMonth() - months, 1);
  }
  return out;
}

/** The same-length period immediately before [from, to] (for comparisons). */
export function previousPeriod(from: string, to: string) {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  // Whole months? shift by the month count; otherwise by day count.
  const isMonthStart = fd === 1;
  const isMonthEnd = new Date(ty, tm, 0).getDate() === td;
  if (isMonthStart && isMonthEnd) {
    const months = (ty - fy) * 12 + (tm - fm) + 1;
    return { from: iso(new Date(fy, fm - 1 - months, 1)), to: iso(new Date(fy, fm - 1, 0)) };
  }
  const days = Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000) + 1;
  return { from: iso(new Date(fy, fm - 1, fd - days)), to: iso(new Date(fy, fm - 1, fd - 1)) };
}
