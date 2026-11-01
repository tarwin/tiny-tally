// Typed front door to the backend (backend/main.ts). Keep names in sync.
import type { Country } from '../shared/countries';
import type { TaxCode } from '../shared/tax';
import type { TemplateLayout } from '../shared/templateLayout';

export type { TaxCode };
export type AccountKind = 'bank' | 'credit_card' | 'cash';
export type CategoryKind = 'income' | 'expense';
/** pnl = profit & loss; the rest are balance-sheet money kept off P&L. */
export type CategoryClass = 'pnl' | 'tax' | 'owner' | 'loan' | 'asset';
export type DocType = 'invoice' | 'bill' | 'quote' | 'credit';

export interface BooksSettings {
  /** The owner's legal name. Documents show a trading name instead. */
  name: string;
  /** Set when the books are made; can't change. */
  country: Country;
  /** From the country; can't change. */
  currency: string;
  /** 'MM-DD', day 1–28. */
  fiscalYearStart: string;
  taxEnabled: boolean;
  taxRatePpm: number;
  /** ABN, NZ GST number or EIN, per the country. */
  taxId: string;
  taxBasis: 'cash' | 'accrual';
  basFrequency: 'monthly' | 'quarterly' | 'annual';
  pricesIncludeTax: boolean;
  invoicePrefix: string;
  invoiceNext: number;
  billPrefix: string;
  billNext: number;
  quotePrefix: string;
  quoteNext: number;
  creditPrefix: string;
  creditNext: number;
  paymentTermsDays: number;
  color: string;
  logo: string;
  lockDate: string | null;
}

export interface Books extends BooksSettings {
  path: string;
  internal: boolean;
}

export interface RecentBooks {
  path: string;
  name: string;
  lastOpened: string;
  color?: string;
}

export interface StartState {
  books: Books | null;
  recent: RecentBooks[];
  lastPath: string | null;
  reopenError: string | null;
  locked: boolean;
  internalDir: string;
  /** Files opened with the app before the page was ready (main window only). */
  openFiles: string[];
}

export type OpenResult =
  | { ok: true; books: Books }
  | { ok: false; locked: boolean; message: string; elsewhere?: boolean };

export interface Account {
  id: number;
  name: string;
  kind: AccountKind;
  /** cents */
  openingBalance: number;
  openingDate: string;
  archived: boolean;
  /** cents */
  balance: number;
  /** Last statement date reconciled to. */
  reconciledTo: string | null;
}

export interface Category {
  id: number;
  name: string;
  kind: CategoryKind;
  class: CategoryClass;
  archived: boolean;
  uses: number;
  taxCode: TaxCode | null;
  /** US: the Schedule C line. */
  reportLine: string | null;
}

export type EntryKind = 'income' | 'expense' | 'transfer';
export type ContactKind = 'customer' | 'vendor';

export interface Entry {
  id: number;
  date: string;
  kind: EntryKind;
  /** cents, always positive */
  amount: number;
  /** cents; sign relative to the register's account (or income +, expense −) */
  signed: number;
  memo: string | null;
  accountId: number;
  accountName: string;
  toAccountId: number | null;
  toAccountName: string | null;
  categoryId: number | null;
  categoryName: string | null;
  contactId: number | null;
  contactName: string | null;
  taxCode: TaxCode | null;
  /** GST included in amount, cents */
  taxAmount: number;
  invoiceId: number | null;
  invoiceNumber: string | null;
  invoiceType: DocType | null;
  categoryClass: CategoryClass | null;
  recId: number | null;
  toRecId: number | null;
  scheduleId: number | null;
  /** register mode only */
  balance?: number;
}

export interface EntryInput {
  id?: number;
  date: string;
  kind: EntryKind;
  amount: number;
  accountId: number;
  toAccountId?: number | null;
  categoryId?: number | null;
  contactId?: number | null;
  memo?: string | null;
  taxCode?: TaxCode | null;
  taxAmount?: number | null;
}

export interface EntryQuery {
  accountId?: number;
  kind?: EntryKind;
  categoryId?: number;
  contactId?: number;
  from?: string;
  to?: string;
  q?: string;
  limit?: number;
  offset?: number;
}

export interface EntryList {
  rows: Entry[];
  total: number;
  /** cents in (income, or money into the account) */
  inflow: number;
  /** cents out */
  outflow: number;
}

export interface OtherMovement {
  id: number;
  name: string;
  class: CategoryClass;
  kind: CategoryKind;
  /** GST-inclusive cents */
  total: number;
  count: number;
  compare?: number;
}

