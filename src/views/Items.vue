<script setup lang="ts">
// Products and services: lines you use again and again on invoices and bills.
// Pick one in the document editor and it fills in the text, price, category
// and tax code.
import { computed, onMounted, ref } from 'vue';
import {
  Badge,
  DataTable,
  FormLayout,
  FormLayoutGroup,
  Modal,
  ModalSection,
  Page,
  SegmentedControl,
  Select,
  TextField,
  toast,
  type DataTableColumnType,
} from '@octans/ui';
import { api, errorMessage, type Category, type CategoryKind, type Item, type TaxCode } from '../lib/api';
import { onBooksChanged } from '../lib/live';
import { formatMoney, parseMoney, toInput } from '../lib/money';
import { booksProfile, booksTax, session } from '../lib/session';
import { taxCodeOr, taxCodesFor, tracksTax } from '../shared/tax';

const items = ref<Item[]>([]);
const categories = ref<Category[]>([]);
const loading = ref(true);
const show = ref<CategoryKind | 'all'>('all');

const currency = computed(() => session.books!.currency);
const tax = computed(() => booksTax());
const taxOn = (kind: CategoryKind) => !!tax.value && tracksTax(booksProfile().tax, kind);

const rows = computed(() => items.value.filter((i) => show.value === 'all' || i.kind === show.value));

const columns: DataTableColumnType[] = [
  { key: 'name', label: 'Name', minWidth: 200 },
  { key: 'kind', label: 'Used on', width: 110 },
  { key: 'categoryName', label: 'Category', width: 200 },
  { key: 'unitPrice', label: 'Price', width: 150 },
];

async function load() {
  loading.value = true;
  try {
    [items.value, categories.value] = await Promise.all([api.listItems(), api.listCategories()]);
  } finally {
    loading.value = false;
  }
}
onMounted(load);
onBooksChanged(load);

function priceText(i: Item) {
  const p = formatMoney(i.unitPrice, currency.value);
  if (!taxOn(i.kind) || !i.taxCode) return p;
  return `${p} ${i.priceIncludesTax ? 'inc.' : 'ex.'} ${tax.value!.short}`;
}

// ---- edit ---------------------------------------------------------------------

const editing = ref(false);
const error = ref<string | null>(null);
const blank = (kind: CategoryKind = 'income') => ({
  id: undefined as number | undefined,
  kind,
  name: '',
  description: '',
  price: '',
  priceIncludesTax: session.books!.pricesIncludeTax,
  categoryId: null as number | null,
  taxCode: null as TaxCode | null,
});
const form = ref(blank());

const categoryOptions = computed(() =>
  categories.value
    .filter((c) => c.kind === form.value.kind && (!c.archived || c.id === form.value.categoryId))
    .map((c) => ({ label: c.path, value: c.id })),
);
const taxOptions = computed(() => taxCodesFor(booksProfile().tax, form.value.kind).map((t) => ({ label: t.label, value: t.code })));

function open(i?: Item) {
  error.value = null;
  form.value = i
    ? {
        id: i.id,
        kind: i.kind,
        name: i.name,
        description: i.description ?? '',
        price: toInput(i.unitPrice, currency.value),
        priceIncludesTax: i.priceIncludesTax,
        categoryId: i.categoryId,
        taxCode: i.taxCode,
      }
    : blank(show.value === 'expense' ? 'expense' : 'income');
  if (!i) onKind(form.value.kind);
  editing.value = true;
}

/** Switching sides clears the category and picks that side's usual tax code. */
function onKind(kind: CategoryKind) {
  form.value.kind = kind;
  const usable = categories.value.filter((c) => c.kind === kind && !c.archived && c.class === 'pnl');
  form.value.categoryId = (usable.find((c) => c.name === (kind === 'income' ? 'Sales' : 'Uncategorised Expense')) ?? usable[0])?.id ?? null;
  onCategory(form.value.categoryId);
  if (kind === 'expense') form.value.priceIncludesTax = true;
}

function onCategory(id: number | null) {
  form.value.categoryId = id;
  const cat = categories.value.find((c) => c.id === id);
  form.value.taxCode = taxOn(form.value.kind) ? taxCodeOr(booksProfile().tax, form.value.kind, cat?.taxCode) : null;
}

async function save() {
  const unitPrice = form.value.price.trim() ? parseMoney(form.value.price, currency.value) : 0;
  if (unitPrice === null) {
    error.value = 'Enter the price as a number, or leave it blank.';
    return;
  }
  try {
    await api.saveItem({
      id: form.value.id,
      kind: form.value.kind,
      name: form.value.name,
      description: form.value.description,
      unitPrice,
      priceIncludesTax: form.value.priceIncludesTax,
      categoryId: form.value.categoryId,
      taxCode: form.value.taxCode,
    });
    editing.value = false;
    await load();
  } catch (e) {
    error.value = errorMessage(e);
  }
}

