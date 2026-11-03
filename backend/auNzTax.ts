// Australia and New Zealand, through the year and at year end: the TPAR,
// PAYG instalments, NZ provisional tax and the tax clients withheld, the GST
// registration threshold, assets bought, and what's due when (the dashboard
// reminders). Figures that change by year come from src/shared/auTaxYears.ts
// and nzTaxYears.ts; dates from dueDates.ts.
import { all, getBooks, one } from './db';
import { getSettings } from './settings';
import { holdingAccount } from './invoices';
import { yearInputs, yearOf } from './taxYear';
import { auIncomeTax, auTaxYear, bracketTax } from '../src/shared/auTaxYears';
import { nzTaxYear } from '../src/shared/nzTaxYears';
import { basDue, nzGstDue, paygDue, provisionalDue, terminalTaxDue, tparDue } from '../src/shared/dueDates';
import { incomeYearOf, incomeYearRange } from '../src/shared/incomeYear';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function assertCountry(c: 'AU' | 'NZ') {
  if (getSettings().country !== c) throw new Error(c === 'AU' ? 'This is only for Australian books.' : 'This is only for New Zealand books.');
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000) + 1;

function addDays(date: string, n: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Income tax instalments paid: expenses in the category marked as where they go. */
function instalmentsPaid(after: string, upTo: string) {
  const { db } = getBooks();
  const payments = all<{ id: number; date: string; amount: number; memo: string | null }>(db,
    `SELECT e.id, e.date, e.amount, e.memo FROM entries e JOIN categories c ON c.id = e.category_id
     WHERE c.report_line = 'estimated-tax' AND e.kind = 'expense' AND e.date > ? AND e.date <= ?
     ORDER BY e.date, e.id`, after, upTo);
  const hasCategory = !!one(db, "SELECT id FROM categories WHERE report_line = 'estimated-tax' AND is_archived = 0");
  return { payments, totalPaid: payments.reduce((s, x) => s + x.amount, 0), hasCategory };
}

/** Each due date against what's been paid by then, cumulatively. */
function installments(due: string[], amounts: number[], payments: { date: string; amount: number }[], today: string) {
  let target = 0;
  const list = due.map((d, i) => {
    target += amounts[i];
    const paidByDue = payments.filter((x) => x.date <= d).reduce((s, x) => s + x.amount, 0);
    const paidNow = payments.filter((x) => x.date <= today).reduce((s, x) => s + x.amount, 0);
    const short = Math.max(0, target - Math.max(paidByDue, d < today ? paidByDue : paidNow));
    const state: 'paid' | 'upcoming' | 'overdue' = short === 0 ? 'paid' : d < today ? 'overdue' : 'upcoming';
    return { number: i + 1, due: d, amount: amounts[i], cumulativeTarget: target, paidByDue, short, state };
  });
  return { installments: list, next: list.find((i) => i.state !== 'paid') ?? null };
}

/** P&L profit for the income year, projected from the part gone when it's still running. */
function yearProfit(from: string, to: string, today: string, profit: (from: string, to: string) => { income: number; net: number }) {
  const through = today < to ? today : to;
  const started = through >= from;
  const soFar = started ? profit(from, through) : { income: 0, net: 0 };
  const projected = started && through < to;
  const scale = projected ? daysBetween(from, to) / Math.max(1, daysBetween(from, through)) : 1;
  return {
    through,
    projected,
    incomeSoFar: soFar.income,
    profitSoFar: soFar.net,
    income: Math.round(soFar.income * scale),
    profit: Math.round(soFar.net * scale),
  };
}

type ProfitFn = (from: string, to: string) => { income: number; net: number };

// ---- Australia: TPAR ---------------------------------------------------------------

/**
 * The taxable payments annual report: what was paid in the income year to
 * each contractor marked for it, with GST, from the cash ledger. Due 28 August.
 */
export function tparReport(p: { year: number }) {
  assertCountry('AU');
  const year = yearOf(p.year);
  const { from, to } = incomeYearRange(year, getSettings().fiscalYearStart);
  const { db } = getBooks();
  const paid = new Map(all<any>(db,
    `SELECT l.contact_id AS id, SUM(l.gross) AS gross, SUM(l.tax) AS gst, COUNT(*) AS payments
     FROM ledger_cash l LEFT JOIN categories c ON c.id = l.category_id
     WHERE l.kind = 'expense' AND l.date BETWEEN ? AND ? AND COALESCE(c.class, 'pnl') IN ('pnl', 'asset')
       AND l.contact_id IN (SELECT id FROM contacts WHERE is_1099 = 1)
     GROUP BY l.contact_id`, from, to).map((r) => [r.id, r]));
  const withheld = new Map(all<{ id: number; t: number }>(db,
    `SELECT e.contact_id AS id, SUM(e.amount) AS t FROM entries e JOIN accounts a ON a.id = e.account_id
     WHERE a.holds = 'no-abn' AND e.kind = 'expense' AND e.date BETWEEN ? AND ? GROUP BY e.contact_id`, from, to).map((r) => [r.id, r.t]));
  const payees = all<any>(db, 'SELECT id, name, legal_name AS legalName, tin AS abn, address, email, phone FROM contacts WHERE is_1099 = 1')
    .map((c) => {
      const r = paid.get(c.id);
      const missing = [...(!c.abn ? ['ABN'] : []), ...(!c.address ? ['address'] : [])];
      return { ...c, gross: r?.gross ?? 0, gst: r?.gst ?? 0, withheld: withheld.get(c.id) ?? 0, payments: r?.payments ?? 0, missing };
    })
    .sort((a, b) => b.gross - a.gross || a.name.localeCompare(b.name));
  const s = getSettings();
  return {
    year,
    from,
    to,
    due: tparDue(year),
    payer: { name: s.name, abn: s.taxId },
    payees,
    totals: { gross: payees.reduce((x, c) => x + c.gross, 0), gst: payees.reduce((x, c) => x + c.gst, 0), withheld: payees.reduce((x, c) => x + c.withheld, 0) },
  };
}

/**
 * Payments over the no-ABN limit to TPAR contractors with no ABN on file and
 * nothing withheld, in a date range: each may have needed 47% withheld,
 * unless the supplier gave a statement that it's a hobby or private, or
 * they're not in business.
 */
export function noAbnPayments(p: { from: string; to: string }) {
  assertCountry('AU');
  const { rules } = auTaxYear(incomeYearOf(p.to, getSettings().fiscalYearStart));
  return all<any>(getBooks().db,
    `SELECT ct.id, ct.name, COUNT(*) AS payments, SUM(l.gross) AS gross
     FROM ledger_cash l JOIN contacts ct ON ct.id = l.contact_id LEFT JOIN categories c ON c.id = l.category_id
     WHERE l.kind = 'expense' AND l.date BETWEEN ? AND ? AND ct.is_1099 = 1 AND ct.tin IS NULL
       AND COALESCE(c.class, 'pnl') = 'pnl' AND l.gross - l.tax > ?
       AND NOT EXISTS (SELECT 1 FROM entries w JOIN accounts a ON a.id = w.account_id
                       WHERE a.holds = 'no-abn' AND w.contact_id = ct.id AND w.date BETWEEN ? AND ?)
     GROUP BY ct.id ORDER BY gross DESC`, p.from, p.to, rules.noAbnUnder, p.from, p.to);
}

// ---- Australia: PAYG instalments ---------------------------------------------------------

/**
 * PAYG instalments for the income year: either the amount on the ATO's
 * notice each quarter, or the instalment rate times the quarter's instalment
 * income (business income before GST). Paid with each quarter's BAS (T7).
 * Also a rough idea of the year's income tax, so the instalments can be
 * checked against it.
 */
export function paygInstalments(p: { year: number; today: string }, profit: ProfitFn) {
  assertCountry('AU');
  const year = yearOf(p.year);
  if (!DATE.test(p.today)) throw new Error('Pick a date.');
  const s = getSettings();
  const { from, to } = incomeYearRange(year, s.fiscalYearStart);
  const inputs = yearInputs(year);
  const { rules, status } = auTaxYear(year);
  // Paid with a BAS lodged online: two more weeks for quarters 1, 3 and 4. Not on an instalment notice.
  const online = s.basOnline && s.taxEnabled && s.taxPeriod === 'quarterly';
  const due = paygDue(year, online);
  // The four quarters of the year.
  const quarters = [0, 3, 6, 9].map((m) => {
    const start = new Date(`${from}T00:00:00Z`);
    start.setUTCMonth(start.getUTCMonth() + m);
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + 3);
    end.setUTCDate(end.getUTCDate() - 1);
    return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
  });
  const option = inputs.paygOption ?? (inputs.paygRatePct ? 'rate' : 'amount');
  const amounts = quarters.map((q) => {
    if (option === 'amount') return inputs.paygAmount ?? 0;
    // Only quarters that have finished have instalment income to report.
    const income = q.from <= p.today ? profit(q.from, q.to < p.today ? q.to : p.today).income : 0;
    return Math.round((income * (inputs.paygRatePct ?? 0)) / 100);
  });
  const quarterIncome = quarters.map((q) => (q.from <= p.today ? profit(q.from, q.to < p.today ? q.to : p.today).income : 0));
  const y = yearProfit(from, to, p.today, profit);
  const estimatedTax = auIncomeTax(Math.max(0, y.profit), year);
  const paid = instalmentsPaid(paygDue(year - 1, online)[3], due[3]);
  const plan = installments(due, amounts, paid.payments, p.today);
  return {
    year,
    from,
    to,
    status,
    checked: rules.checked,
    option,
    inputs,
    quarters: quarters.map((q, i) => ({ ...q, income: quarterIncome[i], amount: amounts[i], due: due[i] })),
    total: amounts.reduce((a, b) => a + b, 0),
    ...y,
    estimatedTax,
    ...paid,
    ...plan,
  };
}

