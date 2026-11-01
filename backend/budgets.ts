// Budgets: an amount per income or expense category per calendar month.
import { all, getBooks, one, run } from './db';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Twelve months from `firstMonth` ('YYYY-MM'). */
export function monthsFrom(firstMonth: string) {
  if (!MONTH.test(firstMonth)) throw new Error('Pick a month.');
  let [y, m] = firstMonth.split('-').map(Number);
  const out: string[] = [];
  for (let i = 0; i < 12; i++) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    if (++m > 12) [y, m] = [y + 1, 1];
  }
  return out;
}

/** Twelve months of budget, one row per category that has any. */
export function getBudget(firstMonth: string) {
  const months = monthsFrom(firstMonth);
  const rows = new Map<number, number[]>();
  for (const r of all<{ categoryId: number; month: string; amount: number }>(getBooks().db,
    'SELECT category_id AS categoryId, month, amount FROM budgets WHERE month BETWEEN ? AND ?', months[0], months[11])) {
    const amounts = rows.get(r.categoryId) ?? rows.set(r.categoryId, Array(12).fill(0)).get(r.categoryId)!;
    amounts[months.indexOf(r.month)] = r.amount;
  }
  return { months, rows: [...rows].map(([categoryId, amounts]) => ({ categoryId, amounts })) };
}

/** Sets cells; an amount of 0 clears the cell. */
export function saveBudget(p: { cells: { categoryId: number; month: string; amount: number }[] }) {
  const { db } = getBooks();
  const cells = Array.isArray(p?.cells) ? p.cells : [];
  db.transaction(() => {
    for (const c of cells) {
      if (!MONTH.test(String(c.month))) throw new Error('Pick a month.');
      const cat = one<{ class: string; name: string }>(db, 'SELECT class, name FROM categories WHERE id = ?', c.categoryId);
      if (!cat) throw new Error('That category no longer exists.');
      if (cat.class !== 'pnl') throw new Error(`“${cat.name}” isn't income or an expense, so it can't have a budget.`);
      const amount = Math.round(Number(c.amount));
      if (!Number.isFinite(amount) || amount < 0) throw new Error(`Check the budget for “${cat.name}”: it can't be negative.`);
      if (amount === 0) run(db, 'DELETE FROM budgets WHERE category_id = ? AND month = ?', c.categoryId, c.month);
      else {
        run(db,
          `INSERT INTO budgets (category_id, month, amount) VALUES (?, ?, ?)
           ON CONFLICT (category_id, month) DO UPDATE SET amount = excluded.amount
           WHERE amount IS NOT excluded.amount`, c.categoryId, c.month, amount);
      }
    }
  })();
  return true;
}

const dayNumber = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86400000;

/** Each category's budget for a date range, months pro-rated by the days the range covers. */
export function budgetFor(from: string, to: string) {
  if (!DATE.test(from) || !DATE.test(to)) throw new Error('Pick a date range.');
  const totals = new Map<number, number>();
  const start = dayNumber(from);
  const end = dayNumber(to);
  for (const r of all<{ categoryId: number; month: string; amount: number }>(getBooks().db,
    'SELECT category_id AS categoryId, month, amount FROM budgets WHERE month BETWEEN ? AND ?', from.slice(0, 7), to.slice(0, 7))) {
    const first = dayNumber(`${r.month}-01`);
    const [y, m] = r.month.split('-').map(Number);
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const covered = Math.min(end, first + days - 1) - Math.max(start, first) + 1;
    if (covered <= 0) continue;
    totals.set(r.categoryId, (totals.get(r.categoryId) ?? 0) + (r.amount * covered) / days);
  }
  for (const [k, v] of totals) totals.set(k, Math.round(v));
  return totals;
}
