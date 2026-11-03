// Typed front door to the backend (backend/main.ts). Keep names in sync.
import type { Country, TaxFrequency } from '../shared/countries';
import type { Adjustment, AdjustmentContext, ReturnFigures, ReturnInputs, ReturnKind, RuleStatus } from '../shared/taxReturns';
import type { TaxCode } from '../shared/tax';
import type { TemplateLayout } from '../shared/templateLayout';
import type { CurrencyDisplay } from './money';

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
  /** Australia: lodges the BAS online themselves (two more weeks for quarters 1, 3 and 4). */
  basOnline: boolean;
  fiscalYearStart: string;
  taxEnabled: boolean;
  taxRatePpm: number;
  /** ABN, NZ GST number or EIN, per the country. */
  taxId: string;
  taxBasis: 'cash' | 'accrual';
  /** How often tax returns are filed. */
  taxPeriod: TaxFrequency;
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
  currencyDisplay: CurrencyDisplay;
  documentCurrencyDisplay: CurrencyDisplay;
  color: string;
  logo: string;
  lockDate: string | null;
  /** US: the business's state ('NY'), or ''. */
  homeState: string;
  /** US: what the books' own sales tax rate is called. */
  taxRateName: string;
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
  /** A window opened on another window's books: the page to start on. */
  route: string | null;
  /** Started for the screenshot tour (scripts/screenshots.sh). */
  tour: boolean;
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
  /** Holds tax, not money: tax clients withheld (NZ), or no-ABN withholding owed to the ATO (AU). Not counted as cash. */
  holds: 'client-wht' | 'no-abn' | null;
}

export interface Category {
  id: number;
  name: string;
  kind: CategoryKind;
  class: CategoryClass;
  archived: boolean;
  uses: number;
  taxCode: TaxCode | null;
  /** US: the Schedule C key (scheduleC.ts), numbered per tax year. */
  reportLine: string | null;
  /** The tax return line was guessed when the books were upgraded: worth a check. */
  lineGuessed?: boolean;
  /** A sub-category's parent. */
  parentId: number | null;
  /** "Parent › Name" for a sub-category, else the name. */
  path: string;
}

export type EntryKind = 'income' | 'expense' | 'transfer';
export type ContactKind = 'customer' | 'vendor';

export interface Entry {
  id: number;
  /** When it was last saved (refuses saves over a change made since). */
  updatedAt: string;
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
  /** US sales: the sales tax rate (null = the books' own). */
  taxRateId: number | null;
  invoiceId: number | null;
  invoiceNumber: string | null;
  invoiceType: DocType | null;
  categoryClass: CategoryClass | null;
  recId: number | null;
  toRecId: number | null;
  scheduleId: number | null;
  /** How many files are attached (receipts). */
  attachments: number;
  /** register mode only */
  balance?: number;
}

export interface EntryInput {
  id?: number;
  /** The updatedAt it was loaded with, when editing. */
  updatedAt?: string;
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
  taxRateId?: number | null;
}

export interface EntryQuery {
  accountId?: number;
  kind?: EntryKind;
  categoryId?: number;
  contactId?: number;
  from?: string;
  to?: string;
  q?: string;
  /** cents: exactly this amount */
  amount?: number;
  limit?: number;
  offset?: number;
}

/** What the top bar's search box finds in the books (search.ts). */
export interface SearchResults {
  entries: Entry[];
  documents: { id: number; number: string; docType: DocType; date: string; status: 'draft' | 'sent' | 'void'; total: number; contactName: string }[];
  contacts: { id: number; kind: 'customer' | 'vendor'; name: string; email: string | null }[];
  accounts: { id: number; name: string; kind: AccountKind }[];
  categories: { id: number; name: string; kind: CategoryKind }[];
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
  /** US: the state they're in ('NY'), for sales tax nexus. */
  state: string | null;
  /** US customers: the sales tax rate their invoices start with (null = the books' own). */
  taxRateId: number | null;
  /** US customers: resale or exemption certificate; null when they pay sales tax. */
  taxExempt: string | null;
  /** US vendors: gets a Form 1099-NEC. */
  is1099: boolean;
  legalName: string | null;
  /** SSN or EIN from their W-9. */
  tin: string | null;
  /** NZ customers: tax they withhold from payments, ppm. */
  whtRatePpm: number | null;
}

