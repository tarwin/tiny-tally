// US year-end and through-the-year tax: Form 1099-NEC payees, quarterly
// estimated tax (1040-ES), sales tax rates beyond the books' own, and sales
// by state against each state's economic nexus threshold. The trip log is in
// trips.ts, the year's inputs in taxYear.ts.
//
// Figures that change by year come from src/shared/usTaxYears.ts; the state
// thresholds from src/shared/usStates.ts.
import { all, getBooks, one, run } from './db';
import { getSettings } from './settings';
import { US_STATES, US_STATE_MAP } from '../src/shared/usStates';
import { selfEmploymentTax, usTaxYear } from '../src/shared/usTaxYears';
import { yearInputs, yearOf } from './taxYear';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const clean = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

function assertUs() {
  if (getSettings().country !== 'US') throw new Error('This is only for US books.');
}


// ---- sales tax rates ------------------------------------------------------------

export interface TaxRateInput {
  id?: number;
  name: string;
  state?: string | null;
  ratePpm: number;
}

export function listTaxRates() {
  return all<any>(getBooks().db,
    `SELECT r.id, r.name, r.state, r.rate_ppm AS ratePpm, r.is_archived AS archived,
            (SELECT COUNT(*) FROM invoices i WHERE i.tax_rate_id = r.id)
              + (SELECT COUNT(*) FROM entries e WHERE e.tax_rate_id = r.id)
              + (SELECT COUNT(*) FROM contacts c WHERE c.tax_rate_id = r.id) AS uses
     FROM tax_rates r ORDER BY r.is_archived, r.name COLLATE NOCASE`).map((r) => ({ ...r, archived: !!r.archived }));
}

export function saveTaxRate(r: TaxRateInput) {
  assertUs();
  const { db } = getBooks();
  const name = clean(r.name);
  if (!name) throw new Error('Name the rate, like the city or county it applies in.');
  const state = clean(r.state)?.toUpperCase() ?? null;
  if (state && !US_STATE_MAP[state]) throw new Error('Pick a state.');
  const ppm = Math.round(Number(r.ratePpm));
  if (!Number.isFinite(ppm) || ppm < 0 || ppm > 500_000) throw new Error('Enter a rate between 0% and 50%.');
  const clash = one(db, 'SELECT id FROM tax_rates WHERE name = ? COLLATE NOCASE AND id IS NOT ?', name, r.id ?? null);
  if (clash) throw new Error(`There's already a rate called “${name}”.`);
  if (r.id) {
    if (!one(db, 'SELECT id FROM tax_rates WHERE id = ?', r.id)) throw new Error('That rate no longer exists.');
    run(db, 'UPDATE tax_rates SET name = ?, state = ?, rate_ppm = ? WHERE id = ?', name, state, ppm, r.id);
    return r.id;
  }
  return one<{ id: number }>(db, 'INSERT INTO tax_rates (name, state, rate_ppm) VALUES (?, ?, ?) RETURNING id', name, state, ppm)!.id;
}

export function archiveTaxRate(id: number, archived: boolean) {
  run(getBooks().db, 'UPDATE tax_rates SET is_archived = ? WHERE id = ?', archived ? 1 : 0, id);
  return true;
}

/** The rate a document or transaction is worked out at: one of the extra rates, or the books' own. */
export function resolveTaxRate(id: unknown): { id: number | null; ppm: number } {
  if (typeof id === 'number') {
    const r = one<{ id: number; rate_ppm: number }>(getBooks().db, 'SELECT id, rate_ppm FROM tax_rates WHERE id = ?', id);
    if (!r) throw new Error('That sales tax rate no longer exists.');
    return { id: r.id, ppm: r.rate_ppm };
  }
  return { id: null, ppm: getSettings().taxRatePpm };
}

// ---- 1099-NEC -------------------------------------------------------------------

/** Schedule C lines that are usually services, for suggesting payees who may need a 1099. */
const SERVICE_LINES = ['contract-labor', 'legal-professional', 'commissions', 'repairs', 'advertising'];

/**
 * Who gets a 1099-NEC for a calendar year: vendors marked as 1099 payees,
 * with what was paid them that year, and others paid as much for services
 * who may need one. Payments by card (credit card accounts) are left out:
 * the card company or payment app reports those on a 1099-K.
 */
