// QuickBooks Desktop IIF (Intuit Interchange Format): tab-separated text where
// "!HEADER" rows name the columns for the data rows that follow. We read:
//   !ACCNT  chart of accounts   -> money accounts + income/expense categories
//   !CUST / !VEND / !OTHERNAME  -> contacts
//   !TRNS / !SPL / !ENDTRNS     -> transactions (one TRNS line, its SPL lines)
// QuickBooks is double-entry; Tiny Tally is single-entry. split.ts turns each
// transaction into entries on the bank or card side.
import { hashRef, type ImportBatch, type ImportCategory, type ImportDocument, type ImportJournal, type ImportEntry } from '../../shared/import';
import { detectDateOrder, occurrenceRefs, parseAmount, parseDate, type DateOrder } from './parse';
import { classForQbType, looksLikeSalesTaxAccount, reviewTax, splitTransactions, type SplitTxn, type TaxMode, type TaxReview } from './split';

export type LedgerRow = Record<string, string>;
type Row = LedgerRow;

const MONEY_TYPES: Record<string, 'bank' | 'credit_card'> = { BANK: 'bank', CCARD: 'credit_card' };
const INCOME_TYPES = new Set(['INC', 'EXINC']);
const EXPENSE_TYPES = new Set(['EXP', 'COGS', 'EXEXP']);
/** Customer payments waiting to be banked: tracked as a money account of its own. */
const UNDEPOSITED = /undeposited/i;

/** What QuickBooks account types mean, for the review screen. */
export const IIF_TYPE_LABELS: Record<string, string> = {
  BANK: 'Bank',
  CCARD: 'Credit card',
  INC: 'Income',
  EXINC: 'Other income',
  EXP: 'Expense',
  EXEXP: 'Other expense',
  COGS: 'Cost of goods sold',
  AR: 'Accounts receivable',
  AP: 'Accounts payable',
  OCASSET: 'Other current asset',
  FIXASSET: 'Fixed asset',
  OASSET: 'Other asset',
  OCLIAB: 'Other current liability',
  LTLIAB: 'Long-term liability',
  EQUITY: 'Equity',
  NONPOSTING: 'Non-posting',
  SUSPENSE: 'Suspense',
};

export function looksLikeIif(text: string) {
  return /^\s*!(ACCNT|TRNS|CUST|VEND|HDR|CLASS|INVITEM|EMP|OTHERNAME)\t/m.test(text.slice(0, 4000));
}

function splitLine(line: string) {
  return line.split('\t').map((f) => {
    const t = f.trim();
    return t.length >= 2 && t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1).replace(/""/g, '"') : t;
  });
}

export interface IifParse extends ImportBatch {
  dateOrder: DateOrder;
  /** QuickBooks account type for each category key, shown in the review. */
  categoryTypes: Record<string, string>;
  /** False for a "Lists to IIF Files" export, which has no transaction blocks at all. */
  hasTransactions: boolean;
  /** The program that wrote the file, for the review screen. */
  product: 'Reckon Accounts' | 'QuickBooks Desktop';
  taxReview: TaxReview;
}

/** Lists that mean nothing to Tiny Tally, so there's no point reporting them as left out. */
const IGNORED_RECORDS = new Set([
  'CLASS', 'INVITEM', 'EMP', 'CTYPE', 'VTYPE', 'TERMS', 'SHIPMETH', 'PAYMETH', 'BUD', 'TIMEACT', 'INVMEMO', 'SALESREP', 'SALESTAXCODE', 'TODO',
  'TAXCODE', 'ENDTAX', 'JOBTYPE', 'PRICELEVEL', 'ENDGRP', 'CUSTITEMDICT', 'ENDCUSTITEMDICT', 'CUSTNAMEDICT', 'ENDCUSTNAMEDICT',
  'QBP EMPLOYEE', 'CUSTOMPI', 'HOURLYPI', 'LOCALPI', 'ENDQBPEMP',
]);

