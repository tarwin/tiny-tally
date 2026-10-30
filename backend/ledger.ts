// Double-entry view of the books, derived on demand (nothing extra is stored).
//
// Tiny Tally records single entries, but every one names both sides, so a
// journal falls out of them. This is the accrual view an accountant expects:
// approved invoices and bills go through receivables/payables and payments
// clear them; GST sits in one liability account.
//
//   income entry      Dr money        Cr category (net), Cr GST
//   expense entry     Dr category, Dr GST                 Cr money
//   transfer          Dr to-account                       Cr from-account
//   invoice           Dr receivables  Cr lines (net), Cr GST
//   credit note       Dr lines, Dr GST                    Cr receivables
//   bill              Dr lines, Dr GST                    Cr payables
//   invoice payment   Dr money        Cr receivables
//   bill payment      Dr payables     Cr money
//   credit refund     Dr receivables  Cr money
//   opening balance   Dr money        Cr opening balance equity
//   manual journal    whatever its lines say (journals.ts)
import { all, getCompany } from './db';
import { SYSTEM_ACCOUNTS, journalLinesTo } from './journals';

export type LedgerType = 'asset' | 'liability' | 'equity' | 'income' | 'expense';

export interface LedgerAccount {
  key: string;
  name: string;
  type: LedgerType;
  group: string;
}

export interface JournalLine {
  date: string;
  ref: string;
  memo: string;
  account: string;
  /** cents; debit positive, credit negative */
  amount: number;
}

const AR: LedgerAccount = { key: 'ar', name: 'Accounts receivable', type: 'asset', group: 'Money owed to you' };
const AP: LedgerAccount = { key: 'ap', name: 'Accounts payable', type: 'liability', group: 'Money you owe' };
const GST: LedgerAccount = { key: 'gst', name: 'GST', type: 'liability', group: 'Tax' };
const OPENING: LedgerAccount = { key: 'opening', name: 'Opening balance equity', type: 'equity', group: 'Equity' };

function chart() {
  const { db } = getCompany();
  const accounts = new Map<string, LedgerAccount>();
  for (const a of [AR, AP, GST, OPENING]) accounts.set(a.key, a);
  // Only manual journals post to these; they show once they have a balance.
  for (const key of ['accruals', 'prepayments', 'accumdep'] as const) accounts.set(key, { key, ...SYSTEM_ACCOUNTS[key] });
  const money = all<any>(db, 'SELECT id, name, kind, opening_balance, opening_date FROM accounts');
  for (const a of money) {
    accounts.set(`acct:${a.id}`, {
      key: `acct:${a.id}`,
      name: a.name,
      type: a.kind === 'credit_card' ? 'liability' : 'asset',
      group: a.kind === 'credit_card' ? 'Credit cards' : 'Bank and cash',
    });
  }
  const cats = all<any>(db, 'SELECT id, name, kind, class FROM categories');
  const catKey = new Map<number, string>();
  for (const c of cats) {
    let acct: LedgerAccount;
    if (c.class === 'pnl') acct = { key: `cat:${c.id}`, name: c.name, type: c.kind, group: c.kind === 'income' ? 'Income' : 'Expenses' };
    else if (c.class === 'tax' && /gst|bas/i.test(c.name)) acct = GST;
    else if (c.class === 'tax') acct = { key: `cat:${c.id}`, name: c.name, type: 'asset', group: 'Tax paid in advance' };
    else if (c.class === 'loan') acct = { key: 'loans', name: 'Loans', type: 'liability', group: 'Loans' };
    else if (c.class === 'owner') acct = { key: `cat:${c.id}`, name: c.name, type: 'equity', group: 'Equity' };
    else acct = { key: `cat:${c.id}`, name: c.name, type: 'asset', group: 'Assets' };
    accounts.set(acct.key, acct);
    catKey.set(c.id, acct.key);
  }
  accounts.set('uncat', { key: 'uncat', name: 'Uncategorised', type: 'expense', group: 'Expenses' });
  return { accounts, catKey, money };
}

