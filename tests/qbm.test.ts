import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeBooks } from './support/books.ts';
import { all, getBooks, one } from '../backend/db.ts';
import { commitImport } from '../backend/importer.ts';
import { implodeDecode, parseQbm, parseUnload, readCompoundFile } from '../src/lib/import/qbm.ts';

/** Implode with literals only: valid, if pointless, and simple enough to write here. */
function implode(data: Uint8Array) {
  const out = [0, 6];
  let buffer = 0;
  let held = 0;
  const put = (value: number, n: number) => {
    buffer |= value << held;
    held += n;
    while (held >= 8) {
      out.push(buffer & 255);
      buffer >>>= 8;
      held -= 8;
    }
  };
  for (const b of data) {
    put(0, 1);
    put(b, 8);
  }
  // End of stream, as real files have it: 01 ff after the header when empty.
  put(1, 1);
  put(0, 7);
  put(0xff, 8);
  if (held) out.push(buffer & 255);
  return Uint8Array.from(out);
}

/** A compound file with every stream in regular sectors. */
function compound(streams: Record<string, Uint8Array>) {
  const S = 512;
  const names = Object.entries(streams);
  const dirSectors = Math.ceil(((names.length + 1) * 128) / S);
  const dataSectors = names.map(([, b]) => Math.max(1, Math.ceil(b.length / S)));
  const total = dirSectors + dataSectors.reduce((a, b) => a + b, 0);
  const fatSectors = Math.ceil((total + 8) / 127) || 1;
  const all = fatSectors + total;
  const file = new Uint8Array((all + 1) * S);
  const view = new DataView(file.buffer);
  file.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  view.setUint16(30, 9, true);
  view.setUint16(32, 6, true);
  view.setUint32(44, fatSectors, true);
  view.setUint32(48, fatSectors, true);
  view.setUint32(56, 0, true); // no mini stream: everything's over the cutoff
  view.setUint32(60, 0xfffffffe, true);
  view.setUint32(68, 0xfffffffe, true);
  for (let i = 0; i < 109; i++) view.setUint32(76 + i * 4, i < fatSectors ? i : 0xffffffff, true);
  const setFat = (i: number, v: number) => view.setUint32(S + i * 4, v, true);
  for (let i = 0; i < (S / 4) * fatSectors; i++) setFat(i, 0xffffffff);
  for (let i = 0; i < fatSectors; i++) setFat(i, 0xfffffffd);
  const chain = (start: number, n: number) => {
    for (let i = 0; i < n; i++) setFat(start + i, i === n - 1 ? 0xfffffffe : start + i + 1);
  };
  chain(fatSectors, dirSectors);
  const entry = (i: number, name: string, type: number, start: number, size: number) => {
    const at = (fatSectors + 1) * S + i * 128;
    for (let c = 0; c < name.length; c++) view.setUint16(at + c * 2, name.charCodeAt(c), true);
    view.setUint16(at + 64, (name.length + 1) * 2, true);
    file[at + 66] = type;
    view.setUint32(at + 116, start, true);
    view.setUint32(at + 120, size, true);
  };
  entry(0, 'Root Entry', 5, 0xfffffffe, 0);
  let next = fatSectors + dirSectors;
  names.forEach(([name, b], i) => {
    entry(i + 1, name, 2, next, b.length);
    chain(next, dataSectors[i]);
    file.set(b, (next + 1) * S);
    next += dataSectors[i];
  });
  return file;
}

const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));

const load = (table: string, file: string, columns: string[]) =>
  `LOAD TABLE "QBAdminGroup"."${table}" (${columns.map((c) => `"${c}"`).join(', ')} )\n\tFROM '***TEMPDIR***\\\\${file}'\n\tFORMAT 'ASCII'\ngo\n`;

const LINE = ['transaction_id', 'transaction_date', 'account_id', 'amount_amt', 'tax_amount_amt', 'tax_code_id', 'is_trans_tax_bool', 'is_source_bool', 'vendor_id', 'customer_id', 'memo'];

