// Profit & Loss, the BAS and NZ GST return, US sales tax and Schedule C,
// and lodged tax returns.
import { all, getBooks, one, run } from './db';
import { budgetFor } from './budgets';
import { summarise } from './entries';
import { getSettings, metaValue, updateSettings } from './settings';
import { basLabelsFor, nzBoxesFor, type TaxCode } from '../src/shared/tax';
import { gstSplit, gstinState } from '../src/shared/india';
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
import { partOf, scheduleCFor } from '../src/shared/scheduleC';
import { homeOfficeDeduction } from '../src/shared/usTaxYears';
import { yearInputs } from './taxYear';
import { carYear, mileageBetween } from './trips';
import { incomeReturnFor } from '../src/shared/incomeReturnLines';
import { incomeYearOf } from '../src/shared/incomeYear';
import { auTaxYear } from '../src/shared/auTaxYears';
import { nzTaxYear } from '../src/shared/nzTaxYears';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
type Basis = 'cash' | 'accrual';

function range(from: string, to: string) {
  if (!DATE.test(from) || !DATE.test(to)) throw new Error('Pick a date range.');
  if (to < from) throw new Error('The end date is before the start date.');
}

export function profitAndLoss(p: { from: string; to: string; basis: Basis; compareFrom?: string; compareTo?: string; budget?: boolean }) {
  range(p.from, p.to);
  const current = summarise({ from: p.from, to: p.to, basis: p.basis });
  const compare = p.compareFrom && p.compareTo ? summarise({ from: p.compareFrom, to: p.compareTo, basis: p.basis }) : null;
  const budget = p.budget ? budgetFor(p.from, p.to) : null;
  // Budgeted categories show even before anything has happened in them.
  const budgeted = budget?.size
    ? all<{ id: number; name: string; kind: string }>(getBooks().db,
        `SELECT id, name, kind FROM categories WHERE id IN (${[...budget.keys()].map(Number).join(',')})`)
    : [];
  type Row = { id: number; name: string; total: number; compare: number; budget?: number; children?: Row[] };
  const cats = new Map(all<{ id: number; name: string; parentId: number | null }>(getBooks().db,
    'SELECT id, name, parent_id AS parentId FROM categories').map((c) => [c.id, c]));
  const byTotal = (a: Row, b: Row) => b.total - a.total || (b.budget ?? 0) - (a.budget ?? 0) || a.name.localeCompare(b.name);
  /** Sub-categories under their parent, whose row totals them all. */
  const nest = (rows: Row[]) => {
    const top = new Map<number, Row>();
    const kids = new Map<number, Row[]>();
    for (const r of rows) {
      const parentId = cats.get(r.id)?.parentId;
      if (parentId) (kids.get(parentId) ?? kids.set(parentId, []).get(parentId)!).push(r);
      else top.set(r.id, r);
    }
    for (const [parentId, children] of kids) {
      const own = top.get(parentId);
      // Amounts on the parent itself sit beside its sub-categories.
      if (own && (own.total || own.compare || own.budget)) children.push({ ...own, name: `${own.name} (other)` });
      const row: Row = { id: parentId, name: cats.get(parentId)!.name, total: 0, compare: 0, ...(budget ? { budget: 0 } : {}), children: children.sort(byTotal) };
      for (const c of children) {
        row.total += c.total;
        row.compare += c.compare;
        if (budget) row.budget! += c.budget ?? 0;
      }
      top.set(parentId, row);
    }
    return [...top.values()].sort(byTotal);
  };
  const rowsFor = (kind: 'income' | 'expense') => {
    const map = new Map<number, Row>();
    for (const r of current.byCategory.filter((r: any) => r.kind === kind)) {
      map.set(r.id, { id: r.id, name: r.name, total: r.total, compare: 0 });
    }
    for (const r of compare?.byCategory.filter((r: any) => r.kind === kind) ?? []) {
      const row = map.get(r.id) ?? { id: r.id, name: r.name, total: 0, compare: 0 };
      row.compare = r.total;
      map.set(r.id, row);
    }
    if (budget) {
      for (const c of budgeted.filter((c) => c.kind === kind)) {
        if (!map.has(c.id)) map.set(c.id, { id: c.id, name: c.name, total: 0, compare: 0 });
      }
      for (const row of map.values()) row.budget = budget.get(row.id) ?? 0;
    }
    return nest([...map.values()]);
  };
  const income = rowsFor('income');
  const expense = rowsFor('expense');
  const budgetSum = (rows: { budget?: number }[]) => rows.reduce((t, r) => t + (r.budget ?? 0), 0);
  // Not profit or loss, but people look for it here: GST paid, drawings, loans, assets.
  const other = (current as any).other.map((r: any) => ({
    ...r,
    compare: (compare as any)?.other.find((c: any) => c.id === r.id)?.total ?? 0,
  }));
  return {
    other,
    income,
    expense,
    totals: {
      income: current.income,
      expense: current.expense,
      net: current.income - current.expense,
      compareIncome: compare?.income ?? 0,
      compareExpense: compare?.expense ?? 0,
      compareNet: compare ? compare.income - compare.expense : 0,
      ...(budget
        ? { budgetIncome: budgetSum(income), budgetExpense: budgetSum(expense), budgetNet: budgetSum(income) - budgetSum(expense) }
        : {}),
    },
  };
}

