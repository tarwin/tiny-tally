<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  Banner,
  Button,
  Card,
  CardSection,
  DatePicker,
  FormLayout,
  FormLayoutGroup,
  Page,
  SegmentedControl,
  Select,
  TextField,
  ToggleSwitch,
  toast,
} from '@octans/ui';
import {
  api,
  errorMessage,
  type Category,
  type Contact,
  type Invoice,
  type InvoiceTemplate,
  type Item,
  type TaxCode,
  type TaxRate,
  type TradingName,
} from '../lib/api';
import { addDays, today } from '../lib/dates';
import { DOCS } from '../lib/documents';

import { formatMoney, minorDigits, parseMoney, ratePercent, toInput } from '../lib/money';
import { booksProfile, booksTax, session } from '../lib/session';
import { useTabTitle } from '../lib/tabs';
import { INVOICE_CURRENCIES, fxRateText, parseFxRate, toBooks } from '../shared/currency';
import { EXPORT_PLACE, GST_RATE_OPTIONS, gstSplit, gstinState, placeFor } from '../shared/india';
import { IN_STATE_OPTIONS } from '../lib/worldOptions';
import { lineTotals, sumTotals, taxCodeOr, taxCodesFor, taxFromInclusive, taxOnExclusive, tracksTax } from '../shared/tax';

const route = useRoute();
const router = useRouter();

interface LineForm {
  key: number;
  description: string;
  qty: string;
  price: string;
  categoryId: number | null;
  taxCode: TaxCode | null;
  hsn: string;
  /** India: the line's GST rate. Null elsewhere. */
  taxRatePpm: number | null;
}

const doc = computed(() => DOCS[route.meta.docType ?? 'invoice']);
const isBill = computed(() => doc.value.type === 'bill');
const books = computed(() => session.books!);
// What prices are in: the books' currency unless this sale is in another.
const currency = computed(() => form.value.currency || books.value.currency);
const foreign = computed(() => !isBill.value && form.value.currency !== books.value.currency);
const fxRate = computed(() => parseFxRate(form.value.fxRate));
const currencyOptions = computed(() =>
  [...new Set([books.value.currency, ...INVOICE_CURRENCIES, form.value.currency])].map((c) => ({ label: c, value: c })));
const tax = computed(() => booksTax());
const taxKind = computed(() => (isBill.value ? 'expense' : 'income'));
// No tax on the bills side where it isn't claimed (US).
const taxOn = computed(() => !!tax.value && tracksTax(booksProfile().tax, taxKind.value));
const money = (v: number) => formatMoney(v, currency.value);

const editingId = computed(() => (route.params.id ? Number(route.params.id) : null));
const existing = ref<Invoice | null>(null);
const loading = ref(true);
const saving = ref(false);

const customers = ref<Contact[]>([]);
const categories = ref<Category[]>([]);
const templates = ref<InvoiceTemplate[]>([]);
const tradingNames = ref<TradingName[]>([]);
const items = ref<Item[]>([]);
const suggested = ref('');

let lineKey = 0;
/** India: what a new line starts at. Null elsewhere, where the document has one rate. */
const booksGstRate = () => (books.value.country === 'IN' && taxOn.value ? books.value.taxRatePpm : null);
const blankLine = (): LineForm => ({
  key: ++lineKey,
  description: '',
  qty: '1',
  price: '',
  categoryId: defaultCategory(),
  taxCode: taxOn.value ? defaultTaxFor(defaultCategory()) : null,
  hsn: '',
  taxRatePpm: booksGstRate(),
});

const startTerms = (): number | 'custom' =>
  doc.value.type === 'quote' ? 30 : doc.value.type === 'credit' ? 0 : isBill.value ? 30 : books.value.paymentTermsDays;

const form = ref({
  contactId: null as number | null,
  number: '',
  reference: '',
  issueDate: today(),
  terms: startTerms(),
  dueDate: addDays(today(), startTerms() as number),
  templateId: null as number | null,
  /** Who it's from. Bills don't have one. */
  tradingNameId: null as number | null,
  // Supplier bills almost always show tax-inclusive totals.
  pricesIncludeTax: isBill.value ? true : books.value.pricesIncludeTax,
  /** US sales: null is the books' own rate. */
  taxRateId: null as number | null,
  currency: session.books!.currency,
  fxRate: '',
  /** India: a state code or EXPORT; null follows the customer. */
  placeOfSupply: null as string | null,
  reverseCharge: false,
  exportMode: 'lut' as 'lut' | 'igst',
  notes: '',
  lines: [] as LineForm[],
});

// ---- India: place of supply ---------------------------------------------------------

