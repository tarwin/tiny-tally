// Recurring transactions, invoices and bills.
//
// A schedule stores what to create (payload) and when. Occurrence n falls on
// start_date + n periods, counted from the start so monthly-on-the-31st stays
// at month end instead of drifting. The page calls runSchedules(today) when a
// books opens; everything due up to today is created then.
import { all, getBooks, one, run } from './db';
import { saveEntry, type EntryInput } from './entries';
import { saveInvoice, type InvoiceInput } from './invoices';
import { getSettings } from './settings';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
export type Frequency = 'weekly' | 'fortnightly' | 'monthly' | 'quarterly' | 'yearly';
const FREQUENCIES: Frequency[] = ['weekly', 'fortnightly', 'monthly', 'quarterly', 'yearly'];
type ScheduleKind = 'entry' | 'invoice' | 'bill';

/** What a schedule creates. Dates are filled in per occurrence. */
export type SchedulePayload =
  | Omit<EntryInput, 'id' | 'date'>
  | (Omit<InvoiceInput, 'id' | 'issueDate' | 'dueDate' | 'number' | 'status'> & { dueDays: number });

export interface ScheduleInput {
  id?: number;
  kind: ScheduleKind;
  name: string;
  payload: SchedulePayload;
  frequency: Frequency;
  startDate: string;
  endDate?: string | null;
  /** Invoices/bills: approve straight away instead of leaving a draft. */
  autoApprove?: boolean;
  active?: boolean;
}

// ---- dates (plain YYYY-MM-DD, no time zones) --------------------------------

function parts(d: string) {
  const [y, m, day] = d.split('-').map(Number);
  return { y, m, day };
}

function fmt(y: number, m: number, d: number) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function addDays(d: string, n: number) {
  const { y, m, day } = parts(d);
  return new Date(Date.UTC(y, m - 1, day) + n * 86400000).toISOString().slice(0, 10);
}

function addMonths(d: string, n: number) {
  const { y, m, day } = parts(d);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return fmt(ny, nm, Math.min(day, last));
}

export function occurrence(start: string, freq: Frequency, n: number) {
  switch (freq) {
    case 'weekly': return addDays(start, 7 * n);
    case 'fortnightly': return addDays(start, 14 * n);
    case 'monthly': return addMonths(start, n);
    case 'quarterly': return addMonths(start, 3 * n);
    case 'yearly': return addMonths(start, 12 * n);
  }
}

// ---- CRUD ---------------------------------------------------------------------

function shape(r: any) {
  return {
    id: r.id,
    kind: r.kind as ScheduleKind,
    name: r.name,
    payload: JSON.parse(r.payload),
    frequency: r.frequency as Frequency,
    startDate: r.start_date,
    nextDate: r.next_date,
    endDate: r.end_date,
    occurrences: r.occurrences,
    autoApprove: !!r.auto_approve,
    active: !!r.is_active,
    lastCreated: r.last_created,
    finished: !!r.end_date && r.next_date > r.end_date,
  };
}

export function listSchedules() {
  return all(getBooks().db, 'SELECT * FROM schedules ORDER BY is_active DESC, next_date, name COLLATE NOCASE').map(shape);
}

export function getSchedule(id: number) {
  const r = one(getBooks().db, 'SELECT * FROM schedules WHERE id = ?', id);
  if (!r) throw new Error('That schedule no longer exists.');
  return shape(r);
}

