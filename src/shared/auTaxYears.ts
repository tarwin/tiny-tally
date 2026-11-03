// Australian figures that change by income year, keyed by the year the
// income year ends in (2026 = 1 July 2025 to 30 June 2026, "2025-26").
// Update once a year when the ATO publishes them (see RELEASING.md), and
// move `checked` on. A later year Tiny Tally doesn't know yet uses the latest
// figures and says they're unchecked.

export interface AuTaxYear {
  year: number;
  /** Car expenses, cents per km method: tenths of a cent a km. */
  centsPerKm: number;
  /** The most business km a car can claim at that rate. */
  kmCap: number;
  /** Working from home, fixed rate method: tenths of a cent an hour. */
  wfhPerHour: number;
  /** False while the ATO hasn't set this year's rate (the last one is used). */
  wfhSet: boolean;
  /** Small business instant asset write-off (turnover under $10m): each asset costing less than this, cents. $20,000 from 1 July 2023, made permanent in 2026. */
  instantWriteOff: number;
  /** GST registration turnover threshold, cents. */
  gstThreshold: number;
  /** No-ABN withholding: the rate, and payments at or under this (before GST) are exempt. */
  noAbnPct: number;
  noAbnUnder: number;
  /** Resident income tax: the rate on income above each threshold (cents). */
  brackets: { over: number; pct: number }[];
  medicareLevyPct: number;
  sources: string[];
  checked: string;
}

const BRACKETS_2025 = [
  { over: 0, pct: 0 },
  { over: 1_820_000, pct: 16 },
  { over: 4_500_000, pct: 30 },
  { over: 13_500_000, pct: 37 },
  { over: 19_000_000, pct: 45 },
];

const COMMON = {
  kmCap: 5_000,
  gstThreshold: 7_500_000,
  noAbnPct: 47,
  noAbnUnder: 7_500,
  medicareLevyPct: 2,
};

export const AU_TAX_YEARS: Record<number, AuTaxYear> = {
  2024: {
    ...COMMON,
    year: 2024,
    centsPerKm: 850,
    wfhPerHour: 670,
    instantWriteOff: 2_000_000,
    wfhSet: true,
    brackets: [
      { over: 0, pct: 0 },
      { over: 1_820_000, pct: 19 },
      { over: 4_500_000, pct: 32.5 },
      { over: 12_000_000, pct: 37 },
      { over: 18_000_000, pct: 45 },
    ],
    sources: ['https://www.ato.gov.au/businesses-and-organisations/income-deductions-and-concessions/income-and-deductions-for-business/deductions/motor-vehicle-expenses'],
    checked: '2026-11-03',
  },
  2025: {
    ...COMMON,
    year: 2025,
    centsPerKm: 880,
    wfhPerHour: 700,
    instantWriteOff: 2_000_000,
    wfhSet: true,
    brackets: BRACKETS_2025,
    sources: ['https://www.ato.gov.au/tax-rates-and-codes/tax-rates-australian-residents'],
    checked: '2026-11-03',
  },
  2026: {
    ...COMMON,
    year: 2026,
    centsPerKm: 880,
    wfhPerHour: 700,
    instantWriteOff: 2_000_000,
    wfhSet: true,
    brackets: BRACKETS_2025,
    sources: ['https://www.ato.gov.au/tax-rates-and-codes/tax-rates-australian-residents'],
    checked: '2026-11-03',
  },
  2027: {
    ...COMMON,
    year: 2027,
    centsPerKm: 910,
    // Not set by the ATO yet: 2025-26's rate until it is.
    wfhPerHour: 700,
    wfhSet: false,
    instantWriteOff: 2_000_000,
    brackets: [
      { over: 0, pct: 0 },
      { over: 1_820_000, pct: 15 },
      { over: 4_500_000, pct: 30 },
      { over: 13_500_000, pct: 37 },
      { over: 19_000_000, pct: 45 },
    ],
    sources: [
      'https://www.ato.gov.au/individuals-and-families/income-deductions-offsets-and-records/deductions-you-can-claim/work-related-deductions/cars-transport-and-travel/motor-vehicle-and-car-expenses/expenses-for-a-car-you-own-or-lease/cents-per-kilometre-method',
      'https://www.ato.gov.au/about-ato/new-legislation/in-detail/businesses/20000-dollars-instant-asset-write-off',
      'https://ato.gov.au/about-ato/new-legislation/in-detail/individuals/personal-income-tax-new-tax-cuts-for-every-australian-taxpayer',
    ],
    checked: '2026-11-03',
  },
};

const YEARS = Object.keys(AU_TAX_YEARS).map(Number).sort((a, b) => a - b);

export function auTaxYear(year: number): { rules: AuTaxYear; status: 'checked' | 'unchecked' | 'before' } {
  if (AU_TAX_YEARS[year]) return { rules: AU_TAX_YEARS[year], status: 'checked' };
  const before = year < YEARS[0];
  const near = AU_TAX_YEARS[before ? YEARS[0] : YEARS[YEARS.length - 1]];
  return { rules: { ...near, year }, status: before ? 'before' : 'unchecked' };
}

/** Resident income tax on taxable income, plus the Medicare levy. No offsets. */
export function auIncomeTax(taxable: number, year: number) {
  const { rules } = auTaxYear(year);
  return Math.round(bracketTax(taxable, rules.brackets) + (Math.max(0, taxable) * rules.medicareLevyPct) / 100);
}

export function bracketTax(income: number, brackets: { over: number; pct: number }[]) {
  let tax = 0;
  for (let i = 0; i < brackets.length; i++) {
    const top = brackets[i + 1]?.over ?? Infinity;
    if (income > brackets[i].over) tax += ((Math.min(income, top) - brackets[i].over) * brackets[i].pct) / 100;
  }
  return Math.round(tax);
}
