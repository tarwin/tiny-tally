// tinyjs backend — owns the company file. The page reaches everything here
// through tiny.api.call('<name>', params).
import {
  FILE_EXT,
  all,
  backupCompany,
  closeCompany,
  createCompany,
  getCompany,
  hasCompany,
  one,
  openCompany,
  run,
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
import {
  agedBalances,
  agedReceivables,
  applyCredit,
  convertQuote,
  creditInvoice,
  customerStatement,
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
  deleteBasReturn,
  listBasReturns,
  profitAndLoss,
  reopenBasReturn,
  saveBasReturn,
} from './reports';
import { getSettings, updateSettings, type CompanySettings } from './settings';
import { DEMO_NAME, seedDemo } from './demo';
import { commitImport, readImportFile, suggestCategories } from './importer';
import { cancelReconcile, finishReconcile, reconcileState, reconciledDates, startReconcile, tick, undoReconcile } from './reconcile';
import { deleteSchedule, getSchedule, listSchedules, runSchedules, saveSchedule, skipNext, type ScheduleInput } from './schedules';
import { deleteRule, listRules, matchRules, saveRule, type RuleInput } from './rules';
import { balanceSheet, journal, trialBalance } from './ledger';
import type { ImportPlan } from '../src/shared/import';
import { isTaxCode, type TaxCode } from '../src/shared/tax';

interface RecentCompany {
  path: string;
  name: string;
  lastOpened: string;
  color?: string;
}

interface CompanyStore {
  recent: RecentCompany[];
  lastPath: string | null;
}

const STORE_KEY = 'companies';
const MAX_RECENT = 8;

let appRef: TinyApp;

async function internalDir() {
  return (await appRef.paths()).data + '/companies';
}

async function isInternal(path: string) {
  return path.startsWith((await internalDir()) + '/');
}

async function readStore(): Promise<CompanyStore> {
  const s = (await appRef.store.get(STORE_KEY)) as CompanyStore | null;
  return { recent: s?.recent ?? [], lastPath: s?.lastPath ?? null };
}

async function remember(path: string, name: string, color: string) {
  const s = await readStore();
  const recent = [
    { path, name, lastOpened: new Date().toISOString(), color: color || undefined },
    ...s.recent.filter((r) => r.path !== path),
  ].slice(0, MAX_RECENT);
  await appRef.store.set(STORE_KEY, { recent, lastPath: path });
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
  return (safe || 'Company') + '.' + FILE_EXT;
}

function companyInfo() {
  if (!hasCompany()) return null;
  const c = getCompany();
  return { path: c.path, internal: c.internal, ...getSettings() };
}

async function afterOpen() {
  const info = companyInfo()!;
  await remember(info.path, info.name, info.color);
  appRef.setTitle(`${info.name} — Tiny Tally`);
  return info;
}

type OpenResult =
  | { ok: true; company: ReturnType<typeof companyInfo> }
  | { ok: false; locked: boolean; message: string };

async function tryOpen(path: string, force = false): Promise<OpenResult> {
  try {
    await openCompany({ path, internal: await isInternal(path), force });
    return { ok: true, company: await afterOpen() };
  } catch (e: any) {
    return { ok: false, locked: e?.code === 'LOCKED', message: e?.message ?? String(e) };
  }
}

function blankToNull(v: unknown) {
  return typeof v === 'string' && v.trim() === '' ? null : (v ?? null);
}

export const api: Record<string, TinyApiHandler> = {
  // ---- company file ------------------------------------------------------

  /** First call the page makes: reopens the last company if it can. */
  'app.start': async () => {
    const store = await readStore();
    let reopenError: string | null = null;
    let locked = false;
    if (!hasCompany() && store.lastPath) {
      const r = await tryOpen(store.lastPath);
      if (!r.ok) {
        reopenError = r.message;
        locked = r.locked;
      }
    }
    if (hasCompany()) appRef.setTitle(`${companyInfo()!.name} — Tiny Tally`);
    return {
      company: companyInfo(),
      recent: (await readStore()).recent,
      lastPath: store.lastPath,
      reopenError,
      locked,
      internalDir: await internalDir(),
    };
  },

  'company.create': async ({ name, currency, fiscalYearStart, dir, taxEnabled, abn }: {
    name: string;
    currency: string;
    fiscalYearStart: number;
    /** null = store internally */
    dir: string | null;
    taxEnabled?: boolean;
    abn?: string;
  }) => {
    name = String(name ?? '').trim();
    if (!name) throw new Error('Give the company a name.');
    const folder = dir ?? (await internalDir());
    const path = folder.replace(/\/+$/, '') + '/' + fileNameFor(name);
    await createCompany(path, dir === null, { name, currency, fiscalYearStart: Number(fiscalYearStart) || 1, taxEnabled });
    if (abn) updateSettings({ abn });
    return afterOpen();
  },

  /** A sample Australian business with about 16 months of activity. */
  'company.createDemo': async ({ dir, today }: { dir: string | null; today: string }) => {
    const folder = dir ?? (await internalDir());
    let name = DEMO_NAME;
    for (let n = 2; await fileExists(folder + '/' + fileNameFor(name)); n++) name = `${DEMO_NAME} ${n}`;
    const path = folder.replace(/\/+$/, '') + '/' + fileNameFor(name);
    await createCompany(path, dir === null, { name, currency: 'AUD', fiscalYearStart: 7, taxEnabled: true });
    seedDemo(today);
    return afterOpen();
  },

  'company.open': async ({ path, force }: { path: string; force?: boolean }) => tryOpen(path, !!force),

  'company.close': async () => {
    closeCompany();
    const s = await readStore();
    await appRef.store.set(STORE_KEY, { ...s, lastPath: null });
    appRef.setTitle('Tiny Tally');
    return true;
  },

  'company.forget': async ({ path }: { path: string }) => {
    const s = await readStore();
    const recent = s.recent.filter((r) => r.path !== path);
    await appRef.store.set(STORE_KEY, { recent, lastPath: s.lastPath === path ? null : s.lastPath });
    return recent;
  },

  'company.backup': async ({ stamp }: { stamp?: string } = {}) => {
    const { path } = getCompany();
    const dir = path.slice(0, path.lastIndexOf('/')) + '/Backups';
    await tjs.makeDir(dir, { recursive: true });
    const base = path.slice(path.lastIndexOf('/') + 1).replace(new RegExp(`\\.${FILE_EXT}$`), '');
    // The page sends its local time (no Intl/time zones here); fall back to UTC.
    const when = /^[\d -]+$/.test(stamp ?? '') ? stamp! : new Date().toISOString().slice(0, 19).replace('T', ' ').replace(/:/g, '-');
    const dest = `${dir}/${base} ${when}.${FILE_EXT}`;
    backupCompany(dest);
    return dest;
  },

  // ---- settings ----------------------------------------------------------

  'settings.update': async (patch: Partial<CompanySettings>) => {
    updateSettings(patch ?? {});
    return afterOpen();
  },

  // ---- money accounts ----------------------------------------------------

  'accounts.list': async () => {
    const { db } = getCompany();
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
    const { db } = getCompany();
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
    run(getCompany().db, 'UPDATE accounts SET is_archived = ? WHERE id = ?', archived ? 1 : 0, id);
    return true;
  },

  // ---- categories --------------------------------------------------------

  'categories.list': async () => {
    const { db } = getCompany();
    return all(
      db,
      `SELECT c.id, c.name, c.kind, c.class AS class, c.is_archived AS archived, c.tax_code AS taxCode,
              (SELECT COUNT(*) FROM entries e WHERE e.category_id = c.id)
                + (SELECT COUNT(*) FROM invoice_lines l WHERE l.category_id = c.id) AS uses
       FROM categories c
       ORDER BY c.kind, c.is_archived, c.class <> 'pnl', c.name COLLATE NOCASE`,
    ).map((r: any) => ({ ...r, archived: !!r.archived }));
  },

  'categories.save': async ({ id, name, kind, taxCode, class: cls }: {
    id?: number;
    name: string;
    kind: 'income' | 'expense';
    taxCode?: TaxCode | null;
    class?: 'pnl' | 'tax' | 'owner' | 'loan' | 'asset';
  }) => {
    const klass = ['pnl', 'tax', 'owner', 'loan', 'asset'].includes(cls as string) ? cls! : 'pnl';
    // Tax payments, owner's money and loans never go on the BAS.
    const code = ['tax', 'owner', 'loan'].includes(klass) ? 'NTR' : isTaxCode(taxCode) ? taxCode : 'GST';
    name = String(blankToNull(name) ?? '').trim();
    if (!name) throw new Error('Give the category a name.');
    const { db } = getCompany();
    const clash = one(db, 'SELECT id FROM categories WHERE kind = ? AND name = ? COLLATE NOCASE AND id IS NOT ?',
      kind, name, id ?? null);
    if (clash) throw new Error(`There's already a${kind === 'income' ? 'n income' : 'n expense'} category called “${name}”.`);
    if (id) {
      run(db, 'UPDATE categories SET name = ?, kind = ?, tax_code = ?, class = ? WHERE id = ?', name, kind, code, klass, id);
      return id;
    }
    return one<{ id: number }>(db, 'INSERT INTO categories (name, kind, tax_code, class) VALUES (?, ?, ?, ?) RETURNING id',
      name, kind, code, klass)!.id;
  },

  'categories.archive': async ({ id, archived }: { id: number; archived: boolean }) => {
    run(getCompany().db, 'UPDATE categories SET is_archived = ? WHERE id = ?', archived ? 1 : 0, id);
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
  'invoices.suggestNumber': async ({ docType }: { docType?: DocType } = {}) => suggestNumber(docType),
  'invoices.convertQuote': async ({ id, today }: { id: number; today: string }) => convertQuote(id, today),
  'invoices.credit': async ({ id, today }: { id: number; today: string }) => creditInvoice(id, today),
  'invoices.applyCredit': async (p: Parameters<typeof applyCredit>[0]) => applyCredit(p),
  'invoices.removeAllocation': async ({ id }: { id: number }) => removeAllocation(id),
  'reports.agedPayables': async ({ asOf }: { asOf: string }) => agedBalances(asOf, 'bill'),
  'reports.statement': async (p: Parameters<typeof customerStatement>[0]) => customerStatement(p),

  'ledger.journal': async (p: { from?: string; to: string }) => journal(p),
  'ledger.trialBalance': async ({ asOf }: { asOf: string }) => trialBalance(asOf),
  'ledger.balanceSheet': async (p: { asOf: string; yearStart: string }) => balanceSheet(p),

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

  'rules.list': async () => listRules(),
  'rules.save': async (input: RuleInput) => saveRule(input),
  'rules.delete': async ({ id }: { id: number }) => deleteRule(id),
  'rules.match': async ({ items }: { items: { text: string; kind?: 'income' | 'expense' }[] }) => matchRules(Array.isArray(items) ? items : []),

  /** Small per-company preferences (saved CSV column mappings and the like). */
  'prefs.get': async ({ key }: { key: string }) => {
    const v = one<{ value: string }>(getCompany().db, 'SELECT value FROM meta WHERE key = ?', 'pref:' + String(key))?.value;
    return v === undefined ? null : JSON.parse(v);
  },
  'prefs.set': async ({ key, value }: { key: string; value: unknown }) => {
    run(getCompany().db, 'INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', 'pref:' + String(key), JSON.stringify(value ?? null));
    return true;
  },
  'invoices.recordPayment': async (p: Parameters<typeof recordPayment>[0]) => recordPayment(p),
  'invoices.deletePayment': async ({ entryId }: { entryId: number }) => deletePayment(entryId),

  'templates.list': async () => listTemplates(),
  'templates.save': async (t: TemplateInput) => saveTemplate(t),
  'templates.setDefault': async ({ id }: { id: number }) => setDefaultTemplate(id),
  'templates.delete': async ({ id }: { id: number }) => deleteTemplate(id),
  'templates.readLogo': async ({ path }: { path: string }) => readLogo(path),

  'reports.profitAndLoss': async (p: Parameters<typeof profitAndLoss>[0]) => profitAndLoss(p),
  'reports.bas': async (p: Parameters<typeof basReport>[0]) => basReport(p),
  'reports.agedReceivables': async ({ asOf }: { asOf: string }) => agedReceivables(asOf),
  'bas.list': async () => listBasReturns(),
  'bas.save': async (p: Parameters<typeof saveBasReturn>[0]) => {
    saveBasReturn(p);
    return companyInfo();
  },
  'bas.reopen': async ({ id }: { id: number }) => {
    reopenBasReturn(id);
    return companyInfo();
  },
  'bas.delete': async ({ id }: { id: number }) => deleteBasReturn(id),

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
  'contacts.save': async (input: ContactInput) => saveContact(input),
  'contacts.archive': async ({ id, archived }: { id: number; archived: boolean }) => archiveContact(id, archived),
} satisfies Record<string, TinyApiHandler>);

export function init(app: TinyApp) {
  appRef = app;
}

export function onWindowClosed() {
  closeCompany();
}
