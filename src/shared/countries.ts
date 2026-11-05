// Country profiles: what the books' country decides. Shared by the backend
// and the page, so no tjs:* imports and no Intl here.
//
// The country is picked when the books are made and can't change. It sets
// the currency, the financial year, how ambiguous dates read on import, the
// tax ID and the tax rules. Australia has GST and the BAS, New Zealand GST
// and the GST return, the US a flat sales tax (or none), India GST split by
// state with zero-rated exports (india.ts), Canada GST/HST at the customer's
// province's rate (canada.ts), and the UK VAT at a rate per line (uk.ts).
import type { TaxCode, TaxCodeInfo } from './tax';
import { CA_RATES, businessNumberError, caRatePpm, caTaxWord } from './canada';
import { EXPORT_PLACE, GST_RATES, gstHeads, gstRateText, gstinError } from './india';
import { VAT_RATES, vatNumberError } from './uk';

/** How the books show dates: '10 May 2026', 'May 10, 2026' or '2026-05-10'. */
export type DateFormat = 'dmy' | 'mdy' | 'ymd';
export const DATE_FORMATS: DateFormat[] = ['dmy', 'mdy', 'ymd'];

export type Country = 'AU' | 'NZ' | 'US' | 'IN' | 'CA' | 'GB';

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
  /** What a code is called here, where it isn't what the other countries call it. */
  codeLabels?: Partial<Record<TaxCode, Pick<TaxCodeInfo, 'label' | 'help'>>>;
  /** Each line has its own rate, from this list, instead of the document having one. */
  lineRates?: { ppm: number; label: string }[];
  /** The rate comes from where the sale is made, not from what's being sold, so products don't carry one (Canada). */
  rateFollowsPlace?: boolean;
  /** Tax falls due when the invoice is issued, so there's no cash basis to choose (India, Canada). */
  accrualOnly?: boolean;
  /** The ledger account the tax sits in. */
  account: string;
  /** The tax report the books prepare. */
  report: 'bas' | 'nz-gst' | 'us-sales-tax' | 'in-gst' | 'ca-gst' | 'uk-vat';
  /** The filing frequencies on offer, and the usual one. */
  frequencies: { value: TaxFrequency; label: string; description?: string }[];
  defaultFrequency: TaxFrequency;
}

export interface CountryProfile {
  code: Country;
  name: string;
  /** What these books get, shown when choosing a country. */
  summary: string;
  currency: string;
  /** 'MM-DD' */
  fiscalYearStart: string;
  /** How dates show until the books choose otherwise, and how to read 03/10/2026 when a file doesn't make it clear. */
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
  class?: 'tax' | 'owner' | 'loan' | 'asset';
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
  /** Shared expense categories this country leaves out. */
  withoutExpenses?: string[];
  /** Extra expense categories kept off Profit & Loss. */
  offExpenses?: { name: string; class: 'owner' | 'asset' }[];
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
  const off = (name: string, cls: NonNullable<SeedCategory['class']>): SeedCategory => ({
    name,
    taxCode: o.fallback && 'NTR',
    class: cls,
    ...(o.lines?.[name] ? { reportLine: o.lines[name] } : {}),
  });
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
      ].filter((n) => !o.withoutExpenses?.includes(n)), 'expense'),
      ...(o.taxPayment ? [off(o.taxPayment, 'tax')] : []),
      off('Income Tax Payment', 'tax'),
      off('Owner Drawings', 'owner'),
      ...(o.offExpenses ?? []).map((c) => off(c.name, c.class)),
      off('Loan Repayment', 'loan'),
    ],
  };
}

