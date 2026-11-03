// The trip log: business trips by car, in the books' own unit (miles in the
// US, km in Australia and New Zealand). What they're worth is worked out per
// country in src/shared/carRates.ts: the US standard mileage rate for the day,
// Australia's cents per km (up to 5,000 km), New Zealand's two-tier
// kilometre rates. The log also gives the business-use share of the car,
// against the year's total distance from the odometer.
import { all, getBooks, one, run } from './db';
import { getSettings } from './settings';
import { yearInputs } from './taxYear';
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

/** The year's car figures from the trip log and the year's inputs: the rate claim, the business share. */
export function carYear(year: number) {
  const s = getSettings();
  const { from, to } = incomeYearRange(year, s.fiscalYearStart);
  const trips = tripsIn(from, to);
  const inputs = yearInputs(year);
  const distanceTenths = trips.reduce((t, x) => t + x.distanceTenths, 0);
  const claim = carClaim(s.country, year, trips, inputs);
  const loggedPct = inputs.vehicleTotalTenths ? Math.min(100, Math.round((distanceTenths * 1000) / inputs.vehicleTotalTenths) / 10) : null;
  const businessPct = inputs.vehicleBusinessPct ?? loggedPct;
  const method: 'rate' | 'actual' = inputs.vehicleMethod ?? (distanceTenths > 0 ? 'rate' : 'actual');
  return { year, from, to, unit: distanceUnit(s.country), trips, distanceTenths, claim, method, businessPct, loggedPct, inputs };
}

export function listTrips(p: { from: string; to: string }) {
  if (!DATE.test(p.from) || !DATE.test(p.to)) throw new Error('Pick a date range.');
  const s = getSettings();
  const inputs = (date: string) => yearInputs(incomeYearOf(date, s.fiscalYearStart));
  const trips = tripsIn(p.from, p.to).map((t) => {
    const rate = tripRate(s.country, t.date, s.fiscalYearStart, inputs(t.date));
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