async function archive(i: Item, archived: boolean) {
  try {
    await api.archiveItem(i.id, archived);
    await load();
  } catch (e) {
    toast({ title: errorMessage(e), tone: 'error' });
  }
}

async function remove(i: Item) {
  try {
    await api.deleteItem(i.id);
    toast({ title: `Deleted ${i.name}`, content: 'Invoices and bills that used it are unchanged.' });
    await load();
  } catch (e) {
    toast({ title: errorMessage(e), tone: 'error' });
  }
}
</script>

<template>
  <Page
    title="Products & services"
    subtitle="Lines you use often. Pick one on an invoice or bill and it fills in the description, price, category and tax."
    size="wide"
    :primary-action="{ label: 'Add item', icon: 'mdi:plus', onAction: () => open() }"
  >
    <div class="Filter">
      <SegmentedControl
        v-model="show"
        :options="[{ label: 'All', value: 'all' }, { label: 'Sell', value: 'income' }, { label: 'Buy', value: 'expense' }]"
      />
    </div>
    <DataTable
      :columns="columns"
      :rows="rows"
      :loading="loading"
      empty-text="Nothing saved yet. Add an item here, or use “Save as item” on an invoice line."
      @click-row="open"
      :row-actions="(row: Item) => [
        { label: 'Edit', icon: 'mdi:pencil-outline', onAction: () => open(row) },
        row.archived
          ? { label: 'Restore', icon: 'mdi:archive-arrow-up-outline', onAction: () => archive(row, false) }
          : { label: 'Archive', icon: 'mdi:archive-outline', onAction: () => archive(row, true) },
        { label: 'Delete', icon: 'mdi:delete-outline', onAction: () => remove(row) },
      ]"
    >
      <template #col:name="{ row }">
        <span>{{ row.name }}</span>
        <Badge v-if="row.archived" class="Archived">Archived</Badge>
        <div v-if="row.description && row.description !== row.name" class="subdued Small">{{ row.description }}</div>
      </template>
      <template #col:kind="{ row }">{{ row.kind === 'income' ? 'Invoices' : 'Bills' }}</template>
      <template #col:categoryName="{ row }">{{ row.categoryName ?? '' }}</template>
      <template #col:unitPrice="{ row }"><span class="money">{{ priceText(row) }}</span></template>
    </DataTable>

    <Modal
      :visible="editing"
      :title="form.id ? 'Edit item' : 'Add item'"
      :primary-action="{ label: 'Save', onAction: save }"
      :secondary-actions="[{ label: 'Cancel', onAction: () => (editing = false) }]"
      overflow-visible
      @close="editing = false"
    >
      <ModalSection>
        <FormLayout>
          <SegmentedControl
            :model-value="form.kind"
            :options="[{ label: 'I sell it (invoices)', value: 'income' }, { label: 'I buy it (bills)', value: 'expense' }]"
            @update:model-value="onKind"
          />
          <TextField v-model="form.name" label="Name" placeholder="e.g. Design work (per hour)" :error="error" />
          <TextField
            v-model="form.description"
            label="Description on the document (optional)"
            multiline="2"
            help-text="Leave blank to use the name."
          />
          <FormLayoutGroup>
            <TextField v-model="form.price" label="Price" align="right" placeholder="0.00" />
            <div v-if="taxOn(form.kind)">
              <div class="Label">Price is</div>
              <SegmentedControl
                v-model="form.priceIncludesTax"
                :options="[{ label: `${tax?.short} inclusive`, value: true }, { label: `${tax?.short} exclusive`, value: false }]"
              />
            </div>
          </FormLayoutGroup>
          <FormLayoutGroup>
            <Select :model-value="form.categoryId" label="Category" :options="categoryOptions" searchable @update:model-value="onCategory" />
            <Select v-if="taxOn(form.kind)" v-model="form.taxCode" :label="`${tax?.short} code`" :options="taxOptions" />
          </FormLayoutGroup>
        </FormLayout>
      </ModalSection>
    </Modal>
  </Page>
</template>

<style scoped>
.Filter {
  margin-bottom: 12px;
}

.Archived {
  margin-left: 8px;
}

.Small {
  font-size: 12px;
}

.Label {
  font-size: 13px;
  margin-bottom: 6px;
}
</style>