/** A $110 purchase with $10 GST, and a $110 invoice with $10 GST that $66 has been paid on. */
function company(balance = '-44.00') {
  const sql = [
    load('abmc_account_user', '1.dat', ['account_id', 'name', 'parent_id', 'type']),
    load('abmc_account_internal', '2.dat', ['account_id', 'ending_balance_amt']),
    load('abmc_vendor_user', '3.dat', ['vendor_id', 'name', 'is_deleted_bool']),
    load('abmc_contacts', '4.dat', ['name_id', 'expired_date', 'email', 'telephone_num1', 'address_line1']),
    load('abmc_check_lineitem', '5.dat', LINE),
    load('abmc_check_header', '6.dat', ['transaction_id', 'memo', 'is_memorized_transaction_bool']),
    load('abmc_estimate_lineitem', '7.dat', ['transaction_id', 'transaction_date', 'account_id', 'amount_amt']),
    load('rkn_taxcodes', '8.dat', ['TaxCodeId', 'TaxCodeName']),
    load('abmc_customer_user', '9.dat', ['customer_id', 'name']),
    load('abmc_invoice_lineitem', '10.dat', [...LINE, 'quantity_qnty']),
    load('abmc_invoice_header', '11.dat', ['transaction_id', 'customer_id', 'doc_num', 'due_date', 'is_amt_incl_tax_bool', 'memo']),
    load('abmc_received_payment_lineitem', '12.dat', LINE),
    load('abmc_received_payment_header', '13.dat', ['transaction_id', 'customer_id', 'memo']),
    load('abmc_transaction_link', '14.dat', ['transaction_id', 'transaction_2_id', 'link_type', 'is_t1_source_bool', 'amount_amt']),
  ].join('');
  const tables: Record<string, string> = {
    'header': 'PORTFILE',
    'reload.sql': sql,
    '1.dat': "1,'Westpac',,0\r\n2,'Office',,12\r\n3,'Paper',2,12\r\n4,'Tax Payable',,7\r\n5,'Accounts Receivable',,1\r\n6,'Sales',,10\r\n",
    '2.dat': `1,${balance}\r\n3,100\r\n4,0\r\n5,44\r\n6,-100\r\n`,
    '3.dat': "7,'Officeworks \\x96 City',0\r\n8,,1\r\n",
    '4.dat': "7,,'a@example.com','02 1234','1 Long''s St'\r\n",
    '5.dat': [
      "9,'2026-02-03 00:00',1,-110.00,,,0,1,7,,",
      "9,'2026-02-03 00:00',3,100,10,12,0,0,7,,'Paper'",
      "9,'2026-02-03 00:00',4,10,,,1,0,7,,",
    ].join('\r\n') + '\r\n',
    '6.dat': "9,'Receipt 45',0\r\n",
    '7.dat': "10,'2026-02-04 00:00',1,-999,\r\n",
    '8.dat': "12,'NCG'\r\n9,'GST'\r\n",
    '9.dat': "40,'Acme'\r\n",
    '10.dat': [
      "20,'2026-03-01 00:00',5,110,,,0,1,,40,,",
      "20,'2026-03-01 00:00',,,,,0,0,,40,'For March',",
      "20,'2026-03-01 00:00',6,-100,-10,9,0,0,,40,'Writing',-2",
      "20,'2026-03-01 00:00',4,-10,,,1,0,,40,'10% GST',",
    ].join('\r\n') + '\r\n',
    '11.dat': "20,40,'515','2026-03-31 00:00',1,\r\n",
    '12.dat': [
      "30,'2026-03-10 00:00',1,66,,,0,0,,40,",
      "30,'2026-03-10 00:00',5,-66,,,0,1,,40,",
    ].join('\r\n') + '\r\n',
    '13.dat': "30,40,\r\n",
    // Links name each invoice line a payment covers. The reverse row isn't the source.
    '14.dat': "30,20,4,1,-60\r\n30,20,4,1,-6\r\n20,30,4,0,60\r\n",
  };
  return compound(Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, implode(ascii(v))])));
}

test('implode decodes the published blast test vector', () => {
  const out = implodeDecode(Uint8Array.from([0x00, 0x04, 0x82, 0x24, 0x25, 0x8f, 0x80, 0x7f]));
  assert.equal(new TextDecoder().decode(out), 'AIAIAIAIAIAIA');
  assert.deepEqual([...implodeDecode(Uint8Array.from([0x00, 0x06, 0x01, 0xff]))], []);
});

test('dbunload rows keep escapes, doubled quotes, NULLs and a trailing empty column', () => {
  assert.deepEqual(parseUnload("1,'a\\x0ab','it''s',,'c\\\\d',\r\n2,,'',3,'x'\r\n"), [
    ['1', 'a\nb', "it's", '', 'c\\d', ''],
    ['2', '', '', '3', 'x'],
  ]);
});

test('compound files give their streams back', () => {
  const big = new Uint8Array(1500).fill(7);
  const streams = readCompoundFile(compound({ small: ascii('hi'), big }));
  assert.equal(new TextDecoder().decode(streams.get('small')), 'hi');
  assert.deepEqual(streams.get('big'), big);
});

