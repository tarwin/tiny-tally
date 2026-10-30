// CSV: bank statements (any bank, plus QuickBooks Online bank exports) and
// contact lists (QuickBooks Online customer/supplier exports). The user maps
// columns in the review step; these guess a sensible starting mapping.
import { hashRef, type ImportBatch, type ImportEntry } from '../../shared/import';
import { occurrenceRefs, parseAmount, parseDate, type DateOrder } from './parse';

export interface BankMapping {
  date: number;
  description: number;
  /** One signed amount column… */
  amount: number | null;
  /** …or separate money-out / money-in columns. */
  debit: number | null;
  credit: number | null;
  /** Card statements often show purchases as positive numbers. */
  flip: boolean;
  dateOrder: DateOrder;
  hasHeader: boolean;
}

export interface ContactMapping {
  name: number;
  email: number | null;
  phone: number | null;
  address: number[];
  hasHeader: boolean;
}

const find = (head: string[], ...patterns: RegExp[]) => {
  for (const p of patterns) {
    const i = head.findIndex((h) => p.test(h));
    if (i >= 0) return i;
  }
  return -1;
};

export function looksLikeHeader(row: string[]) {
  // A header has no dates or amounts in it.
  return row.every((c) => !parseDate(c) && (parseAmount(c) === null || /[a-z]/i.test(c)));
}

/** True when the columns look like a customer/supplier list rather than transactions. */
export function looksLikeContacts(rows: string[][]) {
  if (!rows.length || !looksLikeHeader(rows[0])) return false;
  const head = rows[0].map((h) => h.toLowerCase());
  const hasName = find(head, /^(customer|supplier|vendor|name|display name|company)/) >= 0;
  const hasContact = find(head, /e-?mail/, /phone/, /address/) >= 0;
  const hasMoney = find(head, /^amount$/, /debit/, /credit/, /withdraw/, /deposit/) >= 0;
  return hasName && hasContact && !hasMoney;
}

export function guessBankMapping(rows: string[][], dateOrder: DateOrder): BankMapping {
  const hasHeader = rows.length > 0 && looksLikeHeader(rows[0]);
  const head = hasHeader ? rows[0].map((h) => h.toLowerCase().trim()) : [];
  const sample = rows.slice(hasHeader ? 1 : 0, hasHeader ? 21 : 20);
  const width = Math.max(...rows.slice(0, 20).map((r) => r.length));
  const colIs = (i: number, test: (c: string) => boolean) => sample.length > 0 && sample.filter((r) => r[i] !== undefined && r[i].trim() !== '').every((r) => test(r[i]));

  let date = find(head, /^date$/, /transaction date/, /posted/, /date/);
  if (date < 0) date = [...Array(width).keys()].find((i) => colIs(i, (c) => !!parseDate(c, dateOrder))) ?? 0;

  let debit = find(head, /debit/, /withdraw/, /money out/, /paid out/, /spent/);
  let credit = find(head, /credit(?!.*card)/, /deposit/, /money in/, /paid in/, /received/);
  let amount = find(head, /^amount$/, /amount/, /^value$/);
  if (amount < 0 && (debit < 0 || credit < 0)) {
    // Headerless: the first numeric column that isn't the date (and isn't a running balance at the end).
    const numeric = [...Array(width).keys()].filter((i) => i !== date && colIs(i, (c) => parseAmount(c) !== null && !/[a-z]{3,}/i.test(c)));
    amount = numeric[0] ?? -1;
    debit = credit = -1;
  }
  if (debit >= 0 && credit >= 0) amount = -1;

  let description = find(head, /description/, /narrative/, /details/, /payee/, /memo/, /particulars/, /name/, /reference/);
  if (description < 0) {
    // The widest text column.
    const lens = [...Array(width).keys()].map((i) =>
      i === date || i === amount || i === debit || i === credit ? -1 : sample.reduce((t, r) => t + (r[i]?.length ?? 0), 0),
    );
    description = lens.indexOf(Math.max(...lens));
  }

  return {
    date,
    description,
    amount: amount >= 0 ? amount : null,
    debit: debit >= 0 ? debit : null,
    credit: credit >= 0 ? credit : null,
    flip: false,
    dateOrder,
    hasHeader,
  };
}

/** Turns mapped CSV rows into entries for one account (`accountKey`). */
export function csvToBatch(rows: string[][], m: BankMapping, accountKey: string, accountName: string): ImportBatch {
  const entries: ImportEntry[] = [];
  const ref = occurrenceRefs();
  let unreadable = 0;
  for (const r of rows.slice(m.hasHeader ? 1 : 0)) {
    const date = parseDate(r[m.date] ?? '', m.dateOrder);
    let amount: number | null = null;
    if (m.amount !== null) amount = parseAmount(r[m.amount] ?? '');
    else {
      const out = m.debit !== null ? parseAmount(r[m.debit] ?? '') : null;
      const inn = m.credit !== null ? parseAmount(r[m.credit] ?? '') : null;
      if (out !== null || inn !== null) amount = (inn ?? 0) - Math.abs(out ?? 0);
    }
    if (amount !== null && m.flip) amount = -amount;
    if (!date || amount === null || amount === 0) {
      unreadable++;
      continue;
    }
    const memo = (r[m.description] ?? '').trim().replace(/\s+/g, ' ');
    entries.push({
      ref: ref(`csv:${hashRef(date, amount, memo)}`),
      date,
      kind: amount > 0 ? 'income' : 'expense',
      amount: Math.abs(amount),
      accountKey,
      memo: memo || undefined,
    });
  }
  return {
    source: 'csv',
    accounts: [{ key: accountKey, name: accountName, kind: 'bank' }],
    categories: [],
    contacts: [],
    entries,
    skipped: unreadable ? [{ reason: "Rows without a readable date or amount (headers, totals, blank lines)", count: unreadable }] : [],
  };
}

export function guessContactMapping(rows: string[][]): ContactMapping {
  const head = rows[0].map((h) => h.toLowerCase().trim());
  const name = Math.max(0, find(head, /^(customer|supplier|vendor)( name)?$/, /display name/, /^name$/, /company/, /full name/, /name/));
  const email = find(head, /e-?mail/);
  const phone = find(head, /^phone/, /phone/, /mobile/);
  const address = head
    .map((h, i) => (/address|street|city|suburb|state|post ?code|zip|country/.test(h) && !/e-?mail/.test(h) ? i : -1))
    .filter((i) => i >= 0)
    // QuickBooks exports both billing and shipping; keep billing when both exist.
    .filter((i, _, all) => !/ship/.test(head[i]) || all.every((j) => /ship/.test(head[j])));
  return { name, email: email >= 0 ? email : null, phone: phone >= 0 ? phone : null, address, hasHeader: true };
}

export function csvToContacts(rows: string[][], m: ContactMapping, kind: 'customer' | 'vendor'): ImportBatch {
  const contacts: ImportBatch['contacts'] = [];
  const seen = new Set<string>();
  for (const r of rows.slice(m.hasHeader ? 1 : 0)) {
    const name = (r[m.name] ?? '').trim();
    if (!name || seen.has(name.toLowerCase()) || /^total/i.test(name)) continue;
    seen.add(name.toLowerCase());
    contacts.push({
      kind,
      name,
      email: m.email !== null ? r[m.email]?.trim() || undefined : undefined,
      phone: m.phone !== null ? r[m.phone]?.trim() || undefined : undefined,
      address: m.address.map((i) => r[i]?.trim()).filter(Boolean).join('\n') || undefined,
    });
  }
  return { source: 'csv', accounts: [], categories: [], contacts, entries: [], skipped: [] };
}
