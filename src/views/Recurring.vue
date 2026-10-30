<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { Badge, DataTable, Page, confirmModal, toast, type DataTableColumnType } from '@octans/ui';
import ScheduleModal from '../components/ScheduleModal.vue';
import { api, errorMessage, type Schedule } from '../lib/api';
import { formatDay, today } from '../lib/dates';
import { dataChanged, dataVersion } from '../lib/entryEditor';
import { formatMoney } from '../lib/money';
import { FREQUENCY_LABEL } from '../lib/schedule';
import { session } from '../lib/session';

const schedules = ref<Schedule[]>([]);
const loading = ref(true);
const editing = ref<Schedule | null>(null);
const currency = computed(() => session.company!.currency);

const KIND_LABEL = { entry: 'Transaction', invoice: 'Invoice', bill: 'Bill' } as const;

const columns: DataTableColumnType[] = [
  { key: 'name', label: 'Name', minWidth: 160 },
  { key: 'kind', label: 'Creates', width: 130 },
  { key: 'frequency', label: 'Repeats', width: 125 },
  { key: 'nextDate', label: 'Next', width: 120 },
  { key: 'amount', label: 'Amount', width: 120 },
  { key: 'state', label: '', width: 95 },
];

async function load() {
  loading.value = true;
  try {
    schedules.value = await api.listSchedules();
  } finally {
    loading.value = false;
  }
}
watch(dataVersion, load);
onMounted(load);

/** Entries store an amount; invoices and bills a list of lines (shown before GST when prices exclude it). */
function amount(s: Schedule) {
  if (s.kind === 'entry') return formatMoney(s.payload.amount ?? 0, currency.value);
  const total = (s.payload.lines ?? []).reduce((t: number, l: any) => t + Math.round((l.qtyMilli * l.unitPrice) / 1000), 0);
  return formatMoney(total, currency.value) + (s.payload.pricesIncludeTax === false && session.company!.taxEnabled ? ' + GST' : '');
}

function kindText(s: Schedule) {
  if (s.kind === 'entry') return s.payload.kind === 'income' ? 'Income' : s.payload.kind === 'transfer' ? 'Transfer' : 'Expense';
  return `${KIND_LABEL[s.kind]}${s.autoApprove ? '' : ' (draft)'}`;
}

async function act(fn: () => Promise<unknown>, done: string) {
  try {
    await fn();
    toast({ title: done, tone: 'success' });
    dataChanged();
    await load();
  } catch (e) {
    toast({ title: errorMessage(e), tone: 'error' });
  }
}

async function remove(s: Schedule) {
  const ok = await confirmModal({
    title: `Delete “${s.name}”?`,
    content: "Nothing more will be created. What it already created stays.",
    primaryActionLabel: 'Delete',
    primaryActionType: 'destructive',
    secondaryActionLabel: 'Cancel',
  });
  if (ok) await act(() => api.deleteSchedule(s.id), 'Schedule deleted');
}

async function runNow() {
  try {
    const r = await api.runSchedules(today());
    dataChanged();
    toast({
      title: r.created.length ? `Created ${r.created.length}` : 'Nothing due yet',
      content: r.failed.length ? `${r.failed.length} couldn't be created: ${r.failed[0].message}` : undefined,
      tone: r.failed.length ? 'warning' : 'success',
    });
    await load();
  } catch (e) {
    toast({ title: errorMessage(e), tone: 'error' });
  }
}

function skip(s: Schedule) {
  return act(() => api.skipSchedule(s.id), 'Skipped one');
}

function toggle(s: Schedule) {
  return act(
    () => api.saveSchedule({ ...s, endDate: s.endDate, active: !s.active, startDate: s.startDate }),
    s.active ? 'Paused' : 'Resumed',
  );
}
</script>

<template>
  <Page
    title="Recurring"
    subtitle="Rent, subscriptions, retainers: anything that repeats. Due ones are created when you open the company."
    :primary-action="{ label: 'Create due now', icon: 'mdi:play-circle-outline', onAction: runNow }"
  >
    <DataTable
      :columns="columns"
      :rows="schedules"
      :loading="loading"
      empty-text="Nothing repeats yet. Open a transaction, invoice or bill and choose Make recurring."
      @click-row="(row: Schedule) => (editing = row)"
      :row-actions="(row: Schedule) => [
        { label: 'Edit', icon: 'mdi:pencil-outline', onAction: () => (editing = row) },
        { label: 'Skip next', icon: 'mdi:skip-next-outline', onAction: () => skip(row) },
        { label: row.active ? 'Pause' : 'Resume', icon: row.active ? 'mdi:pause' : 'mdi:play', onAction: () => toggle(row) },
        { label: 'Delete', icon: 'mdi:delete-outline', onAction: () => remove(row) },
      ]"
    >
      <template #col:kind="{ row }">{{ kindText(row) }}</template>
      <template #col:frequency="{ row }">{{ FREQUENCY_LABEL[row.frequency as keyof typeof FREQUENCY_LABEL] }}</template>
      <template #col:nextDate="{ row }">
        <span :class="{ subdued: row.finished || !row.active }">{{ row.finished ? '—' : formatDay(row.nextDate) }}</span>
      </template>
      <template #col:amount="{ row }"><span class="money">{{ amount(row) }}</span></template>
      <template #col:state="{ row }">
        <Badge v-if="row.finished">Finished</Badge>
        <Badge v-else-if="!row.active" status="warning">Paused</Badge>
      </template>
    </DataTable>

    <ScheduleModal
      :visible="!!editing"
      :kind="editing?.kind ?? 'entry'"
      :payload="editing?.payload"
      :name="editing?.name ?? ''"
      :from="editing?.nextDate ?? today()"
      :schedule="editing"
      @close="editing = null"
      @saved="editing = null; load()"
    />
  </Page>
</template>
