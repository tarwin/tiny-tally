// QuickBooks Online report exports (CSV or Excel): the Journal report and
// Transaction List by Date. Both start with a few title rows, then a header
// row, then the transactions, then totals.
//
//   Journal           one row per line, Debit/Credit columns; a transaction's
//                     first row carries its date, the rest leave it blank.
//   Transaction List  one row per transaction: Account, Split and Amount (from
//                     the Account's side). "-Split-" means several categories,
//                     which this report can't show: use the Journal instead.
//
// QuickBooks Online doesn't say which accounts are bank or card accounts, so
// they're learned from the transaction types (a Deposit's debit, an Expense's
// credit, both sides of a Transfer) with the account name as a fallback.
import { hashRef, type ImportBatch, type ImportCategory } from '../../shared/import';
import { detectDateOrder, occurrenceRefs, parseAmount, parseDate, type DateOrder } from './parse';
import { splitTransactions, type SplitLine, type SplitTxn } from './split';

type Kind = 'journal' | 'list';

/** Types whose money side is the one credit. */
const OUT_TYPES = /^(expense|check|cheque|cheque expense|cash expense|credit card expense|bill payment.*|refund|payroll.*)$/i;
/** Types whose money side is the one debit. */
const IN_TYPES = /^(deposit|sales receipt|payment|receive payment|credit card credit)$/i;
const NON_CASH = /^(invoice|bill|estimate|quote|purchase order|credit memo|vendor credit|journal entry|inventory.*|delayed.*|statement charge)$/i;
const MONEY_NAME = /\b(bank|cheque|chequing|checking|savings?|credit card|visa|mastercard|amex|american express|cash on hand|petty cash|undeposited|paypal|stripe|square|offset|everyday)\b/i;
const NOT_MONEY_NAME = /\b(charges?|fees?|interest|loan|revaluation|expense|income)\b/i;
const CARD_NAME = /\b(card|visa|mastercard|amex|american express)\b/i;

const norm = (s: string | undefined) => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

function findHeader(rows: string[][]): { index: number; kind: Kind; col: Record<string, number> } | null {
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const cells = rows[i].map(norm);
    const at = (...names: string[]) => cells.findIndex((c) => names.includes(c));
    const col = {
      date: at('date', 'transaction date'),
      type: at('transaction type', 'type'),
      num: at('num', 'no.', 'number'),
      name: at('name', 'payee', 'customer/supplier'),
      memo: at('memo/description', 'memo', 'description'),
      account: at('account', 'account name', 'account full name'),
      split: at('split', 'split account'),
      amount: at('amount'),
      debit: at('debit'),
      credit: at('credit'),
      posting: at('posting'),
    };
    if (col.date < 0 || col.account < 0) continue;
    if (col.debit >= 0 && col.credit >= 0) return { index: i, kind: 'journal', col };
    if (col.split >= 0 && col.amount >= 0) return { index: i, kind: 'list', col };
  }
  return null;
}

export function looksLikeQboReport(rows: string[][]) {
  return !!findHeader(rows);
}

export interface QboReportParse extends ImportBatch {
  dateOrder: DateOrder;
  report: Kind;
  /** QuickBooks-style account type guessed from the name ('AR', 'AP' or ''). */
  categoryTypes: Record<string, string>;
}