export type ContactInput = Pick<Contact, 'kind' | 'name'> &
  Partial<Pick<Contact, 'email' | 'phone' | 'address' | 'notes' | 'tradingNameId' | 'state' | 'taxRateId' | 'taxExempt' | 'is1099' | 'legalName' | 'tin' | 'whtRatePpm'>> & { id?: number };

export interface TaxRate {
  id: number;
  name: string;
  state: string | null;
  ratePpm: number;
  archived: boolean;
  uses: number;
}

export interface Trip {
  id: number;
  date: string;
  /** Tenths of a mile (US) or km. */
  distanceTenths: number;
  purpose: string;
  fromPlace: string | null;
  toPlace: string | null;
  vehicle: string | null;
  /** The rate for the day, tenths of a cent a mile or km (NZ: the Tier 1 rate). */
  rate: number;
  /** The trip at that rate. */
  value: number;
}

export type TripInput = Pick<Trip, 'date' | 'distanceTenths' | 'purpose'> & Partial<Pick<Trip, 'fromPlace' | 'toPlace' | 'vehicle'>> & { id?: number };

export interface TripList {
  unit: 'mi' | 'km';
  trips: Trip[];
  distanceTenths: number;
  value: number;
  vehicles: string[];
}

export type Fuel = 'petrol' | 'diesel' | 'hybrid' | 'electric';

/** What's typed in once an income year (backend/taxYear.ts). */
export interface YearInputs {
  vehicleMethod?: 'rate' | 'actual';
  vehicleTotalTenths?: number;
  vehicleBusinessPct?: number;
  vehicleFuel?: Fuel;
  vehicles?: Record<string, { totalTenths?: number; businessPct?: number; fuel?: Fuel }>;
  homeOfficeSqFt?: number;
  homeOfficeHours?: number;
  homeOfficeArea?: number;
  homeArea?: number;
  premisesCosts?: number;
  incomeTaxPct?: number;
  priorYearTax?: number;
  twoYearsAgoTax?: number;
  priorYearHighIncome?: boolean;
  wages?: number;
  provisionalMethod?: 'standard' | 'estimation';
  estimate?: number;
  paygOption?: 'amount' | 'rate';
  paygRatePct?: number;
  paygAmount?: number;
}
/** @deprecated the old name */
export type UsYearInputs = YearInputs;

export interface CarClaim {
  /** What the logged distance is worth at the rate (after Australia's 5,000 km cap). */
  deduction: number;
  /** The distance the rate was paid on, tenths. */
  claimedTenths: number;
  /** Australia: over the 5,000 km cap. */
  capped: boolean;
  /** NZ: the split between the tiers. */
  tier1Tenths?: number;
  tier2Tenths?: number;
  rates: { label: string; tenthsOfCent: number }[];
  status: RuleStatus;
  checked: string;
}

export interface VehicleYear {
  /** The name on its trips; '' for trips with none. */
  name: string;
  trips: number;
  distanceTenths: number;
  claim: CarClaim;
  inputs: { totalTenths?: number; businessPct?: number; fuel?: Fuel };
  loggedPct: number | null;
  businessPct: number | null;
}

export interface CarYear {
  year: number;
  from: string;
  to: string;
  unit: 'mi' | 'km';
  trips: Trip[];
  distanceTenths: number;
  claim: CarClaim;
  method: 'rate' | 'actual';
  businessPct: number | null;
  loggedPct: number | null;
  inputs: YearInputs;
  vehicles: VehicleYear[];
}

