// Tax codes and tax maths, shared by the backend and the page.
// No tjs:* imports and no Intl here: this file ships in both.
//
// Every country's codes live here; the books' country picks its set
// (countries.ts). Australia uses the usual bookkeeping set, each mapped onto
// BAS labels (see basLabelsFor). New Zealand's map onto GST return boxes
// (nzBoxesFor). The US has sales tax on sales only. Amounts
// are integer cents; entry amounts are always tax-inclusive (what actually
// left or hit the bank).
import type { CountryTax } from './countries';

export type TaxCode = 'GST' | 'FRE' | 'EXP' | 'CAP' | 'INP' | 'NTR' | 'TAX' | 'NON' | 'ZER' | 'EXE';

export interface TaxCodeInfo {
  code: TaxCode;
  label: string;
  /** Whether tax is charged / claimable on it. */
  taxable: boolean;
  /** Which sides it makes sense on. */
  sales: boolean;
  purchases: boolean;
  help: string;
}

export const TAX_CODES: TaxCodeInfo[] = [
  { code: 'GST', label: 'GST', taxable: true, sales: true, purchases: true, help: 'Includes GST at the standard rate' },
  { code: 'FRE', label: 'GST free', taxable: false, sales: true, purchases: true, help: 'e.g. basic food, some health and education, bank fees on purchases' },
  { code: 'EXP', label: 'Export (GST free)', taxable: false, sales: true, purchases: false, help: 'Sales of goods or services exported overseas (G2)' },
  { code: 'CAP', label: 'Capital purchase', taxable: true, sales: false, purchases: true, help: 'Equipment and other assets, with GST (G10)' },
  { code: 'INP', label: 'Input taxed', taxable: false, sales: true, purchases: true, help: 'Financial supplies, residential rent, interest' },
  { code: 'NTR', label: 'Not reportable', taxable: false, sales: true, purchases: true, help: 'Left off the tax return entirely: wages, owner drawings, loans, tax payments' },
  // New Zealand: GST, zero-rated, exempt and not reportable.
  { code: 'ZER', label: 'Zero-rated', taxable: false, sales: true, purchases: true, help: 'GST at 0%: exports and other zero-rated supplies (Box 6)' },
  { code: 'EXE', label: 'Exempt', taxable: false, sales: true, purchases: true, help: 'Financial services, interest, residential rent: left off the GST return' },
  // US sales tax: charged on sales only; tax paid on purchases is part of the cost.
  { code: 'TAX', label: 'Taxable', taxable: true, sales: true, purchases: false, help: 'Sales tax charged at your rate' },
  { code: 'NON', label: 'Not taxable', taxable: false, sales: true, purchases: false, help: 'Exempt or out of state: no sales tax charged' },
];

export const TAX_CODE_MAP: Record<TaxCode, TaxCodeInfo> = Object.fromEntries(TAX_CODES.map((t) => [t.code, t])) as any;

export function isTaxCode(v: unknown): v is TaxCode {
  return typeof v === 'string' && v in TAX_CODE_MAP;
}

/** Parts per million: 100000 = 10%. Fine enough for rates like 8.875%. */
export const DEFAULT_TAX_RATE_PPM = 100_000;

/** Tax contained in a tax-inclusive amount (1/11th at 10%). */
export function taxFromInclusive(gross: number, code: TaxCode | null | undefined, ratePpm = DEFAULT_TAX_RATE_PPM) {
  if (!code || !TAX_CODE_MAP[code]?.taxable) return 0;
  return Math.round((gross * ratePpm) / (1_000_000 + ratePpm));
}

/** Tax to add on top of a tax-exclusive amount. */
export function taxOnExclusive(net: number, code: TaxCode | null | undefined, ratePpm = DEFAULT_TAX_RATE_PPM) {
  if (!code || !TAX_CODE_MAP[code]?.taxable) return 0;
  return Math.round((net * ratePpm) / 1_000_000);
}

export interface LineInput {
  /** quantity in thousandths (1 = 1000) so 1.5 hours is 1500 */
  qtyMilli: number;
  /** cents, inclusive or exclusive per `pricesIncludeTax` */
  unitPrice: number;
  taxCode: TaxCode | null;
}

export interface LineTotals {
  net: number;
  tax: number;
  gross: number;
}

export function lineTotals(line: LineInput, pricesIncludeTax: boolean, taxEnabled: boolean, ratePpm = DEFAULT_TAX_RATE_PPM): LineTotals {
  const amount = Math.round((line.qtyMilli * line.unitPrice) / 1000);
  const code = taxEnabled ? line.taxCode : null;
  if (pricesIncludeTax) {
    const tax = taxFromInclusive(amount, code, ratePpm);
    return { net: amount - tax, tax, gross: amount };
  }
  const tax = taxOnExclusive(amount, code, ratePpm);
  return { net: amount, tax, gross: amount + tax };
}

export function sumTotals(lines: LineTotals[]): LineTotals {
  return lines.reduce((s, l) => ({ net: s.net + l.net, tax: s.tax + l.tax, gross: s.gross + l.gross }), { net: 0, tax: 0, gross: 0 });
}

/**
 * Which BAS labels a row lands in. G-labels take GST-inclusive amounts;
 * 1A/1B take the GST itself.
 */
export function basLabelsFor(kind: 'income' | 'expense', code: TaxCode | null) {
  if (!code || code === 'NTR') return { g: [] as string[], tax: null as '1A' | '1B' | null };
  if (kind === 'income') {
    const g = ['G1'];
    if (code === 'EXP') g.push('G2');
    if (code === 'FRE') g.push('G3');
    if (code === 'INP') g.push('G4');
    return { g, tax: TAX_CODE_MAP[code].taxable ? ('1A' as const) : null };
  }
  if (code === 'CAP') return { g: ['G10'], tax: '1B' as const };
  return { g: ['G11'], tax: TAX_CODE_MAP[code].taxable ? ('1B' as const) : null };
}

/**
 * Which NZ GST return boxes a row lands in (GST101A). Box 5 is all sales
 * including GST and zero-rated sales; Box 6 the zero-rated part. Box 11 is
 * purchases with GST to claim. Exempt and not-reportable rows stay off.
 */
export function nzBoxesFor(kind: 'income' | 'expense', code: TaxCode | null): ('5' | '6' | '11')[] {
  if (kind === 'income') return code === 'GST' ? ['5'] : code === 'ZER' ? ['5', '6'] : [];
  return code === 'GST' ? ['11'] : [];
}

// ---- per country --------------------------------------------------------------
// These take the books' CountryTax (countryProfile(country).tax), which is
// null where tax isn't supported.

/** The tax codes that make sense on one side. Empty without tax support. */
export function taxCodesFor(tax: CountryTax | null | undefined, kind: 'income' | 'expense'): TaxCodeInfo[] {
  if (!tax) return [];
  return tax.codes.map((c) => TAX_CODE_MAP[c]).filter((t) => (kind === 'income' ? t.sales : t.purchases));
}

/** `code` when the country uses it on that side, otherwise the side's default. */
export function taxCodeOr(tax: CountryTax | null | undefined, kind: 'income' | 'expense', code: unknown): TaxCode | null {
  if (!tax) return null;
  return taxCodesFor(tax, kind).some((t) => t.code === code) ? (code as TaxCode) : tax.defaultCode[kind === 'income' ? 'sales' : 'purchases'];
}

/** Whether tax is ever charged or claimed on that side (US purchases: no). */
export function tracksTax(tax: CountryTax | null | undefined, kind: 'income' | 'expense') {
  return taxCodesFor(tax, kind).some((t) => t.taxable);
}