// ---- New Zealand: provisional tax and tax withheld ------------------------------------

/** Tax clients withheld from payments in a date range (the "Tax withheld by clients" account). */
export function taxWithheld(from: string, to: string) {
  const { db } = getBooks();
  const account = holdingAccount('client-wht', false);
  if (!account) return { total: 0, byClient: [] as { id: number; name: string; amount: number }[] };
  const byClient = all<{ id: number; name: string; amount: number }>(db,
    `SELECT ct.id, ct.name, SUM(e.amount) AS amount FROM entries e LEFT JOIN contacts ct ON ct.id = e.contact_id
     WHERE e.account_id = ? AND e.kind = 'income' AND e.date BETWEEN ? AND ?
     GROUP BY ct.id ORDER BY amount DESC`, account, from, to);
  return { total: byClient.reduce((s, c) => s + c.amount, 0), byClient };
}

/**
 * Provisional tax for the income year (standard method or your estimate),
 * three instalments: 28 August, 15 January, 7 May. Residual income tax is
 * the year's income tax less tax already withheld; under $5,000 there's no
 * provisional tax.
 */
export function provisionalTax(p: { year: number; today: string }, profit: ProfitFn) {
  assertCountry('NZ');
  const year = yearOf(p.year);
  if (!DATE.test(p.today)) throw new Error('Pick a date.');
  const s = getSettings();
  const { from, to } = incomeYearRange(year, s.fiscalYearStart);
  const inputs = yearInputs(year);
  const { rules, status } = nzTaxYear(year);
  const y = yearProfit(from, to, p.today, profit);
  const withheld = taxWithheld(from, to);
  const incomeTax = bracketTax(Math.max(0, y.profit), rules.brackets);
  const residual = Math.max(0, incomeTax - Math.round((withheld.total * (y.projected ? daysBetween(from, to) / Math.max(1, daysBetween(from, y.through)) : 1))));
  const method = inputs.provisionalMethod ?? 'standard';
  // Standard method: last year's residual income tax plus 5%, or two years ago plus 10% until last year's return is in.
  let basis: 'last-year' | 'two-years' | 'estimate' | 'none' = 'none';
  let yearTax = 0;
  if (method === 'estimation') {
    basis = 'estimate';
    yearTax = inputs.estimate ?? residual;
  } else if (inputs.priorYearTax != null) {
    basis = 'last-year';
    yearTax = inputs.priorYearTax > rules.provisionalThreshold ? Math.round(inputs.priorYearTax * (100 + rules.upliftPct) / 100) : 0;
  } else if (inputs.twoYearsAgoTax != null) {
    basis = 'two-years';
    yearTax = inputs.twoYearsAgoTax > rules.provisionalThreshold ? Math.round(inputs.twoYearsAgoTax * (100 + rules.upliftTwoYearsPct) / 100) : 0;
  }
  const due = provisionalDue(year);
  const amounts = [0, 1, 2].map((i) => Math.round((yearTax * (i + 1)) / 3) - Math.round((yearTax * i) / 3));
  const paid = instalmentsPaid(provisionalDue(year - 1)[2], due[2]);
  const plan = installments(due, amounts, paid.payments, p.today);
  return {
    year,
    from,
    to,
    status,
    checked: rules.checked,
    method,
    basis,
    inputs,
    threshold: rules.provisionalThreshold,
    ...y,
    incomeTax,
    withheld,
    residual,
    provisional: yearTax,
    terminalDue: terminalTaxDue(year),
    ...paid,
    ...plan,
  };
}

