<script setup lang="ts">
// The business income summary for an Australian or New Zealand income tax
// return: item P8 of the business and professional items schedule, or the
// IR10 financial statements summary. Each category's total under the label
// or box it maps to (set on the category), with stock on hand, the car from
// the trip log, and working from home typed in here.
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Banner, Button, Card, CardSection, Page, SegmentedControl, Select, TextField } from '@octans/ui';
import { api, type Basis, type IncomeReturnReport } from '../lib/api';
import { csvMoney, saveCsv } from '../lib/csv';
import { formatDay, today } from '../lib/dates';
import { onBooksChanged } from '../lib/live';
import { formatMoney, parseMoney, toInput } from '../lib/money';
import { printElement } from '../lib/print';
import { session } from '../lib/session';
import { incomeYearLabel, incomeYearOf, incomeYearRange } from '../shared/incomeYear';
import { auTaxYear } from '../shared/auTaxYears';
import { nzTaxYear } from '../shared/nzTaxYears';

const router = useRouter();
const books = computed(() => session.books!);
const au = computed(() => books.value.country === 'AU');
const money = (v: number) => formatMoney(v, books.value.currency);
const ys = computed(() => books.value.fiscalYearStart);

const thisYear = incomeYearOf(today(), ys.value);
const year = ref(thisYear - 1);
const yearOptions = computed(() => [0, 1, 2, 3].map((i) => ({ label: incomeYearLabel(thisYear - i, ys.value), value: thisYear - i })));
const range = computed(() => incomeYearRange(year.value, ys.value));
const basis = ref<Basis>(books.value.taxBasis);
const report = ref<IncomeReturnReport | null>(null);
const loading = ref(false);
const sheet = ref<HTMLElement | null>(null);
const title = computed(() => (au.value ? 'Business schedule' : 'IR10 summary'));

async function load() {
  loading.value = true;
  try {
    report.value = await api.incomeReturnReport({ ...range.value, basis: basis.value });
  } finally {
    loading.value = false;
  }
}
watch([year, basis], load);
onMounted(load);
onBooksChanged(load);

const income = computed(() => report.value?.lines.filter((l) => l.kind === 'income') ?? []);
const costOfSales = computed(() => report.value?.lines.filter((l) => l.costOfSales) ?? []);
const expenses = computed(() => report.value?.lines.filter((l) => l.kind === 'expense' && !l.costOfSales) ?? []);
const showStock = ref(false);
const stockShown = computed(() => showStock.value || !!costOfSales.value.length || !!report.value?.stock.opening || !!report.value?.stock.closing);
const wfhRate = computed(() => auTaxYear(year.value).rules);
const nzRules = computed(() => nzTaxYear(year.value).rules);

// ---- typed in -------------------------------------------------------------------------

const typed = ref({ opening: '', closing: '', hours: '', officeArea: '', homeArea: '', premises: '' });
const inputError = ref<string | null>(null);
watch(report, async (r) => {
  const inputs = await api.yearInputs(year.value);
  typed.value = {
    opening: r?.stock.opening ? toInput(r.stock.opening, books.value.currency) : '',
    closing: r?.stock.closing ? toInput(r.stock.closing, books.value.currency) : '',
    hours: inputs.homeOfficeHours ? String(inputs.homeOfficeHours) : '',
    officeArea: inputs.homeOfficeArea ? String(inputs.homeOfficeArea) : '',
    homeArea: inputs.homeArea ? String(inputs.homeArea) : '',
    premises: inputs.premisesCosts ? toInput(inputs.premisesCosts, books.value.currency) : '',
  };
});

async function saveStock(which: 'opening' | 'closing') {
  const r = report.value;
  if (!r) return;
  const amount = typed.value[which].trim() ? parseMoney(typed.value[which], books.value.currency) : null;
  if (amount !== null && amount < 0) {
    inputError.value = "Stock can't be negative.";
    return;
  }
  inputError.value = null;
  if ((amount ?? 0) === (which === 'opening' ? r.stock.opening : r.stock.closing)) return;
  await api.setInventory({ date: which === 'opening' ? r.stock.openingDate : range.value.to, amount });
  await load();
}

async function saveHome() {
  const n = (v: string) => (v.trim() ? Number(v.replace(/,/g, '')) : null);
  try {
    inputError.value = null;
    await api.setYearInputs(au.value
      ? { year: year.value, homeOfficeHours: n(typed.value.hours) }
      : {
          year: year.value,
          homeOfficeArea: n(typed.value.officeArea),
          homeArea: n(typed.value.homeArea),
          premisesCosts: typed.value.premises.trim() ? parseMoney(typed.value.premises, books.value.currency) : null,
        });
    await load();
  } catch (e) {
    inputError.value = e instanceof Error ? e.message : String(e);
  }
}