export interface Nec1099Payee {
  id: number;
  name: string;
  legalName: string | null;
  tin: string | null;
  address: string | null;
  state: string | null;
  email: string | null;
  paid: number;
  byCard: number;
  payments: number;
  needsForm: boolean;
  missing: string[];
}

export interface Nec1099Report {
  year: number;
  threshold: number;
  due: string;
  status: RuleStatus;
  checked: string;
  payer: { name: string; tin: string };
  payees: Nec1099Payee[];
  suggested: { id: number; name: string; paid: number; forServices: number }[];
}

export interface EstimatedTaxInstallment {
  number: number;
  due: string;
  cumulativeTarget: number;
  paidByDue: number;
  short: number;
  state: 'paid' | 'upcoming' | 'overdue';
}

export interface EstimatedTaxReport {
  year: number;
  status: RuleStatus;
  checked: string;
  through: string;
  projected: boolean;
  profitSoFar: number;
  profit: number;
  selfEmployment: { netEarnings: number; tax: number; halfDeduction: number; wageBase: number };
  incomeTaxPct: number;
  incomeTax: number;
  projectedTax: number;
  safeHarbor: number | null;
  target: number;
  inputs: UsYearInputs;
  payments: { id: number; date: string; amount: number; memo: string | null }[];
  totalPaid: number;
  hasCategory: boolean;
  installments: EstimatedTaxInstallment[];
  next: EstimatedTaxInstallment | null;
}

// ---- Australia and New Zealand ----------------------------------------------------

export interface IncomeReturnLine {
  key: string;
  code: string;
  label: string;
  kind: 'income' | 'expense';
  costOfSales: boolean;
  total: number;
  categories: { id: number; name: string; total: number }[];
  notes: string[];
}

export interface IncomeReturnReport {
  country: 'AU' | 'NZ';
  title: string;
  source: string;
  checked: string;
  year: number;
  lines: IncomeReturnLine[];
  unmapped: { id: number; name: string; kind: 'income' | 'expense'; total: number }[];
  stock: { opening: number; closing: number; openingDate: string; purchases: number; costOfSales: number };
  car: { method: 'rate' | 'actual'; distanceTenths: number; claim: CarClaim; businessPct: number | null; costs: number; notDeducted: { id: number; name: string; total: number }[]; total: number };
  homeOffice: number;
  totals: { income: number; costOfSales: number; grossProfit: number; expenses: number; net: number };
}

export interface TparPayee {
  id: number;
  name: string;
  legalName: string | null;
  abn: string | null;
  address: string | null;
  email: string | null;
  phone: string | null;
  gross: number;
  gst: number;
  /** No-ABN tax withheld. */
  withheld: number;
  payments: number;
  missing: string[];
}

export interface TparReport {
  year: number;
  from: string;
  to: string;
  due: string;
  payer: { name: string; abn: string };
  payees: TparPayee[];
  totals: { gross: number; gst: number; withheld: number };
}

export interface Instalment {
  number: number;
  due: string;
  amount: number;
  cumulativeTarget: number;
  paidByDue: number;
  short: number;
  state: 'paid' | 'upcoming' | 'overdue';
}

interface InstalmentYear {
  year: number;
  from: string;
  to: string;
  status: RuleStatus;
  checked: string;
  inputs: YearInputs;
  through: string;
  projected: boolean;
  incomeSoFar: number;
  profitSoFar: number;
  income: number;
  profit: number;
  payments: { id: number; date: string; amount: number; memo: string | null }[];
  totalPaid: number;
  hasCategory: boolean;
  installments: Instalment[];
  next: Instalment | null;
}

export interface PaygReport extends InstalmentYear {
  option: 'amount' | 'rate';
  quarters: { from: string; to: string; income: number; amount: number; due: string }[];
  total: number;
  estimatedTax: number;
}

