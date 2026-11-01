// Money is stored as integer minor units (cents). Formatting happens here,
// in the page — the txiki backend has no Intl.

import { reactive } from 'vue';

/**
 * How the currency shows: '$1.00', 'A$1.00' or 'AUD 1.00'. Each set of books
 * picks one for its own screens and one for documents it sends.
 */
export type CurrencyDisplay = 'narrow' | 'symbol' | 'code';
export const CURRENCY_DISPLAYS: CurrencyDisplay[] = ['narrow', 'symbol', 'code'];

/** The open books' on-screen choice (lib/session.ts keeps it in step). Reactive, so amounts redraw when it changes. */
export const moneyDisplay = reactive({ screen: 'narrow' as CurrencyDisplay });

const formatters = new Map<string, Intl.NumberFormat>();

function formatter(currency: string, display: 'narrowSymbol' | 'code' = 'narrowSymbol') {
  const key = `${currency}:${display}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat(undefined, { style: 'currency', currency, currencyDisplay: display });
    formatters.set(key, f);
  }
  return f;
}

const symbols = new Map<string, string>();

/**
 * 'A$', 'NZ$', 'US$', '£'. The locale's own symbol won't do: en-AU writes AUD
 * as plain '$' and USD as 'USD'. International English names every dollar.
 */
function distinctSymbol(currency: string) {
  let sym = symbols.get(currency);
  if (sym === undefined) {
    const parts = new Intl.NumberFormat('en-001', { style: 'currency', currency }).formatToParts(0);
    sym = parts.find((p) => p.type === 'currency')?.value ?? currency;
    symbols.set(currency, sym);
  }
  return sym;
}

export function minorDigits(currency: string) {
  return formatter(currency).resolvedOptions().maximumFractionDigits ?? 2;
}

/** Amounts on screen follow the books' choice; documents pass their own. */
export function formatMoney(minor: number, currency: string, display: CurrencyDisplay = moneyDisplay.screen) {
  const value = minor / 10 ** minorDigits(currency);
  if (display === 'code') return formatter(currency, 'code').format(value);
  if (display === 'narrow') return formatter(currency).format(value);
  // The locale's layout (sign, grouping, symbol side) with the distinct symbol.
  return formatter(currency)
    .formatToParts(value)
    .map((p) => (p.type === 'currency' ? distinctSymbol(currency) : p.value))
    .join('');
}

/** "1,234.5" → 123450 (for a 2-digit currency). Returns null if unparseable. */
export function parseMoney(input: string | number | null | undefined, currency: string): number | null {
  if (input === null || input === undefined) return null;
  const s = String(input).replace(/[^\d.,-]/g, '');
  if (s === '' || s === '-') return null;
  // Treat the last , or . as the decimal point only if 1–3 digits follow it
  // and it isn't the only kind of separator used as thousands grouping.
  const lastSep = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
  let whole = s;
  let frac = '';
  if (lastSep >= 0 && s.length - lastSep - 1 <= minorDigits(currency) && s.length - lastSep - 1 > 0) {
    whole = s.slice(0, lastSep);
    frac = s.slice(lastSep + 1);
  }
  const negative = whole.includes('-');
  whole = whole.replace(/[^\d]/g, '') || '0';
  const digits = minorDigits(currency);
  const minor = Number(whole) * 10 ** digits + Number((frac + '000').slice(0, digits) || 0);
  if (!Number.isFinite(minor)) return null;
  return negative ? -minor : minor;
}

/** For pre-filling an input: 123450 → "1234.50". */
export function toInput(minor: number, currency: string) {
  const digits = minorDigits(currency);
  return (minor / 10 ** digits).toFixed(digits);
}

/** A tax rate in parts per million as a percent for typing: 88750 → '8.875'. */
export function ratePercent(ppm: number) {
  return String(ppm / 10_000);
}

/** '8.875' or '8.875%' → 88750; null unless it's 0–50% with up to 4 decimals. */
export function parseRate(input: string): number | null {
  const v = input.trim().replace(/%$/, '').trim();
  if (!/^\d{1,2}(\.\d{1,4})?$|^\.\d{1,4}$/.test(v)) return null;
  const ppm = Math.round(Number(v) * 10_000);
  return ppm <= 500_000 ? ppm : null;
}
