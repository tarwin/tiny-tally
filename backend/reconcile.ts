// Bank reconciliation: tick off transactions against a bank statement until
// the cleared balance matches the statement's closing balance.
//
// Each reconciliation starts from the previous one's statement balance (or
// the account's opening balance). A transfer touches two accounts, so the
// "from" side is ticked in entries.rec_id and the "to" side in to_rec_id.
import { all, getCompany, one, run } from './db';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function account(id: number) {
  const a = one<any>(getCompany().db, 'SELECT * FROM accounts WHERE id = ?', id);
  if (!a) throw new Error('That account no longer exists.');
  return a;
}

/** Where this reconciliation starts: the last finished one before it, or the opening balance. */
function startingPoint(accountId: number, beforeId?: number) {
  const prev = one<any>(getCompany().db,
    `SELECT statement_date, statement_balance FROM reconciliations
     WHERE account_id = ? AND status = 'done' AND id IS NOT ?
     ORDER BY statement_date DESC, id DESC LIMIT 1`, accountId, beforeId ?? null);
  const a = account(accountId);
  return prev
    ? { date: prev.statement_date as string, balance: prev.statement_balance as number }
    : { date: null, balance: a.opening_balance as number };
}

const SIGNED = `CASE WHEN e.to_account_id = ?1 THEN e.amount WHEN e.kind = 'income' THEN e.amount ELSE -e.amount END`;
const SIDE_REC = `CASE WHEN e.to_account_id = ?1 THEN e.to_rec_id ELSE e.rec_id END`;

export function reconcileState(accountId: number) {
  const { db } = getCompany();
  const a = account(accountId);
  const open = one<any>(db,
    `SELECT id, statement_date AS statementDate, statement_balance AS statementBalance
     FROM reconciliations WHERE account_id = ? AND status = 'open' ORDER BY id DESC LIMIT 1`, accountId);
  const start = startingPoint(accountId, open?.id);
  // Everything not yet reconciled (ticked into a finished reconciliation).
  const rows = all<any>(db,
    `SELECT e.id, e.date, e.kind, e.amount, e.memo, ${SIGNED} AS signed, ${SIDE_REC} AS recId,
            c.name AS categoryName, ct.name AS contactName, inv.number AS invoiceNumber,
            CASE WHEN e.to_account_id = ?1 THEN fa.name ELSE ta.name END AS otherAccount
     FROM entries e
     LEFT JOIN categories c ON c.id = e.category_id
     LEFT JOIN contacts ct ON ct.id = e.contact_id
     LEFT JOIN invoices inv ON inv.id = e.invoice_id
     LEFT JOIN accounts fa ON fa.id = e.account_id
     LEFT JOIN accounts ta ON ta.id = e.to_account_id
     LEFT JOIN reconciliations r ON r.id = ${SIDE_REC}
     WHERE (e.account_id = ?1 OR e.to_account_id = ?1)
       AND (r.id IS NULL OR r.status = 'open')
     ORDER BY e.date, e.id`, accountId);
  const ticked = open ? rows.filter((r) => r.recId === open.id) : [];
  const cleared = start.balance + ticked.reduce((s, r) => s + r.signed, 0);
  const history = all(db,
    `SELECT r.id, r.statement_date AS statementDate, r.statement_balance AS statementBalance, r.completed_at AS completedAt,
            (SELECT COUNT(*) FROM entries e WHERE e.rec_id = r.id OR e.to_rec_id = r.id) AS count
     FROM reconciliations r WHERE r.account_id = ? AND r.status = 'done' ORDER BY r.statement_date DESC, r.id DESC`, accountId);
  return {
    account: { id: a.id, name: a.name, kind: a.kind, openingBalance: a.opening_balance, openingDate: a.opening_date },
    start,
    open: open ? { ...open, cleared, difference: open.statementBalance - cleared } : null,
    rows: rows.map((r) => ({ ...r, ticked: !!open && r.recId === open.id })),
    history,
  };
}