const india = computed(() => books.value.country === 'IN' && taxOn.value && !isBill.value);
const placeOptions = [{ label: 'Outside India (export)', value: EXPORT_PLACE }, ...IN_STATE_OPTIONS];
const place = computed(() => form.value.placeOfSupply);
const isExport = computed(() => india.value && place.value === EXPORT_PLACE);
const exportLut = computed(() => isExport.value && form.value.exportMode === 'lut');
const homeState = computed(() => books.value.homeState || gstinState(books.value.taxId));
const intraState = computed(() => india.value && gstSplit(place.value, homeState.value) === 'intra');

const newCustomer = ref<string | null>(null);
/** From a hand-off file: saved with the new customer if they add it. */
const newCustomerAddress = ref('');
const newCustomerDetails = ref<{ tin?: string; state?: string | null; country?: string | null }>({});

function defaultCategory() {
  const usable = categories.value.filter((c) => c.kind === doc.value.categoryKind && !c.archived && c.class === 'pnl');
  const preferred = isBill.value ? 'Uncategorised Expense' : 'Sales';
  return (usable.find((c) => c.name === preferred) ?? usable[0])?.id ?? null;
}

function defaultTaxFor(categoryId: number | null): TaxCode | null {
  const code = taxCodeOr(booksProfile().tax, taxKind.value, categories.value.find((c) => c.id === categoryId)?.taxCode);
  // A customer with a resale or exemption certificate isn't charged sales tax.
  return code === 'TAX' && exemptCustomer.value ? 'NON' : code;
}

// ---- US sales tax rates -----------------------------------------------------------

/** US invoices, quotes and credit notes can be at one of several rates. */
const usSale = computed(() => books.value.country === 'US' && !isBill.value && taxOn.value);
const taxRates = ref<TaxRate[]>([]);
const contactOf = (id: number | null) => customers.value.find((c) => c.id === id);
const exemptCustomer = computed(() => (usSale.value ? contactOf(form.value.contactId)?.taxExempt ?? null : null));
const rateOptions = computed(() => [
  { label: `${books.value.taxRateName || 'Your rate'} (${ratePercent(books.value.taxRatePpm)}%)`, value: null },
  ...taxRates.value
    .filter((r) => !r.archived || r.id === form.value.taxRateId)
    .map((r) => ({ label: `${r.name} (${ratePercent(r.ratePpm)}%)`, value: r.id })),
]);
/** A saved document keeps the rate it was worked out at while it stays on the same one. */
const ratePpm = computed(() => {
  if (!usSale.value) return books.value.taxRatePpm;
  const inv = existing.value;
  if (inv && inv.taxRatePpm !== null && (inv.taxRateId ?? null) === form.value.taxRateId) return inv.taxRatePpm;
  return taxRates.value.find((r) => r.id === form.value.taxRateId)?.ratePpm ?? books.value.taxRatePpm;
});

const termOptions = computed(() =>
  doc.value.type === 'quote'
    ? [
        { label: 'Valid for 7 days', value: 7 },
        { label: 'Valid for 14 days', value: 14 },
        { label: 'Valid for 30 days', value: 30 },
        { label: 'Valid for 60 days', value: 60 },
        { label: 'Custom date', value: 'custom' },
      ]
    : [
        { label: 'Due on receipt', value: 0 },
        { label: '7 days', value: 7 },
        { label: '14 days', value: 14 },
        { label: '30 days', value: 30 },
        { label: 'End of next month', value: -1 },
        { label: 'Custom date', value: 'custom' },
      ],
);

watch(
  () => [form.value.issueDate, form.value.terms] as const,
  ([issue, terms]) => {
    if (doc.value.type === 'credit') {
      form.value.dueDate = issue;
      return;
    }
    if (terms === 'custom') return;
    if (terms === -1) {
      const [y, m] = issue.split('-').map(Number);
      const end = new Date(y, m + 1, 0);
      form.value.dueDate = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
    } else form.value.dueDate = addDays(issue, terms);
  },
);

const customerOptions = computed(() =>
  customers.value
    .filter((c) => !c.archived || c.id === existing.value?.contactId)
    .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === doc.value.contactKind ? -1 : 1))
    .map((c) => ({
      label: c.name,
      value: c.id,
      description: c.kind !== doc.value.contactKind ? (c.kind === 'vendor' ? 'Supplier' : 'Customer') : c.email ?? undefined,
    })),
);
const categoryOptions = computed(() =>
  categories.value
    .filter((c) => c.kind === doc.value.categoryKind && (!c.archived || form.value.lines.some((l) => l.categoryId === c.id)))
    .map((c) => ({ label: c.path, value: c.id })),
);
const taxOptions = computed(() =>
  taxCodesFor(booksProfile().tax, taxKind.value).map((t) => ({ label: t.label, value: t.code })),
);
const templateOptions = computed(() =>
  templates.value.map((t) => ({ label: t.isDefault ? `${t.name} (default)` : t.name, value: t.id })),
);

