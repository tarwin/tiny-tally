// Profit & Loss, BAS / GST, and lodged BAS returns.
import { all, getCompany, one, run } from './db';
import { summarise } from './entries';
import { getSettings, updateSettings } from './settings';
import { basLabelsFor, type TaxCode } from '../src/shared/tax';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
type Basis = 'cash' | 'accrual';

function range(from: string, to: string) {
  if (!DATE.test(from) || !DATE.test(to)) throw new Error('Pick a date range.');
  if (to < from) throw new Error('The end date is before the start date.');
}

export function profitAndLoss(p: { from: string; to: string; basis: Basis; compareFrom?: string; compareTo?: string }) {
  range(p.from, p.to);
  const current = summarise({ from: p.from, to: p.to, basis: p.basis });
  const compare = p.compareFrom && p.compareTo ? summarise({ from: p.compareFrom, to: p.compareTo, basis: p.basis }) : null;
  const rowsFor = (kind: 'income' | 'expense') => {
    const map = new Map<number, { id: number; name: string; total: number; compare: number }>();
    for (const r of current.byCategory.filter((r: any) => r.kind === kind)) {
      map.set(r.id, { id: r.id, name: r.name, total: r.total, compare: 0 });
    }
    for (const r of compare?.byCategory.filter((r: any) => r.kind === kind) ?? []) {
      const row = map.get(r.id) ?? { id: r.id, name: r.name, total: 0, compare: 0 };
      row.compare = r.total;
      map.set(r.id, row);
    }
    return [...map.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  };
  // Not profit or loss, but people look for it here: GST paid, drawings, loans, assets.
  const other = (current as any).other.map((r: any) => ({
    ...r,
    compare: (compare as any)?.other.find((c: any) => c.id === r.id)?.total ?? 0,
  }));
  return {
    other,
    income: rowsFor('income'),
    expense: rowsFor('expense'),
    totals: {
      income: current.income,
      expense: current.expense,
      net: current.income - current.expense,
      compareIncome: compare?.income ?? 0,
      compareExpense: compare?.expense ?? 0,
      compareNet: compare ? compare.income - compare.expense : 0,
    },
  };
}

export interface BasFigures {
  G1: number;
  G2: number;
  G3: number;
  G4: number;
  G10: number;
  G11: number;
  '1A': number;
  '1B': number;
}

/** BAS labels in cents, plus every row that fed them. */
export function basReport(p: { from: string; to: string; basis: Basis }) {
  range(p.from, p.to);
  const { db } = getCompany();
  const view = p.basis === 'accrual' ? 'ledger_accrual' : 'ledger_cash';
  const rows = all<any>(db,
    `SELECT l.entry_id AS entryId, l.invoice_id AS invoiceId, l.date, l.kind, l.gross, l.tax, l.tax_code AS taxCode,
            l.memo, c.name AS categoryName, ct.name AS contactName
     FROM ${view} l
     LEFT JOIN categories c ON c.id = l.category_id
     LEFT JOIN contacts ct ON ct.id = l.contact_id
     WHERE l.date BETWEEN ? AND ?
     ORDER BY l.date, l.entry_id`, p.from, p.to);
  const figures: BasFigures = { G1: 0, G2: 0, G3: 0, G4: 0, G10: 0, G11: 0, '1A': 0, '1B': 0 };
  const detail = [];
  let untagged = 0;
  for (const r of rows) {
    if (!r.taxCode) {
      untagged++;
      continue;
    }
    const { g, tax } = basLabelsFor(r.kind, r.taxCode as TaxCode);
    for (const label of g) figures[label as keyof BasFigures] += r.gross;
    if (tax) figures[tax] += r.tax;
    if (g.length || tax) detail.push({ ...r, labels: [...g, ...(tax ? [tax] : [])] });
  }
  return { figures, detail, untagged };
}

// ---- lodged returns ---------------------------------------------------------

export function listBasReturns() {
  return all(getCompany().db,
    `SELECT id, period_start AS periodStart, period_end AS periodEnd, basis, figures, w1, w2, t7, status,
            lodged_at AS lodgedAt, created_at AS createdAt
     FROM bas_returns ORDER BY period_start DESC`,
  ).map((r: any) => ({ ...r, figures: JSON.parse(r.figures) }));
}

export function saveBasReturn(p: { periodStart: string; periodEnd: string; basis: Basis; w1: number; w2: number; t7: number; lodge?: boolean }) {
  range(p.periodStart, p.periodEnd);
  const { db } = getCompany();
  const existing = one<any>(db, 'SELECT * FROM bas_returns WHERE period_start = ? AND period_end = ?', p.periodStart, p.periodEnd);
  if (existing?.status === 'lodged') throw new Error('This BAS is already lodged. Reopen it to make changes.');
  const overlap = one<any>(db,
    `SELECT period_start, period_end FROM bas_returns
     WHERE status = 'lodged' AND period_start <= ? AND period_end >= ? AND NOT (period_start = ? AND period_end = ?)`,
    p.periodEnd, p.periodStart, p.periodStart, p.periodEnd);
  if (overlap) throw new Error(`This overlaps a lodged BAS (${overlap.period_start} to ${overlap.period_end}).`);
  const nonNeg = (v: unknown, label: string) => {
    const n = Math.round(Number(v) || 0);
    if (n < 0) throw new Error(`${label} can't be negative.`);
    return n;
  };
  const w1 = nonNeg(p.w1, 'W1'), w2 = nonNeg(p.w2, 'W2'), t7 = nonNeg(p.t7, 'T7');
  const { figures } = basReport({ from: p.periodStart, to: p.periodEnd, basis: p.basis });
  const status = p.lodge ? 'lodged' : 'draft';
  db.transaction(() => {
    if (existing) {
      run(db,
        `UPDATE bas_returns SET basis = ?, figures = ?, w1 = ?, w2 = ?, t7 = ?, status = ?,
           lodged_at = CASE WHEN ? = 'lodged' THEN datetime('now') END WHERE id = ?`,
        p.basis, JSON.stringify(figures), w1, w2, t7, status, status, existing.id);
    } else {
      run(db,
        `INSERT INTO bas_returns (period_start, period_end, basis, figures, w1, w2, t7, status, lodged_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'lodged' THEN datetime('now') END)`,
        p.periodStart, p.periodEnd, p.basis, JSON.stringify(figures), w1, w2, t7, status, status);
    }
  })();
  if (p.lodge) refreshLockDate();
  return true;
}

export function reopenBasReturn(id: number) {
  run(getCompany().db, "UPDATE bas_returns SET status = 'draft', lodged_at = NULL WHERE id = ?", id);
  refreshLockDate();
  return true;
}

export function deleteBasReturn(id: number) {
  const { db } = getCompany();
  const r = one<any>(db, 'SELECT status FROM bas_returns WHERE id = ?', id);
  if (r?.status === 'lodged') throw new Error('Reopen a lodged BAS before deleting it.');
  run(db, 'DELETE FROM bas_returns WHERE id = ?', id);
  return true;
}

/** The lock date follows the latest lodged BAS (or clears when none are lodged). */
function refreshLockDate() {
  const { db } = getCompany();
  const latest = one<{ d: string | null }>(db, "SELECT MAX(period_end) AS d FROM bas_returns WHERE status = 'lodged'")!.d;
  updateSettings({ lockDate: latest });
  return getSettings().lockDate;
}
