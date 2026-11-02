// tinyjs backend — owns the books file. The page reaches everything here
// through tiny.api.call('<name>', params).
import {
  FILE_EXT,
  all,
  backupBooks,
  closeBooks,
  createBooks,
  getBooks,
  hasBooks,
  inWindow,
  one,
  openBooks,
  openWindows,
  run,
  windowsSharing,
  windowWithFile,
} from './db';
import {
  archiveContact,
  deleteEntry,
  listContacts,
  listEntries,
  saveContact,
  saveEntry,
  summarise,
  type ContactInput,
  type EntryInput,
  type EntryQuery,
} from './entries';
import { search } from './search';
import { getBudget, saveBudget } from './budgets';
import {
  addAttachment,
  deleteAttachment,
  getAttachment,
  listAttachments,
  openAttachment,
  readAttachmentFile,
  saveAttachmentTo,
  type Owner,
} from './attachments';
import { archiveItem, deleteItem, listItems, saveItem, type ItemInput } from './items';
import {
  agedBalances,
  agedReceivables,
  applyCredit,
  convertQuote,
  creditInvoice,
  customerStatement,
  remittance,
  removeAllocation,
  type DocType,
  deleteInvoice,
  deletePayment,
  deleteTemplate,
  duplicateInvoice,
  getInvoice,
  listInvoices,
  listTemplates,
  readLogo,
  recordPayment,
  saveInvoice,
  saveTemplate,
  setDefaultTemplate,
  setInvoiceStatus,
  suggestNumber,
  type InvoiceInput,
  type TemplateInput,
} from './invoices';
import {
  basReport,
  byContact,
  cashFlow,
  monthlyTotals,
  salesTaxReport,
  scheduleCReport,
  deleteTaxReturn,
  listTaxReturns,
  profitAndLoss,
  reopenTaxReturn,
  saveTaxReturn,
  taxReturnReport,
} from './reports';
import { getSettings, isYearStart, updateSettings, type BooksSettings } from './settings';
import { DEMO_NAME, seedDemo } from './demo';
import {
  archiveTradingName,
  deleteTradingName,
  listTradingNames,
  saveTradingName,
  setDefaultTradingName,
  type TradingNameInput,
} from './tradingNames';
import { commitImport, readImportFile, suggestCategories } from './importer';
import { cancelReconcile, finishReconcile, reconcileState, reconciledDates, startReconcile, tick, undoReconcile } from './reconcile';
import { deleteSchedule, getSchedule, listSchedules, runSchedules, saveSchedule, skipNext, type ScheduleInput } from './schedules';
import { deleteRule, listRules, matchRules, saveRule, type RuleInput } from './rules';
import { balanceSheet, journal, journalAccounts, trialBalance } from './ledger';
import { deleteJournal, getJournal, listJournals, saveJournal, type JournalInput } from './journals';
import {
  archiveCommit,
  archivePrepare,
  batchChanges,
  beginBatch,
  endBatch,
  listBatches,
  rowHistory,
  sha256,
  startHistory,
} from './changelog';
import { COUNTRIES, countryProfile, isCountry, type Country } from '../src/shared/countries';
import type { ImportPlan } from '../src/shared/import';
import { taxCodeOr, type TaxCode } from '../src/shared/tax';
import { SCHEDULE_C_MAP, isScheduleCKey } from '../src/shared/scheduleC';

interface RecentBooks {
  path: string;
  name: string;
  lastOpened: string;
  color?: string;
}

interface BooksStore {
  recent: RecentBooks[];
  lastPath: string | null;
}

const STORE_KEY = 'books';
const MAX_RECENT = 8;

let appRef: TinyApp;

// ---- windows --------------------------------------------------------------------
// Each window holds its own books (db.ts). Secondary windows are opened by
// the backend; the books a new window should show waits here until its
// page calls app.start.
const pendingOpen = new Map<string, string>();
let windowCount = 0;
/** Where menu clicks and opened files go. */
let focusedWindow = 'main';
/** Files opened with the app before the main window's page was ready. */
let pendingFiles: string[] = [];
let mainStarted = false;
/**
 * The main window can't really close (that quits the app), so its close
 * button hides it instead and it lets go of its books. Hidden and empty,
 * it's reused for the next window anyone asks for.
 */
let mainHidden = false;

function windowHandle(win: string) {
  return win === 'main' ? appRef.win : appRef.window(win);
}

