// What an invoice template can change beyond its style: the wording of every
// fixed label, which details show, an intro block, and the order, alignment
// and size of each section. Stored as JSON on the template; the backend and
// the page both normalise it through here, so a template saved by an older
// version simply picks up the defaults.

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
  gst: { label: 'GST column', default: 'GST' },
  amount: { label: 'Amount column', default: 'Amount' },
  subtotal: { label: 'Subtotal', default: 'Subtotal (ex. GST)' },
  gstTotal: { label: 'GST total', default: 'GST' },
  total: { label: 'Total', default: 'Total' },
  credited: { label: 'Credited', default: 'Credited' },
  paid: { label: 'Paid', default: 'Paid' },
  amountDue: { label: 'Amount due', default: 'Amount due' },
  payment: { label: 'Payment heading', default: 'Payment' },
} as const;
export type LabelKey = keyof typeof LABELS;

/** Details that can be left off. ABN can't be hidden on a tax invoice. */
export const SHOW = {
  companyAddress: 'Your address',
  companyContact: 'Your email and phone',
  abn: 'ABN',
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
  return { sections, labels, show, intro: typeof r.intro === 'string' ? r.intro.slice(0, 2000) : '' };
}

/** Placeholders usable in the intro, payment details and footer. */
export const PLACEHOLDERS = {
  customer: "Customer's name",
  number: 'Invoice number',
  issue_date: 'Issue date',
  due_date: 'Due date',
  total: 'Total',
  amount_due: 'Amount due',
  company: 'Your company name',
} as const;
export type PlaceholderKey = keyof typeof PLACEHOLDERS;

/** Replaces {customer}, {due_date}… Unknown names are left as typed. */
export function fillPlaceholders(text: string, values: Record<PlaceholderKey, string>) {
  return text.replace(/\{([a-z_]+)\}/g, (m, k: string) => (k in values ? values[k as PlaceholderKey] : m));
}
