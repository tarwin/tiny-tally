// Foreign-currency documents. A document's totals in the books' currency are
// what every report and the ledger read; its prices and printed totals stay
// in the currency it was issued in. Shared by the backend and the page, and
// the backend has no Intl, so minor units come from a table (ISO 4217).

const ZERO = new Set(['BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF']);
const THREE = new Set(['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND']);

export const currencyDigits = (code: string) => (ZERO.has(code) ? 0 : THREE.has(code) ? 3 : 2);

export const INVOICE_CURRENCIES = ['USD', 'EUR', 'GBP', 'AUD', 'CAD', 'NZD', 'SGD', 'AED', 'CHF', 'JPY', 'INR'];

export const isCurrency = (v: unknown): v is string => typeof v === 'string' && /^[A-Z]{3}$/.test(v);

/** A rate is books' currency per one foreign unit, in millionths: 84.25 is 84_250_000. */
export function parseFxRate(input: string): number | null {
  const v = input.trim().replace(/,/g, '');
  if (!/^\d+(\.\d{1,6})?$|^\.\d{1,6}$/.test(v)) return null;
  const micro = Math.round(Number(v) * 1_000_000);
  return micro > 0 ? micro : null;
}

export const fxRateText = (micro: number) => String(micro / 1_000_000);

/** A foreign amount in minor units, in the books' minor units. */
export function toBooks(minor: number, rateMicro: number, from: string, to: string) {
  return Math.round((minor * 10 ** (currencyDigits(to) - currencyDigits(from)) * rateMicro) / 1_000_000);
}

/**
 * What a payment of `paid` (in the document's currency) takes off the document
 * in the books' currency. Paying what's left clears it exactly, so rounding
 * can't leave a few cents owing.
 */
export function carryingValue(paid: number, doc: { total: number; fcTotal: number; balance: number }) {
  return paid >= foreignBalance(doc) ? doc.balance : Math.round((paid * doc.total) / doc.fcTotal);
}

/** What's still owing, in the document's currency. */
export function foreignBalance(doc: { total: number; fcTotal: number; balance: number }) {
  return doc.total ? Math.round((doc.balance * doc.fcTotal) / doc.total) : 0;
}
