<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  DataTable,
  FormLayout,
  Modal,
  ModalSection,
  Page,
  SegmentedControl,
  Select,
  TextField,
  ToggleSwitch,
  toast,
  type DataTableColumnType,
} from '@octans/ui';
import { api, errorMessage, type Category, type CategoryClass, type CategoryKind, type TaxCode } from '../lib/api';
import { CLASS_INFO, classOptions } from '../lib/categoryClass';
import { session } from '../lib/session';
import { TAX_CODES, TAX_CODE_MAP } from '../shared/tax';

const taxOn = computed(() => !!session.company?.taxEnabled);

const categories = ref<Category[]>([]);
const loading = ref(true);
const kind = ref<CategoryKind>('expense');
const showArchived = ref(false);

const rows = computed(() =>
  categories.value.filter((c) => c.kind === kind.value && (showArchived.value || !c.archived)),
);
const hasArchived = computed(() => categories.value.some((c) => c.kind === kind.value && c.archived));

const kindOptions = [
  { label: 'Expenses', value: 'expense' },
  { label: 'Income', value: 'income' },
];

const columns = computed<DataTableColumnType[]>(() => [
  { key: 'name', label: 'Name', formatFunc: (v, row) => (row.archived ? `${v} (archived)` : v) },
  { key: 'class', label: 'Type', width: 200, formatFunc: (v: CategoryClass) => (v === 'pnl' ? '' : CLASS_INFO[v].label) },
  ...(taxOn.value
    ? [{ key: 'taxCode', label: 'Usual tax code', width: 220, formatFunc: (v: TaxCode | null) => (v ? TAX_CODE_MAP[v].label : 'None (not on BAS)') }]
    : []),
  { key: 'uses', label: 'Transactions', type: 'integer' as const, width: 140 },
]);

const taxOptions = computed(() =>
  TAX_CODES.filter((t) => (form.value.kind === 'income' ? t.sales : t.purchases)).map((t) => ({
    label: t.label,
    value: t.code,
    description: t.help,
  })),
);

async function load() {
  loading.value = true;
  try {
    categories.value = await api.listCategories();
  } finally {
    loading.value = false;
  }
}

const editing = ref(false);
const saving = ref(false);
const form = ref({
  id: undefined as number | undefined,
  name: '',
  kind: 'expense' as CategoryKind,
  class: 'pnl' as CategoryClass,
  taxCode: 'GST' as TaxCode | null,
});
const offBas = computed(() => CLASS_INFO[form.value.class].offBas);
const nameError = ref<string | null>(null);

function openEditor(c?: Category) {
  nameError.value = null;
  form.value = c
    ? { id: c.id, name: c.name, kind: c.kind, class: c.class, taxCode: c.taxCode }
    : { id: undefined, name: '', kind: kind.value, class: 'pnl', taxCode: taxOn.value ? 'GST' : null };
  editing.value = true;
}

async function save() {
  if (!form.value.name.trim()) {
    nameError.value = 'Give the category a name.';
    return;
  }
  saving.value = true;
  try {
    await api.saveCategory(form.value);
    editing.value = false;
    kind.value = form.value.kind;
    await load();
  } catch (e) {
    nameError.value = errorMessage(e);
  } finally {
    saving.value = false;
  }
}

async function setArchived(c: Category, archived: boolean) {
  try {
    await api.archiveCategory(c.id, archived);
    toast({ title: archived ? `Archived ${c.name}` : `Restored ${c.name}` });
    await load();
  } catch (e) {
    toast({ title: "Couldn't update category", content: errorMessage(e), tone: 'error' });
  }
}

onMounted(load);
</script>

<template>
  <Page
    title="Categories"
    subtitle="How income and spending are grouped on your reports."
    :primary-action="{ label: 'Add category', icon: 'mdi:plus', onAction: () => openEditor() }"
  >
    <div class="Toolbar">
      <SegmentedControl v-model="kind" :options="kindOptions" />
      <ToggleSwitch v-if="hasArchived" v-model="showArchived" label="Show archived" />
    </div>
    <DataTable
      :columns="columns"
      :rows="rows"
      :loading="loading"
      empty-text="No categories here yet."
      :row-actions="(row: Category) => [
        { label: 'Edit', icon: 'mdi:pencil-outline', onAction: () => openEditor(row) },
        row.archived
          ? { label: 'Restore', icon: 'mdi:archive-arrow-up-outline', onAction: () => setArchived(row, false) }
          : { label: 'Archive', icon: 'mdi:archive-outline', onAction: () => setArchived(row, true) },
      ]"
    />

    <Modal
      :visible="editing"
      :title="form.id ? 'Edit category' : 'Add category'"
      :loading="saving"
      :primary-action="{ label: form.id ? 'Save' : 'Add category', onAction: save }"
      :secondary-actions="[{ label: 'Cancel', onAction: () => (editing = false) }]"
      overflow-visible
      @close="editing = false"
    >
      <ModalSection>
        <FormLayout>
          <SegmentedControl v-if="!form.id" v-model="form.kind" :options="kindOptions" />
          <TextField
            v-model="form.name"
            label="Name"
            placeholder="e.g. Software & Subscriptions"
            required
            :error="nameError"
            @keydown.enter="save"
          />
          <Select
            v-model="form.class"
            label="Type"
            :options="classOptions(form.kind)"
            show-description
            :help-text="form.class === 'pnl' ? '' : 'Kept off Profit & Loss. Shown below it as other money in and out.'"
          />
          <Select
            v-if="taxOn && !offBas"
            v-model="form.taxCode"
            label="Usual tax code"
            :options="taxOptions"
            show-description
            clearable
            help-text="New transactions in this category start with this code. You can change it on each one."
          />
        </FormLayout>
      </ModalSection>
    </Modal>
  </Page>
</template>

<style scoped>
.Toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}
</style>
