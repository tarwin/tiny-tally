// Money is stored as integer minor units (cents). Formatting happens here,
// in the page — the txiki backend has no Intl.

const formatters = new Map<string, Intl.NumberFormat>();

function formatter(currency: string) {
  let f = formatters.get(currency);
  if (!f) {
    f = new Intl.NumberFormat(undefined, { style: 'currency', currency });
    formatters.set(currency, f);
  }
  return f;
}

export function minorDigits(currency: string) {
  return formatter(currency).resolvedOptions().maximumFractionDigits ?? 2;
}

export function formatMoney(minor: number, currency: string) {
  return formatter(currency).format(minor / 10 ** minorDigits(currency));
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