function exportCsv() {
  const r = report.value;
  if (!r) return;
  void saveCsv(`${title.value} ${incomeYearLabel(year.value, ys.value)}`, [
    [au.value ? 'Label' : 'Box', 'Description', 'Category', 'Amount'],
    ...r.lines.flatMap((l) => [
      ...l.categories.map((c) => [l.code, l.label, c.name, csvMoney(c.total)]),
      ...l.notes.map((note) => [l.code, l.label, note, '']),
      [l.code, l.label, 'Total', csvMoney(l.total)],
    ]),
    ...(stockShown.value
      ? [
          [au.value ? 'K' : '3', 'Opening stock', '', csvMoney(r.stock.opening)],
          [au.value ? 'M' : '5', 'Closing stock', '', csvMoney(r.stock.closing)],
          ['', 'Cost of sales', '', csvMoney(r.totals.costOfSales)],
        ]
      : []),
    ['', 'Total income', '', csvMoney(r.totals.income)],
    ['', 'Total expenses', '', csvMoney(r.totals.expenses)],
    ['', 'Net profit', '', csvMoney(r.totals.net)],
  ]);
}
</script>

<template>
  <Page
    :title="title"
    :breadcrumbs="[{ label: 'Reports', onAction: () => router.push('/reports') }]"
    size="wide"
    :primary-action="{ label: 'Export CSV', icon: 'mdi:file-delimited-outline', onAction: exportCsv }"
    :secondary-actions="[{ label: 'Print / Save PDF', icon: 'mdi:printer-outline', onAction: () => printElement(sheet) }]"
  >
    <div class="Controls">
      <Select v-model="year" label="Income year" :options="yearOptions" />
      <div>
        <div class="Label">Basis</div>
        <SegmentedControl v-model="basis" :options="[{ label: 'Cash', value: 'cash' }, { label: 'Accrual', value: 'accrual' }]" />
      </div>
    </div>

    <Banner v-if="report?.unmapped.length" status="warning" :title="`Some categories aren't on ${au ? 'a P8 label' : 'an IR10 box'}`" class="Gap">
      <p>
        {{ report.unmapped.map((u) => `${u.name} (${money(u.total)})`).join(', ') }}
        {{ report.unmapped.length === 1 ? 'is' : 'are' }} counted as other {{ report.unmapped.length === 1 && report.unmapped[0].kind === 'income' ? 'income' : 'income or expenses' }} below.
      </p>
      <Button @click="router.push('/categories')">Map categories</Button>
    </Banner>
    <Banner v-if="inputError" status="critical" :title="inputError" class="Gap" />

    <Card>
      <CardSection>
        <div ref="sheet" :class="{ Loading: loading }">
          <div class="ReportHead">
            <h2>{{ books.name }}: {{ report?.title ?? title }}</h2>
            <p>{{ incomeYearLabel(year, ys) }} · {{ formatDay(range.from) }} – {{ formatDay(range.to) }} · {{ basis === 'cash' ? 'Cash' : 'Accrual' }} basis</p>
          </div>
          <table v-if="report" class="Report">
            <thead>
              <tr><th class="Line">{{ au ? 'Label' : 'Box' }}</th><th>Description</th><th class="num">Amount</th></tr>
            </thead>
            <tbody>
              <tr class="Report__section"><td colspan="3">Income</td></tr>
              <tr v-if="!income.length"><td /><td class="subdued" colspan="2">No income in this year.</td></tr>
              <tr v-for="l in income" :key="l.key">
                <td class="Line">{{ l.code }}</td>
                <td>{{ l.label }}<div class="subdued Small">{{ l.categories.map((c) => c.name).join(', ') }}</div></td>
                <td class="num">{{ money(l.total) }}</td>
              </tr>
              <tr class="Report__total"><td /><td>Total income</td><td class="num">{{ money(report.totals.income) }}</td></tr>

              <template v-if="stockShown">
                <tr class="Report__section"><td colspan="3">Cost of sales</td></tr>
                <tr>
                  <td class="Line">{{ au ? 'K' : '3' }}</td>
                  <td>Opening stock<div class="subdued Small">On hand {{ formatDay(report.stock.openingDate) }}</div></td>
                  <td class="num"><TextField v-model="typed.opening" class="Input no-print" align="right" :prefix="books.currency" @blur="saveStock('opening')" @keydown.enter="saveStock('opening')" /><span class="print-only">{{ money(report.stock.opening) }}</span></td>
                </tr>
                <tr v-for="l in costOfSales" :key="l.key">
                  <td class="Line">{{ l.code }}</td>
                  <td>{{ l.label }}<div class="subdued Small">{{ l.categories.map((c) => c.name).join(', ') }}</div></td>
                  <td class="num">{{ money(l.total) }}</td>
                </tr>
                <tr>
                  <td class="Line">{{ au ? 'M' : '5' }}</td>
                  <td>Closing stock<div class="subdued Small">On hand {{ formatDay(range.to) }}</div></td>
                  <td class="num"><TextField v-model="typed.closing" class="Input no-print" align="right" :prefix="books.currency" @blur="saveStock('closing')" @keydown.enter="saveStock('closing')" /><span class="print-only">{{ money(report.stock.closing) }}</span></td>
                </tr>
                <tr class="Report__total"><td /><td>Cost of sales</td><td class="num">{{ money(report.totals.costOfSales) }}</td></tr>
                <tr class="Report__total"><td>{{ au ? '' : '6' }}</td><td>Gross profit</td><td class="num">{{ money(report.totals.grossProfit) }}</td></tr>
              </template>

              <tr class="Report__section"><td colspan="3">Expenses</td></tr>
              <tr v-if="!expenses.length"><td /><td class="subdued" colspan="2">No expenses in this year.</td></tr>
              <tr v-for="l in expenses" :key="l.key">
                <td class="Line">{{ l.code }}</td>
                <td>
                  {{ l.label }}
                  <div class="subdued Small">{{ [...l.categories.map((c) => c.name), ...l.notes].join(' · ') }}</div>
                  <div v-if="l.key === (au ? 'au-motor-vehicle' : 'nz-vehicle') && report.car.notDeducted.length" class="subdued Small">
                    Not claimed with the {{ au ? 'cents per km' : 'kilometre rate' }}: {{ report.car.notDeducted.map((c) => `${c.name} (${money(c.total)})`).join(', ') }}
                  </div>
                </td>
                <td class="num">{{ money(l.total) }}</td>
              </tr>
              <tr class="Report__total"><td>{{ au ? '' : '25' }}</td><td>Total expenses</td><td class="num">{{ money(report.totals.expenses) }}</td></tr>
              <tr class="Report__total grand"><td>{{ au ? 'C' : '27' }}</td><td>Net {{ report.totals.net < 0 ? 'loss' : 'profit' }}</td><td class="num">{{ money(report.totals.net) }}</td></tr>
            </tbody>
          </table>
          <Button v-if="report && !stockShown" class="no-print AddPart" @click="showStock = true">Add stock (cost of sales)</Button>

          <div class="no-print Home">
            <h3>{{ au ? 'Working from home' : 'Home office' }}</h3>
            <template v-if="au">
              <TextField
                v-model="typed.hours"
                label="Hours worked from home in the year"
                inputmode="numeric"
                :help-text="`Fixed rate method: ${wfhRate.wfhPerHour / 10}c an hour${wfhRate.wfhSet ? '' : ' (the ATO hasn\'t set this year\'s rate yet)'}, for power, internet, phone and stationery. Keep a record of the actual hours.`"
                @blur="saveHome"
                @keydown.enter="saveHome"
              />
            </template>
            <div v-else class="HomeFields">
              <TextField v-model="typed.officeArea" label="Office area" suffix="m²" @blur="saveHome" @keydown.enter="saveHome" />
              <TextField v-model="typed.homeArea" label="Whole home" suffix="m²" @blur="saveHome" @keydown.enter="saveHome" />
              <TextField v-model="typed.premises" label="Rates, rent or mortgage interest" :prefix="books.currency" help-text="For the year" @blur="saveHome" @keydown.enter="saveHome" />
              <p class="subdued Small">
                Square metre method: the office's share of rates, rent and mortgage interest, plus {{ money(nzRules.homeOfficePerSqm) }} a m²
                for utilities{{ nzRules.homeOfficeSet ? '' : " (IRD hasn't set this year's rate yet)" }}. Nothing else for the home can be claimed with it.
              </p>
            </div>
          </div>

          <p class="subdued Note">
            <template v-if="au">
              A summary for item P8 of the business and professional items schedule (non-primary production), or to give your
              tax agent. Most income is "other business income" (J). It doesn't work out depreciation beyond what's in your
              categories, or the small business pool. Interest on a business account usually goes on your personal return.
            </template>
            <template v-else>
              A summary for the IR10, which goes with your IR3, or to give your accountant. Income tax withheld by clients goes
              on the IR3 as a tax credit (see Income tax). It doesn't work out tax depreciation (Box 52) or the balance sheet.
            </template>
            Checked against <a :href="report?.source" target="_blank">the {{ au ? '2026 instructions' : 'March 2026 form' }}</a>.
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
  min-width: 160px;
}

.Label {
  font-size: 13px;
  margin-bottom: 6px;
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

.Line {
  width: 56px;
}

.Small {
  font-size: 12px;
}

.Input {
  max-width: 160px;
  margin-left: auto;
}

.AddPart {
  margin-top: 16px;
}

.Home {
  margin-top: 24px;
  max-width: 560px;
}

.Home h3 {
  margin: 0 0 8px;
  font-size: 14px;
}

.HomeFields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.HomeFields > :nth-child(3),
.HomeFields > p {
  grid-column: 1 / -1;
}

.Note {
  margin: 16px 0 0;
  font-size: 12px;
}
</style>
