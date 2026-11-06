// Double-entry transactions (QuickBooks IIF, QuickBooks Online journal reports)
// turned into Tiny Tally's single entries. Each transaction is a set of lines
// that sum to zero; lines on bank or card accounts are the money side.
//
//   - Money moving between two of your own accounts becomes a transfer.
//   - Every other line becomes an income or expense entry on the money
//     account, categorised by that line's account.
//   - When several money accounts pay (or receive) the same lines, the lines
//     are shared out across them in order.
// Transactions that never touch money (invoices, bills, journals) are counted
// and left out: on the cash basis their payments already are the income and
// spending.
import type { ImportCategoryClass, ImportEntry } from '../../shared/import';

export interface SplitLine {
  accnt: string;
  /** Cents; debit positive, credit negative. */
  amount: number;
  name: string;
  memo: string;
  /** Tax recorded on this line (same sign as amount), when the source has it per line. */
  tax?: number;
  taxCode?: string;
  /** This line is the transaction's tax, on the tax account. */
  taxLine?: boolean;
}

export interface SplitTxn {
  date: string;
  /** Stable id for re-imports. */
  ref: string;
  memo?: string;
  lines: SplitLine[];
}

export interface SplitContext {
  isMoney(accnt: string): boolean;
  addAccount(accnt: string): void;
  /** Returns the category key. */
  addCategory(accnt: string, kind: 'income' | 'expense'): string;
  ref(base: string): string;
  /** How to read a separate tax line whose share of each line isn't recorded. Default 'merge'. */
  taxMode?: TaxMode;
  /** The file's sales tax account, when it can only be told by name or type. */
  isTaxAccount?(accnt: string): boolean;
}

export type TaxMode = 'merge' | 'separate';

const SALES_TAX_ACCOUNT = /\b(gst|vat|hst|pst|sales tax|tax payable|tax collected)\b/i;
const NOT_SALES_TAX = /\b(payg|payroll|income tax|withh|wages?)\b/i;
export const looksLikeSalesTaxAccount = (name: string) => SALES_TAX_ACCOUNT.test(name) && !NOT_SALES_TAX.test(name);

/**
 * A ledger keeps a sale's tax on a line of its own, but a Tiny Tally entry is
 * tax-inclusive and holds its own tax. Folds tax lines into the others so the
 * tax isn't counted once as a category and again worked out from the amount.
 * A transaction that's only tax, like paying the BAS, stays as it is.
 */
function foldTax(lines: SplitLine[], ctx: Pick<SplitContext, 'isMoney' | 'isTaxAccount' | 'taxMode'>, fileHasTax: boolean): { lines: SplitLine[]; inferred: boolean } {
  if (!fileHasTax) return { lines, inferred: false };
  const isTax = (l: SplitLine) => l.taxLine ?? ctx.isTaxAccount?.(l.accnt) ?? false;
  const taxLines = lines.filter(isTax);
  const plain = lines.filter((l) => !isTax(l) && !ctx.isMoney(l.accnt));
  const rest = lines.filter((l) => !isTax(l) && ctx.isMoney(l.accnt));
  const noTax = (l: SplitLine): SplitLine => ({ ...l, tax: l.tax ?? 0, taxCode: l.taxCode ?? 'FRE' });
  if (!taxLines.length) return { lines: [...rest, ...plain.map(noTax)], inferred: false };
  if (!plain.length) return { lines, inferred: false };

  const total = taxLines.reduce((t, l) => t + l.amount, 0);
  const recorded = plain.reduce((t, l) => t + (l.tax ?? 0), 0);
  if (recorded === total && plain.some((l) => l.tax)) {
    return { lines: [...rest, ...plain.map((l) => (l.tax ? { ...l, amount: l.amount + l.tax } : noTax(l)))], inferred: false };
  }
  // Nothing says which lines the tax belongs to, or what's recorded disagrees.
  const sameWay = plain.every((l) => Math.sign(l.amount) === Math.sign(total));
  if (ctx.taxMode === 'separate' || !sameWay) {
    return { lines: [...rest, ...taxLines, ...plain.map((l) => ({ ...l, tax: 0, taxCode: 'NTR' }))], inferred: true };
  }
  const base = plain.reduce((t, l) => t + l.amount, 0);
  let given = 0;
  return {
    inferred: true,
    lines: [
      ...rest,
      ...plain.map((l, i) => {
        const tax = i === plain.length - 1 ? total - given : Math.round((total * l.amount) / base);
        given += tax;
        return { ...l, amount: l.amount + tax, tax, taxCode: 'GST' };
      }),
    ],
  };
}