// ---- who it's from ----------------------------------------------------------------

const tradingNameOptions = computed(() =>
  tradingNames.value
    .filter((t) => !t.isArchived || t.id === form.value.tradingNameId)
    .map((t) => ({ label: t.isDefault ? `${t.name} (default)` : t.name, value: t.id })),
);
/** Picked by hand, so changing the customer leaves it alone. */
const fromTouched = ref(false);

/** The customer's trading name, else the default. */
function tradingNameFor(contactId: number | null) {
  const theirs = customers.value.find((c) => c.id === contactId)?.tradingNameId;
  const usable = tradingNames.value.filter((t) => !t.isArchived);
  return (usable.find((t) => t.id === theirs) ?? usable.find((t) => t.isDefault) ?? usable[0])?.id ?? null;
}

/** A trading name can bring its own template. */
function useTradingName(id: number | null) {
  form.value.tradingNameId = id;
  const own = tradingNames.value.find((t) => t.id === id)?.templateId;
  if (own && templates.value.some((t) => t.id === own)) form.value.templateId = own;
}

function pickTradingName(id: number | null) {
  fromTouched.value = true;
  useTradingName(id);
}

watch(
  () => form.value.contactId,
  (id) => {
    if (!loading.value && !existing.value && !isBill.value && !fromTouched.value) useTradingName(tradingNameFor(id));
    if (!loading.value && !existing.value && india.value) form.value.placeOfSupply = placeFor(contactOf(id));
    if (!loading.value && !existing.value && usSale.value) {
      // New documents start at the customer's rate, and with no tax for an exempt customer.
      form.value.taxRateId = contactOf(id)?.taxRateId ?? null;
      for (const l of form.value.lines) l.taxCode = defaultTaxFor(l.categoryId);
    }
  },
);

// A trading name can number its documents on its own, so the suggested number follows it.
watch(
  () => form.value.tradingNameId,
  async (id) => {
    if (loading.value || isBill.value) return;
    const inv = existing.value;
    // A draft's number moves to the new name's numbering on save (the backend
    // decides, and keeps numbers typed by hand), so show the suggestion instead.
    if (inv?.status === 'draft') {
      if (id === inv.tradingNameId) {
        if (!form.value.number) form.value.number = inv.number;
        return;
      }
      if (form.value.number === inv.number) form.value.number = '';
    }
    suggested.value = await api.suggestInvoiceNumber(doc.value.type, id);
  },
);

function parseQty(s: string) {
  const n = Number(String(s).replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) : null;
}

const computedLines = computed(() =>
  form.value.lines.map((l) => {
    const qtyMilli = parseQty(l.qty) ?? 0;
    const unitPrice = parseMoney(l.price, currency.value) ?? 0;
    const taxCode = exportLut.value && l.taxCode === 'GST' ? 'ZER' : l.taxCode;
    return { ...lineTotals({ qtyMilli, unitPrice, taxCode }, form.value.pricesIncludeTax, taxOn.value, l.taxRatePpm ?? ratePpm.value, intraState.value && !foreign.value), qtyMilli, unitPrice };
  }),
);
const totals = computed(() => sumTotals(computedLines.value));
const inBooksCurrency = computed(() =>
  foreign.value && fxRate.value ? formatMoney(toBooks(totals.value.gross, fxRate.value, currency.value, books.value.currency), books.value.currency) : '');

function addLine() {
  form.value.lines.push(blankLine());
}

function removeLine(i: number) {
  form.value.lines.splice(i, 1);
  if (!form.value.lines.length) addLine();
}

/** Picking an income category brings its usual tax code with it. */
function onCategory(line: LineForm, id: number | null) {
  line.categoryId = id;
  const cat = categories.value.find((c) => c.id === id);
  if (taxOn.value && cat?.taxCode && taxOptions.value.some((t) => t.value === cat.taxCode)) line.taxCode = cat.taxCode;
}

// ---- saved products and services ---------------------------------------------

const itemOptions = computed(() =>
  items.value
    .filter((i) => i.kind === doc.value.categoryKind && !i.archived)
    .map((i) => ({ label: i.name, value: i.id, description: i.unitPrice ? money(i.unitPrice) : undefined })),
);
/** Bound to the picker, which empties again after each pick. */
const pickedItem = ref<number | null>(null);

