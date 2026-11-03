<script setup lang="ts">
// Sales by state (US): sales into each state this year and last, against
// the state's economic nexus threshold, so a remote seller knows when they
// have to register for another state's sales tax. Uses each customer's state.
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Banner, Button, Card, CardSection, DataTable, Page, Select, type DataTableColumnType } from '@octans/ui';
import { api, type NexusReport, type NexusState } from '../lib/api';
import { csvMoney, saveCsv } from '../lib/csv';
import { formatDay } from '../lib/dates';
import { onBooksChanged } from '../lib/live';
import { formatMoney } from '../lib/money';
import { printElement } from '../lib/print';
import { session } from '../lib/session';
import { NEXUS_CHECKED, US_STATE_MAP } from '../shared/usStates';

const router = useRouter();
const books = computed(() => session.books!);
const money = (v: number) => formatMoney(v, books.value.currency);
const dollars = (v: number) => formatMoney(v * 100, books.value.currency).replace(/\.00$/, '');

const now = new Date();
const year = ref(now.getFullYear());
const yearOptions = [0, 1, 2].map((i) => ({ label: String(now.getFullYear() - i), value: now.getFullYear() - i }));
const report = ref<NexusReport | null>(null);
const loading = ref(false);
const sheet = ref<HTMLElement | null>(null);

async function load() {
  loading.value = true;
  try {
    report.value = await api.nexusReport(year.value);
  } finally {
    loading.value = false;
  }
}
watch(year, load, { immediate: true });
onBooksChanged(load);

const columns: DataTableColumnType[] = [
  { key: 'name', label: 'State', minWidth: 160 },
  { key: 'thisYear', label: 'This year', width: 150 },
  { key: 'lastYear', label: 'Last year', width: 150 },
  { key: 'sales', label: 'Threshold', minWidth: 200 },
  { key: 'level', label: '', width: 200 },
];

const threshold = (s: NexusState) =>
  !s.sales ? 'No state sales tax'
    : `${dollars(s.sales)}${s.transactions ? ` ${s.both ? 'and' : 'or'} ${s.transactions} sales` : ''}`;

const LEVEL = {
  home: { text: 'Your state', tone: 'subdued' },
  none: { text: '', tone: 'subdued' },
  over: { text: 'Over: register for sales tax', tone: 'negative' },
  near: { text: 'Getting close', tone: 'warning' },
  under: { text: '', tone: 'subdued' },
} as const;

const over = computed(() => report.value?.states.filter((s) => s.level === 'over') ?? []);

function exportCsv() {
  const r = report.value;
  if (!r) return;
  void saveCsv(`Sales by state ${r.year}`, [
    ['State', `Sales ${r.year}`, `Transactions ${r.year}`, `Sales ${r.year - 1}`, `Transactions ${r.year - 1}`, 'Threshold (sales)', 'Threshold (transactions)', 'Measured over', 'Status'],
    ...r.states.map((s) => [
      s.name,
      csvMoney(s.thisYear.sales),
      s.thisYear.transactions,
      csvMoney(s.lastYear.sales),
      s.lastYear.transactions,
      s.sales ? String(s.sales) : '',
      s.transactions ?? '',
      s.measured,
      LEVEL[s.level].text,
    ]),
    ...(r.unknown.sales ? [['No state on the customer', csvMoney(r.unknown.sales), r.unknown.transactions, '', '', '', '', '', '']] : []),
  ]);
}
</script>

