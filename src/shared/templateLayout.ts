// What an invoice template can change beyond its style: the wording of every
// fixed label, which details show, an intro block, and the order, alignment
// and size of each section. Stored as JSON on the template; the backend and
// the page both normalise it through here, so a template saved by an older
// version simply picks up the defaults.

import type { CountryTax } from './countries';

export type SectionKey = 'header' | 'to' | 'intro' | 'lines' | 'totals' | 'notes' | 'payment' | 'footer';
export type SectionAlign = 'left' | 'center' | 'right';
export type SectionSize = 'small' | 'normal' | 'large';

export interface TemplateSection {
  key: SectionKey;
  align: SectionAlign;
  size: SectionSize;
  /** Pinned to the bottom of the page (the payment details and footer by default). */
  bottom: boolean;
}

export const SECTION_INFO: Record<SectionKey, { label: string; aligns: boolean; help?: string }> = {
  header: { label: 'Your details and title', aligns: true, help: 'Left puts your details on the left and the title on the right.' },
  to: { label: 'Customer', aligns: true },
  intro: { label: 'Intro text', aligns: true },
  lines: { label: 'Line items', aligns: false },
  totals: { label: 'Totals', aligns: true },
  notes: { label: 'Invoice notes', aligns: true, help: 'The notes typed on each invoice.' },
  payment: { label: 'Payment details', aligns: true },
  footer: { label: 'Footer', aligns: true },
};

/** Every fixed piece of wording on the page, with its default. */
export const LABELS = {
  invoiceNo: { label: 'Number', default: 'Invoice no.' },
  issued: { label: 'Issue date', default: 'Issued' },
  due: { label: 'Due date', default: 'Due' },
  reference: { label: 'Reference', default: 'Reference' },
  billTo: { label: 'Customer heading', default: 'Bill to' },
  description: { label: 'Description column', default: 'Description' },
  qty: { label: 'Quantity column', default: 'Qty' },
  price: { label: 'Price column', default: '' },
  gst: { label: 'Tax column', default: 'GST' },
  amount: { label: 'Amount column', default: 'Amount' },
  subtotal: { label: 'Subtotal', default: 'Subtotal (ex. GST)' },
  gstTotal: { label: 'Tax total', default: 'GST' },
  total: { label: 'Total', default: 'Total' },
  credited: { label: 'Credited', default: 'Credited' },
  paid: { label: 'Paid', default: 'Paid' },
  amountDue: { label: 'Amount due', default: 'Amount due' },
  payment: { label: 'Payment heading', default: 'Payment' },
} as const;
export type LabelKey = keyof typeof LABELS;

/** A label's default for the books' tax ('GST', 'Sales tax'). */
export function labelDefault(key: LabelKey, tax: CountryTax | null) {
  if (!tax) return LABELS[key].default;
  if (key === 'gst' || key === 'gstTotal') return tax.name;
  if (key === 'subtotal') return tax.spellOut ? `Subtotal (ex. ${tax.short})` : 'Subtotal';
  return LABELS[key].default;
}

/** The price column: says whether prices include tax where the country spells it out. */
export function priceLabel(tax: CountryTax | null, pricesIncludeTax: boolean) {
  if (!tax) return 'Price';
  if (!tax.spellOut && !pricesIncludeTax) return 'Price';
  return pricesIncludeTax ? `Price inc. ${tax.short}` : `Price ex. ${tax.short}`;
}

/** Details that can be left off. The tax ID can't be hidden on a tax invoice. */
export const SHOW = {
  fromPerson: 'Your name',
  fromAddress: 'Your address',
  fromContact: 'Your phone, email and website',
  taxId: 'Tax ID',
  customerAddress: "Customer's address",
  customerEmail: "Customer's email",
  dueDate: 'Due date',
  reference: 'Reference',
  qtyPrice: 'Quantity and price columns',
} as const;
export type ShowKey = keyof typeof SHOW;

export interface TemplateLayout {
  sections: TemplateSection[];
  /** Only the labels that differ from the defaults. */
  labels: Partial<Record<LabelKey, string>>;
  show: Record<ShowKey, boolean>;
  /** Shown in the intro section; may use placeholders. */
  intro: string;
  /** Your details at the top, laid out with FROM_PLACEHOLDERS. Blank is DEFAULT_FROM. */
  from: string;
}

const ORDER: SectionKey[] = ['header', 'to', 'intro', 'lines', 'totals', 'notes', 'payment', 'footer'];

function defaultSection(key: SectionKey): TemplateSection {
  return {
    key,
    align: key === 'totals' || key === 'footer' ? 'right' : 'left',
    size: 'normal',
    bottom: key === 'payment' || key === 'footer',
  };
}

export function defaultLayout(): TemplateLayout {
  return {
    sections: ORDER.map(defaultSection),
    labels: {},
    show: Object.fromEntries(Object.keys(SHOW).map((k) => [k, true])) as Record<ShowKey, boolean>,
    intro: '',
    from: '',
  };
}

const ALIGNS: SectionAlign[] = ['left', 'center', 'right'];
const SIZES: SectionSize[] = ['small', 'normal', 'large'];

