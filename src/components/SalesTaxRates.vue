<script setup lang="ts">
// Settings → Sales tax rates (US): rates beyond the books' own, for selling
// into other cities, counties or states. A customer can have a usual rate,
// and each invoice or sale says which one it's at; the Sales tax report
// totals each separately. Saves on its own.
import { onMounted, ref } from 'vue';
import {
  Card,
  CardSection,
  DataTable,
  FormLayout,
  Modal,
  ModalSection,
  Select,
  TextField,
  toast,
  type DataTableColumnType,
} from '@octans/ui';
import { api, errorMessage, type TaxRate } from '../lib/api';
import { parseRate, ratePercent } from '../lib/money';
import { onBooksChanged } from '../lib/live';
import { US_STATE_MAP, US_STATE_OPTIONS } from '../shared/usStates';

const rates = ref<TaxRate[]>([]);
const loading = ref(true);

const columns: DataTableColumnType[] = [
  { key: 'name', label: 'Name', minWidth: 200, formatFunc: (v, row) => (row.archived ? `${v} (archived)` : v) },
  { key: 'state', label: 'State', width: 160, formatFunc: (v) => (v ? US_STATE_MAP[v]?.name ?? v : '') },
  { key: 'ratePpm', label: 'Rate', width: 100, formatFunc: (v) => `${ratePercent(v)}%` },
  { key: 'uses', label: 'Used', width: 90, formatFunc: (v) => (v ? String(v) : '') },
];

async function load() {
  loading.value = true;
  try {
    rates.value = await api.listTaxRates();
  } finally {
    loading.value = false;
  }
}
onMounted(load);
onBooksChanged(load);

const editing = ref(false);
const saving = ref(false);
const form = ref({ id: undefined as number | undefined, name: '', state: null as string | null, rate: '' });
const errors = ref<{ name?: string; rate?: string }>({});

function openEditor(r?: TaxRate) {
  errors.value = {};
  form.value = r
    ? { id: r.id, name: r.name, state: r.state, rate: ratePercent(r.ratePpm) }
    : { id: undefined, name: '', state: null, rate: '' };
  editing.value = true;
}

async function save() {
  const ppm = parseRate(form.value.rate);
  errors.value = {
    ...(form.value.name.trim() ? {} : { name: 'Name it, like the city or county it applies in.' }),
    ...(ppm === null ? { rate: 'Enter a rate between 0% and 50%, like 8.875.' } : {}),
  };
  if (ppm === null || errors.value.name) return;
  saving.value = true;
  try {
    await api.saveTaxRate({ id: form.value.id, name: form.value.name, state: form.value.state, ratePpm: ppm });
    editing.value = false;
    await load();
  } catch (e) {
    toast({ title: "Couldn't save the rate", content: errorMessage(e), tone: 'error' });
  } finally {
    saving.value = false;
  }
}

async function setArchived(r: TaxRate, archived: boolean) {
  await api.archiveTaxRate(r.id, archived);
  await load();
}

function rowActions(r: TaxRate) {
  return [
    { label: 'Edit', icon: 'mdi:pencil-outline', onAction: () => openEditor(r) },
    r.archived
      ? { label: 'Restore', icon: 'mdi:archive-arrow-up-outline', onAction: () => setArchived(r, false) }
      : { label: 'Archive', icon: 'mdi:archive-outline', onAction: () => setArchived(r, true) },
  ];
}
</script>

<template>
  <Card title="Other sales tax rates" :actions="[{ label: 'Add rate', icon: 'mdi:plus', onAction: () => openEditor() }]">
    <CardSection>
      <p class="subdued Hint">
        For sales charged at a different rate: delivered to another city or county, or into another state you're
        registered in. Give a customer their usual rate on the contact; each invoice or sale can be changed. The Sales
        tax report totals each rate on its own. Changing a rate doesn't change documents already worked out at it.
      </p>
    </CardSection>
    <DataTable
      :columns="columns"
      :rows="rates"
      :loading="loading"
      empty-text="Only your own rate so far."
      :row-actions="rowActions"
      @click-row="(row: TaxRate) => openEditor(row)"
    />

    <Modal
      :visible="editing"
      :title="form.id ? 'Edit sales tax rate' : 'Add sales tax rate'"
      :loading="saving"
      :primary-action="{ label: form.id ? 'Save' : 'Add rate', onAction: save }"
      :secondary-actions="[{ label: 'Cancel', onAction: () => (editing = false) }]"
      @close="editing = false"
    >
      <ModalSection>
        <FormLayout>
          <TextField v-model="form.name" label="Name" placeholder="e.g. Jersey City, NJ" required :error="errors.name" />
          <Select v-model="form.state" label="State" :options="[{ label: 'None', value: null }, ...US_STATE_OPTIONS]" />
          <TextField
            v-model="form.rate"
            label="Rate"
            suffix="%"
            inputmode="decimal"
            :error="errors.rate"
            help-text="The combined state and local rate."
          />
        </FormLayout>
      </ModalSection>
    </Modal>
  </Card>
</template>

<style scoped>
.Hint {
  margin: 0;
}
</style>
