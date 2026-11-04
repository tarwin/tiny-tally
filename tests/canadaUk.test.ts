// Canada's GST/HST and the UK's VAT: rates, returns, and that nothing leaks into other countries.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeBooks } from './support/books.ts';
import { saveContact, saveEntry } from '../backend/entries.ts';
import { creditInvoice, getInvoice, recordPayment, saveInvoice } from '../backend/invoices.ts';
import { listItems, saveItem } from '../backend/items.ts';
import { caGstReport, saveTaxReturn, taxReturnReport, ukVatReport } from '../backend/reports.ts';
import { updateSettings } from '../backend/settings.ts';
import { getBooks, one } from '../backend/db.ts';
import { booksTaxPeriods } from '../src/lib/periods.ts';
import { businessNumberError, caRatePpm, isCaProvince } from '../src/shared/canada.ts';
import { COUNTRIES, defaultLineRate, lineRateText, taxHeadsFor } from '../src/shared/countries.ts';
import { EXPORT_PLACE } from '../src/shared/india.ts';
import { taxCodeLabel, taxCodesFor } from '../src/shared/tax.ts';
import { RETURN_FORMS, rulesFor } from '../src/shared/taxReturns.ts';
import { vatNumberError } from '../src/shared/uk.ts';

async function books(country: 'CA' | 'GB', body: (c: { services: number; expense: number; account: number }) => void) {
  const b = await makeBooks({ name: 'Test', country, fiscalYearStart: COUNTRIES[country].fiscalYearStart, taxEnabled: true });
  b.run(() => {
    const { db } = getBooks();
    const services = one<{ id: number }>(db, "SELECT id FROM categories WHERE name = 'Services'")!.id;
    const expense = one<{ id: number }>(db, "SELECT id FROM categories WHERE name = 'Office Supplies'")!.id;
    const account = one<{ id: number }>(db, 'INSERT INTO accounts (name, kind, opening_date) VALUES (?, ?, ?) RETURNING id', 'Bank', 'bank', '2025-01-01')!.id;
    if (country === 'CA') updateSettings({ homeState: 'ON', taxBasis: 'accrual' });
    body({ services, expense, account });
  });
  b.close();
}

const invoice = (contactId: number, categoryId: number, lines: object[], extra: object = {}) => saveInvoice({
  contactId, issueDate: '2026-06-10', dueDate: '2026-07-10', pricesIncludeTax: false, status: 'sent',
  lines: lines.map((l) => ({ description: 'Work', qtyMilli: 1000, unitPrice: 100_000, categoryId, taxCode: 'GST', ...l })),
  ...extra,
} as any);
const customer = (name: string, extra: object = {}) => saveContact({ kind: 'customer', name, ...extra });

// ---- Canada ----------------------------------------------------------------------

test('Canadian rates by province, against the CRA table', () => {
  for (const p of ['AB', 'BC', 'MB', 'NT', 'NU', 'QC', 'SK', 'YT']) assert.equal(caRatePpm(p, '2026-06-01'), 50_000, p);
  assert.equal(caRatePpm('ON', '2026-06-01'), 130_000);
  for (const p of ['NB', 'NL', 'PE']) assert.equal(caRatePpm(p, '2026-06-01'), 150_000, p);
  assert.equal(caRatePpm(null, '2026-06-01'), 50_000);
  assert.ok(isCaProvince('QC'));
  assert.ok(!isCaProvince('CA'));
});

test('Nova Scotia dropped to 14% on 1 April 2025', () => {
  assert.equal(caRatePpm('NS', '2025-03-31'), 150_000);
  assert.equal(caRatePpm('NS', '2025-04-01'), 140_000);
});

test('Business Number format', () => {
  for (const ok of ['', '123456789', '123456789 RT 0001', '123456789rt0001', '123-456-789']) assert.equal(businessNumberError(ok), null, ok);
  for (const bad of ['12345678', '1234567890', '123456789 RP 0001', 'ABCDEFGHI']) assert.ok(businessNumberError(bad), bad);
});

