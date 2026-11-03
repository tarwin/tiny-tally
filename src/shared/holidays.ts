// National public holidays, for moving a due date to the next working day.
// Only holidays the whole country gets: state and provincial ones (King's
// Birthday in Queensland and WA, NZ anniversary days) are left out, and IRD
// doesn't move electronic payments for anniversary days anyway.
//
// Australia: New Year's Day, Australia Day, Good Friday, Easter Monday,
// Anzac Day, Christmas Day, Boxing Day (weekend days moved to the Monday or
// Tuesday after, as most states do; Anzac Day isn't moved).
// New Zealand (Holidays Act 2003): New Year's Day and the day after,
// Waitangi Day, Good Friday, Easter Monday, Anzac Day, King's Birthday (first
// Monday in June), Matariki, Labour Day (fourth Monday in October), Christmas
// and Boxing Day, Mondayised.

const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const day = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();
const weekend = (date: string) => day(date) === 0 || day(date) === 6;
function addDays(date: string, n: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}

/** Easter Sunday (Anonymous Gregorian algorithm). */
export function easter(y: number): string {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const dayOf = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(utc(y, month, dayOf));
}

/** The nth Monday of a month (n = 1–5). */
function nthMonday(y: number, month: number, n: number) {
  const first = utc(y, month, 1);
  const offset = (8 - first.getUTCDay()) % 7;
  return iso(utc(y, month, 1 + offset + (n - 1) * 7));
}

/**
 * Holidays that fall together (Christmas and Boxing Day, 1 and 2 January):
 * any on a weekend move to the next weekdays after them not already taken.
 */
function mondayise(dates: string[]): string[] {
  const out = dates.filter((d) => !weekend(d));
  let next = dates[dates.length - 1];
  for (let n = dates.filter(weekend).length; n > 0; n--) {
    do next = addDays(next, 1);
    while (weekend(next) || out.includes(next));
    out.push(next);
  }
  return out;
}

/** NZ's Matariki holiday, set in law for each year (Te Kāhui o Matariki Public Holiday Act 2022, Schedule 1). */
const MATARIKI: Record<number, string> = {
  2022: '2022-06-24', 2023: '2023-07-14', 2024: '2024-06-28', 2025: '2025-06-20', 2026: '2026-07-10',
  2027: '2027-06-25', 2028: '2028-07-14', 2029: '2029-07-06', 2030: '2030-06-21', 2031: '2031-07-11',
  2032: '2032-07-02', 2033: '2033-06-24', 2034: '2034-07-07',
};

const cache = new Map<string, Set<string>>();

export function publicHolidays(country: 'AU' | 'NZ', y: number): Set<string> {
  const key = `${country}${y}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const p = (m: number, d: number) => iso(utc(y, m, d));
  const sunday = easter(y);
  const list = [
    addDays(sunday, -2),
    addDays(sunday, 1),
    p(4, 25),
    ...mondayise([p(12, 25), p(12, 26)]),
  ];
  if (country === 'AU') {
    list.push(...mondayise([p(1, 1)]), ...mondayise([p(1, 26)]));
  } else {
    list.push(...mondayise([p(1, 1), p(1, 2)]), ...mondayise([p(2, 6)]), nthMonday(y, 6, 1), nthMonday(y, 10, 4));
    if (MATARIKI[y]) list.push(MATARIKI[y]);
    // Anzac Day on a weekend is Mondayised in New Zealand.
    if (weekend(p(4, 25))) list.push(...mondayise([p(4, 25)]));
  }
  const set = new Set(list);
  cache.set(key, set);
  return set;
}

/** The date, or the next day that isn't a weekend or national public holiday. */
export function nextWorkingDay(date: string, country: 'AU' | 'NZ'): string {
  let d = date;
  while (weekend(d) || publicHolidays(country, Number(d.slice(0, 4))).has(d)) d = addDays(d, 1);
  return d;
}
