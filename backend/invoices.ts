// Invoices, bills, quotes and credit notes, their payments, and templates.
//
// All four are documents in the `invoices` table (doc_type) with lines in
// `invoice_lines`. A document is not money; money only moves when a payment
// is recorded. A payment is an entry with invoice_id set (and no category):
// income for an invoice, expense for a bill or a credit-note refund. The
// ledger views spread it over the document's lines for reports.
//
// Quotes never count anywhere; accepting one copies it to an invoice.
// A credit note reduces what a customer owes, either by being applied to an
// invoice (credit_allocations, no money moves) or refunded (a payment out).
import { all, getBooks, one, run } from './db';
import { assertUnlocked, getSettings, updateSettings, type BooksSettings } from './settings';
import { isTaxCode, lineTotals, sumTotals, type TaxCode } from '../src/shared/tax';
import { countryProfile } from '../src/shared/countries';
import { normaliseLayout } from '../src/shared/templateLayout';
import { defaultTradingNameId, resolveTradingName, senderFor, snapshotOf } from './tradingNames';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export type DocType = 'invoice' | 'bill' | 'quote' | 'credit';
const DOC_TYPES: DocType[] = ['invoice', 'bill', 'quote', 'credit'];

/** Words for messages, and where each type keeps its numbering. */
const DOC: Record<DocType, { name: string; prefix: keyof BooksSettings; next: keyof BooksSettings; categoryKind: 'income' | 'expense' }> = {
  invoice: { name: 'invoice', prefix: 'invoicePrefix', next: 'invoiceNext', categoryKind: 'income' },
  bill: { name: 'bill', prefix: 'billPrefix', next: 'billNext', categoryKind: 'expense' },
  quote: { name: 'quote', prefix: 'quotePrefix', next: 'quoteNext', categoryKind: 'income' },
  credit: { name: 'credit note', prefix: 'creditPrefix', next: 'creditNext', categoryKind: 'income' },
};

function docType(v: unknown, fallback: DocType = 'invoice'): DocType {
  return DOC_TYPES.includes(v as DocType) ? (v as DocType) : fallback;
}

export interface InvoiceLineInput {
  description: string;
  qtyMilli: number;
  unitPrice: number;
  categoryId: number | null;
  taxCode: TaxCode | null;
}

export interface InvoiceInput {
  id?: number;
  docType?: DocType;
  number?: string | null;
  contactId: number;
  issueDate: string;
  dueDate: string;
  reference?: string | null;
  notes?: string | null;
  templateId?: number | null;
  /** Who it's from. Omit for the customer's (or the default) trading name. Bills ignore it. */
  tradingNameId?: number | null;
  pricesIncludeTax: boolean;
  lines: InvoiceLineInput[];
  /** Save as draft or straight to sent. Omit to keep the current status. */
  status?: 'draft' | 'sent';
  sourceId?: number | null;
  scheduleId?: number | null;
}

export type InvoiceStatus =
  | 'draft' | 'awaiting' | 'partial' | 'overdue' | 'paid' | 'void'
  | 'open' | 'expired' | 'accepted';

const PAID_SQL = `COALESCE((SELECT SUM(p.amount) FROM entries p WHERE p.invoice_id = i.id), 0)`;
// For an invoice: credit notes used against it. For a credit note: how much of it has been used.
const ALLOC_SQL = `COALESCE(CASE WHEN i.doc_type = 'credit'
    THEN (SELECT SUM(a.amount) FROM credit_allocations a WHERE a.credit_id = i.id)
    ELSE (SELECT SUM(a.amount) FROM credit_allocations a WHERE a.invoice_id = i.id) END, 0)`;
const SETTLED_SQL = `(${PAID_SQL} + ${ALLOC_SQL})`;

const STATUS_SQL = `
  CASE
    WHEN i.status = 'void' THEN 'void'
    WHEN i.status = 'draft' THEN 'draft'
    WHEN i.doc_type = 'quote' THEN
      CASE
        WHEN EXISTS (SELECT 1 FROM invoices x WHERE x.source_id = i.id AND x.doc_type = 'invoice' AND x.status <> 'void') THEN 'accepted'
        WHEN i.due_date < date('now', 'localtime') THEN 'expired'
        ELSE 'open'
      END
    WHEN ${SETTLED_SQL} >= i.total THEN 'paid'
    WHEN i.doc_type = 'credit' THEN CASE WHEN ${SETTLED_SQL} > 0 THEN 'partial' ELSE 'awaiting' END
    WHEN i.due_date < date('now', 'localtime') THEN 'overdue'
    WHEN ${SETTLED_SQL} > 0 THEN 'partial'
    ELSE 'awaiting'
  END`;

const LIST_COLUMNS = `
  i.id, i.doc_type AS docType, i.number, i.contact_id AS contactId, ct.name AS contactName, ct.email AS contactEmail,
  i.issue_date AS issueDate, i.due_date AS dueDate, i.status AS rawStatus, i.reference, i.source_id AS sourceId,
  i.trading_name_id AS tradingNameId, i.net, i.tax, i.total, ${PAID_SQL} AS paid, ${ALLOC_SQL} AS credited, i.total - ${SETTLED_SQL} AS balance,
  ${STATUS_SQL} AS status`;

