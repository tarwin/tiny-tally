// Sample businesses, one per country: a small design studio with activity
// from the start of last financial year up to "today". Everything goes
// through the same save functions the app uses, so it's valid data.
//
//   AU  Harbour & Pine Studio, Sydney: GST, quarterly BAS, PAYG instalments
//   NZ  Kōwhai Lane Design, Wellington: GST two-monthly, provisional tax, a
//       client that withholds tax (schedular payments)
//   US  Cedar & Finch Studio, Portland: no sales tax (Oregon has none),
//       quarterly estimated tax, a 1099 contractor
//
// Each also has car trips, an asset register with depreciation posted, and
// returns lodged for the last full year.
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
import { saveTaxReturn, taxReturnReport } from './reports';
import { saveItem } from './items';
import { saveRule } from './rules';
import { saveSchedule } from './schedules';
import { updateSettings } from './settings';
import { defaultTradingNameId, saveTradingName } from './tradingNames';
import { saveTrip } from './trips';
import { setYearInputs } from './taxYear';
import { postDepreciation, saveAsset } from './assets';
import { RETURN_FORMS } from '../src/shared/taxReturns';
import { basDue, nzGstDue, provisionalDue } from '../src/shared/dueDates';
import { incomeYearOf, incomeYearRange } from '../src/shared/incomeYear';
import type { Country } from '../src/shared/countries';

export const DEMO_NAMES: Record<Country, string> = {
  AU: 'Harbour & Pine Studio (Demo)',
  NZ: 'Kōwhai Lane Design (Demo)',
  US: 'Cedar & Finch Studio (Demo)',
};
export const DEMO_NAME = DEMO_NAMES.AU;

/** How each demo's books are made (createBooks). */
export const DEMO_SETUP: Record<Country, { country: Country; fiscalYearStart: string; taxEnabled: boolean }> = {
  AU: { country: 'AU', fiscalYearStart: '07-01', taxEnabled: true },
  NZ: { country: 'NZ', fiscalYearStart: '04-01', taxEnabled: true },
  US: { country: 'US', fiscalYearStart: '01-01', taxEnabled: false },
};

interface Spec {
  /** Month the financial year starts. */
  fyMonth: number;
  settings: Record<string, unknown>;
  /** Tax codes: sales, exports, equipment bought. null where there's no tax. */
  sale: string | null;
  exportCode: string | null;
  equipmentCode: string | null;
  equipment: string;
  taxPayment: string | null;
  taxRefund: string | null;
  template: { accent: string; title: string; showTaxColumn: boolean };
  customers: Record<'bakery' | 'physio' | 'wines' | 'arch' | 'festival' | 'abroad', [string, string, string]>;
  vendors: Record<'cowork' | 'pixel' | 'cloud' | 'telco' | 'office' | 'insure' | 'illo' | 'cafe' | 'print' | 'tech' | 'accountant' | 'air', string>;
  tradingName: { name: string; address: string; email: string; phone: string; bank: string };
  sideLine: { name: string; email: string; bank: string };
  abroadWork: string;
  trip: { places: string[]; distance: [number, number]; vehicle: string };
  asset: { name: string; cost: number; method: 'pool' | 'dv' | 'macrs5'; lifeYears?: number; ratePct?: number };
}

