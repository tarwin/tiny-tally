import type { Database } from 'tjs:sqlite';

export interface BooksSetup {
  name: string;
  currency: string;
  /** 1–12, the month the financial year starts in. */
  fiscalYearStart: number;
  /** Registered for GST (Australia). */
  taxEnabled?: boolean;
}

/** Default tax codes for the seeded categories (anything else gets GST). */
const CATEGORY_TAX: Record<string, string> = {
  'Interest Income': 'INP',
  'Bank Fees': 'FRE',
  'Taxes & Licences': 'FRE',
  Equipment: 'CAP',
};

const INCOME = ['Sales', 'Services', 'Interest Income', 'Other Income'];

const EXPENSE = [
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
];

export function seedBooks(db: Database, setup: BooksSetup) {
  const meta = db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');
  meta.run('books_name', setup.name);
  meta.run('currency', setup.currency);
  meta.run('fiscal_year_start', String(setup.fiscalYearStart));
  meta.run('created_at', new Date().toISOString());
  meta.run('tax_enabled', (setup.taxEnabled ?? setup.currency === 'AUD') ? '1' : '0');
  meta.run('tax_basis', 'cash');
  meta.run('bas_frequency', 'quarterly');
  meta.run('prices_include_tax', '1');
  meta.run('invoice_prefix', 'INV-');
  meta.run('invoice_next', '1');
  meta.run('payment_terms_days', '14');
  meta.finalize();

  // The v3 migration already ran on this fresh file and found no categories,
  // so set codes here.
  const cat = db.prepare('INSERT INTO categories (name, kind, sort, tax_code) VALUES (?, ?, ?, ?)');
  INCOME.forEach((name, i) => cat.run(name, 'income', i, CATEGORY_TAX[name] ?? 'GST'));
  EXPENSE.forEach((name, i) => cat.run(name, 'expense', i, CATEGORY_TAX[name] ?? 'GST'));
  cat.finalize();

  const today = new Date().toISOString().slice(0, 10);
  db.prepare("INSERT INTO accounts (name, kind, opening_date, sort) VALUES ('Business Account', 'bank', ?, 0)").run(today);
}
