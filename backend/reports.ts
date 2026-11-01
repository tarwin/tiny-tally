// Profit & Loss, the BAS and NZ GST return, US sales tax and Schedule C,
// and lodged tax returns.
import { all, getBooks, one, run } from './db';
import { summarise } from './entries';
import { getSettings, updateSettings } from './settings';
import { basLabelsFor, nzBoxesFor, type TaxCode } from '../src/shared/tax';
import { countryProfile } from '../src/shared/countries';
import {
  rulesFor,
  adjustmentGst,
  adjustmentTotals,
  isReturnKind,
  type Adjustment,
  type AdjustmentContext,
  type AdjustmentDef,
  type ReturnFigures,
  type ReturnInputs,
  type ReturnKind,
} from '../src/shared/taxReturns';
import { scheduleCFor } from '../src/shared/scheduleC';

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
  const { db } = getBooks();
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

// ---- US -----------------------------------------------------------------------

/**
 * US sales tax collected over a period: taxable sales (before tax), sales
 * with no tax charged, and the tax itself. Copy it into the state's return.
 */
export function salesTaxReport(p: { from: string; to: string; basis: Basis }) {
  range(p.from, p.to);
  const { db } = getBooks();
  const view = p.basis === 'accrual' ? 'ledger_accrual' : 'ledger_cash';
  const rows = all<any>(db,
    `SELECT l.entry_id AS entryId, l.invoice_id AS invoiceId, l.date, l.gross, l.tax, l.tax_code AS taxCode,
            l.memo, c.name AS categoryName, ct.name AS contactName
     FROM ${view} l
     LEFT JOIN categories c ON c.id = l.category_id
     LEFT JOIN contacts ct ON ct.id = l.contact_id
     WHERE l.kind = 'income' AND l.date BETWEEN ? AND ? AND COALESCE(l.tax_code, '') <> 'NTR'
     ORDER BY l.date, l.entry_id`, p.from, p.to);
  const totals = { taxableSales: 0, nonTaxableSales: 0, taxCollected: 0 };
  let untagged = 0;
  for (const r of rows) {
    if (r.taxCode === 'TAX') {
      totals.taxableSales += r.gross - r.tax;
      totals.taxCollected += r.tax;
    } else {
      totals.nonTaxableSales += r.gross;
      if (!r.taxCode) untagged++;
    }
  }
  return { totals: { ...totals, totalSales: totals.taxableSales + totals.nonTaxableSales }, detail: rows, untagged };
}

/**
 * Profit & Loss grouped by Schedule C line. Categories with no line are
 * listed so they can be mapped; meals show the deductible half.
 */
export function scheduleCReport(p: { from: string; to: string; basis: Basis }) {
  range(p.from, p.to);
  const { db } = getBooks();
  const lineOf = new Map(all<any>(db, 'SELECT id, report_line FROM categories').map((c) => [c.id, c.report_line as string | null]));
  const { byCategory } = summarise({ from: p.from, to: p.to, basis: p.basis });
  // Numbered as in the tax year the range ends in.
  const { year, status } = scheduleCFor(p.to);
  const keyed = new Map(year.lines.map((l) => [l.key, l]));
  const lines = new Map<string, { line: string; label: string; kind: 'income' | 'expense'; total: number; deductible: number; categories: { id: number; name: string; total: number }[] }>();
  const unmapped: { id: number; name: string; kind: 'income' | 'expense'; total: number }[] = [];
  for (const r of byCategory as any[]) {
    const def = keyed.get(lineOf.get(r.id) ?? '');
    if (!def || def.kind !== r.kind) {
      unmapped.push({ id: r.id, name: r.name, kind: r.kind, total: r.total });
      continue;
    }
    const row = lines.get(def.line) ?? { line: def.line, label: def.label, kind: def.kind, total: 0, deductible: 0, categories: [] };
    row.total += r.total;
    row.deductible = Math.round((row.total * (def.deductiblePct ?? 100)) / 100);
    row.categories.push({ id: r.id, name: r.name, total: r.total });
    lines.set(def.line, row);
  }
  const ordered = year.lines.map((l) => lines.get(l.line)).filter((l) => !!l);
  const sum = (kind: 'income' | 'expense') => ordered.filter((l) => l.kind === kind).reduce((t, l) => t + l.deductible, 0);
  const grossIncome = sum('income');
  const totalExpenses = sum('expense');
  return {
    lines: ordered,
    unmapped,
    totals: { grossIncome, totalExpenses, netProfit: grossIncome - totalExpenses },
    rules: { id: year.id, name: year.name, checkedAgainst: year.checkedAgainst, checkedUntil: year.checkedUntil, status },
  };
}