test("a Canadian sale is charged at the customer's province, in that province's tax", () => books('CA', ({ services }) => {
  const rates = { ON: 13_000, BC: 5_000, NS: 14_000, NB: 15_000, QC: 5_000 };
  for (const [state, tax] of Object.entries(rates)) {
    const inv = getInvoice(invoice(customer(state, { state }), services, [{}]));
    assert.equal(inv.tax, tax, state);
    assert.equal(inv.placeOfSupply, state);
  }
  assert.deepEqual(taxHeadsFor('CA', [{ ratePpm: 130_000, tax: 13_000 }], 'inter'), [{ label: 'HST @ 13%', value: 13_000 }]);
  assert.deepEqual(taxHeadsFor('CA', [{ ratePpm: 50_000, tax: 5_000 }], 'inter'), [{ label: 'GST @ 5%', value: 5_000 }]);
  assert.equal(lineRateText('CA', 140_000), 'HST 14%');
}));

test('an invoice takes the Nova Scotia rate of its own date', () => books('CA', ({ services }) => {
  const ns = customer('Halifax Co', { state: 'NS' });
  assert.equal(getInvoice(invoice(ns, services, [{}], { issueDate: '2025-03-15', dueDate: '2025-04-15' })).tax, 15_000);
  assert.equal(getInvoice(invoice(ns, services, [{}], { issueDate: '2025-04-15', dueDate: '2025-05-15' })).tax, 14_000);
}));

test('approving a Canadian sale needs a province, unless it says where', () => books('CA', ({ services }) => {
  const unknown = customer('No Province Ltd');
  assert.throws(() => invoice(unknown, services, [{}]), /province/);
  assert.equal(getInvoice(invoice(unknown, services, [{}], { placeOfSupply: 'AB' })).tax, 5_000);
  assert.throws(() => invoice(unknown, services, [{}], { placeOfSupply: 'XX' }), /province/);
  // A draft or a quote can wait.
  assert.ok(invoice(unknown, services, [{}], { status: 'draft' }));
  assert.throws(() => customer('Bad', { state: 'XX' }), /province/);
}));

test('a Canadian sale abroad goes outside the provinces, with tax only if a line asks for it', () => books('CA', ({ services }) => {
  const us = customer('Portland Inc', { country: 'US' });
  const zero = getInvoice(invoice(us, services, [{ taxCode: 'ZER' }]));
  assert.equal(zero.placeOfSupply, EXPORT_PLACE);
  assert.equal(zero.tax, 0);
  assert.equal(zero.lines[0].taxRatePpm, null);
  assert.equal(zero.exportMode, null);
}));

test('a Canadian line can be set to another rate, but only one on the list', () => books('CA', ({ services }) => {
  const on = customer('Toronto Co', { state: 'ON' });
  assert.equal(getInvoice(invoice(on, services, [{ taxRatePpm: 50_000 }])).tax, 5_000);
  assert.throws(() => invoice(on, services, [{ taxRatePpm: 77_000 }]), /GST\/HST rate/);
}));

test('Canadian bills and transactions start at the home province, and at what the bill shows', () => books('CA', ({ services, expense, account }) => {
  const vendor = saveContact({ kind: 'vendor', name: 'Printer' });
  const bill = (lines: object[]) => getInvoice(saveInvoice({ docType: 'bill', contactId: vendor, issueDate: '2026-06-10', dueDate: '2026-07-10', pricesIncludeTax: false, status: 'sent', lines: lines.map((l) => ({ description: 'Print', qtyMilli: 1000, unitPrice: 100_000, categoryId: expense, taxCode: 'GST', ...l })) } as any));
  assert.equal(bill([{}]).tax, 13_000);
  assert.equal(bill([{ taxRatePpm: 50_000 }]).tax, 5_000);
  const id = saveEntry({ date: '2026-06-11', kind: 'expense', amount: 11_300, accountId: account, categoryId: expense });
  assert.equal(one<any>(getBooks().db, 'SELECT tax_amount FROM entries WHERE id = ?', id).tax_amount, 1_300);
  // Half the tax on meals: entered by hand, and that's what's claimed.
  const meal = saveEntry({ date: '2026-06-12', kind: 'expense', amount: 11_300, accountId: account, categoryId: expense, taxAmount: 650 });
  assert.equal(one<any>(getBooks().db, 'SELECT tax_amount FROM entries WHERE id = ?', meal).tax_amount, 650);
  assert.equal(caGstReport({ from: '2026-06-01', to: '2026-06-30' }).figures['106'], 13_000 + 5_000 + 1_300 + 650);
  void services;
}));

test('Canadian products follow the sale, so they keep no rate', () => books('CA', ({ services }) => {
  saveItem({ kind: 'income', name: 'Design', unitPrice: 1000, priceIncludesTax: false, categoryId: services, taxCode: 'GST', taxRatePpm: 130_000 } as any);
  assert.equal(listItems()[0].taxRatePpm, null);
}));

