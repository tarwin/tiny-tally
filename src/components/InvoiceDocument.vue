<script setup lang="ts">
// The printable invoice. It's paper, so it uses fixed paper colours (white,
// near-black ink) on purpose instead of theme tokens: it must look the same
// in dark mode and when printed.
import { computed } from 'vue';
import type { Books, DocType, InvoiceLine, InvoiceStatus, InvoiceTemplate, Sender } from '../lib/api';
import { formatDay } from '../lib/dates';
import { formatMoney } from '../lib/money';
import { countryProfile } from '../shared/countries';
import { TAX_CODE_MAP } from '../shared/tax';
import { fillPlaceholders, labelDefault, normaliseLayout, priceLabel, type LabelKey, type TemplateSection } from '../shared/templateLayout';

export interface InvoiceDocData {
  docType?: DocType;
  sourceNumber?: string | null;
  credited?: number;
  number: string;
  issueDate: string;
  dueDate: string;
  reference?: string | null;
  notes?: string | null;
  contactName: string;
  contactEmail?: string | null;
  contactAddress?: string | null;
  pricesIncludeTax: boolean;
  lines: (InvoiceLine & { net: number; tax: number })[];
  net: number;
  tax: number;
  total: number;
  paid?: number;
  balance?: number;
  status?: InvoiceStatus;
}

const props = defineProps<{
  invoice: InvoiceDocData;
  books: Books;
  /** The trading name it's from. */
  sender: Sender | null;
  template: Pick<InvoiceTemplate, 'style' | 'accent' | 'logo' | 'title' | 'footer' | 'showTaxColumn'> & {
    layout?: InvoiceTemplate['layout'];
  } | null;
}>();

const t = computed(
  () =>
    props.template ?? {
      style: 'classic' as const,
      accent: '#2f6fde',
      logo: null,
      title: countryProfile(props.books.country).invoiceTitle(props.books.taxEnabled),
      footer: null,
      showTaxColumn: true,
    },
);

const currency = computed(() => props.books.currency);
const profile = computed(() => countryProfile(props.books.country));
const tax = computed(() => (props.books.taxEnabled ? profile.value.tax : null));
const taxOn = computed(() => !!tax.value);
const type = computed(() => props.invoice.docType ?? 'invoice');
// An Australian GST credit note is an "adjustment note" to the ATO; customers know it as a credit note.
const title = computed(() => {
  if (type.value === 'quote') return 'Quote';
  if (type.value === 'credit') return tax.value?.adjustmentNote ? 'Adjustment Note' : 'Credit Note';
  const registered = profile.value.invoiceTitle(true);
  return taxOn.value ? t.value.title || registered : t.value.title === registered ? profile.value.invoiceTitle(false) : t.value.title;
});
const layout = computed(() => normaliseLayout(props.template?.layout));
const show = computed(() => ({ ...layout.value.show, taxId: layout.value.show.taxId || taxOn.value }));
const taxIdLabel = computed(() => profile.value.taxId.label);
const showTax = computed(() => taxOn.value && t.value.showTaxColumn);
const from = computed(() => props.sender ?? { name: props.books.name, address: null, email: null, phone: null, paymentDetails: null, logo: null });
// A template's own logo wins; otherwise the trading name's.
const logo = computed(() => t.value.logo || from.value.logo);
const money = (v: number) => formatMoney(v, currency.value, props.books.documentCurrencyDisplay);

/** Wording that only makes sense on invoices keeps its quote/credit-note form there. */
const PER_TYPE: Partial<Record<LabelKey, Partial<Record<DocType, string>>>> = {
  invoiceNo: { quote: 'Quote no.', credit: 'Credit note no.' },
  issued: { credit: 'Date' },
  billTo: { quote: 'Prepared for', credit: 'Credit to' },
  total: { credit: 'Total credit' },
};
function label(key: LabelKey) {
  const special = PER_TYPE[key]?.[type.value];
  if (special) return special;
  const own = layout.value.labels[key];
  if (own) return own;
  if (key === 'price') return priceLabel(tax.value, props.invoice.pricesIncludeTax);
  return labelDefault(key, tax.value);
}

