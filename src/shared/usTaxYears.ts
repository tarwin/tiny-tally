// US federal figures that change by tax year: the 1099 threshold, the
// standard mileage rate, the Social Security wage base, the simplified home
// office rate and the estimated tax due dates. One entry per tax year, each
// saying what it was checked against. Add next year's entry once the IRS
// publishes it (usually October to December); until then the newest year's
// figures are used and the page says so.
//
// Money is in cents. Mileage rates are in tenths of a cent (72.5¢ → 725),
// since the IRS sets them to half a cent.
import type { RuleStatus } from './taxReturns';

export interface UsTaxYear {
  year: number;
  /** Form 1099-NEC: report a payee paid this much or more in the year. */
  nec1099Threshold: number;
  /** When 1099-NECs go to payees and the IRS (Jan 31 the next year, moved off a weekend). */
  nec1099Due: string;
  /** Business standard mileage rate, from each date (the IRS changed it mid-2026). */
  mileage: { from: string; tenthsOfCent: number }[];
  /** Social Security tax stops at this much self-employment income (with any wages). */
  socialSecurityWageBase: number;
  /** Simplified home office method: per square foot, up to a number of square feet. */
  homeOffice: { perSqFt: number; maxSqFt: number };
  /** De minimis safe harbor for expensing equipment, per item (without an audited financial statement). */
  deMinimis: number;
  /** Form 1040-ES due dates, moved off weekends and holidays. */
  estimatedDue: [string, string, string, string];
  /** What it was checked against, and when. */
  sources: string[];
  checked: string;
}

/** Oldest first. */
export const US_TAX_YEARS: UsTaxYear[] = [
  {
    year: 2024,
    nec1099Threshold: 60_000,
    nec1099Due: '2025-01-31',
    mileage: [{ from: '2024-01-01', tenthsOfCent: 670 }],
    socialSecurityWageBase: 16_860_000,
    homeOffice: { perSqFt: 500, maxSqFt: 300 },
    deMinimis: 250_000,
    estimatedDue: ['2024-04-15', '2024-06-17', '2024-09-16', '2025-01-15'],
    sources: ['IRS Notice 2024-08 (mileage)', 'SSA 2024 contribution and benefit base', 'Instructions for Form 1099-NEC (2024)', 'Form 1040-ES (2024)'],
    checked: '2026-11-03',
  },
  {
    year: 2025,
    nec1099Threshold: 60_000,
    // Jan 31, 2026 is a Saturday.
    nec1099Due: '2026-02-02',
    mileage: [{ from: '2025-01-01', tenthsOfCent: 700 }],
    socialSecurityWageBase: 17_610_000,
    homeOffice: { perSqFt: 500, maxSqFt: 300 },
    deMinimis: 250_000,
    estimatedDue: ['2025-04-15', '2025-06-16', '2025-09-15', '2026-01-15'],
    sources: ['IRS Notice 2025-5 (mileage)', 'SSA 2025 contribution and benefit base', 'Instructions for Form 1099-NEC (2025)', 'Form 1040-ES (2025)'],
    checked: '2026-11-03',
  },
  {
    year: 2026,
    // Public Law 119-21 §70433: $2,000 for payments made after 2025, indexed from 2027.
    nec1099Threshold: 200_000,
    // Jan 31, 2027 is a Sunday.
    nec1099Due: '2027-02-01',
    // Notice 2026-10, then Announcement 2026-11 for miles driven from July 1.
    mileage: [
      { from: '2026-01-01', tenthsOfCent: 725 },
      { from: '2026-07-01', tenthsOfCent: 760 },
    ],
    socialSecurityWageBase: 18_450_000,
    homeOffice: { perSqFt: 500, maxSqFt: 300 },
    deMinimis: 250_000,
    estimatedDue: ['2026-04-15', '2026-06-15', '2026-09-15', '2027-01-15'],
    sources: [
      'IRS Notice 2026-10 and Announcement 2026-11 (mileage)',
      'SSA 2026 contribution and benefit base',
      'Public Law 119-21 §70433 (1099 threshold)',
      'Form 1040-ES (2026)',
    ],
    checked: '2026-11-03',
  },
];

/** Self-employment tax: on 92.35% of net earnings, 12.4% Social Security up to the wage base and 2.9% Medicare. Set by statute. */
export const SE_TAX = { netEarningsPct: 92.35, socialSecurityPct: 12.4, medicarePct: 2.9, minimumNet: 40_000 };

/** A date moved to the Monday when it falls on a weekend (federal holidays aren't covered). */
export function offWeekend(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const day = d.getUTCDay();
  if (day === 6) d.setUTCDate(d.getUTCDate() + 2);
  if (day === 0) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * The figures for a tax year, and whether this version of the app has them.
 * A year it doesn't have borrows the nearest year's amounts, with that
 * year's own due dates worked out the usual way.
 */
export function usTaxYear(year: number): { rules: UsTaxYear; status: RuleStatus } {
  const exact = US_TAX_YEARS.find((y) => y.year === year);
  if (exact) return { rules: exact, status: 'checked' };
  const before = year < US_TAX_YEARS[0].year;
  const near = before ? US_TAX_YEARS[0] : US_TAX_YEARS[US_TAX_YEARS.length - 1];
  const rules: UsTaxYear = {
    ...near,
    year,
    nec1099Due: offWeekend(`${year + 1}-01-31`),
    mileage: [{ from: `${year}-01-01`, tenthsOfCent: near.mileage[near.mileage.length - 1].tenthsOfCent }],
    estimatedDue: [offWeekend(`${year}-04-15`), offWeekend(`${year}-06-15`), offWeekend(`${year}-09-15`), offWeekend(`${year + 1}-01-15`)],
  };
  return { rules, status: before ? 'before' : 'unchecked' };
}

/** The business mileage rate on a day, in tenths of a cent. */
export function mileageRate(date: string): number {
  const { rules } = usTaxYear(Number(date.slice(0, 4)));
  const rate = [...rules.mileage].reverse().find((r) => r.from <= date) ?? rules.mileage[0];
  return rate.tenthsOfCent;
}

/** Miles (in tenths) times the day's rate, in cents. */
export function mileageDeduction(date: string, milesTenths: number): number {
  return Math.round((milesTenths * mileageRate(date)) / 100);
}

/** Self-employment tax on a year's net profit (cents), before the deduction for half of it. */
export function selfEmploymentTax(netProfit: number, year: number, wages = 0): { tax: number; netEarnings: number } {
  const { rules } = usTaxYear(year);
  const netEarnings = Math.round((Math.max(0, netProfit) * SE_TAX.netEarningsPct) / 100);
  if (netEarnings < SE_TAX.minimumNet) return { tax: 0, netEarnings };
  const ssBase = Math.max(0, Math.min(netEarnings, rules.socialSecurityWageBase - wages));
  const tax = Math.round((ssBase * SE_TAX.socialSecurityPct) / 100 + (netEarnings * SE_TAX.medicarePct) / 100);
  return { tax, netEarnings };
}

/** Simplified home office deduction (cents) for square feet used. */
export function homeOfficeDeduction(sqFt: number, year: number): number {
  const { rules } = usTaxYear(year);
  return Math.max(0, Math.min(Math.floor(sqFt), rules.homeOffice.maxSqFt)) * rules.homeOffice.perSqFt;
}