test('the GST/HST return adds up, on paid and unpaid invoices alike', () => books('CA', ({ services, expense, account }) => {
  const on = customer('Toronto Co', { state: 'ON' });
  const ab = customer('Calgary Co', { state: 'AB' });
  const paid = invoice(on, services, [{}]); // 1,000 + 130 HST
  invoice(ab, services, [{}]); // 1,000 + 50 GST, unpaid
  recordPayment({ invoiceId: paid, date: '2026-06-20', amount: 113_000, accountId: account });
  invoice(customer('Abroad', { country: 'US' }), services, [{ taxCode: 'ZER', unitPrice: 50_000 }]);
  invoice(on, services, [{ taxCode: 'EXE', unitPrice: 20_000 }]);
  saveEntry({ date: '2026-06-11', kind: 'expense', amount: 11_300, accountId: account, categoryId: expense }); // 13 HST
  const drawings = one<{ id: number }>(getBooks().db, "SELECT id FROM categories WHERE name = 'Owner Drawings'")!.id;
  saveEntry({ date: '2026-06-12', kind: 'expense', amount: 500_000, accountId: account, categoryId: drawings });

  const { figures, byRate, untagged } = taxReturnReport({ from: '2026-06-01', to: '2026-06-30', basis: 'cash' }) as any;
  assert.equal(untagged, 0);
  assert.equal(figures['101'], 100_000 + 100_000 + 50_000 + 20_000);
  assert.equal(figures['103'], 13_000 + 5_000);
  assert.equal(figures['106'], 1_300);
  const form = RETURN_FORMS['ca-gst'];
  assert.equal(form.net(figures, {}), 18_000 - 1_300);
  assert.equal(form.net(figures, { l104: 100, l107: 200, l110: 300, l111: 400 }), 18_000 + 100 - 1_300 - 200 - 300 - 400);
  const rows = form.rows(figures, {});
  assert.equal(rows.find((r) => r.code === '109')!.value, 16_700);
  assert.equal(rows.at(-1)!.code, '115');
  assert.equal(form.rows({ '101': 0, '103': 0, '106': 500 }, {}).at(-1)!.code, '114');
  assert.deepEqual(byRate.map((r: any) => [r.ratePpm, r.salesTax]), [[50_000, 5_000], [130_000, 13_000]]);
  assert.ok(byRate.reduce((t: number, r: any) => t + r.salesTax, 0) === figures['103']);
  // Lodging locks the period, as in every other country.
  saveTaxReturn({ periodStart: '2026-06-01', periodEnd: '2026-06-30', basis: 'accrual', lodge: true });
  assert.throws(() => saveEntry({ date: '2026-06-15', kind: 'expense', amount: 100, accountId: account, categoryId: expense }));
}));

test('credit notes keep the sale\'s province and rate', () => books('CA', ({ services }) => {
  const id = invoice(customer('Moncton Co', { state: 'NB' }), services, [{}]);
  const credit = creditInvoice(id, '2026-06-20');
  const doc = getInvoice(credit as any);
  assert.equal(doc.lines[0].taxRatePpm, 150_000);
  assert.equal(doc.placeOfSupply, 'NB');
}));

// ---- UK ------------------------------------------------------------------------------

test('VAT number format', () => {
  for (const ok of ['', 'GB123456789', 'GB 123 4567 89', '123456789', 'GB123456789012']) assert.equal(vatNumberError(ok), null, ok);
  for (const bad of ['GB12345678', 'GB1234567890', 'FR123456789', 'GB000000000']) assert.ok(vatNumberError(bad), bad);
});

test('UK tax year starts on 6 April and the tax is called VAT', () => {
  const gb = COUNTRIES.GB.tax!;
  assert.equal(COUNTRIES.GB.fiscalYearStart, '04-06');
  assert.equal(COUNTRIES.GB.invoiceTitle(true), 'VAT Invoice');
  assert.equal(COUNTRIES.GB.invoiceTitle(false), 'Invoice');
  assert.equal(taxCodeLabel(gb, 'GST'), 'VAT');
  assert.equal(taxCodesFor(gb, 'income').find((c) => c.code === 'GST')!.label, 'VAT');
  assert.ok(!taxCodesFor(gb, 'expense').some((c) => c.code === 'OOS'), 'outside the scope is a sales code');
  assert.equal(taxCodeLabel(COUNTRIES.AU.tax, 'GST'), 'GST', 'nobody else changes');
});

