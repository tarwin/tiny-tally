// The tax returns the books prepare, described as data: which boxes there
// are, which ones the person types in, and how the totals and the amount to
// pay come out. One screen (TaxReturn.vue) shows any of them; the backend
// works out the figures (reports.ts) and stores what was lodged.
//
// Forms and rules change over time, so each form belongs to a dated rule
// set (RETURN_RULES) that says which periods it's for and what official
// guidance it was checked against. A saved return records its rule set.
// Periods past `checkedUntil` get a warning, and lodging them needs the
// person to say they've checked the figures: update the app, or re-check
// the guidance and move the date on (RELEASING.md).
// No tjs:* imports and no Intl here: this file ships in both.

export type ReturnKind = 'bas' | 'nz-gst' | 'in-gst' | 'ca-gst' | 'uk-vat';

/** Worked out from transactions, in cents, keyed by box. */
export type ReturnFigures = Record<string, number>;
/** Typed in by the person, in cents, keyed by box. */
export type ReturnInputs = Record<string, number>;

export interface ReturnRow {
  /** The box or label on the form: 'G1', '5'. */
  code: string;
  label: string;
  help?: string;
  value: number;
  /** Set when the person types this one in. */
  input?: string;
  /** Starts a new section with this heading. */
  section?: string;
  grand?: boolean;
}

export interface ReturnForm {
  kind: ReturnKind;
  /** 'Business Activity Statement' */
  title: string;
  /** 'BAS': in buttons and messages. */
  short: string;
  /** Who it's lodged with: 'the ATO'. */
  authority: string;
  /** Where it's lodged, for the help text. */
  lodgeWhere: string;
  /** Boxes typed in by hand. */
  inputs: { key: string; label: string }[];
  /** Adjustments worked out on a calculation sheet (NZ: IR372, into Boxes 9 and 13). */
  adjustments?: AdjustmentDef[];
  /** Codes to filter the transactions by. */
  filters: string[];
  /** Lodged in whole dollars, cents dropped (the ATO). */
  wholeDollars: boolean;
  /** Sent through other software, so the figures export as a file (HMRC: no copying by hand). */
  exportsFigures?: boolean;
  rows(f: ReturnFigures, inputs: ReturnInputs): ReturnRow[];
  /** What's owed: positive to pay, negative for a refund. */
  net(f: ReturnFigures, inputs: ReturnInputs): number;
  /** Two figures for a quick look: tax on sales, tax on purchases. */
  headline(f: ReturnFigures): { label: string; value: number }[];
  /** The steps shown beside the form. */
  steps: string[];
  note: string;
}

/** The ATO drops cents; every box is worked out in whole dollars. */
const dollars = (cents: number) => Math.trunc(cents / 100) * 100;