// ---- GST registration threshold ------------------------------------------------------

/**
 * For books not registered for GST: turnover for the last 12 months and the
 * year on that pace, against the threshold. Registration is required within
 * 21 days of going over.
 */
export function gstThreshold(p: { today: string }) {
  const s = getSettings();
  if (s.country !== 'AU' && s.country !== 'NZ') throw new Error('This is for Australian and New Zealand books.');
  const year = incomeYearOf(p.today, s.fiscalYearStart);
  const threshold = s.country === 'AU' ? auTaxYear(year).rules.gstThreshold : nzTaxYear(year).rules.gstThreshold;
  const yearAgo = new Date(`${p.today}T00:00:00Z`);
  yearAgo.setUTCFullYear(yearAgo.getUTCFullYear() - 1);
  const from = addDays(yearAgo.toISOString().slice(0, 10), 1);
  // GST turnover: sales, not money from loans or the owner. Accrual, whatever the books' basis.
  const turnover = one<{ t: number }>(getBooks().db,
    `SELECT COALESCE(SUM(l.gross - l.tax), 0) AS t FROM ledger_accrual l LEFT JOIN categories c ON c.id = l.category_id
     WHERE l.kind = 'income' AND l.date BETWEEN ? AND ? AND COALESCE(c.class, 'pnl') = 'pnl'`, from, p.today)!.t;
  // The last three months, at that pace for a year: the "next 12 months" test, roughly.
  const threeAgo = new Date(`${p.today}T00:00:00Z`);
  threeAgo.setUTCMonth(threeAgo.getUTCMonth() - 3);
  const recent = one<{ t: number }>(getBooks().db,
    `SELECT COALESCE(SUM(l.gross - l.tax), 0) AS t FROM ledger_accrual l LEFT JOIN categories c ON c.id = l.category_id
     WHERE l.kind = 'income' AND l.date > ? AND l.date <= ? AND COALESCE(c.class, 'pnl') = 'pnl'`, threeAgo.toISOString().slice(0, 10), p.today)!.t;
  const projected = recent * 4;
  const share = threshold ? Math.max(turnover, projected) / threshold : 0;
  return {
    registered: s.taxEnabled,
    threshold,
    from,
    to: p.today,
    turnover,
    projected,
    share,
    level: share >= 1 ? 'over' : share >= 0.75 ? 'near' : 'under',
  } as const;
}

