// Company settings live as key/value rows in `meta`.
import { getCompany, one } from './db';

export interface CompanySettings {
  name: string;
  currency: string;
  fiscalYearStart: number;
  taxEnabled: boolean;
  taxRateBp: number;
  abn: string;
  taxBasis: 'cash' | 'accrual';
  basFrequency: 'monthly' | 'quarterly' | 'annual';
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
  businessAddress: string;
  businessEmail: string;
  businessPhone: string;
  /** '#rrggbb' or '' — the stripe beside the menu that tells open companies apart. */
  color: string;
  /** data: URL, or '' — shown top left instead of the app's logo. */
  logo: string;
  /** Entries dated on or before this can't change (set by lodging a BAS). */
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

const FIELDS: Record<keyof CompanySettings, Field> = {
  name: { key: 'company_name', ...str('Company') },
  currency: { key: 'currency', ...str('USD') },
  fiscalYearStart: { key: 'fiscal_year_start', ...int(1, 1, 12) },
  taxEnabled: { key: 'tax_enabled', ...bool(false) },
  taxRateBp: { key: 'tax_rate_bp', ...int(1000, 0, 5000) },
  abn: { key: 'abn', ...str() },
  taxBasis: { key: 'tax_basis', ...oneOf(['cash', 'accrual'], 'cash') },
  basFrequency: { key: 'bas_frequency', ...oneOf(['monthly', 'quarterly', 'annual'], 'quarterly') },
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
  businessAddress: { key: 'business_address', ...str() },
  businessEmail: { key: 'business_email', ...str() },
  businessPhone: { key: 'business_phone', ...str() },
  logo: {
    key: 'company_logo',
    parse: (v) => v ?? '',
    write: (v) => {
      const s = String(v ?? '');
      if (s && (!s.startsWith('data:image/') || s.length > 1_500_000)) throw new Error('The logo must be an image under about 1 MB.');
      return s;
    },
  },
  color: {
    key: 'company_color',
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

export function getSettings(): CompanySettings {
  const { db } = getCompany();
  const rows = db.prepare('SELECT key, value FROM meta').all() as { key: string; value: string }[];
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const out: any = {};
  for (const [name, f] of Object.entries(FIELDS)) out[name] = f.parse(map.get(f.key) ?? null);
  return out;
}

export function updateSettings(patch: Partial<CompanySettings>) {
  const { db } = getCompany();
  const writes: [string, string | null][] = [];
  for (const [name, value] of Object.entries(patch)) {
    const f = FIELDS[name as keyof CompanySettings];
    if (!f) continue;
    writes.push([f.key, f.write(value)]);
  }
  if (patch.name !== undefined && !String(patch.name).trim()) throw new Error('Give the company a name.');
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
      throw new Error(`The books are locked up to ${lock} (a BAS was lodged). Unlock them in Settings to change this.`);
    }
  }
}

export function metaValue(key: string) {
  return one<{ value: string }>(getCompany().db, 'SELECT value FROM meta WHERE key = ?', key)?.value ?? null;
}