const BAS: ReturnForm = {
  kind: 'bas',
  title: 'Business Activity Statement',
  short: 'BAS',
  authority: 'the ATO',
  lodgeWhere: 'the ATO Business Portal, online services or your agent',
  inputs: [
    { key: 'w1', label: 'W1' },
    { key: 'w2', label: 'W2' },
    { key: 't7', label: 'T7' },
  ],
  filters: ['G1', 'G2', 'G3', 'G4', 'G10', 'G11', '1A', '1B'],
  wholeDollars: true,
  // Simpler BAS: G1, 1A and 1B only. It's the ATO's method for GST turnover
  // under $10 million, whatever the reporting frequency, so every sole trader.
  rows(f, inputs) {
    const a8 = dollars(f['1A']) + dollars(inputs.w2 ?? 0) + dollars(f.W4 ?? 0) + dollars(inputs.t7 ?? 0);
    const b8 = dollars(f['1B']);
    const nine = a8 - b8;
    return [
      { section: 'GST on sales and purchases', code: 'G1', label: 'Total sales', help: 'Including GST, and including GST-free and export sales', value: f.G1 },
      { code: '1A', label: 'GST on sales', value: f['1A'] },
      { code: '1B', label: 'GST on purchases', value: f['1B'] },
      { section: 'PAYG withholding and instalments', code: 'W1', label: 'Total salary, wages and other payments', value: inputs.w1 ?? 0, input: 'w1' },
      { code: 'W2', label: 'Amounts withheld from payments at W1', value: inputs.w2 ?? 0, input: 'w2' },
      ...(f.W4 ? [{ code: 'W4', label: 'Amounts withheld where no ABN is quoted', help: 'From bill payments with no-ABN tax withheld', value: f.W4 }] : []),
      { code: 'T7', label: 'PAYG income tax instalment', value: inputs.t7 ?? 0, input: 't7' },
      { section: 'Summary', code: '8A', label: `Amounts you owe the ATO (1A + W2${f.W4 ? ' + W4' : ''} + T7)`, value: a8 },
      { code: '8B', label: 'Amounts the ATO owes you (1B)', value: b8 },
      { code: '9', label: nine >= 0 ? 'Payable to the ATO' : 'Refund from the ATO', value: Math.abs(nine), grand: true },
    ];
  },
  net: (f, inputs) => dollars(f['1A']) + dollars(inputs.w2 ?? 0) + dollars(f.W4 ?? 0) + dollars(inputs.t7 ?? 0) - dollars(f['1B']),
  headline: (f) => [
    { label: 'GST on sales (1A)', value: f['1A'] },
    { label: 'GST credits (1B)', value: f['1B'] },
  ],
  steps: [
    'Check the figures. Click through the transactions below if something looks off.',
    'Enter wages (W1, W2) and any PAYG instalment (T7) if they apply to you.',
    'Copy the figures into the ATO Business Portal, or send them to your agent.',
  ],
  note:
    'Amounts are in whole dollars with cents dropped, as the ATO asks. Sales include GST. This is Simpler BAS (G1, 1A and 1B), ' +
    'for GST turnover under $10 million. The transactions below can still be filtered by the full labels (G2, G10, G11…).',
};

/** GST in a GST-inclusive amount at 15%: three twenty-thirds (IR375). */
export const threeTwentyThirds = (cents: number) => Math.round((cents * 3) / 23);

// The GST101A, boxes 5 to 15, as laid out in IR375 (March 2026).
const NZ_GST: ReturnForm = {
  kind: 'nz-gst',
  title: 'GST return',
  short: 'GST return',
  authority: 'IRD',
  lodgeWhere: 'myIR or your tax agent',
  // Boxes 9 and 13 come from the adjustments, not typed in directly.
  inputs: [],
  adjustments: [],
  filters: ['5', '6', '11'],
  wholeDollars: false,
  rows(f, inputs) {
    const b = nzBoxes(f, inputs);
    return [
      { section: 'GST on your sales and income', code: '5', label: 'Total sales and income', help: 'Including GST and any zero-rated supplies', value: b[5] },
      { code: '6', label: 'Zero-rated supplies included in Box 5', value: b[6] },
      { code: '7', label: 'Box 5 less Box 6', value: b[7] },
      { code: '8', label: 'GST on sales (Box 7 × 3 ÷ 23)', value: b[8] },
      { code: '9', label: 'Adjustments from your calculation sheet', help: 'See GST adjustments below', value: b[9] },
      { code: '10', label: 'Total GST collected on sales and income', value: b[10] },
      { section: 'GST on your purchases and expenses', code: '11', label: 'Total purchases and expenses', help: 'Including GST, excluding imported goods', value: b[11] },
      { code: '12', label: 'GST on purchases (Box 11 × 3 ÷ 23)', value: b[12] },
      { code: '13', label: 'Credit adjustments from your calculation sheet', help: 'See GST adjustments below', value: b[13] },
      { code: '14', label: 'Total GST credit for purchases and expenses', value: b[14] },
      { section: 'Summary', code: '15', label: b[15] >= 0 ? 'GST to pay' : 'GST refund', value: Math.abs(b[15]), grand: true },
    ];
  },
  net: (f, inputs) => nzBoxes(f, inputs)[15],
  headline: (f) => [
    { label: 'GST on sales (Box 8)', value: threeTwentyThirds(f['5'] - f['6']) },
    { label: 'GST credits (Box 12)', value: threeTwentyThirds(f['11']) },
  ],
  steps: [
    'Check the figures. Click through the transactions below if something looks off.',
    'Add any GST adjustments, such as private use, entertainment or GST paid to Customs. They fill in Boxes 9 and 13.',
    'Copy the figures into myIR, or send them to your tax agent.',
  ],
  note:
    'Sales and purchases include GST. Exempt supplies, such as interest and residential rent, are left off. ' +
    'GST is worked out as 3/23 of the totals, as the return does, so it can differ by a few cents from the GST on each invoice.',
};

