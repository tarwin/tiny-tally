import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeBooks } from './support/books.ts';
import { saveContact, saveEntry } from '../backend/entries.ts';
import { convertQuote, creditInvoice, deletePayment, getInvoice, recordPayment, saveInvoice } from '../backend/invoices.ts';
import { listItems, saveItem } from '../backend/items.ts';
import { journal, trialBalance } from '../backend/ledger.ts';
import { inGstReport } from '../backend/reports.ts';
import { updateSettings } from '../backend/settings.ts';
import { all, getBooks, one } from '../backend/db.ts';
import { COUNTRIES } from '../src/shared/countries.ts';
import { carryingValue, foreignBalance, parseFxRate, toBooks } from '../src/shared/currency.ts';
import { lineRateOr } from '../src/shared/tax.ts';
import { EXPORT_PLACE, GST_RATES, gstHeads, gstNumberError, gstSplit, gstinError, gstinState } from '../src/shared/india.ts';

type Ctx = { db: any; services: number; account: number; contact: (name: string, extra: object) => number; sale: (contactId: number, unitPrice: number, extra?: object) => number };

async function india(body: (c: Ctx) => void) {
  const b = await makeBooks({ name: 'Test', country: 'IN', fiscalYearStart: '04-01', taxEnabled: true });
  b.run(() => {
  updateSettings({ taxId: '27AAPFU0939F1ZV' });
  const { db } = getBooks();
  const services = one<{ id: number }>(db, "SELECT id FROM categories WHERE name = 'Services'")!.id;
  const account = one<{ id: number }>(db, 'INSERT INTO accounts (name, kind, opening_date) VALUES (?, ?, ?) RETURNING id', 'HDFC', 'bank', '2026-04-01')!.id;
  const contact = (name: string, extra: object) => saveContact({ kind: 'customer', name, ...extra });
  const sale = (contactId: number, unitPrice: number, extra: object = {}) => saveInvoice({
    contactId, issueDate: '2026-06-10', dueDate: '2026-07-10', pricesIncludeTax: false, status: 'sent',
    lines: [{ description: 'Design', qtyMilli: 1000, unitPrice, categoryId: services, taxCode: 'GST', hsn: '998391' }],
    ...extra,
  });
  body({ db, services, account, contact, sale });
  });
}