export interface TaxExample {
  date: string;
  who: string;
  merge: { label: string; amount: number; tax: number }[];
  separate: { label: string; amount: number; tax: number }[];
}

export interface TaxReview {
  /** Transactions whose tax had to be read by inference. */
  inferred: number;
  /** Share of those at the file's most common rate. Low means the reading could be wrong. */
  fit: number;
  examples: TaxExample[];
}

/** How a file's separate tax lines read, with real transactions to show when it isn't clear. */
export function reviewTax(txns: SplitTxn[], ctx: Pick<SplitContext, 'isMoney' | 'isTaxAccount'>): TaxReview {
  const hasTax = fileHasTax(txns, ctx);
  const rates = new Map<number, number>();
  const seen: { t: SplitTxn; rate: number }[] = [];
  let inferred = 0;
  for (const t of txns) {
    const lines = t.lines.filter((l) => l.accnt && l.amount !== 0);
    if (!foldTax(lines, { ...ctx, taxMode: 'separate' }, hasTax).inferred) continue;
    inferred++;
    const isTax = (l: SplitLine) => l.taxLine ?? ctx.isTaxAccount?.(l.accnt) ?? false;
    const tax = lines.filter(isTax).reduce((n, l) => n + l.amount, 0);
    const base = lines.filter((l) => !isTax(l) && !ctx.isMoney(l.accnt)).reduce((n, l) => n + l.amount, 0);
    const rate = base ? Math.round((tax / base) * 100) : 0;
    rates.set(rate, (rates.get(rate) ?? 0) + 1);
    seen.push({ t, rate });
  }
  const common = [...rates.entries()].sort((a, b) => b[1] - a[1])[0];
  const fit = inferred ? (common?.[1] ?? 0) / inferred : 1;
  const read = (t: SplitTxn, taxMode: TaxMode) =>
    foldTax(t.lines.filter((l) => l.accnt && l.amount !== 0), { ...ctx, taxMode }, hasTax).lines
      .filter((l) => !ctx.isMoney(l.accnt))
      .map((l) => ({ label: l.accnt.replace(/:/g, ': '), amount: Math.abs(l.amount), tax: Math.abs(l.tax ?? 0) }));
  // The odd ones out first: they're where a wrong reading shows.
  const picks = [...seen.filter((s) => s.rate !== common?.[0]), ...seen.filter((s) => s.rate === common?.[0])].slice(0, 3);
  return {
    inferred,
    fit,
    examples: picks.map(({ t }) => ({
      date: t.date,
      who: t.lines.map((l) => l.name).find(Boolean) || t.memo || '',
      merge: read(t, 'merge'),
      separate: read(t, 'separate'),
    })),
  };
}

function fileHasTax(txns: SplitTxn[], ctx: Pick<SplitContext, 'isTaxAccount'>) {
  return txns.some((t) => t.lines.some((l) => l.amount !== 0 && (l.taxLine ?? ctx.isTaxAccount?.(l.accnt) ?? false)));
}

/**
 * What a QuickBooks account becomes in Tiny Tally. Income and expense
 * accounts count towards profit; equity, loans, tax and assets are money
 * that moved without being profit.
 */
export function classForQbType(type: string, name: string): ImportCategoryClass | null {
  switch (type.toUpperCase()) {
    case '':
    case 'INC':
    case 'EXINC':
    case 'EXP':
    case 'EXEXP':
    case 'COGS':
    // Receivables and payables: on the cash basis their payments are income and spending.
    case 'AR':
    case 'AP':
      return 'pnl';
    case 'EQUITY':
      return 'owner';
    case 'LTLIAB':
    case 'OCLIAB':
      return /\b(gst|bas|vat|tax|payg)\b/i.test(name) ? 'tax' : 'loan';
    case 'FIXASSET':
    case 'OASSET':
    case 'OCASSET':
      return 'asset';
    default:
      return null;
  }
}