export function parseIif(text: string, order?: DateOrder, fallbackOrder: DateOrder = 'mdy', taxMode: TaxMode = 'merge'): IifParse {
  const headers: Record<string, string[]> = {};
  const accnt: Row[] = [];
  const people: { kind: 'customer' | 'vendor'; row: Row }[] = [];
  const blocks: Row[][] = [];
  let current: Row[] | null = null;
  const unknownBlocks = new Map<string, number>();
  let product: IifParse['product'] = 'QuickBooks Desktop';

  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const cells = splitLine(raw);
    const tag = cells[0];
    if (tag.startsWith('!')) {
      headers[tag.slice(1).toUpperCase()] = cells.map((c) => c.replace(/^!/, '').toUpperCase());
      continue;
    }
    const type = tag.toUpperCase();
    const head = headers[type];
    const row: Row = {};
    if (head) head.forEach((h, i) => (row[h] = cells[i] ?? ''));
    switch (type) {
      case 'HDR':
        if (/reckon/i.test(row.PROD ?? '')) product = 'Reckon Accounts';
        break;
      case 'ACCNT':
        accnt.push(row);
        break;
      case 'CUST':
        people.push({ kind: 'customer', row });
        break;
      case 'VEND':
      case 'OTHERNAME':
        people.push({ kind: 'vendor', row });
        break;
      case 'TRNS':
        current = [row];
        break;
      case 'SPL':
        current?.push(row);
        break;
      case 'ENDTRNS':
        if (current) blocks.push(current);
        current = null;
        break;
      default:
        unknownBlocks.set(type, (unknownBlocks.get(type) ?? 0) + 1);
    }
  }

  return parseLedger({ accnt, people, blocks, unknownBlocks, product }, order, fallbackOrder, taxMode);
}

/** What an IIF file or a portable company file (qbm.ts) comes down to. */
export interface LedgerSource {
  accnt: Row[];
  people: { kind: 'customer' | 'vendor'; row: Row }[];
  blocks: Row[][];
  unknownBlocks: Map<string, number>;
  product: IifParse['product'];
  /** Invoices, bills and credit notes, with each line's account name for its category. */
  documents?: (Omit<ImportDocument, 'lines'> & { lines: (Omit<ImportDocument['lines'][number], 'categoryKey'> & { accnt: string })[] })[];
  /** Payments on those documents: `accnt` is the money account. */
  payments?: (Omit<ImportEntry, 'accountKey' | 'categoryKey'> & { accnt: string })[];
}