export const COUNTRIES: Record<Country, CountryProfile> = {
  AU: {
    code: 'AU',
    name: 'Australia',
    summary: "GST and BAS figures, PAYG instalments, taxable payments (TPAR), car trips and an asset register.",
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
      extraExpenses: ['Motor Vehicle'],
      // Item P8 of the business and professional items schedule (incomeReturnLines.ts).
      lines: {
        Sales: 'au-other-income',
        Services: 'au-other-income',
        'Interest Income': 'au-other-income',
        'Other Income': 'au-other-income',
        Contractors: 'au-contractors',
        Rent: 'au-rent',
        'Motor Vehicle': 'au-motor-vehicle',
        // Equipment under the instant asset write-off is depreciation (written off at once).
        Equipment: 'au-depreciation',
        'Advertising & Marketing': 'au-other-expenses',
        'Bank Fees': 'au-other-expenses',
        Insurance: 'au-other-expenses',
        'Meals & Entertainment': 'au-other-expenses',
        'Office Supplies': 'au-other-expenses',
        'Professional Fees': 'au-other-expenses',
        'Software & Subscriptions': 'au-other-expenses',
        'Taxes & Licences': 'au-other-expenses',
        Travel: 'au-other-expenses',
        Utilities: 'au-other-expenses',
        'Uncategorised Expense': 'au-other-expenses',
        // Not a P8 label: where PAYG instalments go.
        'Income Tax Payment': 'estimated-tax',
      },
    }),
  },
  NZ: {
    code: 'NZ',
    name: 'New Zealand',
    summary: "GST return figures, IR10 summary, provisional tax, vehicle trips and an asset register.",
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
      extraExpenses: ['Vehicle'],
      // IR10 boxes (incomeReturnLines.ts).
      lines: {
        Sales: 'nz-sales',
        Services: 'nz-sales',
        'Interest Income': 'nz-interest',
        'Other Income': 'nz-other-income',
        Contractors: 'nz-contractors',
        Insurance: 'nz-insurance',
        'Professional Fees': 'nz-professional',
        Rent: 'nz-rent',
        Vehicle: 'nz-vehicle',
        // Under $1,000 an item: written off as a low-value asset.
        Equipment: 'nz-depreciation',
        'Advertising & Marketing': 'nz-other-expenses',
        'Bank Fees': 'nz-other-expenses',
        'Meals & Entertainment': 'nz-other-expenses',
        'Office Supplies': 'nz-other-expenses',
        'Software & Subscriptions': 'nz-other-expenses',
        'Taxes & Licences': 'nz-other-expenses',
        Travel: 'nz-other-expenses',
        Utilities: 'nz-other-expenses',
        'Uncategorised Expense': 'nz-other-expenses',
        // Not an IR10 box: where provisional tax payments go.
        'Income Tax Payment': 'estimated-tax',
      },
    }),
  },
  IN: {
    code: 'IN',
    name: 'India',
    summary: "GST at a rate per line, split into CGST, SGST and IGST, with a summary for GSTR-1 and GSTR-3B. No income tax tools.",
    currency: 'INR',
    fiscalYearStart: '04-01',
    dateOrder: 'dmy',
    taxId: { label: 'GSTIN', placeholder: '27AAPFU0939F1ZV', check: gstinError },
    tax: {
      name: 'GST',
      short: 'GST',
      registered: { label: 'Registered for GST', help: 'Tracks GST on sales and purchases, splits it by state, and prepares your GST summary.' },
      // Most professional services. The rate is editable because goods and some services differ.
      defaultRatePpm: 180_000,
      rateEditable: true,
      pricesIncludeTax: false,
      spellOut: false,
      adjustmentNote: false,
      codes: ['GST', 'ZER', 'EXE', 'NTR'],
      defaultCode: { sales: 'GST', purchases: 'GST' },
      lineRates: GST_RATES,
      accrualOnly: true,
      account: 'GST',
      report: 'in-gst',
      frequencies: [
        { value: 'monthly', label: 'Monthly', description: 'GSTR-1 and GSTR-3B every month.' },
        { value: 'quarterly', label: 'Quarterly (QRMP)', description: 'For smaller businesses that opted into the QRMP scheme.' },
      ],
      defaultFrequency: 'monthly',
    },
    invoiceTitle: (registered) => (registered ? 'Tax Invoice' : 'Invoice'),
    categories: categories({
      codes: { 'Interest Income': 'EXE', 'Bank Fees': 'GST' },
      fallback: { income: 'GST', expense: 'GST' },
      taxPayment: 'GST Payment',
      taxRefund: 'GST Refund',
    }),
  },
  CA: {
    code: 'CA',
    name: 'Canada',
    summary: "GST/HST at the rate for the customer's province, with return figures. No income tax tools, and PST and QST aren't tracked.",
    currency: 'CAD',
    // Sole proprietors generally keep a calendar year.
    fiscalYearStart: '01-01',
    dateOrder: 'mdy',
    taxId: { label: 'Business Number', placeholder: '123456789 RT 0001', check: businessNumberError },
    tax: {
      name: 'GST/HST',
      short: 'GST/HST',
      registered: { label: 'Registered for GST/HST', help: "Charges GST or HST by your customer's province, tracks your input tax credits and prepares your GST/HST return figures." },
      defaultRatePpm: 50_000,
      rateEditable: false,
      pricesIncludeTax: false,
      spellOut: false,
      adjustmentNote: false,
      codes: ['GST', 'ZER', 'EXE', 'NTR'],
      defaultCode: { sales: 'GST', purchases: 'GST' },
      codeLabels: {
        GST: { label: 'GST/HST', help: "Charged or paid at the rate on the line: on a sale, the rate for the customer's province" },
        ZER: { label: 'Zero-rated', help: 'Taxed at 0%: exports and other listed supplies. Not every service to a customer abroad qualifies.' },
        EXE: { label: 'Exempt', help: 'No GST/HST and no credits, such as interest and most financial services' },
        NTR: { label: 'Not reportable', help: 'Left off the return: owner drawings, loans, tax payments' },
      },
      lineRates: CA_RATES,
      rateFollowsPlace: true,
      accrualOnly: true,
      account: 'GST/HST',
      report: 'ca-gst',
      frequencies: [
        { value: 'annual', label: 'Annually', description: 'What the CRA assigns at $1.5 million of taxable sales or less.' },
        { value: 'quarterly', label: 'Quarterly', description: 'Assigned over $1.5 million, or by choice.' },
        { value: 'monthly', label: 'Monthly', description: 'Assigned over $6 million, or by choice.' },
      ],
      defaultFrequency: 'annual',
    },
    invoiceTitle: () => 'Invoice',
    categories: categories({
      codes: { 'Interest Income': 'EXE', 'Bank Fees': 'EXE', Insurance: 'EXE', 'Taxes & Licences': 'NTR' },
      fallback: { income: 'GST', expense: 'GST' },
      taxPayment: 'GST/HST Payment',
      taxRefund: 'GST/HST Refund',
    }),
  },
  GB: {
    code: 'GB',
    name: 'United Kingdom',
    summary: "VAT at a rate per line and a 9-box return to send through bridging software. No self-assessment tools.",
    currency: 'GBP',
    // The tax year. Sole traders are taxed on it, whatever their accounting date.
    fiscalYearStart: '04-06',
    dateOrder: 'dmy',
    taxId: { label: 'VAT number', placeholder: 'GB 123 4567 89', check: vatNumberError },
    tax: {
      name: 'VAT',
      short: 'VAT',
      registered: { label: 'Registered for VAT', help: 'Charges VAT at a rate per line, tracks what you can reclaim and prepares your 9-box VAT return to send through bridging software.' },
      defaultRatePpm: 200_000,
      rateEditable: false,
      pricesIncludeTax: false,
      spellOut: false,
      adjustmentNote: false,
      codes: ['GST', 'ZER', 'EXE', 'OOS', 'NTR'],
      defaultCode: { sales: 'GST', purchases: 'GST' },
      codeLabels: {
        GST: { label: 'VAT', help: 'Charged or paid at the rate on the line: 20% for most things, 5% for some' },
        ZER: { label: 'Zero-rated', help: 'VAT at 0%, such as most food and children’s clothes. Counts in Boxes 6 and 7.' },
        EXE: { label: 'Exempt or no VAT to reclaim', help: 'Financial and property transactions, stamps, and costs such as business entertainment. Counts in Boxes 6 and 7.' },
        NTR: { label: 'Not reportable', help: 'Left off the return: wages, owner drawings, loans, tax payments' },
      },
      lineRates: VAT_RATES,
      account: 'VAT',
      report: 'uk-vat',
      frequencies: [
        { value: 'quarterly', label: 'Quarterly', description: 'What most businesses do. Pick your quarters below.' },
        { value: 'monthly', label: 'Monthly', description: 'If HMRC has agreed monthly returns with you.' },
      ],
      defaultFrequency: 'quarterly',
    },
    invoiceTitle: (registered) => (registered ? 'VAT Invoice' : 'Invoice'),
    categories: categories({
      codes: { 'Interest Income': 'EXE', 'Bank Fees': 'EXE', Insurance: 'EXE', 'Meals & Entertainment': 'EXE', 'Taxes & Licences': 'NTR', Travel: 'ZER' },
      fallback: { income: 'GST', expense: 'GST' },
      taxPayment: 'VAT Payment',
      taxRefund: 'VAT Refund',
    }),
  },
  US: {
    code: 'US',
    name: 'United States',
    summary: "Sales tax totals, Schedule C, estimated tax, 1099-NEC, mileage and an asset register.",
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
      // Equipment is either expensed as supplies ($2,500 or less an item,
      // the de minimis safe harbor) or bought as an asset and depreciated
      // through Form 4562; neither is "other expenses".
      extraExpenses: ['Car & Truck', 'Supplies', 'Small Equipment', 'Merchant Fees', 'Cost of Goods Sold'],
      withoutExpenses: ['Equipment'],
      // The owner's own health insurance and retirement plan go on
      // Schedule 1, not Schedule C (lines 15 and 19 are for the business
      // and its employees).
      offExpenses: [
        { name: 'Equipment & Assets', class: 'asset' },
        { name: "Owner's Health Insurance", class: 'owner' },
        { name: "Owner's Retirement Contributions", class: 'owner' },
      ],
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
        'Merchant Fees': 'commissions',
        'Small Equipment': 'supplies',
        'Cost of Goods Sold': 'cogs-purchases',
        // Not a Schedule C line: marks where estimated tax payments go (scheduleC.ts).
        'Income Tax Payment': 'estimated-tax',
        'Uncategorised Expense': 'other-expenses',
      },
    }),
  },
};