// ---- NZ -----------------------------------------------------------------------

/** GST return Boxes 5, 6 and 11 in cents, plus every row that fed them. */
export function nzGstReport(p: { from: string; to: string; basis: Basis }) {
  range(p.from, p.to);
  const { db } = getBooks();
  const view = p.basis === 'accrual' ? 'ledger_accrual' : 'ledger_cash';
  const rows = all<any>(db,
    `SELECT l.entry_id AS entryId, l.invoice_id AS invoiceId, l.date, l.kind, l.gross, l.tax, l.tax_code AS taxCode,
            l.memo, c.name AS categoryName, ct.name AS contactName
     FROM ${view} l
     LEFT JOIN categories c ON c.id = l.category_id
     LEFT JOIN contacts ct ON ct.id = l.contact_id
     WHERE l.date BETWEEN ? AND ?
     ORDER BY l.date, l.entry_id`, p.from, p.to);
  const figures: ReturnFigures = { '5': 0, '6': 0, '11': 0 };
  const detail = [];
  let untagged = 0;
  for (const r of rows) {
    if (!r.taxCode) {
      untagged++;
      continue;
    }
    const boxes = nzBoxesFor(r.kind, r.taxCode as TaxCode);
    for (const b of boxes) figures[b] += r.gross;
    if (boxes.length) detail.push({ ...r, labels: boxes });
  }
  // What private-use and entertainment adjustments are worked out from.
  const context: AdjustmentContext = {
    period: claimedByCategory(view, p.from, p.to),
    yearToDate: claimedByCategory(view, yearStart(p.to), p.to),
  };
  return { figures, detail, untagged, context };
}

/** GST-inclusive purchases in Box 11, per category. */
function claimedByCategory(view: string, from: string, to: string) {
  const out: Record<number, number> = {};
  for (const r of all<any>(getBooks().db,
    `SELECT category_id AS id, SUM(gross) AS gross FROM ${view}
     WHERE kind = 'expense' AND tax_code = 'GST' AND category_id IS NOT NULL AND date BETWEEN ? AND ?
     GROUP BY category_id`, from, to)) out[r.id] = r.gross;
  return out;
}

/** The first day of the financial year that `date` falls in. */
function yearStart(date: string) {
  const start = `${date.slice(0, 4)}-${getSettings().fiscalYearStart}`;
  return start <= date ? start : `${Number(date.slice(0, 4)) - 1}-${getSettings().fiscalYearStart}`;
}

// ---- tax returns --------------------------------------------------------------
// The BAS (AU) and GST return (NZ) share one table and one lodge-and-lock flow.

/** The return these books prepare, or an error where there isn't one. */
function returnKind(): ReturnKind {
  const report = countryProfile(getSettings().country).tax?.report;
  if (!isReturnKind(report)) throw new Error("These books don't prepare a tax return.");
  return report;
}

/** The figures for the books' own return. */
export function taxReturnReport(p: { from: string; to: string; basis: Basis }) {
  const kind = returnKind();
  if (kind === 'bas') {
    const r = basReport(p);
    return { kind, figures: r.figures as unknown as ReturnFigures, detail: r.detail, untagged: r.untagged, context: null };
  }
  return { kind, ...nzGstReport(p) };
}

export function listTaxReturns() {
  return all(getBooks().db,
    `SELECT id, period_start AS periodStart, period_end AS periodEnd, basis, figures, inputs, adjustments, rules, status,
            lodged_at AS lodgedAt, created_at AS createdAt
     FROM tax_returns ORDER BY period_start DESC`,
  ).map((r: any) => ({ ...r, figures: JSON.parse(r.figures), inputs: JSON.parse(r.inputs), adjustments: JSON.parse(r.adjustments) }));
}

