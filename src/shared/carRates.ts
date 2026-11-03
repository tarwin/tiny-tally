// What business driving is worth in each country, from the trip log:
//
// - US: the IRS standard mileage rate for the day driven (usTaxYears.ts).
// - Australia: the cents per kilometre rate for the income year, on up to
//   5,000 business km per car (auTaxYears.ts).
// - New Zealand: IRD's kilometre rates. The Tier 1 rate covers the business
//   share of the first 14,000 km the car travels in the year; business km
//   past that are at the Tier 2 rate (nzTaxYears.ts).
import type { Country } from './countries';
import { incomeYearOf } from './incomeYear';
import { mileageRate, usTaxYear } from './usTaxYears';
import { auTaxYear } from './auTaxYears';
import { nzTaxYear, type NzFuel } from './nzTaxYears';

type RuleStatus = 'checked' | 'unchecked' | 'before';

export function distanceUnit(country: Country | string): 'mi' | 'km' {
  return country === 'US' ? 'mi' : 'km';
}

interface Inputs {
  vehicleFuel?: NzFuel;
  vehicleTotalTenths?: number;
}

/** The rate for a trip on `date`, tenths of a cent a mile or km. NZ: the Tier 1 rate for the car's fuel. */
export function tripRate(country: Country | string, date: string, yearStart: string, inputs: Inputs): number {
  if (country === 'US') return mileageRate(date);
  const year = incomeYearOf(date, yearStart);
  if (country === 'NZ') return nzTaxYear(year).rules.kmRates[inputs.vehicleFuel ?? 'petrol'].tier1;
  return auTaxYear(year).rules.centsPerKm;
}

export interface CarClaim {
  deduction: number;
  claimedTenths: number;
  capped: boolean;
  tier1Tenths?: number;
  tier2Tenths?: number;
  rates: { label: string; tenthsOfCent: number }[];
  status: RuleStatus;
  checked: string;
}

/** The rate claim for an income year's trips. */
export function carClaim(country: Country | string, year: number, trips: { date: string; distanceTenths: number }[], inputs: Inputs): CarClaim {
  const total = trips.reduce((s, t) => s + t.distanceTenths, 0);
  if (country === 'US') {
    const y = usTaxYear(year);
    return {
      deduction: trips.reduce((s, t) => s + Math.round((t.distanceTenths * mileageRate(t.date)) / 100), 0),
      claimedTenths: total,
      capped: false,
      rates: y.rules.mileage.map((m, i) => ({ label: i === 0 ? 'From the start of the year' : `From ${m.from}`, tenthsOfCent: m.tenthsOfCent })),
      status: y.status,
      checked: y.rules.checked,
    };
  }
  if (country === 'NZ') {
    const y = nzTaxYear(year);
    const rate = y.rules.kmRates[inputs.vehicleFuel ?? 'petrol'];
    // Tier 1 covers the business share of the first 14,000 km. Without the year's total, all of it is Tier 1 up to the limit.
    const limit = y.rules.tier1Km * 10;
    const tier1 = inputs.vehicleTotalTenths && inputs.vehicleTotalTenths > limit
      ? Math.round((total * limit) / inputs.vehicleTotalTenths)
      : Math.min(total, limit);
    const tier2 = total - tier1;
    return {
      deduction: Math.round((tier1 * rate.tier1 + tier2 * rate.tier2) / 100),
      claimedTenths: total,
      capped: false,
      tier1Tenths: tier1,
      tier2Tenths: tier2,
      rates: [{ label: 'Tier 1', tenthsOfCent: rate.tier1 }, { label: 'Tier 2', tenthsOfCent: rate.tier2 }],
      status: y.status,
      checked: y.rules.checked,
    };
  }
  const y = auTaxYear(year);
  const cap = y.rules.kmCap * 10;
  const claimed = Math.min(total, cap);
  return {
    deduction: Math.round((claimed * y.rules.centsPerKm) / 100),
    claimedTenths: claimed,
    capped: total > cap,
    rates: [{ label: 'Cents per km', tenthsOfCent: y.rules.centsPerKm }],
    status: y.status,
    checked: y.rules.checked,
  };
}