export const COUNTRY_OPTIONS = (['AU', 'CA', 'IN', 'NZ', 'GB', 'US'] as Country[]).map((c) => ({ label: COUNTRIES[c].name, value: c, description: COUNTRIES[c].summary }));

/** Whether car trips and the asset register are in for this country: they follow its income tax rules. */
export const hasIncomeRules = (c: string | null | undefined) => c === 'AU' || c === 'NZ' || c === 'US';

/** What a new line starts at, where each line has a rate. Null everywhere else. */
export function defaultLineRate(books: { country: string; taxRatePpm: number; homeState?: string | null }, place: string | null | undefined, date: string) {
  const tax = countryProfile(books.country).tax;
  if (!tax?.lineRates) return null;
  if (tax.rateFollowsPlace) return caRatePpm(place && place !== EXPORT_PLACE ? place : books.homeState, date);
  return books.taxRatePpm;
}

/** A line's rate as printed beside it: 'GST 18%', 'HST 13%', 'VAT 5%'. */
export function lineRateText(country: string, ppm: number) {
  return `${country === 'CA' ? caTaxWord(ppm) : countryProfile(country).tax?.short ?? ''} ${gstRateText(ppm)}`;
}

/** The tax lines on a document's totals, one per rate (India: two where the state's share is half). */
export function taxHeadsFor(country: string, lines: { ratePpm: number; tax: number }[], split: 'intra' | 'inter') {
  if (country === 'IN') return gstHeads(lines, split);
  const byRate = new Map<number, number>();
  for (const l of lines) if (l.tax) byRate.set(l.ratePpm, (byRate.get(l.ratePpm) ?? 0) + l.tax);
  return [...byRate.entries()].sort((a, b) => a[0] - b[0]).map(([ppm, value]) => {
    const [word, rate] = lineRateText(country, ppm).split(' ');
    return { label: `${word} @ ${rate}`, value };
  });
}

export function isCountry(v: unknown): v is Country {
  return typeof v === 'string' && v in COUNTRIES;
}

export function countryProfile(c: string | null | undefined): CountryProfile {
  return isCountry(c) ? COUNTRIES[c] : COUNTRIES.AU;
}
