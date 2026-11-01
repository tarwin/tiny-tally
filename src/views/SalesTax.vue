<script setup lang="ts">
// US sales tax collected for a filing period: the three numbers most state
// returns ask for, and the sales behind them. Nothing is lodged from here.
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Banner, Card, CardSection, DataTable, Page, SegmentedControl, Select, type DataTableColumnType } from '@octans/ui';
import { api, type Basis, type SalesTaxReport } from '../lib/api';
import { csvMoney, saveCsv } from '../lib/csv';
import { formatDay } from '../lib/dates';
import { formatMoney, ratePercent } from '../lib/money';
import { taxPeriods } from '../lib/periods';
import { printElement } from '../lib/print';
import { session } from '../lib/session';
import { TAX_CODE_MAP } from '../shared/tax';

type Row = SalesTaxReport['detail'][number];

const router = useRouter();
const books = computed(() => session.books!);
const money = (v: number) => formatMoney(v, books.value.currency);

const periods = computed(() => taxPeriods(books.value.basFrequency, books.value.fiscalYearStart, 12));
const periodKey = ref('');
const period = computed(() => periods.value.find((p) => p.from === periodKey.value) ?? periods.value[0]);
const periodOptions = computed(() =>
  periods.value.map((p) => ({ label: p.label, value: p.from, description: p.current ? 'In progress' : undefined })),
);
const basis = ref<Basis>(books.value.taxBasis);
const report = ref<SalesTaxReport | null>(null);
const loading = ref(false);
const sheet = ref<HTMLElement | null>(null);

async function load() {
  loading.value = true;
  try {
    report.value = await api.salesTaxReport({ from: period.value.from, to: period.value.to, basis: basis.value });
  } finally {
    loading.value = false;
  }
}

watch([periodKey, basis], load);
onMounted(() => {
  periodKey.value = (periods.value.find((p) => !p.current) ?? periods.value[0]).from;
});

const figures = computed(() => {
  const t = report.value?.totals;
  if (!t) return [];
  return [
    { label: 'Total sales', value: t.totalSales, help: 'Everything you sold, before sales tax.' },
    { label: 'Taxable sales', value: t.taxableSales, help: `Sales you charged ${ratePercent(books.value.taxRatePpm)}% on.` },
    { label: 'Non-taxable sales', value: t.nonTaxableSales, help: 'Exempt, resale or out-of-state sales.' },
    { label: 'Sales tax collected', value: t.taxCollected, help: 'What you owe the state for this period.', strong: true },
  ];
});

const columns: DataTableColumnType[] = [
  { key: 'date', label: 'Date', width: 110 },
  { key: 'memo', label: 'Description', minWidth: 200 },
  { key: 'taxCode', label: 'Tax code', width: 130, formatFunc: (v) => (v ? TAX_CODE_MAP[v as keyof typeof TAX_CODE_MAP]?.label ?? v : 'None') },
  { key: 'net', label: 'Sale', width: 120 },
  { key: 'tax', label: 'Sales tax', width: 110 },
];

function openRow(r: Row) {
  if (r.invoiceId) void router.push(`/invoices/${r.invoiceId}`);
}

function exportCsv() {
  if (!report.value) return;
  void saveCsv(`Sales tax ${period.value.from} to ${period.value.to}`, [
    ['Date', 'Description', 'Customer', 'Category', 'Tax code', 'Sale', 'Sales tax'],
    ...report.value.detail.map((r) => [
      r.date,
      r.memo ?? '',
      r.contactName ?? '',
      r.categoryName ?? '',
      r.taxCode ?? '',
      csvMoney(r.gross - r.tax),
      csvMoney(r.tax),
    ]),
  ]);
}
</script>

<template>
  <Page
    title="Sales tax"
    :breadcrumbs="[{ label: 'Reports', onAction: () => router.push('/reports') }]"
    size="wide"
    :primary-action="{ label: 'Export CSV', icon: 'mdi:file-delimited-outline', onAction: exportCsv }"
    :secondary-actions="[{ label: 'Print / Save PDF', icon: 'mdi:printer-outline', onAction: () => printElement(sheet) }]"
  >
    <div class="Controls">
      <Select v-model="periodKey" label="Period" :options="periodOptions" show-description />
      <div>
        <div class="Label">Basis</div>
        <SegmentedControl v-model="basis" :options="[{ label: 'Cash', value: 'cash' }, { label: 'Accrual', value: 'accrual' }]" />
      </div>
    </div>

    <Banner v-if="report?.untagged" status="warning" class="Untagged">
      {{ report.untagged }} {{ report.untagged === 1 ? 'sale has' : 'sales have' }} no tax code, from before sales tax was turned
      on. They're counted as non-taxable.
    </Banner>

    <Card>
      <CardSection>
        <div ref="sheet" :class="{ Loading: loading }">
          <div class="ReportHead">
            <h2>{{ books.name }}: Sales tax collected</h2>
            <p>{{ formatDay(period.from) }} – {{ formatDay(period.to) }} · {{ basis === 'cash' ? 'Cash' : 'Accrual' }} basis</p>
          </div>
          <dl class="Figures">
            <div v-for="f in figures" :key="f.label" :class="{ Strong: f.strong }">
              <dt>
                <div>{{ f.label }}</div>
                <div class="subdued Small">{{ f.help }}</div>
              </dt>
              <dd class="money">{{ money(f.value) }}</dd>
            </div>
          </dl>
          <p class="subdued Note">
            Copy these into your state's sales tax return. If you sell into more than one state, or your rate changed during
            the period, check the sales below with the state's rules.
          </p>
        </div>
      </CardSection>
    </Card>

    <Card title="Sales in this period" class="Detail">
      <DataTable :columns="columns" :rows="report?.detail ?? []" :loading="loading" empty-text="No sales in this period." @click-row="openRow">
        <template #col:date="{ row }">{{ formatDay(row.date) }}</template>
        <template #col:memo="{ row }">
          <div>{{ row.memo || row.contactName || '—' }}</div>
          <div class="subdued Small">{{ [row.contactName, row.categoryName].filter(Boolean).join(' · ') }}</div>
        </template>
        <template #col:net="{ row }"><span class="money">{{ money(row.gross - row.tax) }}</span></template>
        <template #col:tax="{ row }"><span class="money">{{ row.tax ? money(row.tax) : '' }}</span></template>
      </DataTable>
    </Card>
  </Page>
</template>

<style scoped>
.Controls {
  display: flex;
  align-items: flex-end;
  flex-wrap: wrap;
  gap: 16px;
  margin-bottom: 16px;
}

.Controls > :first-child {
  min-width: 240px;
}

.Label {
  font-size: 13px;
  margin-bottom: 6px;
}

.Untagged {
  margin-bottom: 16px;
}

.Loading {
  opacity: 0.6;
  transition: opacity 0.15s;
}

.Figures {
  margin: 0;
  max-width: 560px;
}

.Figures > div {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 16px;
  padding: 10px 0;
  border-bottom: 1px solid var(--octans-border);
}

.Figures dd {
  margin: 0;
  font-size: 15px;
}

.Strong dt > :first-child,
.Strong dd {
  font-weight: 600;
}

.Small {
  font-size: 12px;
}

.Note {
  margin: 16px 0 0;
  font-size: 12px;
}

.Detail {
  margin-top: 16px;
}
</style>
