// The trip log: business trips by car, in the books' own unit (miles in the
// US, km in Australia and New Zealand). What they're worth is worked out per
// country in src/shared/carRates.ts: the US standard mileage rate for the day,
// Australia's cents per km (up to 5,000 km), New Zealand's two-tier
// kilometre rates. The log also gives the business-use share of the car,
// against the year's total distance from the odometer.
import { all, getBooks, one, run } from './db';
import { getSettings } from './settings';
import { yearInputs, type VehicleInputs, type YearInputs } from './taxYear';
import { carClaim, distanceUnit, tripRate } from '../src/shared/carRates';
import { incomeYearOf, incomeYearRange } from '../src/shared/incomeYear';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const clean = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

export interface TripInput {
  id?: number;
  date: string;
  /** Tenths of a mile or km. */
  distanceTenths: number;
  purpose: string;
  fromPlace?: string | null;
  toPlace?: string | null;
  vehicle?: string | null;
}

interface TripRow {
  id: number;
  date: string;
  distanceTenths: number;
  purpose: string;
  fromPlace: string | null;
  toPlace: string | null;
  vehicle: string | null;
}

function tripsIn(from: string, to: string) {
  return all<TripRow>(getBooks().db,
    `SELECT id, date, distance_tenths AS distanceTenths, purpose, from_place AS fromPlace, to_place AS toPlace, vehicle
     FROM trips WHERE date BETWEEN ? AND ? ORDER BY date DESC, id DESC`, from, to);
}

/** A vehicle's own inputs for the year, falling back to the year's when it's the only one. */
export function vehicleInputs(inputs: YearInputs, name: string, only: boolean): VehicleInputs {
  const own = inputs.vehicles?.[name] ?? {};
  const fallback: VehicleInputs = only ? { totalTenths: inputs.vehicleTotalTenths, businessPct: inputs.vehicleBusinessPct, fuel: inputs.vehicleFuel } : {};
  return {
    totalTenths: own.totalTenths ?? fallback.totalTenths,
    businessPct: own.businessPct ?? fallback.businessPct,
    fuel: own.fuel ?? fallback.fuel ?? inputs.vehicleFuel,
  };
}

/**
 * The year's car figures from the trip log and the year's inputs, for each
 * vehicle (by the name on its trips) and together: the rate claim (each car
 * has its own 5,000 km or 14,000 km), the business share.
 */
export function carYear(year: number) {
  const s = getSettings();
  const { from, to } = incomeYearRange(year, s.fiscalYearStart);
  const trips = tripsIn(from, to);
  const inputs = yearInputs(year);
  const names = [...new Set(trips.map((t) => t.vehicle ?? ''))];
  // Vehicles with inputs but no trips yet still show.
  for (const n of Object.keys(inputs.vehicles ?? {})) if (!names.includes(n)) names.push(n);
  if (!names.length) names.push('');
  const only = names.length === 1;
  const vehicles = names.sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b))).map((name) => {
    const own = trips.filter((t) => (t.vehicle ?? '') === name);
    const v = vehicleInputs(inputs, name, only);
    const distanceTenths = own.reduce((t, x) => t + x.distanceTenths, 0);
    const claim = carClaim(s.country, year, own, { vehicleFuel: v.fuel, vehicleTotalTenths: v.totalTenths });
    const loggedPct = v.totalTenths ? Math.min(100, Math.round((distanceTenths * 1000) / v.totalTenths) / 10) : null;
    return { name, trips: own.length, distanceTenths, claim, inputs: v, loggedPct, businessPct: v.businessPct ?? loggedPct };
  });
  const distanceTenths = vehicles.reduce((t, v) => t + v.distanceTenths, 0);
  // Together: the claims added up, and one business share for costs that aren't split by car.
  const first = vehicles[0].claim;
  const claim = {
    ...first,
    deduction: vehicles.reduce((t, v) => t + v.claim.deduction, 0),
    claimedTenths: vehicles.reduce((t, v) => t + v.claim.claimedTenths, 0),
    capped: vehicles.some((v) => v.claim.capped),
    ...(s.country === 'NZ'
      ? { tier1Tenths: vehicles.reduce((t, v) => t + (v.claim.tier1Tenths ?? 0), 0), tier2Tenths: vehicles.reduce((t, v) => t + (v.claim.tier2Tenths ?? 0), 0) }
      : {}),
  };
  const withPct = vehicles.filter((v) => v.businessPct != null);
  const totals = withPct.reduce((t, v) => t + (v.inputs.totalTenths ?? 0), 0);
  const businessPct = !withPct.length ? null
    : withPct.length === 1 ? withPct[0].businessPct
    : totals && withPct.every((v) => v.inputs.totalTenths)
      ? Math.round(withPct.reduce((t, v) => t + v.businessPct! * v.inputs.totalTenths!, 0) / totals * 10) / 10
      : Math.round(withPct.reduce((t, v) => t + v.businessPct!, 0) / withPct.length * 10) / 10;
  const loggedPct = vehicles.length === 1 ? vehicles[0].loggedPct : null;
  const method: 'rate' | 'actual' = inputs.vehicleMethod ?? (distanceTenths > 0 ? 'rate' : 'actual');
  return { year, from, to, unit: distanceUnit(s.country), trips, distanceTenths, claim, method, businessPct, loggedPct, inputs, vehicles };
}