/** Any stored value -> a complete, valid layout. */
export function normaliseLayout(raw: unknown): TemplateLayout {
  const d = defaultLayout();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Partial<TemplateLayout>;
  const seen = new Set<SectionKey>();
  const sections: TemplateSection[] = [];
  for (const s of Array.isArray(r.sections) ? r.sections : []) {
    if (!s || !ORDER.includes(s.key) || seen.has(s.key)) continue;
    seen.add(s.key);
    const base = defaultSection(s.key);
    sections.push({
      key: s.key,
      align: ALIGNS.includes(s.align) ? s.align : base.align,
      size: SIZES.includes(s.size) ? s.size : base.size,
      bottom: typeof s.bottom === 'boolean' ? s.bottom : base.bottom,
    });
  }
  // Sections added in later versions slot in at their default position.
  for (const key of ORDER) if (!seen.has(key)) sections.splice(Math.min(ORDER.indexOf(key), sections.length), 0, defaultSection(key));

  const labels: TemplateLayout['labels'] = {};
  if (r.labels && typeof r.labels === 'object') {
    for (const k of Object.keys(LABELS) as LabelKey[]) {
      const v = (r.labels as Record<string, unknown>)[k];
      if (typeof v === 'string' && v.trim() && v.trim() !== LABELS[k].default) labels[k] = v.trim().slice(0, 60);
    }
  }
  const show = { ...d.show };
  if (r.show && typeof r.show === 'object') {
    for (const k of Object.keys(SHOW) as ShowKey[]) {
      const v = (r.show as Record<string, unknown>)[k];
      if (typeof v === 'boolean') show[k] = v;
    }
  }
  return {
    sections,
    labels,
    show,
    intro: typeof r.intro === 'string' ? r.intro.slice(0, 2000) : '',
    from: typeof r.from === 'string' ? r.from.trim().slice(0, 2000) : '',
  };
}

/** Placeholders usable in the intro, payment details and footer. */
export const PLACEHOLDERS = {
  customer: "Customer's name",
  number: 'Invoice number',
  issue_date: 'Issue date',
  due_date: 'Due date',
  total: 'Total',
  amount_due: 'Amount due',
  business: 'Your business name',
} as const;
export type PlaceholderKey = keyof typeof PLACEHOLDERS;

/** Replaces {customer}, {due_date}… Unknown names are left as typed. */
export function fillPlaceholders(text: string, values: Record<PlaceholderKey, string>) {
  return text.replace(/\{([a-z_]+)\}/g, (m, k: string) => (k in values ? values[k as PlaceholderKey] : m));
}

// ---- your details ("from") -------------------------------------------------------

/** What can go in your details at the top, and the field each one is edited in. */
export const FROM_PLACEHOLDERS = {
  business: { label: 'Business name', field: 'from.name' },
  name: { label: 'Your name', field: 'from.personName' },
  postnominals: { label: 'Post-nominals', field: 'from.postnominals' },
  address: { label: 'Your address', field: 'from.address' },
  phone: { label: 'Phone', field: 'from.phone' },
  email: { label: 'Email', field: 'from.email' },
  website: { label: 'Website', field: 'from.website' },
  tax_id: { label: 'Tax ID', field: 'from.taxId' },
} as const;
export type FromKey = keyof typeof FROM_PLACEHOLDERS;

/** Used when a template doesn't lay its own out. */
export const DEFAULT_FROM = ['{business}', '**{name}** {postnominals}', '{address}', '{phone}', '{email}', '{website}', '{tax_id}'].join('\n');

export interface FromLine {
  /** Text runs, bold or not. A value can hold line breaks (an address). */
  parts: { text: string; bold: boolean }[];
  /** The field that sets it, for clicking it in the template preview. */
  field: string | null;
  /** Every placeholder in it was empty: only shown, as `ghost`, while editing. */
  empty: boolean;
  ghost: string;
}

/**
 * Your details as lines. `**…**` is bold. A line whose placeholders are all
 * empty is left out (or kept, empty, while editing), so nothing leaves a gap.
 * The tax ID goes on the end when it has to show and the layout leaves it out.
 */
export function fromLines(layout: string, values: Record<FromKey, string>, opts: { taxIdRequired?: boolean; editing?: boolean } = {}): FromLine[] {
  let text = layout.trim() || DEFAULT_FROM;
  if (opts.taxIdRequired && !text.includes('{tax_id}')) text += '\n{tax_id}';
  const out: FromLine[] = [];
  for (const raw of text.split('\n')) {
    const keys = [...raw.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]).filter((k): k is FromKey => k in FROM_PLACEHOLDERS);
    const fill = (t: string) => t.replace(/\{([a-z_]+)\}/g, (m, k: string) => (k in FROM_PLACEHOLDERS ? values[k as FromKey] ?? '' : m));
    const parts = raw
      .split(/\*\*(.*?)\*\*/)
      .map((t, i) => ({ text: fill(t), bold: i % 2 === 1 }))
      .filter((p) => p.text);
    // Spaces and commas left between empty placeholders go too.
    while (parts.length && !parts[parts.length - 1].text.trim()) parts.pop();
    while (parts.length && !parts[0].text.trim()) parts.shift();
    if (parts.length) {
      parts[0].text = parts[0].text.replace(/^[\s,·|–]+/, '');
      parts[parts.length - 1].text = parts[parts.length - 1].text.replace(/[\s,·|–]+$/, '');
    }
    const empty = keys.length > 0 && keys.every((k) => !values[k]?.trim());
    if (!raw.trim() || (empty && !opts.editing) || (!empty && !parts.some((p) => p.text.trim()))) continue;
    out.push({
      parts: empty ? [] : parts,
      field: keys.length ? FROM_PLACEHOLDERS[keys[0]].field : null,
      empty,
      ghost: keys.map((k) => FROM_PLACEHOLDERS[k].label).join(' '),
    });
  }
  return out;
}
