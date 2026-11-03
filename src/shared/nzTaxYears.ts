// New Zealand figures that change by income year, keyed by the year the
// income year ends in (2026 = 1 April 2025 to 31 March 2026). Update once a
// year when IRD publishes them (see RELEASING.md): kilometre rates come out
// after the year ends (2025-26's in mid 2026), the home office rate in June.
// A year Tiny Tally doesn't know yet uses the latest figures and says so.

export type NzFuel = 'petrol' | 'diesel' | 'hybrid' | 'electric';

export interface NzTaxYear {
  year: number;
  /** Kilometre rates, tenths of a cent a km. Tier 1 covers the business share of the car's first 14,000 km. */
  kmRates: Record<NzFuel, { tier1: number; tier2: number }>;
  /** False until IRD publishes the year's rates (the last ones are used). */
  kmSet: boolean;
  tier1Km: number;
  /** Home office square metre rate (utilities), cents a m². */
  homeOfficePerSqm: number;
  homeOfficeSet: boolean;
  /** Assets costing this or less can be expensed (GST-exclusive when registered), cents. */
  lowValueAsset: number;
  /** GST registration threshold, cents. */
  gstThreshold: number;
  /** Provisional tax: residual income tax over this, and the standard method's uplifts. */
  provisionalThreshold: number;
  upliftPct: number;
  upliftTwoYearsPct: number;
  /** Individual income tax: the rate on income above each threshold (cents). */
  brackets: { over: number; pct: number }[];
  sources: string[];
  checked: string;
}

const BRACKETS_OLD = [
  { over: 0, pct: 10.5 },
  { over: 1_400_000, pct: 17.5 },
  { over: 4_800_000, pct: 30 },
  { over: 7_000_000, pct: 33 },
  { over: 18_000_000, pct: 39 },
];
// From 31 July 2024. 2024-25 itself was taxed at composite rates between the two; these are close.
const BRACKETS_2025 = [
  { over: 0, pct: 10.5 },
  { over: 1_560_000, pct: 17.5 },
  { over: 5_350_000, pct: 30 },
  { over: 7_810_000, pct: 33 },
  { over: 18_000_000, pct: 39 },
];

const COMMON = {
  tier1Km: 14_000,
  lowValueAsset: 100_000,
  gstThreshold: 6_000_000,
  provisionalThreshold: 500_000,
  upliftPct: 5,
  upliftTwoYearsPct: 10,
  checked: '2026-11-03',
};

const KM = 'https://www.ird.govt.nz/income-tax/income-tax-for-businesses-and-organisations/types-of-business-expenses/claiming-vehicle-expenses';

export const NZ_TAX_YEARS: Record<number, NzTaxYear> = {
  2024: {
    ...COMMON,
    year: 2024,
    kmRates: { petrol: { tier1: 1040, tier2: 350 }, diesel: { tier1: 1040, tier2: 350 }, hybrid: { tier1: 1040, tier2: 210 }, electric: { tier1: 1040, tier2: 120 } },
    kmSet: true,
    homeOfficePerSqm: 5_310,
    homeOfficeSet: true,
    brackets: BRACKETS_OLD,
    sources: [`${KM}/kilometre-rates-2023-2024`, 'https://www.ird.govt.nz/home-office-expenses'],
  },
  2025: {
    ...COMMON,
    year: 2025,
    kmRates: { petrol: { tier1: 1170, tier2: 370 }, diesel: { tier1: 1260, tier2: 350 }, hybrid: { tier1: 860, tier2: 210 }, electric: { tier1: 1080, tier2: 190 } },
    kmSet: true,
    homeOfficePerSqm: 5_560,
    homeOfficeSet: true,
    brackets: BRACKETS_2025,
    sources: [`${KM}/kilometre-rates-2024-2025`, 'https://www.ird.govt.nz/home-office-expenses'],
  },
  2026: {
    ...COMMON,
    year: 2026,
    kmRates: { petrol: { tier1: 1200, tier2: 370 }, diesel: { tier1: 1300, tier2: 380 }, hybrid: { tier1: 900, tier2: 240 }, electric: { tier1: 1220, tier2: 230 } },
    kmSet: true,
    homeOfficePerSqm: 5_730,
    homeOfficeSet: true,
    brackets: BRACKETS_2025,
    sources: [`${KM}/kilometre-rates-2025-2026`, 'https://www.ird.govt.nz/updates/news-folder/2026/square-metre-rate-for-home-office-calculations-2026'],
  },
  2027: {
    ...COMMON,
    year: 2027,
    // Not published yet: IRD says to keep using 2025-26's until it does.
    kmRates: { petrol: { tier1: 1200, tier2: 370 }, diesel: { tier1: 1300, tier2: 380 }, hybrid: { tier1: 900, tier2: 240 }, electric: { tier1: 1220, tier2: 230 } },
    kmSet: false,
    homeOfficePerSqm: 5_730,
    homeOfficeSet: false,
    brackets: BRACKETS_2025,
    sources: ['https://www.ird.govt.nz/updates/news-folder/2026/2025-2026-kilometre-rate-guidance'],
  },
};

const YEARS = Object.keys(NZ_TAX_YEARS).map(Number).sort((a, b) => a - b);

export function nzTaxYear(year: number): { rules: NzTaxYear; status: 'checked' | 'unchecked' | 'before' } {
  const known = NZ_TAX_YEARS[year];
  if (known) return { rules: known, status: known.kmSet && known.homeOfficeSet ? 'checked' : 'unchecked' };
  const before = year < YEARS[0];
  const near = NZ_TAX_YEARS[before ? YEARS[0] : YEARS[YEARS.length - 1]];
  return { rules: { ...near, year, kmSet: false, homeOfficeSet: false }, status: before ? 'before' : 'unchecked' };
}