const amountDue = computed(() => props.invoice.balance ?? props.invoice.total - (props.invoice.paid ?? 0));
const fill = (text: string | null | undefined) =>
  fillPlaceholders(text ?? '', {
    customer: props.invoice.contactName,
    number: props.invoice.number,
    issue_date: formatDay(props.invoice.issueDate),
    due_date: formatDay(props.invoice.dueDate),
    total: money(props.invoice.total),
    amount_due: money(amountDue.value),
    business: from.value.name,
  }).trim();

/** Whether a section has anything to show on this document. */
function hasContent(key: TemplateSection['key']) {
  switch (key) {
    case 'intro':
      return !!fill(layout.value.intro);
    case 'notes':
      return !!props.invoice.notes;
    case 'payment':
      return type.value === 'invoice' && !!fill(from.value.paymentDetails);
    case 'footer':
      return !!fill(t.value.footer);
    default:
      return true;
  }
}
const body = computed(() => layout.value.sections.filter((s) => !s.bottom && hasContent(s.key)));
const foot = computed(() => layout.value.sections.filter((s) => s.bottom && hasContent(s.key)));
const sectionClass = (s: TemplateSection) => [`Doc__sec--${s.align}`, `Doc__sec--${s.size}`];

function qty(milli: number) {
  const v = milli / 1000;
  return Number.isInteger(v) ? String(v) : v.toFixed(3).replace(/0+$/, '');
}

/** Line amounts are shown on the same basis the prices were entered. */
function lineAmount(l: { net: number; tax: number }) {
  return props.invoice.pricesIncludeTax ? l.net + l.tax : l.net;
}

const stamp = computed(() => {
  const s = props.invoice.status;
  if (type.value === 'quote') return s === 'accepted' ? 'Accepted' : s === 'void' ? 'Declined' : null;
  if (type.value === 'credit') return s === 'void' ? 'Void' : null;
  return s === 'paid' ? 'Paid' : s === 'void' ? 'Void' : null;
});
</script>

