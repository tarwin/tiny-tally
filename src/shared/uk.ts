// The UK's VAT: rates, return quarters and the VAT number. Shared by the backend
// and the page, so no tjs:* imports and no Intl here.
// Where the rules came from: docs/TAX-SOURCES.md.

/** 0% and exempt are tax codes, not rates. */
export const VAT_RATES: { ppm: number; label: string }[] = [
  { ppm: 200_000, label: '20%' },
  { ppm: 50_000, label: '5%' },
];

/**
 * HMRC puts each business in one of three sets of quarters. The value is where
 * a year of them starts, in the same 'MM-DD' form as a financial year.
 */
export const VAT_QUARTERS = [
  { value: '01-01', label: 'March, June, September, December' },
  { value: '02-01', label: 'April, July, October, January' },
  { value: '03-01', label: 'May, August, November, February' },
];

export const isVatQuarters = (v: unknown) => VAT_QUARTERS.some((q) => q.value === v);

/** 9 digits, or 12 for a branch, with or without GB in front. null when fine (or empty). */
export function vatNumberError(raw: string | null | undefined) {
  const v = (raw ?? '').replace(/[\s-]/g, '').toUpperCase();
  if (!v) return null;
  if (!/^(GB)?(\d{9}|\d{12})$/.test(v) || /^(GB)?0+$/.test(v)) return 'A VAT number is 9 digits, like GB 123 4567 89.';
  return null;
}
