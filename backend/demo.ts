// A sample Australian business: a small design studio, GST registered, with
// activity from the start of last financial year up to "today". Everything
// goes through the same save functions the app uses, so it's valid data.
import { all, getBooks, one, run } from './db';
import { saveContact, saveEntry } from './entries';
import {
  applyCredit,
  convertQuote,
  recordPayment,
  saveInvoice,
  saveTemplate,
  setDefaultTemplate,
  setInvoiceStatus,
} from './invoices';
import { finishReconcile, startReconcile, tick } from './reconcile';
import { basReport, saveTaxReturn } from './reports';
import { saveItem } from './items';
import { saveRule } from './rules';
import { saveSchedule } from './schedules';
import { updateSettings } from './settings';
import { defaultTradingNameId, saveTradingName } from './tradingNames';

export const DEMO_NAME = 'Harbour & Pine Studio (Demo)';

// Small deterministic PRNG so the demo is the same every time.
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (y: number, m: number, d: number) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
};
const addDays = (date: string, n: number) => {
  const [y, m, d] = date.split('-').map(Number);
  return ymd(y, m, d + n);
};
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

export function seedDemo(today: string) {
  const { db } = getBooks();
  const r = rng(20250701);
  const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const between = (lo: number, hi: number) => Math.round(lo + r() * (hi - lo));

  const [ty, tm] = today.split('-').map(Number);
  // Start of the previous Australian financial year.
  const startYear = tm >= 7 ? ty - 1 : ty - 2;
  const start = ymd(startYear, 7, 1);

  updateSettings({
    taxId: '51 824 753 556', // the ATO's published example ABN (passes the checksum)
    invoicePrefix: 'HP-',
    invoiceNext: 1001,
    paymentTermsDays: 14,
    pricesIncludeTax: false,
    taxBasis: 'cash',
    taxPeriod: 'quarterly',
  });

  // ---- accounts --------------------------------------------------------------
  const first = one<{ id: number }>(db, 'SELECT id FROM accounts ORDER BY id LIMIT 1')!;
  run(db, "UPDATE accounts SET name = 'Everyday Business', opening_balance = 1845000, opening_date = ? WHERE id = ?", start, first.id);
  const bank = first.id;
  const savings = one<{ id: number }>(db,
    "INSERT INTO accounts (name, kind, opening_balance, opening_date, sort) VALUES ('Tax Savings', 'bank', 600000, ?, 1) RETURNING id", start)!.id;
  const card = one<{ id: number }>(db,
    "INSERT INTO accounts (name, kind, opening_balance, opening_date, sort) VALUES ('Business Visa', 'credit_card', -124000, ?, 2) RETURNING id", start)!.id;

  // ---- categories ------------------------------------------------------------
  const cat = (name: string) => one<{ id: number }>(db, 'SELECT id FROM categories WHERE name = ?', name)!.id;
  run(db, "INSERT INTO categories (name, kind, tax_code) VALUES ('Design Services', 'income', 'GST')");
  run(db, "INSERT INTO categories (name, kind, tax_code) VALUES ('Printing & Production', 'expense', 'GST')");
  const C = {
    design: cat('Design Services'), services: cat('Services'), interest: cat('Interest Income'),
    rent: cat('Rent'), software: cat('Software & Subscriptions'), utilities: cat('Utilities'),
    insurance: cat('Insurance'), bankFees: cat('Bank Fees'), meals: cat('Meals & Entertainment'),
    office: cat('Office Supplies'), contractors: cat('Contractors'), advertising: cat('Advertising & Marketing'),
    equipment: cat('Equipment'), travel: cat('Travel'), licences: cat('Taxes & Licences'),
    printing: cat('Printing & Production'), professional: cat('Professional Fees'),
    basPayment: cat('GST / BAS Payment'), gstRefund: cat('GST Refund'), drawings: cat('Owner Drawings'),
  };

  // ---- products and services ----------------------------------------------------
  const item = (kind: 'income' | 'expense', name: string, unitPrice: number, categoryId: number, description?: string) =>
    saveItem({ kind, name, description, unitPrice, priceIncludesTax: kind === 'expense', categoryId, taxCode: 'GST' });
  item('income', 'Design work (per hour)', 15000, C.design, 'Design and artwork, per hour');
  item('income', 'Logo & brand identity', 320000, C.design, 'Logo design and brand identity: concepts, two rounds of changes, final files');
  item('income', 'Social media design (monthly)', 90000, C.design, 'Monthly social media design');
  item('income', 'Website design (per page)', 85000, C.design);
  item('income', 'Rush fee', 25000, C.design, 'Rush fee for a turnaround under 48 hours');
  item('expense', 'Business cards (250)', 9900, C.printing);
  item('expense', 'Illustration (per hour)', 11000, C.contractors);

  // ---- contacts ----------------------------------------------------------------
  const customer = (name: string, email: string, address: string) =>
    saveContact({ kind: 'customer', name, email, address });
  const vendor = (name: string) => saveContact({ kind: 'vendor', name });
  const customers = {
    bakery: customer('Wattle & Co Bakery', 'accounts@wattleco.example', '4 Crumb St\nMarrickville NSW 2204'),
    physio: customer('Northshore Physio', 'admin@northshorephysio.example', '120 Pacific Hwy\nSt Leonards NSW 2065'),
    wines: customer('Saltbush Wines', 'hello@saltbush.example', '9 Vine Rd\nMudgee NSW 2850'),
    arch: customer('Lumen Architecture', 'studio@lumenarch.example', 'Suite 5, 77 Light St\nNewcastle NSW 2300'),
    festival: customer('Brightside Festival', 'finance@brightside.example', 'PO Box 123\nWollongong NSW 2500'),
    kiwi: customer('Kiwi Trails Ltd', 'ap@kiwitrails.example', '22 Fern Ave\nQueenstown 9300\nNew Zealand'),
  };
  const V = {
    cowork: vendor('Surry Hills Coworking'), pixel: vendor('Pixelworks Software'), cloud: vendor('Cloudnest Hosting'),
    telco: vendor('Telcoz Mobile'), office: vendor('Office Hub Supplies'), insure: vendor('Greenline Insurance'),
    illo: vendor('Sam Rivera Illustration'), cafe: vendor('Corner Cafe'), print: vendor('Inkwell Printers'),
    tech: vendor('Tech Barn'), accountant: vendor('Ledger & Co Accountants'), air: vendor('Skyway Airlines'),
  };

  // ---- invoice templates -----------------------------------------------------------
  const tpl = saveTemplate({
    name: 'Studio (modern)',
    style: 'modern',
    accent: '#0f766e',
    title: 'Tax Invoice',
    footer: 'Thanks for working with us!',
    showTaxColumn: true,
  });
  setDefaultTemplate(tpl);

  // ---- trading names ---------------------------------------------------------------
  // The studio is the default. Map work for the NZ customer goes out as a side line.
  saveTradingName({
    id: defaultTradingNameId(),
    name: 'Harbour & Pine Studio',
    address: 'Level 2, 18 Example Lane\nSurry Hills NSW 2010',
    email: 'hello@harbourpine.example',
    phone: '02 9000 0000',
    paymentDetails: 'Pay by bank transfer\nHarbour & Pine Studio · BSB 000-000 · Account 12345678\nUse the invoice number as the reference.',
  });
  const maps = saveTradingName({
    name: 'Pine Trail Maps',
    address: 'Level 2, 18 Example Lane\nSurry Hills NSW 2010',
    email: 'maps@harbourpine.example',
    paymentDetails: 'Pay by bank transfer\nPine Trail Maps · BSB 000-000 · Account 87654321\nUse the invoice number as the reference.',
  });
  run(db, 'UPDATE contacts SET trading_name_id = ? WHERE id = ?', maps, customers.kiwi);

  const spend = (date: string, amount: number, categoryId: number, opts: { account?: number; contactId?: number; memo?: string; taxCode?: any } = {}) => {
    if (date > today) return;
    saveEntry({ date, kind: 'expense', amount, accountId: opts.account ?? bank, categoryId, contactId: opts.contactId ?? null, memo: opts.memo ?? null, taxCode: opts.taxCode ?? null });
  };
  const earn = (date: string, amount: number, categoryId: number, opts: { account?: number; contactId?: number; memo?: string } = {}) => {
    if (date > today) return;
    saveEntry({ date, kind: 'income', amount, accountId: opts.account ?? bank, categoryId, contactId: opts.contactId ?? null, memo: opts.memo ?? null });
  };
  const transfer = (date: string, amount: number, from: number, to: number, memo: string) => {
    if (date > today || amount <= 0) return;
    saveEntry({ date, kind: 'transfer', amount, accountId: from, toAccountId: to, memo });
  };

  // ---- month by month -------------------------------------------------------------
  const jobs = [
    { c: customers.bakery, items: [['Packaging refresh', 1, 180000], ['Shelf wobblers & signage', 1, 65000]] },
    { c: customers.physio, items: [['Website design: home + 4 pages', 1, 320000]] },
    { c: customers.physio, items: [['Monthly social media design', 1, 90000]] },
    { c: customers.wines, items: [['Label design: 2025 vintage', 3, 85000], ['Print management', 1, 42000]] },
    { c: customers.arch, items: [['Brand identity workshop', 1, 150000], ['Design hours', 12, 14000]] },
    { c: customers.festival, items: [['Festival poster series', 1, 240000], ['Social tiles (set of 12)', 1, 60000]] },
    { c: customers.arch, items: [['Design hours', 8, 14000]] },
    { c: customers.bakery, items: [['Menu boards', 1, 78000]] },
  ];

  let cardSpend = 124000; // the opening balance owed
  const invoiceIds: { id: number; issue: string; total: number }[] = [];
  for (let y = startYear, m = 7; ymd(y, m, 1) <= today; m === 12 ? ((m = 1), y++) : m++) {
    const dim = daysInMonth(y, m);
    const day = (d: number) => ymd(y, m, Math.min(d, dim));

    // Fixed costs
    spend(day(1), 165000, C.rent, { contactId: V.cowork, memo: 'Desk membership' });
    spend(day(3), 8999, C.software, { account: card, contactId: V.pixel, memo: 'Design suite subscription' });
    spend(day(5), 4500, C.software, { account: card, contactId: V.cloud, memo: 'Web hosting' });
    spend(day(12), 7900, C.utilities, { contactId: V.telco, memo: 'Mobile plan' });
    spend(day(dim), 1000, C.bankFees, { memo: 'Account fee' });
    cardSpend += 8999 + 4500;

    // Yearly
    if (m === 7) spend(day(8), 132000, C.insurance, { contactId: V.insure, memo: 'Professional indemnity + public liability' });
    if (m === 8) spend(day(14), 4400, C.licences, { memo: 'Business name renewal' });
    if (m === 9 && y === startYear) spend(day(18), 329900, C.equipment, { account: card, contactId: V.tech, memo: 'Laptop', taxCode: 'CAP' }), (cardSpend += 329900);
    if (m === 3) spend(day(9), 64900, C.equipment, { account: card, contactId: V.tech, memo: 'Second monitor', taxCode: 'CAP' }), (cardSpend += 64900);
    if (m === 10) spend(day(20), 198000, C.professional, { contactId: V.accountant, memo: 'Annual tax return' });

    // Variable costs
    for (let i = 0, n = between(2, 4); i < n; i++) {
      const amt = between(1800, 9500);
      spend(day(between(2, 27)), amt, C.meals, { account: card, contactId: V.cafe, memo: pick(['Client coffee', 'Team lunch', 'Workshop catering']) });
      cardSpend += amt;
    }
    if (r() < 0.5) {
      const amt = between(3500, 18000);
      spend(day(between(2, 27)), amt, C.office, { account: card, contactId: V.office, memo: pick(['Paper & ink', 'Sketchbooks', 'Desk lamp']) });
      cardSpend += amt;
    }
    if (r() < 0.35) {
      const amt = between(15000, 40000);
      spend(day(between(2, 27)), amt, C.advertising, { account: card, memo: 'Social ads' });
      cardSpend += amt;
    }
    if (m % 3 === 0 || r() < 0.25) spend(day(between(10, 25)), between(88000, 220000), C.contractors, { contactId: V.illo, memo: 'Illustration work' });
    if (r() < 0.3) spend(day(between(5, 25)), between(30000, 120000), C.printing, { contactId: V.print, memo: 'Print run' });
    if (r() < 0.15) {
      const amt = between(28000, 62000);
      spend(day(between(5, 25)), amt, C.travel, { account: card, contactId: V.air, memo: 'Flights for client workshop' });
      cardSpend += amt;
    }

    // The owner pays themselves (drawings aren't an expense).
    spend(day(15), 300000, C.drawings, { memo: 'Owner drawings' });

    // Savings interest (input taxed) and sweep to tax savings
    earn(day(dim), between(900, 2400), C.interest, { account: savings, memo: 'Interest' });
    transfer(day(28), 100000, bank, savings, 'Set aside for tax');

    // Pay off last month's card
    transfer(day(20), cardSpend, bank, card, 'Visa payment');
    cardSpend = 0;

    // Sales: 3–5 invoices a month, plus a quarterly export job
    const count = between(3, 5);
    for (let i = 0; i < count; i++) {
      const job = pick(jobs);
      const issue = day(between(1, 26));
      if (issue > today) continue;
      const id = saveInvoice({
        contactId: job.c,
        issueDate: issue,
        dueDate: addDays(issue, 14),
        pricesIncludeTax: false,
        templateId: tpl,
        reference: r() < 0.4 ? `PO ${between(1000, 9999)}` : null,
        lines: job.items.map(([description, qty, price]) => ({
          description: description as string,
          qtyMilli: (qty as number) * 1000,
          unitPrice: Math.round((price as number) * (0.9 + r() * 0.3)),
          categoryId: C.design,
          taxCode: 'GST',
        })),
        status: 'sent',
      });
      const total = one<{ total: number }>(db, 'SELECT total FROM invoices WHERE id = ?', id)!.total;
      invoiceIds.push({ id, issue, total });
    }
    if (m % 3 === 1) {
      const issue = day(between(5, 20));
      if (issue <= today) {
        const id = saveInvoice({
          contactId: customers.kiwi,
          issueDate: issue,
          dueDate: addDays(issue, 30),
          pricesIncludeTax: false,
          templateId: tpl,
          lines: [{ description: 'Trail map illustration (export)', qtyMilli: 1000, unitPrice: between(180000, 260000), categoryId: C.design, taxCode: 'EXP' }],
          status: 'sent',
        });
        invoiceIds.push({ id, issue, total: one<{ total: number }>(db, 'SELECT total FROM invoices WHERE id = ?', id)!.total });
      }
    }
    // A little non-invoiced income now and then
    if (r() < 0.2) earn(day(between(3, 25)), between(22000, 60000), C.services, { memo: 'Workshop tickets' });
  }

  // Payments: most invoices paid 3–30 days after issue. Recent ones are still
  // open, a couple are overdue, and one is part-paid.
  const overdueCutoff = addDays(today, -45);
  invoiceIds.forEach((inv, i) => {
    const paidOn = addDays(inv.issue, between(3, 30));
    const recent = inv.issue > addDays(today, -20);
    const unluckyOverdue = inv.issue > overdueCutoff && inv.issue <= addDays(today, -20) && i % 3 === 0;
    if (recent || unluckyOverdue || paidOn > today) return;
    if (i % 17 === 5) {
      recordPayment({ invoiceId: inv.id, date: paidOn, amount: Math.round(inv.total / 2), accountId: bank, memo: 'Part payment' });
      return;
    }
    recordPayment({ invoiceId: inv.id, date: paidOn, amount: inv.total, accountId: bank });
  });

  // One void and one draft, so every status shows up.
  const voidable = invoiceIds.find((inv) => inv.issue > addDays(today, -60) && !one(db, 'SELECT id FROM entries WHERE invoice_id = ?', inv.id));
  if (voidable) setInvoiceStatus(voidable.id, 'void');
  saveInvoice({
    contactId: customers.festival,
    issueDate: today,
    dueDate: addDays(today, 14),
    pricesIncludeTax: false,
    templateId: tpl,
    notes: 'Deposit invoice: 50% upfront for the 2027 festival campaign.',
    lines: [
      { description: 'Campaign concept & key visual (50% deposit)', qtyMilli: 1000, unitPrice: 275000, categoryId: C.design, taxCode: 'GST' },
    ],
    status: 'draft',
  });

  // ---- bills: the printer invoices monthly on 30-day terms ----------------------
  for (let k = 5; k >= 0; k--) {
    const [y, m] = today.split('-').map(Number);
    const issue = ymd(y, m - k, 10);
    if (issue > today) continue;
    const amount = between(40000, 140000);
    const bill = saveInvoice({
      docType: 'bill',
      contactId: V.print,
      issueDate: issue,
      dueDate: addDays(issue, 30),
      reference: `INK-${between(20000, 29999)}`,
      pricesIncludeTax: true,
      lines: [{ description: pick(['Brochure print run', 'Poster printing', 'Business cards', 'Label proofs']), qtyMilli: 1000, unitPrice: amount, categoryId: C.printing, taxCode: 'GST' }],
      status: 'sent',
    });
    // Older bills are paid on the due date; the latest two are still open.
    const due = addDays(issue, 30);
    if (k >= 2 && due <= today) recordPayment({ invoiceId: bill, date: due, amount, accountId: bank });
  }

  // ---- quotes: one accepted (now an invoice), one open, one declined -------------
  const quote = (contactId: number, issue: string, lines: [string, number, number][]) =>
    saveInvoice({
      docType: 'quote',
      contactId,
      issueDate: issue,
      dueDate: addDays(issue, 30),
      pricesIncludeTax: false,
      templateId: tpl,
      lines: lines.map(([description, qty, price]) => ({ description, qtyMilli: qty * 1000, unitPrice: price, categoryId: C.design, taxCode: 'GST' })),
      status: 'sent',
    });
  const accepted = quote(customers.wines, addDays(today, -12), [['Cellar door signage package', 1, 380000], ['Install supervision (hours)', 6, 12000]]);
  convertQuote(accepted, addDays(today, -5));
  quote(customers.arch, addDays(today, -3), [['Annual report design (32pp)', 1, 640000], ['Infographics', 6, 35000]]);
  const declined = quote(customers.bakery, addDays(today, -40), [['Shopfront mural concept', 1, 420000]]);
  setInvoiceStatus(declined, 'void');

  // ---- a credit note: a discount on the latest unpaid invoice ---------------------
  const unpaid = one<any>(db,
    `SELECT i.id, i.contact_id, i.total FROM invoices i WHERE i.doc_type = 'invoice' AND i.status = 'sent'
       AND NOT EXISTS (SELECT 1 FROM entries e WHERE e.invoice_id = i.id) AND i.issue_date < ?
     ORDER BY i.issue_date LIMIT 1`, addDays(today, -2));
  if (unpaid) {
    const credit = saveInvoice({
      docType: 'credit',
      contactId: unpaid.contact_id,
      issueDate: addDays(today, -2),
      dueDate: addDays(today, -2),
      sourceId: unpaid.id,
      pricesIncludeTax: false,
      templateId: tpl,
      notes: 'Goodwill discount agreed while chasing this overdue invoice.',
      lines: [{ description: 'Discount on late proofs', qtyMilli: 1000, unitPrice: 20000, categoryId: C.design, taxCode: 'GST' }],
      status: 'sent',
    });
    applyCredit({ creditId: credit, invoiceId: unpaid.id, amount: 22000, date: addDays(today, -2) });
  }

  // ---- recurring: rent and a monthly retainer invoice --------------------------------
  const [ny, nm] = today.split('-').map(Number);
  const nextMonth = (d: number) => ymd(ny, nm + 1, d);
  saveSchedule({
    kind: 'entry',
    name: 'Desk membership',
    frequency: 'monthly',
    startDate: nextMonth(1),
    payload: { kind: 'expense', amount: 165000, accountId: bank, categoryId: C.rent, contactId: V.cowork, memo: 'Desk membership' },
  });
  saveSchedule({
    kind: 'invoice',
    name: 'Northshore Physio retainer',
    frequency: 'monthly',
    startDate: nextMonth(1),
    autoApprove: false,
    payload: {
      contactId: customers.physio,
      dueDays: 14,
      pricesIncludeTax: false,
      templateId: tpl,
      lines: [{ description: 'Monthly social media design', qtyMilli: 1000, unitPrice: 90000, categoryId: C.design, taxCode: 'GST' }],
    },
  });

  // ---- import rules ------------------------------------------------------------------
  saveRule({ pattern: 'Social ads', categoryId: C.advertising });
  saveRule({ pattern: 'Corner Cafe', categoryId: C.meals, contactId: V.cafe });

  // Lodge the BAS quarters of the last full financial year; leave the most
  // recent finished quarter as a draft to review.
  const quarters: [string, string][] = [];
  for (let q = 0; q < 8; q++) {
    const qs = ymd(startYear, 7 + q * 3, 1);
    const [qy, qm] = qs.split('-').map(Number);
    const qe = ymd(qy, qm + 3, 0);
    if (qe < today) quarters.push([qs, qe]);
  }
  const lodgeUntil = ymd(startYear + 1, 6, 30);
  // Pay each lodged quarter from tax savings on the 28th of the second month
  // after it ends (the usual quarterly due date). Done before lodging, which
  // locks the books.
  for (const [qs, qe] of quarters) {
    if (qe > lodgeUntil) continue;
    const { figures } = basReport({ from: qs, to: qe, basis: 'cash' });
    const owed = Math.trunc(figures['1A'] / 100) * 100 - Math.trunc(figures['1B'] / 100) * 100 + 125000;
    const [qy, qm] = qe.split('-').map(Number);
    const payDay = ymd(qy, qm + 2, 28);
    if (payDay > today) continue;
    if (owed > 0) spend(payDay, owed, C.basPayment, { account: savings, memo: `BAS ${qs.slice(0, 7)} to ${qe.slice(0, 7)}` });
    else if (owed < 0) earn(payDay, -owed, C.gstRefund, { account: savings, memo: `BAS refund ${qs.slice(0, 7)} to ${qe.slice(0, 7)}` });
  }

  // Reconcile the everyday account up to the end of last month.
  const recTo = ymd(ny, nm, 0);
  const balanceAt = one<{ b: number }>(db,
    `SELECT a.opening_balance
       + COALESCE((SELECT SUM(CASE WHEN e.to_account_id = a.id THEN e.amount WHEN e.kind = 'income' THEN e.amount ELSE -e.amount END)
                   FROM entries e WHERE (e.account_id = a.id OR e.to_account_id = a.id) AND e.date <= ?), 0) AS b
     FROM accounts a WHERE a.id = ?`, recTo, bank)!.b;
  const rec = startReconcile({ accountId: bank, statementDate: recTo, statementBalance: balanceAt });
  tick({
    recId: rec,
    entryIds: all<{ id: number }>(db, 'SELECT id FROM entries WHERE (account_id = ?1 OR to_account_id = ?1) AND date <= ?2', bank, recTo).map((e) => e.id),
    cleared: true,
  });
  finishReconcile(rec);

  for (const [qs, qe] of quarters) {
    saveTaxReturn({ periodStart: qs, periodEnd: qe, basis: 'cash', inputs: { t7: 125000 }, lodge: qe <= lodgeUntil });
  }

  return all(db, 'SELECT COUNT(*) AS n FROM entries')[0];
}