/** The item as a line, its price moved across if it was saved the other side of tax. */
function addItem(id: number | null) {
  const item = items.value.find((i) => i.id === id);
  pickedItem.value = null;
  if (!item) return;
  const categoryId = categories.value.some((c) => c.id === item.categoryId) ? item.categoryId : defaultCategory();
  const taxCode = !taxOn.value ? null : taxOptions.value.some((t) => t.value === item.taxCode) ? item.taxCode : defaultTaxFor(categoryId);
  let price = item.unitPrice;
  if (taxOn.value && item.priceIncludesTax !== form.value.pricesIncludeTax) {
    const rate = item.taxRatePpm ?? ratePpm.value;
    price = item.priceIncludesTax ? price - taxFromInclusive(price, item.taxCode, rate) : price + taxOnExclusive(price, item.taxCode, rate);
  }
  // Items are priced in the books' currency. Without a rate yet, the price is left to type.
  if (foreign.value) price = fxRate.value ? toBooks(price, 1_000_000_000_000 / fxRate.value, books.value.currency, currency.value) : 0;
  const line: LineForm = {
    key: ++lineKey,
    description: item.description || item.name,
    qty: '1',
    price: price ? toInput(price, currency.value) : '',
    categoryId,
    taxCode,
    hsn: item.hsn ?? '',
    taxRatePpm: item.taxRatePpm ?? booksGstRate(),
  };
  // Fill the empty line left at the bottom rather than adding below it.
  const last = form.value.lines[form.value.lines.length - 1];
  if (last && !last.description.trim() && !last.price.trim()) form.value.lines.splice(form.value.lines.length - 1, 1, line);
  else form.value.lines.push(line);
}

async function saveAsItem(line: LineForm, i: number) {
  const text = line.description.trim();
  const name = text.split('\n')[0].slice(0, 80);
  try {
    await api.saveItem({
      kind: doc.value.categoryKind,
      name,
      description: text === name ? null : text,
      unitPrice: foreign.value && fxRate.value
        ? toBooks(computedLines.value[i]?.unitPrice ?? 0, fxRate.value, currency.value, books.value.currency)
        : computedLines.value[i]?.unitPrice ?? 0,
      priceIncludesTax: form.value.pricesIncludeTax,
      categoryId: line.categoryId,
      taxCode: line.taxCode,
      hsn: line.hsn || null,
      taxRatePpm: line.taxRatePpm,
    });
    items.value = await api.listItems();
    toast({ title: `Saved “${name}”`, content: 'Pick it from “Add saved item” next time.', tone: 'success' });
  } catch (e) {
    toast({ title: "Couldn't save the item", content: errorMessage(e), tone: 'error' });
  }
}

async function addCustomer() {
  const name = newCustomer.value?.trim();
  if (!name) return;
  try {
    const id = await api.saveContact({ kind: doc.value.contactKind, name, address: newCustomerAddress.value || null, ...newCustomerDetails.value });
    customers.value = await api.listContacts();
    form.value.contactId = id;
    newCustomer.value = null;
    newCustomerAddress.value = '';
  } catch (e) {
    toast({ title: `Couldn't add ${doc.value.contactLabel.toLowerCase()}`, content: errorMessage(e), tone: 'error' });
  }
}

async function save(status?: 'draft' | 'sent') {
  if (!form.value.contactId) {
    toast({ title: `Choose a ${doc.value.contactLabel.toLowerCase()}`, tone: 'error' });
    return;
  }
  const bad = form.value.lines.findIndex((l, i) => (l.description || l.price) && (parseQty(l.qty) === null || computedLines.value[i] === undefined || parseMoney(l.price, currency.value) === null));
  if (bad >= 0) {
    toast({ title: `Check line ${bad + 1}`, content: 'Enter a quantity above zero and a price.', tone: 'error' });
    return;
  }
  saving.value = true;
  try {
    const id = await api.saveInvoice({
      id: editingId.value ?? undefined,
      updatedAt: existing.value?.updatedAt,
      docType: doc.value.type,
      sourceId: route.query.source ? Number(route.query.source) : undefined,
      number: form.value.number.trim() || null,
      contactId: form.value.contactId,
      issueDate: form.value.issueDate,
      dueDate: form.value.dueDate,
      reference: form.value.reference,
      notes: form.value.notes,
      templateId: form.value.templateId,
      tradingNameId: isBill.value ? null : form.value.tradingNameId,
      pricesIncludeTax: form.value.pricesIncludeTax,
      taxRateId: usSale.value ? form.value.taxRateId : null,
      currency: foreign.value ? form.value.currency : null,
      fxRateMicro: foreign.value ? fxRate.value : null,
      placeOfSupply: india.value ? form.value.placeOfSupply : null,
      reverseCharge: india.value && form.value.reverseCharge,
      exportMode: isExport.value ? form.value.exportMode : null,
      status,
      lines: form.value.lines.map((l, i) => ({
        description: l.description,
        qtyMilli: computedLines.value[i].qtyMilli,
        unitPrice: computedLines.value[i].unitPrice,
        categoryId: l.categoryId,
        taxCode: l.taxCode,
        hsn: l.hsn,
        taxRatePpm: l.taxRatePpm,
      })),
    });
    const approved = status === 'sent' && existing.value?.rawStatus !== 'sent';
    toast({
      title: approved ? (doc.value.printable ? `${doc.value.one} ready to send` : `${doc.value.one} approved`) : `${doc.value.one} saved`,
      tone: 'success',
    });
    await router.replace(`${doc.value.base}/${id}`);
  } catch (e) {
    toast({ title: `Couldn't save ${doc.value.word}`, content: errorMessage(e), tone: 'error' });
  } finally {
    saving.value = false;
  }
}

