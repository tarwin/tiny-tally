// Income, expenses, transfers and the contacts they name.
import { all, getBooks, one, run } from './db';
import { assertUnlocked, getSettings } from './settings';
import { TAX_CODE_MAP, isTaxCode, taxFromInclusive, type TaxCode } from '../src/shared/tax';

type EntryKind = 'income' | 'expense' | 'transfer';

export interface EntryInput {
  id?: number;
  date: string;
  kind: EntryKind;
  /** cents, > 0 */
  amount: number;
  accountId: number;
  toAccountId?: number | null;
  categoryId?: number | null;
  contactId?: number | null;
  memo?: string | null;
  /** Defaults to the category's code. */
  taxCode?: TaxCode | null;
  /** GST included in amount; computed from the code when omitted. */
  taxAmount?: number | null;
}

export interface EntryQuery {
  /** Register mode: rows touching this account, with a running balance. */
  accountId?: number;
  kind?: EntryKind;
  categoryId?: number;
  contactId?: number;
  from?: string;
  to?: string;
  q?: string;
  limit?: number;
  offset?: number;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Category classes kept off Profit & Loss, and the ones also kept off the BAS. */
export const NOT_PNL = ['tax', 'owner', 'loan', 'asset'];
export const OFF_BAS = ['tax', 'owner', 'loan'];

const SELECT_COLUMNS = `
  e.id, e.date, e.kind, e.amount, e.memo,
  e.account_id AS accountId, a.name AS accountName,
  e.to_account_id AS toAccountId, ta.name AS toAccountName,
  e.category_id AS categoryId, c.name AS categoryName,
  e.contact_id AS contactId, ct.name AS contactName,
  e.tax_code AS taxCode, e.tax_amount AS taxAmount,
  e.invoice_id AS invoiceId, inv.number AS invoiceNumber, inv.doc_type AS invoiceType,
  c.class AS categoryClass, e.rec_id AS recId, e.to_rec_id AS toRecId, e.schedule_id AS scheduleId`;

const JOINS = `
  JOIN accounts a ON a.id = e.account_id
  LEFT JOIN accounts ta ON ta.id = e.to_account_id
  LEFT JOIN categories c ON c.id = e.category_id
  LEFT JOIN contacts ct ON ct.id = e.contact_id
  LEFT JOIN invoices inv ON inv.id = e.invoice_id`;

const TABLE_COLS = {
  kind: 'e.kind', category: 'e.category_id', contact: 'e.contact_id', date: 'e.date',
  memo: 'e.memo', contactName: 'ct.name', categoryName: 'c.name',
};
// The same filters, applied to the register CTE's output columns.
const REGISTER_COLS: typeof TABLE_COLS = {
  kind: 'kind', category: 'categoryId', contact: 'contactId', date: 'date',
  memo: 'memo', contactName: 'contactName', categoryName: 'categoryName',
};

function filters(q: EntryQuery, col = TABLE_COLS) {
  const where: string[] = [];
  const args: any[] = [];
  if (q.kind) {
    where.push(`${col.kind} = ?`);
    args.push(q.kind);
  }
  if (q.categoryId) {
    where.push(`${col.category} = ?`);
    args.push(q.categoryId);
  }
  if (q.contactId) {
    where.push(`${col.contact} = ?`);
    args.push(q.contactId);
  }
  if (q.from && DATE.test(q.from)) {
    where.push(`${col.date} >= ?`);
    args.push(q.from);
  }
  if (q.to && DATE.test(q.to)) {
    where.push(`${col.date} <= ?`);
    args.push(q.to);
  }
  const text = q.q?.trim();
  if (text) {
    const like = '%' + text.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
    where.push(`(${col.memo} LIKE ? ESCAPE '\\' OR ${col.contactName} LIKE ? ESCAPE '\\' OR ${col.categoryName} LIKE ? ESCAPE '\\')`);
    args.push(like, like, like);
  }
  return { where, args };
}

export function listEntries(q: EntryQuery) {
  const { db } = getBooks();
  const limit = Math.min(Math.max(Number(q.limit) || 100, 1), 1000);
  const offset = Math.max(Number(q.offset) || 0, 0);
  const { where, args } = filters(q, q.accountId ? REGISTER_COLS : TABLE_COLS);
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';

  if (q.accountId) {
    const acct = one<{ opening_balance: number }>(db, 'SELECT opening_balance FROM accounts WHERE id = ?', q.accountId);
    if (!acct) throw new Error('That account no longer exists.');
    // Running balance is computed over every row in the account, before the
    // filters, so a filtered register still shows true balances.
    const base = `
      WITH reg AS (
        SELECT ${SELECT_COLUMNS},
          CASE
            WHEN e.to_account_id = ?1 THEN e.amount
            WHEN e.kind = 'income' THEN e.amount
            ELSE -e.amount
          END AS signed
        FROM entries e ${JOINS}
        WHERE e.account_id = ?1 OR e.to_account_id = ?1
      ),
      bal AS (
        SELECT reg.*, ?2 + SUM(signed) OVER (ORDER BY date, id ROWS UNBOUNDED PRECEDING) AS balance
        FROM reg
      )`;
    const head = [q.accountId, acct.opening_balance];
    const rows = all(db, `${base} SELECT * FROM bal ${whereSql} ORDER BY date DESC, id DESC LIMIT ${limit} OFFSET ${offset}`,
      ...head, ...args);
    const agg = one<{ total: number; inflow: number; outflow: number }>(db,
      `${base} SELECT COUNT(*) AS total,
         COALESCE(SUM(CASE WHEN signed > 0 THEN signed END), 0) AS inflow,
         COALESCE(SUM(CASE WHEN signed < 0 THEN -signed END), 0) AS outflow
       FROM bal ${whereSql}`, ...head, ...args)!;
    return { rows, total: agg.total, inflow: agg.inflow, outflow: agg.outflow };
  }

  const rows = all(db,
    `SELECT ${SELECT_COLUMNS},
       CASE e.kind WHEN 'income' THEN e.amount WHEN 'expense' THEN -e.amount ELSE 0 END AS signed
     FROM entries e ${JOINS} ${whereSql}
     ORDER BY e.date DESC, e.id DESC LIMIT ${limit} OFFSET ${offset}`, ...args);
  const agg = one<{ total: number; inflow: number; outflow: number }>(db,
    `SELECT COUNT(*) AS total,
       COALESCE(SUM(CASE WHEN e.kind = 'income' THEN e.amount END), 0) AS inflow,
       COALESCE(SUM(CASE WHEN e.kind = 'expense' THEN e.amount END), 0) AS outflow
     FROM entries e ${JOINS} ${whereSql}`, ...args)!;
  return { rows, total: agg.total, inflow: agg.inflow, outflow: agg.outflow };
}

function requireRow(table: string, id: unknown, what: string) {
  // Check before binding: tjs:sqlite doesn't treat an undefined param as NULL.
  if (typeof id !== 'number' || !Number.isInteger(id)) throw new Error(`Choose ${what}.`);
  const row = one(getBooks().db, `SELECT * FROM ${table} WHERE id = ?`, id);
  if (!row) throw new Error(`Choose ${what}.`);
  return row;
}

export function saveEntry(input: EntryInput) {
  const { db } = getBooks();
  const kind = input.kind;
  if (!['income', 'expense', 'transfer'].includes(kind)) throw new Error('Unknown transaction type.');
  if (!DATE.test(String(input.date))) throw new Error('Pick a date.');
  const amount = Math.round(Number(input.amount));
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Enter an amount greater than zero.');

  const existing = input.id ? one<any>(db, 'SELECT * FROM entries WHERE id = ?', input.id) : null;
  if (input.id && !existing) throw new Error('That transaction no longer exists.');
  if (existing?.invoice_id) throw new Error('This is a payment on an invoice or bill. Change it from there.');
  if (existing && (existing.rec_id || existing.to_rec_id)) {
    const same = existing.date === input.date && existing.amount === Math.round(Number(input.amount))
      && existing.account_id === input.accountId && existing.kind === input.kind
      && (existing.to_account_id ?? null) === (input.toAccountId ?? null);
    if (!same) throw new Error('This transaction is reconciled, so its date, amount and accounts are fixed. Undo the reconciliation to change them.');
  }
  assertUnlocked(input.date, existing?.date);
  const settings = getSettings();

  const account = requireRow('accounts', input.accountId, kind === 'transfer' ? 'the account the money comes from' : 'an account');
  // Archived accounts/categories stay valid on rows that already use them.
  if (account.is_archived && existing?.account_id !== account.id && existing?.to_account_id !== account.id) {
    throw new Error(`${account.name} is archived. Restore it to record new transactions.`);
  }

  let toAccountId: number | null = null;
  let categoryId: number | null = null;
  let taxCode: TaxCode | null = null;
  let taxAmount = 0;
  if (kind === 'transfer') {
    const to = requireRow('accounts', input.toAccountId, 'the account the money goes to');
    if (to.id === account.id) throw new Error('Pick two different accounts for a transfer.');
    if (to.is_archived && existing?.to_account_id !== to.id && existing?.account_id !== to.id) {
      throw new Error(`${to.name} is archived. Restore it to record new transactions.`);
    }
    toAccountId = to.id;
  } else {
    const cat = requireRow('categories', input.categoryId, 'a category');
    if (cat.kind !== kind) throw new Error(`“${cat.name}” is an ${cat.kind} category.`);
    if (cat.is_archived && existing?.category_id !== cat.id) {
      throw new Error(`“${cat.name}” is archived. Restore it or pick another category.`);
    }
    categoryId = cat.id;
    // Tax payments, owner's money and loans are never on the BAS.
    if (settings.taxEnabled && OFF_BAS.includes(cat.class)) taxCode = 'NTR';
    else if (settings.taxEnabled) {
      const code: TaxCode = isTaxCode(input.taxCode) ? input.taxCode : isTaxCode(cat.tax_code) ? cat.tax_code : 'GST';
      taxCode = code;
      const override = input.taxAmount;
      if (!TAX_CODE_MAP[code].taxable) taxAmount = 0;
      else if (typeof override === 'number' && Number.isFinite(override)) {
        taxAmount = Math.round(override);
        if (taxAmount < 0 || taxAmount > amount) throw new Error("GST can't be more than the amount.");
      } else taxAmount = taxFromInclusive(amount, code, settings.taxRateBp);
    }
  }

  let contactId: number | null = null;
  if (input.contactId) contactId = requireRow('contacts', input.contactId, 'a contact').id;

  const memo = typeof input.memo === 'string' && input.memo.trim() ? input.memo.trim() : null;

  if (existing) {
    run(db,
      `UPDATE entries SET date = ?, kind = ?, amount = ?, account_id = ?, to_account_id = ?, category_id = ?,
         contact_id = ?, memo = ?, tax_code = ?, tax_amount = ?, updated_at = datetime('now') WHERE id = ?`,
      input.date, kind, amount, account.id, toAccountId, categoryId, contactId, memo, taxCode, taxAmount, existing.id);
    return existing.id as number;
  }
  return one<{ id: number }>(db,
    `INSERT INTO entries (date, kind, amount, account_id, to_account_id, category_id, contact_id, memo, tax_code, tax_amount)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    input.date, kind, amount, account.id, toAccountId, categoryId, contactId, memo, taxCode, taxAmount)!.id;
}

export function deleteEntry(id: number) {
  const { db } = getBooks();
  const existing = one<any>(db, 'SELECT * FROM entries WHERE id = ?', id);
  if (!existing) return true;
  assertUnlocked(existing.date);
  if (existing.rec_id || existing.to_rec_id) throw new Error('This transaction is reconciled. Undo the reconciliation to delete it.');
  run(db, 'DELETE FROM entries WHERE id = ?', id);
  return true;
}

/**
 * Income and expense totals (transfers excluded) for a date range, GST
 * exclusive. Invoice payments are spread over their invoice's categories.
 */
export function summarise({ from, to, basis }: { from: string; to: string; basis?: 'cash' | 'accrual' }) {
  const { db } = getBooks();
  if (!DATE.test(from) || !DATE.test(to)) throw new Error('Pick a date range.');
  const view = basis === 'accrual' ? 'ledger_accrual' : 'ledger_cash';
  const byCategory = all(db,
    `SELECT COALESCE(c.id, 0) AS id, COALESCE(c.name, 'Uncategorised') AS name, l.kind,
            SUM(l.gross - l.tax) AS total, SUM(l.tax) AS tax, COUNT(*) AS count
     FROM ${view} l LEFT JOIN categories c ON c.id = l.category_id
     WHERE l.date BETWEEN ? AND ? AND COALESCE(c.class, 'pnl') = 'pnl'
     GROUP BY l.kind, c.id ORDER BY total DESC`, from, to);
  const income = byCategory.filter((r: any) => r.kind === 'income').reduce((s: number, r: any) => s + r.total, 0);
  const expense = byCategory.filter((r: any) => r.kind === 'expense').reduce((s: number, r: any) => s + r.total, 0);
  // Money in and out that isn't profit or loss: GST paid, drawings, loans, assets.
  const other = all(db,
    `SELECT c.id, c.name, c.class, l.kind, SUM(l.gross) AS total, COUNT(*) AS count
     FROM ${view} l JOIN categories c ON c.id = l.category_id
     WHERE l.date BETWEEN ? AND ? AND c.class <> 'pnl'
     GROUP BY c.id ORDER BY c.class, l.kind, total DESC`, from, to);
  return { income, expense, byCategory, other };
}

// ---- contacts --------------------------------------------------------------

export interface ContactInput {
  id?: number;
  kind: 'customer' | 'vendor';
  name: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  notes?: string | null;
  /** Customers: the trading name to invoice them as (null = the default). */
  tradingNameId?: number | null;
}

export function listContacts() {
  return all(getBooks().db,
    `SELECT ct.id, ct.kind, ct.name, ct.email, ct.phone, ct.address, ct.notes, ct.is_archived AS archived,
       ct.trading_name_id AS tradingNameId,
       COUNT(e.id) AS uses,
       COALESCE(SUM(CASE WHEN e.kind = 'income' THEN e.amount END), 0) AS received,
       COALESCE(SUM(CASE WHEN e.kind = 'expense' THEN e.amount END), 0) AS paid,
       MAX(e.date) AS lastDate
     FROM contacts ct LEFT JOIN entries e ON e.contact_id = ct.id
     GROUP BY ct.id
     ORDER BY ct.is_archived, ct.name COLLATE NOCASE`,
  ).map((r: any) => ({ ...r, archived: !!r.archived }));
}

const clean = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

export function saveContact(input: ContactInput) {
  const { db } = getBooks();
  const name = clean(input.name);
  if (!name) throw new Error('Give the contact a name.');
  if (input.kind !== 'customer' && input.kind !== 'vendor') throw new Error('Choose customer or vendor.');
  const tradingNameId = input.kind === 'customer' && typeof input.tradingNameId === 'number'
    && one(db, 'SELECT id FROM trading_names WHERE id = ?', input.tradingNameId) ? input.tradingNameId : null;
  const fields = [input.kind, name, clean(input.email), clean(input.phone), clean(input.address), clean(input.notes), tradingNameId];
  if (input.id) {
    run(db, 'UPDATE contacts SET kind = ?, name = ?, email = ?, phone = ?, address = ?, notes = ?, trading_name_id = ? WHERE id = ?',
      ...fields, input.id);
    return input.id;
  }
  return one<{ id: number }>(db,
    'INSERT INTO contacts (kind, name, email, phone, address, notes, trading_name_id) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id',
    ...fields)!.id;
}

export function archiveContact(id: number, archived: boolean) {
  run(getBooks().db, 'UPDATE contacts SET is_archived = ? WHERE id = ?', archived ? 1 : 0, id);
  return true;
}