function nzBoxes(f: ReturnFigures, inputs: ReturnInputs) {
  const b5 = f['5'], b6 = f['6'], b7 = b5 - b6, b8 = threeTwentyThirds(b7), b9 = inputs.box9 ?? 0, b10 = b8 + b9;
  const b11 = f['11'], b12 = threeTwentyThirds(b11), b13 = inputs.box13 ?? 0, b14 = b12 + b13;
  return { 5: b5, 6: b6, 7: b7, 8: b8, 9: b9, 10: b10, 11: b11, 12: b12, 13: b13, 14: b14, 15: b10 - b14 };
}

// ---- NZ GST adjustments ------------------------------------------------------
// The lines of IRD's calculation sheet (IR372), without the 12.5%-rate lines
// that no longer apply. Debit adjustments add to Box 9, credit adjustments
// to Box 13. Each is worked out one of three ways:
//   percent    a share of the GST claimed on one category (private use)
//   inclusive  3/23 of a GST-inclusive amount (a bad debt written off)
//   gst        the GST itself, worked out elsewhere (a Customs invoice)

export type AdjustmentType =
  | 'private-use' | 'entertainment' | 'exempt-use' | 'asset-private' | 'kept-assets' | 'basis-change' | 'other-debit'
  | 'business-use' | 'private-asset' | 'customs' | 'bad-debt' | 'basis-change-credit' | 'other-credit';

export interface AdjustmentDef {
  type: AdjustmentType;
  box: '9' | '13';
  label: string;
  help: string;
  how: 'percent' | 'inclusive' | 'gst';
  /** A share that's set by law (entertainment: 50%). */
  fixedPercent?: number;
  /** Worked out on the financial year to date rather than the period. */
  yearToDate?: boolean;
}

