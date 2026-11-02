<script setup lang="ts">
// Profit & Loss in IRS Schedule C shape: each category's total under the
// line it maps to (set on the category), for a sole proprietor's return.
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Banner, Button, Card, CardSection, DatePicker, Page, SegmentedControl, Select } from '@octans/ui';
import { api, type Basis, type ScheduleCReport } from '../lib/api';
import { csvMoney, saveCsv } from '../lib/csv';
import { formatDay } from '../lib/dates';
import { onBooksChanged } from '../lib/live';
import { formatMoney } from '../lib/money';
import { periodRange } from '../lib/periods';
import { printElement } from '../lib/print';
import { session } from '../lib/session';

const router = useRouter();
const books = computed(() => session.books!);
const money = (v: number) => formatMoney(v, books.value.currency);

const period = ref<'thisYear' | 'lastYear' | 'custom'>('lastYear');
const custom = ref(periodRange('lastYear', books.value.fiscalYearStart) as { from: string; to: string });
const periodOptions = [
  { label: 'Last tax year', value: 'lastYear' as const },
  { label: 'This tax year', value: 'thisYear' as const },
  { label: 'Custom dates', value: 'custom' as const },
];
const range = computed(() =>
  period.value === 'custom' ? custom.value : (periodRange(period.value, books.value.fiscalYearStart) as { from: string; to: string }),
);
const basis = ref<Basis>(books.value.taxBasis);
const report = ref<ScheduleCReport | null>(null);
const loading = ref(false);
const sheet = ref<HTMLElement | null>(null);

async function load() {
  loading.value = true;
  try {
    report.value = await api.scheduleCReport({ ...range.value, basis: basis.value });
  } finally {
    loading.value = false;
  }
}

watch([range, basis], load, { deep: true });
onMounted(load);
onBooksChanged(load);

const income = computed(() => report.value?.lines.filter((l) => l.kind === 'income') ?? []);
const expenses = computed(() => report.value?.lines.filter((l) => l.kind === 'expense') ?? []);

function exportCsv() {
  const r = report.value;
  if (!r) return;
  void saveCsv(`Schedule C ${range.value.from} to ${range.value.to}`, [
    ['Line', 'Description', 'Category', 'Amount', 'Deductible'],
    ...r.lines.flatMap((l) => [
      ...l.categories.map((c) => [l.line, l.label, c.name, csvMoney(c.total), '']),
      [l.line, l.label, 'Total', csvMoney(l.total), csvMoney(l.deductible)],
    ]),
    ['7', 'Gross income', '', '', csvMoney(r.totals.grossIncome)],
    ['28', 'Total expenses', '', '', csvMoney(r.totals.totalExpenses)],
    ['31', 'Net profit or loss', '', '', csvMoney(r.totals.netProfit)],
    ...r.unmapped.map((u) => ['', 'Not mapped', u.name, csvMoney(u.total), '']),
  ]);
}
</script>

<template>
  <Page
    title="Schedule C"
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
      <div>
        <div class="Label">Basis</div>
        <SegmentedControl v-model="basis" :options="[{ label: 'Cash', value: 'cash' }, { label: 'Accrual', value: 'accrual' }]" />
      </div>
    </div>

    <Banner v-if="report && report.rules.status !== 'checked'" status="warning" title="These Schedule C lines haven't been checked for this tax year" class="Unmapped">
      <p>
        {{ report.rules.status === 'before'
          ? `Tiny Tally numbers lines as in ${report.rules.name}. Earlier years may have numbered them differently.`
          : `Tiny Tally has been checked against Schedule C up to tax years ending ${formatDay(report.rules.checkedUntil)} and is using those line numbers. The IRS may have changed the form since; update the app, or check against the current IRS instructions.` }}
      </p>
    </Banner>

    <Banner v-if="report?.unmapped.length" status="warning" title="Some categories aren't on a Schedule C line" class="Unmapped">
      <p>
        {{ report.unmapped.map((u) => `${u.name} (${money(u.total)})`).join(', ') }}
        {{ report.unmapped.length === 1 ? 'is' : 'are' }} left out of the totals below.
      </p>
      <Button @click="router.push('/categories')">Map categories</Button>
    </Banner>

    <Card>
      <CardSection>
        <div ref="sheet" :class="{ Loading: loading }">
          <div class="ReportHead">
            <h2>{{ books.name }}: Schedule C summary</h2>
            <p>{{ formatDay(range.from) }} – {{ formatDay(range.to) }} · {{ basis === 'cash' ? 'Cash' : 'Accrual' }} basis</p>
          </div>
          <table v-if="report" class="Report">
            <thead>
              <tr><th class="Line">Line</th><th>Description</th><th class="num">Amount</th></tr>
            </thead>
            <tbody>
              <tr class="Report__section"><td colspan="3">Part I: Income</td></tr>
              <tr v-if="!income.length"><td /><td class="subdued" colspan="2">No income in this period.</td></tr>
              <template v-for="l in income" :key="l.line">
                <tr>
                  <td class="Line">{{ l.line }}</td>
                  <td>{{ l.label }}<div class="subdued Small">{{ l.categories.map((c) => c.name).join(', ') }}</div></td>
                  <td class="num">{{ money(l.total) }}</td>
                </tr>
              </template>
              <tr class="Report__total"><td class="Line">7</td><td>Gross income</td><td class="num">{{ money(report.totals.grossIncome) }}</td></tr>

              <tr class="Report__section"><td colspan="3">Part II: Expenses</td></tr>
              <tr v-if="!expenses.length"><td /><td class="subdued" colspan="2">No expenses in this period.</td></tr>
              <template v-for="l in expenses" :key="l.line">
                <tr>
                  <td class="Line">{{ l.line }}</td>
                  <td>
                    {{ l.label }}
                    <div class="subdued Small">
                      {{ l.categories.map((c) => c.name).join(', ') }}
                      <template v-if="l.deductible !== l.total"> · {{ money(l.total) }} spent, 50% deductible</template>
                      <template v-if="l.line === '27a'"> · Equipment is at full cost: depreciation and section 179 are worked out separately</template>
                    </div>
                  </td>
                  <td class="num">{{ money(l.deductible) }}</td>
                </tr>
              </template>
              <tr class="Report__total"><td class="Line">28</td><td>Total expenses</td><td class="num">{{ money(report.totals.totalExpenses) }}</td></tr>
              <tr class="Report__grand">
                <td class="Line">31</td>
                <td>{{ report.totals.netProfit >= 0 ? 'Net profit' : 'Net loss' }}</td>
                <td class="num" :class="{ negative: report.totals.netProfit < 0 }">{{ money(report.totals.netProfit) }}</td>
              </tr>
            </tbody>
          </table>
          <p class="subdued Note">
            A summary to fill in Schedule C (Form 1040) or to give your tax preparer. It doesn't cover cost of goods sold,
            vehicle details, home office or depreciation, and leaves out tax payments, owner draws and loans.
          </p>
          <p v-if="report" class="subdued Note">Lines numbered as in {{ report.rules.name }}: checked against {{ report.rules.checkedAgainst }}.</p>
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

.Label {
  font-size: 13px;
  margin-bottom: 6px;
}

.Unmapped {
  margin-bottom: 16px;
}

.Unmapped p {
  margin: 0 0 8px;
}

.Loading {
  opacity: 0.6;
  transition: opacity 0.15s;
}

.Line {
  width: 56px;
}

.Small {
  font-size: 12px;
}

.Note {
  margin: 16px 0 0;
  font-size: 12px;
}
</style>