<template>
  <article
    class="Doc"
    :class="[`Doc--${t.style}`, { 'Doc--headFirst': layout.sections[0]?.key === 'header' }]"
    :style="{ '--accent': t.accent }"
  >
    <div v-if="stamp" class="Doc__stamp" :class="`Doc__stamp--${invoice.status}`">{{ stamp }}</div>

    <template v-for="s in body" :key="s.key">
      <header v-if="s.key === 'header'" class="Doc__head" :class="sectionClass(s)">
        <div class="Doc__from">
          <img v-if="logo" :src="logo" alt="" class="Doc__logo" />
          <div class="Doc__fromName">{{ from.name }}</div>
          <div v-if="books.taxId && show.taxId" class="Doc__taxId">{{ taxIdLabel }} {{ books.taxId }}</div>
          <div v-if="from.address && show.fromAddress" class="Doc__pre">{{ from.address }}</div>
          <div v-if="(from.email || from.phone) && show.fromContact" class="Doc__muted">
            {{ [from.email, from.phone].filter(Boolean).join(' · ') }}
          </div>
        </div>
        <div class="Doc__titleBlock">
          <h1 class="Doc__title">{{ title }}</h1>
          <dl class="Doc__meta">
            <div><dt>{{ label('invoiceNo') }}</dt><dd>{{ invoice.number }}</dd></div>
            <div><dt>{{ label('issued') }}</dt><dd>{{ formatDay(invoice.issueDate) }}</dd></div>
            <div v-if="type === 'quote'"><dt>Valid until</dt><dd>{{ formatDay(invoice.dueDate) }}</dd></div>
            <div v-else-if="type === 'invoice' && show.dueDate"><dt>{{ label('due') }}</dt><dd>{{ formatDay(invoice.dueDate) }}</dd></div>
            <div v-if="type === 'credit' && invoice.sourceNumber"><dt>For invoice</dt><dd>{{ invoice.sourceNumber }}</dd></div>
            <div v-if="invoice.reference && show.reference"><dt>{{ label('reference') }}</dt><dd>{{ invoice.reference }}</dd></div>
          </dl>
        </div>
      </header>

      <section v-else-if="s.key === 'to'" class="Doc__to" :class="sectionClass(s)">
        <div class="Doc__label">{{ label('billTo') }}</div>
        <div class="Doc__toName">{{ invoice.contactName }}</div>
        <div v-if="invoice.contactAddress && show.customerAddress" class="Doc__pre">{{ invoice.contactAddress }}</div>
        <div v-if="invoice.contactEmail && show.customerEmail" class="Doc__muted">{{ invoice.contactEmail }}</div>
      </section>

      <section v-else-if="s.key === 'intro'" class="Doc__intro Doc__pre" :class="sectionClass(s)">{{ fill(layout.intro) }}</section>

      <div v-else-if="s.key === 'lines'" :class="sectionClass(s)">
        <table class="Doc__table">
          <thead>
            <tr>
              <th class="Doc__desc">{{ label('description') }}</th>
              <template v-if="show.qtyPrice">
                <th class="num">{{ label('qty') }}</th>
                <th class="num">{{ label('price') }}</th>
              </template>
              <th v-if="showTax" class="num">{{ label('gst') }}</th>
              <th class="num">{{ label('amount') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(l, i) in invoice.lines" :key="i">
              <td class="Doc__desc">
                {{ l.description || '—' }}
                <span v-if="taxOn && l.taxCode && l.taxCode !== tax?.defaultCode.sales" class="Doc__code">{{ TAX_CODE_MAP[l.taxCode].label }}</span>
              </td>
              <template v-if="show.qtyPrice">
                <td class="num">{{ qty(l.qtyMilli) }}</td>
                <td class="num">{{ money(l.unitPrice) }}</td>
              </template>
              <td v-if="showTax" class="num">{{ money(l.tax) }}</td>
              <td class="num">{{ money(lineAmount(l)) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <section v-else-if="s.key === 'totals'" class="Doc__totals" :class="sectionClass(s)">
        <dl>
          <template v-if="taxOn">
            <div><dt>{{ label('subtotal') }}</dt><dd>{{ money(invoice.net) }}</dd></div>
            <div><dt>{{ label('gstTotal') }}</dt><dd>{{ money(invoice.tax) }}</dd></div>
          </template>
          <div class="Doc__grand">
            <dt>{{ label('total') }}{{ tax?.spellOut ? ` (inc. ${tax.short})` : '' }}</dt><dd>{{ money(invoice.total) }}</dd>
          </div>
          <template v-if="type === 'invoice' && (invoice.paid || invoice.credited)">
            <div v-if="invoice.credited"><dt>{{ label('credited') }}</dt><dd>−{{ money(invoice.credited) }}</dd></div>
            <div v-if="invoice.paid"><dt>{{ label('paid') }}</dt><dd>−{{ money(invoice.paid) }}</dd></div>
            <div class="Doc__due"><dt>{{ label('amountDue') }}</dt><dd>{{ money(amountDue) }}</dd></div>
          </template>
        </dl>
      </section>

      <section v-else-if="s.key === 'notes'" class="Doc__notes Doc__pre" :class="sectionClass(s)">{{ invoice.notes }}</section>

      <section v-else-if="s.key === 'payment'" class="Doc__pay" :class="sectionClass(s)">
        <div class="Doc__label">{{ label('payment') }}</div>
        <div class="Doc__pre">{{ fill(from.paymentDetails) }}</div>
      </section>

      <section v-else-if="s.key === 'footer'" class="Doc__footer Doc__pre" :class="sectionClass(s)">{{ fill(t.footer) }}</section>
    </template>

    <footer v-if="foot.length" class="Doc__foot">
      <template v-for="s in foot" :key="s.key">
        <div v-if="s.key === 'payment'" class="Doc__pay" :class="sectionClass(s)">
          <div class="Doc__label">{{ label('payment') }}</div>
          <div class="Doc__pre">{{ fill(from.paymentDetails) }}</div>
        </div>
        <div v-else-if="s.key === 'footer'" class="Doc__footer Doc__pre" :class="sectionClass(s)">{{ fill(t.footer) }}</div>
        <div v-else-if="s.key === 'intro'" class="Doc__intro Doc__pre" :class="sectionClass(s)">{{ fill(layout.intro) }}</div>
        <div v-else-if="s.key === 'notes'" class="Doc__notes Doc__pre" :class="sectionClass(s)">{{ invoice.notes }}</div>
        <div v-else-if="s.key === 'to'" class="Doc__to" :class="sectionClass(s)">
          <div class="Doc__label">{{ label('billTo') }}</div>
          <div class="Doc__toName">{{ invoice.contactName }}</div>
          <div v-if="invoice.contactAddress && show.customerAddress" class="Doc__pre">{{ invoice.contactAddress }}</div>
        </div>
      </template>
    </footer>
  </article>
</template>

<style scoped>
.Doc {
  --ink: #1d1f24;
  --muted: #6b6f78;
  --rule: #e3e5e9;
  position: relative;
  box-sizing: border-box;
  width: 210mm;
  min-height: 297mm;
  padding: 18mm 16mm;
  background: #fff;
  color: var(--ink);
  font: 13px/1.45 -apple-system, 'Helvetica Neue', 'Segoe UI', Roboto, Arial, sans-serif;
  display: flex;
  flex-direction: column;
  gap: 10mm;
}

.Doc * {
  box-sizing: border-box;
}

.Doc__head {
  display: flex;
  justify-content: space-between;
  gap: 12mm;
}

.Doc__logo {
  max-height: 22mm;
  max-width: 60mm;
  object-fit: contain;
  display: block;
  margin-bottom: 4mm;
}

.Doc__fromName {
  font-size: 17px;
  font-weight: 700;
}

.Doc__taxId {
  font-weight: 600;
  margin: 1mm 0;
}

.Doc__pre {
  white-space: pre-line;
}

.Doc__muted {
  color: var(--muted);
}

.Doc__titleBlock {
  text-align: right;
}

.Doc__title {
  margin: 0 0 4mm;
  font-size: 26px;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--accent);
}

.Doc__meta {
  margin: 0;
  display: grid;
  gap: 1mm;
}

.Doc__meta div {
  display: flex;
  justify-content: flex-end;
  gap: 4mm;
}

.Doc__meta dt {
  color: var(--muted);
}

.Doc__meta dd {
  margin: 0;
  min-width: 30mm;
  font-weight: 600;
}

.Doc__label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--muted);
  margin-bottom: 1.5mm;
}

.Doc__toName {
  font-weight: 700;
  font-size: 15px;
}

.Doc__table {
  width: 100%;
  border-collapse: collapse;
}

.Doc__table th {
  text-align: left;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
  padding: 2.5mm 2mm;
  border-bottom: 2px solid var(--ink);
}

.Doc__table td {
  padding: 3mm 2mm;
  border-bottom: 1px solid var(--rule);
  vertical-align: top;
}

.Doc__table .num {
  text-align: right;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.Doc__desc {
  width: 55%;
}

.Doc__code {
  display: inline-block;
  margin-left: 2mm;
  padding: 0 1.5mm;
  font-size: 10px;
  border: 1px solid var(--rule);
  border-radius: 3px;
  color: var(--muted);
}

.Doc__totals {
  display: flex;
  justify-content: flex-end;
}

.Doc__totals dl {
  margin: 0;
  min-width: 75mm;
  display: grid;
  gap: 1.5mm;
}

.Doc__totals div {
  display: flex;
  justify-content: space-between;
  gap: 6mm;
}

.Doc__totals dt {
  color: var(--muted);
}

.Doc__totals dd {
  margin: 0;
  font-variant-numeric: tabular-nums;
}

.Doc__grand {
  border-top: 2px solid var(--ink);
  padding-top: 2mm;
  font-size: 16px;
  font-weight: 700;
}

.Doc__grand dt {
  color: var(--ink) !important;
}

.Doc__due {
  font-weight: 700;
  color: var(--accent);
}

.Doc__notes {
  padding: 4mm;
  background: #f6f7f9;
  border-radius: 2mm;
}

.Doc__foot {
  margin-top: auto;
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 10mm;
  padding-top: 6mm;
  border-top: 1px solid var(--rule);
}

.Doc__footer {
  color: var(--muted);
}

.Doc__foot > * {
  flex: 1 1 0;
  min-width: 0;
}

/* ---- per-section alignment and size ---- */
.Doc__sec--center {
  text-align: center;
}

.Doc__sec--right {
  text-align: right;
}

.Doc__sec--small {
  zoom: 0.88;
}

.Doc__sec--large {
  zoom: 1.15;
}

.Doc__head.Doc__sec--right {
  flex-direction: row-reverse;
}

.Doc__head.Doc__sec--right .Doc__titleBlock {
  text-align: left;
}

.Doc__head.Doc__sec--right .Doc__meta div {
  justify-content: flex-start;
}

.Doc__head.Doc__sec--right .Doc__logo {
  margin-left: auto;
}

.Doc__head.Doc__sec--center {
  flex-direction: column;
  align-items: center;
  gap: 6mm;
}

.Doc__head.Doc__sec--center .Doc__titleBlock {
  text-align: center;
}

.Doc__head.Doc__sec--center .Doc__meta div {
  justify-content: center;
}

.Doc__head.Doc__sec--center .Doc__logo {
  margin-inline: auto;
}

.Doc__totals.Doc__sec--left {
  justify-content: flex-start;
}

.Doc__totals.Doc__sec--center {
  justify-content: center;
}

.Doc__totals.Doc__sec--right,
.Doc__totals.Doc__sec--center {
  text-align: left;
}

.Doc__stamp {
  position: absolute;
  top: 70mm;
  right: 18mm;
  transform: rotate(-12deg);
  padding: 2mm 6mm;
  border: 3px solid;
  border-radius: 3mm;
  font-size: 28px;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  opacity: 0.55;
  pointer-events: none;
}

.Doc__stamp--paid {
  color: #15803d;
}

.Doc__stamp--void {
  color: #b91c1c;
}

/* ---- modern: accent band header ---- */
.Doc--modern.Doc--headFirst {
  padding-top: 0;
}

.Doc--modern .Doc__head {
  margin: 0 -16mm;
  padding: 14mm 16mm 10mm;
  background: var(--accent);
  color: #fff;
}

.Doc--modern .Doc__head .Doc__muted,
.Doc--modern .Doc__meta dt {
  color: rgba(255, 255, 255, 0.78);
}

.Doc--modern .Doc__title {
  color: #fff;
}

.Doc--modern .Doc__table th {
  border-bottom-color: var(--accent);
  color: var(--accent);
}

.Doc--modern .Doc__grand {
  border-top-color: var(--accent);
}

/* ---- minimal: light rules, lots of air ---- */
.Doc--minimal {
  padding: 24mm 22mm;
  gap: 14mm;
}

.Doc--minimal .Doc__title {
  font-weight: 300;
  font-size: 30px;
  color: var(--ink);
}

.Doc--minimal .Doc__fromName {
  font-weight: 600;
}

.Doc--minimal .Doc__table th {
  border-bottom: 1px solid var(--rule);
}

.Doc--minimal .Doc__grand {
  border-top: 1px solid var(--ink);
  font-weight: 600;
}

.Doc--minimal .Doc__notes {
  background: none;
  padding: 0;
  border-left: 2px solid var(--accent);
  padding-left: 4mm;
}
</style>
