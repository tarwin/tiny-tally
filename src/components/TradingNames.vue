<script setup lang="ts">
// Settings → Trading names: the business names you invoice under, each with
// its own address, contact details, payment details and logo. Saves on its
// own, not with the rest of the settings form.
import { computed, onMounted, ref } from 'vue';
import {
  Button,
  Card,
  CardSection,
  DataTable,
  FormLayout,
  FormLayoutGroup,
  Icon,
  Modal,
  ModalSection,
  Select,
  TextField,
  confirmModal,
  toast,
  type DataTableColumnType,
} from '@octans/ui';
import { api, errorMessage, type InvoiceTemplate, type TradingName } from '../lib/api';

const names = ref<TradingName[]>([]);
const templates = ref<InvoiceTemplate[]>([]);
const loading = ref(true);

const columns: DataTableColumnType[] = [
  { key: 'name', label: 'Name', minWidth: 200, formatFunc: (v, row) => (row.isArchived ? `${v} (archived)` : row.isDefault ? `${v} (default)` : v) },
  { key: 'email', label: 'Email', minWidth: 160, formatFunc: (v) => v ?? '' },
  { key: 'uses', label: 'Documents', width: 110, formatFunc: (v) => (v ? String(v) : '') },
];

async function load() {
  loading.value = true;
  try {
    [names.value, templates.value] = await Promise.all([api.listTradingNames(), api.listTemplates()]);
  } finally {
    loading.value = false;
  }
}

const templateOptions = computed(() => [
  { label: 'The default template', value: null },
  ...templates.value.map((t) => ({ label: t.name, value: t.id })),
]);

const editing = ref(false);
const saving = ref(false);
const nameError = ref<string | null>(null);
const blank = () => ({
  id: undefined as number | undefined,
  name: '',
  logo: null as string | null,
  address: '',
  email: '',
  phone: '',
  paymentDetails: '',
  templateId: null as number | null,
});
const form = ref(blank());

function openEditor(t?: TradingName) {
  nameError.value = null;
  form.value = t
    ? {
        id: t.id,
        name: t.name,
        logo: t.logo,
        address: t.address ?? '',
        email: t.email ?? '',
        phone: t.phone ?? '',
        paymentDetails: t.paymentDetails ?? '',
        templateId: t.templateId,
      }
    : blank();
  editing.value = true;
}

async function chooseLogo() {
  const path = await tiny.dialog.openFile({ types: ['png', 'jpg', 'jpeg', 'svg', 'webp'] });
  if (!path) return;
  try {
    form.value.logo = await api.readLogo(path);
  } catch (e) {
    toast({ title: "Couldn't use that image", content: errorMessage(e), tone: 'error' });
  }
}

async function save() {
  if (!form.value.name.trim()) {
    nameError.value = 'Give the trading name a name.';
    return;
  }
  saving.value = true;
  try {
    await api.saveTradingName(form.value);
    editing.value = false;
    toast({ title: form.value.id ? 'Trading name updated' : 'Trading name added', tone: 'success' });
    await load();
  } catch (e) {
    toast({ title: "Couldn't save trading name", content: errorMessage(e), tone: 'error' });
  } finally {
    saving.value = false;
  }
}

async function act(fn: () => Promise<unknown>, done: string) {
  try {
    await fn();
    toast({ title: done });
    await load();
  } catch (e) {
    toast({ title: errorMessage(e), tone: 'error' });
  }
}

const makeDefault = (t: TradingName) => act(() => api.setDefaultTradingName(t.id), `${t.name} is now the default`);
const setArchived = (t: TradingName, archived: boolean) =>
  act(() => api.archiveTradingName(t.id, archived), archived ? `Archived ${t.name}` : `Restored ${t.name}`);

