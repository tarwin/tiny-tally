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

export type ReturnKind = 'bas' | 'nz-gst';

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
    const a8 = dollars(f['1A']) + dollars(inputs.w2 ?? 0) + dollars(inputs.t7 ?? 0);
    const b8 = dollars(f['1B']);
    const nine = a8 - b8;
    return [
      { section: 'GST on sales and purchases', code: 'G1', label: 'Total sales', help: 'Including GST, and including GST-free and export sales', value: f.G1 },
      { code: '1A', label: 'GST on sales', value: f['1A'] },
      { code: '1B', label: 'GST on purchases', value: f['1B'] },
      { section: 'PAYG withholding and instalments', code: 'W1', label: 'Total salary, wages and other payments', value: inputs.w1 ?? 0, input: 'w1' },
      { code: 'W2', label: 'Amounts withheld from payments at W1', value: inputs.w2 ?? 0, input: 'w2' },
      { code: 'T7', label: 'PAYG income tax instalment', value: inputs.t7 ?? 0, input: 't7' },
      { section: 'Summary', code: '8A', label: 'Amounts you owe the ATO (1A + W2 + T7)', value: a8 },
      { code: '8B', label: 'Amounts the ATO owes you (1B)', value: b8 },
      { code: '9', label: nine >= 0 ? 'Payable to the ATO' : 'Refund from the ATO', value: Math.abs(nine), grand: true },
    ];
  },
  net: (f, inputs) => dollars(f['1A']) + dollars(inputs.w2 ?? 0) + dollars(inputs.t7 ?? 0) - dollars(f['1B']),
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
};

export function isReturnKind(v: unknown): v is ReturnKind {
  return typeof v === 'string' && v in RETURN_FORMS;
}
