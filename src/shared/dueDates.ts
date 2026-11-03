// When things are due with the ATO and IRD: BAS and GST returns, PAYG
// instalments, NZ provisional tax, the TPAR. Dates that land on a weekend
// move to the next weekday. Public holidays aren't known here, so a date on
// one can be a day later in practice.

const pad = (n: number) => String(n).padStart(2, '0');

function addDays(date: string, n: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Saturday and Sunday move to Monday. */
export function nextWeekday(date: string) {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 6 ? addDays(date, 2) : day === 0 ? addDays(date, 1) : date;
}

/** The month after `periodEnd`'s, as [year, month 1–12]. */
function monthAfter(periodEnd: string): [number, number] {
  const y = Number(periodEnd.slice(0, 4));
  const m = Number(periodEnd.slice(5, 7));
  return m === 12 ? [y + 1, 1] : [y, m + 1];
}

/**
 * Australia, lodging yourself: a quarterly BAS is due the 28th of the month
 * after the quarter, except October–December, due 28 February. Monthly is the
 * 21st of the next month. An annual GST return is due 31 October (or with
 * the tax return, if you don't have to lodge one).
 */
export function basDue(periodStart: string, periodEnd: string): string {
  const months = (Number(periodEnd.slice(0, 4)) - Number(periodStart.slice(0, 4))) * 12 + Number(periodEnd.slice(5, 7)) - Number(periodStart.slice(5, 7)) + 1;
  const [y, m] = monthAfter(periodEnd);
  if (months >= 12) return nextWeekday(`${periodEnd.slice(0, 4)}-10-31`);
  if (months === 1) return nextWeekday(`${y}-${pad(m)}-21`);
  if (periodEnd.slice(5) === '12-31') return nextWeekday(`${y}-02-28`);
  return nextWeekday(`${y}-${pad(m)}-28`);
}

/**
 * New Zealand: a GST return is due the 28th of the month after the period,
 * except a period ending in March (7 May) or November (15 January).
 */
export function nzGstDue(periodEnd: string): string {
  const [y, m] = monthAfter(periodEnd);
  const ending = Number(periodEnd.slice(5, 7));
  if (ending === 3) return nextWeekday(`${y}-05-07`);
  if (ending === 11) return nextWeekday(`${y + 1}-01-15`);
  return nextWeekday(`${y}-${pad(m)}-28`);
}

/**
 * Australia's quarterly PAYG instalments, for the income year ending 30 June
 * `year`: with the BAS for each quarter (28 October, 28 February, 28 April,
 * 28 July).
 */
export function paygDue(year: number): string[] {
  return [`${year - 1}-10-28`, `${year}-02-28`, `${year}-04-28`, `${year}-07-28`].map(nextWeekday);
}

/**
 * New Zealand provisional tax, standard method, for the income year ending
 * 31 March `year`: 28 August, 15 January, 7 May.
 */
export function provisionalDue(year: number): string[] {
  return [`${year - 1}-08-28`, `${year}-01-15`, `${year}-05-07`].map(nextWeekday);
}

/** NZ terminal tax: 7 February after the year (7 April with a tax agent). */
export function terminalTaxDue(year: number, agent = false): string {
  return nextWeekday(agent ? `${year + 1}-04-07` : `${year + 1}-02-07`);
}

/** Australia's TPAR, for the income year ending 30 June `year`: 28 August. */
export function tparDue(year: number): string {
  return nextWeekday(`${year}-08-28`);
}
