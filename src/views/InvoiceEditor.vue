<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
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
  toast,
} from '@octans/ui';
import {
  api,
  errorMessage,
  type Category,
  type Contact,
  type Invoice,
  type InvoiceTemplate,
  type TaxCode,
  type TradingName,
} from '../lib/api';
import { addDays, today } from '../lib/dates';
import { DOCS } from '../lib/documents';
import { dataChanged } from '../lib/entryEditor';
import { formatMoney, parseMoney, toInput } from '../lib/money';
import { booksProfile, booksTax, session } from '../lib/session';
import { lineTotals, sumTotals, taxCodeOr, taxCodesFor, tracksTax } from '../shared/tax';

const route = useRoute();
const router = useRouter();

interface LineForm {
  key: number;
  description: string;
  qty: string;
  price: string;
  categoryId: number | null;
  taxCode: TaxCode | null;
}

const doc = computed(() => DOCS[route.meta.docType ?? 'invoice']);
const isBill = computed(() => doc.value.type === 'bill');
const books = computed(() => session.books!);
const currency = computed(() => books.value.currency);
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
const suggested = ref('');

let lineKey = 0;
const blankLine = (): LineForm => ({
  key: ++lineKey,
  description: '',
  qty: '1',
  price: '',
  categoryId: defaultCategory(),
  taxCode: taxOn.value ? defaultTaxFor(defaultCategory()) : null,
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
  notes: '',
  lines: [] as LineForm[],
});

const newCustomer = ref<string | null>(null);

function defaultCategory() {
  const usable = categories.value.filter((c) => c.kind === doc.value.categoryKind && !c.archived && c.class === 'pnl');
  const preferred = isBill.value ? 'Uncategorised Expense' : 'Sales';
  return (usable.find((c) => c.name === preferred) ?? usable[0])?.id ?? null;
}

function defaultTaxFor(categoryId: number | null): TaxCode | null {
  return taxCodeOr(booksProfile().tax, taxKind.value, categories.value.find((c) => c.id === categoryId)?.taxCode);
}

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
    .map((c) => ({ label: c.name, value: c.id })),
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
    return { ...lineTotals({ qtyMilli, unitPrice, taxCode: l.taxCode }, form.value.pricesIncludeTax, taxOn.value, books.value.taxRatePpm), qtyMilli, unitPrice };
  }),
);
const totals = computed(() => sumTotals(computedLines.value));

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

async function addCustomer() {
  const name = newCustomer.value?.trim();
  if (!name) return;
  try {
    const id = await api.saveContact({ kind: doc.value.contactKind, name });
    customers.value = await api.listContacts();
    form.value.contactId = id;
    newCustomer.value = null;
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
      status,
      lines: form.value.lines.map((l, i) => ({
        description: l.description,
        qtyMilli: computedLines.value[i].qtyMilli,
        unitPrice: computedLines.value[i].unitPrice,
        categoryId: l.categoryId,
        taxCode: l.taxCode,
      })),
    });
    dataChanged();
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
  [customers.value, categories.value, templates.value, tradingNames.value, suggested.value] = await Promise.all([
    api.listContacts(),
    api.listCategories(),
    api.listTemplates(),
    api.listTradingNames(),
    api.suggestInvoiceNumber(doc.value.type),
  ]);
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
      notes: inv.notes ?? '',
      lines: inv.lines.map((l) => ({
        key: ++lineKey,
        description: l.description,
        qty: String(l.qtyMilli / 1000),
        price: toInput(l.unitPrice, currency.value),
        categoryId: l.categoryId,
        taxCode: l.taxCode ?? (taxOn.value ? defaultTaxFor(l.categoryId) : null),
      })),
    };
  } else {
    const contact = Number(route.query.contact);
    if (contact) form.value.contactId = contact;
    if (!isBill.value) {
      useTradingName(tradingNameFor(form.value.contactId));
      suggested.value = await api.suggestInvoiceNumber(doc.value.type, form.value.tradingNameId);
    }
    form.value.lines = [blankLine()];
  }
  form.value.terms = existing.value ? form.value.terms : startTerms();
  loading.value = false;
});

const title = computed(() => (existing.value ? `Edit ${existing.value.number}` : `New ${doc.value.word}`));
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
    size="wide"
    :loading="loading"
  >
    <div class="Grid">
      <div class="Main">
        <Card>
          <CardSection>
            <FormLayout>
              <div v-if="newCustomer !== null" class="Inline">
                <TextField v-model="newCustomer" :label="`New ${doc.contactLabel.toLowerCase()}`" placeholder="Business or person's name" @keydown.enter.prevent="addCustomer" />
                <Button type="primary" @click="addCustomer">Add</Button>
                <Button type="plain" @click="newCustomer = null">Cancel</Button>
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
            </div>
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
                </div>
              </div>
            </div>
            <Button type="plain" icon="mdi:plus" @click="addLine">Add line</Button>
          </CardSection>
          <CardSection>
            <dl class="Totals">
              <template v-if="taxOn">
                <div><dt>Subtotal (ex. {{ tax?.short }})</dt><dd class="money">{{ money(totals.net) }}</dd></div>
                <div><dt>{{ tax?.name }}</dt><dd class="money">{{ money(totals.tax) }}</dd></div>
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
  gap: 12px;
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
  grid-template-columns: minmax(0, 220px) minmax(0, 220px);
  gap: 8px;
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