/** Every journal line up to `to` (and from `from`, when given), in date order. */
export function journal(p: { from?: string; to: string }) {
  const { db } = getCompany();
  const { accounts, catKey, money } = chart();
  const lines: JournalLine[] = [];
  const cat = (id: number | null) => (id !== null && catKey.has(id) ? catKey.get(id)! : 'uncat');
  const push = (date: string, ref: string, memo: string, account: string, amount: number) => {
    if (amount !== 0) lines.push({ date, ref, memo, account, amount });
  };

  for (const a of money) {
    if (a.opening_balance) {
      push(a.opening_date, 'Opening', `Opening balance · ${a.name}`, `acct:${a.id}`, a.opening_balance);
      push(a.opening_date, 'Opening', `Opening balance · ${a.name}`, 'opening', -a.opening_balance);
    }
  }

  const entries = all<any>(db,
    `SELECT e.id, e.date, e.kind, e.amount, e.tax_amount AS tax, e.account_id, e.to_account_id, e.category_id, e.memo,
            ct.name AS contact, i.doc_type AS docType, i.number
     FROM entries e LEFT JOIN contacts ct ON ct.id = e.contact_id LEFT JOIN invoices i ON i.id = e.invoice_id
     WHERE e.date <= ? ORDER BY e.date, e.id`, p.to);
  for (const e of entries) {
    const ref = e.number ?? `T${e.id}`;
    const memo = [e.contact, e.memo].filter(Boolean).join(': ') || (e.kind === 'transfer' ? 'Transfer' : '');
    const bank = `acct:${e.account_id}`;
    if (e.kind === 'transfer') {
      push(e.date, ref, memo, `acct:${e.to_account_id}`, e.amount);
      push(e.date, ref, memo, bank, -e.amount);
    } else if (e.docType) {
      const other = e.docType === 'bill' ? 'ap' : 'ar';
      const sign = e.kind === 'income' ? 1 : -1;
      push(e.date, ref, memo || `Payment ${e.number}`, bank, sign * e.amount);
      push(e.date, ref, memo || `Payment ${e.number}`, other, -sign * e.amount);
    } else if (e.kind === 'income') {
      push(e.date, ref, memo, bank, e.amount);
      push(e.date, ref, memo, cat(e.category_id), -(e.amount - e.tax));
      push(e.date, ref, memo, 'gst', -e.tax);
    } else {
      push(e.date, ref, memo, cat(e.category_id), e.amount - e.tax);
      push(e.date, ref, memo, 'gst', e.tax);
      push(e.date, ref, memo, bank, -e.amount);
    }
  }

  const docs = all<any>(db,
    `SELECT i.id, i.doc_type AS docType, i.number, i.issue_date AS date, i.total, ct.name AS contact
     FROM invoices i JOIN contacts ct ON ct.id = i.contact_id
     WHERE i.status = 'sent' AND i.doc_type IN ('invoice', 'bill', 'credit') AND i.issue_date <= ?
     ORDER BY i.issue_date, i.id`, p.to);
  const docLines = all<any>(db,
    `SELECT l.invoice_id, l.category_id, l.net, l.tax FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id
     WHERE i.status = 'sent' AND i.doc_type IN ('invoice', 'bill', 'credit') ORDER BY l.sort, l.id`);
  const byDoc = new Map<number, any[]>();
  for (const l of docLines) (byDoc.get(l.invoice_id) ?? byDoc.set(l.invoice_id, []).get(l.invoice_id)!).push(l);
  for (const d of docs) {
    // Invoices credit income; credit notes and bills debit it (or the expense).
    const sign = d.docType === 'invoice' ? -1 : 1;
    const control = d.docType === 'bill' ? 'ap' : 'ar';
    push(d.date, d.number, d.contact, control, -sign * d.total);
    for (const l of byDoc.get(d.id) ?? []) {
      push(d.date, d.number, d.contact, cat(l.category_id), sign * l.net);
      push(d.date, d.number, d.contact, 'gst', sign * l.tax);
    }
  }

  for (const l of journalLinesTo(p.to)) {
    const account = l.category_id !== null ? cat(l.category_id) : l.system;
    push(l.date, l.reference || `J${l.id}`, l.memo || l.journalMemo || 'Journal entry', account, l.amount);
  }

  lines.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { accounts: [...accounts.values()], lines: p.from ? lines.filter((l) => l.date >= p.from!) : lines };
}