test('VAT quarters end at month ends in the three sets HMRC uses', () => {
  const at = new Date(2026, 10, 4, 12); // 4 Nov 2026
  const base = { country: 'GB', taxPeriod: 'quarterly' as const, fiscalYearStart: '04-06' };
  const finished = (vatQuarters: string) => booksTaxPeriods({ ...base, vatQuarters }, 3, at).map((p) => [p.from, p.to]);
  assert.deepEqual(finished('01-01'), [['2026-10-01', '2026-12-31'], ['2026-07-01', '2026-09-30'], ['2026-04-01', '2026-06-30']]);
  assert.deepEqual(finished('02-01'), [['2026-11-01', '2027-01-31'], ['2026-08-01', '2026-10-31'], ['2026-05-01', '2026-07-31']]);
  assert.deepEqual(finished('03-01'), [['2026-09-01', '2026-11-30'], ['2026-06-01', '2026-08-31'], ['2026-03-01', '2026-05-31']]);
  // Monthly returns are calendar months too, not 6th to 5th.
  assert.deepEqual(booksTaxPeriods({ ...base, taxPeriod: 'monthly', vatQuarters: '01-01' }, 1, at).map((p) => p.from), ['2026-11-01']);
  // Nobody else moves.
  const nz = booksTaxPeriods({ country: 'NZ', taxPeriod: 'two-monthly', fiscalYearStart: '04-01', vatQuarters: '03-01' }, 1, at)[0];
  assert.equal(nz.from, '2026-10-01');
});

test('a UK invoice mixes 20%, 5% and zero-rated, and prints each rate', () => books('GB', ({ services }) => {
  const c = customer('Bristol Co');
  const doc = getInvoice(invoice(c, services, [{}, { taxRatePpm: 50_000 }, { taxCode: 'ZER' }]));
  assert.equal(doc.tax, 20_000 + 5_000);
  assert.deepEqual(doc.lines.map((l: any) => l.taxRatePpm), [200_000, 50_000, null]);
  assert.deepEqual(taxHeadsFor('GB', doc.lines.map((l: any) => ({ ratePpm: l.taxRatePpm ?? 0, tax: l.tax })), 'inter'), [
    { label: 'VAT @ 5%', value: 5_000 },
    { label: 'VAT @ 20%', value: 20_000 },
  ]);
  assert.throws(() => invoice(c, services, [{ taxRatePpm: 180_000 }]), /VAT rate/);
  assert.equal(doc.placeOfSupply, null, 'the UK has no place of supply to choose');
}));

test('UK products keep their rate, and bills and transactions start at 20%', () => books('GB', ({ services, expense, account }) => {
  saveItem({ kind: 'income', name: 'Energy advice', unitPrice: 1000, priceIncludesTax: false, categoryId: services, taxCode: 'GST', taxRatePpm: 50_000 } as any);
  assert.equal(listItems()[0].taxRatePpm, 50_000);
  const id = saveEntry({ date: '2026-06-11', kind: 'expense', amount: 12_000, accountId: account, categoryId: expense });
  assert.equal(one<any>(getBooks().db, 'SELECT tax_amount FROM entries WHERE id = ?', id).tax_amount, 2_000);
  const reduced = saveEntry({ date: '2026-06-11', kind: 'expense', amount: 10_500, accountId: account, categoryId: expense, taxRatePpm: 50_000 });
  assert.equal(one<any>(getBooks().db, 'SELECT tax_amount FROM entries WHERE id = ?', reduced).tax_amount, 500);
}));