export function saveTaxReturn(p: {
  periodStart: string;
  periodEnd: string;
  basis: Basis;
  inputs?: ReturnInputs;
  adjustments?: Adjustment[];
  lodge?: boolean;
  /** The person has checked figures worked out with rules this version hasn't been checked for. */
  acknowledged?: boolean;
}) {
  range(p.periodStart, p.periodEnd);
  const { rules, status: ruleStatus } = rulesFor(returnKind(), p.periodEnd);
  const form = rules.form;
  if (p.lodge && ruleStatus !== 'checked' && !p.acknowledged) {
    throw new Error(`This version of Tiny Tally hasn't been checked against the ${form.short} rules for this period. Update the app, or check the figures yourself before lodging.`);
  }
  const { db } = getBooks();
  const existing = one<any>(db, 'SELECT * FROM tax_returns WHERE period_start = ? AND period_end = ?', p.periodStart, p.periodEnd);
  if (existing?.status === 'lodged') throw new Error(`This ${form.short} is already lodged. Reopen it to make changes.`);
  const overlap = one<any>(db,
    `SELECT period_start, period_end FROM tax_returns
     WHERE status = 'lodged' AND period_start <= ? AND period_end >= ? AND NOT (period_start = ? AND period_end = ?)`,
    p.periodEnd, p.periodStart, p.periodStart, p.periodEnd);
  if (overlap) throw new Error(`This overlaps a lodged ${form.short} (${overlap.period_start} to ${overlap.period_end}).`);
  // Only the form's own boxes, never negative.
  const inputs: ReturnInputs = {};
  for (const { key, label } of form.inputs) {
    const n = Math.round(Number(p.inputs?.[key]) || 0);
    if (n < 0) throw new Error(`${label} can't be negative.`);
    inputs[key] = n;
  }
  const { figures, context } = taxReturnReport({ from: p.periodStart, to: p.periodEnd, basis: p.basis });
  // Adjustments are kept with the GST each came to, and total into Boxes 9 and 13.
  const adjustments = form.adjustments ? cleanAdjustments(p.adjustments ?? [], form.adjustments).map((a) => ({ ...a, gst: adjustmentGst(a, context!) })) : [];
  if (form.adjustments) Object.assign(inputs, adjustmentTotals(adjustments, context!));
  const status = p.lodge ? 'lodged' : 'draft';
  db.transaction(() => {
    if (existing) {
      run(db,
        `UPDATE tax_returns SET basis = ?, figures = ?, inputs = ?, adjustments = ?, rules = ?, status = ?,
           lodged_at = CASE WHEN ? = 'lodged' THEN datetime('now') END WHERE id = ?`,
        p.basis, JSON.stringify(figures), JSON.stringify(inputs), JSON.stringify(adjustments), rules.id, status, status, existing.id);
    } else {
      run(db,
        `INSERT INTO tax_returns (period_start, period_end, basis, figures, inputs, adjustments, rules, status, lodged_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'lodged' THEN datetime('now') END)`,
        p.periodStart, p.periodEnd, p.basis, JSON.stringify(figures), JSON.stringify(inputs), JSON.stringify(adjustments), rules.id, status, status);
    }
  })();
  if (p.lodge) refreshLockDate();
  return true;
}

/** Only the form's own adjustment types, with sane amounts and an existing category. */
function cleanAdjustments(list: Adjustment[], defs: AdjustmentDef[]): Adjustment[] {
  const { db } = getBooks();
  return list.map((a, i) => {
    const def = defs.find((d) => d.type === a?.type);
    const n = i + 1;
    if (!def) throw new Error(`Adjustment ${n}: choose what kind of adjustment it is.`);
    const description = String(a.description ?? '').trim().slice(0, 200);
    if (def.how === 'percent') {
      const categoryId = Number(a.categoryId);
      if (!one(db, 'SELECT id FROM categories WHERE id = ?', categoryId)) throw new Error(`Adjustment ${n}: choose a category.`);
      const percent = def.fixedPercent ?? Math.round(Number(a.percent) * 100) / 100;
      if (!(percent > 0 && percent <= 100)) throw new Error(`Adjustment ${n}: enter a percentage between 0 and 100.`);
      return { type: def.type, description, categoryId, percent };
    }
    const amount = Math.round(Number(a.amount));
    if (!(amount > 0)) throw new Error(`Adjustment ${n}: enter an amount.`);
    return { type: def.type, description, amount };
  });
}

export function reopenTaxReturn(id: number) {
  run(getBooks().db, "UPDATE tax_returns SET status = 'draft', lodged_at = NULL WHERE id = ?", id);
  refreshLockDate();
  return true;
}

export function deleteTaxReturn(id: number) {
  const { db } = getBooks();
  const r = one<any>(db, 'SELECT status FROM tax_returns WHERE id = ?', id);
  if (r?.status === 'lodged') throw new Error('Reopen a lodged return before deleting it.');
  run(db, 'DELETE FROM tax_returns WHERE id = ?', id);
  return true;
}

/** The lock date follows the latest lodged return (or clears when none are lodged). */
function refreshLockDate() {
  const { db } = getBooks();
  const latest = one<{ d: string | null }>(db, "SELECT MAX(period_end) AS d FROM tax_returns WHERE status = 'lodged'")!.d;
  updateSettings({ lockDate: latest });
  return getSettings().lockDate;
}
