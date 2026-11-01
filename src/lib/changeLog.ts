// Wording for the change log (Activity page and History): what each action
// was, what each table holds, and how to show a changed field.
import type { Change, ChangeBatch } from './api';
import { formatMoney } from './money';

/** Backend call → what the person did. Unknown calls fall back to the name. */
const ACTIONS: Record<string, string> = {
  'books.create': 'Created the books',
  'books.createDemo': 'Created the demo books',
  'history.archive': 'Archived older history',
  'settings.update': 'Changed settings',
  'accounts.save': 'Saved a money account',
  'accounts.archive': 'Archived or restored a money account',
  'categories.save': 'Saved a category',
  'categories.archive': 'Archived or restored a category',
  'contacts.save': 'Saved a contact',
  'contacts.archive': 'Archived or restored a contact',
  'entries.save': 'Saved a transaction',
  'entries.delete': 'Deleted a transaction',
  'invoices.save': 'Saved a document',
  'invoices.setStatus': 'Changed a document’s status',
  'invoices.delete': 'Deleted a document',
  'invoices.duplicate': 'Duplicated a document',
  'invoices.convertQuote': 'Turned a quote into an invoice',
  'invoices.credit': 'Made a credit note',
  'invoices.applyCredit': 'Applied a credit note',
  'invoices.removeAllocation': 'Removed an applied credit',
  'invoices.recordPayment': 'Recorded a payment',
  'invoices.deletePayment': 'Deleted a payment',
  'templates.save': 'Saved an invoice template',
  'templates.setDefault': 'Changed the default template',
  'templates.delete': 'Deleted an invoice template',
  'tradingNames.save': 'Saved a trading name',
  'tradingNames.setDefault': 'Changed the default trading name',
  'tradingNames.archive': 'Archived or restored a trading name',
  'tradingNames.delete': 'Deleted a trading name',
  'reconcile.start': 'Started a reconciliation',
  'reconcile.tick': 'Ticked reconciliation lines',
  'reconcile.finish': 'Finished a reconciliation',
  'reconcile.cancel': 'Stopped a reconciliation',
  'reconcile.undo': 'Undid a reconciliation',
  'schedules.save': 'Saved a recurring schedule',
  'schedules.delete': 'Deleted a recurring schedule',
  'schedules.skip': 'Skipped a recurring item',
  'schedules.run': 'Created recurring items',
  'rules.save': 'Saved an import rule',
  'rules.delete': 'Deleted an import rule',
  'journals.save': 'Saved a journal entry',
  'journals.delete': 'Deleted a journal entry',
  'import.commit': 'Imported a file',
  'bas.save': 'Saved a BAS',
  'bas.reopen': 'Reopened a BAS',
  'bas.delete': 'Deleted a BAS',
  'taxReturns.save': 'Saved a tax return',
  'taxReturns.reopen': 'Reopened a tax return',
  'taxReturns.delete': 'Deleted a tax return',
};

export function batchLabel(b: Pick<ChangeBatch, 'action'>) {
  return ACTIONS[b.action] ?? b.action;
}

/** Extra detail some batches carry (see changelog.ts). */
export function batchSummary(b: ChangeBatch): Record<string, any> | null {
  try {
    return b.summary ? JSON.parse(b.summary) : null;
  } catch {
    return null;
  }
}

export const TABLES: Record<string, string> = {
  accounts: 'Money account',
  categories: 'Category',
  contacts: 'Contact',
  entries: 'Transaction',
  invoices: 'Document',
  invoice_lines: 'Line',
  credit_allocations: 'Credit applied',
  invoice_templates: 'Template',
  reconciliations: 'Reconciliation',
  schedules: 'Recurring schedule',
  rules: 'Import rule',
  journals: 'Journal entry',
  journal_lines: 'Journal line',
  bas_returns: 'BAS',
  tax_returns: 'tax return',
  trading_names: 'Trading name',
  items: 'Product or service',
  attachments: 'Attachment',
  budgets: 'Budget',
  meta: 'Setting',
};