export const NZ_ADJUSTMENTS: AdjustmentDef[] = [
  { type: 'private-use', box: '9', how: 'percent', label: 'Private use of business goods and services', help: 'The private share of GST you claimed on a category, such as a phone or vehicle used partly privately.' },
  { type: 'entertainment', box: '9', how: 'percent', fixedPercent: 50, yearToDate: true, label: 'Entertainment expenses', help: 'Half the GST claimed on business entertainment for the year. Once a year, in the return that ends at your balance date.' },
  { type: 'exempt-use', box: '9', how: 'percent', label: 'Goods and services used to make exempt supplies', help: 'The share of GST claimed on a category that was used for exempt supplies, such as residential rent.' },
  { type: 'asset-private', box: '9', how: 'gst', label: 'Business assets used privately', help: 'A one-off adjustment when a business asset moves to private use.' },
  { type: 'kept-assets', box: '9', how: 'gst', label: 'Assets kept after ceasing to be registered', help: 'GST on the market value of business assets you keep when you deregister.' },
  { type: 'basis-change', box: '9', how: 'gst', label: 'Change of accounting basis', help: 'From the change of basis calculation.' },
  { type: 'other-debit', box: '9', how: 'inclusive', label: 'Other', help: 'Barter, bad debts recovered, exported second-hand goods, insurance payments received. Enter the amount including GST.' },
  { type: 'business-use', box: '13', how: 'gst', label: 'Business use of private or exempt goods and services', help: 'GST on the business share of things bought privately or for exempt supplies.' },
  { type: 'private-asset', box: '13', how: 'gst', label: 'Private assets used for business', help: 'A one-off adjustment for a private asset brought into the business.' },
  { type: 'customs', box: '13', how: 'gst', label: 'GST paid to Customs on imports', help: 'The GST shown on Customs’ invoices. Imported goods stay out of Box 11.' },
  { type: 'bad-debt', box: '13', how: 'inclusive', label: 'Bad debts written off', help: 'A customer who won’t pay an invoice you’ve already returned GST on. Enter the amount written off, including GST.' },
  { type: 'basis-change-credit', box: '13', how: 'gst', label: 'Change of accounting basis', help: 'From the change of basis calculation.' },
  { type: 'other-credit', box: '13', how: 'gst', label: 'Other credits', help: 'Late claims and other credit adjustments.' },
];
NZ_GST.adjustments = NZ_ADJUSTMENTS;

export const ADJUSTMENT_MAP: Record<string, AdjustmentDef> = Object.fromEntries(NZ_ADJUSTMENTS.map((a) => [a.type, a]));

export interface Adjustment {
  type: AdjustmentType;
  description: string;
  /** cents: GST-inclusive (inclusive) or the GST itself (gst). */
  amount?: number;
  categoryId?: number | null;
  /** 0–100 (percent). */
  percent?: number;
  /** The GST it comes to, set when saved. */
  gst?: number;
}

/** What percent adjustments are worked out from: GST-inclusive purchases (Box 11) per category. */
export interface AdjustmentContext {
  period: Record<number, number>;
  yearToDate: Record<number, number>;
}

export function adjustmentGst(a: Adjustment, ctx: AdjustmentContext) {
  const def = ADJUSTMENT_MAP[a.type];
  if (!def) return 0;
  if (def.how === 'gst') return Math.round(a.amount ?? 0);
  if (def.how === 'inclusive') return threeTwentyThirds(a.amount ?? 0);
  const base = (def.yearToDate ? ctx.yearToDate : ctx.period)[a.categoryId ?? -1] ?? 0;
  return Math.round((threeTwentyThirds(base) * (def.fixedPercent ?? a.percent ?? 0)) / 100);
}

/** Boxes 9 and 13 from the adjustments. */
export function adjustmentTotals(list: Adjustment[], ctx: AdjustmentContext) {
  let box9 = 0, box13 = 0;
  for (const a of list) {
    const gst = adjustmentGst(a, ctx);
    if (ADJUSTMENT_MAP[a.type]?.box === '9') box9 += gst;
    else box13 += gst;
  }
  return { box9, box13 };
}

// ---- rules by date --------------------------------------------------------------

export type RuleStatus = 'checked' | 'unchecked' | 'before';

export interface RuleSet {
  id: string;
  /** 'GST101A (April 2023)' */
  name: string;
  /** The official guidance it was checked against. */
  checkedAgainst: string;
  /** Periods ending on or after this use it. */
  from: string;
  /** Checked for periods ending up to this date; later ones get a warning. */
  checkedUntil: string;
  form: ReturnForm;
}