test('GSTIN format, state and checksum', () => {
  assert.equal(gstinError(''), null);
  assert.equal(gstinError('27AAPFU0939F1ZV'), null);
  assert.equal(gstinError('27aapfu0939f1zv'), null);
  assert.match(gstinError('27AAPFU0939F1ZW')!, /doesn't look right/);
  assert.match(gstinError('27AAPFU0939F1Z')!, /15 characters/);
  assert.match(gstinError('99AAPFU0939F1ZV')!, /state code/);
  assert.equal(gstinState('27AAPFU0939F1ZV'), '27');
  assert.equal(COUNTRIES.IN.taxId.check('27AAPFU0939F1ZV'), null);
});

test('GST invoice numbers: 16 characters, letters, digits, hyphen, slash', () => {
  assert.equal(gstNumberError('INV/2026-27/0001'), null);
  assert.match(gstNumberError('INV/2026-27/00012')!, /16 characters/);
  assert.match(gstNumberError('INV 1')!, /letters, digits/);
  assert.match(gstNumberError('INV#1')!, /letters, digits/);
});

test('place of supply decides the split', () => {
  assert.equal(gstSplit('27', '27'), 'intra');
  assert.equal(gstSplit('29', '27'), 'inter');
  assert.equal(gstSplit(EXPORT_PLACE, '27'), 'inter');
  assert.equal(gstSplit(null, '27'), 'inter');
});

test('currency conversion handles different minor units', () => {
  assert.equal(parseFxRate('84.25'), 84_250_000);
  assert.equal(parseFxRate('abc'), null);
  assert.equal(parseFxRate('0'), null);
  assert.equal(toBooks(100_000, 84_250_000, 'USD', 'INR'), 8_425_000); // $1,000.00 is ₹84,250.00
  assert.equal(toBooks(100_000, 560_000, 'JPY', 'INR'), 5_600_000); // ¥100,000 at 0.56 is ₹56,000.00
  assert.equal(toBooks(1000, 270_000_000, 'KWD', 'INR'), 27_000); // KWD 1.000 at 270 is ₹270.00
  const doc = { total: 1000, fcTotal: 3, balance: 1000 };
  assert.equal(foreignBalance(doc), 3);
  assert.equal(carryingValue(1, doc), 333);
  assert.equal(carryingValue(3, doc), 1000, 'paying what is left clears it exactly');
  assert.equal(carryingValue(1, { total: 100, fcTotal: 3, balance: 34 }), 34, 'the last part takes the rounding, not 33');
});

test('within the state, GST halves exactly; between states it is integrated', () => india(({ contact, sale }) => {
  const local = contact('Pune Co', { state: '27', tin: '27AAPFU0939F1ZV' });
  const away = contact('Bengaluru Co', { state: '29' });
  // 18% of ₹1,000.03 is 18,000.54 paise: must round to an even number to halve.
  const a = getInvoice(sale(local, 100_003));
  assert.equal(a.placeOfSupply, '27');
  assert.equal(a.tax % 2, 0);
  assert.equal(a.lines[0].hsn, '998391');
  const c = getInvoice(sale(away, 100_000));
  assert.equal(c.placeOfSupply, '29');
  assert.equal(c.tax, 18_000);
  const r = inGstReport({ from: '2026-06-01', to: '2026-06-30' });
  assert.equal(r.figures.igst, 18_000);
  assert.equal(r.figures.cgst, a.tax / 2);
  assert.equal(r.figures.sgst, a.tax / 2);
  assert.equal(r.figures.taxable, 200_003);
}));

test('a domestic invoice needs a place of supply and a valid number', () => india(({ contact, sale }) => {
  const nowhere = contact('No State Co', {});
  assert.throws(() => sale(nowhere, 100_000), /place of supply/);
  assert.equal(typeof sale(nowhere, 100_000, { status: 'draft' }), 'number', 'a draft can wait');
  const ok = contact('Pune Co', { state: '27' });
  assert.throws(() => sale(ok, 100_000, { number: 'INVOICE-NUMBER-2026-27' }), /16 characters/);
  assert.throws(() => sale(ok, 100_000, { number: 'INV 1' }), /letters, digits/);
}));

test('an invalid customer GSTIN is refused', () => india(({ contact }) => {
  assert.throws(() => contact('Bad', { tin: '27AAPFU0939F1ZW' }), /doesn't look right/);
}));

test('exports under a Letter of Undertaking carry no GST and report as zero-rated', () => india(({ contact, sale }) => {
  const us = contact('Acme Inc', { country: 'US' });
  const inv = getInvoice(sale(us, 100_000));
  assert.equal(inv.placeOfSupply, EXPORT_PLACE);
  assert.equal(inv.exportMode, 'lut');
  assert.equal(inv.tax, 0);
  assert.equal(inv.lines[0].taxCode, 'ZER');
  const r = inGstReport({ from: '2026-06-01', to: '2026-06-30' });
  assert.equal(r.figures.zero, 100_000);
  assert.equal(r.figures.igst, 0);
  const paid = getInvoice(sale(us, 100_000, { exportMode: 'igst' }));
  assert.equal(paid.tax, 18_000, 'or with integrated tax, for a refund');
  assert.equal(inGstReport({ from: '2026-06-01', to: '2026-06-30' }).figures.igst, 18_000);
}));

test('a foreign invoice keeps its prices, and its books figures in rupees', () => india(({ contact, sale }) => {
  const us = contact('Acme Inc', { country: 'US' });
  const inv = getInvoice(sale(us, 100_000, { currency: 'USD', fxRateMicro: 84_000_000 }));
  assert.equal(inv.currency, 'USD');
  assert.equal(inv.fcTotal, 100_000);
  assert.equal(inv.lines[0].unitPrice, 100_000);
  assert.equal(inv.total, 8_400_000);
  assert.equal(inv.lines[0].net, 8_400_000);
  assert.equal(inGstReport({ from: '2026-06-01', to: '2026-06-30' }).figures.zero, 8_400_000);
  assert.throws(() => sale(us, 100_000, { currency: 'USD' }), /exchange rate/);
}));

test('a payment at a better rate clears the invoice and books an exchange gain', () => india(({ contact, sale, account, db }) => {
  const us = contact('Acme Inc', { country: 'US' });
  const id = sale(us, 100_000, { currency: 'USD', fxRateMicro: 84_000_000 });
  recordPayment({ invoiceId: id, date: '2026-07-01', amount: 100_000, received: 8_450_000, accountId: account });
  const inv = getInvoice(id);
  assert.equal(inv.status, 'paid');
  assert.equal(inv.balance, 0);
  assert.equal(inv.payments[0].amount, 8_400_000);
  assert.equal(inv.payments[0].fxGain, 50_000);
  const bank = all<any>(db, 'SELECT kind, amount FROM entries WHERE account_id = ?', account);
  assert.equal(bank.reduce((s: number, e: any) => s + (e.kind === 'income' ? e.amount : -e.amount), 0), 8_450_000);
  const gain = one<any>(db, "SELECT c.class, c.kind FROM entries e JOIN categories c ON c.id = e.category_id WHERE c.name = 'Exchange Gains'");
  assert.equal(gain.class, 'pnl');
  assert.equal(gain.kind, 'income');
  const tb = trialBalance('2026-12-31');
  assert.equal(tb.debit, tb.credit);
  assert.equal(tb.rows.find((r: any) => r.key === 'ar'), undefined, 'nothing left in receivables');
  assert.equal(inGstReport({ from: '2026-07-01', to: '2026-07-31' }).figures.zero, 0, 'the gain is not a supply');
  deletePayment(inv.payments[0].id);
  assert.equal(one<any>(db, 'SELECT COUNT(*) AS n FROM entries').n, 0, 'the gain goes with its payment');
  assert.equal(getInvoice(id).balance, 8_400_000);
}));

test('a payment at a worse rate books a loss, and part payments add up', () => india(({ contact, sale, account, db }) => {
  const us = contact('Acme Inc', { country: 'US' });
  const id = sale(us, 100_000, { currency: 'USD', fxRateMicro: 84_000_000 });
  recordPayment({ invoiceId: id, date: '2026-07-01', amount: 40_000, received: 3_300_000, accountId: account });
  let inv = getInvoice(id);
  assert.equal(inv.status === 'paid', false);
  assert.equal(inv.balance, 8_400_000 - 3_360_000);
  assert.throws(() => recordPayment({ invoiceId: id, date: '2026-07-02', amount: 60_001, received: 1, accountId: account }), /more than/);
  assert.throws(() => recordPayment({ invoiceId: id, date: '2026-07-02', amount: 60_000, accountId: account }), /landed/);
  recordPayment({ invoiceId: id, date: '2026-07-02', amount: 60_000, received: 5_000_000, accountId: account });
  inv = getInvoice(id);
  assert.equal(inv.status, 'paid');
  const loss = one<any>(db, "SELECT SUM(e.amount) AS a FROM entries e JOIN categories c ON c.id = e.category_id WHERE c.name = 'Exchange Losses'");
  assert.equal(loss.a, 8_400_000 - 8_300_000);
  const { lines } = journal({ to: '2026-12-31' });
  assert.equal(lines.reduce((s, l) => s + l.amount, 0), 0);
}));

test('TDS: the client keeps some back, and the invoice still counts as paid', () => india(({ contact, sale, account, db }) => {
  const client = contact('Pune Co', { state: '27', whtRatePpm: 100_000 });
  const id = sale(client, 100_000);
  recordPayment({ invoiceId: id, date: '2026-07-01', amount: 108_000, withheld: 10_000, accountId: account });
  assert.equal(getInvoice(id).status, 'paid');
  const held = one<any>(db, "SELECT e.amount FROM entries e JOIN accounts a ON a.id = e.account_id WHERE a.holds = 'client-wht'");
  assert.equal(held.amount, 10_000);
}));

test('other countries bill abroad too, without any Indian rules', async () => {
  const b = await makeBooks({ name: 'NZ', country: 'NZ', fiscalYearStart: '04-01', taxEnabled: true });
  b.run(() => {
  const { db } = getBooks();
  const services = one<{ id: number }>(db, "SELECT id FROM categories WHERE name = 'Services'")!.id;
  const c = saveContact({ kind: 'customer', name: 'Acme', country: 'US' });
  const inv = getInvoice(saveInvoice({
    contactId: c, issueDate: '2026-06-10', dueDate: '2026-07-10', pricesIncludeTax: false, status: 'sent', number: 'A LONG NUMBER WITH SPACES #1',
    currency: 'USD', fxRateMicro: 1_700_000,
    lines: [{ description: 'Design', qtyMilli: 1000, unitPrice: 100_000, categoryId: services, taxCode: 'ZER' }],
  }));
  assert.equal(inv.total, 170_000);
  assert.equal(inv.placeOfSupply, null);
  });
});

test('money entered without an invoice counts as local in the summary', () => india(({ services, account }) => {
  saveEntry({ date: '2026-06-02', kind: 'income', amount: 118_000, accountId: account, categoryId: services, taxCode: 'GST' });
  const r = inGstReport({ from: '2026-06-01', to: '2026-06-30' });
  assert.equal(r.figures.taxable, 100_000);
  assert.equal(r.figures.cgst, 9_000);
  assert.equal(r.figures.sgst, 9_000);
}));

// ---- a GST rate per line ------------------------------------------------------

const mixed = (services: number, rates: (number | null)[], price = 100_000) => rates.map((taxRatePpm, i) => ({
  description: `Line ${i}`, qtyMilli: 1000, unitPrice: price, categoryId: services, taxCode: 'GST' as const, taxRatePpm,
}));

test('one invoice can carry several GST rates', () => india(({ contact, sale, services, db }) => {
  const local = contact('Pune Co', { state: '27' });
  const inv = getInvoice(sale(local, 0, { lines: mixed(services, [50_000, 180_000, 30_000]) }));
  assert.deepEqual(inv.lines.map((l: any) => [l.taxRatePpm, l.tax]), [[50_000, 5_000], [180_000, 18_000], [30_000, 3_000]]);
  assert.equal(inv.tax, 26_000);
  assert.equal(inv.total, 326_000);
  // Each line's tax halves, so every CGST and SGST pair is exact.
  for (const l of inv.lines as any[]) assert.equal(l.tax % 2, 0);
  assert.ok(one(db, 'SELECT id FROM invoice_lines WHERE tax_rate_ppm = 50000'));
}));

test('a line with no rate takes the books', () => india(({ contact, sale }) => {
  const inv = getInvoice(sale(contact('Pune Co', { state: '27' }), 100_000));
  assert.equal(inv.lines[0].taxRatePpm, 180_000);
  assert.equal(inv.tax, 18_000);
}));

test('only real GST rates are accepted', () => india(({ contact, sale, services }) => {
  const local = contact('Pune Co', { state: '27' });
  assert.throws(() => sale(local, 0, { lines: mixed(services, [77_000]) }), /GST rate/);
  const tax = COUNTRIES.IN.tax!;
  assert.equal(lineRateOr(tax, null, 180_000), 180_000);
  assert.equal(lineRateOr(tax, 50_000, 180_000), 50_000);
  // Every rate on the list can be halved into a printable CGST and SGST.
  for (const r of GST_RATES) assert.ok(Number.isInteger(r.ppm / 2));
}));

test('a zero-rated or exempt line has no rate', () => india(({ contact, sale, services }) => {
  const inv = getInvoice(sale(contact('Pune Co', { state: '27' }), 0, { lines: [
    { description: 'Exempt', qtyMilli: 1000, unitPrice: 100_000, categoryId: services, taxCode: 'EXE', taxRatePpm: 50_000 },
  ] }));
  assert.equal(inv.lines[0].taxRatePpm, null);
  assert.equal(inv.tax, 0);
}));

test('quotes and credit notes keep each line\'s rate', () => india(({ contact, sale, services }) => {
  const local = contact('Pune Co', { state: '27' });
  // An invoice from before the 12% rate ended is credited at 12%, not today's.
  const old = sale(local, 0, { lines: mixed(services, [120_000, 50_000]) });
  const credit = getInvoice(creditInvoice(old, '2026-06-20'));
  assert.deepEqual(credit.lines.map((l: any) => l.taxRatePpm), [120_000, 50_000]);
  assert.equal(credit.tax, 17_000);
  const quote = sale(local, 0, { docType: 'quote', lines: mixed(services, [50_000]) });
  const fromQuote = getInvoice(convertQuote(quote, '2026-06-20'));
  assert.equal(fromQuote.lines[0].taxRatePpm, 50_000);
  assert.equal(fromQuote.tax, 5_000);
}));

test('foreign documents tax each line at its own rate', () => india(({ contact, sale, services }) => {
  const usClient = contact('US Co', { country: 'US' });
  const inv = getInvoice(sale(usClient, 0, { currency: 'USD', fxRateMicro: 80_000_000, exportMode: 'igst', lines: mixed(services, [50_000, 180_000], 10_000) }));
  assert.deepEqual(inv.lines.map((l: any) => l.fcTax), [500, 1_800]);
  assert.deepEqual(inv.lines.map((l: any) => l.tax), [40_000, 144_000]);
}));

test('the totals show one set of tax lines per rate', () => {
  const lines = [{ ratePpm: 180_000, tax: 18_000 }, { ratePpm: 50_000, tax: 5_000 }, { ratePpm: 180_000, tax: 2_000 }, { ratePpm: 30_000, tax: 0 }];
  assert.deepEqual(gstHeads(lines, 'inter'), [{ label: 'IGST @ 5%', value: 5_000 }, { label: 'IGST @ 18%', value: 20_000 }]);
  assert.deepEqual(gstHeads(lines, 'intra'), [
    { label: 'CGST @ 2.5%', value: 2_500 }, { label: 'SGST @ 2.5%', value: 2_500 },
    { label: 'CGST @ 9%', value: 10_000 }, { label: 'SGST @ 9%', value: 10_000 },
  ]);
  assert.deepEqual(gstHeads([{ ratePpm: 2_500, tax: 25 }], 'intra'), [{ label: 'CGST @ 0.125%', value: 13 }, { label: 'SGST @ 0.125%', value: 12 }]);
});

test('bills and entries claim the right credit, by rate', () => india(({ contact, sale, services, account, db }) => {
  const local = contact('Pune Co', { state: '27' });
  const away = contact('Delhi Co', { state: '07' });
  const supplies = one<{ id: number }>(db, "SELECT id FROM categories WHERE name = 'Office Supplies'")!.id;
  sale(local, 0, { lines: mixed(services, [50_000, 180_000]) });
  sale(away, 0, { lines: mixed(services, [50_000]) });
  // A credit note takes its sales back out, at its own rate.
  const credited = sale(local, 0, { lines: mixed(services, [180_000]) });
  saveInvoice({ docType: 'credit', sourceId: credited, contactId: local, issueDate: '2026-06-12', dueDate: '2026-06-12', pricesIncludeTax: false, status: 'sent', lines: mixed(services, [180_000], 10_000) });
  saveInvoice({ docType: 'bill', contactId: saveContact({ kind: 'vendor', name: 'Printer' }), issueDate: '2026-06-11', dueDate: '2026-07-11', pricesIncludeTax: true, status: 'sent',
    lines: [{ description: 'Brochures', qtyMilli: 1000, unitPrice: 105_000, categoryId: supplies, taxCode: 'GST', taxRatePpm: 50_000 }] });
  const paper = saveEntry({ date: '2026-06-15', kind: 'expense', amount: 105_000, accountId: account, categoryId: supplies, taxRatePpm: 50_000 });
  const stored = () => one<any>(db, 'SELECT tax_amount AS t, tax_rate_ppm AS r FROM entries WHERE id = ?', paper);
  assert.deepEqual({ ...stored() }, { t: 5_000, r: 50_000 });
  // Editing it without touching the rate keeps the rate.
  saveEntry({ id: paper, date: '2026-06-16', kind: 'expense', amount: 210_000, accountId: account, categoryId: supplies });
  assert.deepEqual({ ...stored() }, { t: 10_000, r: 50_000 });

  const { figures, byRate } = inGstReport({ from: '2026-06-01', to: '2026-06-30' });
  assert.deepEqual(byRate.map((r: any) => ({ ...r })), [
    { ratePpm: 50_000, sales: 200_000, salesTax: 10_000, purchases: 300_000, credit: 15_000 },
    { ratePpm: 180_000, sales: 190_000, salesTax: 34_200, purchases: 0, credit: 0 },
  ]);
  // The rate table adds up to the return.
  const sum = (k: string) => byRate.reduce((t: number, r: any) => t + r[k], 0);
  assert.equal(sum('sales'), figures.taxable);
  assert.equal(sum('salesTax'), figures.igst + figures.cgst + figures.sgst);
  assert.equal(sum('purchases'), figures.purchases);
  assert.equal(sum('credit'), figures.itc);
  const tb = trialBalance('2026-06-30');
  assert.equal(tb.debit, tb.credit);
}));

test('lines from before per-line rates use the document\'s rate', () => india(({ contact, sale, db }) => {
  const id = sale(contact('Pune Co', { state: '27' }), 100_000);
  db.exec('UPDATE invoice_lines SET tax_rate_ppm = NULL');
  assert.equal(inGstReport({ from: '2026-06-01', to: '2026-06-30' }).byRate[0].ratePpm, 180_000);
  assert.equal(getInvoice(id).lines[0].taxRatePpm, null);
}));

test('a saved item keeps its rate', () => india(({ services }) => {
  saveItem({ kind: 'income', name: 'Brochures', unitPrice: 100, priceIncludesTax: false, categoryId: services, taxCode: 'GST', hsn: '4901', taxRatePpm: 50_000 });
  saveItem({ kind: 'income', name: 'Design', unitPrice: 100, priceIncludesTax: false, categoryId: services, taxCode: 'GST' });
  saveItem({ kind: 'income', name: 'Exempt', unitPrice: 100, priceIncludesTax: false, categoryId: services, taxCode: 'EXE', taxRatePpm: 50_000 });
  const rate = (name: string) => (listItems() as any[]).find((i) => i.name === name).taxRatePpm;
  assert.equal(rate('Brochures'), 50_000);
  assert.equal(rate('Design'), 180_000);
  assert.equal(rate('Exempt'), null);
  assert.throws(() => saveItem({ kind: 'income', name: 'Bad', unitPrice: 100, priceIncludesTax: false, categoryId: services, taxCode: 'GST', taxRatePpm: 77_000 }), /GST rate/);
}));

// Per-line rates are India's alone: anywhere else a rate sent in is ignored, even
// a nonsense one, and nothing is stored.
for (const [country, ppm, taxCode, expected] of [['AU', 100_000, 'GST', 10_000], ['NZ', 150_000, 'GST', 15_000], ['US', 88_750, 'TAX', 8_875]] as const) {
  test(`${country} books have no per-line rate`, async () => {
    const b = await makeBooks({ name: 'Test', country, fiscalYearStart: '07-01', taxEnabled: true, taxRatePpm: ppm });
    b.run(() => {
      const { db } = getBooks();
      const services = one<{ id: number }>(db, "SELECT id FROM categories WHERE name = 'Services'")!.id;
      const account = one<{ id: number }>(db, 'SELECT id FROM accounts LIMIT 1')!.id;
      const customer = saveContact({ kind: 'customer', name: 'Client' });
      const inv = getInvoice(saveInvoice({
        contactId: customer, issueDate: '2026-08-10', dueDate: '2026-09-10', pricesIncludeTax: false, status: 'sent',
        lines: [{ description: 'Design', qtyMilli: 1000, unitPrice: 100_000, categoryId: services, taxCode, taxRatePpm: 77_000 }],
      }));
      assert.equal(inv.tax, expected);
      assert.equal(inv.lines[0].taxRatePpm, null);
      const entry = saveEntry({ date: '2026-08-11', kind: 'income', amount: 110_000, accountId: account, categoryId: services, taxCode, taxRatePpm: 77_000 });
      assert.equal(one<any>(db, 'SELECT tax_rate_ppm AS r FROM entries WHERE id = ?', entry)!.r, null);
      saveItem({ kind: 'income', name: 'Design', unitPrice: 100, priceIncludesTax: false, categoryId: services, taxCode, taxRatePpm: 77_000 });
      assert.equal((listItems() as any[])[0].taxRatePpm, null);
      assert.equal(one<{ n: number }>(db, 'SELECT (SELECT COUNT(*) FROM invoice_lines WHERE tax_rate_ppm IS NOT NULL) + (SELECT COUNT(*) FROM entries WHERE tax_rate_ppm IS NOT NULL) + (SELECT COUNT(*) FROM items WHERE tax_rate_ppm IS NOT NULL) AS n')!.n, 0);
    });
    b.close();
  });
}
