// Income years, named by the year they end in: the US 2026 tax year is
// calendar 2026, Australia's 2026 is 1 July 2025 to 30 June 2026 (2025-26),
// New Zealand's 2026 is 1 April 2025 to 31 March 2026. Worked out from the
// books' financial year start ('MM-DD'), so a non-standard balance date
// lines up too. No Date objects in local time: plain YYYY-MM-DD strings.

const pad = (n: number) => String(n).padStart(2, '0');

function dayBefore(date: string) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** The dates of the income year ending in `year`. */
export function incomeYearRange(year: number, yearStart: string): { from: string; to: string } {
  if (yearStart === '01-01') return { from: `${year}-01-01`, to: `${year}-12-31` };
  const from = `${year - 1}-${yearStart}`;
  return { from, to: dayBefore(`${year}-${yearStart}`) };
}

/** The income year a date falls in. */
export function incomeYearOf(date: string, yearStart: string): number {
  const y = Number(date.slice(0, 4));
  if (yearStart === '01-01') return y;
  return date.slice(5) >= yearStart ? y + 1 : y;
}

/** "2026" for a calendar year, else "2025-26". */
export function incomeYearLabel(year: number, yearStart: string): string {
  return yearStart === '01-01' ? String(year) : `${year - 1}-${pad(year % 100)}`;
}
