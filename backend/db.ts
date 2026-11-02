// Books file (.tally) lifecycle: open, migrate, lock, close.
// tjs:sqlite is fully synchronous — never await a statement.
import { Database } from 'tjs:sqlite';
import { installChangeLog } from './changelog';
import { migrations } from './schema';
import { seedBooks, type BooksSetup } from './seed';

export const FILE_EXT = 'tally';

/** How stale a lock may get before we assume its owner crashed. */
const LOCK_STALE_MS = 1000 * 60 * 60 * 12;

export interface OpenBooks {
  db: Database;
  path: string;
  name: string;
  internal: boolean;
}

// Each window shows one set of books; several windows can share the same open
// file (one connection, closed when the last of them lets go). Each api call
// runs bound to its window (main.ts wraps every handler), so getBooks() means
// "this window's books".
//
// Binding lasts for the handler's synchronous part only, then clears.
// Module code is fully synchronous (tjs:sqlite never awaits), so that covers
// it; code that awaits and then touches the database must rebind with
// inWindow(). Unbound access throws rather than guessing a window, so a
// mistake can't write to another window's books.
const open = new Map<string, OpenBooks>();
let bound: string | null = null;

/** Runs fn with getBooks() meaning `win`'s books. */
export function inWindow<T>(win: string, fn: () => T): T {
  const prev = bound;
  bound = win;
  try {
    return fn();
  } finally {
    bound = prev;
  }
}

function boundWindow() {
  if (bound === null) throw new Error('Internal error: books used outside a window call.');
  return bound;
}

export function getBooks(): OpenBooks {
  const c = open.get(boundWindow());
  if (!c) throw new Error('No books are open.');
  return c;
}

export function hasBooks() {
  return open.has(boundWindow());
}

/** The window that has this file open, if any. */
export function windowWithFile(path: string) {
  for (const [win, c] of open) if (c.path === path) return win;
  return null;
}

export function openWindows() {
  return [...open.keys()];
}

/** Every window showing the same books as `win`, `win` included. */
export function windowsSharing(win: string) {
  const c = open.get(win);
  return c ? [...open].filter(([, o]) => o === c).map(([w]) => w) : [];
}

/** Shows `from`'s books in `win` too, sharing its connection. */
export function shareBooks(win: string, from: string) {
  const c = open.get(from);
  if (!c) throw new Error('No books are open.');
  if (open.get(win) === c) return;
  closeBooks(win);
  open.set(win, c);
}

export function one<T = any>(db: Database, sql: string, ...args: any[]): T | null {
  return (db.prepare(sql).all(...args)[0] as T) ?? null;
}

export function all<T = any>(db: Database, sql: string, ...args: any[]): T[] {
  return db.prepare(sql).all(...args) as T[];
}

export function run(db: Database, sql: string, ...args: any[]) {
  db.prepare(sql).run(...args);
}

async function exists(path: string) {
  try {
    await tjs.stat(path);
    return true;
  } catch {
    return false;
  }
}

function lockPath(path: string) {
  return path + '.lock';
}

/** Returns a description of whoever else holds the file, or null. */
async function readForeignLock(path: string): Promise<string | null> {
  try {
    const raw = new TextDecoder().decode(await tjs.readFile(lockPath(path)));
    const lock = JSON.parse(raw) as { pid: number; host: string; at: number };
    // tinyjs is single-instance per machine, so our own host's lock is always
    // stale (left by a crash or force-quit) and safe to take over.
    if (lock.host === (await hostName())) return null;
    if (Date.now() - lock.at > LOCK_STALE_MS) return null;
    // No Intl in txiki — keep the timestamp plain and unambiguous.
    return `${lock.host || 'another computer'} (since ${new Date(lock.at).toISOString().slice(0, 16).replace('T', ' ')} UTC)`;
  } catch {
    return null;
  }
}

let cachedHost: string | null = null;