export function startReconcile(p: { accountId: number; statementDate: string; statementBalance: number }) {
  const { db } = getCompany();
  account(p.accountId);
  if (!DATE.test(String(p.statementDate))) throw new Error('Pick the statement end date.');
  const bal = Math.round(Number(p.statementBalance));
  if (!Number.isFinite(bal)) throw new Error('Enter the closing balance from the statement.');
  const start = startingPoint(p.accountId);
  if (start.date && p.statementDate < start.date) {
    throw new Error(`This account is already reconciled to ${start.date}. Pick a later statement.`);
  }
  const open = one<any>(db, "SELECT id FROM reconciliations WHERE account_id = ? AND status = 'open'", p.accountId);
  if (open) {
    run(db, 'UPDATE reconciliations SET statement_date = ?, statement_balance = ? WHERE id = ?', p.statementDate, bal, open.id);
    return open.id as number;
  }
  return one<{ id: number }>(db,
    'INSERT INTO reconciliations (account_id, statement_date, statement_balance) VALUES (?, ?, ?) RETURNING id',
    p.accountId, p.statementDate, bal)!.id;
}

function openRec(id: number) {
  const r = one<any>(getCompany().db, 'SELECT * FROM reconciliations WHERE id = ?', id);
  if (!r) throw new Error('That reconciliation no longer exists.');
  if (r.status !== 'open') throw new Error('That reconciliation is finished. Undo it to make changes.');
  return r;
}

export function tick(p: { recId: number; entryIds: number[]; cleared: boolean }) {
  const { db } = getCompany();
  const r = openRec(p.recId);
  const ids = (p.entryIds ?? []).filter((n) => Number.isInteger(n));
  db.transaction(() => {
    for (const id of ids) {
      const e = one<any>(db, 'SELECT id, account_id, to_account_id, rec_id, to_rec_id FROM entries WHERE id = ?', id);
      if (!e) continue;
      const value = p.cleared ? r.id : null;
      if (e.account_id === r.account_id && (e.rec_id === null || e.rec_id === r.id)) {
        run(db, 'UPDATE entries SET rec_id = ? WHERE id = ?', value, id);
      } else if (e.to_account_id === r.account_id && (e.to_rec_id === null || e.to_rec_id === r.id)) {
        run(db, 'UPDATE entries SET to_rec_id = ? WHERE id = ?', value, id);
      }
    }
  })();
  return true;
}

export function finishReconcile(id: number) {
  const r = openRec(id);
  const state = reconcileState(r.account_id);
  if (!state.open || state.open.difference !== 0) {
    throw new Error("The cleared balance doesn't match the statement yet.");
  }
  const late = state.rows.find((row) => row.ticked && row.date > r.statement_date);
  if (late) throw new Error(`A ticked transaction (${late.date}) is after the statement date.`);
  run(getCompany().db, "UPDATE reconciliations SET status = 'done', completed_at = datetime('now') WHERE id = ?", id);
  return true;
}

/** Throws away an unfinished reconciliation and its ticks. */
export function cancelReconcile(id: number) {
  const { db } = getCompany();
  openRec(id);
  db.transaction(() => {
    run(db, 'UPDATE entries SET rec_id = NULL WHERE rec_id = ?', id);
    run(db, 'UPDATE entries SET to_rec_id = NULL WHERE to_rec_id = ?', id);
    run(db, 'DELETE FROM reconciliations WHERE id = ?', id);
  })();
  return true;
}

/** Reopens the latest finished reconciliation so its ticks can change. */
export function undoReconcile(id: number) {
  const { db } = getCompany();
  const r = one<any>(db, 'SELECT * FROM reconciliations WHERE id = ?', id);
  if (!r || r.status !== 'done') throw new Error('That reconciliation is not finished.');
  const later = one(db,
    "SELECT id FROM reconciliations WHERE account_id = ? AND id <> ? AND (status = 'open' OR statement_date > ?)",
    r.account_id, id, r.statement_date);
  if (later) throw new Error('Undo the later reconciliations (or finish or cancel the open one) first.');
  run(db, "UPDATE reconciliations SET status = 'open', completed_at = NULL WHERE id = ?", id);
  return true;
}

/** Last reconciled date per account, for the accounts list. */
export function reconciledDates() {
  return all<{ accountId: number; date: string }>(getCompany().db,
    `SELECT account_id AS accountId, MAX(statement_date) AS date FROM reconciliations WHERE status = 'done' GROUP BY account_id`);
}