/**
 * Cash flow (direct method): every money account together, credit cards as
 * negative cash. Transfers between them cancel out; journals move no cash.
 * Opening plus the movements always comes to closing.
 */
export function cashFlow(p: { from: string; to: string }) {
  range(p.from, p.to);
  const { db } = getBooks();
  const rows = all<{ class: string; id: number; name: string; amount: number }>(db,
    `SELECT COALESCE(c.class, 'pnl') AS class, COALESCE(c.id, 0) AS id, COALESCE(c.name, 'Uncategorised') AS name,
            SUM(CASE l.kind WHEN 'income' THEN l.gross ELSE -l.gross END) AS amount
     FROM ledger_cash l LEFT JOIN categories c ON c.id = l.category_id
     WHERE l.entry_id IS NOT NULL AND l.date BETWEEN ? AND ?
     GROUP BY c.id
     ORDER BY c.name`, p.from, p.to);
  const byClass = (...classes: string[]) => rows.filter((r) => classes.includes(r.class) && r.amount !== 0).map((r) => ({ label: r.name, amount: r.amount }));
  // Day-to-day: money from sales in, money for expenses out, then each tax payment or refund.
  const pnl = one<{ received: number; paid: number }>(db,
    `SELECT COALESCE(SUM(CASE WHEN l.kind = 'income' THEN l.gross END), 0) AS received,
            COALESCE(SUM(CASE WHEN l.kind = 'expense' THEN l.gross END), 0) AS paid
     FROM ledger_cash l LEFT JOIN categories c ON c.id = l.category_id
     WHERE l.entry_id IS NOT NULL AND l.date BETWEEN ? AND ? AND COALESCE(c.class, 'pnl') = 'pnl'`, p.from, p.to)!;
  const section = (lines: { label: string; amount: number }[]) => ({ lines, total: lines.reduce((t, l) => t + l.amount, 0) });
  const operating = section([
    { label: 'Received from customers and other income', amount: pnl.received },
    { label: 'Paid to suppliers and for expenses', amount: -pnl.paid },
    ...byClass('tax'),
  ].filter((l) => l.amount !== 0));
  const investing = section(byClass('asset'));
  const financing = section(byClass('owner', 'loan'));

  // Cash on hand: opening balances of accounts already tracked, plus every movement so far.
  const cashOn = (date: string) => one<{ n: number }>(db,
    `SELECT COALESCE((SELECT SUM(opening_balance) FROM accounts WHERE opening_date <= ?1), 0)
          + COALESCE((SELECT SUM(CASE kind WHEN 'income' THEN amount WHEN 'expense' THEN -amount ELSE 0 END)
                      FROM entries WHERE date <= ?1), 0) AS n`, date)!.n;
  const dayBefore = (() => {
    const d = new Date(Date.UTC(Number(p.from.slice(0, 4)), Number(p.from.slice(5, 7)) - 1, Number(p.from.slice(8, 10)) - 1));
    return d.toISOString().slice(0, 10);
  })();
  // Accounts that started being tracked during the period bring their opening balance with them.
  const started = one<{ n: number }>(db,
    'SELECT COALESCE(SUM(opening_balance), 0) AS n FROM accounts WHERE opening_date BETWEEN ? AND ?', p.from, p.to)!.n;
  const net = operating.total + investing.total + financing.total;
  return { operating, investing, financing, net, opening: cashOn(dayBefore), started, closing: cashOn(p.to) };
}