/** This computer's name, for the change log (known once a file has been opened). */
export function currentHost() {
  return cachedHost ?? '';
}

async function hostName() {
  if (cachedHost) return cachedHost;
  let host = tjs.env.COMPUTERNAME || tjs.env.HOSTNAME || '';
  if (!host) {
    try {
      const proc = tjs.spawn(['hostname'], { stdout: 'pipe', stderr: 'ignore' });
      const reader = proc.stdout!.getReader();
      let out = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        out += new TextDecoder().decode(value);
      }
      await proc.wait();
      host = out.trim();
    } catch {
      // fall through
    }
  }
  cachedHost = host || 'unknown';
  return cachedHost;
}

async function writeLock(path: string) {
  const body = JSON.stringify({ pid: tjs.pid, host: await hostName(), at: Date.now() });
  await tjs.writeFile(lockPath(path), new TextEncoder().encode(body));
}

async function removeLock(path: string) {
  try {
    await tjs.remove(lockPath(path));
  } catch {
    // already gone
  }
}

function migrate(db: Database) {
  db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)');
  const row = one<{ value: string }>(db, "SELECT value FROM meta WHERE key = 'schema_version'");
  const from = row ? Number(row.value) : 0;
  if (from > migrations.length) {
    throw new Error('This file was made by a newer version of Tiny Tally. Update the app to open it.');
  }
  for (let v = from; v < migrations.length; v++) {
    db.transaction(() => {
      db.exec(migrations[v]);
      run(db, "INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)", String(v + 1));
    })();
  }
  installChangeLog(db);
}

function configure(db: Database, internal: boolean) {
  db.exec('PRAGMA foreign_keys = ON');
  // WAL leaves -wal/-shm sidecars, which sync services (Dropbox, iCloud) can
  // split from the main file. Only use it where we own the folder.
  db.exec(`PRAGMA journal_mode = ${internal ? 'WAL' : 'DELETE'}`);
}

export interface OpenOptions {
  path: string;
  internal: boolean;
  /** Open even if another machine appears to have it. */
  force?: boolean;
}

/** Opens `path` in window `win`, closing whatever that window had. */
export async function openBooks(win: string, { path, internal, force }: OpenOptions) {
  if (!(await exists(path))) throw new Error(`Can't find ${path}. It may have been moved or deleted.`);
  if (!force) {
    const holder = await readForeignLock(path);
    if (holder) {
      const err = new Error(`These books are open on ${holder}.`);
      (err as any).code = 'LOCKED';
      throw err;
    }
  }
  closeBooks(win);
  const db = new Database(path, { create: false });
  try {
    configure(db, internal);
    migrate(db);
  } catch (e) {
    db.close();
    throw e;
  }
  await writeLock(path);
  const name = one<{ value: string }>(db, "SELECT value FROM meta WHERE key = 'books_name'")?.value ?? 'Books';
  const books = { db, path, name, internal };
  open.set(win, books);
  return books;
}

export async function createBooks(win: string, path: string, internal: boolean, setup: BooksSetup) {
  if (await exists(path)) {
    throw new Error(`Books already exist at ${path}. Open them instead, or pick another name.`);
  }
  const dir = path.slice(0, path.lastIndexOf('/'));
  await tjs.makeDir(dir, { recursive: true });
  closeBooks(win);
  const db = new Database(path);
  configure(db, internal);
  migrate(db);
  db.transaction(() => seedBooks(db, setup))();
  db.close();
  return openBooks(win, { path, internal });
}

/** Closes the books open in `win` (default: the bound window). */
export function closeBooks(win: string = boundWindow()) {
  const c = open.get(win);
  if (!c) return;
  open.delete(win);
  // Still showing in another window.
  if ([...open.values()].includes(c)) return;
  c.db.close();
  void removeLock(c.path);
}

export function backupBooks(dest: string) {
  const { db } = getBooks();
  run(db, 'VACUUM INTO ?', dest);
}