export interface Summary {
  income: number;
  expense: number;
  byCategory: { id: number; name: string; kind: CategoryKind; total: number; count: number }[];
  other: OtherMovement[];
}

export interface Contact {
  id: number;
  kind: ContactKind;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
  archived: boolean;
  uses: number;
  received: number;
  paid: number;
  lastDate: string | null;
  /** Customers: the trading name to invoice them as (null = the default). */
  tradingNameId: number | null;
}

export type ContactInput = Pick<Contact, 'kind' | 'name'> &
  Partial<Pick<Contact, 'email' | 'phone' | 'address' | 'notes' | 'tradingNameId'>> & { id?: number };

export interface TradingName {
  id: number;
  name: string;
  logo: string | null;
  address: string | null;
  email: string | null;
  phone: string | null;
  paymentDetails: string | null;
  templateId: number | null;
  isDefault: boolean;
  isArchived: boolean;
  /** documents from it */
  uses: number;
}

export type TradingNameInput = Omit<TradingName, 'id' | 'isDefault' | 'isArchived' | 'uses'> & { id?: number };

/** Who a document is from, as printed on it (a snapshot once sent). */
export interface Sender {
  tradingNameId: number;
  name: string;
  address: string | null;
  email: string | null;
  phone: string | null;
  paymentDetails: string | null;
  logo: string | null;
}

export type InvoiceStatus =
  | 'draft' | 'awaiting' | 'partial' | 'overdue' | 'paid' | 'void'
  | 'open' | 'expired' | 'accepted';

export interface InvoiceRow {
  id: number;
  docType: DocType;
  number: string;
  contactId: number;
  contactName: string;
  contactEmail: string | null;
  issueDate: string;
  dueDate: string;
  rawStatus: 'draft' | 'sent' | 'void';
  status: InvoiceStatus;
  reference: string | null;
  sourceId: number | null;
  /** null on bills */
  tradingNameId: number | null;
  net: number;
  tax: number;
  total: number;
  paid: number;
  /** Credit notes used against an invoice, or how much of a credit note is used. */
  credited: number;
  balance: number;
}

export interface InvoiceLine {
  id?: number;
  description: string;
  qtyMilli: number;
  unitPrice: number;
  categoryId: number | null;
  categoryName?: string | null;
  taxCode: TaxCode | null;
  net?: number;
  tax?: number;
}

export interface InvoicePayment {
  id: number;
  date: string;
  amount: number;
  memo: string | null;
  accountId: number;
  accountName: string;
}

export interface Invoice extends InvoiceRow {
  notes: string | null;
  templateId: number | null;
  pricesIncludeTax: boolean;
  sentAt: string | null;
  contactAddress: string | null;
  contactPhone: string | null;
  lines: (InvoiceLine & { net: number; tax: number })[];
  payments: InvoicePayment[];
  allocations: { id: number; date: string; amount: number; docId: number; number: string }[];
  derived: { id: number; docType: DocType; number: string; rawStatus: 'draft' | 'sent' | 'void'; total: number }[];
  sourceNumber: string | null;
  sourceType: DocType | null;
  scheduleId: number | null;
  /** null on bills */
  sender: Sender | null;
}

export interface InvoiceInput {
  id?: number;
  docType?: DocType;
  sourceId?: number | null;
  number?: string | null;
  contactId: number;
  issueDate: string;
  dueDate: string;
  reference?: string | null;
  notes?: string | null;
  templateId?: number | null;
  tradingNameId?: number | null;
  pricesIncludeTax: boolean;
  lines: InvoiceLine[];
  status?: 'draft' | 'sent';
}

export interface InvoiceList {
  rows: InvoiceRow[];
  summary: { outstanding: number; overdue: number; overdueCount: number; drafts: number; open: number; openValue: number };
}

export type TemplateStyle = 'classic' | 'modern' | 'minimal';

export interface InvoiceTemplate {
  id: number;
  name: string;
  style: TemplateStyle;
  accent: string;
  logo: string | null;
  title: string;
  footer: string | null;
  showTaxColumn: boolean;
  layout: TemplateLayout;
  isDefault: boolean;
  uses: number;
}

export type TemplateInput = Omit<InvoiceTemplate, 'id' | 'isDefault' | 'uses'> & { id?: number };

export type Basis = 'cash' | 'accrual';

export interface PnlRow {
  id: number;
  name: string;
  total: number;
  compare: number;
}

