// Trading names: the business names one person invoices under. Each invoice,
// quote and credit note is from one of them; the default is used when nothing
// else says which. A sent document keeps a snapshot of its sender's details
// (from_snapshot) so editing a trading name later doesn't rewrite it.
import { all, getBooks, one, run } from './db';

export interface TradingNameInput {
  id?: number;
  name: string;
  logo?: string | null;
  address?: string | null;
  email?: string | null;
  phone?: string | null;
  paymentDetails?: string | null;
  templateId?: number | null;
}

/** Who a document is from, as printed on it. */
export interface Sender {
  tradingNameId: number;
  name: string;
  address: string | null;
  email: string | null;
  phone: string | null;
  paymentDetails: string | null;
  /** Always the trading name's current logo: images aren't copied into snapshots. */
  logo: string | null;
}

const COLUMNS = `t.id, t.name, t.logo, t.address, t.email, t.phone, t.payment_details AS paymentDetails,
  t.template_id AS templateId, t.is_default AS isDefault, t.is_archived AS isArchived`;

function clean(v: unknown) {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

const shape = (t: any) => ({ ...t, isDefault: !!t.isDefault, isArchived: !!t.isArchived });

export function listTradingNames() {
  return all<any>(getBooks().db,
    `SELECT ${COLUMNS},
            (SELECT COUNT(*) FROM invoices i WHERE i.trading_name_id = t.id) AS uses
     FROM trading_names t ORDER BY t.is_archived, t.is_default DESC, t.sort, t.name COLLATE NOCASE`).map(shape);
}

export function defaultTradingNameId(): number {
  const t = one<{ id: number }>(getBooks().db, 'SELECT id FROM trading_names WHERE is_default = 1')
    ?? one<{ id: number }>(getBooks().db, 'SELECT id FROM trading_names ORDER BY is_archived, id LIMIT 1');
  if (!t) throw new Error('Add a trading name in Settings first.');
  return t.id;
}

/**
 * The trading name a new document should use: the one asked for if it's
 * usable, else the customer's, else the default. `keep` is allowed even if
 * archived (an existing document can stay on it).
 */
export function resolveTradingName(asked: unknown, contactId: number | null, keep?: number | null): number {
  const { db } = getBooks();
  const usable = (id: unknown) =>
    typeof id === 'number' && !!one(db, 'SELECT id FROM trading_names WHERE id = ? AND (is_archived = 0 OR id = ?)', id, keep ?? null);
  if (usable(asked)) return asked as number;
  if (usable(keep)) return keep as number;
  const theirs = contactId ? one<{ t: number | null }>(db, 'SELECT trading_name_id AS t FROM contacts WHERE id = ?', contactId)?.t : null;
  if (usable(theirs)) return theirs as number;
  return defaultTradingNameId();
}

function live(id: number): Sender | null {
  const t = one<any>(getBooks().db, `SELECT ${COLUMNS} FROM trading_names t WHERE t.id = ?`, id);
  return t
    ? { tradingNameId: t.id, name: t.name, address: t.address, email: t.email, phone: t.phone, paymentDetails: t.paymentDetails, logo: t.logo }
    : null;
}

/** The snapshot stored on a sent document (everything but the logo). */
export function snapshotOf(id: number) {
  const s = live(id);
  if (!s) return null;
  const { logo: _logo, ...rest } = s;
  return JSON.stringify(rest);
}

/** Who a document is from: its snapshot once sent, else the trading name as it is now. */
export function senderFor(tradingNameId: number | null, snapshot: string | null): Sender | null {
  const id = tradingNameId ?? defaultTradingNameId();
  const now = live(id);
  if (snapshot) {
    try {
      return { ...JSON.parse(snapshot), logo: now?.logo ?? null };
    } catch {
      // fall through to the live details
    }
  }
  return now;
}

export function saveTradingName(input: TradingNameInput) {
  const { db } = getBooks();
  const name = clean(input.name);
  if (!name) throw new Error('Give the trading name a name.');
  if (input.logo && (!input.logo.startsWith('data:image/') || input.logo.length > 1_500_000)) {
    throw new Error('The logo must be an image under about 1 MB.');
  }
  const templateId = typeof input.templateId === 'number' && one(db, 'SELECT id FROM invoice_templates WHERE id = ?', input.templateId)
    ? input.templateId
    : null;
  const clash = one(db, 'SELECT id FROM trading_names WHERE name = ? COLLATE NOCASE AND id IS NOT ?', name, input.id ?? null);
  if (clash) throw new Error(`You already have a trading name called ${name}.`);
  const fields = [name, input.logo || null, clean(input.address), clean(input.email), clean(input.phone), clean(input.paymentDetails), templateId];
  if (input.id) {
    if (!one(db, 'SELECT id FROM trading_names WHERE id = ?', input.id)) throw new Error('That trading name no longer exists.');
    run(db,
      `UPDATE trading_names SET name = ?, logo = ?, address = ?, email = ?, phone = ?, payment_details = ?, template_id = ?
       WHERE id = ?`, ...fields, input.id);
    return input.id;
  }
  const first = !one(db, 'SELECT id FROM trading_names');
  return one<{ id: number }>(db,
    `INSERT INTO trading_names (name, logo, address, email, phone, payment_details, template_id, is_default, sort)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort), 0) + 1 FROM trading_names)) RETURNING id`,
    ...fields, first ? 1 : 0)!.id;
}

export function setDefaultTradingName(id: number) {
  const { db } = getBooks();
  const t = one<any>(db, 'SELECT * FROM trading_names WHERE id = ?', id);
  if (!t) throw new Error('That trading name no longer exists.');
  if (t.is_archived) throw new Error('Restore it before making it the default.');
  db.transaction(() => {
    run(db, 'UPDATE trading_names SET is_default = 0');
    run(db, 'UPDATE trading_names SET is_default = 1 WHERE id = ?', id);
  })();
  return true;
}

export function archiveTradingName(id: number, archived: boolean) {
  const { db } = getBooks();
  const t = one<any>(db, 'SELECT * FROM trading_names WHERE id = ?', id);
  if (!t) throw new Error('That trading name no longer exists.');
  if (archived && t.is_default) throw new Error('Make another trading name the default first.');
  run(db, 'UPDATE trading_names SET is_archived = ? WHERE id = ?', archived ? 1 : 0, id);
  return true;
}

export function deleteTradingName(id: number) {
  const { db } = getBooks();
  const t = one<any>(db, 'SELECT * FROM trading_names WHERE id = ?', id);
  if (!t) return true;
  if (t.is_default) throw new Error('Make another trading name the default first.');
  if (one(db, 'SELECT id FROM invoices WHERE trading_name_id = ?', id)) {
    throw new Error('Documents use this trading name. Archive it instead, so they keep showing who they were from.');
  }
  if (one(db, "SELECT id FROM schedules WHERE json_extract(payload, '$.tradingNameId') = ?", id)) {
    throw new Error('A recurring invoice uses this trading name. Change it there first, or archive the trading name.');
  }
  db.transaction(() => {
    run(db, 'UPDATE contacts SET trading_name_id = NULL WHERE trading_name_id = ?', id);
    run(db, 'DELETE FROM trading_names WHERE id = ?', id);
  })();
  return true;
}