/** Income and expenses per calendar month (before tax), oldest first, with empty months filled in. */
export function monthlyTotals(p: { from: string; to: string; basis?: Basis }) {
  range(p.from, p.to);
  const view = p.basis === 'accrual' ? 'ledger_accrual' : 'ledger_cash';
  const found = new Map(all<{ month: string; income: number; expense: number }>(getBooks().db,
    `SELECT substr(l.date, 1, 7) AS month,
            COALESCE(SUM(CASE WHEN l.kind = 'income' THEN l.gross - l.tax END), 0) AS income,
            COALESCE(SUM(CASE WHEN l.kind = 'expense' THEN l.gross - l.tax END), 0) AS expense
     FROM ${view} l LEFT JOIN categories c ON c.id = l.category_id
     WHERE l.date BETWEEN ? AND ? AND COALESCE(c.class, 'pnl') = 'pnl'
     GROUP BY month`, p.from, p.to).map((r) => [r.month, r]));
  const out = [];
  let [y, m] = p.from.slice(0, 7).split('-').map(Number);
  for (let key = p.from.slice(0, 7); key <= p.to.slice(0, 7); key = `${y}-${String(m).padStart(2, '0')}`) {
    out.push(found.get(key) ?? { month: key, income: 0, expense: 0 });
    if (++m > 12) [y, m] = [y + 1, 1];
  }
  return out;
}

/**
 * Sales by customer, or expenses by supplier: the P&L's income or expense
 * total split by contact (before tax), with the previous period beside it.
 */