// ---- assets bought ---------------------------------------------------------------------

/**
 * What was spent on equipment and other assets in a date range, each
 * against the write-off limit: Australia's instant asset write-off, New
 * Zealand's low-value asset limit. Anything over is depreciated.
 */
export function assetsBought(p: { from: string; to: string }) {
  const s = getSettings();
  const year = incomeYearOf(p.to, s.fiscalYearStart);
  const limit = s.country === 'AU' ? auTaxYear(year).rules.instantWriteOff
    : s.country === 'NZ' ? nzTaxYear(year).rules.lowValueAsset
    : 250_000;
  const rows = all<any>(getBooks().db,
    `SELECT l.entry_id AS entryId, l.invoice_id AS invoiceId, l.date, c.name AS category, ct.name AS contact, l.memo,
            l.gross, l.tax, c.class
     FROM ledger_accrual l JOIN categories c ON c.id = l.category_id LEFT JOIN contacts ct ON ct.id = l.contact_id
     WHERE l.kind = 'expense' AND l.date BETWEEN ? AND ?
       AND (c.class = 'asset' OR c.name IN ('Equipment', 'Small Equipment', 'Equipment & Assets'))
     ORDER BY l.date`, p.from, p.to);
  // Registered for GST: the cost is before GST. Otherwise the GST is part of the cost.
  const assets = rows.map((r) => {
    const cost = s.taxEnabled ? r.gross - r.tax : r.gross;
    return { ...r, cost, writeOff: cost < limit };
  });
  return { limit, year, assets, writeOff: assets.filter((a) => a.writeOff).reduce((t, a) => t + a.cost, 0), depreciate: assets.filter((a) => !a.writeOff).reduce((t, a) => t + a.cost, 0) };
}