const SPECS: Record<Country, Spec> = {
  AU: {
    fyMonth: 7,
    settings: { taxId: '51 824 753 556', invoicePrefix: 'HP-', pricesIncludeTax: false, taxPeriod: 'quarterly' }, // the ATO's published example ABN
    sale: 'GST', exportCode: 'EXP', equipmentCode: 'CAP', equipment: 'Equipment',
    taxPayment: 'GST / BAS Payment', taxRefund: 'GST Refund',
    template: { accent: '#0f766e', title: 'Tax Invoice', showTaxColumn: true },
    customers: {
      bakery: ['Wattle & Co Bakery', 'accounts@wattleco.example', '4 Crumb St\nMarrickville NSW 2204'],
      physio: ['Northshore Physio', 'admin@northshorephysio.example', '120 Pacific Hwy\nSt Leonards NSW 2065'],
      wines: ['Saltbush Wines', 'hello@saltbush.example', '9 Vine Rd\nMudgee NSW 2850'],
      arch: ['Lumen Architecture', 'studio@lumenarch.example', 'Suite 5, 77 Light St\nNewcastle NSW 2300'],
      festival: ['Brightside Festival', 'finance@brightside.example', 'PO Box 123\nWollongong NSW 2500'],
      abroad: ['Kiwi Trails Ltd', 'ap@kiwitrails.example', '22 Fern Ave\nQueenstown 9300\nNew Zealand'],
    },
    vendors: {
      cowork: 'Surry Hills Coworking', pixel: 'Pixelworks Software', cloud: 'Cloudnest Hosting', telco: 'Telcoz Mobile',
      office: 'Office Hub Supplies', insure: 'Greenline Insurance', illo: 'Sam Rivera Illustration', cafe: 'Corner Cafe',
      print: 'Inkwell Printers', tech: 'Tech Barn', accountant: 'Ledger & Co Accountants', air: 'Skyway Airlines',
    },
    tradingName: {
      name: 'Harbour & Pine Studio', address: 'Level 2, 18 Example Lane\nSurry Hills NSW 2010', email: 'hello@harbourpine.example',
      phone: '02 9000 0000', bank: 'Harbour & Pine Studio · BSB 000-000 · Account 12345678',
    },
    sideLine: { name: 'Pine Trail Maps', email: 'maps@harbourpine.example', bank: 'Pine Trail Maps · BSB 000-000 · Account 87654321' },
    abroadWork: 'Trail map illustration (export)',
    trip: { places: ['Marrickville', 'St Leonards', 'Newcastle', 'Wollongong', 'Mudgee'], distance: [120, 1650], vehicle: 'Corolla' },
    asset: { name: 'Large-format printer', cost: 2_400_000, method: 'pool' },
  },
  NZ: {
    fyMonth: 4,
    settings: { taxId: '49-091-850', invoicePrefix: 'KL-', pricesIncludeTax: false, taxPeriod: 'two-monthly' }, // IRD's example number
    sale: 'GST', exportCode: 'ZER', equipmentCode: 'GST', equipment: 'Equipment',
    taxPayment: 'GST Payment', taxRefund: 'GST Refund',
    template: { accent: '#b45309', title: 'Tax Invoice', showTaxColumn: true },
    customers: {
      bakery: ['Rimu Street Bakery', 'accounts@rimubakery.example', '14 Rimu St\nPetone, Lower Hutt 5012'],
      physio: ['Harbourside Physio', 'admin@harbourphysio.example', '200 Lambton Quay\nWellington 6011'],
      wines: ['Tītī Ridge Wines', 'hello@titiridge.example', '8 Vineyard Rd\nMartinborough 5711'],
      arch: ['Whare Studio Architects', 'studio@whare.example', 'Level 3, 50 Cuba St\nWellington 6011'],
      festival: ['Aro Valley Productions', 'finance@aroprod.example', 'PO Box 4021\nWellington 6140'],
      abroad: ['Bondi Trails Pty Ltd', 'ap@bonditrails.example', '22 Campbell Pde\nBondi Beach NSW 2026\nAustralia'],
    },
    vendors: {
      cowork: 'Cuba St Coworking', pixel: 'Pixelworks Software', cloud: 'Cloudnest Hosting', telco: 'Kererū Mobile',
      office: 'Warehouse Office Supplies', insure: 'Tōtara Insurance', illo: 'Mere Tane Illustration', cafe: 'Fidel’s Corner',
      print: 'Inkwell Print Wellington', tech: 'Tech Barn NZ', accountant: 'Ledger & Co Chartered Accountants', air: 'Air Aotearoa',
    },
    tradingName: {
      name: 'Kōwhai Lane Design', address: 'Level 1, 9 Example Lane\nTe Aro, Wellington 6011', email: 'kia.ora@kowhailane.example',
      phone: '04 000 0000', bank: 'Kōwhai Lane Design · 00-0000-0000000-00',
    },
    sideLine: { name: 'Kōwhai Maps', email: 'maps@kowhailane.example', bank: 'Kōwhai Maps · 00-0000-0000001-00' },
    abroadWork: 'Trail map illustration (zero-rated export)',
    trip: { places: ['Petone', 'Lambton Quay', 'Martinborough', 'Porirua', 'Upper Hutt'], distance: [90, 1400], vehicle: 'Prius' },
    asset: { name: 'MacBook Pro', cost: 459_000, method: 'dv', ratePct: 50 },
  },
  US: {
    fyMonth: 1,
    settings: { taxId: '12-3456789', invoicePrefix: 'CF-', pricesIncludeTax: false, homeState: 'OR' },
    sale: null, exportCode: null, equipmentCode: null, equipment: 'Equipment & Assets',
    taxPayment: null, taxRefund: null,
    template: { accent: '#1d4ed8', title: 'Invoice', showTaxColumn: false },
    customers: {
      bakery: ['Fern & Flour Bakery', 'accounts@fernflour.example', '412 SE Division St\nPortland, OR 97202'],
      physio: ['Riverside Physical Therapy', 'admin@riversidept.example', '1200 NW Everett St\nPortland, OR 97209'],
      wines: ['Willamette Hills Winery', 'hello@willamettehills.example', '9 Vineyard Rd\nDundee, OR 97115'],
      arch: ['Lumen Architecture', 'studio@lumenarch.example', 'Suite 500, 77 SW Yamhill St\nPortland, OR 97204'],
      festival: ['Brightside Festival', 'finance@brightside.example', 'PO Box 123\nEugene, OR 97401'],
      abroad: ['Coastline Trails Ltd', 'ap@coastlinetrails.example', '22 Water St\nVancouver, BC V6B 1A1\nCanada'],
    },
    vendors: {
      cowork: 'Pearl District Coworking', pixel: 'Pixelworks Software', cloud: 'Cloudnest Hosting', telco: 'Cascade Mobile',
      office: 'Office Hub Supplies', insure: 'Greenline Insurance', illo: 'Sam Rivera Illustration', cafe: 'Corner Coffee',
      print: 'Inkwell Printers', tech: 'Tech Barn', accountant: 'Ledger & Co CPAs', air: 'Skyway Airlines',
    },
    tradingName: {
      name: 'Cedar & Finch Studio', address: '18 Example Lane, Suite 2\nPortland, OR 97209', email: 'hello@cedarfinch.example',
      phone: '(503) 555-0100', bank: 'Cedar & Finch Studio · Routing 000000000 · Account 12345678',
    },
    sideLine: { name: 'Finch Trail Maps', email: 'maps@cedarfinch.example', bank: 'Finch Trail Maps · Routing 000000000 · Account 87654321' },
    abroadWork: 'Trail map illustration',
    trip: { places: ['Division St', 'NW Everett', 'Dundee', 'Downtown', 'Beaverton'], distance: [40, 900], vehicle: 'RAV4' },
    asset: { name: 'MacBook Pro', cost: 349_900, method: 'macrs5' },
  },
};

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