export interface ProfitAndLoss {
  other: OtherMovement[];
  income: PnlRow[];
  expense: PnlRow[];
  totals: { income: number; expense: number; net: number; compareIncome: number; compareExpense: number; compareNet: number };
}

export interface BasFigures {
  G1: number;
  G2: number;
  G3: number;
  G4: number;
  G10: number;
  G11: number;
  '1A': number;
  '1B': number;
}

export interface BasDetailRow {
  entryId: number | null;
  invoiceId: number | null;
  date: string;
  kind: 'income' | 'expense';
  gross: number;
  tax: number;
  taxCode: TaxCode;
  memo: string | null;
  categoryName: string | null;
  contactName: string | null;
  labels: string[];
}

export interface BasReport {
  figures: BasFigures;
  detail: BasDetailRow[];
  untagged: number;
}

export interface SalesTaxReport {
  totals: { taxableSales: number; nonTaxableSales: number; totalSales: number; taxCollected: number };
  detail: Omit<BasDetailRow, 'kind' | 'labels'>[];
  untagged: number;
}

export interface ScheduleCRow {
  line: string;
  label: string;
  kind: 'income' | 'expense';
  total: number;
  /** After the 50% limit on meals; the total elsewhere. */
  deductible: number;
  categories: { id: number; name: string; total: number }[];
}

export interface ScheduleCReport {
  lines: ScheduleCRow[];
  /** Categories with no Schedule C line (left out of the totals). */
  unmapped: { id: number; name: string; kind: 'income' | 'expense'; total: number }[];
  totals: { grossIncome: number; totalExpenses: number; netProfit: number };
}

export interface BasReturn {
  id: number;
  periodStart: string;
  periodEnd: string;
  basis: Basis;
  figures: BasFigures;
  w1: number;
  w2: number;
  t7: number;
  status: 'draft' | 'lodged';
  lodgedAt: string | null;
}

export interface AgedContact {
  contactId: number;
  contactName: string;
  current: number;
  d30: number;
  d60: number;
  d90: number;
  older: number;
  total: number;
  invoices: { id: number; docType: DocType; number: string; issueDate: string; dueDate: string; balance: number; daysOverdue: number }[];
}

export interface StatementLine {
  date: string;
  type: 'invoice' | 'credit' | 'payment' | 'refund' | 'bill';
  docId: number;
  ref: string;
  /** A bill's supplier invoice number. */
  theirRef: string | null;
  dueDate: string | null;
  /** + owes more, − owes less (for suppliers: + we owe more) */
  amount: number;
  balance: number;
}

export interface Statement {
  side: 'customer' | 'supplier';
  /** The trading name it's from (customers); a supplier statement still has one for the header. */
  sender: Sender | null;
  tradingNameId: number | null;
  /** Every trading name the customer has documents under. */
  tradingNames: { id: number; name: string }[];
  contact: { id: number; name: string; email: string | null; address: string | null };
  from: string;
  to: string;
  opening: number;
  closing: number;
  lines: StatementLine[];
  aging: { current: number; d30: number; d60: number; d90: number; older: number };
  open: AgedContact['invoices'];
}

export interface Remittance {
  sender: Sender | null;
  date: string;
  accountName: string;
  contact: { id: number; name: string; email: string | null; address: string | null };
  items: {
    entryId: number;
    billId: number;
    number: string;
    /** the supplier's invoice number */
    reference: string | null;
    issueDate: string;
    dueDate: string;
    total: number;
    paid: number;
    /** still owing on the bill after this payment */
    remaining: number;
    memo: string | null;
  }[];
  total: number;
}

export interface ReconcileRow {
  id: number;
  date: string;
  kind: EntryKind;
  amount: number;
  memo: string | null;
  signed: number;
  ticked: boolean;
  categoryName: string | null;
  contactName: string | null;
  invoiceNumber: string | null;
  otherAccount: string | null;
}

export interface ReconcileState {
  account: { id: number; name: string; kind: AccountKind; openingBalance: number; openingDate: string };
  start: { date: string | null; balance: number };
  open: { id: number; statementDate: string; statementBalance: number; cleared: number; difference: number } | null;
  rows: ReconcileRow[];
  history: { id: number; statementDate: string; statementBalance: number; completedAt: string; count: number }[];
}

export type Frequency = 'weekly' | 'fortnightly' | 'monthly' | 'quarterly' | 'yearly';
export type ScheduleKind = 'entry' | 'invoice' | 'bill';