function setWindowTitle(win: string, name: string | null) {
  windowHandle(win).setTitle(name ? `${name} — Tiny Tally` : 'Tiny Tally');
}

function showMain() {
  mainHidden = false;
  appRef.win.show();
}

/** tinyjs has no "hidden" event: check after main loses focus or its page goes hidden. */
function checkMainHidden() {
  setTimeout(async () => {
    const st = await appRef.win.getState().catch(() => null);
    if (!st || st.visible || st.minimized || mainHidden) return;
    mainHidden = true;
    closeBooks('main');
    setWindowTitle('main', null);
    appRef.win.push('window-hidden', {});
  }, 150);
}

/** The traffic lights, centred in the page's 40px top bar. Keep in step with tinyjs.json. */
const MAC_CONTROLS = { x: 14, y: 14 };

function openWindow(path: string | null) {
  if (mainHidden && !openWindows().includes('main')) {
    if (path) appRef.win.push('open-files', { paths: [path] });
    showMain();
    return 'main';
  }
  const win = `books-${++windowCount}`;
  if (path) pendingOpen.set(win, path);
  appRef.win.open(win, {
    size: '1180x780',
    minSize: '820x560',
    title: 'Tiny Tally',
    // Same as the main window's in tinyjs.json: the page's top bar is the title bar.
    ...(appRef.system.isMacOS() ? { chrome: { frame: false, windowControlsPos: MAC_CONTROLS } } : {}),
  });
  return win;
}

/** Brings the window that has `path` open to the front. Returns false if none has. */
function focusFileWindow(path: string) {
  const win = windowWithFile(path);
  if (!win) return false;
  if (win === 'main') showMain();
  else windowHandle(win).show();
  return true;
}

async function internalDir() {
  return (await appRef.paths()).data + '/books';
}

async function isInternal(path: string) {
  return path.startsWith((await internalDir()) + '/');
}

async function readStore(): Promise<BooksStore> {
  const s = (await appRef.store.get(STORE_KEY)) as BooksStore | null;
  return { recent: s?.recent ?? [], lastPath: s?.lastPath ?? null };
}

/** Saves the books list and tells every window, so each Open Recent menu stays current. */
async function writeStore(s: BooksStore) {
  await appRef.store.set(STORE_KEY, s);
  appRef.push('recent-changed', { recent: s.recent });
}

async function remember(path: string, name: string, color: string) {
  const s = await readStore();
  const recent = [
    { path, name, lastOpened: new Date().toISOString(), color: color || undefined },
    ...s.recent.filter((r) => r.path !== path),
  ].slice(0, MAX_RECENT);
  await writeStore({ recent, lastPath: path });
}

async function fileExists(path: string) {
  try {
    await tjs.stat(path);
    return true;
  } catch {
    return false;
  }
}

function fileNameFor(name: string) {
  const safe = name.replace(/[^\p{L}\p{N} _.-]+/gu, '').trim().replace(/\s+/g, ' ');
  return (safe || 'Books') + '.' + FILE_EXT;
}

/**
 * Tells every window showing `win`'s books that they changed, the window that
 * made the change included, so open pages reload. `tables` are the ones
 * touched; settings live in "meta".
 */
function announce(win: string, tables: string[]) {
  if (!tables.length) return;
  const wins = windowsSharing(win);
  if (!wins.length) return;
  const books = booksInfo(win);
  for (const w of wins) {
    if (tables.includes('meta')) setWindowTitle(w, books?.name ?? null);
    windowHandle(w).push('books-changed', { tables, books, from: win });
  }
}

function booksInfo(win: string) {
  return inWindow(win, () => {
    if (!hasBooks()) return null;
    const c = getBooks();
    return { path: c.path, internal: c.internal, ...getSettings() };
  });
}

async function afterOpen(win: string) {
  const info = booksInfo(win)!;
  await remember(info.path, info.name, info.color);
  setWindowTitle(win, info.name);
  return info;
}

type OpenResult =
  | { ok: true; books: ReturnType<typeof booksInfo> }
  | { ok: false; locked: boolean; message: string; elsewhere?: boolean };

async function tryOpen(win: string, path: string, force = false): Promise<OpenResult> {
  // Already open in another window: go there rather than open it twice.
  const other = windowWithFile(path);
  if (other && other !== win) {
    windowHandle(other).show();
    return { ok: false, locked: false, elsewhere: true, message: 'Those books are already open in another window.' };
  }
  try {
    await openBooks(win, { path, internal: await isInternal(path), force });
    return { ok: true, books: await afterOpen(win) };
  } catch (e: any) {
    return { ok: false, locked: e?.code === 'LOCKED', message: e?.message ?? String(e) };
  }
}

