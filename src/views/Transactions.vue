<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { Page, SegmentedControl, Select, TextField } from '@octans/ui';
import EntryTable from '../components/EntryTable.vue';
import { api, type Account, type EntryKind, type EntryList } from '../lib/api';
import { dataVersion, newEntry } from '../lib/entryEditor';
import { formatMoney } from '../lib/money';
import { PERIOD_OPTIONS, periodRange, type PeriodKey } from '../lib/periods';
import { session } from '../lib/session';

const route = useRoute();
const PAGE_SIZES = [50, 100, 250];

const list = ref<EntryList>({ rows: [], total: 0, inflow: 0, outflow: 0 });
const accounts = ref<Account[]>([]);
const loading = ref(true);

const period = ref<PeriodKey>((route.query.period as PeriodKey) || 'thisYear');
const kind = ref<EntryKind | 'all'>('all');
const accountId = ref<number | null>(null);
const search = ref('');
const offset = ref(0);
const limit = ref(50);

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

let seq = 0;
async function load() {
  const mine = ++seq;
  loading.value = true;
  try {
    const range = periodRange(period.value, session.books!.fiscalYearStart);
    const result = await api.listEntries({
      ...range,
      kind: kind.value === 'all' ? undefined : kind.value,
      q: search.value || undefined,
      limit: limit.value,
      offset: offset.value,
      // An account filter here is a plain filter, not register mode.
      ...(accountId.value ? { accountId: accountId.value } : {}),
    });
    if (mine === seq) list.value = result;
  } finally {
    if (mine === seq) loading.value = false;
  }
}

let searchTimer: ReturnType<typeof setTimeout> | undefined;
watch(search, () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    offset.value = 0;
    void load();
  }, 250);
});
watch([period, kind, accountId, limit], () => {
  offset.value = 0;
  void load();
});
watch([offset, dataVersion], () => void load());

onMounted(async () => {
  accounts.value = await api.listAccounts();
  await load();
});

const pagination = computed(() => ({
  offset: offset.value,
  updateOffset: (v: number) => (offset.value = v),
  limit: limit.value,
  updateLimit: (v: number) => (limit.value = v),
  pageSizes: PAGE_SIZES,
  total: list.value.total,
}));
</script>

<template>
  <Page
    title="Transactions"
    size="wide"
    :primary-action="{ label: 'New expense', icon: 'mdi:plus', onAction: () => newEntry('expense', accountId) }"
    :secondary-actions="[
      { label: 'New income', icon: 'mdi:arrow-down-bold-circle-outline', onAction: () => newEntry('income', accountId) },
      { label: 'New transfer', icon: 'mdi:swap-horizontal', onAction: () => newEntry('transfer', accountId) },
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
      :pagination="pagination"
      empty-text="No transactions match. Try another period, or record one with New expense."
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