export function splitTransactions(txns: SplitTxn[], ctx: SplitContext) {
  const entries: ImportEntry[] = [];
  let noBank = 0;
  let complex = 0;
  const hasTax = fileHasTax(txns, ctx);

  for (const t of txns) {
    const lines = foldTax(t.lines.filter((l) => l.accnt && l.amount !== 0), ctx, hasTax).lines.filter((l) => l.amount !== 0);
    const others = lines.filter((l) => !ctx.isMoney(l.accnt));
    // Net each money account: a transaction can touch the same one twice.
    const money = new Map<string, SplitLine>();
    for (const l of lines) {
      if (!ctx.isMoney(l.accnt)) continue;
      const m = money.get(l.accnt);
      if (m) {
        m.amount += l.amount;
        m.memo ||= l.memo;
        m.name ||= l.name;
      } else money.set(l.accnt, { ...l });
    }
    if (!money.size) {
      noBank++;
      continue;
    }

    const out: ImportEntry[] = [];
    const memoOf = (...ls: SplitLine[]) => ls.map((l) => l.memo).find(Boolean) || t.memo || undefined;

    // Money between your own accounts: pair what left with what arrived.
    const from = [...money.values()].filter((m) => m.amount < 0);
    const to = [...money.values()].filter((m) => m.amount > 0);
    let transfers = 0;
    while (from.length && to.length) {
      const a = from[0];
      const b = to[0];
      const x = Math.min(-a.amount, b.amount);
      out.push({
        ref: transfers ? `${t.ref}:t${transfers}` : t.ref,
        date: t.date,
        kind: 'transfer',
        amount: x,
        accountKey: a.accnt,
        toAccountKey: b.accnt,
        memo: memoOf(a, b),
      });
      transfers++;
      a.amount += x;
      b.amount -= x;
      if (!a.amount) from.shift();
      if (!b.amount) to.shift();
    }
    const left = [...from, ...to];

    if (others.length) {
      if (!left.length) {
        complex++;
        continue;
      }
      const entry = (o: SplitLine, bank: SplitLine, amount: number, ref: string): ImportEntry => {
        // A line credited (negative) means money came in; debited means it went out.
        const kind: 'income' | 'expense' = o.amount < 0 ? 'income' : 'expense';
        return {
          ref,
          date: t.date,
          kind,
          amount,
          accountKey: bank.accnt,
          categoryKey: ctx.addCategory(o.accnt, kind),
          contactName: o.name || bank.name || undefined,
          memo: o.memo || bank.memo || t.memo || undefined,
          // A piece of a shared line carries its share of the line's tax.
          ...(o.tax === undefined ? {} : { taxCode: o.taxCode, taxAmount: Math.round((Math.abs(o.tax) * amount) / Math.abs(o.amount)) }),
        };
      };
      if (left.length === 1) {
        others.forEach((o, i) => out.push(entry(o, left[0], Math.abs(o.amount), `${t.ref}:${i}`)));
      } else {
        // Several accounts on the same side: every line must go the other way to share them out.
        const sign = Math.sign(left[0].amount);
        if (others.some((o) => Math.sign(o.amount) === sign)) {
          complex++;
          continue;
        }
        const queue = left.map((m) => ({ line: m, rest: Math.abs(m.amount) }));
        others.forEach((o, i) => {
          let need = Math.abs(o.amount);
          let piece = 0;
          while (need > 0 && queue.length) {
            const q = queue[0];
            const x = Math.min(need, q.rest);
            out.push(entry(o, q.line, x, piece ? `${t.ref}:${i}.${piece}` : `${t.ref}:${i}`));
            piece++;
            need -= x;
            q.rest -= x;
            if (!q.rest) queue.shift();
          }
        });
      }
    }

    for (const m of money.keys()) ctx.addAccount(m);
    for (const e of out) entries.push({ ...e, ref: ctx.ref(e.ref) });
  }
  return { entries, noBank, complex };
}
