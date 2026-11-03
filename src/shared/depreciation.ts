// Depreciation of business assets for the tax return, by country. Works one
// income year at a time from the year each asset was bought (or the year its
// figures were brought in from), so the value at the start of any year is
// what's left after the years before.
//
// Australia (ATO):
//   writeoff  the instant asset write-off: all of it in the year it's first used
//             (small businesses, under the year's limit; auTaxYears.ts)
//   pool      the small business pool: 15% in the year it goes in, 30% a year
//             after; once the pool's balance at year end (before that year's
//             depreciation) is under the write-off limit, all of it goes
//   dv        diminishing value: value × days held / days in year × 200% / effective life
//   pc        prime cost: cost × days held / days in year × 100% / effective life
// New Zealand (IRD):
//   writeoff  a low-value asset (under the year's limit; nzTaxYears.ts)
//   dv        diminishing value at IRD's rate, × months owned / 12
//   sl        straight line at IRD's rate, on cost, × months owned / 12
//   No depreciation in the year it's sold.
// United States (IRS Pub 946):
//   expense   section 179, bonus depreciation, or the $2,500 de minimis safe
//             harbor: all of it in the year it's placed in service
//   macrs5    5-year property (computers, cars, light trucks), 200% DB, half-year
//   macrs7    7-year property (office furniture, most equipment), 200% DB, half-year
//   sl        straight line over its life, half-year convention
//
// Selling or scrapping an asset: the difference between what you got and its
// value left is a balancing adjustment (AU), depreciation recovered or a loss
// (NZ), or a gain or loss on Form 4797 (US). A gain is capped at the
// depreciation claimed: anything over the cost is a capital gain.
//
// Business use under 100%: only that share is claimed. The value still goes
// down by the full amount.

import { incomeYearOf, incomeYearRange } from './incomeYear';

export type Country = 'AU' | 'NZ' | 'US';
export type Method = 'writeoff' | 'pool' | 'dv' | 'pc' | 'sl' | 'expense' | 'macrs5' | 'macrs7';

export const METHODS: Record<Country, { value: Method; label: string; help: string; needs?: 'life' | 'rate' }[]> = {
  AU: [
    { value: 'writeoff', label: 'Instant asset write-off', help: 'Small businesses: all of it this year, if it costs less than the limit.' },
    { value: 'pool', label: 'Small business pool', help: '15% the first year, then 30% a year.' },
    { value: 'dv', label: 'Diminishing value', help: '200% ÷ effective life, on the value left.', needs: 'life' },
    { value: 'pc', label: 'Prime cost', help: '100% ÷ effective life, on the cost.', needs: 'life' },
  ],
  NZ: [
    { value: 'writeoff', label: 'Low-value asset', help: 'All of it this year, if it costs less than the limit.' },
    { value: 'dv', label: 'Diminishing value', help: 'IRD’s rate for the asset, on the value left.', needs: 'rate' },
    { value: 'sl', label: 'Straight line', help: 'IRD’s rate for the asset, on the cost.', needs: 'rate' },
  ],
  US: [
    { value: 'expense', label: 'Section 179 / bonus / de minimis', help: 'All of it in the year it’s placed in service.' },
    { value: 'macrs5', label: 'MACRS 5-year', help: 'Computers, cars, light trucks.' },
    { value: 'macrs7', label: 'MACRS 7-year', help: 'Office furniture and most equipment.' },
    { value: 'sl', label: 'Straight line', help: 'Evenly over its life, half a year the first year.', needs: 'life' },
  ],
};

/** IRS Pub 946 Table A-1: 200% declining balance, half-year convention (percent of cost). */
const MACRS: Record<'macrs5' | 'macrs7', number[]> = {
  macrs5: [20, 32, 19.2, 11.52, 11.52, 5.76],
  macrs7: [14.29, 24.49, 17.49, 12.49, 8.93, 8.92, 8.93, 4.46],
};

export interface AssetIn {
  id: number;
  name: string;
  /** When bought (or first used / placed in service). */
  bought: string;
  /** Cents; before GST when registered. */
  cost: number;
  businessPct: number;
  method: Method;
  /** AU dv/pc and US sl: the effective life or recovery period. */
  lifeYears?: number | null;
  /** NZ dv/sl: IRD's rate, percent. */
  ratePct?: number | null;
  /** For an asset bought before these books: its value at the start of `openingYear`. */
  openingYear?: number | null;
  openingValue?: number | null;
  sold?: string | null;
  /** Cents; before GST when registered. */
  proceeds?: number | null;
}

export interface AssetYear {
  id: number;
  name: string;
  method: Method;
  /** Value at the start of the year (or the cost, the year it's bought). */
  opening: number;
  depreciation: number;
  /** The business share of `depreciation`: what's claimed. */
  claimed: number;
  closing: number;
  /** Sold or scrapped this year. */
  disposal: null | {
    date: string;
    proceeds: number;
    /** Value left when it went. */
    value: number;
    /** proceeds − value: more than zero is income (capped at the depreciation claimed), less is a deduction. */
    adjustment: number;
    /** The business share of `adjustment`. */
    claimed: number;
  };
  /** Bought this year. */
  isNew: boolean;
}

