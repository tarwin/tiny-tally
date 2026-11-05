import { reactive } from 'vue';
import type { DateFormat } from '../shared/countries';

/** Today as YYYY-MM-DD in the user's own clock (not UTC). */
export function today() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The open books' date format (lib/session.ts keeps it in step). Reactive, so dates redraw when it changes. */
export const dateDisplay = reactive({ format: null as DateFormat | null });

/** What each format means in a date field, where you type a date. */
export const DATE_FIELD_FORMATS: Record<DateFormat, string> = { dmy: 'DD/MM/YYYY', mdy: 'MM/DD/YYYY', ymd: 'YYYY-MM-DD' };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** With no books open there's no choice to follow, so the device's language decides. */
export function formatDay(iso: string, format = dateDisplay.format) {
  const [y, m, d] = iso.split('-').map(Number);
  if (format === 'ymd') return iso.slice(0, 10);
  if (format === 'dmy') return `${d} ${MONTHS[m - 1]} ${y}`;
  if (format === 'mdy') return `${MONTHS[m - 1]} ${d}, ${y}`;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** For tight table columns: the year is dropped when it's this year. */
export function formatShortDay(iso: string, format = dateDisplay.format) {
  const [y, m, d] = iso.split('-').map(Number);
  const sameYear = y === new Date().getFullYear();
  if (format === 'ymd') return sameYear ? iso.slice(5, 10) : iso.slice(0, 10);
  if (format === 'dmy') return `${d} ${MONTHS[m - 1]}${sameYear ? '' : ` ${String(y).slice(2)}`}`;
  if (format === 'mdy') return `${MONTHS[m - 1]} ${d}${sameYear ? '' : `, ${String(y).slice(2)}`}`;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: '2-digit' });
}

export function addDays(iso: string, n: number) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  const pad = (v: number) => String(v).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

export function daysUntil(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  const now = new Date();
  const a = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((Date.UTC(y, m - 1, d) - a) / 86400000);
}