// India: a summary to file GSTR-1 and GSTR-3B from. Not the forms themselves.
const IN_GST: ReturnForm = {
  kind: 'in-gst',
  title: 'GST summary',
  short: 'GST summary',
  authority: 'the GST portal',
  lodgeWhere: 'the GST portal or your accountant',
  inputs: [],
  filters: ['Taxable', 'Zero-rated', 'Exempt', 'Credits'],
  wholeDollars: false,
  rows(f) {
    return [
      { section: 'Sales', code: 'Taxable', label: 'Taxable value of sales', value: f.taxable },
      { code: 'Zero-rated', label: 'Zero-rated sales and exports', value: f.zero },
      { code: 'Exempt', label: 'Exempt sales', value: f.exempt },
      { section: 'GST on sales', code: 'IGST', label: 'Integrated tax', value: f.igst },
      { code: 'CGST', label: 'Central tax', value: f.cgst },
      { code: 'SGST', label: 'State or UT tax', value: f.sgst },
      { section: 'Purchases', code: 'Credits', label: 'Purchases with GST', help: 'Before GST', value: f.purchases },
      { code: 'ITC', label: 'Input tax credit', help: 'Check the split by head against GSTR-2B on the portal', value: f.itc },
      { section: 'Summary', code: 'Net', label: inGstNet(f) >= 0 ? 'GST to pay' : 'Credit carried forward', value: Math.abs(inGstNet(f)), grand: true },
    ];
  },
  net: (f) => inGstNet(f),
  headline: (f) => [
    { label: 'GST on sales', value: f.igst + f.cgst + f.sgst },
    { label: 'Input tax credit', value: f.itc },
  ],
  steps: [
    'Check the figures. Click through the transactions below if something looks off.',
    'File your sales in GSTR-1 on the GST portal, invoice by invoice.',
    'Compare the input tax credit with GSTR-2B, then file GSTR-3B and pay what it shows.',
  ],
  note:
    "A summary from your books, not a filed return. Figures are in rupees and paise; the portal's own figures can differ by rounding. " +
    'Reverse-charge purchases and credit blocked by law aren\'t worked out here.',
};

const inGstNet = (f: ReturnFigures) => f.igst + f.cgst + f.sgst - f.itc;

// Canada: the lines of the GST/HST return, to type into NETFILE or My Business
// Account. Tax is reported on paid and unpaid invoices alike (RC4022), so these
// read the accrual ledger whatever the basis.
const caLine = (f: ReturnFigures, inputs: ReturnInputs) => {
  const l105 = f['103'] + (inputs.l104 ?? 0);
  const l108 = f['106'] + (inputs.l107 ?? 0);
  const l109 = l105 - l108;
  return { l105, l108, l109, due: l109 - (inputs.l110 ?? 0) - (inputs.l111 ?? 0) };
};

const CA_GST: ReturnForm = {
  kind: 'ca-gst',
  title: 'GST/HST return',
  short: 'GST/HST return',
  authority: 'the CRA',
  lodgeWhere: 'GST/HST NETFILE, My Business Account or your accountant',
  inputs: [
    { key: 'l104', label: 'Line 104' },
    { key: 'l107', label: 'Line 107' },
    { key: 'l110', label: 'Line 110' },
    { key: 'l111', label: 'Line 111' },
  ],
  filters: ['101', '103', '106'],
  wholeDollars: false,
  rows(f, inputs) {
    const c = caLine(f, inputs);
    return [
      { section: 'Sales', code: '101', label: 'Sales and other revenue', help: 'Before tax, including zero-rated and exempt supplies', value: f['101'] },
      { section: 'Net tax', code: '103', label: 'GST/HST collected or collectible', help: 'On paid and unpaid invoices', value: f['103'] },
      { code: '104', label: 'Adjustments to add', value: inputs.l104 ?? 0, input: 'l104' },
      { code: '105', label: 'Total GST/HST and adjustments (103 + 104)', value: c.l105 },
      { code: '106', label: 'Input tax credits', help: 'GST/HST paid or payable on purchases', value: f['106'] },
      { code: '107', label: 'Adjustments to deduct', value: inputs.l107 ?? 0, input: 'l107' },
      { code: '108', label: 'Total credits and adjustments (106 + 107)', value: c.l108 },
      { code: '109', label: 'Net tax (105 − 108)', value: c.l109 },
      { section: 'Payments and rebates', code: '110', label: 'Instalments paid', value: inputs.l110 ?? 0, input: 'l110' },
      { code: '111', label: 'Rebates', value: inputs.l111 ?? 0, input: 'l111' },
      { section: 'Summary', code: c.due >= 0 ? '115' : '114', label: c.due >= 0 ? 'To pay the CRA' : 'Refund from the CRA', value: Math.abs(c.due), grand: true },
    ];
  },
  net: (f, inputs) => caLine(f, inputs).due,
  headline: (f) => [
    { label: 'GST/HST collected (103)', value: f['103'] },
    { label: 'Input tax credits (106)', value: f['106'] },
  ],
  steps: [
    'Check the figures. Click through the transactions below if something looks off.',
    'Enter any adjustments, instalments or rebates that apply to you.',
    'Type the figures into GST/HST NETFILE or My Business Account, or send them to your accountant.',
  ],
  note:
    "GST/HST only. PST, RST and QST are separate taxes with their own returns, and aren't worked out here. " +
    "Only half the tax on meals and entertainment can be claimed: enter that half as the tax on those transactions. The Quick Method isn't worked out here.",
};