onMounted(async () => {
  [customers.value, categories.value, templates.value, tradingNames.value, suggested.value, items.value] = await Promise.all([
    api.listContacts(),
    api.listCategories(),
    api.listTemplates(),
    api.listTradingNames(),
    api.suggestInvoiceNumber(doc.value.type),
    api.listItems(),
  ]);
  if (usSale.value) taxRates.value = await api.listTaxRates();
  form.value.templateId = templates.value.find((t) => t.isDefault)?.id ?? null;
  if (editingId.value) {
    const inv = (existing.value = await api.getInvoice(editingId.value));
    const days = Math.round((Date.parse(inv.dueDate) - Date.parse(inv.issueDate)) / 86400000);
    form.value = {
      contactId: inv.contactId,
      number: inv.number,
      reference: inv.reference ?? '',
      issueDate: inv.issueDate,
      terms: termOptions.value.some((o) => o.value === days) ? days : 'custom',
      dueDate: inv.dueDate,
      templateId: inv.templateId ?? form.value.templateId,
      tradingNameId: inv.tradingNameId,
      pricesIncludeTax: inv.pricesIncludeTax,
      taxRateId: inv.taxRateId,
      currency: inv.currency ?? books.value.currency,
      fxRate: inv.fxRateMicro ? fxRateText(inv.fxRateMicro) : '',
      placeOfSupply: inv.placeOfSupply,
      reverseCharge: inv.reverseCharge,
      exportMode: inv.exportMode ?? 'lut',
      notes: inv.notes ?? '',
      lines: inv.lines.map((l) => ({
        key: ++lineKey,
        description: l.description,
        qty: String(l.qtyMilli / 1000),
        price: toInput(l.unitPrice, inv.currency ?? books.value.currency),
        categoryId: l.categoryId,
        hsn: l.hsn ?? '',
        taxRatePpm: l.taxRatePpm ?? (books.value.country === 'IN' ? inv.taxRatePpm ?? booksGstRate() : null),
        taxCode: l.taxCode ?? (taxOn.value ? defaultTaxFor(l.categoryId) : null),
      })),
    };
  } else {
    const contact = Number(route.query.contact);
    if (contact) form.value.contactId = contact;
    if (usSale.value) form.value.taxRateId = contactOf(form.value.contactId)?.taxRateId ?? null;
    if (!isBill.value) {
      useTradingName(tradingNameFor(form.value.contactId));
      suggested.value = await api.suggestInvoiceNumber(doc.value.type, form.value.tradingNameId);
    }
    form.value.lines = [blankLine()];
  }
  form.value.terms = existing.value ? form.value.terms : startTerms();
  if (!editingId.value && typeof route.query.handoff === 'string') await applyHandoff(route.query.handoff);
  loading.value = false;
});

// ---- a draft handed over by another app (Tiny Time) -------------------------------

/** "Filled in from Tiny Time…", shown until the invoice is saved. */
const handoffNote = ref<{ source: string; detail: string; warning: string | null } | null>(null);