export interface Schedule {
  id: number;
  kind: ScheduleKind;
  name: string;
  payload: any;
  frequency: Frequency;
  startDate: string;
  nextDate: string;
  endDate: string | null;
  occurrences: number;
  autoApprove: boolean;
  active: boolean;
  lastCreated: string | null;
  finished: boolean;
}

export interface ScheduleInput {
  id?: number;
  kind: ScheduleKind;
  name: string;
  payload: any;
  frequency: Frequency;
  startDate: string;
  endDate?: string | null;
  autoApprove?: boolean;
  active?: boolean;
}

export interface ScheduleRun {
  created: { scheduleId: number; name: string; type: string; id: number; date: string }[];
  failed: { scheduleId: number; name: string; date: string; message: string }[];
}

export type LedgerType = 'asset' | 'liability' | 'equity' | 'income' | 'expense';
export interface LedgerAccount {
  key: string;
  name: string;
  type: LedgerType;
  group: string;
}
export interface JournalLine {
  date: string;
  ref: string;
  memo: string;
  account: string;
  /** debit positive, credit negative */
  amount: number;
}
export interface BalanceSection {
  group: string;
  items: { name: string; key: string; amount: number }[];
  total: number;
}
export interface BalanceSheet {
  assets: BalanceSection[];
  liabilities: BalanceSection[];
  equity: BalanceSection[];
  totals: { assets: number; liabilities: number; equity: number };
}
export interface TrialBalance {
  rows: (LedgerAccount & { debit: number; credit: number })[];
  debit: number;
  credit: number;
}

export interface JournalEntryLine {
  /** 'cat:<id>' or a ledger account key (gst, opening, accruals, prepayments, accumdep) */
  account: string;
  /** cents; debit positive, credit negative */
  amount: number;
  memo: string | null;
}

export interface JournalEntry {
  id: number;
  date: string;
  reference: string | null;
  memo: string | null;
  lines: JournalEntryLine[];
}

export interface JournalEntryRow {
  id: number;
  date: string;
  reference: string | null;
  memo: string | null;
  /** total of the debits, cents */
  total: number;
  lineCount: number;
}

export interface JournalAccount extends LedgerAccount {
  archived: boolean;
}

export interface ChangeBatch {
  id: number;
  /** ISO instant, UTC */
  at: string;
  /** the backend call that made it, e.g. 'entries.save' */
  action: string;
  host: string | null;
  /** JSON with extra detail for some actions (archive markers, new books) */
  summary: string | null;
  count: number;
}

export interface Change {
  id: number;
  at: string;
  tableName: string;
  rowId: number | null;
  /** settings rows are keyed by name */
  rowKey: string | null;
  action: 'insert' | 'update' | 'delete';
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  batchId?: number;
  batchAction?: string;
  host?: string | null;
}

export interface Rule {
  id: number;
  pattern: string;
  kind: CategoryKind;
  categoryId: number;
  categoryName: string;
  contactId: number | null;
  contactName: string | null;
}

export interface RuleMatch {
  ruleId: number;
  pattern: string;
  categoryId: number;
  kind: CategoryKind;
  contactId: number | null;
}

export type { ImportBatch, ImportPlan, ImportResult, ImportTarget } from '../shared/import';
import type { ImportPlan, ImportResult } from '../shared/import';

function call<T>(method: string, params?: unknown): Promise<T> {
  return tiny.api.call(method, params);
}

