<script setup lang="ts">
import { useRouter } from 'vue-router';
import { computed, onMounted, ref, watch } from 'vue';
import {
  DataTable,
  FormLayout,
  FormLayoutGroup,
  Modal,
  ModalSection,
  Page,
  SegmentedControl,
  TextField,
  ToggleSwitch,
  toast,
  type DataTableColumnType,
} from '@octans/ui';
import { api, errorMessage, type Contact, type ContactKind } from '../lib/api';
import { formatDay } from '../lib/dates';
import { dataVersion } from '../lib/entryEditor';
import { formatMoney } from '../lib/money';
import { session } from '../lib/session';

const router = useRouter();
const contacts = ref<Contact[]>([]);
const loading = ref(true);
const kind = ref<ContactKind | 'all'>('all');
const showArchived = ref(false);
const search = ref('');

const currency = computed(() => session.company!.currency);

const rows = computed(() => {
  const q = search.value.trim().toLowerCase();
  return contacts.value.filter(
    (c) =>
      (kind.value === 'all' || c.kind === kind.value) &&
      (showArchived.value || !c.archived) &&
      (!q || [c.name, c.email, c.phone].some((v) => v?.toLowerCase().includes(q))),
  );
});
const hasArchived = computed(() => contacts.value.some((c) => c.archived));

const filterOptions = [
  { label: 'All', value: 'all' },
  { label: 'Customers', value: 'customer' },
  { label: 'Vendors', value: 'vendor' },
];
const kindOptions = filterOptions.slice(1);

const columns = computed<DataTableColumnType[]>(() => [
  { key: 'name', label: 'Name', minWidth: 200, formatFunc: (v, row) => (row.archived ? `${v} (archived)` : v) },
  { key: 'kind', label: 'Type', width: 110, formatFunc: (v) => (v === 'customer' ? 'Customer' : 'Vendor') },
  { key: 'email', label: 'Email', minWidth: 180, formatFunc: (v) => v ?? '' },
  { key: 'received', label: 'Received', width: 130, formatFunc: (v) => (v ? formatMoney(v, currency.value) : '') },
  { key: 'paid', label: 'Paid', width: 130, formatFunc: (v) => (v ? formatMoney(v, currency.value) : '') },
  { key: 'lastDate', label: 'Last activity', width: 140, formatFunc: (v) => (v ? formatDay(v) : '') },
]);

async function load() {
  loading.value = true;
  try {
    contacts.value = await api.listContacts();
  } finally {
    loading.value = false;
  }
}

const editing = ref(false);
const saving = ref(false);
const blank = () => ({
  id: undefined as number | undefined,
  kind: (kind.value === 'all' ? 'customer' : kind.value) as ContactKind,
  name: '',
  email: '',
  phone: '',
  address: '',
  notes: '',
});
const form = ref(blank());
const nameError = ref<string | null>(null);

function openEditor(c?: Contact) {
  nameError.value = null;
  form.value = c
    ? { id: c.id, kind: c.kind, name: c.name, email: c.email ?? '', phone: c.phone ?? '', address: c.address ?? '', notes: c.notes ?? '' }
    : blank();
  editing.value = true;
}

async function save() {
  if (!form.value.name.trim()) {
    nameError.value = 'Give the contact a name.';
    return;
  }
  saving.value = true;
  try {
    await api.saveContact(form.value);
    editing.value = false;
    toast({ title: form.value.id ? 'Contact updated' : 'Contact added', tone: 'success' });
    await load();
  } catch (e) {
    toast({ title: "Couldn't save contact", content: errorMessage(e), tone: 'error' });
  } finally {
    saving.value = false;
  }
}

async function setArchived(c: Contact, archived: boolean) {
  await api.archiveContact(c.id, archived);
  toast({ title: archived ? `Archived ${c.name}` : `Restored ${c.name}` });
  await load();
}

watch(dataVersion, load);
onMounted(load);
</script>

<template>
  <Page
    title="Contacts"
    subtitle="Customers you get paid by and vendors you pay."
    size="wide"
    :primary-action="{ label: 'Add contact', icon: 'mdi:plus', onAction: () => openEditor() }"
  >
    <div class="Toolbar">
      <SegmentedControl v-model="kind" :options="filterOptions" />
      <div class="Toolbar__right">
        <ToggleSwitch v-if="hasArchived" v-model="showArchived" label="Show archived" />
        <TextField v-model="search" placeholder="Search contacts" />
      </div>
    </div>
    <DataTable
      :columns="columns"
      :rows="rows"
      :loading="loading"
      empty-text="No contacts yet. Add one here, or while recording a transaction."
      :row-actions="(row: Contact) => [
        { label: 'Edit', icon: 'mdi:pencil-outline', onAction: () => openEditor(row) },
        row.kind === 'customer'
          ? { label: 'Statement', icon: 'mdi:file-document-multiple-outline', onAction: () => router.push(`/contacts/${row.id}/statement`) }
          : { label: 'New bill', icon: 'mdi:receipt-text-plus-outline', onAction: () => router.push(`/bills/new?contact=${row.id}`) },
        row.archived
          ? { label: 'Restore', icon: 'mdi:archive-arrow-up-outline', onAction: () => setArchived(row, false) }
          : { label: 'Archive', icon: 'mdi:archive-outline', onAction: () => setArchived(row, true) },
      ]"
      @click-row="(row: Contact) => openEditor(row)"
    />

    <Modal
      :visible="editing"
      :title="form.id ? 'Edit contact' : 'Add contact'"
      :loading="saving"
      :primary-action="{ label: form.id ? 'Save' : 'Add contact', onAction: save }"
      :secondary-actions="[{ label: 'Cancel', onAction: () => (editing = false) }]"
      @close="editing = false"
    >
      <ModalSection>
        <FormLayout>
          <SegmentedControl v-model="form.kind" :options="kindOptions" />
          <TextField v-model="form.name" label="Name" required :error="nameError" />
          <FormLayoutGroup>
            <TextField v-model="form.email" label="Email" type="email" />
            <TextField v-model="form.phone" label="Phone" type="tel" />
          </FormLayoutGroup>
          <TextField v-model="form.address" label="Address" multiline="3" />
          <TextField v-model="form.notes" label="Notes" multiline="2" />
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
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 12px;
}

.Toolbar__right {
  display: flex;
  align-items: center;
  gap: 12px;
}
</style>
