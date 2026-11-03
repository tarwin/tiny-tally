// The business income summary on each country's income tax return, for
// mapping categories to: Australia's business and professional items schedule
// (item P8, non-primary production), New Zealand's IR10 financial statements
// summary. The US has Schedule C (scheduleC.ts). A category's report_line
// holds one of these keys.
//
// AU: Business and professional items schedule instructions 2026 (NAT 2543).
// The letters K and M are each used twice in P8 (stock and expenses), so
// lines are keyed by name, and the letter shown beside it.

import { ESTIMATED_TAX_KEY } from './scheduleC';

export interface ReturnLine {
  key: string;
  /** The label or box: 'J', '14'. */
  code: string;
  label: string;
  kind: 'income' | 'expense';
  /** Cost of sales: purchases go here, between opening and closing stock. */
  costOfSales?: boolean;
  help?: string;
}

export interface IncomeReturn {
  country: 'AU' | 'NZ';
  title: string;
  short: string;
  lines: ReturnLine[];
  /** The line car costs go on. */
  carKey: string;
  /** The line a home office claim goes on. */
  homeOfficeKey: string;
  /** Where income goes when a category isn't mapped. */
  defaults: { income: string; expense: string };
  checked: string;
  source: string;
}

export const AU_P8: IncomeReturn = {
  country: 'AU',
  title: 'Business and professional items (P8)',
  short: 'Business schedule',
  carKey: 'au-motor-vehicle',
  homeOfficeKey: 'au-other-expenses',
  defaults: { income: 'au-other-income', expense: 'au-other-expenses' },
  checked: '2026-11-03',
  source: 'https://www.ato.gov.au/forms-and-instructions/business-and-professional-items-schedule-2026-instructions/instructions-to-complete-the-bpi-schedule-2026',
  lines: [
    { key: 'au-no-abn', code: 'D', label: 'Gross payments where ABN not quoted', kind: 'income', help: 'Payments to you that had tax withheld because you gave no ABN.' },
    { key: 'au-voluntary', code: 'F', label: 'Gross payments – voluntary agreement', kind: 'income', help: 'Payments under a PAYG voluntary agreement to withhold.' },
    { key: 'au-labour-hire', code: 'O', label: 'Gross payments – labour hire or other specified payments', kind: 'income' },
    { key: 'au-government', code: 'H', label: 'Assessable government industry payments', kind: 'income', help: 'Grants, subsidies and fuel tax credits.' },
    { key: 'au-other-income', code: 'J', label: 'Other business income', kind: 'income', help: 'Sales and fees, before GST: most business income goes here.' },
    { key: 'au-purchases', code: 'L', label: 'Purchases and other costs', kind: 'expense', costOfSales: true, help: 'Trading stock and what goes into what you sell.' },
    { key: 'au-contractors', code: 'F', label: 'Contractor, sub-contractor and commission expenses', kind: 'expense' },
    { key: 'au-super', code: 'G', label: 'Superannuation expenses', kind: 'expense', help: "Super for employees. Your own goes on your personal return, not here." },
    { key: 'au-bad-debts', code: 'I', label: 'Bad debts', kind: 'expense' },
    { key: 'au-lease', code: 'J', label: 'Lease expenses', kind: 'expense', help: 'Leased cars and equipment.' },
    { key: 'au-rent', code: 'K', label: 'Rent expenses', kind: 'expense' },
    { key: 'au-interest', code: 'Q', label: 'Interest expenses within Australia', kind: 'expense' },
    { key: 'au-interest-overseas', code: 'R', label: 'Interest expenses overseas', kind: 'expense' },
    { key: 'au-depreciation', code: 'M', label: 'Depreciation expenses', kind: 'expense', help: 'Including the instant asset write-off.' },
    { key: 'au-motor-vehicle', code: 'N', label: 'Motor vehicle expenses', kind: 'expense', help: 'Car costs, or the cents per km claim from your trip log.' },
    { key: 'au-repairs', code: 'O', label: 'Repairs and maintenance', kind: 'expense' },
    { key: 'au-other-expenses', code: 'P', label: 'All other expenses', kind: 'expense', help: 'Everything else, including working from home.' },
  ],
};

