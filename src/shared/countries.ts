// Country profiles: what the books' country decides. Shared by the backend
// and the page, so no tjs:* imports and no Intl here.
//
// The country is picked when the books are made and can't change. It sets
// the currency, the financial year, how ambiguous dates read on import, the
// tax ID and the tax rules. Australia has GST and the BAS, New Zealand GST
// and the GST return, and the US a flat sales tax (or none).
import type { TaxCode } from './tax';

export type Country = 'AU' | 'NZ' | 'US';

/** How often tax returns are filed. */
export type TaxFrequency = 'monthly' | 'two-monthly' | 'quarterly' | 'six-monthly' | 'annual';
export const TAX_FREQUENCIES: TaxFrequency[] = ['monthly', 'two-monthly', 'quarterly', 'six-monthly', 'annual'];

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
  report: 'bas' | 'nz-gst' | 'us-sales-tax';
  /** The filing frequencies on offer, and the usual one. */
  frequencies: { value: TaxFrequency; label: string; description?: string }[];
  defaultFrequency: TaxFrequency;
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
  /** The tax form line it maps onto (US: a Schedule C key, see scheduleC.ts). */
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
  /** Tax form line key per category name. */
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
      frequencies: [
        { value: 'quarterly', label: 'Quarterly', description: 'Most small businesses. Uses Simpler BAS (G1, 1A, 1B).' },
        { value: 'monthly', label: 'Monthly', description: 'Required if GST turnover is $20 million or more; shows the full set of labels.' },
        { value: 'annual', label: 'Annually', description: 'For voluntary registrations under $75,000.' },
      ],
      defaultFrequency: 'quarterly',
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
    tax: {
      name: 'GST',
      short: 'GST',
      registered: { label: 'Registered for GST', help: 'Tracks GST on sales and purchases and prepares your GST return.' },
      defaultRatePpm: 150_000,
      rateEditable: false,
      pricesIncludeTax: true,
      spellOut: true,
      adjustmentNote: false,
      codes: ['GST', 'ZER', 'EXE', 'NTR'],
      defaultCode: { sales: 'GST', purchases: 'GST' },
      account: 'GST',
      report: 'nz-gst',
      // Periods line up with the balance date (IR375). IRD's default is 2-monthly.
      frequencies: [
        { value: 'two-monthly', label: '2-monthly', description: 'The usual choice, for sales under $24 million a year.' },
        { value: 'monthly', label: 'Monthly', description: 'Required if sales are over $24 million a year; suits frequent refunds.' },
        { value: 'six-monthly', label: '6-monthly', description: 'Only if sales are under $500,000 a year.' },
      ],
      defaultFrequency: 'two-monthly',
    },
    // Taxable supply information replaced the "tax invoice" rule in April
    // 2023, but the title is still what people expect to see.
    invoiceTitle: (registered) => (registered ? 'Tax Invoice' : 'Invoice'),
    categories: categories({
      codes: { 'Interest Income': 'EXE', 'Bank Fees': 'EXE' },
      fallback: { income: 'GST', expense: 'GST' },
      taxPayment: 'GST Payment',
      taxRefund: 'GST Refund',
    }),
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
      frequencies: [
        { value: 'monthly', label: 'Monthly' },
        { value: 'quarterly', label: 'Quarterly' },
        { value: 'annual', label: 'Annually' },
      ],
      defaultFrequency: 'quarterly',
    },
    invoiceTitle: () => 'Invoice',
    categories: categories({
      codes: { 'Interest Income': 'NON', 'Other Income': 'NON' },
      fallback: { income: 'TAX', expense: 'NTR' },
      taxPayment: 'Sales Tax Payment',
      extraExpenses: ['Car & Truck', 'Supplies'],
      lines: {
        Sales: 'gross-receipts',
        Services: 'gross-receipts',
        'Interest Income': 'other-income',
        'Other Income': 'other-income',
        'Advertising & Marketing': 'advertising',
        'Car & Truck': 'car-truck',
        Contractors: 'contract-labor',
        Insurance: 'insurance',
        'Professional Fees': 'legal-professional',
        'Office Supplies': 'office',
        'Software & Subscriptions': 'office',
        Rent: 'rent-property',
        Supplies: 'supplies',
        'Taxes & Licences': 'taxes-licenses',
        Travel: 'travel',
        'Meals & Entertainment': 'meals',
        Utilities: 'utilities',
        'Bank Fees': 'other-expenses',
        Equipment: 'other-expenses',
        'Uncategorised Expense': 'other-expenses',
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