test('a portable company file becomes accounts, contacts, entries and documents', () => {
  const p = parseQbm(company());
  assert.equal(p.source, 'qbm');
  assert.equal(p.hasTransactions, true);
  assert.deepEqual(p.accounts.map((a) => [a.name, a.openingBalance]), [['Westpac', 0]]);
  assert.deepEqual(p.contacts.find((c) => c.kind === 'vendor'), { kind: 'vendor', name: 'Officeworks – City', email: 'a@example.com', phone: '02 1234', address: "1 Long's St" });
  // The tax line folds into what it's on, at the amount that left the bank. The estimate never posted.
  assert.deepEqual(
    p.entries.filter((e) => !e.documentRef).map((e) => [e.date, e.kind, e.amount, e.taxAmount, e.taxCode, e.categoryKey, e.memo]),
    [['2026-02-03', 'expense', 11000, 1000, 'GST', 'expense:Office:Paper', 'Paper']],
  );
  assert.deepEqual(p.entries.filter((e) => e.documentRef).map((e) => [e.date, e.kind, e.amount, e.accountKey, e.documentRef]), [['2026-03-10', 'income', 6600, 'Westpac', 'qbm:20']]);
  assert.deepEqual(p.documents, [{
    ref: 'qbm:20',
    docType: 'invoice',
    number: '515',
    contactName: 'Acme',
    issueDate: '2026-03-01',
    dueDate: '2026-03-31',
    pricesIncludeTax: true,
    notes: undefined,
    lines: [{ description: 'For March\nWriting', categoryKey: 'income:Sales', qtyMilli: 2000, unitPrice: 5500, net: 10000, tax: 1000, taxCode: 'GST' }],
  }]);
  assert.deepEqual(p.taxReview, { inferred: 0, fit: 1, examples: [] });
  assert.deepEqual(p.skipped, []);
});

/** Depreciation and a receivable written down: no bank account in either. */
function withJournals() {
  const sql = [
    load('abmc_account_user', '1.dat', ['account_id', 'name', 'parent_id', 'type']),
    load('abmc_account_internal', '2.dat', ['account_id', 'ending_balance_amt']),
    load('abmc_journal_lineitem', '3.dat', LINE),
    load('abmc_journal_header', '4.dat', ['transaction_id', 'memo']),
  ].join('');
  const tables: Record<string, string> = {
    'header': 'PORTFILE',
    'reload.sql': sql,
    '1.dat': "1,'Westpac',,0\r\n2,'Depreciation',,12\r\n3,'Equipment',,3\r\n4,'Accounts Receivable',,1\r\n5,'Sales',,10\r\n",
    '2.dat': '2,500\r\n3,-500\r\n4,-100\r\n5,100\r\n',
    '3.dat': [
      "1,'2026-06-30 00:00',2,500,,,0,1,,,'Depreciation'",
      "1,'2026-06-30 00:00',3,-500,,,0,0,,,",
      "2,'2026-06-30 00:00',5,100,,,0,1,,,",
      "2,'2026-06-30 00:00',4,-100,,,0,0,,,",
      "3,'2026-06-30 00:00',5,0,,,0,1,,,",
      "3,'2026-06-30 00:00',4,0,,,0,0,,,",
    ].join('\r\n') + '\r\n',
    '4.dat': "1,'Year end'\r\n2,\r\n3,\r\n",
  };
  return compound(Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, implode(ascii(v))])));
}

test('a stream that expands past the limit is refused', () => {
  const big = implode(new Uint8Array(5000).fill(65));
  assert.equal(implodeDecode(big).length, 5000);
  assert.throws(() => implodeDecode(big, 1000), /too big/);
});

