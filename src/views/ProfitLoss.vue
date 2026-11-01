<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Card, CardSection, DatePicker, Page, SegmentedControl, Select, ToggleSwitch } from '@octans/ui';
import { api, type Basis, type ProfitAndLoss } from '../lib/api';
import { csvMoney, saveCsv } from '../lib/csv';
import { formatDay } from '../lib/dates';
import { formatMoney } from '../lib/money';
import { PERIOD_OPTIONS, periodRange, previousPeriod, type PeriodKey } from '../lib/periods';
import { printElement } from '../lib/print';
import { booksTax, session } from '../lib/session';

const router = useRouter();
const books = computed(() => session.books!);
const money = (v: number) => formatMoney(v, books.value.currency);

const period = ref<PeriodKey | 'custom'>('thisYear');
const custom = ref(periodRange('thisYear', books.value.fiscalYearStart) as { from: string; to: string });
const basis = ref<Basis>(books.value.taxBasis);
const compare = ref(false);
const report = ref<ProfitAndLoss | null>(null);
const loading = ref(false);
const sheet = ref<HTMLElement | null>(null);

const periodOptions = [...PERIOD_OPTIONS.filter((o) => o.value !== 'all'), { label: 'Custom dates', value: 'custom' as const }];

const range = computed(() =>
  period.value === 'custom' ? custom.value : (periodRange(period.value, books.value.fiscalYearStart) as { from: string; to: string }),
);
const prev = computed(() => previousPeriod(range.value.from, range.value.to));

async function load() {
  loading.value = true;
  try {
    report.value = await api.profitAndLoss({
      ...range.value,
      basis: basis.value,
      ...(compare.value ? { compareFrom: prev.value.from, compareTo: prev.value.to } : {}),
    });
  } finally {
    loading.value = false;
  }
}

watch([range, basis, compare], load, { deep: true });
onMounted(load);

const subtitle = computed(
  () => `${formatDay(range.value.from)} – ${formatDay(range.value.to)} · ${basis.value === 'cash' ? 'Cash' : 'Accrual'} basis${booksTax() ? ` · ${booksTax()!.short} exclusive` : ''}`,
);

function change(now: number, before: number) {
  if (!before) return '';
  const pct = Math.round(((now - before) / Math.abs(before)) * 100);
  return `${pct > 0 ? '+' : ''}${pct}%`;
}

const otherSides = computed(() =>
  (['income', 'expense'] as const).map((kind) => ({ kind, rows: report.value?.other.filter((o) => o.kind === kind) ?? [] })),
);

function exportCsv() {
  const r = report.value;
  if (!r) return;
  const head = compare.value ? ['Section', 'Category', 'This period', 'Previous period'] : ['Section', 'Category', 'Amount'];
  const row = (section: string, name: string, a: number, b: number) =>
    compare.value ? [section, name, csvMoney(a), csvMoney(b)] : [section, name, csvMoney(a)];
  void saveCsv(`Profit and Loss ${range.value.from} to ${range.value.to}`, [
    head,
    ...r.income.map((x) => row('Income', x.name, x.total, x.compare)),
    row('Income', 'Total income', r.totals.income, r.totals.compareIncome),
    ...r.expense.map((x) => row('Expenses', x.name, x.total, x.compare)),
    row('Expenses', 'Total expenses', r.totals.expense, r.totals.compareExpense),
    row('', 'Net profit', r.totals.net, r.totals.compareNet),
    ...r.other.map((x) => row(x.kind === 'income' ? 'Other money in' : 'Other money out', x.name, x.total, x.compare ?? 0)),
  ]);
}
</script>