export const api = {
  /** Text files come back as text; Excel files (zips) as base64 bytes. */
  readImportFile: (path: string) => call<{ name: string; text: string; base64?: string }>('import.read', { path }),
  suggestCategories: (names: string[]) =>
    call<Record<string, { categoryId: number; kind: 'income' | 'expense' }>>('import.suggest', { names }),
  commitImport: (plan: ImportPlan) => call<ImportResult>('import.commit', plan),
  start: () => call<StartState>('app.start'),
  createBooks: (p: { name: string; tradingName?: string; country: Country; fiscalYearStart: string; dir: string | null; taxEnabled?: boolean; taxRatePpm?: number; taxId?: string }) =>
    call<Books>('books.create', p),
  createDemo: (dir: string | null, today: string) => call<Books>('books.createDemo', { dir, today }),
  openBooks: (path: string, force = false) => call<OpenResult>('books.open', { path, force }),
  openInNewWindow: (path: string) => call<{ focused: boolean }>('books.openInNewWindow', { path }),
  windowHidden: () => call<boolean>('app.windowHidden'),
  newWindow: () => call<true>('app.newWindow'),
  settingsChanged: () => call<true>('app.settingsChanged'),
  claimDrop: (paths: string[], over: boolean, focused: boolean) => call<true>('drop.claim', { paths, over, focused }),
  closeBooks: () => call<true>('books.close'),
  forgetBooks: (path: string) => call<RecentBooks[]>('books.forget', { path }),
  backupBooks: (stamp: string) => call<string>('books.backup', { stamp }),
  updateSettings: (p: Partial<BooksSettings>) => call<Books>('settings.update', p),

  listAccounts: () => call<Account[]>('accounts.list'),
  saveAccount: (p: Omit<Account, 'id' | 'archived' | 'balance' | 'reconciledTo'> & { id?: number }) =>
    call<number>('accounts.save', p),
  archiveAccount: (id: number, archived: boolean) => call<true>('accounts.archive', { id, archived }),

  listCategories: () => call<Category[]>('categories.list'),
  saveCategory: (p: { id?: number; name: string; kind: CategoryKind; taxCode?: TaxCode | null; class?: CategoryClass; reportLine?: string | null }) =>
    call<number>('categories.save', p),
  archiveCategory: (id: number, archived: boolean) => call<true>('categories.archive', { id, archived }),

  listEntries: (q: EntryQuery = {}) => call<EntryList>('entries.list', q),
  saveEntry: (p: EntryInput) => call<number>('entries.save', p),
  deleteEntry: (id: number) => call<true>('entries.delete', { id }),
  summary: (from: string, to: string, basis?: Basis) => call<Summary>('entries.summary', { from, to, basis }),

  listContacts: () => call<Contact[]>('contacts.list'),
  saveContact: (p: ContactInput) => call<number>('contacts.save', p),
  archiveContact: (id: number, archived: boolean) => call<true>('contacts.archive', { id, archived }),

  listInvoices: (q: { docType?: DocType; status?: InvoiceStatus | 'unpaid'; contactId?: number; q?: string; from?: string; to?: string } = {}) =>
    call<InvoiceList>('invoices.list', q),
  getInvoice: (id: number) => call<Invoice>('invoices.get', { id }),
  saveInvoice: (p: InvoiceInput) => call<number>('invoices.save', p),
  setInvoiceStatus: (id: number, status: 'draft' | 'sent' | 'void') => call<true>('invoices.setStatus', { id, status }),
  deleteInvoice: (id: number) => call<true>('invoices.delete', { id }),
  duplicateInvoice: (id: number, today: string) => call<number>('invoices.duplicate', { id, today }),
  suggestInvoiceNumber: (docType: DocType = 'invoice') => call<string>('invoices.suggestNumber', { docType }),
  convertQuote: (id: number, today: string) => call<number>('invoices.convertQuote', { id, today }),
  creditInvoice: (id: number, today: string) => call<number>('invoices.credit', { id, today }),
  applyCredit: (p: { creditId: number; invoiceId: number; amount: number; date: string }) => call<number>('invoices.applyCredit', p),
  removeAllocation: (id: number) => call<true>('invoices.removeAllocation', { id }),
  recordPayment: (p: { invoiceId: number; date: string; amount: number; accountId: number; memo?: string | null }) =>
    call<number>('invoices.recordPayment', p),
  deletePayment: (entryId: number) => call<true>('invoices.deletePayment', { entryId }),

  listTradingNames: () => call<TradingName[]>('tradingNames.list'),
  saveTradingName: (t: TradingNameInput) => call<number>('tradingNames.save', t),
  setDefaultTradingName: (id: number) => call<true>('tradingNames.setDefault', { id }),
  archiveTradingName: (id: number, archived: boolean) => call<true>('tradingNames.archive', { id, archived }),
  deleteTradingName: (id: number) => call<true>('tradingNames.delete', { id }),
  listTemplates: () => call<InvoiceTemplate[]>('templates.list'),
  saveTemplate: (t: TemplateInput) => call<number>('templates.save', t),
  setDefaultTemplate: (id: number) => call<true>('templates.setDefault', { id }),
  deleteTemplate: (id: number) => call<true>('templates.delete', { id }),
  readLogo: (path: string) => call<string>('templates.readLogo', { path }),

  profitAndLoss: (p: { from: string; to: string; basis: Basis; compareFrom?: string; compareTo?: string }) =>
    call<ProfitAndLoss>('reports.profitAndLoss', p),
  basReport: (p: { from: string; to: string; basis: Basis }) => call<BasReport>('reports.bas', p),
  salesTaxReport: (p: { from: string; to: string; basis: Basis }) => call<SalesTaxReport>('reports.salesTax', p),
  scheduleCReport: (p: { from: string; to: string; basis: Basis }) => call<ScheduleCReport>('reports.scheduleC', p),
  agedReceivables: (asOf: string) => call<AgedContact[]>('reports.agedReceivables', { asOf }),
  agedPayables: (asOf: string) => call<AgedContact[]>('reports.agedPayables', { asOf }),
  statement: (p: { contactId: number; from: string; to: string; tradingNameId?: number | null }) => call<Statement>('reports.statement', p),
  remittance: (entryId: number) => call<Remittance>('bills.remittance', { entryId }),

  reconcileState: (accountId: number) => call<ReconcileState>('reconcile.state', { accountId }),
  startReconcile: (p: { accountId: number; statementDate: string; statementBalance: number }) => call<number>('reconcile.start', p),
  tick: (recId: number, entryIds: number[], cleared: boolean) => call<true>('reconcile.tick', { recId, entryIds, cleared }),
  finishReconcile: (id: number) => call<true>('reconcile.finish', { id }),
  cancelReconcile: (id: number) => call<true>('reconcile.cancel', { id }),
  undoReconcile: (id: number) => call<true>('reconcile.undo', { id }),

  listSchedules: () => call<Schedule[]>('schedules.list'),
  getSchedule: (id: number) => call<Schedule>('schedules.get', { id }),
  saveSchedule: (s: ScheduleInput) => call<number>('schedules.save', s),
  deleteSchedule: (id: number) => call<true>('schedules.delete', { id }),
  skipSchedule: (id: number) => call<Schedule>('schedules.skip', { id }),
  runSchedules: (today: string) => call<ScheduleRun>('schedules.run', { today }),

  listRules: () => call<Rule[]>('rules.list'),
  saveRule: (r: { id?: number; pattern: string; kind?: CategoryKind | null; categoryId: number; contactId?: number | null }) =>
    call<number>('rules.save', r),
  deleteRule: (id: number) => call<true>('rules.delete', { id }),
  matchRules: (items: { text: string; kind?: CategoryKind }[]) => call<(RuleMatch | null)[]>('rules.match', { items }),

  journal: (p: { from?: string; to: string }) => call<{ accounts: LedgerAccount[]; lines: JournalLine[] }>('ledger.journal', p),
  trialBalance: (asOf: string) => call<TrialBalance>('ledger.trialBalance', { asOf }),
  balanceSheet: (asOf: string, yearStart: string) => call<BalanceSheet>('ledger.balanceSheet', { asOf, yearStart }),

  listJournals: (q: { from?: string; to?: string } = {}) => call<JournalEntryRow[]>('journals.list', q),
  getJournal: (id: number) => call<JournalEntry>('journals.get', { id }),
  saveJournal: (j: Omit<JournalEntry, 'id'> & { id?: number }) => call<number>('journals.save', j),
  deleteJournal: (id: number) => call<true>('journals.delete', { id }),
  journalAccounts: () => call<JournalAccount[]>('journals.accounts'),

  changeBatches: (p: { limit?: number; offset?: number; from?: string; to?: string; archive?: string | null } = {}) =>
    call<{ rows: ChangeBatch[]; total: number; oldest: string | null }>('changes.batches', p),
  batchChanges: (batchId: number, archive?: string | null) => call<Change[]>('changes.batch', { batchId, archive }),
  rowHistory: (table: string, id: number) => call<Change[]>('changes.row', { table, id }),
  archiveHistory: (before: string, beforeAt: string) => call<{ file: string; changes: number }>('changes.archive', { before, beforeAt }),

  getPref: <T>(key: string) => call<T | null>('prefs.get', { key }),
  setPref: (key: string, value: unknown) => call<true>('prefs.set', { key, value }),
  listBasReturns: () => call<BasReturn[]>('bas.list'),
  saveBasReturn: (p: { periodStart: string; periodEnd: string; basis: Basis; w1: number; w2: number; t7: number; lodge?: boolean }) =>
    call<Books>('bas.save', p),
  reopenBasReturn: (id: number) => call<Books>('bas.reopen', { id }),
  deleteBasReturn: (id: number) => call<true>('bas.delete', { id }),

  writeText: (path: string, text: string) => call<string>('file.writeText', { path, text }),
};

/** Backend errors arrive as rejected promises; pull out something readable. */
export function errorMessage(e: unknown) {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  return 'Something went wrong.';
}