export function parseQboReport(rows: string[][], order?: DateOrder, fallbackOrder: DateOrder = 'dmy'): QboReportParse {
  const head = findHeader(rows)!;
  const { col } = head;
  const cell = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '').trim() : '');
  const body = rows.slice(head.index + 1).filter((r) => !/^total\b/i.test(cell(r, 0)) && !/^total\b/i.test(cell(r, col.date)));
  const dateOrder = order ?? detectDateOrder(body.slice(0, 500).map((r) => cell(r, col.date)).filter(Boolean), fallbackOrder);

  // ---- rows -> raw transactions ----
  type Raw = { date: string; type: string; num: string; memo: string; lines: SplitLine[]; splitUnknown?: boolean };
  const raws: Raw[] = [];
  let badDate = 0;
  let current: Raw | null = null;
  for (const r of body) {
    const account = cell(r, col.account);
    const rawDate = cell(r, col.date);
    if (head.kind === 'journal') {
      if (rawDate || cell(r, col.type)) {
        const date = parseDate(rawDate, dateOrder);
        current = null;
        if (!date) {
          if (account) badDate++;
          continue;
        }
        current = { date, type: cell(r, col.type), num: cell(r, col.num), memo: cell(r, col.memo), lines: [] };
        raws.push(current);
      }
      if (!current || !account) continue;
      const amount = (parseAmount(cell(r, col.debit)) ?? 0) - (parseAmount(cell(r, col.credit)) ?? 0);
      if (amount) current.lines.push({ accnt: account, amount, name: cell(r, col.name), memo: cell(r, col.memo) });
    } else {
      if (!account || !rawDate) continue;
      if (col.posting >= 0 && norm(cell(r, col.posting)) === 'no') continue;
      const date = parseDate(rawDate, dateOrder);
      if (!date) {
        badDate++;
        continue;
      }
      const amount = parseAmount(cell(r, col.amount)) ?? 0;
      const split = cell(r, col.split);
      const name = cell(r, col.name);
      const memo = cell(r, col.memo);
      raws.push({
        date,
        type: cell(r, col.type),
        num: cell(r, col.num),
        memo,
        splitUnknown: /^-?split-?$/i.test(split),
        lines: [
          { accnt: account, amount, name, memo },
          { accnt: split, amount: -amount, name, memo },
        ],
      });
    }
  }

  // ---- which accounts hold money ----
  const learned = new Set<string>();
  for (const t of raws) {
    if (/^transfer$/i.test(t.type)) t.lines.forEach((l) => learned.add(l.accnt));
    else if (head.kind === 'list' && (OUT_TYPES.test(t.type) || IN_TYPES.test(t.type) || /credit card payment/i.test(t.type))) learned.add(t.lines[0].accnt);
    else {
      const credits = t.lines.filter((l) => l.amount < 0);
      const debits = t.lines.filter((l) => l.amount > 0);
      if (OUT_TYPES.test(t.type) && credits.length === 1) learned.add(credits[0].accnt);
      if (IN_TYPES.test(t.type) && debits.length === 1) learned.add(debits[0].accnt);
    }
  }
  const isMoney = (name: string) => learned.has(name) || (MONEY_NAME.test(name) && !NOT_MONEY_NAME.test(name));

  // A list row's Amount is from the Account's side, which QuickBooks signs
  // differently for card accounts. Money out must leave the money account.
  if (head.kind === 'list') {
    for (const t of raws) {
      const m = t.lines[0];
      if (!isMoney(m.accnt)) continue;
      if ((OUT_TYPES.test(t.type) && m.amount > 0) || (IN_TYPES.test(t.type) && m.amount < 0)) t.lines.forEach((l) => (l.amount = -l.amount));
    }
  }

  // ---- batch ----
  const accounts: ImportBatch['accounts'] = [];
  const accountKeys = new Set<string>();
  const categories: ImportCategory[] = [];
  const categoryTypes: Record<string, string> = {};
  const catKeys = new Set<string>();
  const prettyName = (n: string) => n.replace(/:/g, ': ');
  const addCategory = (name: string, kind: 'income' | 'expense') => {
    const key = `${kind}:${name}`;
    if (!catKeys.has(key)) {
      catKeys.add(key);
      const type = /\b(accounts receivable|debtors|trade receivables)\b/i.test(name) ? 'AR' : /\b(accounts payable|creditors|trade payables)\b/i.test(name) ? 'AP' : '';
      categories.push({ key, name: prettyName(name), kind, class: classFromName(name) });
      categoryTypes[key] = type;
    }
    return key;
  };

  const txns: SplitTxn[] = [];
  let nonCash = 0;
  let unknownSplit = 0;
  for (const t of raws) {
    if (!t.lines.length) continue;
    if (t.splitUnknown) {
      if (t.lines.some((l) => isMoney(l.accnt))) unknownSplit++;
      continue;
    }
    if (NON_CASH.test(t.type) && !t.lines.some((l) => isMoney(l.accnt))) {
      nonCash++;
      continue;
    }
    const ref = hashRef('qbo', t.date, t.type, t.num, ...t.lines.map((l) => `${l.accnt}|${l.amount}|${l.name}|${l.memo}`));
    txns.push({ date: t.date, ref, memo: t.memo || undefined, lines: t.lines });
  }
  const { entries, noBank, complex } = splitTransactions(txns, {
    isMoney,
    addAccount: (name) => {
      if (accountKeys.has(name)) return;
      accountKeys.add(name);
      accounts.push({ key: name, name: prettyName(name), kind: CARD_NAME.test(name) ? 'credit_card' : 'bank' });
    },
    addCategory,
    ref: occurrenceRefs(),
  });

  const contacts: ImportBatch['contacts'] = [];
  const skipped: ImportBatch['skipped'] = [];
  if (nonCash + noBank) skipped.push({ reason: "Transactions that don't touch a bank or card account (invoices, bills, journals). Their payments are imported instead.", count: nonCash + noBank });
  if (unknownSplit) skipped.push({ reason: 'Transactions split across several categories, which this report doesn’t show. Export the Journal report to bring these in.', count: unknownSplit });
  if (complex) skipped.push({ reason: "Transactions across several bank or card accounts that couldn't be split", count: complex });
  if (badDate) skipped.push({ reason: "Transactions with a date that couldn't be read", count: badDate });

  return { source: 'qbo-report', accounts, categories, contacts, entries, skipped, dateOrder, report: head.kind, categoryTypes };
}

/** QuickBooks Online doesn't export account types in these reports; the name is the best guide. */
function classFromName(name: string): ImportCategory['class'] {
  if (/\b(gst|bas|payg|vat|sales tax|tax payable|ato|income tax)\b/i.test(name)) return 'tax';
  if (/\b(owner|drawings?|equity|capital|shareholder|partner|director'?s? loan)\b/i.test(name)) return /loan/i.test(name) ? 'loan' : 'owner';
  if (/\b(loan|borrowing|mortgage|hire purchase|chattel)\b/i.test(name)) return 'loan';
  if (/\b(equipment|vehicles?|furniture|computers?|plant|fixed assets?|accumulated depreciation)\b/i.test(name) && !/\b(expense|hire|repairs?|depreciation expense)\b/i.test(name)) return 'asset';
  return 'pnl';
}