function rowActions(t: TradingName) {
  return [
    { label: 'Edit', icon: 'mdi:pencil-outline', onAction: () => openEditor(t) },
    ...(t.isDefault || t.isArchived ? [] : [{ label: 'Make default', icon: 'mdi:star-outline', onAction: () => makeDefault(t) }]),
    ...(t.isDefault
      ? []
      : t.isArchived
        ? [{ label: 'Restore', icon: 'mdi:archive-arrow-up-outline', onAction: () => setArchived(t, false) }]
        : [{ label: 'Archive', icon: 'mdi:archive-outline', onAction: () => setArchived(t, true) }]),
    ...(t.isDefault || t.uses ? [] : [{ label: 'Delete', icon: 'mdi:delete-outline', onAction: () => remove(t) }]),
  ];
}

async function remove(t: TradingName) {
  const ok = await confirmModal({
    title: `Delete ${t.name}?`,
    content: 'Customers who were invoiced as it go back to the default.',
    primaryActionLabel: 'Delete',
    primaryActionType: 'destructive',
    secondaryActionLabel: 'Cancel',
  });
  if (ok) await act(() => api.deleteTradingName(t.id), `Deleted ${t.name}`);
}

onMounted(load);
</script>

<template>
  <Card title="Trading names" :actions="[{ label: 'Add trading name', icon: 'mdi:plus', onAction: () => openEditor() }]">
    <CardSection>
      <p class="subdued Hint">
        The names you invoice under. Each invoice, quote and credit note is from one of them, with its own address,
        contact and payment details. New documents use the customer's (set on the contact), or the default.
      </p>
    </CardSection>
    <DataTable
      :columns="columns"
      :rows="names"
      :loading="loading"
      empty-text="No trading names yet."
      @click-row="(row: TradingName) => openEditor(row)"
      :row-actions="rowActions"
    />

    <Modal
      :visible="editing"
      :title="form.id ? 'Edit trading name' : 'Add trading name'"
      :loading="saving"
      :primary-action="{ label: form.id ? 'Save' : 'Add trading name', onAction: save }"
      :secondary-actions="[{ label: 'Cancel', onAction: () => (editing = false) }]"
      @close="editing = false"
    >
      <ModalSection>
        <FormLayout>
          <TextField v-model="form.name" label="Name" required :error="nameError" placeholder="e.g. Acme Design Studio" />
          <TextField v-model="form.address" label="Address" multiline="3" />
          <FormLayoutGroup>
            <TextField v-model="form.email" label="Email" type="email" />
            <TextField v-model="form.phone" label="Phone" />
          </FormLayoutGroup>
          <TextField
            v-model="form.paymentDetails"
            label="Payment details"
            multiline="3"
            placeholder="Bank name, BSB and account number, PayID…"
            help-text="Printed on invoices and statements from this name."
          />
          <div>
            <div class="Label">Logo</div>
            <div class="Logo">
              <span class="Logo__tile">
                <img v-if="form.logo" :src="form.logo" alt="" />
                <Icon v-else icon="mdi:image-outline" class="subdued" />
              </span>
              <Button icon="mdi:image-outline" @click="chooseLogo">{{ form.logo ? 'Change…' : 'Choose image…' }}</Button>
              <Button v-if="form.logo" type="plain" @click="form.logo = null">Remove</Button>
            </div>
            <p class="subdued Help">Used on documents unless the template has its own logo.</p>
          </div>
          <Select v-model="form.templateId" label="Template" :options="templateOptions" help-text="New documents from this name start with it." />
        </FormLayout>
      </ModalSection>
    </Modal>
  </Card>
</template>

<style scoped>
.Hint {
  margin: 0;
}

.Label {
  margin: 0 0 4px;
  font-size: 13px;
}

.Logo {
  display: flex;
  align-items: center;
  gap: 8px;
}

.Logo__tile {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: #fff;
  box-shadow: 0 0 0 1px var(--octans-border);
  display: grid;
  place-items: center;
  overflow: hidden;
  font-size: 20px;
}

.Logo__tile img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.Help {
  font-size: 12px;
  margin: 6px 0 0;
}
</style>
