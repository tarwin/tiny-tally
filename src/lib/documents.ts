// Invoices, bills, quotes and credit notes share one set of screens. This is
// the wording and routing that differs between them.
import type { CategoryKind, DocType } from './api';

export interface DocInfo {
  type: DocType;
  /** "Invoice" */
  one: string;
  /** "Invoices" */
  many: string;
  /** lower-case singular for sentences */
  word: string;
  base: string;
  contactLabel: string;
  contactKind: 'customer' | 'vendor';
  categoryKind: CategoryKind;
  issueLabel: string;
  dueLabel: string;
  numberLabel: string;
  printable: boolean;
}

export const DOCS: Record<DocType, DocInfo> = {
  invoice: {
    type: 'invoice', one: 'Invoice', many: 'Invoices', word: 'invoice', base: '/invoices',
    contactLabel: 'Customer', contactKind: 'customer', categoryKind: 'income',
    issueLabel: 'Issue date', dueLabel: 'Due date', numberLabel: 'Invoice number', printable: true,
  },
  quote: {
    type: 'quote', one: 'Quote', many: 'Quotes', word: 'quote', base: '/quotes',
    contactLabel: 'Customer', contactKind: 'customer', categoryKind: 'income',
    issueLabel: 'Quote date', dueLabel: 'Valid until', numberLabel: 'Quote number', printable: true,
  },
  credit: {
    type: 'credit', one: 'Credit note', many: 'Credit notes', word: 'credit note', base: '/credit-notes',
    contactLabel: 'Customer', contactKind: 'customer', categoryKind: 'income',
    issueLabel: 'Date', dueLabel: 'Date', numberLabel: 'Credit note number', printable: true,
  },
  bill: {
    type: 'bill', one: 'Bill', many: 'Bills', word: 'bill', base: '/bills',
    contactLabel: 'Supplier', contactKind: 'vendor', categoryKind: 'expense',
    issueLabel: 'Bill date', dueLabel: 'Due date', numberLabel: 'Our number', printable: false,
  },
};

export function docPath(type: DocType | null | undefined, id: number) {
  return `${DOCS[type ?? 'invoice'].base}/${id}`;
}
