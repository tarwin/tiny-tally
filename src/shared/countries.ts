// Country profiles: what the books' country decides. Shared by the backend
// and the page, so no tjs:* imports and no Intl here.
//
// The country is picked when the books are made and can't change. It sets
// the currency, the financial year, how ambiguous dates read on import, the
// tax ID and the tax rules. Australia has GST and the BAS; the US has a
// flat sales tax (or none). New Zealand GST comes later
// (docs/PLAN-countries-trading-names.md).
import type { TaxCode } from './tax';

export type Country = 'AU' | 'NZ' | 'US';

export interface CountryTax {
  /** What the tax is called: 'GST', 'Sales tax'. */
  name: string;
  /** In running text: "inc. GST", "plus tax". */
  short: string;
  /** The switch that turns it on. */
  registered: { label: string; help: string };
  defaultRatePpm: number;
  /** Whether the rate is the person's to set (US) or fixed by law (AU). */
  rateEditable: boolean;
  /** The default for new invoices. */
  pricesIncludeTax: boolean;
  /** Documents spell out "ex. GST" and "inc. GST" (AU), or just say Subtotal and Total (US). */
  spellOut: boolean;
  /** A credit note is called an adjustment note (AU, for the ATO). */
  adjustmentNote: boolean;
  /** Every code this country uses. */
  codes: TaxCode[];
  /** The code for a new line on each side. */
  defaultCode: { sales: TaxCode; purchases: TaxCode };
  /** The ledger account the tax sits in. */
  account: string;
  /** The tax report the books prepare. */
  report: 'bas' | 'us-sales-tax';
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
  /** The tax form line it maps onto (US: Schedule C). */
  reportLine?: string;
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

interface SeedOptions {
  /** Per-category tax codes; the rest get the side's default. */
  codes?: Partial<Record<string, TaxCode>>;
  /** The default code per side; null when the country has no tax support yet. */
  fallback: { income: TaxCode; expense: TaxCode } | null;
  /** The categories tax payments and refunds go to. */
  taxPayment?: string;
  taxRefund?: string;
  /** Extra expense categories this country starts with. */
  extraExpenses?: string[];
  /** Tax form line per category name. */
  lines?: Record<string, string>;
}

/** The starting categories. The tax code is only used where tax is on. */
function categories(o: SeedOptions) {
  const make = (names: string[], kind: 'income' | 'expense') =>
    names.map((name): SeedCategory => ({
      name,
      taxCode: o.codes?.[name] ?? o.fallback?.[kind] ?? null,
      ...(o.lines?.[name] ? { reportLine: o.lines[name] } : {}),
    }));
  // Off Profit & Loss, and never on a tax return.
  const off = (name: string, cls: 'tax' | 'owner' | 'loan'): SeedCategory => ({ name, taxCode: o.fallback && 'NTR', class: cls });
  return {
    income: [
      ...make(['Sales', 'Services', 'Interest Income', 'Other Income'], 'income'),
      ...(o.taxRefund ? [off(o.taxRefund, 'tax')] : []),
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
        ...(o.extraExpenses ?? []),
        'Uncategorised Expense',
      ], 'expense'),
      ...(o.taxPayment ? [off(o.taxPayment, 'tax')] : []),
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
    tax: {
      name: 'GST',
      short: 'GST',
      registered: { label: 'Registered for GST', help: 'Tracks GST on sales and purchases and prepares your BAS.' },
      defaultRatePpm: 100_000,
      rateEditable: false,
      pricesIncludeTax: true,
      spellOut: true,
      adjustmentNote: true,
      codes: ['GST', 'FRE', 'EXP', 'CAP', 'INP', 'NTR'],
      defaultCode: { sales: 'GST', purchases: 'GST' },
      account: 'GST',
      report: 'bas',
    },
    invoiceTitle: (registered) => (registered ? 'Tax Invoice' : 'Invoice'),
    categories: categories({
      codes: { 'Interest Income': 'INP', 'Bank Fees': 'FRE', 'Taxes & Licences': 'FRE', Equipment: 'CAP' },
      fallback: { income: 'GST', expense: 'GST' },
      taxPayment: 'GST / BAS Payment',
      taxRefund: 'GST Refund',
    }),
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
    categories: categories({ fallback: null, taxPayment: 'GST Payment', taxRefund: 'GST Refund' }),
  },
  US: {
    code: 'US',
    name: 'United States',
    currency: 'USD',
    fiscalYearStart: '01-01',
    dateOrder: 'mdy',
    taxId: { label: 'EIN', placeholder: '12-3456789', check: einError },
    tax: {
      name: 'Sales tax',
      short: 'tax',
      registered: { label: 'Charge sales tax', help: 'Adds sales tax at your rate to taxable sales, and totals what you collected.' },
      // No sensible default: the rate depends on the state, county and city.
      defaultRatePpm: 0,
      rateEditable: true,
      pricesIncludeTax: false,
      spellOut: false,
      adjustmentNote: false,
      codes: ['TAX', 'NON', 'NTR'],
      // Sales tax paid on purchases isn't claimed back: it's part of the cost.
      defaultCode: { sales: 'TAX', purchases: 'NTR' },
      account: 'Sales tax payable',
      report: 'us-sales-tax',
    },
    invoiceTitle: () => 'Invoice',
    categories: categories({
      codes: { 'Interest Income': 'NON', 'Other Income': 'NON' },
      fallback: { income: 'TAX', expense: 'NTR' },
      taxPayment: 'Sales Tax Payment',
      extraExpenses: ['Car & Truck', 'Supplies'],
      lines: {
        Sales: '1',
        Services: '1',
        'Interest Income': '6',
        'Other Income': '6',
        'Advertising & Marketing': '8',
        'Car & Truck': '9',
        Contractors: '11',
        Insurance: '15',
        'Professional Fees': '17',
        'Office Supplies': '18',
        'Software & Subscriptions': '18',
        Rent: '20b',
        Supplies: '22',
        'Taxes & Licences': '23',
        Travel: '24a',
        'Meals & Entertainment': '24b',
        Utilities: '25',
        'Bank Fees': '27a',
        Equipment: '27a',
        'Uncategorised Expense': '27a',
      },
    }),
  },
};

export const COUNTRY_OPTIONS = (['AU', 'NZ', 'US'] as Country[]).map((c) => ({ label: COUNTRIES[c].name, value: c }));

export function isCountry(v: unknown): v is Country {
  return typeof v === 'string' && v in COUNTRIES;
}

export function countryProfile(c: string | null | undefined): CountryProfile {
  return isCountry(c) ? COUNTRIES[c] : COUNTRIES.AU;
}
