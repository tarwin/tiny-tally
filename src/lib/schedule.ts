import type { Frequency } from './api';

export const FREQUENCY_OPTIONS: { label: string; value: Frequency }[] = [
  { label: 'Every week', value: 'weekly' },
  { label: 'Every 2 weeks', value: 'fortnightly' },
  { label: 'Every month', value: 'monthly' },
  { label: 'Every 3 months', value: 'quarterly' },
  { label: 'Every year', value: 'yearly' },
];

export const FREQUENCY_LABEL: Record<Frequency, string> = Object.fromEntries(FREQUENCY_OPTIONS.map((o) => [o.value, o.label])) as any;

function fmt(y: number, m: number, d: number) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** One period after `iso` (month-end safe), matching the backend's schedule maths. */
export function nextOccurrence(iso: string, f: Frequency) {
  const [y, m, d] = iso.split('-').map(Number);
  if (f === 'weekly' || f === 'fortnightly') {
    const dt = new Date(Date.UTC(y, m - 1, d + (f === 'weekly' ? 7 : 14)));
    return dt.toISOString().slice(0, 10);
  }
  const months = f === 'monthly' ? 1 : f === 'quarterly' ? 3 : 12;
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return fmt(ny, nm, Math.min(d, last));
}