/** Cents columns, shown as money. */
const MONEY = new Set([
  'amount', 'tax_amount', 'opening_balance', 'statement_balance', 'net', 'tax', 'total', 'unit_price', 'w1', 'w2', 't7',
]);
/** Columns that only link rows together or are bookkeeping; left out of the diff. */
const HIDDEN = new Set(['id', 'created_at', 'sort', 'rec_id', 'to_rec_id', 'figures']);

const FIELD_NAMES: Record<string, string> = {
  kind: 'type', memo: 'description', account_id: 'account', to_account_id: 'to account', category_id: 'category',
  contact_id: 'contact', tax_code: 'tax code', tax_amount: 'GST', invoice_id: 'document', is_archived: 'archived',
  opening_balance: 'opening balance', opening_date: 'opening date', issue_date: 'date', due_date: 'due date',
  qty_milli: 'quantity', unit_price: 'price', doc_type: 'type', statement_date: 'statement date',
  statement_balance: 'statement balance', next_date: 'next date', end_date: 'end date', is_active: 'active',
  auto_approve: 'approve automatically', prices_include_tax: 'prices include GST', payment_details: 'payment details',
  show_tax_column: 'GST column', import_ref: 'import id', schedule_id: 'schedule', journal_id: 'journal',
  trading_name_id: 'trading name', from_snapshot: 'sender details', is_default: 'default', template_id: 'template',
  period_start: 'from', period_end: 'to', lodged_at: 'lodged', sent_at: 'sent', completed_at: 'completed',
};

export function fieldName(key: string) {
  return FIELD_NAMES[key] ?? key.replace(/_/g, ' ');
}

export function formatValue(key: string, v: unknown, currency: string) {
  if (v === null || v === undefined || v === '') return '—';
  if (MONEY.has(key) && typeof v === 'number') return formatMoney(v, currency);
  if (key === 'qty_milli' && typeof v === 'number') return String(v / 1000);
  if (key.startsWith('is_') || key === 'auto_approve' || key === 'prices_include_tax' || key === 'show_tax_column') {
    return v ? 'yes' : 'no';
  }
  const s = String(v);
  return s.length > 80 ? s.slice(0, 77) + '…' : s;
}

/** The fields a change touched: every field for an insert or delete, the differing ones for an update. */
export function changedFields(c: Change) {
  const keys = new Set([...Object.keys(c.before ?? {}), ...Object.keys(c.after ?? {})]);
  return [...keys]
    .filter((k) => !HIDDEN.has(k))
    .filter((k) => c.action !== 'update' || JSON.stringify(c.before?.[k]) !== JSON.stringify(c.after?.[k]))
    .filter((k) => c.action === 'update' || ((c.after ?? c.before)?.[k] ?? null) !== null)
    .map((k) => ({ key: k, before: c.before?.[k], after: c.after?.[k] }));
}

/** A few words naming the row: its number, name, or date and amount. */
export function rowLabel(c: Change, currency: string) {
  const r = (c.after ?? c.before ?? {}) as Record<string, any>;
  if (c.tableName === 'meta') return fieldName(String(c.rowKey ?? '').replace(/^books_/, ''));
  const what = TABLES[c.tableName] ?? c.tableName;
  if (r.number) return `${what} ${r.number}`;
  if (r.name) return `${what} “${r.name}”`;
  if (r.pattern) return `${what} “${r.pattern}”`;
  const parts = [r.date ?? r.issue_date ?? r.statement_date, typeof r.amount === 'number' ? formatMoney(r.amount, currency) : null, r.memo ?? r.description];
  const detail = parts.filter(Boolean).join(' · ');
  return detail ? `${what}: ${detail}` : `${what} #${c.rowId ?? ''}`;
}

export const ACTION_WORD = { insert: 'Added', update: 'Changed', delete: 'Removed' } as const;

/** Local wall-clock time for a stored UTC instant. */
export function formatWhen(iso: string) {
  return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** Local midnight at the start of a YYYY-MM-DD day, as the UTC instant the log compares with. */
export function dayStartInstant(day: string) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toISOString();
}
