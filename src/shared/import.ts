// The shape every importer (QuickBooks IIF, OFX/QBO bank files, CSV) produces.
// Parsing happens in the page; the backend only resolves keys and writes rows.

export type ImportSource = 'iif' | 'ofx' | 'csv' | 'qbo-report';

/** Where an imported account/category ends up: an existing row, or a new one. */
export type ImportTarget = { existingId: number } | { create: true } | { skip: true };

export interface ImportAccount {
  key: string;
  name: string;
  kind: 'bank' | 'credit_card' | 'cash';
  /** Statement or QuickBooks opening balance, in cents. Only used for new accounts. */
  openingBalance?: number;
}

/** Same values as a category's class: only 'pnl' counts towards profit. */
export type ImportCategoryClass = 'pnl' | 'tax' | 'owner' | 'loan' | 'asset';

export interface ImportCategory {
  key: string;
  name: string;
  kind: 'income' | 'expense';
  /** Default 'pnl'. */
  class?: ImportCategoryClass;
}

export interface ImportContact {
  name: string;
  kind: 'customer' | 'vendor';
  email?: string;
  phone?: string;
  address?: string;
}

export interface ImportEntry {
  /** Stable id from the source (OFX FITID, IIF TRNSID, or a content hash) so re-imports skip duplicates. */
  ref: string;
  date: string;
  kind: 'income' | 'expense' | 'transfer';
  /** Positive cents. */
  amount: number;
  accountKey: string;
  toAccountKey?: string;
  /** Category key from the batch, or an existing category id chosen in the review step. */
  categoryKey?: string;
  categoryId?: number;
  contactName?: string;
  memo?: string;
}

export interface ImportBatch {
  source: ImportSource;
  accounts: ImportAccount[];
  categories: ImportCategory[];
  contacts: ImportContact[];
  entries: ImportEntry[];
  /** Things the parser understood but can't bring across (e.g. unpaid QuickBooks invoices). */
  skipped: { reason: string; count: number }[];
}

export interface ImportPlan {
  batch: ImportBatch;
  accounts: Record<string, ImportTarget>;
  categories: Record<string, ImportTarget>;
  /** Used for entries whose category is missing or skipped. */
  fallbackCategory: { income: number | null; expense: number | null };
}

export interface ImportResult {
  accountsCreated: number;
  categoriesCreated: number;
  contactsCreated: number;
  entriesCreated: number;
  duplicates: number;
  /** Rows left out because their category or account was set to skip. */
  skipped: number;
  /** Rows that couldn't be imported, with the reason (first 50). */
  failed: { ref: string; date: string; reason: string }[];
  failedCount: number;
}

/** Short, stable hash for building import refs when the source has no ids (CSV). */
export function hashRef(...parts: (string | number)[]) {
  let h = 2166136261;
  for (const ch of parts.join('\u0001')) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