const ORDER: LedgerType[] = ['asset', 'liability', 'equity', 'income', 'expense'];

/**
 * What a manual journal line can post to: every category (by its ledger
 * account) and the ledger's own accounts, but not money accounts,
 * receivables or payables (see schema v7).
 */
export function journalAccounts() {
  const { db } = getCompany();
  const { accounts, catKey } = chart();
  const cats = all<any>(db, 'SELECT id, name, kind, class, is_archived FROM categories ORDER BY name COLLATE NOCASE');
  const out: { key: string; name: string; type: LedgerType; group: string; archived: boolean }[] = [];
  for (const c of cats) {
    const a = accounts.get(catKey.get(c.id)!)!;
    // Several categories share GST and Loans; offer the shared account under each name.
    out.push({ key: `cat:${c.id}`, name: c.name, type: a.type, group: a.group, archived: !!c.is_archived });
  }
  for (const key of Object.keys(SYSTEM_ACCOUNTS) as (keyof typeof SYSTEM_ACCOUNTS)[]) {
    out.push({ key, ...SYSTEM_ACCOUNTS[key], archived: false });
  }
  return out.sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type) || a.name.localeCompare(b.name));
}

/** Balance of every account as at `asOf`. Debits and credits always total the same. */
export function trialBalance(asOf: string) {
  const { accounts, lines } = journal({ to: asOf });
  const totals = new Map<string, number>();
  for (const l of lines) totals.set(l.account, (totals.get(l.account) ?? 0) + l.amount);
  const map = new Map(accounts.map((a) => [a.key, a]));
  const rows = [...totals.entries()]
    .filter(([, v]) => v !== 0)
    .map(([key, v]) => ({ ...map.get(key)!, debit: v > 0 ? v : 0, credit: v < 0 ? -v : 0 }))
    .sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type) || a.name.localeCompare(b.name));
  return {
    rows,
    debit: rows.reduce((s, r) => s + r.debit, 0),
    credit: rows.reduce((s, r) => s + r.credit, 0),
  };
}

/**
 * Assets, liabilities and equity at `asOf`. Profit is split into earlier
 * years (retained) and this financial year so far.
 */
export function balanceSheet(p: { asOf: string; yearStart: string }) {
  const { accounts, lines } = journal({ to: p.asOf });
  const map = new Map(accounts.map((a) => [a.key, a]));
  const bal = new Map<string, number>();
  let retained = 0;
  let current = 0;
  for (const l of lines) {
    const a = map.get(l.account)!;
    if (a.type === 'income' || a.type === 'expense') {
      // Profit is a credit; flip so profit is positive.
      if (l.date < p.yearStart) retained -= l.amount;
      else current -= l.amount;
    } else bal.set(l.account, (bal.get(l.account) ?? 0) + l.amount);
  }
  const section = (type: LedgerType) => {
    // Assets show debit balances as positive; liabilities and equity show credits as positive.
    const sign = type === 'asset' ? 1 : -1;
    const groups = new Map<string, { name: string; key: string; amount: number }[]>();
    for (const [key, v] of bal) {
      const a = map.get(key)!;
      if (a.type !== type || v === 0) continue;
      const g = groups.get(a.group) ?? groups.set(a.group, []).get(a.group)!;
      g.push({ name: a.name, key, amount: sign * v });
    }
    return [...groups.entries()].map(([group, items]) => ({
      group,
      items: items.sort((a, b) => a.name.localeCompare(b.name)),
      total: items.reduce((s, i) => s + i.amount, 0),
    }));
  };
  const assets = section('asset');
  const liabilities = section('liability');
  const equity = section('equity');
  equity.push({
    group: 'Profit',
    items: [
      { name: 'Earlier years', key: 'retained', amount: retained },
      { name: 'This financial year', key: 'current', amount: current },
    ].filter((i) => i.amount !== 0),
    total: retained + current,
  });
  const sum = (s: { total: number }[]) => s.reduce((t, g) => t + g.total, 0);
  return {
    assets,
    liabilities,
    equity,
    totals: { assets: sum(assets), liabilities: sum(liabilities), equity: sum(equity) },
  };
}