export const NZ_IR10: IncomeReturn = {
  country: 'NZ',
  title: 'Financial statements summary (IR10)',
  short: 'IR10',
  carKey: 'nz-vehicle',
  homeOfficeKey: 'nz-home-office',
  defaults: { income: 'nz-other-income', expense: 'nz-other-expenses' },
  checked: '2026-11-03',
  source: 'https://www.ird.govt.nz/-/media/project/ir/home/documents/forms-and-guides/ir1---ir99/ir10/ir10.pdf',
  lines: [
    { key: 'nz-sales', code: '2', label: 'Sales and/or services', kind: 'income', help: 'Before GST if you are registered.' },
    { key: 'nz-interest', code: '7', label: 'Interest received', kind: 'income' },
    { key: 'nz-dividends', code: '8', label: 'Dividends received', kind: 'income' },
    { key: 'nz-rental', code: '9', label: 'Rental, lease and licence income', kind: 'income' },
    { key: 'nz-other-income', code: '10', label: 'Other income', kind: 'income' },
    { key: 'nz-purchases', code: '4', label: 'Purchases', kind: 'expense', costOfSales: true, help: 'Stock and what goes into what you sell.' },
    { key: 'nz-bad-debts', code: '12', label: 'Bad debts', kind: 'expense' },
    { key: 'nz-depreciation', code: '13', label: 'Depreciation', kind: 'expense', help: 'Including low-value assets written off.' },
    { key: 'nz-insurance', code: '14', label: 'Insurance', kind: 'expense', help: 'Not ACC levies: those go in other expenses.' },
    { key: 'nz-interest-expense', code: '15', label: 'Interest expense', kind: 'expense' },
    { key: 'nz-professional', code: '16', label: 'Professional and consulting fees', kind: 'expense', help: 'Accountant, lawyer, consultants.' },
    { key: 'nz-rates', code: '17', label: 'Rates', kind: 'expense' },
    { key: 'nz-rent', code: '18', label: 'Rental, lease and licence payments', kind: 'expense' },
    { key: 'nz-repairs', code: '19', label: 'Repairs and maintenance', kind: 'expense' },
    { key: 'nz-research', code: '20', label: 'Research and development', kind: 'expense' },
    { key: 'nz-associated', code: '21', label: "Associated persons' remuneration", kind: 'expense', help: 'Paying your partner or family.' },
    { key: 'nz-wages', code: '22', label: 'Salaries and wages paid to employees', kind: 'expense' },
    { key: 'nz-contractors', code: '23', label: 'Contractor and sub-contractor payments', kind: 'expense' },
    { key: 'nz-vehicle', code: '24', label: 'Other expenses: vehicle', kind: 'expense', help: 'Running costs at the business share, or the kilometre rate claim from your trip log. Part of Box 24.' },
    { key: 'nz-home-office', code: '24', label: 'Other expenses: home office', kind: 'expense', help: 'Part of Box 24.' },
    { key: 'nz-other-expenses', code: '24', label: 'Other expenses', kind: 'expense' },
  ],
};

export const INCOME_RETURNS = { AU: AU_P8, NZ: NZ_IR10 } as const;

export function incomeReturnFor(country: string): IncomeReturn | null {
  return country === 'AU' ? AU_P8 : country === 'NZ' ? NZ_IR10 : null;
}

/** Is `key` a line on this country's return, for a category of this kind? The estimated-tax marker is allowed too. */
export function isReturnLine(country: string, key: unknown, kind: 'income' | 'expense'): key is string {
  if (key === ESTIMATED_TAX_KEY) return false;
  return !!incomeReturnFor(country)?.lines.some((l) => l.key === key && l.kind === kind);
}
