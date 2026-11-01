// IRS Schedule C (Profit or Loss From Business) lines that a sole
// proprietor's categories map onto. US categories carry a stable key in
// categories.report_line ('office', 'other-expenses'); each tax year says
// which line number that key is on, because the IRS renumbers lines now and
// then (2025 moved other expenses from 27a to 27b). The Schedule C report
// groups the P&L by it. Part I income and Part II expenses only: cost of
// goods sold, vehicle details, home office and depreciation are worked out
// separately.
import type { RuleStatus } from './taxReturns';

export interface ScheduleCLine {
  key: string;
  line: string;
  label: string;
  kind: 'income' | 'expense';
  /** Share that's deductible, in percent (meals: 50). */
  deductiblePct?: number;
}

export interface ScheduleCYear {
  id: string;
  name: string;
  /** The IRS guidance it was checked against. */
  checkedAgainst: string;
  /** Tax years ending on or after this use it. */
  from: string;
  /** Checked for tax years ending up to this date; later ones get a warning. */
  checkedUntil: string;
  lines: ScheduleCLine[];
}

// As numbered up to tax year 2024.
const LINES_2024: ScheduleCLine[] = [
  { key: 'gross-receipts', line: '1', label: 'Gross receipts or sales', kind: 'income' },
  { key: 'other-income', line: '6', label: 'Other income', kind: 'income' },
  { key: 'advertising', line: '8', label: 'Advertising', kind: 'expense' },
  { key: 'car-truck', line: '9', label: 'Car and truck expenses', kind: 'expense' },
  { key: 'commissions', line: '10', label: 'Commissions and fees', kind: 'expense' },
  { key: 'contract-labor', line: '11', label: 'Contract labor', kind: 'expense' },
  { key: 'depreciation', line: '13', label: 'Depreciation and section 179', kind: 'expense' },
  { key: 'employee-benefits', line: '14', label: 'Employee benefit programs', kind: 'expense' },
  { key: 'insurance', line: '15', label: 'Insurance (other than health)', kind: 'expense' },
  { key: 'mortgage-interest', line: '16a', label: 'Interest: mortgage', kind: 'expense' },
  { key: 'other-interest', line: '16b', label: 'Interest: other', kind: 'expense' },
  { key: 'legal-professional', line: '17', label: 'Legal and professional services', kind: 'expense' },
  { key: 'office', line: '18', label: 'Office expense', kind: 'expense' },
  { key: 'pension', line: '19', label: 'Pension and profit-sharing plans', kind: 'expense' },
  { key: 'rent-vehicles', line: '20a', label: 'Rent: vehicles, machinery and equipment', kind: 'expense' },
  { key: 'rent-property', line: '20b', label: 'Rent: other business property', kind: 'expense' },
  { key: 'repairs', line: '21', label: 'Repairs and maintenance', kind: 'expense' },
  { key: 'supplies', line: '22', label: 'Supplies', kind: 'expense' },
  { key: 'taxes-licenses', line: '23', label: 'Taxes and licenses', kind: 'expense' },
  { key: 'travel', line: '24a', label: 'Travel', kind: 'expense' },
  { key: 'meals', line: '24b', label: 'Deductible meals', kind: 'expense', deductiblePct: 50 },
  { key: 'utilities', line: '25', label: 'Utilities', kind: 'expense' },
  { key: 'wages', line: '26', label: 'Wages', kind: 'expense' },
  { key: 'other-expenses', line: '27a', label: 'Other expenses', kind: 'expense' },
];

/** Oldest first. Add a year when the IRS changes the form, and move checkedUntil on once it's re-checked. */
export const SCHEDULE_C_YEARS: ScheduleCYear[] = [
  {
    id: '2024',
    name: 'Schedule C (2024 and earlier)',
    checkedAgainst: 'Line numbers as they were before the 2025 changes listed in IRS Instructions for Schedule C (2025)',
    from: '2018-01-01',
    checkedUntil: '2024-12-31',
    lines: LINES_2024,
  },
  {
    id: '2025',
    name: 'Schedule C (2025)',
    checkedAgainst: 'IRS Instructions for Schedule C (Form 1040) (2025)',
    from: '2025-01-01',
    checkedUntil: '2025-12-31',
    // Line 27a became the energy efficient commercial buildings deduction.
    lines: LINES_2024.map((l) => (l.key === 'other-expenses' ? { ...l, line: '27b' } : l)),
  },
];

/** The year's lines for a tax year ending on `date`, and whether this version of the app has checked them. */
export function scheduleCFor(date: string): { year: ScheduleCYear; status: RuleStatus } {
  const year = [...SCHEDULE_C_YEARS].reverse().find((y) => y.from <= date);
  if (!year) return { year: SCHEDULE_C_YEARS[0], status: 'before' };
  return { year, status: date > year.checkedUntil ? 'unchecked' : 'checked' };
}

/** Every key, numbered as in the newest year (for picking a category's line). */
export const SCHEDULE_C_LINES = SCHEDULE_C_YEARS[SCHEDULE_C_YEARS.length - 1].lines;
export const SCHEDULE_C_MAP: Record<string, ScheduleCLine> = Object.fromEntries(SCHEDULE_C_LINES.map((l) => [l.key, l]));

export function isScheduleCKey(v: unknown): v is string {
  return typeof v === 'string' && v in SCHEDULE_C_MAP;
}