// ---- what's due ----------------------------------------------------------------------------

export interface Deadline {
  key: string;
  title: string;
  due: string;
  /** Owed, when it's known (cents). */
  amount?: number;
  route: string;
}

/**
 * What's coming up with the tax office, for the dashboard: returns for
 * periods that have ended and aren't lodged, instalments still to pay, the
 * TPAR. Only what's due within `days` or already overdue (up to 60 days).
 */
export function deadlines(p: { today: string; days?: number }, profit: ProfitFn): Deadline[] {
  const s = getSettings();
  const out: Deadline[] = [];
  const within = (d: string) => {
    const days = daysBetween(p.today, d) - 1;
    return days <= (p.days ?? 30) && days >= -60;
  };
  const { db } = getBooks();
  if ((s.country === 'AU' || s.country === 'NZ') && s.taxEnabled) {
    // Periods that ended in the last few months and haven't been lodged.
    const lodged = new Set(all<{ k: string }>(db, "SELECT period_start || period_end AS k FROM tax_returns WHERE status = 'lodged'").map((r) => r.k));
    const months = ({ monthly: 1, 'two-monthly': 2, quarterly: 3, 'six-monthly': 6, annual: 12 } as const)[s.taxPeriod];
    const start = new Date(`${incomeYearRange(incomeYearOf(p.today, s.fiscalYearStart) - 1, s.fiscalYearStart).from}T00:00:00Z`);
    for (let i = 0; i < 48; i += months) {
      const a = new Date(start);
      a.setUTCMonth(a.getUTCMonth() + i);
      const b = new Date(a);
      b.setUTCMonth(b.getUTCMonth() + months);
      b.setUTCDate(b.getUTCDate() - 1);
      const from = a.toISOString().slice(0, 10);
      const to = b.toISOString().slice(0, 10);
      if (to >= p.today) break;
      if (lodged.has(from + to)) continue;
      const due = s.country === 'AU' ? basDue(from, to, s.basOnline) : nzGstDue(to);
      if (within(due)) {
        out.push({ key: `return-${from}`, title: s.country === 'AU' ? `BAS for ${label(from, to)}` : `GST return for ${label(from, to)}`, due, route: '/reports/tax-return' });
      }
    }
  }
  if (s.country === 'AU') {
    const year = incomeYearOf(p.today, s.fiscalYearStart);
    for (const y of [year - 1, year]) {
      const inputs = yearInputs(y);
      if (!inputs.paygAmount && !inputs.paygRatePct) continue;
      const r = paygInstalments({ year: y, today: p.today }, profit);
      for (const i of r.installments) {
        if (i.short > 0 && within(i.due)) out.push({ key: `payg-${y}-${i.number}`, title: `PAYG instalment, quarter ${i.number}`, due: i.due, amount: i.short, route: '/reports/income-tax' });
      }
    }
    // Last year's TPAR, when anyone's marked for it and was paid.
    const last = incomeYearOf(p.today, s.fiscalYearStart) - 1;
    const tparDate = tparDue(last);
    if (within(tparDate) && one(db, 'SELECT id FROM contacts WHERE is_1099 = 1')) {
      out.push({ key: `tpar-${last}`, title: 'Taxable payments annual report (TPAR)', due: tparDate, route: '/reports/tpar' });
    }
  }
  if (s.country === 'NZ') {
    const year = incomeYearOf(p.today, s.fiscalYearStart);
    for (const y of [year - 1, year]) {
      const r = provisionalTax({ year: y, today: p.today }, profit);
      if (!r.provisional) continue;
      for (const i of r.installments) {
        if (i.short > 0 && within(i.due)) out.push({ key: `prov-${y}-${i.number}`, title: `Provisional tax, instalment ${i.number}`, due: i.due, amount: i.short, route: '/reports/income-tax' });
      }
    }
  }
  return out.sort((a, b) => a.due.localeCompare(b.due));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function label(from: string, to: string) {
  const m = (d: string) => MONTHS[Number(d.slice(5, 7)) - 1];
  return from.slice(0, 7) === to.slice(0, 7) ? `${m(from)} ${from.slice(0, 4)}` : `${m(from)}–${m(to)} ${to.slice(0, 4)}`;
}
