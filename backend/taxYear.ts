// What's typed in once an income year and kept with the books: the car
// method and its logbook figures, home office, and what income tax
// instalments are worked out from. Keyed by the year the income year ends in
// (src/shared/incomeYear.ts). Each country uses its own fields.
import { getBooks, run } from './db';
import { metaValue } from './settings';

export type Fuel = 'petrol' | 'diesel' | 'hybrid' | 'electric';

export interface VehicleInputs {
  totalTenths?: number;
  businessPct?: number;
  fuel?: Fuel;
}

export interface YearInputs {
  // ---- car ----
  /** The rate per mile or km for the trips logged, or actual costs times the business share. Default: the rate once there are trips. */
  vehicleMethod?: 'rate' | 'actual';
  /** All the car's distance in the year, business and private, in tenths (from the odometer). */
  vehicleTotalTenths?: number;
  /** Business use from a logbook, percent. Default: logged trips over the total. */
  vehicleBusinessPct?: number;
  /** NZ kilometre rates depend on the fuel. */
  vehicleFuel?: Fuel;
  /**
   * The same three per vehicle, by the name on its trips ('' for trips with
   * none). Australia's 5,000 km and NZ's 14,000 km apply to each car. The
   * fields above are used for a car with nothing of its own here when it's
   * the only one.
   */
  vehicles?: Record<string, VehicleInputs>;

  // ---- home office ----
  /** US simplified method: square feet. */
  homeOfficeSqFt?: number;
  /** Australia's fixed rate method: hours worked from home. */
  homeOfficeHours?: number;
  /** NZ: the office's area and the whole home's, m², and the year's premises costs (rates, insurance, mortgage interest or rent), cents. */
  homeOfficeArea?: number;
  homeArea?: number;
  premisesCosts?: number;

  // ---- income tax instalments ----
  /** US: income tax to set aside, percent of profit after half the self-employment tax. NZ estimation: the same, of profit. */
  incomeTaxPct?: number;
  /** Last year's tax (US total tax; NZ residual income tax), cents. */
  priorYearTax?: number;
  /** NZ: residual income tax two years back, for when last year's return isn't filed yet. */
  twoYearsAgoTax?: number;
  /** US: last year's AGI over $150,000, so the safe harbor is 110%. */
  priorYearHighIncome?: boolean;
  /** US: wages from a job, which use up the Social Security wage base first. */
  wages?: number;
  /** NZ: standard (uplift) or estimation. */
  provisionalMethod?: 'standard' | 'estimation';
  /** NZ estimation: the residual income tax you expect, cents. */
  estimate?: number;
  /** Australia: pay the amount on the ATO's notice, or the instalment rate times instalment income. */
  paygOption?: 'amount' | 'rate';
  /** Australia: the instalment rate, percent. */
  paygRatePct?: number;
  /** Australia: the quarterly instalment amount from the ATO, cents. */
  paygAmount?: number;
}

const KEY = 'tax_year_inputs';

function everyYear(): Record<string, YearInputs> {
  try {
    const v = JSON.parse(metaValue(KEY) ?? '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

export function yearOf(v: unknown) {
  const y = Math.round(Number(v));
  if (!Number.isInteger(y) || y < 2000 || y > 2100) throw new Error('Pick a tax year.');
  return y;
}

export function yearInputs(year: number): YearInputs {
  return everyYear()[String(year)] ?? {};
}

const num = (v: unknown, max: number, what: string) => {
  if (v === null || v === '' || v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > max) throw new Error(`Enter ${what}.`);
  return n;
};
const oneOf = <T extends string>(v: unknown, values: T[]) => (values.includes(v as T) ? (v as T) : undefined);

/**
 * Changes the fields given; null or '' clears one. With `vehicle`, the car
 * fields (vehicleTotalTenths, vehicleBusinessPct, vehicleFuel) are that
 * vehicle's.
 */
export function setYearInputs(p: { year: number; vehicle?: string | null } & { [K in keyof YearInputs]?: YearInputs[K] | null }) {
  const year = yearOf(p.year);
  const now: YearInputs = { ...yearInputs(year) };
  if (typeof p.vehicle === 'string') {
    const name = p.vehicle.trim();
    const v: VehicleInputs = { ...now.vehicles?.[name] };
    if ('vehicleTotalTenths' in p) v.totalTenths = num(p.vehicleTotalTenths, 10_000_000, 'the distance driven in the year');
    if ('vehicleBusinessPct' in p) v.businessPct = num(p.vehicleBusinessPct, 100, 'a percent between 0 and 100');
    if ('vehicleFuel' in p) v.fuel = oneOf(p.vehicleFuel, ['petrol', 'diesel', 'hybrid', 'electric']);
    now.vehicles = { ...now.vehicles, [name]: v };
    p = { year: p.year, ...('vehicleMethod' in p ? { vehicleMethod: p.vehicleMethod } : {}) };
  }
  const has = (k: keyof YearInputs) => k in p;
  if (has('vehicleMethod')) now.vehicleMethod = oneOf(p.vehicleMethod, ['rate', 'actual']);
  if (has('vehicleTotalTenths')) now.vehicleTotalTenths = num(p.vehicleTotalTenths, 10_000_000, 'the distance driven in the year');
  if (has('vehicleBusinessPct')) now.vehicleBusinessPct = num(p.vehicleBusinessPct, 100, 'a percent between 0 and 100');
  if (has('vehicleFuel')) now.vehicleFuel = oneOf(p.vehicleFuel, ['petrol', 'diesel', 'hybrid', 'electric']);
  if (has('homeOfficeSqFt')) now.homeOfficeSqFt = num(p.homeOfficeSqFt, 100_000, 'the square feet used');
  if (has('homeOfficeHours')) now.homeOfficeHours = num(p.homeOfficeHours, 8_784, 'the hours worked from home');
  if (has('homeOfficeArea')) now.homeOfficeArea = num(p.homeOfficeArea, 100_000, "the office's area");
  if (has('homeArea')) now.homeArea = num(p.homeArea, 100_000, "the home's area");
  if (has('premisesCosts')) now.premisesCosts = num(p.premisesCosts, 1e12, 'the premises costs');
  if (has('incomeTaxPct')) now.incomeTaxPct = num(p.incomeTaxPct, 60, 'a percent between 0 and 60');
  if (has('priorYearTax')) now.priorYearTax = num(p.priorYearTax, 1e12, "last year's tax");
  if (has('twoYearsAgoTax')) now.twoYearsAgoTax = num(p.twoYearsAgoTax, 1e12, 'the tax two years ago');
  if (has('priorYearHighIncome')) now.priorYearHighIncome = !!p.priorYearHighIncome || undefined;
  if (has('wages')) now.wages = num(p.wages, 1e12, 'your wages');
  if (has('provisionalMethod')) now.provisionalMethod = oneOf(p.provisionalMethod, ['standard', 'estimation']);
  if (has('estimate')) now.estimate = num(p.estimate, 1e12, 'your estimate');
  if (has('paygOption')) now.paygOption = oneOf(p.paygOption, ['amount', 'rate']);
  if (has('paygRatePct')) now.paygRatePct = num(p.paygRatePct, 100, 'the instalment rate');
  if (has('paygAmount')) now.paygAmount = num(p.paygAmount, 1e12, 'the instalment amount');
  if (now.homeOfficeArea && now.homeArea && now.homeOfficeArea > now.homeArea) throw new Error("The office can't be bigger than the home.");
  const every = everyYear();
  every[String(year)] = JSON.parse(JSON.stringify(now));
  run(getBooks().db, 'INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', KEY, JSON.stringify(every));
  return yearInputs(year);
}