export function seedDemo(today: string, country: Country = 'AU') {
  const { db } = getBooks();
  const S = SPECS[country];
  const r = rng(20250701);
  const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const between = (lo: number, hi: number) => Math.round(lo + r() * (hi - lo));
  const fyStart = `${pad(S.fyMonth)}-01`;

  const [ty, tm] = today.split('-').map(Number);
  // Start of the previous financial year.
  const startYear = (tm >= S.fyMonth ? ty : ty - 1) - 1;
  const start = ymd(startYear, S.fyMonth, 1);

  updateSettings({ invoiceNext: 1001, paymentTermsDays: 14, taxBasis: 'cash', ...S.settings } as any);

  // ---- accounts --------------------------------------------------------------
  const first = one<{ id: number }>(db, 'SELECT id FROM accounts ORDER BY id LIMIT 1')!;
  run(db, 'UPDATE accounts SET name = ?, opening_balance = 1845000, opening_date = ? WHERE id = ?',
    country === 'US' ? 'Business Checking' : 'Everyday Business', start, first.id);
  const bank = first.id;
  const savings = one<{ id: number }>(db,
    "INSERT INTO accounts (name, kind, opening_balance, opening_date, sort) VALUES ('Tax Savings', 'bank', 600000, ?, 1) RETURNING id", start)!.id;
  const card = one<{ id: number }>(db,
    "INSERT INTO accounts (name, kind, opening_balance, opening_date, sort) VALUES ('Business Visa', 'credit_card', -124000, ?, 2) RETURNING id", start)!.id;

  // ---- categories ------------------------------------------------------------
  const cat = (name: string) => one<{ id: number }>(db, 'SELECT id FROM categories WHERE name = ?', name)?.id ?? 0;
  const lineFor = (kind: 'income' | 'expense') =>
    country === 'AU' ? (kind === 'income' ? 'au-other-income' : 'au-purchases')
    : country === 'NZ' ? (kind === 'income' ? 'nz-sales' : 'nz-purchases')
    : (kind === 'income' ? 'gross-receipts' : 'supplies');
  run(db, 'INSERT INTO categories (name, kind, tax_code, report_line) VALUES (?, ?, ?, ?)', 'Design Services', 'income', S.sale ?? 'NON', lineFor('income'));
  run(db, 'INSERT INTO categories (name, kind, tax_code, report_line) VALUES (?, ?, ?, ?)', 'Printing & Production', 'expense', S.sale ?? 'NTR', lineFor('expense'));
  const C = {
    design: cat('Design Services'), services: cat('Services'), interest: cat('Interest Income'),
    rent: cat('Rent'), software: cat('Software & Subscriptions'), utilities: cat('Utilities'),
    insurance: cat('Insurance'), bankFees: cat('Bank Fees'), meals: cat('Meals & Entertainment'),
    office: cat('Office Supplies'), contractors: cat('Contractors'), advertising: cat('Advertising & Marketing'),
    equipment: cat(S.equipment), travel: cat('Travel'), licences: cat('Taxes & Licences'),
    printing: cat('Printing & Production'), professional: cat('Professional Fees'),
    taxPayment: S.taxPayment ? cat(S.taxPayment) : 0, taxRefund: S.taxRefund ? cat(S.taxRefund) : 0,
    drawings: cat('Owner Drawings'), incomeTax: cat('Income Tax Payment'),
  };

  // ---- products and services ----------------------------------------------------
  const item = (kind: 'income' | 'expense', name: string, unitPrice: number, categoryId: number, description?: string) =>
    saveItem({ kind, name, description, unitPrice, priceIncludesTax: kind === 'expense' && !!S.sale, categoryId, taxCode: (S.sale ?? (kind === 'income' ? 'NON' : 'NTR')) as any });
  item('income', 'Design work (per hour)', 15000, C.design, 'Design and artwork, per hour');
  item('income', 'Logo & brand identity', 320000, C.design, 'Logo design and brand identity: concepts, two rounds of changes, final files');
  item('income', 'Social media design (monthly)', 90000, C.design, 'Monthly social media design');
  item('income', 'Website design (per page)', 85000, C.design);
  item('income', 'Rush fee', 25000, C.design, 'Rush fee for a turnaround under 48 hours');
  item('expense', 'Business cards (250)', 9900, C.printing);
  item('expense', 'Illustration (per hour)', 11000, C.contractors);

  // ---- contacts ----------------------------------------------------------------
  const customer = ([name, email, address]: [string, string, string], extra: Record<string, unknown> = {}) =>
    saveContact({ kind: 'customer', name, email, address, ...extra });
  const vendor = (name: string, extra: Record<string, unknown> = {}) => saveContact({ kind: 'vendor', name, ...extra });
  const customers = {
    bakery: customer(S.customers.bakery),
    physio: customer(S.customers.physio),
    wines: customer(S.customers.wines),
    arch: customer(S.customers.arch),
    // NZ: a production company that takes 20% withholding tax off what it pays (schedular payments).
    festival: customer(S.customers.festival, country === 'NZ' ? { whtRatePpm: 200_000 } : {}),
    abroad: customer(S.customers.abroad),
  };
  const V = Object.fromEntries(Object.entries(S.vendors).map(([k, name]) => [k,
    // US: the illustrator gets a 1099-NEC.
    k === 'illo' && country === 'US'
      ? vendor(name, { is1099: true, legalName: 'Samuel Rivera', tin: '98-7654321', address: '77 N Mississippi Ave\nPortland, OR 97227', email: 'sam@riveraillustration.example' })
      : vendor(name)])) as Record<keyof Spec['vendors'], number>;

  // ---- invoice templates -----------------------------------------------------------
  const tpl = saveTemplate({
    name: 'Studio (modern)',
    style: 'modern',
    accent: S.template.accent,
    title: S.template.title,
    footer: 'Thanks for working with us!',
    showTaxColumn: S.template.showTaxColumn,
  });
  setDefaultTemplate(tpl);

  // ---- trading names ---------------------------------------------------------------
  // The studio is the default. Map work for the overseas customer goes out as a side line.
  const T = S.tradingName;
  saveTradingName({
    id: defaultTradingNameId(),
    name: T.name,
    address: T.address,
    email: T.email,
    phone: T.phone,
    paymentDetails: `Pay by bank transfer\n${T.bank}\nUse the invoice number as the reference.`,
  });
  const maps = saveTradingName({
    name: S.sideLine.name,
    address: T.address,
    email: S.sideLine.email,
    paymentDetails: `Pay by bank transfer\n${S.sideLine.bank}\nUse the invoice number as the reference.`,
  });
  run(db, 'UPDATE contacts SET trading_name_id = ? WHERE id = ?', maps, customers.abroad);

  const spend = (date: string, amount: number, categoryId: number, opts: { account?: number; contactId?: number; memo?: string; taxCode?: any } = {}) => {
    if (date > today || !categoryId) return 0;
    return saveEntry({ date, kind: 'expense', amount, accountId: opts.account ?? bank, categoryId, contactId: opts.contactId ?? null, memo: opts.memo ?? null, taxCode: opts.taxCode ?? null });
  };
  const earn = (date: string, amount: number, categoryId: number, opts: { account?: number; contactId?: number; memo?: string } = {}) => {
    if (date > today || !categoryId) return;
    saveEntry({ date, kind: 'income', amount, accountId: opts.account ?? bank, categoryId, contactId: opts.contactId ?? null, memo: opts.memo ?? null });
  };
  const transfer = (date: string, amount: number, from: number, to: number, memo: string) => {
    if (date > today || amount <= 0) return;
    saveEntry({ date, kind: 'transfer', amount, accountId: from, toAccountId: to, memo });
  };

  // ---- month by month -------------------------------------------------------------
  const sale = S.sale as any;
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
  let assetEntry: { id: number; date: string; amount: number } | null = null;
  const invoiceIds: { id: number; issue: string; total: number; contactId: number }[] = [];
  for (let y = startYear, m = S.fyMonth; ymd(y, m, 1) <= today; m === 12 ? ((m = 1), y++) : m++) {
    const dim = daysInMonth(y, m);
    const day = (d: number) => ymd(y, m, Math.min(d, dim));
    const monthOfYear = ((m - S.fyMonth + 12) % 12) + 1;
    const firstYear = ymd(y, m, 1) < ymd(startYear + 1, S.fyMonth, 1);

    // Fixed costs
    spend(day(1), 165000, C.rent, { contactId: V.cowork, memo: 'Desk membership' });
    spend(day(3), 8999, C.software, { account: card, contactId: V.pixel, memo: 'Design suite subscription' });
    spend(day(5), 4500, C.software, { account: card, contactId: V.cloud, memo: 'Web hosting' });
    spend(day(12), 7900, C.utilities, { contactId: V.telco, memo: 'Mobile plan' });
    spend(day(dim), 1000, C.bankFees, { memo: 'Account fee' });
    cardSpend += 8999 + 4500;

    // Yearly
    if (monthOfYear === 1) spend(day(8), 132000, C.insurance, { contactId: V.insure, memo: 'Professional indemnity + public liability' });
    if (monthOfYear === 2) spend(day(14), 4400, C.licences, { memo: 'Business name renewal' });
    if (monthOfYear === 3 && firstYear) {
      // The big purchase of the year, which goes in the asset register.
      const amount = S.sale ? Math.round(S.asset.cost * (country === 'AU' ? 1.1 : 1.15)) : S.asset.cost;
      const id = spend(day(18), amount, C.equipment, { account: card, contactId: V.tech, memo: S.asset.name, taxCode: S.equipmentCode });
      if (id) assetEntry = { id, date: day(18), amount };
      cardSpend += amount;
    }
    if (monthOfYear === 9) spend(day(9), 64900, C.equipment, { account: card, contactId: V.tech, memo: 'Second monitor', taxCode: S.equipmentCode }), (cardSpend += 64900);
    if (monthOfYear === 4) spend(day(20), 198000, C.professional, { contactId: V.accountant, memo: 'Annual tax return' });

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

    // Car trips to clients: a few a month.
    for (let i = 0, n = between(2, 5); i < n; i++) {
      const date = day(between(2, 27));
      if (date > today) continue;
      const to = pick(S.trip.places);
      saveTrip({
        date, distanceTenths: between(S.trip.distance[0], S.trip.distance[1]), vehicle: S.trip.vehicle,
        purpose: pick(['Client meeting', 'Press check at the printer', 'Photo shoot', 'Delivering proofs', 'Brand workshop']),
        fromPlace: 'Studio', toPlace: to,
      });
    }

    // The owner pays themselves (drawings aren't an expense).
    spend(day(15), 300000, C.drawings, { memo: 'Owner drawings' });

    // Savings interest and sweep to tax savings
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
          taxCode: sale,
        })),
        status: 'sent',
      });
      const total = one<{ total: number }>(db, 'SELECT total FROM invoices WHERE id = ?', id)!.total;
      invoiceIds.push({ id, issue, total, contactId: job.c });
    }
    if (m % 3 === 1) {
      const issue = day(between(5, 20));
      if (issue <= today) {
        const id = saveInvoice({
          contactId: customers.abroad,
          issueDate: issue,
          dueDate: addDays(issue, 30),
          pricesIncludeTax: false,
          templateId: tpl,
          lines: [{ description: S.abroadWork, qtyMilli: 1000, unitPrice: between(180000, 260000), categoryId: C.design, taxCode: S.exportCode as any }],
          status: 'sent',
        });
        invoiceIds.push({ id, issue, total: one<{ total: number }>(db, 'SELECT total FROM invoices WHERE id = ?', id)!.total, contactId: customers.abroad });
      }
    }
    // A little non-invoiced income now and then
    if (r() < 0.2) earn(day(between(3, 25)), between(22000, 60000), C.services, { memo: 'Workshop tickets' });
  }

  // Payments: most invoices paid 3–30 days after issue. Recent ones are still
  // open, a couple are overdue, and one is part-paid. In New Zealand the
  // production company keeps back 20% of the amount before GST.
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
    if (country === 'NZ' && inv.contactId === customers.festival) {
      const tax = one<{ tax: number }>(db, 'SELECT tax FROM invoices WHERE id = ?', inv.id)!.tax;
      const withheld = Math.round((inv.total - tax) * 0.2);
      recordPayment({ invoiceId: inv.id, date: paidOn, amount: inv.total - withheld, withheld, accountId: bank });
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
    notes: 'Deposit invoice: 50% upfront for next year’s festival campaign.',
    lines: [
      { description: 'Campaign concept & key visual (50% deposit)', qtyMilli: 1000, unitPrice: 275000, categoryId: C.design, taxCode: sale },
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
      pricesIncludeTax: !!S.sale,
      lines: [{ description: pick(['Brochure print run', 'Poster printing', 'Business cards', 'Label proofs']), qtyMilli: 1000, unitPrice: amount, categoryId: C.printing, taxCode: (S.sale ?? 'NTR') as any }],
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
      lines: lines.map(([description, qty, price]) => ({ description, qtyMilli: qty * 1000, unitPrice: price, categoryId: C.design, taxCode: sale })),
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
      lines: [{ description: 'Discount on late proofs', qtyMilli: 1000, unitPrice: 20000, categoryId: C.design, taxCode: sale }],
      status: 'sent',
    });
    const total = one<{ total: number }>(db, 'SELECT total FROM invoices WHERE id = ?', credit)!.total;
    applyCredit({ creditId: credit, invoiceId: unpaid.id, amount: total, date: addDays(today, -2) });
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
    name: `${S.customers.physio[0]} retainer`,
    frequency: 'monthly',
    startDate: nextMonth(1),
    autoApprove: false,
    payload: {
      contactId: customers.physio,
      dueDays: 14,
      pricesIncludeTax: false,
      templateId: tpl,
      lines: [{ description: 'Monthly social media design', qtyMilli: 1000, unitPrice: 90000, categoryId: C.design, taxCode: sale }],
    },
  });

  // ---- import rules ------------------------------------------------------------------
  saveRule({ pattern: 'Social ads', categoryId: C.advertising });
  saveRule({ pattern: S.vendors.cafe, categoryId: C.meals, contactId: V.cafe });

  // ---- income tax through the year ---------------------------------------------------
  // AU PAYG instalments (with each BAS), NZ provisional tax (standard method),
  // US estimated tax (Form 1040-ES): paid from tax savings on their due dates.
  const thisYear = incomeYearOf(today, fyStart);
  const lastYear = thisYear - 1;
  const instalments: { date: string; amount: number; memo: string }[] = [];
  for (const y of [lastYear, thisYear]) {
    if (country === 'AU') {
      setYearInputs({ year: y, paygOption: 'amount', paygAmount: 125000 });
      // With each quarter's BAS: 28 Oct, 28 Feb, 28 Apr, 28 Jul.
      const { from } = incomeYearRange(y, fyStart);
      const fy = Number(from.slice(0, 4));
      for (const [i, d] of [`${fy}-10-28`, `${fy + 1}-02-28`, `${fy + 1}-04-28`, `${fy + 1}-07-28`].entries()) {
        instalments.push({ date: d, amount: 125000, memo: `PAYG instalment Q${i + 1}` });
      }
    } else if (country === 'NZ') {
      setYearInputs({ year: y, provisionalMethod: 'standard', priorYearTax: 1_140_000 });
      const each = Math.round((1_140_000 * 1.05) / 3);
      provisionalDue(y).forEach((d, i) => instalments.push({ date: d, amount: each, memo: `Provisional tax instalment ${i + 1}` }));
    } else {
      setYearInputs({ year: y, incomeTaxPct: 12, priorYearTax: 1_480_000 });
      for (const [i, d] of [`${y}-04-15`, `${y}-06-15`, `${y}-09-15`, `${y + 1}-01-15`].entries()) {
        instalments.push({ date: d, amount: 370000, memo: `Estimated tax Q${i + 1}` });
      }
    }
  }
  for (const p of instalments) if (p.date >= start) spend(p.date, p.amount, C.incomeTax, { account: savings, memo: p.memo });

  // ---- the asset register --------------------------------------------------------------
  // The big purchase, in the register; depreciation posted for the year that's finished.
  if (assetEntry) {
    const e = one<{ amount: number; tax_amount: number | null }>(db, 'SELECT amount, tax_amount FROM entries WHERE id = ?', assetEntry.id)!;
    saveAsset({
      name: S.asset.name,
      bought: assetEntry.date,
      cost: e.amount - (S.sale ? (e.tax_amount ?? 0) : 0),
      method: S.asset.method,
      lifeYears: S.asset.lifeYears ?? null,
      ratePct: S.asset.ratePct ?? null,
      categoryId: C.equipment,
      entryId: assetEntry.id,
      notes: 'Serial no. DEMO-0001',
    });
    postDepreciation(lastYear);
  }

  // ---- tax returns -------------------------------------------------------------------
  // Lodge the last full financial year's GST periods; leave the most recent
  // finished period as a draft to review. Each lodged one is paid from tax
  // savings on its due date, before lodging (which locks the books).
  if (S.sale) {
    const months = country === 'AU' ? 3 : 2;
    const periods: [string, string][] = [];
    for (let q = 0; q < 24 / months; q++) {
      const ps = ymd(startYear, S.fyMonth + q * months, 1);
      const [py, pm] = ps.split('-').map(Number);
      const pe = ymd(py, pm + months, 0);
      if (pe < today) periods.push([ps, pe]);
    }
    const lodgeUntil = incomeYearRange(lastYear, fyStart).to;
    const kind = country === 'AU' ? 'bas' : 'nz-gst';
    const inputs = (): Record<string, number> => (country === 'AU' ? { t7: 125000 } : {});
    for (const [ps, pe] of periods) {
      if (pe > lodgeUntil) continue;
      const report = taxReturnReport({ from: ps, to: pe, basis: 'cash' });
      // PAYG (T7) is paid with the BAS but recorded on its own above, so only the GST here.
      const owed = RETURN_FORMS[kind].net(report.figures, {});
      const payDay = country === 'AU' ? basDue(ps, pe) : nzGstDue(pe);
      if (payDay > today) continue;
      if (owed > 0) spend(payDay, owed, C.taxPayment, { account: savings, memo: `GST ${ps.slice(0, 7)} to ${pe.slice(0, 7)}` });
      else if (owed < 0) earn(payDay, -owed, C.taxRefund, { account: savings, memo: `GST refund ${ps.slice(0, 7)} to ${pe.slice(0, 7)}` });
    }
    reconcile();
    for (const [ps, pe] of periods) {
      saveTaxReturn({ periodStart: ps, periodEnd: pe, basis: 'cash', inputs: inputs(), lodge: pe <= lodgeUntil });
    }
  } else {
    reconcile();
  }

  // Reconcile the everyday account up to the end of last month.
  function reconcile() {
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
  }

  return all(db, 'SELECT COUNT(*) AS n FROM entries')[0];
}