function blankToNull(v: unknown) {
  return typeof v === 'string' && v.trim() === '' ? null : (v ?? null);
}

export const api: Record<string, TinyApiHandler> = {
  // ---- books file ------------------------------------------------------

  /**
   * First call each window's page makes. The main window reopens the last
   * books (unless App settings say not to); a window opened for a set of books
   * opens that one.
   */
  'app.start': async (_p, _app, { window: win }) => {
    const store = await readStore();
    let reopenError: string | null = null;
    let locked = false;
    let lastPath: string | null = null;
    const want = pendingOpen.get(win);
    pendingOpen.delete(win);
    if (want) {
      lastPath = want;
    } else if (win === 'main') {
      // App settings (src/lib/appSettings.ts) can turn reopening off.
      const prefs = (await appRef.store.get('appSettings').catch(() => null)) as { reopenLast?: boolean } | null;
      if (prefs?.reopenLast !== false) lastPath = store.lastPath;
    }
    if (lastPath && !booksInfo(win) && !windowWithFile(lastPath)) {
      const r = await tryOpen(win, lastPath);
      if (!r.ok) {
        reopenError = r.message;
        locked = r.locked;
      }
    }
    const books = booksInfo(win);
    setWindowTitle(win, books?.name ?? null);
    let openFiles: string[] = [];
    if (win === 'main' && !mainStarted) {
      mainStarted = true;
      openFiles = pendingFiles;
      pendingFiles = [];
    }
    return {
      books,
      recent: (await readStore()).recent,
      lastPath,
      reopenError,
      locked,
      internalDir: await internalDir(),
      openFiles,
    };
  },

  'books.create': async ({ name, tradingName, country, fiscalYearStart, dir, taxEnabled, taxRatePpm, taxId }: {
    name: string;
    tradingName?: string;
    country: Country;
    fiscalYearStart: string;
    /** null = store internally */
    dir: string | null;
    taxEnabled?: boolean;
    /** US sales tax: the person's rate. */
    taxRatePpm?: number;
    taxId?: string;
  }, _app, { window: win }) => {
    name = String(name ?? '').trim();
    if (!name) throw new Error('Enter your name.');
    if (!isCountry(country)) throw new Error('Choose the country your business is in.');
    const rate = Math.round(Number(taxRatePpm));
    if (taxRatePpm != null && !(rate >= 0 && rate <= 500_000)) throw new Error('Enter a tax rate between 0% and 50%.');
    const folder = dir ?? (await internalDir());
    const path = folder.replace(/\/+$/, '') + '/' + fileNameFor(String(tradingName ?? '').trim() || name);
    await createBooks(win, path, dir === null, { name, tradingName, country, fiscalYearStart: isYearStart(String(fiscalYearStart)) ? fiscalYearStart : COUNTRIES[country].fiscalYearStart, taxEnabled, taxRatePpm: taxRatePpm == null ? undefined : rate });
    inWindow(win, () => {
      if (taxId) updateSettings({ taxId });
      startHistory('books.create', JSON.stringify({ name }));
    });
    return afterOpen(win);
  },

  /** A sample Australian business with about 16 months of activity. */
  'books.createDemo': async ({ dir, today }: { dir: string | null; today: string }, _app, { window: win }) => {
    const folder = dir ?? (await internalDir());
    let name = DEMO_NAME;
    for (let n = 2; await fileExists(folder + '/' + fileNameFor(name)); n++) name = `${DEMO_NAME} ${n}`;
    const path = folder.replace(/\/+$/, '') + '/' + fileNameFor(name);
    await createBooks(win, path, dir === null, { name, country: 'AU', fiscalYearStart: '07-01', taxEnabled: true });
    inWindow(win, () => {
      seedDemo(today);
      startHistory('books.createDemo', JSON.stringify({ name }));
    });
    return afterOpen(win);
  },

  'books.open': async ({ path, force }: { path: string; force?: boolean }, _app, { window: win }) => tryOpen(win, path, !!force),

  /** Opens a set of books in a window of its own (or focuses the one that has it). */
  'books.openInNewWindow': async ({ path }: { path: string }) => {
    if (focusFileWindow(path)) return { focused: true };
    openWindow(path);
    return { focused: false };
  },

  /** A new window on the welcome screen. */
  /** The main window's page went hidden: it may have been closed (see mainHidden). */
  'app.windowHidden': async (_p, _app, { window: win }) => {
    if (win === 'main') checkMainHidden();
    return true;
  },

  'app.newWindow': async () => {
    openWindow(null);
    return true;
  },

  'books.close': async (_p, _app, { window: win }) => {
    closeBooks(win);
    setWindowTitle(win, null);
    if (win === 'main') {
      const s = await readStore();
      await writeStore({ ...s, lastPath: null });
    }
    return true;
  },

  'books.forget': async ({ path }: { path: string }) => {
    const s = await readStore();
    const recent = s.recent.filter((r) => r.path !== path);
    await writeStore({ recent, lastPath: s.lastPath === path ? null : s.lastPath });
    return recent;
  },

  'books.backup': async ({ stamp }: { stamp?: string } = {}, _app, { window: win }) => {
    const { path } = getBooks();
    const dir = path.slice(0, path.lastIndexOf('/')) + '/Backups';
    await tjs.makeDir(dir, { recursive: true });
    const base = path.slice(path.lastIndexOf('/') + 1).replace(new RegExp(`\\.${FILE_EXT}$`), '');
    // The page sends its local time (no Intl/time zones here); fall back to UTC.
    const when = /^[\d -]+$/.test(stamp ?? '') ? stamp! : new Date().toISOString().slice(0, 19).replace('T', ' ').replace(/:/g, '-');
    const dest = `${dir}/${base} ${when}.${FILE_EXT}`;
    inWindow(win, () => backupBooks(dest));
    return dest;
  },

  /** Theme, density and the like changed in one window: the others reload them. */
  'app.settingsChanged': async (_p, _app, { window: win }) => {
    appRef.push('app-settings-changed', { from: win });
    return true;
  },

  /**
   * File drops reach every window, so each one reports what it saw and the
   * best placed handles it: the window the files were dragged over, else
   * the focused one, else main.
   */
  'drop.claim': async ({ paths, over, focused }: { paths: string[]; over: boolean; focused: boolean }, _app, { window: win }) => {
    claimDrop(Array.isArray(paths) ? paths.map(String) : [], win, over ? 2 : focused ? 1 : 0);
    return true;
  },

  // ---- settings ----------------------------------------------------------

  'settings.update': async (patch: Partial<BooksSettings>, _app, { window: win }) => {
    updateSettings(patch ?? {});
    return afterOpen(win);
  },

  // ---- money accounts ----------------------------------------------------

  'accounts.list': async () => {
    const { db } = getBooks();
    const reconciled = new Map(reconciledDates().map((r) => [r.accountId, r.date]));
    return all(
      db,
      `SELECT a.id, a.name, a.kind, a.opening_balance AS openingBalance,
              a.opening_date AS openingDate, a.is_archived AS archived,
              a.opening_balance
                + COALESCE((SELECT SUM(CASE e.kind WHEN 'income' THEN e.amount ELSE -e.amount END)
                            FROM entries e WHERE e.account_id = a.id), 0)
                + COALESCE((SELECT SUM(e.amount) FROM entries e WHERE e.to_account_id = a.id), 0)
                AS balance
       FROM accounts a
       ORDER BY a.is_archived, a.sort, a.name COLLATE NOCASE`,
    ).map((r: any) => ({ ...r, archived: !!r.archived, reconciledTo: reconciled.get(r.id) ?? null }));
  },

  'accounts.save': async ({ id, name, kind, openingBalance, openingDate }: {
    id?: number;
    name: string;
    kind: 'bank' | 'credit_card' | 'cash';
    openingBalance: number;
    openingDate: string;
  }) => {
    name = String(name ?? '').trim();
    if (!name) throw new Error('Give the account a name.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(openingDate)) throw new Error('Pick an opening date.');
    const bal = Math.round(Number(openingBalance) || 0);
    const { db } = getBooks();
    if (id) {
      run(db, 'UPDATE accounts SET name = ?, kind = ?, opening_balance = ?, opening_date = ? WHERE id = ?',
        name, kind, bal, openingDate, id);
      return id;
    }
    const sort = one<{ n: number }>(db, 'SELECT COALESCE(MAX(sort), -1) + 1 AS n FROM accounts')!.n;
    return one<{ id: number }>(db,
      'INSERT INTO accounts (name, kind, opening_balance, opening_date, sort) VALUES (?, ?, ?, ?, ?) RETURNING id',
      name, kind, bal, openingDate, sort)!.id;
  },

  'accounts.archive': async ({ id, archived }: { id: number; archived: boolean }) => {
    run(getBooks().db, 'UPDATE accounts SET is_archived = ? WHERE id = ?', archived ? 1 : 0, id);
    return true;
  },

  // ---- categories --------------------------------------------------------

  'categories.list': async () => {
    const { db } = getBooks();
    return all(
      db,
      `SELECT c.id, c.name, c.kind, c.class AS class, c.is_archived AS archived, c.tax_code AS taxCode,
              c.report_line AS reportLine, c.parent_id AS parentId,
              CASE WHEN p.id IS NULL THEN c.name ELSE p.name || ' › ' || c.name END AS path,
              (SELECT COUNT(*) FROM entries e WHERE e.category_id = c.id)
                + (SELECT COUNT(*) FROM invoice_lines l WHERE l.category_id = c.id)
                + (SELECT COUNT(*) FROM journal_lines j WHERE j.category_id = c.id) AS uses
       FROM categories c LEFT JOIN categories p ON p.id = c.parent_id
       -- Sub-categories straight after their parent.
       ORDER BY c.kind, COALESCE(p.is_archived, c.is_archived), COALESCE(p.class, c.class) <> 'pnl',
                COALESCE(p.name, c.name) COLLATE NOCASE, c.parent_id IS NOT NULL, c.name COLLATE NOCASE`,
    ).map((r: any) => ({ ...r, archived: !!r.archived }));
  },

  'categories.save': async ({ id, name, kind, taxCode, class: cls, reportLine, parentId }: {
    id?: number;
    name: string;
    kind: 'income' | 'expense';
    /** A sub-category's parent: top level, same side and type. */
    parentId?: number | null;
    taxCode?: TaxCode | null;
    class?: 'pnl' | 'tax' | 'owner' | 'loan' | 'asset';
    /** US: the Schedule C key. */
    reportLine?: string | null;
  }) => {
    const klass = ['pnl', 'tax', 'owner', 'loan', 'asset'].includes(cls as string) ? cls! : 'pnl';
    // Tax payments, owner's money and loans never go on the BAS.
    const country = getSettings().country;
    const code = ['tax', 'owner', 'loan'].includes(klass) ? (countryProfile(country).tax ? 'NTR' : null) : taxCodeOr(countryProfile(country).tax, kind, taxCode);
    // Only P&L categories land on Schedule C.
    const line = klass === 'pnl' && country === 'US' && isScheduleCKey(reportLine) && SCHEDULE_C_MAP[reportLine].kind === kind ? reportLine : null;
    name = String(blankToNull(name) ?? '').trim();
    if (!name) throw new Error('Give the category a name.');
    const { db } = getBooks();
    const clash = one(db, 'SELECT id FROM categories WHERE kind = ? AND name = ? COLLATE NOCASE AND id IS NOT ?',
      kind, name, id ?? null);
    if (clash) throw new Error(`There's already a${kind === 'income' ? 'n income' : 'n expense'} category called “${name}”.`);
    const parent = typeof parentId === 'number' ? one<any>(db, 'SELECT id, name, kind, class, parent_id FROM categories WHERE id = ?', parentId) : null;
    if (typeof parentId === 'number') {
      if (!parent) throw new Error('That parent category no longer exists.');
      if (parent.id === id) throw new Error("A category can't be inside itself.");
      if (parent.parent_id !== null) throw new Error(`“${parent.name}” is already a sub-category. Sub-categories go one level deep.`);
      if (parent.kind !== kind || parent.class !== klass) throw new Error(`“${parent.name}” is a different type of category, so this can't go inside it.`);
    }
    if (id) {
      const children = all<{ class: string; kind: string }>(db, 'SELECT class, kind FROM categories WHERE parent_id = ?', id);
      if (children.length && parent) throw new Error('This category has sub-categories of its own, so it has to stay at the top level.');
      if (children.some((c) => c.class !== klass || c.kind !== kind)) throw new Error('Its sub-categories are a different type. Change or move them first.');
      run(db, 'UPDATE categories SET name = ?, kind = ?, tax_code = ?, class = ?, report_line = ?, parent_id = ? WHERE id = ?',
        name, kind, code, klass, line, parent?.id ?? null, id);
      return id;
    }
    return one<{ id: number }>(db,
      'INSERT INTO categories (name, kind, tax_code, class, report_line, parent_id) VALUES (?, ?, ?, ?, ?, ?) RETURNING id',
      name, kind, code, klass, line, parent?.id ?? null)!.id;
  },

  'categories.archive': async ({ id, archived }: { id: number; archived: boolean }) => {
    run(getBooks().db, 'UPDATE categories SET is_archived = ? WHERE id = ?', archived ? 1 : 0, id);
    return true;
  },
};

// Transactions and contacts live in entries.ts; these are thin wrappers.
Object.assign(api, {
  'entries.list': async (q: EntryQuery) => listEntries(q ?? {}),
  'entries.save': async (input: EntryInput) => saveEntry(input),
  'entries.delete': async ({ id }: { id: number }) => deleteEntry(id),
  'entries.summary': async (range: { from: string; to: string; basis?: 'cash' | 'accrual' }) => summarise(range),

  'invoices.list': async (q: Parameters<typeof listInvoices>[0]) => listInvoices(q ?? {}),
  'invoices.get': async ({ id }: { id: number }) => getInvoice(id),
  'invoices.save': async (input: InvoiceInput) => saveInvoice(input),
  'invoices.setStatus': async ({ id, status }: { id: number; status: 'draft' | 'sent' | 'void' }) => setInvoiceStatus(id, status),
  'invoices.delete': async ({ id }: { id: number }) => deleteInvoice(id),
  'invoices.duplicate': async ({ id, today }: { id: number; today: string }) => duplicateInvoice(id, today),
  'invoices.suggestNumber': async ({ docType, tradingNameId }: { docType?: DocType; tradingNameId?: number | null } = {}) =>
    suggestNumber(docType, tradingNameId),
  'invoices.convertQuote': async ({ id, today }: { id: number; today: string }) => convertQuote(id, today),
  'invoices.credit': async ({ id, today }: { id: number; today: string }) => creditInvoice(id, today),
  'invoices.applyCredit': async (p: Parameters<typeof applyCredit>[0]) => applyCredit(p),
  'invoices.removeAllocation': async ({ id }: { id: number }) => removeAllocation(id),
  'reports.agedPayables': async ({ asOf }: { asOf: string }) => agedBalances(asOf, 'bill'),
  'reports.statement': async (p: Parameters<typeof customerStatement>[0]) => customerStatement(p),
  'bills.remittance': async ({ entryId }: { entryId: number }) => remittance(entryId),

  'ledger.journal': async (p: { from?: string; to: string }) => journal(p),
  'ledger.trialBalance': async ({ asOf }: { asOf: string }) => trialBalance(asOf),
  'ledger.balanceSheet': async (p: { asOf: string; yearStart: string }) => balanceSheet(p),

  'journals.list': async (q: { from?: string; to?: string }) => listJournals(q ?? {}),
  'journals.get': async ({ id }: { id: number }) => getJournal(id),
  'journals.save': async (input: JournalInput) => saveJournal(input),
  'journals.delete': async ({ id }: { id: number }) => deleteJournal(id),
  'journals.accounts': async () => journalAccounts(),

  'reconcile.state': async ({ accountId }: { accountId: number }) => reconcileState(accountId),
  'reconcile.start': async (p: Parameters<typeof startReconcile>[0]) => startReconcile(p),
  'reconcile.tick': async (p: Parameters<typeof tick>[0]) => tick(p),
  'reconcile.finish': async ({ id }: { id: number }) => finishReconcile(id),
  'reconcile.cancel': async ({ id }: { id: number }) => cancelReconcile(id),
  'reconcile.undo': async ({ id }: { id: number }) => undoReconcile(id),

  'schedules.list': async () => listSchedules(),
  'schedules.get': async ({ id }: { id: number }) => getSchedule(id),
  'schedules.save': async (input: ScheduleInput) => saveSchedule(input),
  'schedules.delete': async ({ id }: { id: number }) => deleteSchedule(id),
  'schedules.skip': async ({ id }: { id: number }) => skipNext(id),
  'schedules.run': async ({ today }: { today: string }) => runSchedules(today),

  'attachments.list': async (o: Owner) => listAttachments(o),
  'attachments.get': async ({ id }: { id: number }) => getAttachment(id),
  'attachments.readFile': async ({ path }: { path: string }) => readAttachmentFile(path),
  'attachments.add': async (p: Parameters<typeof addAttachment>[0]) => addAttachment(p),
  'attachments.open': async ({ id }: { id: number }) => openAttachment(id),
  'attachments.saveCopy': async ({ id, path }: { id: number; path: string }) => saveAttachmentTo(id, path),
  'attachments.delete': async ({ id }: { id: number }) => deleteAttachment(id),

  'budgets.get': async ({ firstMonth }: { firstMonth: string }) => getBudget(firstMonth),
  'budgets.save': async (p: Parameters<typeof saveBudget>[0]) => saveBudget(p),

  'items.list': async () => listItems(),
  'items.save': async (input: ItemInput) => saveItem(input),
  'items.archive': async ({ id, archived }: { id: number; archived: boolean }) => archiveItem(id, archived),
  'items.delete': async ({ id }: { id: number }) => deleteItem(id),

  'rules.list': async () => listRules(),
  'rules.save': async (input: RuleInput) => saveRule(input),
  'rules.delete': async ({ id }: { id: number }) => deleteRule(id),
  'rules.match': async ({ items }: { items: { text: string; kind?: 'income' | 'expense' }[] }) => matchRules(Array.isArray(items) ? items : []),

  /** Small per-book preferences (saved CSV column mappings and the like). */
  'prefs.get': async ({ key }: { key: string }) => {
    const v = one<{ value: string }>(getBooks().db, 'SELECT value FROM meta WHERE key = ?', 'pref:' + String(key))?.value;
    return v === undefined ? null : JSON.parse(v);
  },
  'prefs.set': async ({ key, value }: { key: string; value: unknown }) => {
    run(getBooks().db, 'INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', 'pref:' + String(key), JSON.stringify(value ?? null));
    return true;
  },
  'invoices.recordPayment': async (p: Parameters<typeof recordPayment>[0]) => recordPayment(p),
  'invoices.deletePayment': async ({ entryId }: { entryId: number }) => deletePayment(entryId),

  'tradingNames.list': async () => listTradingNames(),
  'tradingNames.save': async (t: TradingNameInput) => saveTradingName(t),
  'tradingNames.setDefault': async ({ id }: { id: number }) => setDefaultTradingName(id),
  'tradingNames.archive': async ({ id, archived }: { id: number; archived: boolean }) => archiveTradingName(id, archived),
  'tradingNames.delete': async ({ id }: { id: number }) => deleteTradingName(id),
  'templates.list': async () => listTemplates(),
  'templates.save': async (t: TemplateInput) => saveTemplate(t),
  'templates.setDefault': async ({ id }: { id: number }) => setDefaultTemplate(id),
  'templates.delete': async ({ id }: { id: number }) => deleteTemplate(id),
  'templates.readLogo': async ({ path }: { path: string }) => readLogo(path),

  'reports.profitAndLoss': async (p: Parameters<typeof profitAndLoss>[0]) => profitAndLoss(p),
  'reports.cashFlow': async (p: Parameters<typeof cashFlow>[0]) => cashFlow(p),
  'reports.monthly': async (p: Parameters<typeof monthlyTotals>[0]) => monthlyTotals(p),
  'reports.byContact': async (p: Parameters<typeof byContact>[0]) => byContact(p),
  'reports.bas': async (p: Parameters<typeof basReport>[0]) => basReport(p),
  'reports.salesTax': async (p: Parameters<typeof salesTaxReport>[0]) => salesTaxReport(p),
  'reports.scheduleC': async (p: Parameters<typeof scheduleCReport>[0]) => scheduleCReport(p),
  'reports.agedReceivables': async ({ asOf }: { asOf: string }) => agedReceivables(asOf),
  'reports.taxReturn': async (p: Parameters<typeof taxReturnReport>[0]) => taxReturnReport(p),
  'taxReturns.list': async () => listTaxReturns(),
  'taxReturns.save': async (p: Parameters<typeof saveTaxReturn>[0], _app, { window: win }) => {
    saveTaxReturn(p);
    return booksInfo(win);
  },
  'taxReturns.reopen': async ({ id }: { id: number }, _app, { window: win }) => {
    reopenTaxReturn(id);
    return booksInfo(win);
  },
  'taxReturns.delete': async ({ id }: { id: number }) => deleteTaxReturn(id),

  /** Write a text file the user chose with a save dialog (CSV exports). */
  'file.writeText': async ({ path, text }: { path: string; text: string }) => {
    if (typeof path !== 'string' || !path.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(path)) throw new Error('Choose where to save.');
    await tjs.writeFile(path, new TextEncoder().encode(String(text ?? '')));
    return path;
  },
  'import.read': async ({ path }: { path: string }) => readImportFile(path),
  'import.suggest': async ({ names }: { names: string[] }) => suggestCategories(Array.isArray(names) ? names.map(String) : []),
  'import.commit': async (plan: ImportPlan) => commitImport(plan),
  'contacts.list': async () => listContacts(),
  'search.all': async ({ q }: { q: string }) => search(q),

  'changes.batches': async (p: Parameters<typeof listBatches>[0]) => listBatches(p ?? {}),
  'changes.batch': async (p: Parameters<typeof batchChanges>[0]) => batchChanges(p),
  'changes.row': async (p: Parameters<typeof rowHistory>[0]) => rowHistory(p),
  /** Moves history before a date into a .tallylog file beside the books file. */
  'changes.archive': async (p: { before: string; beforeAt: string }, _app, { window: win }) => {
    const prep = archivePrepare(p);
    const hash = await sha256(prep.text);
    const out = inWindow(win, () => ({ ...archiveCommit({ dest: prep.dest, before: prep.before, day: prep.day, hash }), changes: prep.counts.changes }));
    announce(win, ['change_log']);
    return out;
  },
  'contacts.save': async (input: ContactInput) => saveContact(input),
  'contacts.archive': async ({ id, archived }: { id: number; archived: boolean }) => archiveContact(id, archived),
} satisfies Record<string, TinyApiHandler>);

/**
 * Calls that only read. Every other call runs inside a change-log batch, so
 * anything that writes is logged, including calls added later; a batch that
 * changed nothing is dropped.
 */
const READ_ONLY = /^(app\.|books\.|drop\.|changes\.|file\.|import\.(read|suggest)$|prefs\.get$|rules\.match$|templates\.readLogo$|reports\.|ledger\.|bills\.remittance$|entries\.summary$|invoices\.suggestNumber$|reconcile\.state$|journals\.accounts$|bas\.list$|attachments\.(readFile|open|saveCopy)$|.*\.(list|get)$)/;

// Every handler runs bound to its calling window (see db.ts).
for (const [name, handler] of Object.entries(api)) {
  const logged = !READ_ONLY.test(name);
  api[name] = (params, app, meta) => {
    const win = meta?.window ?? 'main';
    return inWindow(win, () => {
      const batch = logged && hasBooks() ? beginBatch(name) : null;
      let out: unknown;
      try {
        out = handler(params, app, meta ?? { window: win });
      } catch (e) {
        if (batch) announce(win, endBatch(batch));
        throw e;
      }
      if (!batch) return out;
      return Promise.resolve(out).finally(() => announce(win, endBatch(batch)));
    });
  };
}

// ---- drops -------------------------------------------------------------------------
const drops = new Map<string, { best: string; score: number; timer: ReturnType<typeof setTimeout> }>();

function claimDrop(paths: string[], win: string, score: number) {
  if (!paths.length) return;
  const key = paths.join('\n');
  const d = drops.get(key);
  if (d) {
    if (score > d.score || (score === d.score && win === 'main')) Object.assign(d, { best: win, score });
    return;
  }
  // Every window answers within a moment; then the best placed one gets it.
  drops.set(key, {
    best: win,
    score,
    timer: setTimeout(() => {
      const won = drops.get(key)!;
      drops.delete(key);
      windowHandle(won.best).push('drop', { paths });
    }, 120),
  });
}

export function init(app: TinyApp) {
  appRef = app;
  app.win.setHideOnClose(true);
}

/** Menu clicks reach every window; send each to the focused one only. */
export function onMenu(id: string) {
  // With every window closed on macOS, the menu bar still works: bring main back for it.
  if (focusedWindow === 'main' && mainHidden) showMain();
  windowHandle(focusedWindow).push('menu', { id });
}

export function onWindowState(info: TinyWindowStateEvent) {
  if (info.focused) focusedWindow = info.win;
  if (info.win !== 'main') return;
  if (info.focused) mainHidden = false;
  else checkMainHidden();
}

export function onOpenFiles(paths: string[]) {
  if (!mainStarted) pendingFiles.push(...paths);
  else {
    if (focusedWindow === 'main' && mainHidden) showMain();
    windowHandle(focusedWindow).push('open-files', { paths });
  }
}

export function onWindowClosed(id: string) {
  if (id === 'main') {
    for (const win of openWindows()) closeBooks(win);
  } else closeBooks(id);
  pendingOpen.delete(id);
  if (focusedWindow === id) focusedWindow = 'main';
}
