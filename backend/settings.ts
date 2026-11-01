// Books settings live as key/value rows in `meta`.
import { TAX_FREQUENCIES, isCountry, type Country, type TaxFrequency } from '../src/shared/countries';
import { getBooks, one } from './db';

type CurrencyDisplay = 'narrow' | 'symbol' | 'code';
const CURRENCY_DISPLAYS: CurrencyDisplay[] = ['narrow', 'symbol', 'code'];

export interface BooksSettings {
  /** The owner's legal name. Documents show a trading name instead. */
  name: string;
  /** Set when the books are made; can't change. */
  country: Country;
  /** From the country; can't change. */
  currency: string;
  /** 'MM-DD', day 1–28. */
  fiscalYearStart: string;
  taxEnabled: boolean;
  taxRatePpm: number;
  /** ABN, NZ GST number or EIN, per the country. */
  taxId: string;
  taxBasis: 'cash' | 'accrual';
  /** How often tax returns are filed. */
  taxPeriod: TaxFrequency;
  pricesIncludeTax: boolean;
  invoicePrefix: string;
  invoiceNext: number;
  billPrefix: string;
  billNext: number;
  quotePrefix: string;
  quoteNext: number;
  creditPrefix: string;
  creditNext: number;
  paymentTermsDays: number;
  /** How amounts show in the app: '$1.00', 'A$1.00' or 'AUD 1.00'. */
  currencyDisplay: CurrencyDisplay;
  /** The same for documents sent out (invoices, statements), read by people who may not know the currency. */
  documentCurrencyDisplay: CurrencyDisplay;
  /** '#rrggbb' or '' — the stripe beside the menu that tells open books apart. */
  color: string;
  /** data: URL, or '' — shown top left instead of the app's logo. */
  logo: string;
  /** Entries dated on or before this can't change (set by lodging a tax return). */
  lockDate: string | null;
}

type Field = { key: string; parse: (v: string | null) => any; write: (v: any) => string | null };

const str = (d = ''): Omit<Field, 'key'> => ({ parse: (v) => v ?? d, write: (v) => String(v ?? '').trim() });
const int = (d: number, min = -Infinity, max = Infinity): Omit<Field, 'key'> => ({
  parse: (v) => (v === null || v === '' || Number.isNaN(Number(v)) ? d : Number(v)),
  write: (v) => {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n) || n < min || n > max) throw new Error(`Enter a number between ${min} and ${max}.`);
    return String(n);
  },
});
const bool = (d: boolean): Omit<Field, 'key'> => ({
  parse: (v) => (v === null ? d : v === '1'),
  write: (v) => (v ? '1' : '0'),
});
const oneOf = <T extends string>(values: T[], d: T): Omit<Field, 'key'> => ({
  parse: (v) => (values.includes(v as T) ? v : d),
  write: (v) => {
    if (!values.includes(v)) throw new Error(`Choose one of: ${values.join(', ')}.`);
    return v;
  },
});

/** Settings set when the books are made. Writing the same value back is fine. */
const fixed = (key: string) => (v: any) => {
  const now = one<{ value: string }>(getBooks().db, 'SELECT value FROM meta WHERE key = ?', key)?.value;
  if (v !== now) throw new Error(`The ${key} can't be changed once the books are made.`);
  return now ?? null;
};

/** 'MM-DD' with the day 1–28, so every year has that date. */
export function isYearStart(v: string) {
  const m = /^(\d{2})-(\d{2})$/.exec(v);
  return !!m && +m[1] >= 1 && +m[1] <= 12 && +m[2] >= 1 && +m[2] <= 28;
}

