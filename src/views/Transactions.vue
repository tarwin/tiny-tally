<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { Page, SegmentedControl, Select, TextField } from '@octans/ui';
import EntryTable from '../components/EntryTable.vue';
import { api, type Account, type EntryKind } from '../lib/api';
import { newEntry } from '../lib/entryEditor';
import { useEntryFeed } from '../lib/entryFeed';
import { useBooksVersion } from '../lib/live';
import { allEntries, entryCsvRows, saveCsv } from '../lib/csv';
import { formatMoney } from '../lib/money';
import { PERIOD_OPTIONS, periodRange, type PeriodKey } from '../lib/periods';
import { session } from '../lib/session';

const dataVersion = useBooksVersion();

const route = useRoute();

const accounts = ref<Account[]>([]);

const period = ref<PeriodKey>((route.query.period as PeriodKey) || 'thisYear');
const kind = ref<EntryKind | 'all'>('all');
const accountId = ref<number | null>(null);
const search = ref(typeof route.query.q === 'string' ? route.query.q : '');

const currency = computed(() => session.books!.currency);

const kindOptions = [
  { label: 'All', value: 'all' },
  { label: 'Expenses', value: 'expense' },
  { label: 'Income', value: 'income' },
  { label: 'Transfers', value: 'transfer' },
];

const accountOptions = computed(() => [
  { label: 'All accounts', value: null },
  ...accounts.value.map((a) => ({ label: a.archived ? `${a.name} (archived)` : a.name, value: a.id })),
]);

/** What the filters ask for, before paging. */
function query() {
  return {
    ...periodRange(period.value, session.books!.fiscalYearStart),
    kind: kind.value === 'all' ? undefined : kind.value,
    q: search.value || undefined,
    // An account filter here is a plain filter, not register mode.
    ...(accountId.value ? { accountId: accountId.value } : {}),
  };
}

const { list, loading, loadingMore, hasMore, reload, loadMore } = useEntryFeed(query);
const load = () => reload();

let searchTimer: ReturnType<typeof setTimeout> | undefined;
watch(search, () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(load, 250);
});
watch([period, kind, accountId], load);
// The books changed: the same rows, refreshed, rather than back to the top.
watch(dataVersion, () => void reload(true));

// The top bar's search sends contacts and categories here, maybe while it's open.
watch(
  () => route.query,
  (q) => {
    if (typeof q.q === 'string') search.value = q.q;
    if (typeof q.period === 'string' && PERIOD_OPTIONS.some((o) => o.value === q.period)) period.value = q.period as PeriodKey;
  },
);

onMounted(async () => {
  accounts.value = await api.listAccounts();
  await load();
});

/** Every row the filters match, not just the ones loaded. */
async function exportCsv() {
  const q = query();
  await saveCsv(`Transactions${q.from ? ` ${q.from} to ${q.to}` : ''}`, entryCsvRows(await allEntries(q)));
}
</script>

<template>
  <Page
    title="Transactions"
    size="wide"
    :primary-action="{ label: 'New expense', icon: 'mdi:plus', onAction: () => newEntry('expense', accountId) }"
    :secondary-actions="[
      { label: 'New income', icon: 'mdi:arrow-down-bold-circle-outline', onAction: () => newEntry('income', accountId) },
      { label: 'New transfer', icon: 'mdi:swap-horizontal', onAction: () => newEntry('transfer', accountId) },
      { label: 'Export CSV', icon: 'mdi:file-delimited-outline', onAction: exportCsv },
    ]"
  >
    <div class="Filters">
      <Select v-model="period" :options="PERIOD_OPTIONS" label="Period" />
      <Select v-model="accountId" :options="accountOptions" label="Account" />
      <TextField v-model="search" label="Search" placeholder="Description, contact or category" />
    </div>
    <div class="Bar">
      <SegmentedControl v-model="kind" :options="kindOptions" />
      <div class="Totals">
        <span>In <strong class="money">{{ formatMoney(list.inflow, currency) }}</strong></span>
        <span>Out <strong class="money">{{ formatMoney(list.outflow, currency) }}</strong></span>
        <span>
          Net
          <strong class="money" :class="{ negative: list.inflow - list.outflow < 0 }">
            {{ formatMoney(list.inflow - list.outflow, currency) }}
          </strong>
        </span>
      </div>
    </div>
    <EntryTable
      :rows="list.rows"
      :loading="loading"
      fill
      :has-more="hasMore"
      :loading-more="loadingMore"
      empty-text="No transactions match. Try another period, or record one with New expense."
      @load-more="loadMore"
    />
  </Page>
</template>

<style scoped>
.Filters {
  display: grid;
  grid-template-columns: 200px 220px 1fr;
  gap: 12px;
  margin-bottom: 12px;
}

.Bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 12px;
}

.Totals {
  display: flex;
  gap: 20px;
  color: var(--octans-text-subdued);
}

.Totals strong {
  color: var(--octans-text);
  margin-left: 4px;
}

.Totals strong.negative {
  color: var(--octans-text-error);
}
</style>
