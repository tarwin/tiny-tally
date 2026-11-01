<script setup lang="ts">
// "When the description contains …, use this category." Imports apply them
// before guessing from history.
import { computed, onMounted, ref } from 'vue';
import { DataTable, FormLayout, Modal, ModalSection, Page, SegmentedControl, Select, TextField, toast, type DataTableColumnType } from '@octans/ui';
import { api, errorMessage, type Category, type CategoryKind, type Contact, type Rule } from '../lib/api';

const rules = ref<Rule[]>([]);
const categories = ref<Category[]>([]);
const contacts = ref<Contact[]>([]);
const loading = ref(true);

const columns: DataTableColumnType[] = [
  { key: 'pattern', label: 'When the description contains', minWidth: 200 },
  { key: 'kind', label: 'Money', width: 100, formatFunc: (v: CategoryKind) => (v === 'income' ? 'In' : 'Out') },
  { key: 'categoryName', label: 'Category', width: 220 },
  { key: 'contactName', label: 'Contact', width: 180, formatFunc: (v) => v ?? '' },
];

async function load() {
  loading.value = true;
  try {
    [rules.value, categories.value, contacts.value] = await Promise.all([api.listRules(), api.listCategories(), api.listContacts()]);
  } finally {
    loading.value = false;
  }
}
onMounted(load);

const editing = ref(false);
const form = ref({ id: undefined as number | undefined, pattern: '', kind: 'expense' as CategoryKind, categoryId: null as number | null, contactId: null as number | null });
const error = ref<string | null>(null);

const categoryOptions = computed(() =>
  categories.value.filter((c) => c.kind === form.value.kind && !c.archived).map((c) => ({ label: c.path, value: c.id })),
);
const contactOptions = computed(() => contacts.value.filter((c) => !c.archived).map((c) => ({ label: c.name, value: c.id })));

function open(r?: Rule) {
  error.value = null;
  form.value = r
    ? { id: r.id, pattern: r.pattern, kind: r.kind, categoryId: r.categoryId, contactId: r.contactId }
    : { id: undefined, pattern: '', kind: 'expense', categoryId: null, contactId: null };
  editing.value = true;
}

async function save() {
  if (!form.value.categoryId) {
    error.value = 'Choose a category.';
    return;
  }
  try {
    await api.saveRule({ ...form.value, categoryId: form.value.categoryId });
    editing.value = false;
    await load();
  } catch (e) {
    error.value = errorMessage(e);
  }
}

async function remove(r: Rule) {
  try {
    await api.deleteRule(r.id);
    toast({ title: 'Rule deleted' });
    await load();
  } catch (e) {
    toast({ title: errorMessage(e), tone: 'error' });
  }
}
</script>

<template>
  <Page
    title="Import rules"
    subtitle="Bank lines that match a rule get its category when you import. Newest rules are checked first."
    :primary-action="{ label: 'Add rule', icon: 'mdi:plus', onAction: () => open() }"
  >
    <DataTable
      :columns="columns"
      :rows="rules"
      :loading="loading"
      empty-text="No rules yet. Add one here, or tick “Remember” when you import."
      @click-row="open"
      :row-actions="(row: Rule) => [
        { label: 'Edit', icon: 'mdi:pencil-outline', onAction: () => open(row) },
        { label: 'Delete', icon: 'mdi:delete-outline', onAction: () => remove(row) },
      ]"
    />

    <Modal
      :visible="editing"
      :title="form.id ? 'Edit rule' : 'Add rule'"
      :primary-action="{ label: 'Save', onAction: save }"
      :secondary-actions="[{ label: 'Cancel', onAction: () => (editing = false) }]"
      overflow-visible
      @close="editing = false"
    >
      <ModalSection>
        <FormLayout>
          <TextField v-model="form.pattern" label="When the description contains" placeholder="e.g. OFFICEWORKS" :error="error" help-text="Upper or lower case doesn't matter." />
          <SegmentedControl
            v-model="form.kind"
            :options="[{ label: 'Money out', value: 'expense' }, { label: 'Money in', value: 'income' }]"
            @update:model-value="form.categoryId = null"
          />
          <Select v-model="form.categoryId" label="Category" :options="categoryOptions" searchable />
          <Select v-model="form.contactId" label="Contact (optional)" :options="contactOptions" searchable clearable />
        </FormLayout>
      </ModalSection>
    </Modal>
  </Page>
</template>