export interface Limits {
  /** AU instant asset write-off, NZ low-value asset limit (cents, under). */
  writeOff: number;
}

const DAY = 86_400_000;
const days = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY) + 1;
/** Months from the month of `from` to the month of `to`, both counted. */
const months = (from: string, to: string) =>
  (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7)) + 1;

export function rateOf(country: Country, a: Pick<AssetIn, 'method' | 'lifeYears' | 'ratePct'>): number {
  if (country === 'NZ') return (a.ratePct ?? 0) / 100;
  if (a.method === 'dv') return a.lifeYears ? 2 / a.lifeYears : 0;
  if (a.method === 'pc' || a.method === 'sl') return a.lifeYears ? 1 / a.lifeYears : 0;
  return 0;
}

/** Each asset's figures for income year `year`, working through the years before it. */
export function depreciationYear(
  country: Country,
  assets: AssetIn[],
  year: number,
  yearStart: string,
  limits: (year: number) => Limits,
): AssetYear[] {
  const firstYear = (a: AssetIn) => a.openingYear ?? incomeYearOf(a.bought, yearStart);
  const start = Math.min(year, ...assets.map(firstYear));
  // Value left of each asset, and how many years it's been depreciated (for MACRS).
  const value = new Map<number, number>();
  let out: AssetYear[] = [];
  for (let y = start; y <= year; y++) {
    const { from, to } = incomeYearRange(y, yearStart);
    const inYear = days(from, to);
    out = [];
    for (const a of assets) {
      const first = firstYear(a);
      if (first > y) continue;
      const soldYear = a.sold ? incomeYearOf(a.sold, yearStart) : null;
      if (soldYear != null && soldYear < y) continue;
      const isNew = first === y && a.openingYear == null;
      const opening = first === y ? (a.openingYear != null ? (a.openingValue ?? a.cost) : a.cost) : value.get(a.id) ?? 0;
      // Fully depreciated and still kept: nothing more to show until it's sold.
      if (first !== y && opening === 0 && soldYear !== y) continue;
      const held = isNew && a.bought > from ? a.bought : from;
      const until = soldYear === y ? a.sold! : to;
      const yearIndex = y - incomeYearOf(a.bought, yearStart);
      const rate = rateOf(country, a);
      let dep = 0;
      switch (a.method) {
        case 'writeoff':
        case 'expense':
          dep = isNew ? opening : 0;
          break;
        case 'pool':
          dep = opening * (isNew ? 0.15 : 0.3);
          break;
        case 'dv':
          dep = country === 'NZ' ? opening * rate * (months(held, to) / 12) : opening * rate * (days(held, until) / inYear);
          break;
        case 'pc':
          dep = a.cost * rate * (days(held, until) / inYear);
          break;
        case 'sl':
          dep = country === 'NZ' ? a.cost * rate * (months(held, to) / 12) : a.cost * rate * (isNew || soldYear === y ? 0.5 : 1);
          break;
        case 'macrs5':
        case 'macrs7': {
          const pct = MACRS[a.method][yearIndex] ?? 0;
          dep = a.cost * (pct / 100) * (soldYear === y && yearIndex > 0 ? 0.5 : 1);
          break;
        }
      }
      // NZ: none in the year it's sold. Pools in AU: proceeds come off the pool instead.
      if (soldYear === y && (country === 'NZ' || a.method === 'pool')) dep = 0;
      dep = Math.max(0, Math.min(opening, Math.round(dep)));
      const closing = opening - dep;
      const pct = Math.max(0, Math.min(100, a.businessPct)) / 100;
      let disposal: AssetYear['disposal'] = null;
      if (soldYear === y) {
        const proceeds = a.proceeds ?? 0;
        // A gain stops at the cost: anything more is a capital gain.
        const adjustment = Math.min(proceeds, a.cost) - closing;
        disposal = { date: a.sold!, proceeds, value: closing, adjustment, claimed: Math.round(adjustment * pct) };
      }
      out.push({ id: a.id, name: a.name, method: a.method, opening, depreciation: dep, claimed: Math.round(dep * pct), closing: disposal ? 0 : closing, disposal, isNew });
      value.set(a.id, disposal ? 0 : closing);
    }
    // AU pool: when its balance at year end, before the year's depreciation, is
    // under the write-off limit, all of it goes.
    if (country === 'AU') {
      const pool = out.filter((r) => r.method === 'pool' && !r.disposal);
      const left = pool.reduce((t, r) => t + r.opening, 0);
      if (left > 0 && left < limits(y).writeOff) {
        for (const r of pool) {
          const a = assets.find((x) => x.id === r.id)!;
          const pct = Math.max(0, Math.min(100, a.businessPct)) / 100;
          r.depreciation = r.opening;
          r.claimed = Math.round(r.depreciation * pct);
          r.closing = 0;
          value.set(r.id, 0);
        }
      }
    }
  }
  return out;
}