export interface ProvisionalReport extends InstalmentYear {
  method: 'standard' | 'estimation';
  basis: 'last-year' | 'two-years' | 'estimate' | 'none';
  threshold: number;
  incomeTax: number;
  withheld: { total: number; byClient: { id: number; name: string; amount: number }[] };
  residual: number;
  provisional: number;
  terminalDue: string;
}

export interface GstThreshold {
  registered: boolean;
  threshold: number;
  from: string;
  to: string;
  turnover: number;
  projected: number;
  share: number;
  level: 'over' | 'near' | 'under';
}

export interface AssetBought {
  entryId: number | null;
  invoiceId: number | null;
  date: string;
  category: string;
  contact: string | null;
  memo: string | null;
  gross: number;
  tax: number;
  cost: number;
  writeOff: boolean;
}

export type DepreciationMethod = 'writeoff' | 'pool' | 'dv' | 'pc' | 'sl' | 'expense' | 'macrs5' | 'macrs7';

export interface Asset {
  id: number;
  name: string;
  bought: string;
  cost: number;
  businessPct: number;
  method: DepreciationMethod;
  lifeYears: number | null;
  ratePct: number | null;
  openingYear: number | null;
  openingValue: number | null;
  sold: string | null;
  proceeds: number | null;
  categoryId: number | null;
  categoryName: string | null;
  expensed: boolean;
  entryId: number | null;
  saleEntryId: number | null;
  notes: string | null;
}

export interface AssetYearRow {
  id: number;
  name: string;
  method: DepreciationMethod;
  opening: number;
  depreciation: number;
  claimed: number;
  closing: number;
  disposal: null | { date: string; proceeds: number; value: number; adjustment: number; claimed: number };
  isNew: boolean;
  asset: Asset;
}

export interface AssetRegister {
  year: number;
  from: string;
  to: string;
  country: 'AU' | 'NZ' | 'US';
  limit: number;
  rows: AssetYearRow[];
  others: Asset[];
  totals: { depreciation: number; claimed: number; closing: number; adjustment: number };
  journal: null | { id: number; upToDate: boolean };
  journalLines: number;
  unposted: number[];
  purchases: { entryId: number; date: string; amount: number; tax: number; cost: number; memo: string | null; categoryId: number; category: string; contact: string | null }[];
}

export interface Deadline {
  key: string;
  title: string;
  due: string;
  amount?: number;
  route: string;
}

export interface NexusState {
  code: string;
  name: string;
  sales: number;
  transactions: number | null;
  both: boolean;
  measured: string;
  source: string;
  note?: string;
  thisYear: { sales: number; transactions: number };
  lastYear: { sales: number; transactions: number };
  share: number;
  level: 'home' | 'none' | 'over' | 'near' | 'under';
}

export interface NexusReport {
  year: number;
  home: string;
  states: NexusState[];
  unknown: { sales: number; transactions: number };
  customersWithoutState: number;
}

export interface TradingName {
  id: number;
  name: string;
  logo: string | null;
  address: string | null;
  email: string | null;
  phone: string | null;
  paymentDetails: string | null;
  templateId: number | null;
  /** Its own numbering per type: a prefix, or null to share the books' numbering. */
  invoicePrefix: string | null;
  invoiceNext: number;
  quotePrefix: string | null;
  quoteNext: number;
  creditPrefix: string | null;
  creditNext: number;
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
  /** When it was last saved (refuses saves over a change made since). */
  updatedAt: string;
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
  /** US sales: the rate it was worked out at (id null = the books' own). */
  taxRateId: number | null;
  taxRatePpm: number | null;
  taxRateName: string | null;
  contactTaxExempt: string | null;
  /** NZ: the customer withholds tax from payments at this rate, ppm. */
  contactWhtRatePpm?: number | null;
  /** The contact's TIN or ABN, and whether their payments are reported (1099 / TPAR). */
  contactTin?: string | null;
  contactReportable?: number | boolean;
}

