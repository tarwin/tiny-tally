import { toast } from '@octans/ui';
import { api, errorMessage, type Entry, type EntryQuery } from './api';
import { csvMoney, toCsv, type Cell } from '../shared/csv';

export { csvMoney, toCsv };

export async function saveCsv(suggestedName: string, rows: Cell[][]) {
  const path = await tiny.dialog.saveFile({ types: ['csv'], name: suggestedName });
  if (!path) return;
  try {
    const dest = await api.writeText(path.endsWith('.csv') ? path : path + '.csv', toCsv(rows));
    toast({
      title: 'Exported',
      content: dest.slice(dest.lastIndexOf('/') + 1),
      tone: 'success',
      actions: [{ label: 'Show', onAction: () => void tiny.app.shell.reveal(dest) }],
    });
  } catch (e) {
    toast({ title: "Couldn't export", content: errorMessage(e), tone: 'error' });
  }
}

/** Every transaction a list shows, not just the page on screen (the backend caps a page at 1000). */
export async function allEntries(q: Omit<EntryQuery, 'limit' | 'offset'>) {
  const rows: Entry[] = [];
  for (;;) {
    const page = await api.listEntries({ ...q, limit: 1000, offset: rows.length });
    rows.push(...page.rows);
    if (!page.rows.length || rows.length >= page.total) return rows;
  }
}

const KIND_LABEL = { income: 'Income', expense: 'Expense', transfer: 'Transfer' } as const;

/**
 * Transactions as CSV rows, oldest first. In a register (`withBalance`) the
 * amount is signed to the account and the running balance follows it.
 */
export function entryCsvRows(rows: Entry[], withBalance = false) {
  const head = ['Date', 'Type', 'Account', 'To account', 'Contact', 'Category', 'Memo', 'Tax code', 'Tax', 'Amount'];
  return [
    withBalance ? [...head, 'Balance'] : head,
    ...[...rows].reverse().map((e) => [
      e.date,
      KIND_LABEL[e.kind],
      e.accountName,
      e.toAccountName,
      e.contactName,
      e.categoryName,
      e.memo,
      e.taxCode,
      e.taxAmount ? csvMoney(e.taxAmount) : '',
      csvMoney(withBalance ? e.signed : e.amount),
      ...(withBalance ? [csvMoney(e.balance ?? 0)] : []),
    ]),
  ];
}
