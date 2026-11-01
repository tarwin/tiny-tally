<script setup lang="ts">
// Sales by customer, or expenses by supplier (route meta.kind). The P&L's
// income or expense total, split by who it came from or went to.
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Card, CardSection, DatePicker, Page, SegmentedControl, Select, ToggleSwitch } from '@octans/ui';
import { api, type Basis, type ByContact } from '../lib/api';
import { csvMoney, saveCsv } from '../lib/csv';
import { formatDay } from '../lib/dates';
import { formatMoney } from '../lib/money';
import { PERIOD_OPTIONS, periodRange, previousPeriod, type PeriodKey } from '../lib/periods';
import { printElement } from '../lib/print';
import { booksTax, session } from '../lib/session';

const route = useRoute();
const router = useRouter();
const books = computed(() => session.books!);
const money = (v: number) => formatMoney(v, books.value.currency);

const kind = computed(() => (route.meta.kind === 'expense' ? 'expense' : 'income'));
const words = computed(() =>
  kind.value === 'income'
    ? { title: 'Sales by customer', who: 'Customer', empty: 'No sales in this period.' }
    : { title: 'Expenses by supplier', who: 'Supplier', empty: 'No expenses in this period.' },
);

const period = ref<PeriodKey | 'custom'>('thisYear');
const custom = ref(periodRange('thisYear', books.value.fiscalYearStart) as { from: string; to: string });
const basis = ref<Basis>(books.value.taxBasis);
const compare = ref(false);
const report = ref<ByContact | null>(null);
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
    report.value = await api.byContact({
      ...range.value,
      basis: basis.value,
      kind: kind.value,
      ...(compare.value ? { compareFrom: prev.value.from, compareTo: prev.value.to } : {}),
    });
  } finally {
    loading.value = false;
  }
}

watch([range, basis, compare, kind], load, { deep: true });
onMounted(load);

const subtitle = computed(
  () => `${formatDay(range.value.from)} – ${formatDay(range.value.to)} · ${basis.value === 'cash' ? 'Cash' : 'Accrual'} basis${booksTax() ? ` · ${booksTax()!.short} exclusive` : ''}`,
);
const cols = computed(() => (compare.value ? 5 : 3));

function share(v: number) {
  const total = report.value?.total ?? 0;
  return total ? `${Math.round((v / total) * 100)}%` : '';
}

function change(now: number, before: number) {
  if (!before) return '';
  const pct = Math.round(((now - before) / Math.abs(before)) * 100);
  return `${pct > 0 ? '+' : ''}${pct}%`;
}

function exportCsv() {
  const r = report.value;
  if (!r) return;
  const head = compare.value ? [words.value.who, 'This period', 'Previous period'] : [words.value.who, 'Amount'];
  const row = (name: string, a: number, b: number) => (compare.value ? [name, csvMoney(a), csvMoney(b)] : [name, csvMoney(a)]);
  void saveCsv(`${words.value.title} ${range.value.from} to ${range.value.to}`, [
    head,
    ...r.rows.map((x) => row(x.name, x.total, x.compare)),
    row('Total', r.total, r.compareTotal),
  ]);
}
</script>

<template>
  <Page
    :title="words.title"
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
            <h2>{{ books.name }}: {{ words.title }}</h2>
            <p>{{ subtitle }}</p>
          </div>
          <table v-if="report" class="Report">
            <thead>
              <tr>
                <th>{{ words.who }}</th>
                <th class="num">{{ compare ? 'This period' : 'Amount' }}</th>
                <th class="num">Share</th>
                <template v-if="compare">
                  <th class="num">{{ formatDay(prev.from) }} – {{ formatDay(prev.to) }}</th>
                  <th class="num">Change</th>
                </template>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!report.rows.length"><td class="subdued" :colspan="cols">{{ words.empty }}</td></tr>
              <tr v-for="r in report.rows" :key="r.id">
                <td>
                  <RouterLink v-if="r.id" :to="`/contacts/${r.id}/statement`" class="Link">{{ r.name }}</RouterLink>
                  <span v-else class="subdued">{{ r.name }}</span>
                </td>
                <td class="num">{{ money(r.total) }}</td>
                <td class="num subdued">{{ share(r.total) }}</td>
                <template v-if="compare">
                  <td class="num subdued">{{ money(r.compare) }}</td>
                  <td class="num subdued">{{ change(r.total, r.compare) }}</td>
                </template>
              </tr>
              <tr class="Report__grand">
                <td>Total</td>
                <td class="num">{{ money(report.total) }}</td>
                <td />
                <template v-if="compare">
                  <td class="num">{{ money(report.compareTotal) }}</td>
                  <td class="num">{{ change(report.total, report.compareTotal) }}</td>
                </template>
              </tr>
            </tbody>
          </table>
          <p class="subdued Note">
            The same total as {{ kind === 'income' ? 'income' : 'expenses' }} on the Profit &amp; Loss for this period and basis.
            Transfers, tax payments, drawings and loans are left out.
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

.Label {
  font-size: 13px;
  margin-bottom: 6px;
}

.Loading {
  opacity: 0.6;
  transition: opacity 0.15s;
}

.Link {
  color: var(--octans-text-link);
  text-decoration: none;
}

.Link:hover {
  text-decoration: underline;
}

.Note {
  margin: 16px 0 0;
  font-size: 12px;
}
</style>