export interface InvoiceInput {
  id?: number;
  /** The updatedAt it was loaded with, when editing. */
  updatedAt?: string;
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
  taxRateId?: number | null;
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
  /** When asked for: the budget for the period. */
  budget?: number;
  /** Sub-categories; the row's figures include them. */
  children?: PnlRow[];
}

export interface Budget {
  /** Twelve 'YYYY-MM' months. */
  months: string[];
  rows: { categoryId: number; amounts: number[] }[];
}

export interface ProfitAndLoss {
  other: OtherMovement[];
  income: PnlRow[];
  expense: PnlRow[];
  totals: {
    income: number;
    expense: number;
    net: number;
    compareIncome: number;
    compareExpense: number;
    compareNet: number;
    budgetIncome?: number;
    budgetExpense?: number;
    budgetNet?: number;
  };
}

export interface CashFlowSection {
  lines: { label: string; amount: number }[];
  total: number;
}

export interface CashFlow {
  operating: CashFlowSection;
  investing: CashFlowSection;
  financing: CashFlowSection;
  net: number;
  /** Cash on the day before the period. */
  opening: number;
  /** Opening balances of accounts first tracked during the period. */
  started: number;
  closing: number;
}

export interface ByContact {
  /** id 0 gathers transactions with no contact */
  rows: { id: number; name: string; total: number; count: number; compare: number }[];
  total: number;
  compareTotal: number;
}

