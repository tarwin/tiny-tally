<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Badge, Page, Select, TextField } from '@octans/ui';
import EntryTable from '../components/EntryTable.vue';
import { api, type Account, type EntryList } from '../lib/api';
import { formatDay } from '../lib/dates';
import { dataVersion, newEntry } from '../lib/entryEditor';
import { formatMoney } from '../lib/money';
import { PERIOD_OPTIONS, periodRange, type PeriodKey } from '../lib/periods';
import { session } from '../lib/session';

const route = useRoute();
const router = useRouter();
const PAGE_SIZES = [50, 100, 250];

const account = ref<Account | null>(null);
const list = ref<EntryList>({ rows: [], total: 0, inflow: 0, outflow: 0 });
const loading = ref(true);
const period = ref<PeriodKey>('all');
const search = ref('');
const offset = ref(0);
const limit = ref(50);

const id = computed(() => Number(route.params.id));
const currency = computed(() => session.books!.currency);
const isCard = computed(() => account.value?.kind === 'credit_card');

const balanceText = computed(() => {
  const a = account.value;
  if (!a) return '';
  if (isCard.value && a.balance <= 0) return `${formatMoney(-a.balance, currency.value)} owed`;
  return formatMoney(a.balance, currency.value);
});

let seq = 0;
async function load() {
  const mine = ++seq;
  loading.value = true;
  try {
    const [accounts, result] = await Promise.all([
      api.listAccounts(),
      api.listEntries({
        accountId: id.value,
        ...periodRange(period.value, session.books!.fiscalYearStart),
        q: search.value || undefined,
        limit: limit.value,
        offset: offset.value,
      }),
    ]);
    if (mine !== seq) return;
    account.value = accounts.find((a) => a.id === id.value) ?? null;
    if (!account.value) {
      await router.replace('/accounts');
      return;
    }
    list.value = result;
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
watch([period, limit, id], () => {
  offset.value = 0;
  void load();
});
watch([offset, dataVersion], () => void load());
onMounted(load);

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
    :title="account?.name ?? 'Account'"
    :subtitle="account ? `Balance ${balanceText} · tracking since ${formatDay(account.openingDate)}` : ''"
    :breadcrumbs="[{ label: 'Money accounts', onAction: () => router.push('/accounts') }]"
    size="wide"
    :primary-action="{ label: isCard ? 'New card expense' : 'New expense', icon: 'mdi:plus', onAction: () => newEntry('expense', id) }"
    :secondary-actions="[
      { label: 'New income', icon: 'mdi:arrow-down-bold-circle-outline', onAction: () => newEntry('income', id) },
      { label: isCard ? 'Pay off card' : 'New transfer', icon: 'mdi:swap-horizontal', onAction: () => (isCard ? newEntry('transfer', null, id) : newEntry('transfer', id)) },
      { label: 'Reconcile', icon: 'mdi:checkbox-marked-circle-outline', onAction: () => router.push(`/accounts/${id}/reconcile`) },
    ]"
  >
    <div v-if="account?.archived" class="Archived"><Badge status="warning">Archived</Badge></div>
    <div class="Filters">
      <Select v-model="period" :options="PERIOD_OPTIONS" label="Period" />
      <TextField v-model="search" label="Search" placeholder="Description, contact or category" />
    </div>
    <EntryTable
      :rows="list.rows"
      :loading="loading"
      :account-id="id"
      :pagination="pagination"
      empty-text="Nothing recorded in this account for this period."
    />
    <p class="subdued Opening">
      Opening balance {{ formatMoney(account?.openingBalance ?? 0, currency) }} on
      {{ account ? formatDay(account.openingDate) : '' }}.
      <template v-if="account?.reconciledTo">Reconciled to {{ formatDay(account.reconciledTo) }}.</template>
    </p>
  </Page>
</template>

<style scoped>
.Archived {
  margin-bottom: 12px;
}

.Filters {
  display: grid;
  grid-template-columns: 220px 1fr;
  gap: 12px;
  margin-bottom: 12px;
}

.Opening {
  margin-top: 12px;
  font-size: 13px;
}
</style>