export function saveSchedule(input: ScheduleInput) {
  const { db } = getBooks();
  if (!['entry', 'invoice', 'bill'].includes(input.kind)) throw new Error('Unknown schedule type.');
  if (!FREQUENCIES.includes(input.frequency)) throw new Error('Choose how often it repeats.');
  if (!DATE.test(String(input.startDate))) throw new Error('Pick the first date.');
  const end = input.endDate && DATE.test(input.endDate) ? input.endDate : null;
  if (end && end < input.startDate) throw new Error("The end date can't be before the first date.");
  const name = String(input.name ?? '').trim();
  if (!name) throw new Error('Give the schedule a name.');
  if (!input.payload || typeof input.payload !== 'object') throw new Error('Nothing to repeat.');
  const payload = JSON.stringify(input.payload);
  const existing = input.id ? one<any>(db, 'SELECT * FROM schedules WHERE id = ?', input.id) : null;
  if (input.id && !existing) throw new Error('That schedule no longer exists.');
  const active = input.active === false ? 0 : 1;
  if (existing) {
    // Changing the start or frequency restarts the count from the first date not yet created.
    const restart = existing.start_date !== input.startDate || existing.frequency !== input.frequency;
    const start = restart ? input.startDate : existing.start_date;
    const occurrences = restart ? 0 : existing.occurrences;
    run(db,
      `UPDATE schedules SET name = ?, payload = ?, frequency = ?, start_date = ?, occurrences = ?, next_date = ?,
         end_date = ?, auto_approve = ?, is_active = ? WHERE id = ?`,
      name, payload, input.frequency, start, occurrences, occurrence(start, input.frequency, occurrences),
      end, input.autoApprove ? 1 : 0, active, existing.id);
    return existing.id as number;
  }
  return one<{ id: number }>(db,
    `INSERT INTO schedules (kind, name, payload, frequency, start_date, occurrences, next_date, end_date, auto_approve, is_active)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?) RETURNING id`,
    input.kind, name, payload, input.frequency, input.startDate, input.startDate, end, input.autoApprove ? 1 : 0, active)!.id;
}

export function deleteSchedule(id: number) {
  const { db } = getBooks();
  db.transaction(() => {
    run(db, 'UPDATE entries SET schedule_id = NULL WHERE schedule_id = ?', id);
    run(db, 'UPDATE invoices SET schedule_id = NULL WHERE schedule_id = ?', id);
    run(db, 'DELETE FROM schedules WHERE id = ?', id);
  })();
  return true;
}

/** Moves past the next occurrence without creating it. */
export function skipNext(id: number) {
  const { db } = getBooks();
  const s = one<any>(db, 'SELECT * FROM schedules WHERE id = ?', id);
  if (!s) throw new Error('That schedule no longer exists.');
  const n = s.occurrences + 1;
  run(db, 'UPDATE schedules SET occurrences = ?, next_date = ? WHERE id = ?', n, occurrence(s.start_date, s.frequency, n), id);
  return getSchedule(id);
}

function createOne(s: any, date: string) {
  const payload = JSON.parse(s.payload);
  if (s.kind === 'entry') {
    const id = saveEntry({ ...payload, id: undefined, date });
    run(getBooks().db, 'UPDATE entries SET schedule_id = ? WHERE id = ?', s.id, id);
    return { type: 'entry' as const, id };
  }
  const due = addDays(date, Math.max(0, Number(payload.dueDays) || getSettings().paymentTermsDays));
  const id = saveInvoice({
    ...payload,
    id: undefined,
    docType: s.kind,
    issueDate: date,
    dueDate: due,
    number: null,
    status: s.auto_approve ? 'sent' : 'draft',
    scheduleId: s.id,
  });
  return { type: s.kind as 'invoice' | 'bill', id };
}

/** Creates everything due on or before `today`. Safe to call repeatedly. */
export function runSchedules(today: string) {
  const { db } = getBooks();
  if (!DATE.test(String(today))) throw new Error('Pass today as YYYY-MM-DD.');
  const due = all<any>(db,
    `SELECT * FROM schedules WHERE is_active = 1 AND next_date <= ? AND (end_date IS NULL OR next_date <= end_date)`, today);
  const created: { scheduleId: number; name: string; type: string; id: number; date: string }[] = [];
  const failed: { scheduleId: number; name: string; date: string; message: string }[] = [];
  for (const s of due) {
    let n = s.occurrences;
    // A long-closed laptop shouldn't create years of rows in one go.
    for (let guard = 0; guard < 120; guard++) {
      const date = occurrence(s.start_date, s.frequency, n);
      if (date > today || (s.end_date && date > s.end_date)) break;
      try {
        db.transaction(() => {
          const r = createOne(s, date);
          created.push({ scheduleId: s.id, name: s.name, type: r.type, id: r.id, date });
        })();
      } catch (e: any) {
        // Usually the lock date. Skip this one so the rest still run.
        failed.push({ scheduleId: s.id, name: s.name, date, message: e?.message ?? String(e) });
      }
      n++;
      run(db, 'UPDATE schedules SET occurrences = ?, next_date = ?, last_created = ? WHERE id = ?',
        n, occurrence(s.start_date, s.frequency, n), date, s.id);
    }
  }
  return { created, failed };
}
