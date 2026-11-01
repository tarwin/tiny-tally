// Country profiles: what the books' country decides. Shared by the backend
// and the page, so no tjs:* imports and no Intl here.
//
// The country is picked when the books are made and can't change. It sets
// the currency, the financial year, how ambiguous dates read on import, the
// tax ID and the tax rules. Only Australia has tax support so far; New
// Zealand GST and US sales tax come later (docs/PLAN-countries-trading-names.md).
import type { TaxCode } from './tax';

export type Country = 'AU' | 'NZ' | 'US';

export interface CountryTax {
  /** What the tax is called: 'GST'. */
  name: string;
  defaultRateBp: number;
  /** The tax return the books prepare. */
  report: 'bas';
}

export interface CountryProfile {
  code: Country;
  name: string;
  currency: string;
  /** 'MM-DD' */
  fiscalYearStart: string;
  /** For dates like 03/10/2026 when a file doesn't make it clear. */
  dateOrder: 'dmy' | 'mdy';
  taxId: {
    label: string;
    placeholder: string;
    /** null when it looks fine (or is empty). */
    check(v: string): string | null;
  };
  /** null: no tax support for this country yet. */
  tax: CountryTax | null;
  /** The document title when it's left as the default. */
  invoiceTitle(taxRegistered: boolean): string;
  categories: { income: SeedCategory[]; expense: SeedCategory[] };
}

export interface SeedCategory {
  name: string;
  taxCode: TaxCode | null;
  /** Default 'pnl'. The rest are money kept off Profit & Loss. */
  class?: 'tax' | 'owner' | 'loan';
}

/** ABNs are 11 digits with a weighted checksum; catch typos early. */
function abnError(abn: string) {
  const digits = abn.replace(/\s/g, '');
  if (!digits) return null;
  if (!/^\d{11}$/.test(digits)) return 'An ABN is 11 digits.';
  const w = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  const sum = [...digits].reduce((t, d, i) => t + (Number(d) - (i === 0 ? 1 : 0)) * w[i], 0);
  return sum % 89 === 0 ? null : "That ABN doesn't look right. Check for a typo.";
}

/** IRD numbers (used as the GST number) are 8 or 9 digits with a check digit. */
function irdError(ird: string) {
  const digits = ird.replace(/[\s-]/g, '');
  if (!digits) return null;
  if (!/^\d{8,9}$/.test(digits)) return 'A GST number is 8 or 9 digits.';
  const n = digits.padStart(9, '0');
  if (Number(n) < 10_000_000 || Number(n) > 150_000_000) return "That GST number doesn't look right. Check for a typo.";
  const check = (weights: number[]) => {
    const r = weights.reduce((t, w, i) => t + Number(n[i]) * w, 0) % 11;
    return r === 0 ? 0 : 11 - r;
  };
  let c = check([3, 2, 7, 6, 5, 4, 3, 2]);
  if (c === 10) c = check([7, 4, 3, 2, 5, 2, 7, 6]);
  return c !== 10 && c === Number(n[8]) ? null : "That GST number doesn't look right. Check for a typo.";
}

function einError(ein: string) {
  const v = ein.trim();
  if (!v) return null;
  return /^\d{2}-?\d{7}$/.test(v) ? null : 'An EIN is 9 digits, like 12-3456789.';
}

/**
 * The starting categories. The tax code is only used where tax is on.
 * `taxPayment` names the category tax payments go to, if the country has GST.
 */
function categories(codes: Partial<Record<string, TaxCode>>, fallback: TaxCode | null, taxPayment: string | null) {
  const make = (names: string[]) => names.map((name): SeedCategory => ({ name, taxCode: codes[name] ?? fallback }));
  // Off Profit & Loss, and never on a tax return.
  const off = (name: string, cls: 'tax' | 'owner' | 'loan'): SeedCategory => ({ name, taxCode: fallback && 'NTR', class: cls });
  return {
    income: [
      ...make(['Sales', 'Services', 'Interest Income', 'Other Income']),
      ...(taxPayment ? [off('GST Refund', 'tax')] : []),
      off('Owner Contribution', 'owner'),
      off('Loan Received', 'loan'),
    ],
    expense: [
      ...make([
        'Advertising & Marketing',
        'Bank Fees',
        'Contractors',
        'Equipment',
        'Insurance',
        'Meals & Entertainment',
        'Office Supplies',
        'Professional Fees',
        'Rent',
        'Software & Subscriptions',
        'Taxes & Licences',
        'Travel',
        'Utilities',
        'Uncategorised Expense',
      ]),
      ...(taxPayment ? [off(taxPayment, 'tax')] : []),
      off('Income Tax Payment', 'tax'),
      off('Owner Drawings', 'owner'),
      off('Loan Repayment', 'loan'),
    ],
  };
}

export const COUNTRIES: Record<Country, CountryProfile> = {
  AU: {
    code: 'AU',
    name: 'Australia',
    currency: 'AUD',
    fiscalYearStart: '07-01',
    dateOrder: 'dmy',
    taxId: { label: 'ABN', placeholder: '51 824 753 556', check: abnError },
    tax: { name: 'GST', defaultRateBp: 1000, report: 'bas' },
    invoiceTitle: (registered) => (registered ? 'Tax Invoice' : 'Invoice'),
    categories: categories({ 'Interest Income': 'INP', 'Bank Fees': 'FRE', 'Taxes & Licences': 'FRE', Equipment: 'CAP' }, 'GST', 'GST / BAS Payment'),
  },
  NZ: {
    code: 'NZ',
    name: 'New Zealand',
    currency: 'NZD',
    fiscalYearStart: '04-01',
    dateOrder: 'dmy',
    taxId: { label: 'GST number', placeholder: '49-091-850', check: irdError },
    tax: null,
    invoiceTitle: (registered) => (registered ? 'Tax Invoice' : 'Invoice'),
    categories: categories({}, null, 'GST Payment'),
  },
  US: {
    code: 'US',
    name: 'United States',
    currency: 'USD',
    fiscalYearStart: '01-01',
    dateOrder: 'mdy',
    taxId: { label: 'EIN', placeholder: '12-3456789', check: einError },
    tax: null,
    invoiceTitle: () => 'Invoice',
    categories: categories({}, null, null),
  },
};

export const COUNTRY_OPTIONS = (['AU', 'NZ', 'US'] as Country[]).map((c) => ({ label: COUNTRIES[c].name, value: c }));

export function isCountry(v: unknown): v is Country {
  return typeof v === 'string' && v in COUNTRIES;
}

export function countryProfile(c: string | null | undefined): CountryProfile {
  return isCountry(c) ? COUNTRIES[c] : COUNTRIES.AU;
}