const FIELDS: Record<keyof BooksSettings, Field> = {
  name: { key: 'books_name', ...str('Books') },
  country: { key: 'country', parse: (v) => (isCountry(v) ? v : 'AU'), write: fixed('country') },
  currency: { key: 'currency', parse: (v) => v ?? 'AUD', write: fixed('currency') },
  fiscalYearStart: {
    key: 'fiscal_year_start',
    parse: (v) => (v && isYearStart(v) ? v : '01-01'),
    write: (v) => {
      if (!isYearStart(String(v ?? ''))) throw new Error('Pick the day your financial year starts (1–28).');
      return v;
    },
  },
  taxEnabled: { key: 'tax_enabled', ...bool(false) },
  taxRatePpm: { key: 'tax_rate_ppm', ...int(100_000, 0, 500_000) },
  taxId: { key: 'tax_id', ...str() },
  taxBasis: { key: 'tax_basis', ...oneOf(['cash', 'accrual'], 'cash') },
  taxPeriod: { key: 'tax_period', ...oneOf(TAX_FREQUENCIES, 'quarterly') },
  pricesIncludeTax: { key: 'prices_include_tax', ...bool(true) },
  invoicePrefix: { key: 'invoice_prefix', ...str('INV-') },
  invoiceNext: { key: 'invoice_next', ...int(1, 1, 999999999) },
  billPrefix: { key: 'bill_prefix', ...str('BILL-') },
  billNext: { key: 'bill_next', ...int(1, 1, 999999999) },
  quotePrefix: { key: 'quote_prefix', ...str('QU-') },
  quoteNext: { key: 'quote_next', ...int(1, 1, 999999999) },
  creditPrefix: { key: 'credit_prefix', ...str('CN-') },
  creditNext: { key: 'credit_next', ...int(1, 1, 999999999) },
  paymentTermsDays: { key: 'payment_terms_days', ...int(14, 0, 365) },
  currencyDisplay: { key: 'currency_display', ...oneOf(CURRENCY_DISPLAYS, 'narrow') },
  documentCurrencyDisplay: { key: 'document_currency_display', ...oneOf(CURRENCY_DISPLAYS, 'symbol') },
  logo: {
    key: 'books_logo',
    parse: (v) => v ?? '',
    write: (v) => {
      const s = String(v ?? '');
      if (s && (!s.startsWith('data:image/') || s.length > 1_500_000)) throw new Error('The logo must be an image under about 1 MB.');
      return s;
    },
  },
  color: {
    key: 'books_color',
    parse: (v) => v ?? '',
    write: (v) => {
      const c = String(v ?? '').trim().toLowerCase();
      if (c && !/^#[0-9a-f]{6}$/.test(c)) throw new Error('Choose a colour.');
      return c;
    },
  },
  lockDate: {
    key: 'lock_date',
    parse: (v) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null),
    write: (v) => {
      if (v === null || v === '') return null;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error('Pick a lock date.');
      return v;
    },
  },
};

export function getSettings(): BooksSettings {
  const { db } = getBooks();
  const rows = db.prepare('SELECT key, value FROM meta').all() as { key: string; value: string }[];
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const out: any = {};
  for (const [name, f] of Object.entries(FIELDS)) out[name] = f.parse(map.get(f.key) ?? null);
  return out;
}

export function updateSettings(patch: Partial<BooksSettings>) {
  const { db } = getBooks();
  const writes: [string, string | null][] = [];
  for (const [name, value] of Object.entries(patch)) {
    const f = FIELDS[name as keyof BooksSettings];
    if (!f) continue;
    writes.push([f.key, f.write(value)]);
  }
  if (patch.name !== undefined && !String(patch.name).trim()) throw new Error('Enter your name.');
  db.transaction(() => {
    const set = db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');
    const del = db.prepare('DELETE FROM meta WHERE key = ?');
    for (const [k, v] of writes) (v === null ? del.run(k) : set.run(k, v));
    set.finalize();
    del.finalize();
  })();
  return getSettings();
}

/** Throws if any of the dates fall in a locked (lodged) period. */
export function assertUnlocked(...dates: (string | null | undefined)[]) {
  const lock = getSettings().lockDate;
  if (!lock) return;
  for (const d of dates) {
    if (d && d <= lock) {
      throw new Error(`The books are locked up to ${lock}, usually because a tax return was lodged. Unlock them in Settings to change this.`);
    }
  }
}

export function metaValue(key: string) {
  return one<{ value: string }>(getBooks().db, 'SELECT value FROM meta WHERE key = ?', key)?.value ?? null;
}