export function parseLedger(source: LedgerSource, order?: DateOrder, fallbackOrder: DateOrder = 'mdy', taxMode: TaxMode = 'merge'): IifParse {
  const { accnt, people, blocks, unknownBlocks, product } = source;
  const dateOrder = order ?? detectDateOrder(blocks.slice(0, 500).map((b) => b[0].DATE ?? ''), fallbackOrder);

  // ---- chart of accounts ----
  const typeOf = new Map<string, string>();
  for (const a of accnt) if (a.NAME) typeOf.set(a.NAME, (a.ACCNTTYPE || '').toUpperCase());
  const prettyName = (n: string) => n.replace(/:/g, ': ');

  const accounts: ImportBatch['accounts'] = [];
  const accountKeys = new Set<string>();
  const addAccount = (name: string, kind: 'bank' | 'credit_card', openingBalance?: number) => {
    if (accountKeys.has(name)) return;
    accountKeys.add(name);
    accounts.push({ key: name, name: prettyName(name), kind, openingBalance });
  };
  // QuickBooks' OBAMOUNT is the opening balance. Card balances owed are
  // negative there, the same way Tiny Tally stores them.
  for (const a of accnt) {
    const kind = MONEY_TYPES[(a.ACCNTTYPE || '').toUpperCase()];
    if (!kind || !a.NAME) continue;
    addAccount(a.NAME, kind, parseAmount(a.OBAMOUNT ?? '') ?? 0);
  }

  const categories: ImportCategory[] = [];
  const categoryTypes: Record<string, string> = {};
  const catKeys = new Set<string>();
  const addCategory = (name: string, kind: 'income' | 'expense') => {
    const key = `${kind}:${name}`;
    if (!catKeys.has(key)) {
      catKeys.add(key);
      const type = typeOf.get(name) ?? '';
      categories.push({ key, name: prettyName(name), kind, class: classForQbType(type, name) ?? 'pnl' });
      categoryTypes[key] = type;
    }
    return key;
  };
  for (const a of accnt) {
    const t = (a.ACCNTTYPE || '').toUpperCase();
    if (INCOME_TYPES.has(t)) addCategory(a.NAME, 'income');
    else if (EXPENSE_TYPES.has(t)) addCategory(a.NAME, 'expense');
  }

  // ---- contacts ----
  const contacts: ImportBatch['contacts'] = [];
  for (const { kind, row } of people) {
    if (!row.NAME) continue;
    const address = ['BADDR1', 'BADDR2', 'BADDR3', 'BADDR4', 'BADDR5', 'ADDR1', 'ADDR2', 'ADDR3', 'ADDR4', 'ADDR5']
      .map((k) => row[k])
      .filter(Boolean);
    contacts.push({
      kind,
      name: row.NAME,
      email: row.EMAIL || undefined,
      phone: row.PHONE1 || undefined,
      address: [...new Set(address)].join('\n') || undefined,
    });
  }

  // ---- transactions ----
  const isMoney = (name: string) =>
    !!MONEY_TYPES[typeOf.get(name) ?? ''] ||
    UNDEPOSITED.test(name) ||
    (!typeOf.has(name) && /\b(checking|cheque|savings|bank)\b/i.test(name));
  const txns: SplitTxn[] = [];
  /** Could be a journal if nothing in it is a money account. A portable file's documents are already out, so anything left qualifies. */
  const maybeJournal = new Set<SplitTxn>();
  let badDate = 0;
  for (const block of blocks) {
    const lines = block.map((r) => ({
      accnt: r.ACCNT ?? '',
      amount: parseAmount(r.AMOUNT ?? '') ?? 0,
      name: r.NAME ?? '',
      memo: r.MEMO ?? '',
      // Only a portable company file records these per line.
      ...(r.TAX === undefined ? {} : { tax: parseAmount(r.TAX) ?? 0, taxCode: r.TAXCODE || undefined, taxLine: r.TAXLINE === '1' }),
    }));
    const date = parseDate(block[0].DATE ?? '', dateOrder);
    if (!date) {
      badDate++;
      continue;
    }
    const trnsType = (block[0].TRNSTYPE || '').toUpperCase();
    const live = lines.filter((l) => l.accnt && l.amount !== 0);
    const ref = block[0].TRNSID || hashRef(date, trnsType, ...live.map((l) => `${l.accnt}|${l.amount}|${l.name}|${l.memo}`));
    const txn: SplitTxn = { date, ref, memo: block[0].MEMO || undefined, lines };
    txns.push(txn);
    if (source.documents || trnsType === 'GENERAL JOURNAL') maybeJournal.add(txn);
  }
  const isTaxAccount = (name: string) => ['OCLIAB', 'LTLIAB', ''].includes(typeOf.get(name) ?? '') && looksLikeSalesTaxAccount(name);
  const moneyAccount = (name: string) => addAccount(name, MONEY_TYPES[typeOf.get(name) ?? ''] ?? 'bank');
  const { entries, noBank, complex } = splitTransactions(txns, {
    isMoney,
    addAccount: moneyAccount,
    addCategory,
    ref: occurrenceRefs(),
    taxMode,
    isTaxAccount,
  });
  const taxReview = reviewTax(txns, { isMoney, isTaxAccount });

  const documents: ImportDocument[] = (source.documents ?? []).map((d) => ({
    ...d,
    lines: d.lines.map(({ accnt: name, ...l }) => ({ ...l, categoryKey: addCategory(name, d.docType === 'bill' ? 'expense' : 'income') })),
  }));
  for (const { accnt: name, ...p } of source.payments ?? []) {
    moneyAccount(name);
    entries.push({ ...p, accountKey: name });
  }

  const journals: ImportJournal[] = [];
  let unbooked = noBank;
  for (const t of maybeJournal) {
    const live = t.lines.filter((l) => l.accnt && l.amount !== 0);
    if (live.some((l) => isMoney(l.accnt))) continue;
    // All zeros: there's nothing to bring across, and nothing lost by leaving it.
    if (!live.length) unbooked--;
    if (live.length < 2 || live.reduce((n, l) => n + l.amount, 0) !== 0) continue;
    unbooked--;
    journals.push({
      date: t.date,
      memo: t.memo,
      lines: live.map((l) => {
        const type = typeOf.get(l.accnt);
        const memo = l.memo || undefined;
        // Tiny Tally works out receivables and payables from documents, so a journal posts beside them.
        if (type === 'AR') return { system: 'prepayments' as const, amount: l.amount, memo };
        if (type === 'AP') return { system: 'accruals' as const, amount: l.amount, memo };
        const income = INCOME_TYPES.has(type ?? '') || (catKeys.has(`income:${l.accnt}`) && !catKeys.has(`expense:${l.accnt}`));
        return { categoryKey: addCategory(l.accnt, income ? 'income' : 'expense'), amount: l.amount, memo };
      }),
    });
  }

  const skipped: ImportBatch['skipped'] = [];
  if (unbooked) {
    skipped.push({
      reason: source.documents
        ? "Transactions that don't touch a bank or card account and don't balance, so they can't be brought across"
        : "Transactions that don't touch a bank or card account (invoices, bills). Their payments are imported instead.",
      count: unbooked,
    });
  }
  if (complex) skipped.push({ reason: "Transactions across several bank or card accounts that couldn't be split", count: complex });
  if (badDate) skipped.push({ reason: "Transactions with a date that couldn't be read", count: badDate });
  for (const [type, count] of unknownBlocks) {
    if (IGNORED_RECORDS.has(type)) continue;
    skipped.push({ reason: `QuickBooks “${type}” records`, count });
  }

  return { source: 'iif', accounts, categories, contacts, entries, documents, skipped, dateOrder, categoryTypes, journals, hasTransactions: blocks.length > 0 || documents.length > 0, product, taxReview };
}
