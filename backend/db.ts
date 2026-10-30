// Company file (.tally) lifecycle: open, migrate, lock, close.
// tjs:sqlite is fully synchronous — never await a statement.
import { Database } from 'tjs:sqlite';
import { migrations } from './schema';
import { seedCompany, type CompanySetup } from './seed';

export const FILE_EXT = 'tally';

/** How stale a lock may get before we assume its owner crashed. */
const LOCK_STALE_MS = 1000 * 60 * 60 * 12;

export interface OpenCompany {
  db: Database;
  path: string;
  name: string;
  internal: boolean;
}

let current: OpenCompany | null = null;

export function getCompany(): OpenCompany {
  if (!current) throw new Error('No company file is open.');
  return current;
}

export function hasCompany() {
  return current !== null;
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

export async function openCompany({ path, internal, force }: OpenOptions) {
  if (!(await exists(path))) throw new Error(`Can't find ${path}. It may have been moved or deleted.`);
  if (!force) {
    const holder = await readForeignLock(path);
    if (holder) {
      const err = new Error(`This company file is open on ${holder}.`);
      (err as any).code = 'LOCKED';
      throw err;
    }
  }
  closeCompany();
  const db = new Database(path, { create: false });
  try {
    configure(db, internal);
    migrate(db);
  } catch (e) {
    db.close();
    throw e;
  }
  await writeLock(path);
  const name = one<{ value: string }>(db, "SELECT value FROM meta WHERE key = 'company_name'")?.value ?? 'Company';
  current = { db, path, name, internal };
  return current;
}

export async function createCompany(path: string, internal: boolean, setup: CompanySetup) {
  if (await exists(path)) {
    throw new Error(`A company file already exists at ${path}. Open it instead, or pick another name.`);
  }
  const dir = path.slice(0, path.lastIndexOf('/'));
  await tjs.makeDir(dir, { recursive: true });
  closeCompany();
  const db = new Database(path);
  configure(db, internal);
  migrate(db);
  db.transaction(() => seedCompany(db, setup))();
  db.close();
  return openCompany({ path, internal });
}

export function closeCompany() {
  if (!current) return;
  const { db, path } = current;
  current = null;
  db.close();
  void removeLock(path);
}

export function backupCompany(dest: string) {
  const { db } = getCompany();
  run(db, 'VACUUM INTO ?', dest);
}