// The UK's nine boxes (VAT Notice 700/12). Boxes 6 to 9 go in whole pounds.
const pounds = (pence: number) => Math.trunc(pence / 100) * 100;
const ukBox5 = (f: ReturnFigures, inputs: ReturnInputs) => f['1'] + (inputs.box2 ?? 0) - f['4'];

const UK_VAT: ReturnForm = {
  kind: 'uk-vat',
  title: 'VAT return',
  short: 'VAT return',
  authority: 'HMRC',
  lodgeWhere: 'bridging software recognised by HMRC, or your accountant',
  inputs: [
    { key: 'box2', label: 'Box 2' },
    { key: 'box8', label: 'Box 8' },
    { key: 'box9', label: 'Box 9' },
  ],
  filters: ['1', '4', '6', '7'],
  wholeDollars: false,
  exportsFigures: true,
  rows(f, inputs) {
    const box3 = f['1'] + (inputs.box2 ?? 0);
    const box5 = ukBox5(f, inputs);
    return [
      { section: 'VAT', code: '1', label: 'VAT due on sales and other outputs', value: f['1'] },
      { code: '2', label: 'VAT due on goods acquired from the EU', help: 'Northern Ireland only', value: inputs.box2 ?? 0, input: 'box2' },
      { code: '3', label: 'Total VAT due (Box 1 + Box 2)', value: box3 },
      { code: '4', label: 'VAT reclaimed on purchases and other inputs', value: f['4'] },
      { code: '5', label: box5 >= 0 ? 'Net VAT to pay HMRC' : 'Net VAT to reclaim from HMRC', value: Math.abs(box5), grand: true },
      { section: 'Values, excluding VAT, in whole pounds', code: '6', label: 'Total sales and other outputs', help: 'Including zero-rated, exempt and outside the scope', value: pounds(f['6']) },
      { code: '7', label: 'Total purchases and other inputs', value: pounds(f['7']) },
      { code: '8', label: 'Goods and related costs supplied to the EU', help: 'Northern Ireland only', value: pounds(inputs.box8 ?? 0), input: 'box8' },
      { code: '9', label: 'Goods and related costs acquired from the EU', help: 'Northern Ireland only', value: pounds(inputs.box9 ?? 0), input: 'box9' },
    ];
  },
  net: (f, inputs) => ukBox5(f, inputs),
  headline: (f) => [
    { label: 'VAT on sales (Box 1)', value: f['1'] },
    { label: 'VAT reclaimed (Box 4)', value: f['4'] },
  ],
  steps: [
    'Check the figures. Click through the transactions below if something looks off.',
    'Enter Boxes 2, 8 and 9 only if you move goods between Northern Ireland and the EU.',
    "Choose Export VAT figures, then send the file to HMRC with bridging software, or give it to your accountant. HMRC doesn't allow typing these in by hand unless you're exempt from Making Tax Digital.",
  ],
  note:
    "Boxes 6 to 9 are in whole pounds, with pence dropped. Reverse charge, the Flat Rate Scheme and partial exemption aren't worked out here: ask your accountant if they apply to you.",
};

