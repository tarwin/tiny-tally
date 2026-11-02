<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Badge, Page, Select, TextField } from '@octans/ui';
import EntryTable from '../components/EntryTable.vue';
import { api, type Account } from '../lib/api';
import { formatDay } from '../lib/dates';
import { newEntry } from '../lib/entryEditor';
import { useEntryFeed } from '../lib/entryFeed';
import { useBooksVersion } from '../lib/live';
import { allEntries, entryCsvRows, saveCsv } from '../lib/csv';
import { formatMoney } from '../lib/money';
import { PERIOD_OPTIONS, periodRange, type PeriodKey } from '../lib/periods';
import { session } from '../lib/session';
import { useTabTitle } from '../lib/tabs';

const dataVersion = useBooksVersion();

const route = useRoute();
const router = useRouter();

const account = ref<Account | null>(null);
useTabTitle(() => account.value?.name);
const period = ref<PeriodKey>('all');
const search = ref('');

const id = computed(() => Number(route.params.id));
const currency = computed(() => session.books!.currency);
const isCard = computed(() => account.value?.kind === 'credit_card');

const balanceText = computed(() => {
  const a = account.value;
  if (!a) return '';
  if (isCard.value && a.balance <= 0) return `${formatMoney(-a.balance, currency.value)} owed`;
  return formatMoney(a.balance, currency.value);
});

const { list, loading, loadingMore, hasMore, reload, loadMore } = useEntryFeed(() => ({
  accountId: id.value,
  ...periodRange(period.value, session.books!.fiscalYearStart),
  q: search.value || undefined,
}));

/** The account (for its name and balance) and its rows; `keep` as in useEntryFeed. */
async function load(keep = false) {
  const [accounts] = await Promise.all([api.listAccounts(), reload(keep)]);
  account.value = accounts.find((a) => a.id === id.value) ?? null;
  if (!account.value) await router.replace('/accounts');
}

let searchTimer: ReturnType<typeof setTimeout> | undefined;
watch(search, () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => void load(), 250);
});
watch([period, id], () => void load());
watch(dataVersion, () => void load(true));
onMounted(() => load());

async function exportCsv() {
  const range = periodRange(period.value, session.books!.fiscalYearStart);
  const rows = await allEntries({ accountId: id.value, ...range, q: search.value || undefined });
  await saveCsv(`${account.value?.name ?? 'Account'}${range.from ? ` ${range.from} to ${range.to}` : ''}`, entryCsvRows(rows, true));
}
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
      { label: 'Export CSV', icon: 'mdi:file-delimited-outline', onAction: exportCsv },
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
      fill
      :has-more="hasMore"
      :loading-more="loadingMore"
      empty-text="Nothing recorded in this account for this period."
      @load-more="loadMore"
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