/** A transaction behind a tax return's figures. */
export interface TaxReturnDetailRow {
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

export interface TaxReturnReport {
  kind: ReturnKind;
  figures: ReturnFigures;
  detail: TaxReturnDetailRow[];
  untagged: number;
  /** NZ: what percent adjustments are worked out from. */
  context: AdjustmentContext | null;
}

export interface SalesTaxReport {
  totals: { taxableSales: number; nonTaxableSales: number; totalSales: number; taxCollected: number };
  /** Taxable sales and tax per rate (id null = the books' own). */
  byRate: { id: number | null; name: string; state: string | null; ratePpm: number; taxableSales: number; taxCollected: number }[];
  detail: (Omit<TaxReturnDetailRow, 'kind' | 'labels'> & { contactState: string | null; taxRateId: number | null; taxRateName?: string })[];
  untagged: number;
}

export interface ScheduleCRow {
  key: string;
  line: string;
  label: string;
  kind: 'income' | 'expense';
  /** Part I income, Part II expenses, Part III cost of goods sold. */
  part: 'I' | 'II' | 'III';
  total: number;
  /** After the 50% limit on meals; the total elsewhere. */
  deductible: number;
  categories: { id: number; name: string; total: number }[];
}

export interface ScheduleCReport {
  lines: ScheduleCRow[];
  /** Categories with no Schedule C line (left out of the totals). */
  unmapped: { id: number; name: string; kind: 'income' | 'expense'; total: number }[];
  /** Lines 1 to 5: line 2 is credit notes on gross receipts, line 4 comes from Part III. */
  partI: { grossReceipts: number; returns: number; netReceipts: number; costOfGoodsSold: number; grossProfit: number };
  /** Inventory on hand (lines 35 and 41); used when there are cost of goods sold lines or inventory. */
  partIII: { used: boolean; openingInventory: number; closingInventory: number; openingDate: string };
  /** Line 9: standard mileage rate (from the mileage log) or actual costs. Actual car costs aren't deducted with the mileage rate. */
  vehicle: { method: 'mileage' | 'actual'; milesTenths: number; mileageDeduction: number; notDeducted: { id: number; name: string; total: number }[] };
  /** Line 30, simplified method. `limited`: cut back so it doesn't make a loss. */
  homeOffice: { sqFt: number; full: number; deduction: number; limited: boolean };
  totals: { grossIncome: number; totalExpenses: number; tentativeProfit: number; homeOffice: number; netProfit: number };
  /** Which tax year's line numbers it used, and whether this version has checked them. */
  rules: { id: string; name: string; checkedAgainst: string; checkedUntil: string; status: RuleStatus };
}

export interface TaxReturn {
  id: number;
  periodStart: string;
  periodEnd: string;
  basis: Basis;
  figures: ReturnFigures;
  /** The boxes typed in by hand. */
  inputs: ReturnInputs;
  /** NZ: the adjustments behind Boxes 9 and 13, with the GST each came to. */
  adjustments: Adjustment[];
  /** The rule set it was worked out with (taxReturns.ts). */
  rules: string | null;
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

export interface Attachment {
  id: number;
  name: string;
  mime: string;
  /** bytes */
  size: number;
  createdAt: string;
}

/** A file read for attaching, base64 encoded. */
export interface AttachmentFile {
  name: string;
  mime: string;
  data: string;
}

export type AttachmentOwner = { entryId: number } | { invoiceId: number };

export interface Item {
  id: number;
  kind: CategoryKind;
  name: string;
  /** The line's text on a document; null uses the name. */
  description: string | null;
  /** cents */
  unitPrice: number;
  priceIncludesTax: boolean;
  categoryId: number | null;
  categoryName: string | null;
  taxCode: TaxCode | null;
  archived: boolean;
}

export type ItemInput = Omit<Item, 'id' | 'categoryName' | 'archived'> & { id?: number };

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
import type { InvoiceHandoff } from '../shared/invoiceHandoff';
export type { InvoiceHandoff } from '../shared/invoiceHandoff';

function call<T>(method: string, params?: unknown): Promise<T> {
  return tiny.api.call(method, params);
}

export const api = {
  /** Text files come back as text; Excel files (zips) as base64 bytes. */
  /** A .tallyinvoice file from another app (Tiny Time), checked and tidied. */
  readInvoiceHandoff: (path: string) => call<InvoiceHandoff>('file.invoiceHandoff', { path }),
  readImportFile: (path: string) => call<{ name: string; text: string; base64?: string }>('import.read', { path }),
  suggestCategories: (names: string[]) =>
    call<Record<string, { categoryId: number; kind: 'income' | 'expense' }>>('import.suggest', { names }),
  commitImport: (plan: ImportPlan) => call<ImportResult>('import.commit', plan),
  start: () => call<StartState>('app.start'),
  createBooks: (p: { name: string; tradingName?: string; country: Country; fiscalYearStart: string; dir: string | null; taxEnabled?: boolean; taxRatePpm?: number; taxId?: string }) =>
    call<Books>('books.create', p),
  createDemo: (dir: string | null, today: string, country: Country = 'AU') => call<Books>('books.createDemo', { dir, today, country }),
  openBooks: (path: string, force = false) => call<OpenResult>('books.open', { path, force }),
  openInNewWindow: (path: string) => call<{ focused: boolean }>('books.openInNewWindow', { path }),
  windowHidden: () => call<boolean>('app.windowHidden'),
  /** A new window: on these books (at `route`, or where the cursor is) with `share`, else the welcome screen. */
  newWindow: (p: { share?: boolean; route?: string; atCursor?: boolean } = {}) => call<true>('app.newWindow', p),
  settingsChanged: () => call<true>('app.settingsChanged'),
  claimDrop: (paths: string[], over: boolean, focused: boolean) => call<true>('drop.claim', { paths, over, focused }),
  closeBooks: () => call<true>('books.close'),
  forgetBooks: (path: string) => call<RecentBooks[]>('books.forget', { path }),
  backupBooks: (stamp: string) => call<string>('books.backup', { stamp }),
  updateSettings: (p: Partial<BooksSettings>) => call<Books>('settings.update', p),

  listAccounts: () => call<Account[]>('accounts.list'),
  saveAccount: (p: Omit<Account, 'id' | 'archived' | 'balance' | 'reconciledTo' | 'holds'> & { id?: number }) =>
    call<number>('accounts.save', p),
  archiveAccount: (id: number, archived: boolean) => call<true>('accounts.archive', { id, archived }),

  listCategories: () => call<Category[]>('categories.list'),
  confirmCategoryLines: () => call<boolean>('categories.confirmLines'),
  saveCategory: (p: { id?: number; name: string; kind: CategoryKind; taxCode?: TaxCode | null; class?: CategoryClass; reportLine?: string | null; parentId?: number | null }) =>
    call<number>('categories.save', p),
  archiveCategory: (id: number, archived: boolean) => call<true>('categories.archive', { id, archived }),

  listEntries: (q: EntryQuery = {}) => call<EntryList>('entries.list', q),
  saveEntry: (p: EntryInput) => call<number>('entries.save', p),
  deleteEntry: (id: number) => call<true>('entries.delete', { id }),
  summary: (from: string, to: string, basis?: Basis) => call<Summary>('entries.summary', { from, to, basis }),

  search: (q: string) => call<SearchResults>('search.all', { q }),

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
  suggestInvoiceNumber: (docType: DocType = 'invoice', tradingNameId: number | null = null) =>
    call<string>('invoices.suggestNumber', { docType, tradingNameId }),
  convertQuote: (id: number, today: string) => call<number>('invoices.convertQuote', { id, today }),
  creditInvoice: (id: number, today: string) => call<number>('invoices.credit', { id, today }),
  applyCredit: (p: { creditId: number; invoiceId: number; amount: number; date: string }) => call<number>('invoices.applyCredit', p),
  removeAllocation: (id: number) => call<true>('invoices.removeAllocation', { id }),
  recordPayment: (p: { invoiceId: number; date: string; amount: number; accountId: number; memo?: string | null; withheld?: number | null }) =>
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

  profitAndLoss: (p: { from: string; to: string; basis: Basis; compareFrom?: string; compareTo?: string; budget?: boolean }) =>
    call<ProfitAndLoss>('reports.profitAndLoss', p),
  cashFlow: (p: { from: string; to: string }) => call<CashFlow>('reports.cashFlow', p),
  monthly: (p: { from: string; to: string; basis?: Basis }) =>
    call<{ month: string; income: number; expense: number }[]>('reports.monthly', p),
  byContact: (p: { from: string; to: string; basis: Basis; kind: CategoryKind; compareFrom?: string; compareTo?: string }) =>
    call<ByContact>('reports.byContact', p),
  taxReturnReport: (p: { from: string; to: string; basis: Basis }) => call<TaxReturnReport>('reports.taxReturn', p),
  salesTaxReport: (p: { from: string; to: string; basis: Basis }) => call<SalesTaxReport>('reports.salesTax', p),
  scheduleCReport: (p: { from: string; to: string; basis: Basis }) => call<ScheduleCReport>('reports.scheduleC', p),
  /** Inventory on hand at the end of `date`, in cents; null clears it. */
  setInventory: (p: { date: string; amount: number | null }) => call<boolean>('scheduleC.setInventory', p),
  nec1099Report: (year: number) => call<Nec1099Report>('reports.nec1099', { year }),
  estimatedTaxReport: (p: { year: number; today: string; project?: boolean }) => call<EstimatedTaxReport>('reports.estimatedTax', p),
  nexusReport: (year: number) => call<NexusReport>('reports.nexus', { year }),
  yearInputs: (year: number) => call<YearInputs>('taxYear.get', { year }),
  setYearInputs: (p: { year: number; vehicle?: string } & { [K in keyof YearInputs]?: YearInputs[K] | null }) => call<YearInputs>('taxYear.set', p),
  carYear: (year: number) => call<CarYear>('reports.carYear', { year }),
  listAssets: () => call<Asset[]>('assets.list'),
  assetRegister: (year: number) => call<AssetRegister>('reports.assetRegister', { year }),
  saveAsset: (p: Partial<Omit<Asset, 'id'>> & { id?: number; name: string; bought: string; cost: number; method: DepreciationMethod }) => call<number>('assets.save', p),
  deleteAsset: (id: number) => call<boolean>('assets.delete', { id }),
  sellAsset: (p: { id: number; date: string | null; amount?: number; accountId?: number | null }) => call<boolean>('assets.sell', p),
  postDepreciation: (year: number) => call<number | null>('assets.post', { year }),
  incomeReturnReport: (p: { from: string; to: string; basis?: 'cash' | 'accrual' }) => call<IncomeReturnReport>('reports.incomeReturn', p),
  tparReport: (year: number) => call<TparReport>('reports.tpar', { year }),
  noAbnPayments: (p: { from: string; to: string }) => call<{ id: number; name: string; payments: number; gross: number }[]>('reports.noAbn', p),
  paygReport: (p: { year: number; today: string }) => call<PaygReport>('reports.payg', p),
  provisionalReport: (p: { year: number; today: string }) => call<ProvisionalReport>('reports.provisionalTax', p),
  gstThreshold: (today: string) => call<GstThreshold>('reports.gstThreshold', { today }),
  assetsBought: (p: { from: string; to: string }) => call<{ limit: number; year: number; assets: AssetBought[]; writeOff: number; depreciate: number }>('reports.assetsBought', p),
  deadlines: (p: { today: string; days?: number }) => call<Deadline[]>('reports.deadlines', p),
  listTrips: (p: { from: string; to: string }) => call<TripList>('trips.list', p),
  saveTrip: (t: TripInput) => call<number>('trips.save', t),
  deleteTrip: (id: number) => call<boolean>('trips.delete', { id }),
  listTaxRates: () => call<TaxRate[]>('taxRates.list'),
  saveTaxRate: (r: { id?: number; name: string; state: string | null; ratePpm: number }) => call<number>('taxRates.save', r),
  archiveTaxRate: (id: number, archived: boolean) => call<boolean>('taxRates.archive', { id, archived }),
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

  listAttachments: (o: AttachmentOwner) => call<Attachment[]>('attachments.list', o),
  getAttachment: (id: number) => call<AttachmentFile>('attachments.get', { id }),
  readAttachmentFile: (path: string) => call<AttachmentFile>('attachments.readFile', { path }),
  addAttachment: (o: AttachmentOwner, f: AttachmentFile) => call<number>('attachments.add', { ...o, ...f }),
  openAttachment: (id: number) => call<string>('attachments.open', { id }),
  saveAttachmentCopy: (id: number, path: string) => call<string>('attachments.saveCopy', { id, path }),
  deleteAttachment: (id: number) => call<true>('attachments.delete', { id }),

  getBudget: (firstMonth: string) => call<Budget>('budgets.get', { firstMonth }),
  saveBudget: (cells: { categoryId: number; month: string; amount: number }[]) => call<true>('budgets.save', { cells }),

  listItems: () => call<Item[]>('items.list'),
  saveItem: (i: ItemInput) => call<number>('items.save', i),
  archiveItem: (id: number, archived: boolean) => call<true>('items.archive', { id, archived }),
  deleteItem: (id: number) => call<true>('items.delete', { id }),

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
  listTaxReturns: () => call<TaxReturn[]>('taxReturns.list'),
  saveTaxReturn: (p: { periodStart: string; periodEnd: string; basis: Basis; inputs: ReturnInputs; adjustments?: Adjustment[]; lodge?: boolean; acknowledged?: boolean }) =>
    call<Books>('taxReturns.save', p),
  reopenTaxReturn: (id: number) => call<Books>('taxReturns.reopen', { id }),
  deleteTaxReturn: (id: number) => call<true>('taxReturns.delete', { id }),

  writeText: (path: string, text: string) => call<string>('file.writeText', { path, text }),
  makeDir: (path: string) => call<string>('file.makeDir', { path }),
};

/** Backend errors arrive as rejected promises; pull out something readable. */
export function errorMessage(e: unknown) {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  return 'Something went wrong.';
}
