import type { Database } from 'tjs:sqlite';
import { COUNTRIES, type Country, type SeedCategory } from '../src/shared/countries';

export interface BooksSetup {
  name: string;
  country: Country;
  /** 'MM-DD', the day the financial year starts. */
  fiscalYearStart: string;
  /** Registered for the country's tax (only where it's supported). */
  taxEnabled?: boolean;
}

export function seedBooks(db: Database, setup: BooksSetup) {
  const profile = COUNTRIES[setup.country];
  const meta = db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');
  meta.run('books_name', setup.name);
  meta.run('country', profile.code);
  meta.run('currency', profile.currency);
  meta.run('fiscal_year_start', setup.fiscalYearStart);
  meta.run('created_at', new Date().toISOString());
  meta.run('tax_enabled', profile.tax && (setup.taxEnabled ?? true) ? '1' : '0');
  if (profile.tax) meta.run('tax_rate_bp', String(profile.tax.defaultRateBp));
  meta.run('tax_basis', 'cash');
  meta.run('bas_frequency', 'quarterly');
  meta.run('prices_include_tax', '1');
  meta.run('invoice_prefix', 'INV-');
  meta.run('invoice_next', '1');
  meta.run('payment_terms_days', '14');
  meta.finalize();

  // The v3 migration already ran on this fresh file and found no categories,
  // so set codes here.
  const cat = db.prepare('INSERT INTO categories (name, kind, class, sort, tax_code) VALUES (?, ?, ?, ?, ?)');
  // Off-P&L categories sort after the rest, as they always have.
  const add = (kind: 'income' | 'expense') => (c: SeedCategory, i: number) => cat.run(c.name, kind, c.class ?? 'pnl', c.class ? 90 + i : i, c.taxCode);
  profile.categories.income.forEach(add('income'));
  profile.categories.expense.forEach(add('expense'));
  cat.finalize();

  const today = new Date().toISOString().slice(0, 10);
  db.prepare("INSERT INTO accounts (name, kind, opening_date, sort) VALUES ('Business Account', 'bank', ?, 0)").run(today);
}
