// Change log: every insert, update and delete on the books, as JSON, grouped
// into batches (one per action in the app). See schema v8.
//
// The triggers are rebuilt from the live column lists each time a file opens,
// so columns added by later migrations are logged without a new migration.
// Older history can be moved into a .tallylog file (plain SQLite) to keep the
// company file small; a marker batch records what went where.
import { Database } from 'tjs:sqlite';
import { all, currentHost, getCompany, one, run } from './db';

/** Tables whose rows are logged. meta (settings) is handled separately. */
const LOGGED = [
  'accounts', 'categories', 'contacts', 'entries', 'invoices', 'invoice_lines', 'credit_allocations',
  'invoice_templates', 'reconciliations', 'schedules', 'rules', 'journals', 'journal_lines', 'bas_returns',
];
/** Bookkeeping columns that change on every save and mean nothing on their own. */
const IGNORED = new Set(['updated_at']);
/** Columns too big to copy into every log row (images as data: URLs). */
const BULKY: Record<string, string[]> = { invoice_templates: ['logo'] };

const BATCH = '(SELECT batch_id FROM change_context WHERE id = 1)';

/** Column names come from the file's own schema; a hand-made file could carry anything. */
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

function q(name: string) {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Drops and recreates the log triggers to match the current schema. */
export function installChangeLog(db: Database) {
  const old = db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'log\\_%' ESCAPE '\\'").all() as { name: string }[];
  const sql: string[] = old.map((t) => `DROP TRIGGER ${q(t.name)};`);
  for (const table of LOGGED) {
    const cols = (db.prepare(`PRAGMA table_info(${q(table)})`).all() as { name: string }[]).map((c) => c.name).filter((c) => IDENT.test(c));
    if (!cols.length) continue;
    const bulky = new Set(BULKY[table] ?? []);
    const value = (side: 'NEW' | 'OLD', c: string) =>
      bulky.has(c) ? `CASE WHEN ${side}.${q(c)} IS NULL OR ${side}.${q(c)} = '' THEN NULL ELSE '(image)' END` : `${side}.${q(c)}`;
    const json = (side: 'NEW' | 'OLD') => `json_object(${cols.filter((c) => !IGNORED.has(c)).map((c) => `'${c}', ${value(side, c)}`).join(', ')})`;
    const changed = cols.filter((c) => !IGNORED.has(c)).map((c) => `OLD.${q(c)} IS NOT NEW.${q(c)}`).join(' OR ');
    const id = (side: 'NEW' | 'OLD') => (cols.includes('id') ? `${side}.id` : 'NULL');
    sql.push(
      `CREATE TRIGGER ${q(`log_${table}_insert`)} AFTER INSERT ON ${q(table)} BEGIN
         INSERT INTO change_log (batch_id, table_name, row_id, action, after)
         VALUES (${BATCH}, '${table}', ${id('NEW')}, 'insert', ${json('NEW')});
       END;`,
      `CREATE TRIGGER ${q(`log_${table}_update`)} AFTER UPDATE ON ${q(table)} WHEN ${changed} BEGIN
         INSERT INTO change_log (batch_id, table_name, row_id, action, before, after)
         VALUES (${BATCH}, '${table}', ${id('NEW')}, 'update', ${json('OLD')}, ${json('NEW')});
       END;`,
      `CREATE TRIGGER ${q(`log_${table}_delete`)} AFTER DELETE ON ${q(table)} BEGIN
         INSERT INTO change_log (batch_id, table_name, row_id, action, before)
         VALUES (${BATCH}, '${table}', ${id('OLD')}, 'delete', ${json('OLD')});
       END;`,
    );
  }
  // Settings are written with INSERT OR REPLACE, whose implied delete fires no
  // trigger, so the old value is read before the write instead.
  const skip = (key: string) => `${key} NOT LIKE 'pref:%' AND ${key} <> 'schema_version'`;
  const shown = (key: string, v: string) => `CASE WHEN ${key} = 'company_logo' AND ${v} <> '' THEN '(image)' ELSE ${v} END`;
  const prior = '(SELECT value FROM meta WHERE key = NEW.key)';
  const existed = 'EXISTS (SELECT 1 FROM meta WHERE key = NEW.key)';
  sql.push(
    `CREATE TRIGGER "log_meta_write" BEFORE INSERT ON meta WHEN ${skip('NEW.key')} AND NEW.value IS NOT ${prior} BEGIN
       INSERT INTO change_log (batch_id, table_name, row_key, action, before, after)
       VALUES (${BATCH}, 'meta', NEW.key, CASE WHEN ${existed} THEN 'update' ELSE 'insert' END,
               CASE WHEN ${existed} THEN json_object('value', ${shown('NEW.key', prior)}) END,
               json_object('value', ${shown('NEW.key', 'NEW.value')}));
     END;`,
    `CREATE TRIGGER "log_meta_delete" AFTER DELETE ON meta WHEN ${skip('OLD.key')} BEGIN
       INSERT INTO change_log (batch_id, table_name, row_key, action, before)
       VALUES (${BATCH}, 'meta', OLD.key, 'delete', json_object('value', ${shown('OLD.key', 'OLD.value')}));
     END;`,
  );
  db.transaction(() => db.exec(sql.join('\n')))();
}

// ---- batches (main.ts opens one around each call that may change data) -----------

export function beginBatch(action: string) {
  const { db } = getCompany();
  const id = one<{ id: number }>(db, 'INSERT INTO change_batches (action, host) VALUES (?, ?) RETURNING id', action, currentHost())!.id;
  run(db, 'UPDATE change_context SET batch_id = ? WHERE id = 1', id);
  return { db, id };
}

/** Closes a batch: drops it if nothing changed, otherwise records how much did. */
export function endBatch(b: { db: Database; id: number }) {
  try {
    // Only if it's still ours: an overlapping call may have started its own.
    run(b.db, 'UPDATE change_context SET batch_id = NULL WHERE id = 1 AND batch_id = ?', b.id);
    const n = one<{ n: number }>(b.db, 'SELECT COUNT(*) AS n FROM change_log WHERE batch_id = ?', b.id)!.n;
    if (n) run(b.db, 'UPDATE change_batches SET count = ? WHERE id = ?', n, b.id);
    else run(b.db, 'DELETE FROM change_batches WHERE id = ?', b.id);
  } catch {
    // The company closed while the call was running; nothing to finish.
  }
}

/** A fresh company's seeded rows aren't history: start the log empty, with one line saying so. */
export function startHistory(action: string, summary: string) {
  const { db } = getCompany();
  db.transaction(() => {
    run(db, 'DELETE FROM change_log');
    run(db, 'DELETE FROM change_batches');
    run(db, 'INSERT INTO change_batches (action, host, summary) VALUES (?, ?, ?)', action, currentHost(), summary);
  })();
}

// ---- reading -------------------------------------------------------------------------

const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Log times are UTC; the page sends its local midnights as ISO instants. */
const INSTANT = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/;

/** The company file, or an archive (opened read-only for the call). */
function withSource<T>(archive: string | null | undefined, fn: (db: Database) => T): T {
  if (!archive) return fn(getCompany().db);
  if (!/\.tallylog$/i.test(archive)) throw new Error('Choose a Tiny Tally history file (.tallylog).');
  // Not network shares: on Windows, opening one can hand the share your login.
  // Either slash counts on Windows, and \\?\UNC\ and \\.\ start the same way.
  const norm = archive.replace(/\//g, '\\');
  if (norm.startsWith('\\\\') || /^file:/i.test(archive)) throw new Error('Copy the history file to this computer first.');
  const db = new Database(archive, { create: false, readOnly: true });
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

export function listBatches(p: { limit?: number; offset?: number; from?: string; to?: string; archive?: string | null }) {
  const limit = Math.min(Math.max(Number(p.limit) || 100, 1), 500);
  const offset = Math.max(Number(p.offset) || 0, 0);
  return withSource(p.archive, (db) => {
    const where: string[] = [];
    const args: string[] = [];
    if (p.from && INSTANT.test(p.from)) {
      where.push('at >= ?');
      args.push(p.from);
    }
    if (p.to && INSTANT.test(p.to)) {
      where.push('at < ?');
      args.push(p.to);
    }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const rows = all(db, `SELECT id, at, action, host, summary, count FROM change_batches ${w} ORDER BY at DESC, id DESC LIMIT ${limit} OFFSET ${offset}`, ...args);
    const total = one<{ n: number }>(db, `SELECT COUNT(*) AS n FROM change_batches ${w}`, ...args)!.n;
    const oldest = one<{ at: string | null }>(db, 'SELECT MIN(at) AS at FROM change_batches')!.at;
    return { rows, total, oldest };
  });
}

function changeRows(rows: any[]) {
  return rows.map((r) => ({ ...r, before: r.before ? JSON.parse(r.before) : null, after: r.after ? JSON.parse(r.after) : null }));
}

export function batchChanges(p: { batchId: number; archive?: string | null }) {
  return withSource(p.archive, (db) =>
    changeRows(all(db,
      `SELECT id, at, table_name AS tableName, row_id AS rowId, row_key AS rowKey, action, before, after
       FROM change_log WHERE batch_id = ? ORDER BY id`, p.batchId)));
}

/** Everything that happened to one row (a transaction, an invoice and its lines…). */
export function rowHistory(p: { table: string; id: number }) {
  const { db } = getCompany();
  const tables = p.table === 'invoices' ? ['invoices', 'invoice_lines'] : p.table === 'journals' ? ['journals', 'journal_lines'] : [p.table];
  if (!tables.every((t) => LOGGED.includes(t))) throw new Error('No history is kept for that.');
  // Lines point at their document through a column, not row_id.
  const parent = p.table === 'invoices' ? 'invoice_id' : 'journal_id';
  const rows = all(db,
    `SELECT l.id, l.at, l.table_name AS tableName, l.row_id AS rowId, l.row_key AS rowKey, l.action, l.before, l.after,
            b.id AS batchId, b.action AS batchAction, b.host
     FROM change_log l LEFT JOIN change_batches b ON b.id = l.batch_id
     WHERE (l.table_name = ? AND l.row_id = ?)
        OR (l.table_name = ? AND ? = 2 AND (json_extract(l.after, '$.${parent}') = ? OR json_extract(l.before, '$.${parent}') = ?))
     ORDER BY l.id DESC LIMIT 500`,
    tables[0], p.id, tables[1] ?? '', tables.length, p.id, p.id);
  return changeRows(rows);
}

// ---- archiving -------------------------------------------------------------------------

export async function sha256(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Moves history from before `before` (a local date; `beforeAt` is its
 * midnight as a UTC instant) into a .tallylog file next
 * to the company file, then compacts the company file. Leaves one marker
 * batch naming the file, how many changes went, and a SHA-256 of them so the
 * archive can be checked later. Call inside the window (main.ts rebinds).
 */
export function archivePrepare(p: { before: string; beforeAt: string }) {
  if (!DATE.test(p.before) || !INSTANT.test(p.beforeAt)) throw new Error('Pick a date.');
  const before = p.beforeAt;
  const { db, path } = getCompany();
  const counts = one<{ batches: number; changes: number }>(db,
    `SELECT (SELECT COUNT(*) FROM change_batches WHERE at < ?1) AS batches,
            (SELECT COUNT(*) FROM change_log WHERE at < ?1) AS changes`, before)!;
  if (!counts.changes) throw new Error('There is no history before that date.');
  const dir = path.slice(0, path.lastIndexOf('/'));
  const base = path.slice(path.lastIndexOf('/') + 1).replace(/\.tally$/, '');
  const dest = `${dir}/${base} history to ${p.before}.tallylog`;
  const rows = all(db, 'SELECT * FROM change_log WHERE at < ? ORDER BY id', before);
  return { dest, before, day: p.before, counts, text: JSON.stringify(rows) };
}

export function archiveCommit(p: { dest: string; before: string; day: string; hash: string }) {
  const { db } = getCompany();
  run(db, 'ATTACH DATABASE ? AS arch', p.dest);
  try {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS arch.change_batches (
          id INTEGER PRIMARY KEY, at TEXT NOT NULL, action TEXT NOT NULL, host TEXT, summary TEXT, count INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS arch.change_log (
          id INTEGER PRIMARY KEY, batch_id INTEGER, at TEXT NOT NULL, table_name TEXT NOT NULL, row_id INTEGER, row_key TEXT,
          action TEXT NOT NULL, before TEXT, after TEXT);
        CREATE TABLE IF NOT EXISTS arch.meta (key TEXT PRIMARY KEY, value TEXT);`);
      run(db, 'INSERT OR IGNORE INTO arch.change_batches SELECT id, at, action, host, summary, count FROM change_batches WHERE at < ?', p.before);
      run(db,
        'INSERT OR IGNORE INTO arch.change_log SELECT id, batch_id, at, table_name, row_id, row_key, action, before, after FROM change_log WHERE at < ?',
        p.before);
      run(db, "INSERT OR REPLACE INTO arch.meta (key, value) VALUES ('company_name', (SELECT value FROM meta WHERE key = 'company_name'))");
      const moved = one<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM change_log WHERE at < ?', p.before)!.n;
      run(db, 'DELETE FROM change_log WHERE at < ?', p.before);
      run(db, 'DELETE FROM change_batches WHERE at < ?', p.before);
      run(db, 'INSERT INTO change_batches (action, host, summary) VALUES (?, ?, ?)', 'history.archive', currentHost(),
        JSON.stringify({ file: p.dest, before: p.day, changes: moved, sha256: p.hash }));
      // The marker is dated just before the cut, so it sits where the archived history was.
      run(db, "UPDATE change_batches SET at = strftime('%Y-%m-%dT%H:%M:%fZ', julianday(?) - 0.001 / 86400) WHERE id = last_insert_rowid()", p.before);
    })();
  } finally {
    run(db, 'DETACH DATABASE arch');
  }
  // Give the space back. Can't run inside a transaction.
  db.exec('VACUUM');
  return { file: p.dest };
}
