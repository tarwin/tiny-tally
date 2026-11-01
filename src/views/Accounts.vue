<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  DataTable,
  DatePicker,
  FormLayout,
  Modal,
  ModalSection,
  Page,
  Select,
  TextField,
  ToggleSwitch,
  toast,
  type DataTableColumnType,
} from '@octans/ui';
import { api, errorMessage, type Account, type AccountKind } from '../lib/api';
import { formatDay, today } from '../lib/dates';
import { formatMoney, parseMoney, toInput } from '../lib/money';
import { session } from '../lib/session';

const KIND_LABELS: Record<AccountKind, string> = {
  bank: 'Bank account',
  credit_card: 'Credit card',
  cash: 'Cash',
};

const router = useRouter();
const accounts = ref<Account[]>([]);
const loading = ref(true);
const showArchived = ref(false);

const currency = computed(() => session.books!.currency);
const rows = computed(() => accounts.value.filter((a) => showArchived.value || !a.archived));
const hasArchived = computed(() => accounts.value.some((a) => a.archived));

const columns: DataTableColumnType[] = [
  { key: 'name', label: 'Name', formatFunc: (v, row) => (row.archived ? `${v} (archived)` : v) },
  { key: 'kind', label: 'Type', formatFunc: (v) => KIND_LABELS[v as AccountKind] },
  { key: 'openingDate', label: 'Opened' },
  { key: 'reconciledTo', label: 'Reconciled to' },
  {
    key: 'balance',
    label: 'Balance',
    type: 'numeric',
    formatFunc: (v, row) =>
      row.kind === 'credit_card' && v < 0 ? `${formatMoney(-v, currency.value)} owed` : formatMoney(v, currency.value),
  },
];

async function load() {
  loading.value = true;
  try {
    accounts.value = await api.listAccounts();
  } finally {
    loading.value = false;
  }
}

// ---- editor --------------------------------------------------------------

const editing = ref(false);
const saving = ref(false);
const form = ref({ id: undefined as number | undefined, name: '', kind: 'bank' as AccountKind, opening: '', openingDate: today() });
const errors = ref<{ name?: string; opening?: string }>({});

const kindOptions = (Object.keys(KIND_LABELS) as AccountKind[]).map((k) => ({ label: KIND_LABELS[k], value: k }));
const openingLabel = computed(() =>
  form.value.kind === 'credit_card' ? 'Amount owed on that date' : 'Balance on that date',
);

function openEditor(a?: Account) {
  errors.value = {};
  form.value = a
    ? {
        id: a.id,
        name: a.name,
        kind: a.kind,
        // Credit cards are stored negative (money owed) but entered positive.
        opening: toInput(a.kind === 'credit_card' ? -a.openingBalance : a.openingBalance, currency.value),
        openingDate: a.openingDate,
      }
    : { id: undefined, name: '', kind: 'bank', opening: '', openingDate: today() };
  editing.value = true;
}

async function save() {
  const f = form.value;
  const opening = f.opening.trim() === '' ? 0 : parseMoney(f.opening, currency.value);
  errors.value = {
    name: f.name.trim() ? undefined : 'Give the account a name.',
    opening: opening === null ? 'Enter an amount, like 1250.00' : undefined,
  };
  if (errors.value.name || errors.value.opening) return;
  saving.value = true;
  try {
    await api.saveAccount({
      id: f.id,
      name: f.name,
      kind: f.kind,
      openingBalance: f.kind === 'credit_card' ? -opening! : opening!,
      openingDate: f.openingDate,
    });
    editing.value = false;
    toast({ title: f.id ? 'Account updated' : 'Account added', tone: 'success' });
    await load();
  } catch (e) {
    toast({ title: "Couldn't save account", content: errorMessage(e), tone: 'error' });
  } finally {
    saving.value = false;
  }
}

async function setArchived(a: Account, archived: boolean) {
  await api.archiveAccount(a.id, archived);
  toast({ title: archived ? `Archived ${a.name}` : `Restored ${a.name}` });
  await load();
}

onMounted(load);
</script>

<template>
  <Page
    title="Money accounts"
    subtitle="Bank accounts, credit cards and cash: anywhere business money sits."
    :primary-action="{ label: 'Add account', icon: 'mdi:plus', onAction: () => openEditor() }"
  >
    <div v-if="hasArchived" class="Toolbar">
      <ToggleSwitch v-model="showArchived" label="Show archived" />
    </div>
    <DataTable
      :columns="columns"
      :rows="rows"
      :loading="loading"
      empty-text="No accounts yet. Add the bank account your business uses."
      @click-row="(row: Account) => router.push(`/accounts/${row.id}`)"
      :row-actions="(row: Account) => [
        { label: 'Transactions', icon: 'mdi:format-list-bulleted', onAction: () => router.push(`/accounts/${row.id}`) },
        { label: 'Reconcile', icon: 'mdi:checkbox-marked-circle-outline', onAction: () => router.push(`/accounts/${row.id}/reconcile`) },
        { label: 'Edit', icon: 'mdi:pencil-outline', onAction: () => openEditor(row) },
        row.archived
          ? { label: 'Restore', icon: 'mdi:archive-arrow-up-outline', onAction: () => setArchived(row, false) }
          : { label: 'Archive', icon: 'mdi:archive-outline', onAction: () => setArchived(row, true) },
      ]"
    >
      <template #col:openingDate="{ row }">{{ formatDay(row.openingDate) }}</template>
      <template #col:reconciledTo="{ row }">
        <span :class="{ subdued: !row.reconciledTo }">{{ row.reconciledTo ? formatDay(row.reconciledTo) : 'Never' }}</span>
      </template>
    </DataTable>

    <Modal
      :visible="editing"
      :title="form.id ? 'Edit account' : 'Add account'"
      :loading="saving"
      :primary-action="{ label: form.id ? 'Save' : 'Add account', onAction: save }"
      :secondary-actions="[{ label: 'Cancel', onAction: () => (editing = false) }]"
      @close="editing = false"
    >
      <ModalSection>
        <FormLayout>
          <TextField v-model="form.name" label="Name" placeholder="e.g. Business Checking" required :error="errors.name" />
          <Select v-model="form.kind" label="Type" :options="kindOptions" />
          <DatePicker
            v-model="form.openingDate"
            type="date"
            model-format="YYYY-MM-DD"
            label="Start tracking from"
            help-text="Usually the start of your financial year, or the day you open the account."
          />
          <TextField
            v-model="form.opening"
            :label="openingLabel"
            :prefix="currency"
            align="right"
            placeholder="0.00"
            :error="errors.opening"
            help-text="Check your statement for the balance on the date above."
          />
        </FormLayout>
      </ModalSection>
    </Modal>
  </Page>
</template>

<style scoped>
.Toolbar {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 12px;
}
</style>
