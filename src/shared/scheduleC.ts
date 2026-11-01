// IRS Schedule C (Profit or Loss From Business) lines that a sole
// proprietor's categories map onto. US categories carry one in
// categories.report_line; the Schedule C report groups the P&L by it.
// Part I income and Part II expenses only: cost of goods sold, vehicle
// details, home office and depreciation are worked out separately.

export interface ScheduleCLine {
  line: string;
  label: string;
  kind: 'income' | 'expense';
  /** Share that's deductible, in percent (meals: 50). */
  deductiblePct?: number;
}

export const SCHEDULE_C_LINES: ScheduleCLine[] = [
  { line: '1', label: 'Gross receipts or sales', kind: 'income' },
  { line: '6', label: 'Other income', kind: 'income' },
  { line: '8', label: 'Advertising', kind: 'expense' },
  { line: '9', label: 'Car and truck expenses', kind: 'expense' },
  { line: '10', label: 'Commissions and fees', kind: 'expense' },
  { line: '11', label: 'Contract labor', kind: 'expense' },
  { line: '13', label: 'Depreciation and section 179', kind: 'expense' },
  { line: '14', label: 'Employee benefit programs', kind: 'expense' },
  { line: '15', label: 'Insurance (other than health)', kind: 'expense' },
  { line: '16a', label: 'Interest: mortgage', kind: 'expense' },
  { line: '16b', label: 'Interest: other', kind: 'expense' },
  { line: '17', label: 'Legal and professional services', kind: 'expense' },
  { line: '18', label: 'Office expense', kind: 'expense' },
  { line: '19', label: 'Pension and profit-sharing plans', kind: 'expense' },
  { line: '20a', label: 'Rent: vehicles, machinery and equipment', kind: 'expense' },
  { line: '20b', label: 'Rent: other business property', kind: 'expense' },
  { line: '21', label: 'Repairs and maintenance', kind: 'expense' },
  { line: '22', label: 'Supplies', kind: 'expense' },
  { line: '23', label: 'Taxes and licenses', kind: 'expense' },
  { line: '24a', label: 'Travel', kind: 'expense' },
  { line: '24b', label: 'Deductible meals', kind: 'expense', deductiblePct: 50 },
  { line: '25', label: 'Utilities', kind: 'expense' },
  { line: '26', label: 'Wages', kind: 'expense' },
  { line: '27a', label: 'Other expenses', kind: 'expense' },
];

export const SCHEDULE_C_MAP: Record<string, ScheduleCLine> = Object.fromEntries(SCHEDULE_C_LINES.map((l) => [l.line, l]));

export function isScheduleCLine(v: unknown): v is string {
  return typeof v === 'string' && v in SCHEDULE_C_MAP;
}