export function byContact(p: { from: string; to: string; basis: Basis; kind: 'income' | 'expense'; compareFrom?: string; compareTo?: string }) {
  range(p.from, p.to);
  if (p.kind !== 'income' && p.kind !== 'expense') throw new Error('Choose sales or expenses.');
  const view = p.basis === 'accrual' ? 'ledger_accrual' : 'ledger_cash';
  const sums = (from: string, to: string) => all<{ id: number; name: string; total: number; count: number }>(getBooks().db,
    `SELECT COALESCE(ct.id, 0) AS id, COALESCE(ct.name, 'No contact') AS name, SUM(l.gross - l.tax) AS total, COUNT(*) AS count
     FROM ${view} l
     LEFT JOIN categories c ON c.id = l.category_id
     LEFT JOIN contacts ct ON ct.id = l.contact_id
     WHERE l.kind = ? AND l.date BETWEEN ? AND ? AND COALESCE(c.class, 'pnl') = 'pnl'
     GROUP BY ct.id`, p.kind, from, to);
  const map = new Map<number, { id: number; name: string; total: number; count: number; compare: number }>();
  for (const r of sums(p.from, p.to)) map.set(r.id, { ...r, compare: 0 });
  if (p.compareFrom && p.compareTo) {
    range(p.compareFrom, p.compareTo);
    for (const r of sums(p.compareFrom, p.compareTo)) {
      const row = map.get(r.id) ?? { id: r.id, name: r.name, total: 0, count: 0, compare: 0 };
      row.compare = r.total;
      map.set(r.id, row);
    }
  }
  const rows = [...map.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  return {
    rows,
    total: rows.reduce((t, r) => t + r.total, 0),
    compareTotal: rows.reduce((t, r) => t + r.compare, 0),
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
  /** Amounts withheld where no ABN was quoted (not a GST label). */
  W4?: number;
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
  // W4: tax kept back from suppliers who gave no ABN, when it was kept back.
  const w4 = one<{ t: number }>(db,
    `SELECT COALESCE(SUM(e.amount), 0) AS t FROM entries e JOIN accounts a ON a.id = e.account_id
     WHERE a.holds = 'no-abn' AND e.kind = 'expense' AND e.date BETWEEN ? AND ?`, p.from, p.to)!.t;
  if (w4) figures.W4 = w4;
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
  // A payment on an invoice is at the invoice's rate; a sale entered straight in, at its own.
  const rows = all<any>(db,
    `SELECT l.entry_id AS entryId, l.invoice_id AS invoiceId, l.date, l.gross, l.tax, l.tax_code AS taxCode,
            l.memo, c.name AS categoryName, ct.name AS contactName, ct.state AS contactState,
            CASE WHEN l.invoice_id IS NOT NULL THEN i.tax_rate_id ELSE e.tax_rate_id END AS taxRateId
     FROM ${view} l
     LEFT JOIN categories c ON c.id = l.category_id
     LEFT JOIN contacts ct ON ct.id = l.contact_id
     LEFT JOIN invoices i ON i.id = l.invoice_id
     LEFT JOIN entries e ON e.id = l.entry_id
     WHERE l.kind = 'income' AND l.date BETWEEN ? AND ? AND COALESCE(l.tax_code, '') <> 'NTR'
     ORDER BY l.date, l.entry_id`, p.from, p.to);
  const settings = getSettings();
  const rates = new Map(all<any>(db, 'SELECT id, name, state, rate_ppm AS ratePpm FROM tax_rates').map((r) => [r.id, r]));
  const own = { id: null, name: settings.taxRateName || 'Your rate', state: settings.homeState || null, ratePpm: settings.taxRatePpm };
  const totals = { taxableSales: 0, nonTaxableSales: 0, taxCollected: 0 };
  const byRate = new Map<number | null, { id: number | null; name: string; state: string | null; ratePpm: number; taxableSales: number; taxCollected: number }>();
  let untagged = 0;
  for (const r of rows) {
    if (r.taxCode === 'TAX') {
      totals.taxableSales += r.gross - r.tax;
      totals.taxCollected += r.tax;
      const rate = rates.get(r.taxRateId) ?? own;
      const g = byRate.get(rate.id) ?? { ...rate, taxableSales: 0, taxCollected: 0 };
      g.taxableSales += r.gross - r.tax;
      g.taxCollected += r.tax;
      byRate.set(rate.id, g);
      r.taxRateName = rate.name;
    } else {
      totals.nonTaxableSales += r.gross;
      if (!r.taxCode) untagged++;
    }
  }
  return {
    totals: { ...totals, totalSales: totals.taxableSales + totals.nonTaxableSales },
    byRate: [...byRate.values()].sort((a, b) => (a.state ?? '').localeCompare(b.state ?? '') || a.name.localeCompare(b.name)),
    detail: rows,
    untagged,
  };
}

/**
 * Profit & Loss grouped by Schedule C line. Categories with no line are
 * listed so they can be mapped; meals show the deductible half. Credit notes
 * on gross receipts show as returns and allowances (line 2), and Part III
 * works out cost of goods sold from the inventory typed in for the year.
 */
export function scheduleCReport(p: { from: string; to: string; basis: Basis }) {
  range(p.from, p.to);
  const { db } = getBooks();
  const lineOf = new Map(all<any>(db, 'SELECT id, report_line FROM categories').map((c) => [c.id, c.report_line as string | null]));
  const { byCategory } = summarise({ from: p.from, to: p.to, basis: p.basis });
  // Numbered as in the tax year the range ends in.
  const { year, status } = scheduleCFor(p.to);
  const keyed = new Map(year.lines.map((l) => [l.key, l]));
  type Row = { key: string; line: string; label: string; kind: 'income' | 'expense'; part: 'I' | 'II' | 'III'; total: number; deductible: number; categories: { id: number; name: string; total: number }[] };
  const lines = new Map<string, Row>();
  const unmapped: { id: number; name: string; kind: 'income' | 'expense'; total: number }[] = [];
  for (const r of byCategory as any[]) {
    // Gains on business property sold (the asset register) go on Form 4797.
    if (lineOf.get(r.id) === 'form-4797') continue;
    const def = keyed.get(lineOf.get(r.id) ?? '');
    if (!def || def.kind !== r.kind) {
      unmapped.push({ id: r.id, name: r.name, kind: r.kind, total: r.total });
      continue;
    }
    const row = lines.get(def.key) ?? { key: def.key, line: def.line, label: def.label, kind: def.kind, part: partOf(def), total: 0, deductible: 0, categories: [] };
    row.total += r.total;
    row.deductible = Math.round((row.total * (def.deductiblePct ?? 100)) / 100);
    row.categories.push({ id: r.id, name: r.name, total: r.total });
    lines.set(def.key, row);
  }
  const ordered = year.lines.map((l) => lines.get(l.key)).filter((l) => !!l);
  const sum = (part: Row['part'], key?: string) =>
    ordered.filter((l) => l.part === part && (!key || l.key === key)).reduce((t, l) => t + l.deductible, 0);

  // Line 2: credit notes against gross receipts, already netted off line 1's categories.
  const view = p.basis === 'accrual' ? 'ledger_accrual' : 'ledger_cash';
  const receiptCats = [...lineOf].filter(([, k]) => k === 'gross-receipts').map(([id]) => id);
  const returns = receiptCats.length
    ? -(one<{ t: number }>(db,
        `SELECT COALESCE(SUM(l.gross - l.tax), 0) AS t FROM ${view} l JOIN invoices d ON d.id = l.invoice_id
         WHERE d.doc_type = 'credit' AND l.kind = 'income' AND l.date BETWEEN ? AND ?
           AND l.category_id IN (${receiptCats.map(Number).join(',')})`, p.from, p.to)?.t ?? 0)
    : 0;

  // Part III. Opening inventory is what was on hand the day before the range starts.
  const inventory = inventoryValues();
  const openingInventory = inventory[dayBefore(p.from)] ?? 0;
  const closingInventory = inventory[p.to] ?? 0;
  const costOfGoodsSold = openingInventory + sum('III') - closingInventory;

  // Line 9: the standard mileage rate replaces actual car costs; parking and tolls go on top of either.
  const inputs = yearInputs(Number(p.to.slice(0, 4)));
  const miles = mileageBetween(p.from, p.to);
  const method: 'mileage' | 'actual' = (inputs.vehicleMethod ?? (miles.milesTenths > 0 ? 'rate' : 'actual')) === 'rate' ? 'mileage' : 'actual';
  const car = lines.get('car-truck');
  const parking = lines.get('parking-tolls');
  const notDeducted = method === 'mileage' ? car?.categories ?? [] : [];
  if (car || parking || (method === 'mileage' && miles.deduction)) {
    const row: Row = {
      key: 'car-truck', line: keyed.get('car-truck')!.line, label: keyed.get('car-truck')!.label, kind: 'expense', part: 'II',
      total: 0, deductible: 0, categories: [...(method === 'actual' ? car?.categories ?? [] : []), ...(parking?.categories ?? [])],
    };
    row.total = (method === 'mileage' ? miles.deduction : car?.total ?? 0) + (parking?.total ?? 0);
    row.deductible = row.total;
    const at = ordered.findIndex((l) => l.key === 'car-truck' || l.key === 'parking-tolls');
    const kept = ordered.filter((l) => l.key !== 'car-truck' && l.key !== 'parking-tolls');
    const place = at < 0 ? kept.findIndex((l) => l.part === 'II' && Number.parseInt(l.line) > 9) : at;
    kept.splice(place < 0 ? kept.length : place, 0, row);
    ordered.splice(0, ordered.length, ...kept);
  }

  const grossReceipts = sum('I', 'gross-receipts') + returns;
  const netReceipts = grossReceipts - returns;
  const grossProfit = netReceipts - costOfGoodsSold;
  const grossIncome = grossProfit + sum('I') - sum('I', 'gross-receipts');
  const totalExpenses = sum('II');
  const tentativeProfit = grossIncome - totalExpenses;
  // Line 30, simplified method: a share of the year's amount for a shorter range, and never more than the profit.
  const yearDays = daysIn(`${p.to.slice(0, 4)}-01-01`, `${p.to.slice(0, 4)}-12-31`);
  const share = Math.min(1, daysIn(p.from, p.to) / yearDays);
  const homeOfficeFull = homeOfficeDeduction(inputs.homeOfficeSqFt ?? 0, Number(p.to.slice(0, 4)));
  const homeOffice = Math.min(Math.round(homeOfficeFull * share), Math.max(0, tentativeProfit));
  return {
    lines: ordered,
    unmapped,
    partI: { grossReceipts, returns, netReceipts, costOfGoodsSold, grossProfit },
    partIII: {
      // Shown when there's anything to show.
      used: ordered.some((l) => l.part === 'III') || !!openingInventory || !!closingInventory,
      openingInventory,
      closingInventory,
      openingDate: dayBefore(p.from),
    },
    vehicle: { method, milesTenths: miles.milesTenths, mileageDeduction: miles.deduction, notDeducted },
    homeOffice: { sqFt: inputs.homeOfficeSqFt ?? 0, full: homeOfficeFull, deduction: homeOffice, limited: homeOffice < Math.round(homeOfficeFull * share) },
    totals: { grossIncome, totalExpenses, tentativeProfit, homeOffice, netProfit: tentativeProfit - homeOffice },
    rules: { id: year.id, name: year.name, checkedAgainst: year.checkedAgainst, checkedUntil: year.checkedUntil, status },
  };
}

function daysIn(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

/** Inventory on hand at the end of a day, in cents, keyed by date (Schedule C lines 35 and 41). */
function inventoryValues(): Record<string, number> {
  try {
    const v = JSON.parse(metaValue('schedule_c_inventory') ?? '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

/** Sets (or, with null, clears) the inventory on hand at the end of `date`. */
export function setInventory(p: { date: string; amount: number | null }) {
  if (!DATE.test(p.date)) throw new Error('Pick a date.');
  if (p.amount !== null && (!Number.isInteger(p.amount) || p.amount < 0)) throw new Error("Inventory can't be negative.");
  const values = inventoryValues();
  if (p.amount) values[p.date] = p.amount;
  else delete values[p.date];
  run(getBooks().db, 'INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', 'schedule_c_inventory', JSON.stringify(values));
  return true;
}

function dayBefore(date: string) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// ---- AU and NZ: the business income summary ------------------------------------

/**
 * Australia's business schedule (P8) or New Zealand's IR10 from the
 * categories' lines, with cost of sales from the stock on hand, the car
 * (the km rate from the trip log, or actual costs at the business share) and
 * working from home. For the income year the range ends in.
 */
export function incomeReturnReport(p: { from: string; to: string; basis: Basis }) {
  range(p.from, p.to);
  const settings = getSettings();
  const ret = incomeReturnFor(settings.country);
  if (!ret) throw new Error('This is for Australian and New Zealand books.');
  const { db } = getBooks();
  const lineOf = new Map(all<any>(db, 'SELECT id, report_line FROM categories').map((c) => [c.id, c.report_line as string | null]));
  const { byCategory } = summarise({ from: p.from, to: p.to, basis: p.basis });
  const keyed = new Map(ret.lines.map((l) => [l.key, l]));
  type Row = { key: string; code: string; label: string; kind: 'income' | 'expense'; costOfSales: boolean; total: number; categories: { id: number; name: string; total: number }[]; notes: string[] };
  const rows = new Map<string, Row>();
  const unmapped: { id: number; name: string; kind: 'income' | 'expense'; total: number }[] = [];
  const add = (key: string, amount: number, cat?: { id: number; name: string; total: number }, note?: string) => {
    const def = keyed.get(key)!;
    const row = rows.get(key) ?? { key, code: def.code, label: def.label, kind: def.kind, costOfSales: !!def.costOfSales, total: 0, categories: [], notes: [] };
    row.total += amount;
    if (cat) row.categories.push(cat);
    if (note) row.notes.push(note);
    rows.set(key, row);
  };
  const carCats: { id: number; name: string; total: number }[] = [];
  for (const r of byCategory as any[]) {
    let key = lineOf.get(r.id) ?? '';
    const def = keyed.get(key);
    if (!def || def.kind !== r.kind) {
      unmapped.push({ id: r.id, name: r.name, kind: r.kind, total: r.total });
      key = ret.defaults[r.kind as 'income' | 'expense'];
    }
    if (key === ret.carKey) carCats.push({ id: r.id, name: r.name, total: r.total });
    else add(key, r.total, { id: r.id, name: r.name, total: r.total });
  }

  // The car: the km rate from the trip log replaces running costs; otherwise actual costs at the business share.
  const year = incomeYearOf(p.to, settings.fiscalYearStart);
  const car = carYear(year);
  const yearShare = Math.min(1, daysIn(p.from, p.to) / daysIn(car.from, car.to));
  const carCosts = carCats.reduce((t, c) => t + c.total, 0);
  const pct = car.businessPct ?? 100;
  let carTotal = 0;
  if (car.method === 'rate') {
    carTotal = Math.round(car.claim.deduction * yearShare);
    if (carTotal) add(ret.carKey, carTotal, undefined, `${(car.claim.claimedTenths / 10).toLocaleString('en')} km at the ${settings.country === 'AU' ? 'cents per km' : 'kilometre'} rate${car.claim.capped ? ' (the 5,000 km most)' : ''}`);
  } else if (carCosts) {
    carTotal = Math.round((carCosts * pct) / 100);
    add(ret.carKey, carTotal, undefined, car.businessPct == null ? 'All of it: no business share set' : `${pct}% business use of ${carCats.map((c) => c.name).join(', ')}`);
  }

  // Working from home.
  const inputs = car.inputs;
  let homeOffice = 0;
  let homeNote = '';
  if (settings.country === 'AU' && inputs.homeOfficeHours) {
    const { rules } = auTaxYear(year);
    homeOffice = Math.round((inputs.homeOfficeHours * rules.wfhPerHour) / 10 * yearShare);
    homeNote = `Working from home: ${inputs.homeOfficeHours} hours at ${rules.wfhPerHour / 10}c (fixed rate method)`;
  } else if (settings.country === 'NZ' && inputs.homeOfficeArea && inputs.homeArea) {
    const { rules } = nzTaxYear(year);
    const share = inputs.homeOfficeArea / inputs.homeArea;
    homeOffice = Math.round((inputs.homeOfficeArea * rules.homeOfficePerSqm + (inputs.premisesCosts ?? 0) * share) * yearShare);
    homeNote = `Home office: ${inputs.homeOfficeArea} m² of ${inputs.homeArea} m² (${Math.round(share * 1000) / 10}%), square metre rate`;
  }
  if (homeOffice) add(ret.homeOfficeKey, homeOffice, undefined, homeNote);

  const ordered = ret.lines.map((l) => rows.get(l.key)).filter((r) => !!r);
  const inventory = inventoryValues();
  const openingStock = inventory[dayBefore(p.from)] ?? 0;
  const closingStock = inventory[p.to] ?? 0;
  const purchases = ordered.filter((r) => r.costOfSales).reduce((t, r) => t + r.total, 0);
  const costOfSales = openingStock + purchases - closingStock;
  const income = ordered.filter((r) => r.kind === 'income').reduce((t, r) => t + r.total, 0);
  const expenses = ordered.filter((r) => r.kind === 'expense' && !r.costOfSales).reduce((t, r) => t + r.total, 0);
  return {
    country: ret.country,
    title: ret.title,
    source: ret.source,
    checked: ret.checked,
    year,
    lines: ordered,
    unmapped,
    stock: { opening: openingStock, closing: closingStock, openingDate: dayBefore(p.from), purchases, costOfSales },
    car: { method: car.method, distanceTenths: car.distanceTenths, claim: car.claim, businessPct: car.businessPct, costs: carCosts, notDeducted: car.method === 'rate' ? carCats : [], total: carTotal },
    homeOffice,
    totals: { income, costOfSales, grossProfit: income - costOfSales, expenses, net: income - costOfSales - expenses },
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

/**
 * India: the summary behind GSTR-1 and GSTR-3B. GST falls due when the invoice
 * is issued for services, so this always reads the accrual ledger, whatever the
 * basis. A sale's tax is CGST and SGST in half each within the home state, and
 * IGST otherwise. Credits on purchases aren't split by head: bills and expenses
 * don't record a place of supply.
 */
export function inGstReport(p: { from: string; to: string }) {
  range(p.from, p.to);
  const settings = getSettings();
  const home = settings.homeState || gstinState(settings.taxId);
  const rows = all<any>(getBooks().db,
    `SELECT l.entry_id AS entryId, l.invoice_id AS invoiceId, l.date, l.kind, l.gross, l.tax, l.tax_code AS taxCode,
            l.memo, c.name AS categoryName, ct.name AS contactName, i.place_of_supply AS place
     FROM ledger_accrual l
     LEFT JOIN categories c ON c.id = l.category_id
     LEFT JOIN contacts ct ON ct.id = l.contact_id
     LEFT JOIN invoices i ON i.id = l.invoice_id
     WHERE l.date BETWEEN ? AND ?
     ORDER BY l.date, l.entry_id`, p.from, p.to);
  const figures: ReturnFigures = { taxable: 0, zero: 0, exempt: 0, igst: 0, cgst: 0, sgst: 0, purchases: 0, itc: 0 };
  const detail = [];
  let untagged = 0;
  let local = 0;
  for (const r of rows) {
    if (!r.taxCode) {
      untagged++;
      continue;
    }
    const net = r.gross - r.tax;
    if (r.taxCode === 'NTR') continue;
    let label: string;
    if (r.kind === 'expense') {
      if (r.taxCode !== 'GST') continue;
      label = 'Credits';
      figures.purchases += net;
      figures.itc += r.tax;
    } else if (r.taxCode === 'ZER') {
      label = 'Zero-rated';
      figures.zero += net;
    } else if (r.taxCode === 'EXE') {
      label = 'Exempt';
      figures.exempt += net;
    } else {
      label = 'Taxable';
      figures.taxable += net;
      // Income entered without an invoice has no place of supply: it's taken as local.
      if (r.invoiceId === null || gstSplit(r.place, home) === 'intra') local += r.tax;
      else figures.igst += r.tax;
    }
    detail.push({ ...r, labels: [label] });
  }
  // Split once, on the total: income without an invoice can leave an odd paisa.
  figures.cgst = Math.round(local / 2);
  figures.sgst = local - figures.cgst;
  return { figures, detail, untagged, context: null, byRate: gstByRate(p.from, p.to, settings.taxRatePpm) };
}

/**
 * Canada: the lines of the GST/HST return. Tax is reported on paid and unpaid
 * invoices alike, so this always reads the accrual ledger.
 */
export function caGstReport(p: { from: string; to: string }) {
  range(p.from, p.to);
  const rows = taxLedgerRows('ledger_accrual', p.from, p.to);
  const figures: ReturnFigures = { '101': 0, '103': 0, '106': 0, purchases: 0 };
  const detail = [];
  let untagged = 0;
  for (const r of rows) {
    if (!r.taxCode) {
      untagged++;
      continue;
    }
    if (r.taxCode === 'NTR') continue;
    const net = r.gross - r.tax;
    if (r.kind === 'income') {
      figures['101'] += net;
      figures['103'] += r.tax;
      detail.push({ ...r, labels: r.tax ? ['101', '103'] : ['101'] });
    } else if (r.tax) {
      figures.purchases += net;
      figures['106'] += r.tax;
      detail.push({ ...r, labels: ['106'] });
    }
  }
  return { figures, detail, untagged, context: null, byRate: gstByRate(p.from, p.to, getSettings().taxRatePpm) };
}

/**
 * The UK's VAT return, on the books' basis (cash for the Cash Accounting Scheme).
 * Box 6 takes every sale before VAT and Box 7 every purchase, zero-rated and
 * exempt included. Not-reportable rows stay off.
 */
export function ukVatReport(p: { from: string; to: string; basis: Basis }) {
  range(p.from, p.to);
  const rows = taxLedgerRows(p.basis === 'accrual' ? 'ledger_accrual' : 'ledger_cash', p.from, p.to);
  const figures: ReturnFigures = { '1': 0, '4': 0, '6': 0, '7': 0 };
  const detail = [];
  let untagged = 0;
  for (const r of rows) {
    if (!r.taxCode) {
      untagged++;
      continue;
    }
    if (r.taxCode === 'NTR') continue;
    const net = r.gross - r.tax;
    const [taxBox, valueBox] = r.kind === 'income' ? ['1', '6'] : ['4', '7'];
    figures[taxBox] += r.tax;
    figures[valueBox] += net;
    detail.push({ ...r, labels: r.tax ? [taxBox, valueBox] : [valueBox] });
  }
  // By rate reads documents by their date, so it only lines up with the boxes on accrual.
  return { figures, detail, untagged, context: null, byRate: p.basis === 'accrual' ? gstByRate(p.from, p.to, getSettings().taxRatePpm) : [] };
}

function taxLedgerRows(view: 'ledger_accrual' | 'ledger_cash', from: string, to: string) {
  return all<any>(getBooks().db,
    `SELECT l.entry_id AS entryId, l.invoice_id AS invoiceId, l.date, l.kind, l.gross, l.tax, l.tax_code AS taxCode,
            l.memo, c.name AS categoryName, ct.name AS contactName
     FROM ${view} l
     LEFT JOIN categories c ON c.id = l.category_id
     LEFT JOIN contacts ct ON ct.id = l.contact_id
     WHERE l.date BETWEEN ? AND ?
     ORDER BY l.date, l.entry_id`, from, to);
}

/** Taxable sales and purchases at each rate: for GSTR-1's rate-wise tables, and to check a return by eye. */
function gstByRate(from: string, to: string, booksRate: number) {
  const rows = all<{ kind: string; ratePpm: number; net: number; tax: number }>(getBooks().db,
    `SELECT kind, rate AS ratePpm, SUM(net) AS net, SUM(tax) AS tax FROM (
       SELECT e.kind, COALESCE(e.tax_rate_ppm, ?1) AS rate, e.amount - e.tax_amount AS net, e.tax_amount AS tax
       FROM entries e
       WHERE e.kind <> 'transfer' AND e.invoice_id IS NULL AND e.tax_code = 'GST' AND e.date BETWEEN ?2 AND ?3
       UNION ALL
       SELECT d.kind, COALESCE(l.tax_rate_ppm, i.tax_rate_ppm, ?1), d.sign * d.net, d.sign * d.tax
       FROM doc_lines d JOIN invoice_lines l ON l.id = d.line_id JOIN invoices i ON i.id = d.invoice_id
       WHERE d.doc_status = 'sent' AND d.tax_code = 'GST' AND d.issue_date BETWEEN ?2 AND ?3
     ) GROUP BY kind, rate`, booksRate, from, to);
  const out = new Map<number, { ratePpm: number; sales: number; salesTax: number; purchases: number; credit: number }>();
  for (const r of rows) {
    const row = out.get(r.ratePpm) ?? { ratePpm: r.ratePpm, sales: 0, salesTax: 0, purchases: 0, credit: 0 };
    if (r.kind === 'income') (row.sales += r.net), (row.salesTax += r.tax);
    else (row.purchases += r.net), (row.credit += r.tax);
    out.set(r.ratePpm, row);
  }
  return [...out.values()].sort((a, b) => a.ratePpm - b.ratePpm);
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
  if (kind === 'in-gst') return { kind, ...inGstReport(p) };
  if (kind === 'ca-gst') return { kind, ...caGstReport(p) };
  if (kind === 'uk-vat') return { kind, ...ukVatReport(p) };
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