export function nec1099Report(p: { year: number }) {
  assertUs();
  const year = yearOf(p.year);
  const { rules, status } = usTaxYear(year);
  const { db } = getBooks();
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const rows = all<any>(db,
    `SELECT ct.id, ct.name, ct.legal_name AS legalName, ct.tin, ct.address, ct.state, ct.email, ct.is_1099 AS is1099,
            SUM(CASE WHEN a.kind = 'credit_card' THEN 0 ELSE l.gross END) AS paid,
            SUM(CASE WHEN a.kind = 'credit_card' THEN l.gross ELSE 0 END) AS byCard,
            SUM(CASE WHEN a.kind <> 'credit_card' AND c.report_line IN (${SERVICE_LINES.map((k) => `'${k}'`).join(',')}) THEN l.gross ELSE 0 END) AS forServices,
            COUNT(*) AS payments
     FROM ledger_cash l
     JOIN entries e ON e.id = l.entry_id
     JOIN accounts a ON a.id = e.account_id
     JOIN contacts ct ON ct.id = l.contact_id
     LEFT JOIN categories c ON c.id = l.category_id
     WHERE l.kind = 'expense' AND l.date BETWEEN ? AND ? AND COALESCE(c.class, 'pnl') = 'pnl'
     GROUP BY ct.id`, from, to);
  const marked = all<any>(db, `SELECT id, name, legal_name AS legalName, tin, address, state, email FROM contacts WHERE is_1099 = 1`);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const payees = marked.map((m) => {
    const r = byId.get(m.id);
    const paid = r?.paid ?? 0;
    const missing = [
      ...(!m.tin ? ['TIN'] : []),
      ...(!m.address ? ['address'] : []),
    ];
    return { ...m, paid, byCard: r?.byCard ?? 0, payments: r?.payments ?? 0, needsForm: paid >= rules.nec1099Threshold, missing };
  }).sort((a, b) => b.paid - a.paid || a.name.localeCompare(b.name));
  // Not marked, but paid as much for services without a card: worth a look.
  const suggested = rows
    .filter((r) => !r.is1099 && r.forServices >= rules.nec1099Threshold)
    .map((r) => ({ id: r.id, name: r.name, paid: r.paid, forServices: r.forServices }))
    .sort((a, b) => b.paid - a.paid);
  const settings = getSettings();
  return {
    year,
    threshold: rules.nec1099Threshold,
    due: rules.nec1099Due,
    status,
    checked: rules.checked,
    payer: { name: settings.name, tin: settings.taxId },
    payees,
    suggested,
  };
}

// ---- estimated tax (1040-ES) ----------------------------------------------------

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000) + 1;

/**
 * A rough 1040-ES worksheet from the business's own profit: self-employment
 * tax plus income tax at the rate the person sets, spread over the four due
 * dates, against the estimated payments recorded (the category marked as
 * estimated tax). Projects a year in progress from the profit so far.
 * `netProfit(from, to)` is Schedule C line 31 for the dates (passed in so this
 * file doesn't depend on reports.ts).
 */
export function estimatedTax(p: { year: number; today: string; project?: boolean }, netProfit: (from: string, to: string) => number) {
  assertUs();
  const year = yearOf(p.year);
  if (!DATE.test(p.today)) throw new Error('Pick a date.');
  const { rules, status } = usTaxYear(year);
  const inputs = yearInputs(year);
  const from = `${year}-01-01`;
  const end = `${year}-12-31`;
  const through = p.today < end ? p.today : end;
  const started = through >= from;
  const soFar = started ? netProfit(from, through) : 0;
  const elapsed = started ? daysBetween(from, through) : 0;
  const daysInYear = daysBetween(from, end);
  const project = p.project !== false && started && through < end;
  const profit = project ? Math.round((soFar * daysInYear) / Math.max(elapsed, 1)) : soFar;

  const se = selfEmploymentTax(profit, year, inputs.wages ?? 0);
  const halfSe = Math.round(se.tax / 2);
  const incomeTaxPct = inputs.incomeTaxPct ?? 12;
  const incomeTax = Math.round((Math.max(0, profit - halfSe) * incomeTaxPct) / 100);
  const projectedTax = se.tax + incomeTax;
  // Paying at least last year's tax (110% for higher incomes) in four parts avoids the penalty.
  const safeHarbor = inputs.priorYearTax != null ? Math.round((inputs.priorYearTax * (inputs.priorYearHighIncome ? 110 : 100)) / 100) : null;
  const target = safeHarbor != null ? Math.min(projectedTax, safeHarbor) : projectedTax;

  // Payments made after last year's final due date and up to this year's count towards this year.
  const windowFrom = usTaxYear(year - 1).rules.estimatedDue[3];
  const payments = all<{ id: number; date: string; amount: number; memo: string | null }>(getBooks().db,
    `SELECT e.id, e.date, e.amount, e.memo FROM entries e JOIN categories c ON c.id = e.category_id
     WHERE c.report_line = 'estimated-tax' AND e.kind = 'expense' AND e.date > ? AND e.date <= ?
     ORDER BY e.date, e.id`, windowFrom, rules.estimatedDue[3]);
  const totalPaid = payments.reduce((s, x) => s + x.amount, 0);
  const hasCategory = !!one(getBooks().db, "SELECT id FROM categories WHERE report_line = 'estimated-tax' AND is_archived = 0");

  const installments = rules.estimatedDue.map((due, i) => {
    const cumulativeTarget = Math.round((target * (i + 1)) / 4);
    const paidByDue = payments.filter((x) => x.date <= due).reduce((s, x) => s + x.amount, 0);
    const short = Math.max(0, cumulativeTarget - paidByDue);
    const state = short === 0 ? 'paid' : p.today > due ? 'overdue' : 'upcoming';
    return { number: i + 1, due, cumulativeTarget, paidByDue, short, state };
  });
  const next = installments.find((x) => x.due >= p.today && x.short > 0) ?? null;

  return {
    year,
    status,
    checked: rules.checked,
    through,
    projected: project,
    profitSoFar: soFar,
    profit,
    selfEmployment: { netEarnings: se.netEarnings, tax: se.tax, halfDeduction: halfSe, wageBase: rules.socialSecurityWageBase },
    incomeTaxPct,
    incomeTax,
    projectedTax,
    safeHarbor,
    target,
    inputs,
    payments,
    totalPaid,
    hasCategory,
    installments,
    next,
  };
}