/** Fill the new invoice from a .tallyinvoice file. Nothing is saved until they save. */
async function applyHandoff(path: string) {
  try {
    const h = await api.readInvoiceHandoff(path);
    const name = h.customer.name.toLowerCase();
    const same = customers.value.filter((c) => c.name.trim().toLowerCase() === name);
    const match = same.find((c) => !c.archived && c.kind === doc.value.contactKind) ?? same.find((c) => !c.archived) ?? same[0];
    if (match) form.value.contactId = match.id;
    else {
      newCustomer.value = h.customer.name;
      newCustomerAddress.value = h.customer.address;
      newCustomerDetails.value = { tin: h.customer.taxId, state: h.customer.state, country: h.customer.country };
    }
    useTradingName(tradingNameFor(form.value.contactId));
    suggested.value = await api.suggestInvoiceNumber(doc.value.type, form.value.tradingNameId);
    if (usSale.value) form.value.taxRateId = contactOf(form.value.contactId)?.taxRateId ?? null;
    if (h.number) form.value.number = h.number;
    if (h.issueDate) form.value.issueDate = h.issueDate;
    if (h.dueDays !== null) {
      if (termOptions.value.some((o) => o.value === h.dueDays)) form.value.terms = h.dueDays;
      else {
        form.value.terms = 'custom';
        form.value.dueDate = addDays(form.value.issueDate, h.dueDays);
      }
    }
    form.value.reference = h.reference;
    form.value.notes = h.notes;
    if (india.value) form.value.placeOfSupply = placeFor(contactOf(form.value.contactId) ?? h.customer);
    if (h.currency && !isBill.value) form.value.currency = h.currency;
    const digits = minorDigits(currency.value);
    form.value.lines = h.lines.map((l) => ({
      ...blankLine(),
      hsn: l.hsn ?? '',
      description: l.description,
      qty: String(l.quantity),
      price: toInput(Math.round(l.unitPrice * 10 ** digits), currency.value),
    }));
    const hours = h.lines.reduce((a, l) => a + l.quantity, 0);
    handoffNote.value = {
      source: h.source,
      detail: `${h.lines.length} ${h.lines.length === 1 ? 'line' : 'lines'}, ${hours.toFixed(2).replace(/\.?0+$/, '')} hours for ${h.customer.name}.`
        + (match ? '' : ` ${h.customer.name} isn't a customer yet: add them above.`)
        + ' Check it over, then save.',
      warning: h.currency && h.currency !== books.value.currency
        ? (isBill.value
          ? `${h.source} priced this in ${h.currency}, but these books are in ${books.value.currency}. The amounts haven't been converted.`
          : `${h.source} priced this in ${h.currency}. Enter the exchange rate before you save.`)
        : null,
    };
  } catch (e) {
    toast({ title: "Couldn't open the invoice file", content: errorMessage(e), tone: 'error' });
  }
}

// A second hand-off while this editor is already open (kept alive in its tab).
watch(
  () => route.query.handoff,
  (path) => {
    if (!loading.value && !editingId.value && typeof path === 'string') void applyHandoff(path);
  },
);

const title = computed(() => (existing.value ? `Edit ${existing.value.number}` : `New ${doc.value.word}`));
useTabTitle(() => title.value);
const approveHint = computed(() => {
  switch (doc.value.type) {
    case 'bill': return "Approving counts the bill as money you owe. Drafts don't.";
    case 'quote': return "Mark it sent once it's with the customer. Quotes never count as income.";
    case 'credit': return 'Approving lets you use the credit against an invoice or refund it.';
    default: return "Approving gives the invoice its number and counts it as money owed to you. Drafts don't.";
  }
});
const isSent = computed(() => existing.value?.rawStatus === 'sent');
</script>