<template>
  <Page
    title="Sales by state"
    :breadcrumbs="[{ label: 'Reports', onAction: () => router.push('/reports') }, { label: 'Sales tax', onAction: () => router.push('/reports/sales-tax') }]"
    size="fullWidth"
    :primary-action="{ label: 'Export CSV', icon: 'mdi:file-delimited-outline', onAction: exportCsv }"
    :secondary-actions="[{ label: 'Print / Save PDF', icon: 'mdi:printer-outline', onAction: () => printElement(sheet) }]"
  >
    <div class="Controls">
      <Select v-model="year" label="Year" :options="yearOptions" />
    </div>

    <Banner v-if="report && !report.home" status="info" title="Which state are you in?" class="Gap">
      <p>Set your state in Settings, so it isn't counted as selling into it from outside.</p>
      <Button @click="router.push('/settings')">Settings</Button>
    </Banner>
    <Banner v-if="report?.customersWithoutState" status="warning" :title="`${report.customersWithoutState} ${report.customersWithoutState === 1 ? 'customer has' : 'customers have'} no state`" class="Gap">
      <p>
        Sales to them can't be counted towards a state{{ report.unknown.sales ? ` (${money(report.unknown.sales)} this year)` : '' }}.
        Add the state they're delivered to on each contact.
      </p>
      <Button @click="router.push('/contacts')">Contacts</Button>
    </Banner>
    <Banner v-if="over.length" status="critical" title="You may need to register in another state" class="Gap">
      <p>
        Sales into {{ over.map((s) => s.name).join(', ') }} are over the state's threshold. Once over, you usually have
        to register and collect that state's sales tax from the next sale (some states give until the next month or
        quarter). Check with the state or your accountant.
      </p>
    </Banner>

    <Card>
      <CardSection>
        <div ref="sheet" :class="{ Loading: loading }">
          <div class="ReportHead">
            <h2>{{ books.name }}: Sales by state, {{ year }}</h2>
            <p>Against each state's economic nexus threshold for remote sellers</p>
          </div>
          <DataTable :columns="columns" :rows="report?.states ?? []" :loading="loading" empty-text="No sales to customers with a state yet.">
            <template #col:name="{ row }">{{ row.name }}</template>
            <template #col:thisYear="{ row }">
              <div class="money">{{ money(row.thisYear.sales) }}</div>
              <div class="subdued Small">{{ row.thisYear.transactions }} sales</div>
            </template>
            <template #col:lastYear="{ row }">
              <div class="money">{{ money(row.lastYear.sales) }}</div>
              <div class="subdued Small">{{ row.lastYear.transactions }} sales</div>
            </template>
            <template #col:sales="{ row }">
              <div>{{ threshold(row) }}</div>
              <div class="subdued Small">{{ [row.measured, row.note].filter(Boolean).join(' · ') }}</div>
            </template>
            <template #col:level="{ row }">
              <span :class="LEVEL[row.level as NexusState['level']].tone">{{ LEVEL[row.level as NexusState['level']].text }}</span>
              <div v-if="row.sales && row.level !== 'home'" class="subdued Small">{{ Math.round(row.share * 100) }}% of the threshold</div>
            </template>
          </DataTable>
          <p class="subdued Note">
            Sales before sales tax, when invoiced, to customers in each state. Most states count all sales into the state,
            including exempt and resale sales; a few count only taxable or retail sales, and sales through a marketplace
            (Amazon, Etsy) are usually handled by the marketplace. Thresholds change: they were checked
            {{ formatDay(NEXUS_CHECKED) }}. Check the state's own rules before deciding.
          </p>
          <p v-if="report?.home" class="subdued Note">Your state: {{ US_STATE_MAP[report.home]?.name ?? report.home }}.</p>
        </div>
      </CardSection>
    </Card>
  </Page>
</template>

<style scoped>
.Controls {
  display: flex;
  align-items: flex-end;
  gap: 16px;
  margin-bottom: 16px;
}

.Controls > :first-child {
  min-width: 160px;
}

.Gap {
  margin-bottom: 16px;
}

.Gap p {
  margin: 0 0 8px;
}

.Loading {
  opacity: 0.6;
  transition: opacity 0.15s;
}

.Small {
  font-size: 12px;
}

.negative {
  color: var(--octans-text-error);
  font-weight: 600;
}

.warning {
  color: var(--octans-text-warning, #b45309);
}

.Note {
  margin: 16px 0 0;
  font-size: 12px;
}
</style>