test('the nine boxes: Box 5 is exact, Boxes 6 and 7 cover everything but not-reportable, in whole pounds', () => books('GB', ({ services, expense, account }) => {
  const c = customer('Bristol Co');
  invoice(c, services, [{ unitPrice: 100_050 }, { taxRatePpm: 50_000, unitPrice: 20_000 }, { taxCode: 'ZER', unitPrice: 10_000 }, { taxCode: 'EXE', unitPrice: 5_000 }]);
  invoice(customer('Portland Inc', { country: 'US' }), services, [{ taxCode: 'OOS', unitPrice: 30_000 }]);
  const insurance = one<{ id: number }>(getBooks().db, "SELECT id FROM categories WHERE name = 'Insurance'")!.id;
  saveEntry({ date: '2026-06-11', kind: 'expense', amount: 12_000, accountId: account, categoryId: expense }); // 100 + 20 VAT
  saveEntry({ date: '2026-06-12', kind: 'expense', amount: 3_000, accountId: account, categoryId: insurance }); // exempt
  const drawings = one<{ id: number }>(getBooks().db, "SELECT id FROM categories WHERE name = 'Owner Drawings'")!.id;
  saveEntry({ date: '2026-06-12', kind: 'expense', amount: 900_000, accountId: account, categoryId: drawings });

  const { figures, untagged } = ukVatReport({ from: '2026-04-01', to: '2026-06-30', basis: 'accrual' });
  assert.equal(untagged, 0);
  assert.equal(figures['1'], 20_010 + 1_000);
  assert.equal(figures['4'], 2_000);
  assert.equal(figures['6'], 100_050 + 20_000 + 10_000 + 5_000 + 30_000);
  assert.equal(figures['7'], 10_000 + 3_000);
  const form = RETURN_FORMS['uk-vat'];
  const rows = Object.fromEntries(form.rows(figures, {}).map((r) => [r.code, r.value]));
  assert.equal(rows['3'], 21_010);
  assert.equal(rows['5'], 19_010, 'Box 5 keeps its pence');
  assert.equal(rows['6'], 165_000, 'pence dropped from 165,050');
  assert.equal(form.net(figures, { box2: 500 }), 19_510);
  assert.deepEqual(form.rows(figures, {}).map((r) => r.code), ['1', '2', '3', '4', '5', '6', '7', '8', '9']);
  assert.equal(form.rows(figures, { box8: 12_345 }).find((r) => r.code === '8')!.value, 12_300);
  assert.equal(form.exportsFigures, true);
}));

test('the VAT return can be on the cash basis, for the Cash Accounting Scheme', () => books('GB', ({ services, account }) => {
  const id = invoice(customer('Bristol Co'), services, [{}]);
  assert.equal(ukVatReport({ from: '2026-06-01', to: '2026-06-30', basis: 'accrual' }).figures['1'], 20_000);
  assert.equal(ukVatReport({ from: '2026-06-01', to: '2026-06-30', basis: 'cash' }).figures['1'], 0);
  recordPayment({ invoiceId: id, date: '2026-06-20', amount: 120_000, accountId: account });
  const cash = ukVatReport({ from: '2026-06-01', to: '2026-06-30', basis: 'cash' });
  assert.equal(cash.figures['1'], 20_000);
  assert.deepEqual(cash.byRate, [], 'by rate reads documents, so it would not match cash');
}));

// ---- rules stay in their own countries ---------------------------------------------

test('other countries ignore a line rate, a province and a VAT quarter', async () => {
  for (const country of ['AU', 'NZ', 'US'] as const) {
    assert.equal(defaultLineRate({ country, taxRatePpm: 100_000 }, 'ON', '2026-06-01'), null);
    const b = await makeBooks({ name: 'Test', country, fiscalYearStart: COUNTRIES[country].fiscalYearStart, taxEnabled: true });
    b.run(() => {
      const code = COUNTRIES[country].tax!.defaultCode.sales;
      const services = one<{ id: number }>(getBooks().db, "SELECT id FROM categories WHERE name = 'Services'")!.id;
      const c = customer('Co', country === 'US' ? { state: 'OR' } : {});
      const id = invoice(c, services, [{ taxCode: code, taxRatePpm: 130_000 }], { placeOfSupply: 'ON' });
      const doc = getInvoice(id);
      assert.equal(doc.lines[0].taxRatePpm, null, country);
      assert.equal(doc.placeOfSupply, null, country);
    });
    b.close();
  }
});

test('India is unchanged by Canada: its places and rates stay its own', () => {
  assert.equal(defaultLineRate({ country: 'IN', taxRatePpm: 180_000 }, '27', '2026-06-01'), 180_000);
  assert.deepEqual(taxHeadsFor('IN', [{ ratePpm: 180_000, tax: 18_000 }], 'intra'), [
    { label: 'CGST @ 9%', value: 9_000 },
    { label: 'SGST @ 9%', value: 9_000 },
  ]);
  assert.equal(lineRateText('IN', 50_000), 'GST 5%');
});

test('every country has a return checked for this period, where it has a form', () => {
  assert.equal(rulesFor('ca-gst', '2026-12-31').status, 'checked');
  assert.equal(rulesFor('uk-vat', '2026-12-31').status, 'checked');
});