<template>
  <Page
    :title="title"
    :breadcrumbs="[{ label: doc.many, onAction: () => router.push(doc.base) }]"
    size="fullWidth"
    :loading="loading"
  >
    <Banner v-if="handoffNote" status="info" :title="`Filled in from ${handoffNote.source}`" class="Handoff">
      {{ handoffNote.detail }}
    </Banner>
    <Banner v-if="handoffNote?.warning" status="warning" title="Different currency" class="Handoff">
      {{ handoffNote.warning }}
    </Banner>
    <div class="Grid">
      <div class="Main">
        <Card>
          <CardSection>
            <FormLayout>
              <div v-if="newCustomer !== null" class="Inline">
                <TextField v-model="newCustomer" :label="`New ${doc.contactLabel.toLowerCase()}`" placeholder="Business or person's name" @keydown.enter.prevent="addCustomer" />
                <Button type="primary" @click="addCustomer">Add</Button>
                <Button type="plain" @click="newCustomer = null; newCustomerAddress = ''">Cancel</Button>
              </div>
              <div v-else class="Inline">
                <Select
                  v-model="form.contactId"
                  :label="doc.contactLabel"
                  :options="customerOptions"
                  searchable
                  required
                  show-description
                  :placeholder="isBill ? 'Who is the bill from?' : 'Who is this for?'"
                />
                <Button icon="mdi:account-plus-outline" :tooltip="`New ${doc.contactLabel.toLowerCase()}`" @click="newCustomer = ''" />
              </div>
              <FormLayoutGroup>
                <TextField v-if="isBill" v-model="form.reference" label="Supplier's invoice number" placeholder="As printed on their bill" />
                <TextField v-model="form.number" :label="doc.numberLabel" :placeholder="suggested" help-text="Leave blank to number it automatically." />
                <TextField v-if="!isBill" v-model="form.reference" label="Reference (optional)" placeholder="e.g. PO number" />
              </FormLayoutGroup>
              <FormLayoutGroup v-if="!isBill">
                <Select v-model="form.currency" label="Currency" :options="currencyOptions" searchable />
                <TextField
                  v-if="foreign"
                  v-model="form.fxRate"
                  :label="`1 ${form.currency} in ${books.currency}`"
                  align="right"
                  placeholder="e.g. 84.25"
                  required
                  :help-text="inBooksCurrency ? `${inBooksCurrency} in your books` : 'Your rate on the invoice date. Your books record it at this rate.'"
                />
              </FormLayoutGroup>
              <FormLayoutGroup v-if="india">
                <Select v-model="form.placeOfSupply" label="Place of supply" :options="placeOptions" searchable placeholder="Choose" />
                <Select
                  v-if="isExport"
                  v-model="form.exportMode"
                  label="GST on this export"
                  :options="[{ label: 'None, under a Letter of Undertaking', value: 'lut' }, { label: 'IGST paid, to claim a refund', value: 'igst' }]"
                />
              </FormLayoutGroup>
              <ToggleSwitch v-if="india && !isExport" v-model="form.reverseCharge" label="Reverse charge applies" help-text="The customer pays the GST to the government. It's printed on the invoice." />
              <FormLayoutGroup>
                <DatePicker v-model="form.issueDate" type="date" model-format="YYYY-MM-DD" :label="doc.issueLabel" required />
                <template v-if="doc.type !== 'credit'">
                  <Select v-model="form.terms" :label="doc.type === 'quote' ? 'Valid for' : 'Payment terms'" :options="termOptions" />
                  <DatePicker
                    v-model="form.dueDate"
                    type="date"
                    model-format="YYYY-MM-DD"
                    :label="doc.dueLabel"
                    :disabled="form.terms !== 'custom'"
                  />
                </template>
              </FormLayoutGroup>
            </FormLayout>
          </CardSection>
        </Card>

        <Card title="Items">
          <CardSection v-if="taxOn">
            <div class="TaxMode">
              <span class="subdued">Prices are</span>
              <SegmentedControl
                v-model="form.pricesIncludeTax"
                size="small"
                :options="[{ label: `${tax?.short} inclusive`, value: true }, { label: `${tax?.short} exclusive`, value: false }]"
              />
              <Select
                v-if="usSale && (taxRates.length || form.taxRateId !== null)"
                v-model="form.taxRateId"
                :options="rateOptions"
                size="small"
                class="RatePick"
              />
            </div>
            <p v-if="exemptCustomer" class="subdued Exempt">No sales tax for this customer: {{ exemptCustomer }}</p>
          </CardSection>
          <CardSection>
            <div class="Lines">
              <div class="Lines__head subdued">
                <span>Description</span>
                <span class="num">Qty</span>
                <span class="num">{{ taxOn ? (form.pricesIncludeTax ? `Price inc. ${tax?.short}` : `Price ex. ${tax?.short}`) : 'Price' }}</span>
                <span class="num">Amount</span>
                <span />
              </div>
              <div v-for="(line, i) in form.lines" :key="line.key" class="Line">
                <div class="Line__main">
                  <TextField v-model="line.description" :placeholder="isBill ? 'What was it for?' : 'What did you do or sell?'" multiline="1" />
                  <TextField v-model="line.qty" align="right" placeholder="1" />
                  <TextField v-model="line.price" align="right" placeholder="0.00" />
                  <span class="num money Line__amount">
                    {{ money(form.pricesIncludeTax ? computedLines[i]?.gross ?? 0 : computedLines[i]?.net ?? 0) }}
                  </span>
                  <Button type="plain" icon="mdi:close" tooltip="Remove line" @click="removeLine(i)" />
                </div>
                <div class="Line__meta">
                  <Select
                    :model-value="line.categoryId"
                    :options="categoryOptions"
                    size="small"
                    placeholder="Category"
                    @update:model-value="(v: number | null) => onCategory(line, v)"
                  />
                  <Select v-if="taxOn" v-model="line.taxCode" :options="taxOptions" size="small" />
                  <Select
                    v-if="taxOn && books.country === 'IN' && line.taxCode === 'GST' && !exportLut"
                    v-model="line.taxRatePpm"
                    :options="GST_RATE_OPTIONS"
                    size="small"
                  />
                  <TextField v-if="books.country === 'IN'" v-model="line.hsn" size="small" placeholder="HSN/SAC" />
                  <Button
                    v-if="line.description.trim()"
                    type="plain"
                    size="small"
                    icon="mdi:bookmark-plus-outline"
                    tooltip="Save this line to Products & services"
                    @click="saveAsItem(line, i)"
                  >Save as item</Button>
                </div>
              </div>
            </div>
            <div class="AddRow">
              <Button type="plain" icon="mdi:plus" @click="addLine">Add line</Button>
              <Select
                v-if="itemOptions.length"
                :model-value="pickedItem"
                :options="itemOptions"
                searchable
                show-description
                size="small"
                placeholder="Add saved item…"
                class="AddRow__pick"
                @update:model-value="addItem"
              />
            </div>
          </CardSection>
          <CardSection>
            <dl class="Totals">
              <template v-if="taxOn">
                <div><dt>Subtotal (ex. {{ tax?.short }})</dt><dd class="money">{{ money(totals.net) }}</dd></div>
                <template v-if="india && intraState">
                  <div><dt>CGST</dt><dd class="money">{{ money(Math.round(totals.tax / 2)) }}</dd></div>
                  <div><dt>SGST</dt><dd class="money">{{ money(totals.tax - Math.round(totals.tax / 2)) }}</dd></div>
                </template>
                <div v-else><dt>{{ india ? 'IGST' : tax?.name }}</dt><dd class="money">{{ money(totals.tax) }}</dd></div>
              </template>
              <div class="Totals__grand"><dt>Total</dt><dd class="money">{{ money(totals.gross) }}</dd></div>
            </dl>
          </CardSection>
        </Card>

        <Card title="Notes">
          <CardSection>
            <TextField
              v-model="form.notes"
              multiline="3"
              :placeholder="doc.printable ? `Shown on the ${doc.word}: thank-you note, project summary, terms…` : 'Anything to remember about this bill'"
            />
          </CardSection>
        </Card>
      </div>

      <aside class="Side">
        <Card>
          <CardSection v-if="doc.printable">
            <FormLayout>
              <Select
                v-if="tradingNameOptions.length > 1"
                :model-value="form.tradingNameId"
                label="From"
                :options="tradingNameOptions"
                @update:model-value="pickTradingName"
              />
              <Select v-model="form.templateId" label="Template" :options="templateOptions" />
              <Button type="plain" icon="mdi:palette-outline" @click="router.push('/invoices/templates')">Edit templates</Button>
            </FormLayout>
          </CardSection>
          <CardSection>
            <div class="Actions">
              <template v-if="isSent">
                <Button type="primary" full-width :loading="saving" @click="save()">Save changes</Button>
              </template>
              <template v-else>
                <Button type="primary" full-width :loading="saving" @click="save('sent')">
                  {{ doc.type === 'quote' ? 'Save & mark sent' : 'Approve & save' }}
                </Button>
                <Button full-width :disabled="saving" @click="save('draft')">Save as draft</Button>
              </template>
              <Button type="plain" full-width @click="router.back()">Cancel</Button>
            </div>
            <p v-if="!isSent" class="subdued Hint">{{ approveHint }}</p>
          </CardSection>
        </Card>
      </aside>
    </div>
  </Page>