// ---- sales by state (economic nexus) ----------------------------------------------

/**
 * Sales into each state for a calendar year and the one before, against the
 * state's economic nexus threshold. Uses each customer's state; sales to
 * customers with no state are counted separately. Gross sales before sales
 * tax, on the accrual basis (when the sale was made), counting each invoice
 * or sale as one transaction.
 */
export function nexusReport(p: { year: number }) {
  assertUs();
  const year = yearOf(p.year);
  const { db } = getBooks();
  const home = getSettings().homeState;
  const salesFor = (y: number) => all<{ state: string | null; sales: number; transactions: number }>(db,
    `SELECT NULLIF(TRIM(UPPER(ct.state)), '') AS state, SUM(l.gross - l.tax) AS sales,
            COUNT(DISTINCT COALESCE('i' || l.invoice_id, 'e' || l.entry_id)) AS transactions
     FROM ledger_accrual l
     LEFT JOIN contacts ct ON ct.id = l.contact_id
     LEFT JOIN categories c ON c.id = l.category_id
     WHERE l.kind = 'income' AND l.date BETWEEN ? AND ? AND COALESCE(c.class, 'pnl') = 'pnl'
     GROUP BY 1`, `${y}-01-01`, `${y}-12-31`);
  const thisYear = new Map(salesFor(year).map((r) => [r.state, r]));
  const lastYear = new Map(salesFor(year - 1).map((r) => [r.state, r]));
  const states = US_STATES.map((st) => {
    const cur = thisYear.get(st.code) ?? { sales: 0, transactions: 0 };
    const prev = lastYear.get(st.code) ?? { sales: 0, transactions: 0 };
    const ratio = (r: { sales: number; transactions: number }) => {
      if (!st.sales) return 0;
      const bySales = r.sales / (st.sales * 100);
      const byCount = st.transactions ? r.transactions / st.transactions : 0;
      return st.both ? Math.min(bySales, byCount || 0) : Math.max(bySales, byCount);
    };
    const share = Math.max(ratio(cur), ratio(prev));
    const level = st.code === home ? 'home'
      : !st.sales ? 'none'
      : share >= 1 ? 'over'
      : share >= 0.75 ? 'near'
      : 'under';
    return { ...st, thisYear: cur, lastYear: prev, share, level };
  }).filter((s) => s.thisYear.sales || s.lastYear.sales || s.code === home);
  const unknown = thisYear.get(null) ?? { sales: 0, transactions: 0 };
  const customersWithoutState = one<{ n: number }>(db,
    "SELECT COUNT(*) AS n FROM contacts WHERE kind = 'customer' AND is_archived = 0 AND COALESCE(TRIM(state), '') = ''")!.n;
  return { year, home, states: states.sort((a, b) => b.share - a.share || b.thisYear.sales - a.thisYear.sales), unknown, customersWithoutState };
}
