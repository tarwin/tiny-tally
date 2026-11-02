// Manual journal entries: depreciation, accruals, prepayments, corrections.
// Each is a set of debit/credit lines that total zero (see schema v7).
import { all, getBooks, one, run } from './db';
import { assertUnlocked } from './settings';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The ledger's own accounts a journal may use (besides categories). */
export const SYSTEM_ACCOUNTS = {
  gst: { name: 'GST', type: 'liability', group: 'Tax' },
  opening: { name: 'Opening balance equity', type: 'equity', group: 'Equity' },
  accruals: { name: 'Accrued expenses', type: 'liability', group: 'Money you owe' },
  prepayments: { name: 'Prepayments', type: 'asset', group: 'Money owed to you' },
  accumdep: { name: 'Accumulated depreciation', type: 'asset', group: 'Assets' },
} as const;
export type SystemAccount = keyof typeof SYSTEM_ACCOUNTS;

export interface JournalLineInput {
  /** 'cat:<id>' or one of SYSTEM_ACCOUNTS */
  account: string;
  /** cents; debit positive, credit negative */
  amount: number;
  memo?: string | null;
}

export interface JournalInput {
  id?: number;
  date: string;
  reference?: string | null;
  memo?: string | null;
  lines: JournalLineInput[];
}

const clean = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

function lineKey(l: { category_id: number | null; system: string | null }) {
  return l.category_id !== null ? `cat:${l.category_id}` : l.system!;
}

export function listJournals(q: { from?: string; to?: string } = {}) {
  const { db } = getBooks();
  const where: string[] = [];
  const args: string[] = [];
  if (q.from && DATE.test(q.from)) {
    where.push('j.date >= ?');
    args.push(q.from);
  }
  if (q.to && DATE.test(q.to)) {
    where.push('j.date <= ?');
    args.push(q.to);
  }
  return all(db,
    `SELECT j.id, j.date, j.reference, j.memo,
            COALESCE(SUM(CASE WHEN l.amount > 0 THEN l.amount END), 0) AS total,
            COUNT(l.id) AS lineCount
     FROM journals j LEFT JOIN journal_lines l ON l.journal_id = j.id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     GROUP BY j.id ORDER BY j.date DESC, j.id DESC`, ...args);
}

export function getJournal(id: number) {
  const { db } = getBooks();
  const j = one<any>(db, 'SELECT id, date, reference, memo FROM journals WHERE id = ?', id);
  if (!j) throw new Error('That journal entry no longer exists.');
  const lines = all<any>(db, 'SELECT category_id, system, amount, memo FROM journal_lines WHERE journal_id = ? ORDER BY sort, id', id);
  return { ...j, lines: lines.map((l) => ({ account: lineKey(l), amount: l.amount, memo: l.memo })) };
}

export function saveJournal(input: JournalInput) {
  const { db } = getBooks();
  if (!DATE.test(String(input.date))) throw new Error('Pick a date.');
  const existing = input.id ? one<any>(db, 'SELECT * FROM journals WHERE id = ?', input.id) : null;
  if (input.id && !existing) throw new Error('That journal entry no longer exists.');
  assertUnlocked(input.date, existing?.date);

  const lines = (Array.isArray(input.lines) ? input.lines : [])
    .map((l) => ({ account: String(l?.account ?? ''), amount: Math.round(Number(l?.amount) || 0), memo: clean(l?.memo) }))
    .filter((l) => l.amount !== 0);
  if (lines.length < 2) throw new Error('A journal needs at least two lines with amounts.');
  const total = lines.reduce((s, l) => s + l.amount, 0);
  if (total !== 0) throw new Error("Debits and credits don't balance.");

  const rows = lines.map((l) => {
    const cat = /^cat:(\d+)$/.exec(l.account);
    if (cat) {
      const c = one<any>(db, 'SELECT id, name, is_archived FROM categories WHERE id = ?', Number(cat[1]));
      if (!c) throw new Error('Choose an account for every line.');
      return { categoryId: c.id as number, system: null, ...l };
    }
    if (l.account in SYSTEM_ACCOUNTS) return { categoryId: null, system: l.account, ...l };
    throw new Error('Choose an account for every line.');
  });

  let id = 0;
  db.transaction(() => {
    if (existing) {
      id = existing.id;
      run(db, "UPDATE journals SET date = ?, reference = ?, memo = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?",
        input.date, clean(input.reference), clean(input.memo), id);
      run(db, 'DELETE FROM journal_lines WHERE journal_id = ?', id);
    } else {
      id = one<{ id: number }>(db, 'INSERT INTO journals (date, reference, memo) VALUES (?, ?, ?) RETURNING id',
        input.date, clean(input.reference), clean(input.memo))!.id;
    }
    const ins = db.prepare('INSERT INTO journal_lines (journal_id, sort, category_id, system, amount, memo) VALUES (?, ?, ?, ?, ?, ?)');
    rows.forEach((r, i) => ins.run(id, i, r.categoryId, r.system, r.amount, r.memo));
    ins.finalize();
  })();
  return id;
}

export function deleteJournal(id: number) {
  const { db } = getBooks();
  const j = one<any>(db, 'SELECT date FROM journals WHERE id = ?', id);
  if (!j) return true;
  assertUnlocked(j.date);
  run(db, 'DELETE FROM journals WHERE id = ?', id);
  return true;
}

/** Every journal line up to `to`, for the ledger. */
export function journalLinesTo(to: string) {
  return all<any>(getBooks().db,
    `SELECT j.id, j.date, j.reference, j.memo AS journalMemo, l.category_id, l.system, l.amount, l.memo
     FROM journal_lines l JOIN journals j ON j.id = l.journal_id
     WHERE j.date <= ? ORDER BY j.date, j.id, l.sort, l.id`, to);
}