</template>

<style scoped>
.Handoff {
  margin-bottom: 16px;
}
.Grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 280px;
  gap: 16px;
  align-items: start;
}

@media (max-width: 1000px) {
  .Grid {
    grid-template-columns: 1fr;
  }
}

.Main,
.Side {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.Side {
  position: sticky;
  top: 16px;
}

.Inline {
  display: flex;
  align-items: flex-end;
  gap: 8px;
}

.Inline > :first-child {
  flex: 1;
  min-width: 0;
}

.TaxMode {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}

.RatePick {
  min-width: 220px;
}

.Exempt {
  margin: 8px 0 0;
  font-size: 12px;
}

.Lines {
  --cols: minmax(160px, 1fr) 64px 120px 110px 32px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 8px;
}

.Lines__head,
.Line__main {
  display: grid;
  grid-template-columns: var(--cols);
  gap: 8px;
  align-items: start;
}

.Lines__head {
  font-size: 12px;
  margin-bottom: -4px;
}

.Line {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--octans-border);
}

.Line__meta {
  display: grid;
  grid-template-columns: minmax(0, 220px) minmax(0, 220px) auto auto;
  gap: 8px;
  justify-items: start;
}

.AddRow {
  display: flex;
  align-items: center;
  gap: 8px;
}

.AddRow__pick {
  width: 240px;
}

.num {
  text-align: right;
}

.Line__amount {
  padding-top: 8px;
}

.Totals {
  margin: 0 0 0 auto;
  max-width: 320px;
  display: grid;
  gap: 6px;
}

.Totals div {
  display: flex;
  justify-content: space-between;
  gap: 16px;
}

.Totals dt {
  color: var(--octans-text-subdued);
}

.Totals dd {
  margin: 0;
}

.Totals__grand {
  padding-top: 6px;
  border-top: 1px solid var(--octans-border);
  font-size: 16px;
  font-weight: 600;
}

.Totals__grand dt {
  color: var(--octans-text);
}

.Actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.Hint {
  font-size: 12px;
  margin: 10px 0 0;
}
</style>