function clean(v: unknown) {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

const OPEN = ['awaiting', 'partial', 'overdue'];

export function listInvoices(q: { docType?: DocType; status?: InvoiceStatus | 'unpaid'; contactId?: number; q?: string; from?: string; to?: string }) {
  const { db } = getBooks();
  const where: string[] = ['i.doc_type = ?'];
  const args: any[] = [docType(q.docType)];
  if (q.contactId) {
    where.push('i.contact_id = ?');
    args.push(q.contactId);
  }
  if (q.from && DATE.test(q.from)) {
    where.push('i.issue_date >= ?');
    args.push(q.from);
  }
  if (q.to && DATE.test(q.to)) {
    where.push('i.issue_date <= ?');
    args.push(q.to);
  }
  const text = q.q?.trim();
  if (text) {
    const like = '%' + text.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
    where.push(`(i.number LIKE ? ESCAPE '\\' OR ct.name LIKE ? ESCAPE '\\' OR i.reference LIKE ? ESCAPE '\\')`);
    args.push(like, like, like);
  }
  let rows = all(db,
    `SELECT ${LIST_COLUMNS} FROM invoices i JOIN contacts ct ON ct.id = i.contact_id
     WHERE ${where.join(' AND ')}
     ORDER BY i.issue_date DESC, i.id DESC`, ...args);
  const summary = {
    outstanding: rows.filter((r: any) => OPEN.includes(r.status)).reduce((s: number, r: any) => s + r.balance, 0),
    overdue: rows.filter((r: any) => r.status === 'overdue').reduce((s: number, r: any) => s + r.balance, 0),
    overdueCount: rows.filter((r: any) => r.status === 'overdue').length,
    drafts: rows.filter((r: any) => r.status === 'draft').length,
    open: rows.filter((r: any) => r.status === 'open').length,
    openValue: rows.filter((r: any) => r.status === 'open').reduce((s: number, r: any) => s + r.total, 0),
  };
  if (q.status === 'unpaid') rows = rows.filter((r: any) => OPEN.includes(r.status));
  else if (q.status) rows = rows.filter((r: any) => r.status === q.status);
  return { rows, summary };
}

export function getInvoice(id: number) {
  const { db } = getBooks();
  const inv = one<any>(db,
    `SELECT ${LIST_COLUMNS}, i.notes, i.template_id AS templateId, i.prices_include_tax AS pricesIncludeTax, i.from_snapshot AS fromSnapshot,
            i.sent_at AS sentAt, i.schedule_id AS scheduleId, ct.address AS contactAddress, ct.phone AS contactPhone,
            src.number AS sourceNumber, src.doc_type AS sourceType
     FROM invoices i JOIN contacts ct ON ct.id = i.contact_id
     LEFT JOIN invoices src ON src.id = i.source_id
     WHERE i.id = ?`, id);
  if (!inv) throw new Error('That document no longer exists.');
  inv.pricesIncludeTax = !!inv.pricesIncludeTax;
  inv.sender = inv.docType === 'bill' ? null : senderFor(inv.tradingNameId, inv.fromSnapshot);
  delete inv.fromSnapshot;
  inv.lines = all(db,
    `SELECT l.id, l.description, l.qty_milli AS qtyMilli, l.unit_price AS unitPrice, l.category_id AS categoryId,
            c.name AS categoryName, l.tax_code AS taxCode, l.net, l.tax
     FROM invoice_lines l LEFT JOIN categories c ON c.id = l.category_id
     WHERE l.invoice_id = ? ORDER BY l.sort, l.id`, id);
  inv.payments = all(db,
    `SELECT e.id, e.date, e.amount, e.memo, e.account_id AS accountId, a.name AS accountName
     FROM entries e JOIN accounts a ON a.id = e.account_id
     WHERE e.invoice_id = ? ORDER BY e.date, e.id`, id);
  // Credit notes used against this invoice, or invoices this credit note was used on.
  inv.allocations = all(db,
    inv.docType === 'credit'
      ? `SELECT a.id, a.date, a.amount, x.id AS docId, x.number FROM credit_allocations a JOIN invoices x ON x.id = a.invoice_id
         WHERE a.credit_id = ? ORDER BY a.date, a.id`
      : `SELECT a.id, a.date, a.amount, x.id AS docId, x.number FROM credit_allocations a JOIN invoices x ON x.id = a.credit_id
         WHERE a.invoice_id = ? ORDER BY a.date, a.id`, id);
  // Documents made from this one: the invoice from a quote, credit notes for an invoice.
  inv.derived = all(db,
    `SELECT x.id, x.doc_type AS docType, x.number, x.status AS rawStatus, x.total FROM invoices x
     WHERE x.source_id = ? ORDER BY x.id`, id);
  return inv;
}

function numberFor(type: DocType, n: number, s = getSettings()) {
  return String(s[DOC[type].prefix]) + String(n).padStart(4, '0');
}

function nextNumber(type: DocType) {
  const s = getSettings();
  const { db } = getBooks();
  let n = Number(s[DOC[type].next]);
  // Skip numbers already taken (e.g. typed by hand).
  while (one(db, 'SELECT id FROM invoices WHERE number = ?', numberFor(type, n, s))) n++;
  updateSettings({ [DOC[type].next]: n + 1 });
  return numberFor(type, n, s);
}

export function suggestNumber(type?: DocType) {
  const t = docType(type);
  const s = getSettings();
  const { db } = getBooks();
  let n = Number(s[DOC[t].next]);
  while (one(db, 'SELECT id FROM invoices WHERE number = ?', numberFor(t, n, s))) n++;
  return numberFor(t, n, s);
}

function settledOn(id: number) {
  const { db } = getBooks();
  const paid = one<{ p: number }>(db, 'SELECT COALESCE(SUM(amount), 0) AS p FROM entries WHERE invoice_id = ?', id)!.p;
  const alloc = one<{ a: number }>(db,
    'SELECT COALESCE(SUM(amount), 0) AS a FROM credit_allocations WHERE invoice_id = ?1 OR credit_id = ?1', id)!.a;
  return { paid, alloc, settled: paid + alloc };
}

const money = (c: number) => (c / 100).toFixed(2);

export function saveInvoice(input: InvoiceInput) {
  const { db } = getBooks();
  const settings = getSettings();
  const existing = input.id ? one<any>(db, 'SELECT * FROM invoices WHERE id = ?', input.id) : null;
  if (input.id && !existing) throw new Error('That document no longer exists.');
  const type: DocType = existing ? existing.doc_type : docType(input.docType);
  const word = DOC[type].name;
  if (existing?.status === 'void') throw new Error(`This ${word} is void. Duplicate it to start a new one.`);

  if (typeof input.contactId !== 'number' || !one(db, 'SELECT id FROM contacts WHERE id = ?', input.contactId)) {
    throw new Error(type === 'bill' ? 'Choose who the bill is from.' : `Choose who the ${word} is for.`);
  }
  if (!DATE.test(String(input.issueDate))) throw new Error(type === 'bill' ? 'Pick the bill date.' : 'Pick an issue date.');
  if (!DATE.test(String(input.dueDate))) throw new Error(type === 'quote' ? 'Pick how long the quote is valid.' : 'Pick a due date.');
  if (input.dueDate < input.issueDate) {
    throw new Error(type === 'quote' ? "The quote can't expire before it's issued." : "The due date can't be before the issue date.");
  }

  const status = input.status ?? existing?.status ?? 'draft';
  // A sent invoice/bill/credit is income or spending on the accrual basis, so its date can lock.
  if (type !== 'quote' && (status === 'sent' || existing?.status === 'sent')) assertUnlocked(input.issueDate, existing?.issue_date);

  const lines = (input.lines ?? []).filter(
    (l) => clean(l.description) || Math.round(Number(l.unitPrice)) !== 0,
  );
  if (!lines.length) throw new Error('Add at least one line.');

  const kind = DOC[type].categoryKind;
  const computed = lines.map((l, i) => {
    const qtyMilli = Math.round(Number(l.qtyMilli));
    const unitPrice = Math.round(Number(l.unitPrice));
    if (!Number.isFinite(qtyMilli) || qtyMilli <= 0) throw new Error(`Line ${i + 1}: quantity must be more than zero.`);
    if (!Number.isFinite(unitPrice)) throw new Error(`Line ${i + 1}: enter a price.`);
    let categoryId: number | null = null;
    if (l.categoryId !== null && l.categoryId !== undefined) {
      const cat = one<any>(db, 'SELECT * FROM categories WHERE id = ?', l.categoryId);
      if (!cat || cat.kind !== kind) throw new Error(`Line ${i + 1}: choose an ${kind} category.`);
      categoryId = cat.id;
    }
    if (categoryId === null) throw new Error(`Line ${i + 1}: choose an ${kind} category.`);
    const taxCode: TaxCode | null = settings.taxEnabled ? (isTaxCode(l.taxCode) ? l.taxCode : 'GST') : null;
    const t = lineTotals({ qtyMilli, unitPrice, taxCode }, !!input.pricesIncludeTax, settings.taxEnabled, settings.taxRateBp);
    return { description: clean(l.description) ?? '', qtyMilli, unitPrice, categoryId, taxCode, ...t, sort: i };
  });
  const totals = sumTotals(computed);
  if (totals.gross <= 0) throw new Error(`The ${word} total must be more than zero.`);

  if (existing) {
    const { settled } = settledOn(existing.id);
    if (settled > totals.gross) {
      throw new Error(`${money(settled)} has already been ${type === 'credit' ? 'used' : 'paid'}, which is more than the new total.`);
    }
    if (settled > 0 && status === 'draft') throw new Error(`A ${word} with payments can't go back to draft.`);
  }

  let number = clean(input.number);
  if (number) {
    const clash = one(db, 'SELECT id FROM invoices WHERE number = ? AND id IS NOT ?', number, existing?.id ?? null);
    if (clash) throw new Error(`Number ${number} is already used.`);
  }

  const templateId = typeof input.templateId === 'number' && one(db, 'SELECT id FROM invoice_templates WHERE id = ?', input.templateId)
    ? input.templateId
    : null;
  const sourceId = typeof input.sourceId === 'number' && one(db, 'SELECT id FROM invoices WHERE id = ?', input.sourceId)
    ? input.sourceId
    : null;
  const tradingNameId = type === 'bill' ? null : resolveTradingName(input.tradingNameId, input.contactId, existing?.trading_name_id);
  // Sent documents keep who they were from; a draft shows the details as they are now.
  const snapshot = type === 'bill' || status !== 'sent'
    ? null
    : existing?.from_snapshot && existing.trading_name_id === tradingNameId ? existing.from_snapshot : snapshotOf(tradingNameId!);

  let id: number;
  db.transaction(() => {
    if (existing) {
      id = existing.id;
      run(db,
        `UPDATE invoices SET number = ?, contact_id = ?, issue_date = ?, due_date = ?, status = ?, reference = ?, notes = ?,
           template_id = ?, trading_name_id = ?, from_snapshot = ?, prices_include_tax = ?, net = ?, tax = ?, total = ?,
           sent_at = CASE WHEN ? = 'sent' AND sent_at IS NULL THEN datetime('now') ELSE sent_at END,
           updated_at = datetime('now')
         WHERE id = ?`,
        number ?? existing.number, input.contactId, input.issueDate, input.dueDate, status, clean(input.reference),
        clean(input.notes), templateId, tradingNameId, snapshot, input.pricesIncludeTax ? 1 : 0, totals.net, totals.tax, totals.gross, status, id);
      run(db, 'DELETE FROM invoice_lines WHERE invoice_id = ?', id);
      // Payments' GST share follows the new total.
      run(db, 'UPDATE entries SET tax_amount = CAST(ROUND(1.0 * amount * ? / ?) AS INTEGER) WHERE invoice_id = ?',
        totals.tax, totals.gross, id);
    } else {
      id = one<{ id: number }>(db,
        `INSERT INTO invoices (doc_type, number, contact_id, issue_date, due_date, status, reference, notes, template_id,
           trading_name_id, from_snapshot, prices_include_tax, net, tax, total, sent_at, source_id, schedule_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'sent' THEN datetime('now') END, ?, ?) RETURNING id`,
        type, number ?? nextNumber(type), input.contactId, input.issueDate, input.dueDate, status, clean(input.reference),
        clean(input.notes), templateId, tradingNameId, snapshot, input.pricesIncludeTax ? 1 : 0, totals.net, totals.tax, totals.gross, status,
        sourceId, typeof input.scheduleId === 'number' ? input.scheduleId : null)!.id;
    }
    const ins = db.prepare(
      `INSERT INTO invoice_lines (invoice_id, sort, description, qty_milli, unit_price, category_id, tax_code, net, tax)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const l of computed) ins.run(id, l.sort, l.description, l.qtyMilli, l.unitPrice, l.categoryId, l.taxCode, l.net, l.tax);
    ins.finalize();
  })();
  return id!;
}

export function setInvoiceStatus(id: number, status: 'draft' | 'sent' | 'void') {
  const { db } = getBooks();
  const inv = one<any>(db, 'SELECT * FROM invoices WHERE id = ?', id);
  if (!inv) throw new Error('That document no longer exists.');
  const word = DOC[inv.doc_type as DocType].name;
  const { paid, alloc } = settledOn(id);
  if (status !== 'sent' && paid > 0) {
    throw new Error(`Delete the payments on this ${word} first. A ${word} with payments can't be ${status === 'void' ? 'voided' : 'a draft'}.`);
  }
  if (status !== 'sent' && alloc > 0) throw new Error('Remove the credit applied to it first.');
  if (inv.doc_type !== 'quote' && (inv.status === 'sent' || status === 'sent')) assertUnlocked(inv.issue_date);
  db.transaction(() => {
    run(db,
      `UPDATE invoices SET status = ?, sent_at = CASE WHEN ? = 'sent' AND sent_at IS NULL THEN datetime('now') ELSE sent_at END,
         updated_at = datetime('now') WHERE id = ?`, status, status, id);
    keepSender(id, status);
  })();
  return true;
}

/** Saves who a document is from when it's sent; a draft goes back to the live details. Void keeps it. */
function keepSender(id: number, status: 'draft' | 'sent' | 'void') {
  const { db } = getBooks();
  const inv = one<any>(db, 'SELECT doc_type, trading_name_id, from_snapshot FROM invoices WHERE id = ?', id);
  if (!inv || inv.doc_type === 'bill') return;
  if (status === 'draft') run(db, 'UPDATE invoices SET from_snapshot = NULL WHERE id = ?', id);
  else if (status === 'sent' && !inv.from_snapshot) {
    run(db, 'UPDATE invoices SET from_snapshot = ? WHERE id = ?', snapshotOf(inv.trading_name_id ?? defaultTradingNameId()), id);
  }
}

export function deleteInvoice(id: number) {
  const { db } = getBooks();
  const inv = one<any>(db, 'SELECT * FROM invoices WHERE id = ?', id);
  if (!inv) return true;
  const word = DOC[inv.doc_type as DocType].name;
  if (inv.status === 'sent' && inv.doc_type !== 'quote') {
    throw new Error(`Void a ${inv.doc_type === 'bill' ? 'approved' : 'sent'} ${word} instead of deleting it, so the number stays accounted for.`);
  }
  if (one(db, 'SELECT id FROM entries WHERE invoice_id = ?', id)) throw new Error(`Delete the payments on this ${word} first.`);
  if (one(db, 'SELECT id FROM credit_allocations WHERE invoice_id = ?1 OR credit_id = ?1', id)) throw new Error('Remove the credit applied to it first.');
  db.transaction(() => {
    run(db, 'UPDATE invoices SET source_id = NULL WHERE source_id = ?', id);
    run(db, 'DELETE FROM invoices WHERE id = ?', id);
  })();
  return true;
}

/** Copies a document's lines into a new draft (same type, or converted). */
function copyDocument(id: number, today: string, as?: DocType, link = false) {
  const inv = getInvoice(id);
  const type = as ?? inv.docType;
  const terms = getSettings().paymentTermsDays;
  const keepGap = type === inv.docType ? Math.max(0, daysBetween(inv.issueDate, inv.dueDate)) : 0;
  const due = addDays(today, keepGap || (type === 'quote' ? 30 : type === 'credit' ? 0 : terms));
  return saveInvoice({
    docType: type,
    contactId: inv.contactId,
    issueDate: today,
    dueDate: due,
    reference: type === inv.docType ? inv.reference : inv.reference ?? inv.number,
    notes: inv.notes,
    templateId: inv.templateId,
    tradingNameId: inv.tradingNameId,
    pricesIncludeTax: inv.pricesIncludeTax,
    lines: inv.lines,
    status: 'draft',
    sourceId: link ? inv.id : null,
  });
}

export function duplicateInvoice(id: number, today: string) {
  return copyDocument(id, today);
}

/** Accepting a quote: a draft invoice with the same lines, linked back to it. */
export function convertQuote(id: number, today: string) {
  const q = one<any>(getBooks().db, 'SELECT * FROM invoices WHERE id = ?', id);
  if (!q || q.doc_type !== 'quote') throw new Error('That quote no longer exists.');
  if (q.status === 'void') throw new Error('This quote was declined. Reopen it first.');
  if (q.status === 'draft') setInvoiceStatus(id, 'sent');
  return copyDocument(id, today, 'invoice', true);
}

/** A draft credit note for an invoice, with its lines ready to trim. */
export function creditInvoice(id: number, today: string) {
  const inv = one<any>(getBooks().db, 'SELECT * FROM invoices WHERE id = ?', id);
  if (!inv || inv.doc_type !== 'invoice') throw new Error('That invoice no longer exists.');
  if (inv.status !== 'sent') throw new Error('Only approved invoices can be credited. Edit or delete a draft instead.');
  return copyDocument(id, today, 'credit', true);
}

export function recordPayment(p: { invoiceId: number; date: string; amount: number; accountId: number; memo?: string | null }) {
  const { db } = getBooks();
  const inv = one<any>(db, 'SELECT * FROM invoices WHERE id = ?', p.invoiceId);
  if (!inv) throw new Error('That document no longer exists.');
  const type = inv.doc_type as DocType;
  if (type === 'quote') throw new Error("Quotes don't take payments. Turn it into an invoice first.");
  if (inv.status === 'void') throw new Error(`You can't record a payment on a void ${DOC[type].name}.`);
  if (!DATE.test(String(p.date))) throw new Error('Pick the date the money moved.');
  assertUnlocked(p.date);
  const amount = Math.round(Number(p.amount));
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Enter an amount greater than zero.');
  const balance = inv.total - settledOn(inv.id).settled;
  if (amount > balance) {
    throw new Error(`That's more than the ${money(balance)} ${type === 'credit' ? 'left on this credit note' : 'still owing'}.`);
  }
  const account = one<any>(db, 'SELECT * FROM accounts WHERE id = ?', p.accountId);
  if (!account) throw new Error(type === 'invoice' ? 'Choose the account the money went into.' : 'Choose the account the money came from.');
  if (account.is_archived) throw new Error(`${account.name} is archived.`);
  const tax = Math.round((amount * inv.tax) / inv.total);
  const kind = type === 'invoice' ? 'income' : 'expense';
  let id: number;
  db.transaction(() => {
    if (inv.status === 'draft') {
      run(db, "UPDATE invoices SET status = 'sent', sent_at = COALESCE(sent_at, datetime('now')) WHERE id = ?", inv.id);
      keepSender(inv.id, 'sent');
    }
    id = one<{ id: number }>(db,
      `INSERT INTO entries (date, kind, amount, account_id, contact_id, memo, invoice_id, tax_amount)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      p.date, kind, amount, account.id, inv.contact_id, clean(p.memo), inv.id, tax)!.id;
  })();
  return id!;
}

export function deletePayment(entryId: number) {
  const { db } = getBooks();
  const e = one<any>(db, 'SELECT * FROM entries WHERE id = ? AND invoice_id IS NOT NULL', entryId);
  if (!e) return true;
  assertUnlocked(e.date);
  if (e.rec_id) throw new Error('This payment has been reconciled. Undo the reconciliation first.');
  run(db, 'DELETE FROM entries WHERE id = ?', entryId);
  return true;
}

/** Use (part of) a credit note against one of the same customer's invoices. */
export function applyCredit(p: { creditId: number; invoiceId: number; amount: number; date: string }) {
  const { db } = getBooks();
  const credit = one<any>(db, "SELECT * FROM invoices WHERE id = ? AND doc_type = 'credit'", p.creditId);
  const inv = one<any>(db, "SELECT * FROM invoices WHERE id = ? AND doc_type = 'invoice'", p.invoiceId);
  if (!credit) throw new Error('That credit note no longer exists.');
  if (!inv) throw new Error('Choose an invoice.');
  if (credit.status !== 'sent') throw new Error('Approve the credit note first.');
  if (inv.status !== 'sent') throw new Error('The invoice must be approved.');
  if (credit.contact_id !== inv.contact_id) throw new Error('The credit note and invoice are for different customers.');
  if (!DATE.test(String(p.date))) throw new Error('Pick a date.');
  assertUnlocked(p.date);
  const amount = Math.round(Number(p.amount));
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Enter an amount greater than zero.');
  const creditLeft = credit.total - settledOn(credit.id).settled;
  const owing = inv.total - settledOn(inv.id).settled;
  if (amount > creditLeft) throw new Error(`Only ${money(creditLeft)} is left on this credit note.`);
  if (amount > owing) throw new Error(`The invoice only has ${money(owing)} owing.`);
  return one<{ id: number }>(db,
    'INSERT INTO credit_allocations (credit_id, invoice_id, date, amount) VALUES (?, ?, ?, ?) RETURNING id',
    credit.id, inv.id, p.date, amount)!.id;
}

export function removeAllocation(id: number) {
  const { db } = getBooks();
  const a = one<any>(db, 'SELECT * FROM credit_allocations WHERE id = ?', id);
  if (!a) return true;
  assertUnlocked(a.date);
  run(db, 'DELETE FROM credit_allocations WHERE id = ?', id);
  return true;
}

/** Who owes you (invoices) or who you owe (bills), bucketed by days overdue, as at a date. */
export function agedBalances(asOf: string, type: 'invoice' | 'bill' = 'invoice', tradingNameId: number | null = null) {
  const { db } = getBooks();
  if (!DATE.test(asOf)) throw new Error('Pick a date.');
  const t = type === 'bill' ? 'bill' : 'invoice';
  // Balance as at asOf: payments and credits on or before that date only.
  const rows = all<any>(db,
    `SELECT i.id, i.doc_type AS docType, i.number, i.issue_date AS issueDate, i.due_date AS dueDate,
            ct.id AS contactId, ct.name AS contactName,
            CASE WHEN i.doc_type = 'credit' THEN -1 ELSE 1 END * (i.total
              - COALESCE((SELECT SUM(p.amount) FROM entries p WHERE p.invoice_id = i.id AND p.date <= ?1), 0)
              - COALESCE((SELECT SUM(a.amount) FROM credit_allocations a
                          WHERE (a.invoice_id = i.id OR a.credit_id = i.id) AND a.date <= ?1), 0)) AS balance,
            CAST(julianday(?1) - julianday(i.due_date) AS INTEGER) AS daysOverdue
     FROM invoices i JOIN contacts ct ON ct.id = i.contact_id
     WHERE i.status = 'sent' AND i.issue_date <= ?1 AND i.doc_type IN (?2, CASE WHEN ?2 = 'invoice' THEN 'credit' END)
       AND (?3 IS NULL OR i.trading_name_id = ?3)
     ORDER BY ct.name COLLATE NOCASE, i.due_date`, asOf, t, tradingNameId).filter((r) => r.balance !== 0);
  const bucket = (d: number) => (d <= 0 ? 'current' : d <= 30 ? 'd30' : d <= 60 ? 'd60' : d <= 90 ? 'd90' : 'older');
  const byContact = new Map<number, any>();
  for (const r of rows) {
    // Unused credit isn't late; it sits in "current".
    r.bucket = r.docType === 'credit' ? 'current' : bucket(r.daysOverdue);
    let c = byContact.get(r.contactId);
    if (!c) {
      c = { contactId: r.contactId, contactName: r.contactName, current: 0, d30: 0, d60: 0, d90: 0, older: 0, total: 0, invoices: [] };
      byContact.set(r.contactId, c);
    }
    c[r.bucket] += r.balance;
    c.total += r.balance;
    c.invoices.push(r);
  }
  return [...byContact.values()];
}

export function agedReceivables(asOf: string) {
  return agedBalances(asOf, 'invoice');
}

/**
 * A contact's account for a period: opening balance, every document and
 * payment, the closing balance and its aging. Customers see invoices, credit
 * notes, payments and refunds (+ they owe more). Suppliers see bills and our
 * payments (+ we owe more), for checking against the statement they send.
 *
 * A customer's statement is from one trading name and covers only its
 * documents. `tradingNames` lists every one the customer has documents under.
 */
export function customerStatement(p: { contactId: number; from: string; to: string; side?: 'customer' | 'supplier'; tradingNameId?: number | null }) {
  const { db } = getBooks();
  if (!DATE.test(p.from) || !DATE.test(p.to)) throw new Error('Pick a date range.');
  const contact = one<any>(db, 'SELECT id, kind, name, email, address FROM contacts WHERE id = ?', p.contactId);
  if (!contact) throw new Error('Choose a contact.');
  const side = p.side ?? (contact.kind === 'vendor' ? 'supplier' : 'customer');
  const tradingNames = side === 'supplier' ? [] : all<{ id: number; name: string }>(db,
    `SELECT t.id, t.name FROM trading_names t
     WHERE t.id IN (SELECT trading_name_id FROM invoices WHERE contact_id = ? AND doc_type IN ('invoice', 'credit') AND status = 'sent')
     ORDER BY t.is_default DESC, t.sort, t.name COLLATE NOCASE`, p.contactId);
  // The one asked for if they have documents under it, else their usual one, else the first they have.
  let tradingNameId: number | null = null;
  if (side === 'customer') {
    const has = (id: unknown) => tradingNames.some((t) => t.id === id);
    const usual = resolveTradingName(null, p.contactId, null);
    tradingNameId = has(p.tradingNameId) ? p.tradingNameId! : has(usual) || !tradingNames.length ? usual : tradingNames[0].id;
  }
  // Every movement on the account, signed (+ owes more, − owes less).
  const moves = side === 'supplier'
    ? all<any>(db,
      `SELECT * FROM (
         SELECT i.issue_date AS date, 'bill' AS type, i.id AS docId, i.number AS ref, i.reference AS theirRef,
                i.due_date AS dueDate, i.total AS amount
         FROM invoices i WHERE i.contact_id = ?1 AND i.doc_type = 'bill' AND i.status = 'sent'
         UNION ALL
         SELECT e.date, 'payment', i.id, i.number, i.reference, NULL, -e.amount
         FROM entries e JOIN invoices i ON i.id = e.invoice_id
         WHERE i.contact_id = ?1 AND i.doc_type = 'bill'
       ) ORDER BY date, CASE type WHEN 'bill' THEN 0 ELSE 1 END, ref`, p.contactId)
    : all<any>(db,
      `SELECT * FROM (
         SELECT i.issue_date AS date, 'invoice' AS type, i.id AS docId, i.number AS ref, NULL AS theirRef,
                i.due_date AS dueDate, i.total AS amount
         FROM invoices i WHERE i.contact_id = ?1 AND i.doc_type = 'invoice' AND i.status = 'sent' AND i.trading_name_id = ?2
         UNION ALL
         SELECT i.issue_date, 'credit', i.id, i.number, NULL, NULL, -i.total
         FROM invoices i WHERE i.contact_id = ?1 AND i.doc_type = 'credit' AND i.status = 'sent' AND i.trading_name_id = ?2
         UNION ALL
         SELECT e.date, CASE WHEN i.doc_type = 'credit' THEN 'refund' ELSE 'payment' END, i.id, i.number, NULL, NULL,
                CASE WHEN i.doc_type = 'credit' THEN e.amount ELSE -e.amount END
         FROM entries e JOIN invoices i ON i.id = e.invoice_id
         WHERE i.contact_id = ?1 AND i.doc_type IN ('invoice', 'credit') AND i.trading_name_id = ?2
       ) ORDER BY date, CASE type WHEN 'invoice' THEN 0 ELSE 1 END, ref`, p.contactId, tradingNameId);
  const opening = moves.filter((m) => m.date < p.from).reduce((s, m) => s + m.amount, 0);
  let balance = opening;
  const lines = moves
    .filter((m) => m.date >= p.from && m.date <= p.to)
    .map((m) => ({ ...m, balance: (balance += m.amount) }));
  const aged = agedBalances(p.to, side === 'supplier' ? 'bill' : 'invoice', tradingNameId).find((c) => c.contactId === p.contactId) ?? {
    current: 0, d30: 0, d60: 0, d90: 0, older: 0, total: 0, invoices: [],
  };
  return {
    side,
    sender: senderFor(tradingNameId ?? defaultTradingNameId(), null),
    tradingNameId,
    tradingNames,
    contact: { id: contact.id, name: contact.name, email: contact.email, address: contact.address },
    from: p.from,
    to: p.to,
    opening,
    closing: balance,
    lines,
    aging: { current: aged.current, d30: aged.d30, d60: aged.d60, d90: aged.d90, older: aged.older },
    open: aged.invoices,
  };
}

/**
 * Remittance advice for a bill payment: every bill paid to the same supplier
 * from the same account on the same day goes on one advice, the way a batch
 * payment arrives at their end as one deposit.
 */
export function remittance(entryId: number) {
  const { db } = getBooks();
  const e = one<any>(db,
    `SELECT e.id, e.date, e.account_id, i.contact_id, i.doc_type FROM entries e JOIN invoices i ON i.id = e.invoice_id WHERE e.id = ?`, entryId);
  if (!e || e.doc_type !== 'bill') throw new Error("That isn't a bill payment.");
  const contact = one<any>(db, 'SELECT id, name, email, address FROM contacts WHERE id = ?', e.contact_id);
  const account = one<any>(db, 'SELECT name FROM accounts WHERE id = ?', e.account_id);
  const items = all<any>(db,
    `SELECT p.id AS entryId, p.amount AS paid, p.memo, i.id AS billId, i.number, i.reference, i.issue_date AS issueDate,
            i.due_date AS dueDate, i.total,
            i.total - (SELECT COALESCE(SUM(q.amount), 0) FROM entries q
                       WHERE q.invoice_id = i.id AND (q.date < p.date OR (q.date = p.date AND q.id <= p.id))) AS remaining
     FROM entries p JOIN invoices i ON i.id = p.invoice_id
     WHERE i.doc_type = 'bill' AND i.contact_id = ? AND p.date = ? AND p.account_id = ?
     ORDER BY i.issue_date, i.id, p.id`, e.contact_id, e.date, e.account_id);
  return {
    sender: senderFor(defaultTradingNameId(), null),
    date: e.date as string,
    accountName: account?.name ?? '',
    contact,
    items,
    total: items.reduce((s: number, i: any) => s + i.paid, 0),
  };
}

// ---- dates (plain YYYY-MM-DD, no time zones) --------------------------------

function toUtc(d: string) {
  const [y, m, day] = d.split('-').map(Number);
  return Date.UTC(y, m - 1, day);
}

function daysBetween(a: string, b: string) {
  return Math.round((toUtc(b) - toUtc(a)) / 86400000);
}

function addDays(d: string, n: number) {
  return new Date(toUtc(d) + n * 86400000).toISOString().slice(0, 10);
}

// ---- templates ------------------------------------------------------------------

export interface TemplateInput {
  id?: number;
  name: string;
  style: 'classic' | 'modern' | 'minimal';
  accent: string;
  logo?: string | null;
  title: string;
  footer?: string | null;
  showTaxColumn: boolean;
  layout?: unknown;
}

export function listTemplates() {
  return all(getBooks().db,
    `SELECT t.id, t.name, t.style, t.accent, t.logo, t.title, t.footer,
            t.show_tax_column AS showTaxColumn, t.is_default AS isDefault, t.layout,
            (SELECT COUNT(*) FROM invoices i WHERE i.template_id = t.id) AS uses
     FROM invoice_templates t ORDER BY t.is_default DESC, t.name COLLATE NOCASE`,
  ).map((t: any) => ({ ...t, showTaxColumn: !!t.showTaxColumn, isDefault: !!t.isDefault, layout: parseLayout(t.layout) }));
}

function parseLayout(json: string | null) {
  try {
    return normaliseLayout(json ? JSON.parse(json) : null);
  } catch {
    return normaliseLayout(null);
  }
}

export function saveTemplate(t: TemplateInput) {
  const { db } = getBooks();
  const name = clean(t.name);
  if (!name) throw new Error('Give the template a name.');
  if (!['classic', 'modern', 'minimal'].includes(t.style)) throw new Error('Choose a layout.');
  if (!/^#[0-9a-f]{6}$/i.test(t.accent)) throw new Error('Choose an accent colour.');
  if (t.logo && (!t.logo.startsWith('data:image/') || t.logo.length > 1_500_000)) {
    throw new Error('The logo must be an image under about 1 MB.');
  }
  const fields = [name, t.style, t.accent, t.logo ?? null, clean(t.title) ?? countryProfile(getSettings().country).invoiceTitle(true),
    clean(t.footer), t.showTaxColumn ? 1 : 0, JSON.stringify(normaliseLayout(t.layout))];
  if (t.id) {
    run(db, `UPDATE invoice_templates SET name = ?, style = ?, accent = ?, logo = ?, title = ?,
               footer = ?, show_tax_column = ?, layout = ? WHERE id = ?`, ...fields, t.id);
    return t.id;
  }
  const isFirst = !one(db, 'SELECT id FROM invoice_templates');
  return one<{ id: number }>(db,
    `INSERT INTO invoice_templates (name, style, accent, logo, title, footer, show_tax_column, layout, is_default)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`, ...fields, isFirst ? 1 : 0)!.id;
}

export function setDefaultTemplate(id: number) {
  const { db } = getBooks();
  db.transaction(() => {
    run(db, 'UPDATE invoice_templates SET is_default = 0');
    run(db, 'UPDATE invoice_templates SET is_default = 1 WHERE id = ?', id);
  })();
  return true;
}

export function deleteTemplate(id: number) {
  const { db } = getBooks();
  const t = one<any>(db, 'SELECT * FROM invoice_templates WHERE id = ?', id);
  if (!t) return true;
  if (t.is_default) throw new Error('Make another template the default first.');
  db.transaction(() => {
    run(db, 'UPDATE invoices SET template_id = NULL WHERE template_id = ?', id);
    run(db, 'UPDATE trading_names SET template_id = NULL WHERE template_id = ?', id);
    run(db, 'DELETE FROM invoice_templates WHERE id = ?', id);
  })();
  return true;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function base64(bytes: Uint8Array) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2];
    out += B64[a >> 2] + B64[((a & 3) << 4) | ((b ?? 0) >> 4)];
    out += b === undefined ? '=' : B64[((b & 15) << 2) | ((c ?? 0) >> 6)];
    out += c === undefined ? '=' : B64[c & 63];
  }
  return out;
}

export async function readLogo(path: string) {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  const mime: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml', webp: 'image/webp', gif: 'image/gif' };
  if (!mime[ext]) throw new Error('Choose a PNG, JPEG, SVG, WebP or GIF image.');
  const st = await tjs.stat(path);
  if (st.size > 1_000_000) throw new Error('That image is over 1 MB. Try a smaller one.');
  const bytes = await tjs.readFile(path);
  return `data:${mime[ext]};base64,${base64(bytes)}`;
}