/** Oldest first. When a form changes, add a rule set with its own form; when re-checked, move checkedUntil on. */
export const RETURN_RULES: Record<ReturnKind, RuleSet[]> = {
  bas: [
    {
      id: 'bas-2017',
      name: 'BAS with Simpler BAS (from July 2017)',
      checkedAgainst: 'ATO pages on GST reporting methods and Simpler BAS, checked November 2026',
      from: '2017-07-01',
      checkedUntil: '2027-06-30',
      form: BAS,
    },
  ],
  'nz-gst': [
    {
      id: 'nz-gst101a-2023',
      name: 'GST101A (April 2023)',
      checkedAgainst: 'IRD GST guide IR375 (March 2026) and calculation sheet IR372',
      from: '2023-04-01',
      checkedUntil: '2027-03-31',
      form: NZ_GST,
    },
  ],
  'in-gst': [
    {
      id: 'in-gst-2017',
      name: 'GST summary (from July 2017)',
      checkedAgainst: 'CGST Rules 46 and 47 as reproduced by CBIC and third parties, checked November 2026',
      from: '2017-07-01',
      checkedUntil: '2027-03-31',
      form: IN_GST,
    },
  ],
  'ca-gst': [
    {
      id: 'ca-gst-2024',
      name: 'GST/HST return, filed online (from January 2024)',
      checkedAgainst: 'CRA guide RC4022, checked November 2026',
      from: '2024-01-01',
      checkedUntil: '2027-12-31',
      form: CA_GST,
    },
  ],
  'uk-vat': [
    {
      id: 'uk-vat-2021',
      name: '9-box VAT return (from January 2021)',
      checkedAgainst: 'VAT Notices 700/12 and 700/22, checked November 2026',
      from: '2021-01-01',
      checkedUntil: '2027-03-31',
      form: UK_VAT,
    },
  ],
};

/** The rules for a period ending on `periodEnd`, and whether this version of the app has checked them. */
export function rulesFor(kind: ReturnKind, periodEnd: string): { rules: RuleSet; status: RuleStatus } {
  const sets = RETURN_RULES[kind];
  const rules = [...sets].reverse().find((r) => r.from <= periodEnd);
  if (!rules) return { rules: sets[0], status: 'before' };
  return { rules, status: periodEnd > rules.checkedUntil ? 'unchecked' : 'checked' };
}

/** A saved return's own rule set, falling back to the one for its period. */
export function rulesById(kind: ReturnKind, id: string | null | undefined, periodEnd: string): RuleSet {
  return RETURN_RULES[kind].find((r) => r.id === id) ?? rulesFor(kind, periodEnd).rules;
}

/** The newest form of each kind, for places that aren't tied to a period. */
export const RETURN_FORMS: Record<ReturnKind, ReturnForm> = {
  bas: RETURN_RULES.bas[RETURN_RULES.bas.length - 1].form,
  'nz-gst': RETURN_RULES['nz-gst'][RETURN_RULES['nz-gst'].length - 1].form,
  'in-gst': RETURN_RULES['in-gst'][RETURN_RULES['in-gst'].length - 1].form,
  'ca-gst': RETURN_RULES['ca-gst'][RETURN_RULES['ca-gst'].length - 1].form,
  'uk-vat': RETURN_RULES['uk-vat'][RETURN_RULES['uk-vat'].length - 1].form,
};

export function isReturnKind(v: unknown): v is ReturnKind {
  return typeof v === 'string' && v in RETURN_FORMS;
}