export function listTrips(p: { from: string; to: string }) {
  if (!DATE.test(p.from) || !DATE.test(p.to)) throw new Error('Pick a date range.');
  const s = getSettings();
  const rows = tripsIn(p.from, p.to);
  const inputs = (t: TripRow) => {
    const year = yearInputs(incomeYearOf(t.date, s.fiscalYearStart));
    const v = vehicleInputs(year, t.vehicle ?? '', new Set(rows.map((r) => r.vehicle ?? '')).size === 1);
    return { vehicleFuel: v.fuel };
  };
  const trips = rows.map((t) => {
    const rate = tripRate(s.country, t.date, s.fiscalYearStart, inputs(t));
    return { ...t, rate, value: Math.round((t.distanceTenths * rate) / 100) };
  });
  return {
    unit: distanceUnit(s.country),
    trips,
    distanceTenths: trips.reduce((x, t) => x + t.distanceTenths, 0),
    value: trips.reduce((x, t) => x + t.value, 0),
    vehicles: all<{ vehicle: string }>(getBooks().db, 'SELECT DISTINCT vehicle FROM trips WHERE vehicle IS NOT NULL ORDER BY vehicle').map((v) => v.vehicle),
  };
}

export function saveTrip(t: TripInput) {
  const { db } = getBooks();
  const unit = distanceUnit(getSettings().country) === 'mi' ? 'miles' : 'km';
  if (!DATE.test(String(t.date))) throw new Error('Pick the date of the trip.');
  const tenths = Math.round(Number(t.distanceTenths));
  if (!Number.isFinite(tenths) || tenths <= 0) throw new Error(`Enter the ${unit} driven.`);
  if (tenths > 100_000) throw new Error(`That's more than 10,000 ${unit} in one trip. Check the number.`);
  const purpose = clean(t.purpose);
  if (!purpose) throw new Error('Say what the trip was for. The tax office asks for the business purpose of each trip.');
  const fields = [t.date, tenths, purpose, clean(t.fromPlace), clean(t.toPlace), clean(t.vehicle)];
  if (t.id) {
    if (!one(db, 'SELECT id FROM trips WHERE id = ?', t.id)) throw new Error('That trip no longer exists.');
    run(db, `UPDATE trips SET date = ?, distance_tenths = ?, purpose = ?, from_place = ?, to_place = ?, vehicle = ?,
               updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`, ...fields, t.id);
    return t.id;
  }
  return one<{ id: number }>(db,
    'INSERT INTO trips (date, distance_tenths, purpose, from_place, to_place, vehicle) VALUES (?, ?, ?, ?, ?, ?) RETURNING id',
    ...fields)!.id;
}

export function deleteTrip(id: number) {
  run(getBooks().db, 'DELETE FROM trips WHERE id = ?', id);
  return true;
}

/** US: miles between two dates at the rate for each day (Schedule C line 9, Part IV line 44a). */
export function mileageBetween(from: string, to: string) {
  const s = getSettings();
  const rows = tripsIn(from, to);
  return {
    milesTenths: rows.reduce((x, t) => x + t.distanceTenths, 0),
    deduction: rows.reduce((x, t) => x + Math.round((t.distanceTenths * tripRate(s.country, t.date, s.fiscalYearStart, {})) / 100), 0),
  };
}
