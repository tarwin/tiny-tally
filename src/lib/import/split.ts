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

  for (const t of txns) {
    const lines = t.lines.filter((l) => l.accnt && l.amount !== 0);
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
