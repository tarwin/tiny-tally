// IRS Schedule C (Profit or Loss From Business) lines that a sole
// proprietor's categories map onto. US categories carry a stable key in
// categories.report_line ('office', 'other-expenses'); each tax year says
// which line number that key is on, because the IRS renumbers lines now and
// then (2025 moved other expenses from 27a to 27b). The Schedule C report
// groups the P&L by it: Part I income, Part II expenses and Part III cost
// of goods sold. Vehicle details, home office and depreciation are worked
// out separately.
import type { RuleStatus } from './taxReturns';

export interface ScheduleCLine {
  key: string;
  line: string;
  label: string;
  kind: 'income' | 'expense';
  /** Part I income, Part II expenses, Part III cost of goods sold. Default by kind. */
  part?: 'III';
  /** Share that's deductible, in percent (meals: 50). */
  deductiblePct?: number;
  /** What does and doesn't belong on it, for picking a category's line. */
  help?: string;
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
  { key: 'gross-receipts', line: '1', label: 'Gross receipts or sales', kind: 'income', help: 'Credit notes on these categories show as returns and allowances (line 2).' },
  { key: 'other-income', line: '6', label: 'Other income', kind: 'income', help: 'Business interest, and other business income that isn\'t a sale.' },
  { key: 'advertising', line: '8', label: 'Advertising', kind: 'expense' },
  { key: 'car-truck', line: '9', label: 'Car and truck expenses', kind: 'expense', help: 'Actual costs: gas, repairs, insurance. With the standard mileage rate (from the mileage log) these are left out.' },
  { key: 'parking-tolls', line: '9', label: 'Parking fees and tolls', kind: 'expense', help: 'Business parking and tolls, on line 9 with either the mileage rate or actual costs.' },
  { key: 'commissions', line: '10', label: 'Commissions and fees', kind: 'expense', help: 'Including card and payment processing fees (Stripe, PayPal, Square).' },
  { key: 'contract-labor', line: '11', label: 'Contract labor', kind: 'expense' },
  { key: 'depreciation', line: '13', label: 'Depreciation and section 179', kind: 'expense', help: 'The figure from Form 4562. Record equipment you buy as an asset, not here.' },
  { key: 'employee-benefits', line: '14', label: 'Employee benefit programs', kind: 'expense', help: "Your employees' benefits, not your own." },
  { key: 'insurance', line: '15', label: 'Insurance (other than health)', kind: 'expense', help: "Business insurance. Your own health insurance goes on Schedule 1: use an owner's money category." },
  { key: 'mortgage-interest', line: '16a', label: 'Interest: mortgage', kind: 'expense' },
  { key: 'other-interest', line: '16b', label: 'Interest: other', kind: 'expense' },
  { key: 'legal-professional', line: '17', label: 'Legal and professional services', kind: 'expense' },
  { key: 'office', line: '18', label: 'Office expense', kind: 'expense' },
  { key: 'pension', line: '19', label: 'Pension and profit-sharing plans', kind: 'expense', help: "For your employees. Your own SEP, SIMPLE or solo 401(k) goes on Schedule 1: use an owner's money category." },
  { key: 'rent-vehicles', line: '20a', label: 'Rent: vehicles, machinery and equipment', kind: 'expense' },
  { key: 'rent-property', line: '20b', label: 'Rent: other business property', kind: 'expense' },
  { key: 'repairs', line: '21', label: 'Repairs and maintenance', kind: 'expense' },
  { key: 'supplies', line: '22', label: 'Supplies', kind: 'expense', help: 'Including small equipment expensed under the de minimis safe harbor ($2,500 or less an item).' },
  { key: 'taxes-licenses', line: '23', label: 'Taxes and licenses', kind: 'expense', help: 'Not federal income tax or your own self-employment tax.' },
  { key: 'travel', line: '24a', label: 'Travel', kind: 'expense' },
  { key: 'meals', line: '24b', label: 'Deductible meals', kind: 'expense', deductiblePct: 50, help: 'Half of business meals are deductible; the report halves the total.' },
  { key: 'utilities', line: '25', label: 'Utilities', kind: 'expense' },
  { key: 'wages', line: '26', label: 'Wages', kind: 'expense', help: "Employees' wages. Not what you pay yourself: that's an owner's draw." },
  { key: 'other-expenses', line: '27a', label: 'Other expenses', kind: 'expense', help: 'Listed by category in Part V.' },
  // Part III, cost of goods sold. Opening and closing inventory (lines 35 and 41) are typed in on the report.
  { key: 'cogs-purchases', line: '36', label: 'Purchases (cost of goods sold)', kind: 'expense', part: 'III', help: 'Stock bought to sell, less anything taken for personal use.' },
  { key: 'cogs-labor', line: '37', label: 'Cost of labor (cost of goods sold)', kind: 'expense', part: 'III', help: 'Labor that goes into making the goods. Not what you pay yourself.' },
  { key: 'cogs-materials', line: '38', label: 'Materials and supplies (cost of goods sold)', kind: 'expense', part: 'III' },
  { key: 'cogs-other', line: '39', label: 'Other costs (cost of goods sold)', kind: 'expense', part: 'III', help: 'Like freight in, or packaging for goods you sell.' },
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

/** Which part of the form a line is in. */
export function partOf(l: Pick<ScheduleCLine, 'kind' | 'part'>): 'I' | 'II' | 'III' {
  return l.part ?? (l.kind === 'income' ? 'I' : 'II');
}

/** Marks the tax-payment category that estimated tax payments (Form 1040-ES) go to. Not a Schedule C line. */
export const ESTIMATED_TAX_KEY = 'estimated-tax';

export function isScheduleCKey(v: unknown): v is string {
  return typeof v === 'string' && v in SCHEDULE_C_MAP;
}