<template>
  <Page
    title="Profit & Loss"
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
      <ToggleSwitch v-model="compare" label="Compare with previous period" />
    </div>

    <Card>
      <CardSection>
        <div ref="sheet" :class="{ Loading: loading }">
          <div class="ReportHead">
            <h2>{{ books.name }}: Profit & Loss</h2>
            <p>{{ subtitle }}</p>
          </div>
          <table v-if="report" class="Report">
            <thead>
              <tr>
                <th>Category</th>
                <th class="num">{{ compare ? 'This period' : 'Amount' }}</th>
                <template v-if="compare">
                  <th class="num">{{ formatDay(prev.from) }} – {{ formatDay(prev.to) }}</th>
                  <th class="num">Change</th>
                </template>
              </tr>
            </thead>
            <tbody>
              <tr class="Report__section"><td :colspan="compare ? 4 : 2">Income</td></tr>
              <tr v-if="!report.income.length"><td class="Report__indent subdued" :colspan="compare ? 4 : 2">No income in this period.</td></tr>
              <tr v-for="r in report.income" :key="'i' + r.id">
                <td class="Report__indent">{{ r.name }}</td>
                <td class="num">{{ money(r.total) }}</td>
                <template v-if="compare">
                  <td class="num subdued">{{ money(r.compare) }}</td>
                  <td class="num subdued">{{ change(r.total, r.compare) }}</td>
                </template>
              </tr>
              <tr class="Report__total">
                <td>Total income</td>
                <td class="num">{{ money(report.totals.income) }}</td>
                <template v-if="compare">
                  <td class="num">{{ money(report.totals.compareIncome) }}</td>
                  <td class="num">{{ change(report.totals.income, report.totals.compareIncome) }}</td>
                </template>
              </tr>

              <tr class="Report__section"><td :colspan="compare ? 4 : 2">Expenses</td></tr>
              <tr v-if="!report.expense.length"><td class="Report__indent subdued" :colspan="compare ? 4 : 2">No expenses in this period.</td></tr>
              <tr v-for="r in report.expense" :key="'e' + r.id">
                <td class="Report__indent">{{ r.name }}</td>
                <td class="num">{{ money(r.total) }}</td>
                <template v-if="compare">
                  <td class="num subdued">{{ money(r.compare) }}</td>
                  <td class="num subdued">{{ change(r.total, r.compare) }}</td>
                </template>
              </tr>
              <tr class="Report__total">
                <td>Total expenses</td>
                <td class="num">{{ money(report.totals.expense) }}</td>
                <template v-if="compare">
                  <td class="num">{{ money(report.totals.compareExpense) }}</td>
                  <td class="num">{{ change(report.totals.expense, report.totals.compareExpense) }}</td>
                </template>
              </tr>

              <tr class="Report__grand">
                <td>{{ report.totals.net >= 0 ? 'Net profit' : 'Net loss' }}</td>
                <td class="num" :class="{ negative: report.totals.net < 0 }">{{ money(report.totals.net) }}</td>
                <template v-if="compare">
                  <td class="num">{{ money(report.totals.compareNet) }}</td>
                  <td class="num">{{ change(report.totals.net, report.totals.compareNet) }}</td>
                </template>
              </tr>
            </tbody>
          </table>
          <template v-if="report?.other.length">
            <h3 class="Other__title">Not profit or loss</h3>
            <p class="subdued Note Other__note">
              Money that moved but isn't income or an expense: tax payments, owner drawings, loans and assets. Amounts include any tax.
            </p>
            <table class="Report">
              <tbody>
                <template v-for="side in otherSides" :key="side.kind">
                  <template v-if="side.rows.length">
                    <tr class="Report__section">
                      <td :colspan="compare ? 4 : 2">{{ side.kind === 'income' ? 'Money in' : 'Money out' }}</td>
                    </tr>
                    <tr v-for="o in side.rows" :key="o.id">
                      <td class="Report__indent">{{ o.name }}</td>
                      <td class="num">{{ money(o.total) }}</td>
                      <template v-if="compare">
                        <td class="num subdued">{{ money(o.compare ?? 0) }}</td>
                        <td class="num subdued">{{ change(o.total, o.compare ?? 0) }}</td>
                      </template>
                    </tr>
                  </template>
                </template>
              </tbody>
            </table>
          </template>
          <p class="subdued Note">
            {{ basis === 'cash'
              ? 'Cash basis: income counts when you are paid, and invoice payments are split across the invoice’s categories.'
              : 'Accrual basis: income counts when an invoice is approved, whether or not it has been paid.' }}
            Transfers between your own accounts are left out.
          </p>
        </div>
      </CardSection>
    </Card>
  </Page>
</template>

<style scoped>
.Other__title {
  margin: 24px 0 2px;
  font-size: 15px;
}

.Other__note {
  margin: 0 0 8px;
}

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

.Loading {
  opacity: 0.6;
  transition: opacity 0.15s;
}

.Note {
  margin: 16px 0 0;
  font-size: 12px;
}
</style>