test('directory entries sharing one long sector chain are refused', () => {
  const names = ['big', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const file = compound(Object.fromEntries(names.map((k, i) => [k, new Uint8Array(i ? 1 : 20000)])));
  assert.ok(readCompoundFile(file) instanceof Map);
  // Entry 0 is the root, then one per stream; the directory starts after the one FAT sector.
  const view = new DataView(file.buffer);
  const startOf = (i: number) => 2 * 512 + i * 128 + 116;
  for (let i = 2; i <= names.length; i++) view.setUint32(startOf(i), view.getUint32(startOf(1), true), true);
  assert.throws(() => readCompoundFile(file), /damaged/);
});

test('a transaction with no bank account comes across as a journal', async () => {
  const p = parseQbm(withJournals());
  assert.deepEqual(p.skipped, []);
  assert.deepEqual(p.journals!.map((j) => [j.date, j.memo, j.lines.map((l) => [l.categoryKey ?? l.system, l.amount])]), [
    ['2026-06-30', 'Depreciation', [['expense:Depreciation', 50000], ['expense:Equipment', -50000]]],
    ['2026-06-30', undefined, [['income:Sales', 10000], ['prepayments', -10000]]],
  ]);
  const books = await makeBooks({ country: 'AU', fiscalYearStart: '07-01', taxEnabled: true });
  books.run(() => {
    const plan = { batch: p, accounts: {}, categories: Object.fromEntries(p.categories.map((c) => [c.key, { create: true }])), fallbackCategory: { income: null, expense: null } };
    const first = commitImport(plan as any);
    assert.deepEqual([first.journalsCreated, first.failedCount], [2, 0]);
    const db = getBooks().db;
    assert.equal(one<any>(db, 'SELECT COUNT(*) AS n FROM journals')!.n, 2);
    // The second time round, the same figures are the same journals.
    const again = commitImport(plan as any);
    assert.deepEqual([again.journalsCreated, again.duplicates], [0, 2]);
    assert.equal(one<any>(db, 'SELECT COUNT(*) AS n FROM journals')!.n, 2);
    // Skipping a category leaves out the journal, not just its line.
    const skipped = commitImport({ ...plan, batch: { ...p, journals: [{ date: '2026-07-01', lines: [{ categoryKey: 'expense:Depreciation', amount: 1 }, { categoryKey: 'expense:Equipment', amount: -1 }] }] }, categories: { ...plan.categories, 'expense:Equipment': { skip: true } } } as any);
    assert.deepEqual([skipped.journalsCreated, skipped.skipped], [0, 1]);
  });
  books.close();
});

function commit(p: ReturnType<typeof parseQbm>) {
  return commitImport({
    batch: p,
    accounts: Object.fromEntries(p.accounts.map((a) => [a.key, { create: true }])),
    categories: Object.fromEntries(p.categories.map((c) => [c.key, { create: true }])),
    fallbackCategory: { income: null, expense: null },
  });
}

test('GST reaches the books once, and a document stays exactly as the file has it', async () => {
  const books = await makeBooks({ country: 'AU', fiscalYearStart: '07-01', taxEnabled: true });
  books.run(() => {
    const p = parseQbm(company());
    const r = commit(p);
    assert.deepEqual([r.entriesCreated, r.documentsCreated, r.failedCount], [2, 1, 0]);
    const { db } = getBooks();
    const inv = one<any>(db, "SELECT i.*, (SELECT SUM(amount) FROM entries e WHERE e.invoice_id = i.id) AS paid FROM invoices i");
    assert.deepEqual([inv.number, inv.status, inv.net, inv.tax, inv.total, inv.paid], ['515', 'sent', 10000, 1000, 11000, 6600]);
    // Nothing on a tax category: the tax lives on the entry and the invoice.
    assert.equal(one<any>(db, "SELECT COUNT(*) AS n FROM categories WHERE name = 'Tax Payable'")!.n, 0);
    const ledger = all<any>(db, 'SELECT kind, SUM(gross) AS gross, SUM(tax) AS tax FROM ledger_accrual GROUP BY kind ORDER BY kind');
    assert.deepEqual(ledger.map((l) => [l.kind, l.gross, l.tax]), [['expense', 11000, 1000], ['income', 11000, 1000]]);

    // Importing it again changes nothing.
    const accounts = Object.fromEntries(p.accounts.map((a) => [a.key, { existingId: one<any>(db, 'SELECT id FROM accounts WHERE name = ?', a.name)!.id }]));
    const again = commitImport({ batch: p, accounts, categories: Object.fromEntries(p.categories.map((c) => [c.key, { create: true }])), fallbackCategory: { income: null, expense: null } });
    assert.deepEqual([again.entriesCreated, again.documentsCreated, again.duplicates], [0, 0, 3]);
  });
  books.close();
});

test('with tax off, documents and entries are simply what was charged', async () => {
  const books = await makeBooks({ country: 'AU', fiscalYearStart: '07-01', taxEnabled: false });
  books.run(() => {
    commit(parseQbm(company()));
    const inv = one<any>(getBooks().db, 'SELECT net, tax, total FROM invoices');
    assert.deepEqual([inv.net, inv.tax, inv.total], [11000, 0, 11000]);
  });
  books.close();
});

test('lines that disagree with the stored balance are reported, not hidden', () => {
  const p = parseQbm(company('-500.00'));
  assert.equal(p.skipped.length, 1);
  assert.match(p.skipped[0].reason, /don’t add up/);
});

test('something else with a .qbm name is refused', () => {
  assert.throws(() => parseQbm(ascii('not a company file'.padEnd(600, ' '))), /isn't a portable company file/);
});
