<script setup lang="ts">
// Cash flow: how the money in every account changed over a period, and why.
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Card, CardSection, DatePicker, Page, Select } from '@octans/ui';
import { api, type CashFlow } from '../lib/api';
import { csvMoney, saveCsv } from '../lib/csv';
import { formatDay } from '../lib/dates';
import { formatMoney } from '../lib/money';
import { PERIOD_OPTIONS, periodRange, type PeriodKey } from '../lib/periods';
import { printElement } from '../lib/print';
import { session } from '../lib/session';

const router = useRouter();
const books = computed(() => session.books!);
const money = (v: number) => formatMoney(v, books.value.currency);

const period = ref<PeriodKey | 'custom'>('thisYear');
const custom = ref(periodRange('thisYear', books.value.fiscalYearStart) as { from: string; to: string });
const report = ref<CashFlow | null>(null);
const loading = ref(false);
const sheet = ref<HTMLElement | null>(null);

const periodOptions = [...PERIOD_OPTIONS.filter((o) => o.value !== 'all'), { label: 'Custom dates', value: 'custom' as const }];
const range = computed(() =>
  period.value === 'custom' ? custom.value : (periodRange(period.value, books.value.fiscalYearStart) as { from: string; to: string }),
);

async function load() {
  loading.value = true;
  try {
    report.value = await api.cashFlow(range.value);
  } finally {
    loading.value = false;
  }
}
watch(range, load, { deep: true });
onMounted(load);

const sections = computed(() =>
  report.value
    ? [
        { key: 'operating', title: 'Day-to-day trading', totalLabel: 'Net cash from trading', empty: 'No trading in this period.', ...report.value.operating },
        { key: 'investing', title: 'Assets bought and sold', totalLabel: 'Net cash on assets', empty: 'No assets bought or sold.', ...report.value.investing },
        { key: 'financing', title: 'Owner and loans', totalLabel: 'Net cash from owner and loans', empty: 'No owner or loan money.', ...report.value.financing },
      ]
    : [],
);

function exportCsv() {
  const r = report.value;
  if (!r) return;
  void saveCsv(`Cash flow ${range.value.from} to ${range.value.to}`, [
    ['Section', 'Line', 'Amount'],
    ...sections.value.flatMap((s) => [...s.lines.map((l) => [s.title, l.label, csvMoney(l.amount)]), [s.title, s.totalLabel, csvMoney(s.total)]]),
    ['', 'Net change in cash', csvMoney(r.net)],
    ['', 'Cash at start', csvMoney(r.opening)],
    ...(r.started ? [['', 'Accounts first tracked in this period', csvMoney(r.started)]] : []),
    ['', 'Cash at end', csvMoney(r.closing)],
  ]);
}
</script>

<template>
  <Page
    title="Cash flow"
    :breadcrumbs="[{ label: 'Reports', onAction: () => router.push('/reports') }]"
    size="wide"
    :primary-action="{ label: 'Export CSV', icon: 'mdi:file-delimited-outline', onAction: exportCsv }"
    :secondary-actions="[{ label: 'Print / Save PDF', icon: 'mdi:printer-outline', onAction: () => printElement(sheet) }]"
  >
    <div class="Controls">
      <Select v-model="period" label="Period" :options="periodOptions" />
      <template v-if="period === 'custom'">
        <DatePicker v-model="custom.from" type="date" model-format="YYYY-MM-DD" label="From" />
        <DatePicker v-model="custom.to" type="date" model-format="YYYY-MM-DD" label="To" />
      </template>
    </div>

    <Card>
      <CardSection>
        <div ref="sheet" :class="{ Loading: loading }">
          <div class="ReportHead">
            <h2>{{ books.name }}: Cash flow</h2>
            <p>{{ formatDay(range.from) }} – {{ formatDay(range.to) }}</p>
          </div>
          <table v-if="report" class="Report">
            <tbody>
              <template v-for="s in sections" :key="s.key">
                <tr class="Report__section"><td colspan="2">{{ s.title }}</td></tr>
                <tr v-if="!s.lines.length"><td class="Report__indent subdued" colspan="2">{{ s.empty }}</td></tr>
                <tr v-for="l in s.lines" :key="l.label">
                  <td class="Report__indent">{{ l.label }}</td>
                  <td class="num" :class="{ negative: l.amount < 0 }">{{ money(l.amount) }}</td>
                </tr>
                <tr class="Report__total">
                  <td>{{ s.totalLabel }}</td>
                  <td class="num" :class="{ negative: s.total < 0 }">{{ money(s.total) }}</td>
                </tr>
              </template>
              <tr class="Report__grand">
                <td>Net change in cash</td>
                <td class="num" :class="{ negative: report.net < 0 }">{{ money(report.net) }}</td>
              </tr>
              <tr>
                <td>Cash at {{ formatDay(range.from) }}</td>
                <td class="num">{{ money(report.opening) }}</td>
              </tr>
              <tr v-if="report.started">
                <td>Accounts first tracked in this period</td>
                <td class="num">{{ money(report.started) }}</td>
              </tr>
              <tr class="Report__total">
                <td>Cash at {{ formatDay(range.to) }}</td>
                <td class="num" :class="{ negative: report.closing < 0 }">{{ money(report.closing) }}</td>
              </tr>
            </tbody>
          </table>
          <p class="subdued Note">
            Cash is every money account together, with credit cards counted as money owed. Moving money between your own
            accounts isn't a cash flow, and journal entries (depreciation, accruals) move no cash. Amounts include any tax.
          </p>
        </div>
      </CardSection>
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
  min-width: 200px;
}

.Loading {
  opacity: 0.6;
  transition: opacity 0.15s;
}

.Note {
  margin: 16px 0 0;
  font-size: 12px;
}
</style>
