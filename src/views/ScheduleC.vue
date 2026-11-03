<script setup lang="ts">
// Profit & Loss in IRS Schedule C shape: each category's total under the
// line it maps to (set on the category), for a sole proprietor's return.
// Part III's inventory on hand is typed in here and kept with the books.
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Banner, Button, Card, CardSection, DatePicker, Page, SegmentedControl, Select, TextField } from '@octans/ui';
import { api, type Basis, type ScheduleCReport } from '../lib/api';
import { csvMoney, saveCsv } from '../lib/csv';
import { formatDay } from '../lib/dates';
import { onBooksChanged } from '../lib/live';
import { formatMoney, parseMoney, toInput } from '../lib/money';
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

const lineOf = (key: string) => report.value?.lines.find((l) => l.key === key);
const otherIncome = computed(() => report.value?.lines.filter((l) => l.part === 'I' && l.key !== 'gross-receipts') ?? []);
const expenses = computed(() => report.value?.lines.filter((l) => l.part === 'II') ?? []);
const cogs = computed(() => report.value?.lines.filter((l) => l.part === 'III') ?? []);
/** Part V: what makes up other expenses. */
const otherExpenses = computed(() => lineOf('other-expenses'));

// Part III shows once there's something in it, or when asked for.
const showPartIII = ref(false);
const partIIIShown = computed(() => !!report.value?.partIII.used || showPartIII.value);
const typed = ref({ opening: '', closing: '', sqFt: '' });
const miles = (tenths: number) => (tenths / 10).toLocaleString(undefined, { maximumFractionDigits: 1 });
watch(report, (r) => {
  typed.value = {
    sqFt: r?.homeOffice.sqFt ? String(r.homeOffice.sqFt) : '',
    opening: r?.partIII.openingInventory ? toInput(r.partIII.openingInventory, books.value.currency) : '',
    closing: r?.partIII.closingInventory ? toInput(r.partIII.closingInventory, books.value.currency) : '',
  };
});
const inventoryError = ref<string | null>(null);

async function saveSqFt() {
  const r = report.value;
  if (!r) return;
  const v = typed.value.sqFt.trim() ? Number(typed.value.sqFt.replace(/,/g, '')) : 0;
  if (!Number.isFinite(v) || v < 0) {
    inventoryError.value = 'Enter the square feet used for the business.';
    return;
  }
  if (v === r.homeOffice.sqFt) return;
  await api.setYearInputs({ year: Number(range.value.to.slice(0, 4)), homeOfficeSqFt: v || (null as unknown as number) });
  await load();
}

async function saveInventory(which: 'opening' | 'closing') {
  const r = report.value;
  if (!r) return;
  const amount = typed.value[which].trim() ? parseMoney(typed.value[which], books.value.currency) : null;
  if (amount !== null && amount < 0) {
    inventoryError.value = "Inventory can't be negative.";
    return;
  }
  inventoryError.value = null;
  const current = which === 'opening' ? r.partIII.openingInventory : r.partIII.closingInventory;
  if ((amount ?? 0) === current) return;
  await api.setInventory({ date: which === 'opening' ? r.partIII.openingDate : range.value.to, amount });
  await load();
}

function exportCsv() {
  const r = report.value;
  if (!r) return;
  void saveCsv(`Schedule C ${range.value.from} to ${range.value.to}`, [
    ['Line', 'Description', 'Category', 'Amount', 'Deductible'],
    ...r.lines.flatMap((l) => [
      ...l.categories.map((c) => [l.line, l.label, c.name, csvMoney(c.total), '']),
      [l.line, l.label, 'Total', csvMoney(l.total), csvMoney(l.deductible)],
    ]),
    ['1', 'Gross receipts or sales', '', '', csvMoney(r.partI.grossReceipts)],
    ['2', 'Returns and allowances', '', '', csvMoney(r.partI.returns)],
    ['3', 'Line 1 less line 2', '', '', csvMoney(r.partI.netReceipts)],
    ...(r.partIII.used
      ? [
          ['35', 'Inventory at beginning of year', '', '', csvMoney(r.partIII.openingInventory)],
          ['41', 'Inventory at end of year', '', '', csvMoney(r.partIII.closingInventory)],
        ]
      : []),
    ['4', 'Cost of goods sold', '', '', csvMoney(r.partI.costOfGoodsSold)],
    ['5', 'Gross profit', '', '', csvMoney(r.partI.grossProfit)],
    ['7', 'Gross income', '', '', csvMoney(r.totals.grossIncome)],
    ['28', 'Total expenses', '', '', csvMoney(r.totals.totalExpenses)],
    ['29', 'Tentative profit or loss', '', '', csvMoney(r.totals.tentativeProfit)],
    ['30', `Business use of home (simplified, ${r.homeOffice.sqFt} sq ft)`, '', '', csvMoney(r.totals.homeOffice)],
    ['31', 'Net profit or loss', '', '', csvMoney(r.totals.netProfit)],
    ...(r.vehicle.milesTenths ? [['44a', 'Business miles', '', (r.vehicle.milesTenths / 10).toFixed(1), '']] : []),
    ...r.unmapped.map((u) => ['', 'Not mapped', u.name, csvMoney(u.total), '']),
  ]);
}
</script>

<template>
  <Page
    title="Schedule C"
    :breadcrumbs="[{ label: 'Reports', onAction: () => router.push('/reports') }]"
    size="fullWidth"
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
              <tr>
                <td class="Line">1</td>
                <td>Gross receipts or sales<div v-if="lineOf('gross-receipts')" class="subdued Small">{{ lineOf('gross-receipts')!.categories.map((c) => c.name).join(', ') }}</div></td>
                <td class="num">{{ money(report.partI.grossReceipts) }}</td>
              </tr>
              <tr>
                <td class="Line">2</td>
                <td>Returns and allowances<div class="subdued Small">Credit notes on your sales</div></td>
                <td class="num">{{ money(report.partI.returns) }}</td>
              </tr>
              <tr><td class="Line">3</td><td>Line 1 less line 2</td><td class="num">{{ money(report.partI.netReceipts) }}</td></tr>
              <tr>
                <td class="Line">4</td>
                <td>Cost of goods sold<div class="subdued Small">{{ partIIIShown ? 'From Part III, line 42' : 'None. Selling goods? Add Part III below.' }}</div></td>
                <td class="num">{{ money(report.partI.costOfGoodsSold) }}</td>
              </tr>
              <tr><td class="Line">5</td><td>Gross profit</td><td class="num">{{ money(report.partI.grossProfit) }}</td></tr>
              <tr v-for="l in otherIncome" :key="l.key">
                <td class="Line">{{ l.line }}</td>
                <td>{{ l.label }}<div class="subdued Small">{{ l.categories.map((c) => c.name).join(', ') }}</div></td>
                <td class="num">{{ money(l.total) }}</td>
              </tr>
              <tr class="Report__total"><td class="Line">7</td><td>Gross income</td><td class="num">{{ money(report.totals.grossIncome) }}</td></tr>

              <tr class="Report__section"><td colspan="3">Part II: Expenses</td></tr>
              <tr v-if="!expenses.length"><td /><td class="subdued" colspan="2">No expenses in this period.</td></tr>
              <template v-for="l in expenses" :key="l.key">
                <tr>
                  <td class="Line">{{ l.line }}</td>
                  <td>
                    {{ l.label }}
                    <div class="subdued Small">
                      {{ l.categories.map((c) => c.name).join(', ') }}
                      <template v-if="l.deductible !== l.total"> · {{ money(l.total) }} spent, 50% deductible</template>
                      <template v-if="l.key === 'other-expenses'"> · Listed in Part V</template>
                      <template v-if="l.key === 'car-truck' && report.vehicle.method === 'mileage'">
                        {{ l.categories.length ? ' · ' : '' }}{{ miles(report.vehicle.milesTenths) }} miles at the standard rate ({{ money(report.vehicle.mileageDeduction) }})
                      </template>
                    </div>
                    <div v-if="l.key === 'car-truck' && report.vehicle.notDeducted.length" class="subdued Small">
                      Not deducted with the mileage rate: {{ report.vehicle.notDeducted.map((c) => `${c.name} (${money(c.total)})`).join(', ') }}
                    </div>
                  </td>
                  <td class="num">{{ money(l.deductible) }}</td>
                </tr>
              </template>
              <tr class="Report__total"><td class="Line">28</td><td>Total expenses</td><td class="num">{{ money(report.totals.totalExpenses) }}</td></tr>
              <tr><td class="Line">29</td><td>Tentative profit or loss</td><td class="num">{{ money(report.totals.tentativeProfit) }}</td></tr>
              <tr>
                <td class="Line">30</td>
                <td>
                  Business use of home (simplified method)
                  <div class="subdued Small no-print">
                    <TextField v-model="typed.sqFt" size="small" placeholder="0" suffix="sq ft" class="SqFt" @blur="saveSqFt" @keydown.enter="saveSqFt" />
                    used regularly and only for the business; $5 a square foot, up to 300.
                    <template v-if="report.homeOffice.limited"> Limited to the profit.</template>
                  </div>
                  <div v-if="report.homeOffice.sqFt" class="subdued Small print-only">{{ report.homeOffice.sqFt }} sq ft</div>
                </td>
                <td class="num">{{ money(report.totals.homeOffice) }}</td>
              </tr>
              <tr class="Report__grand">
                <td class="Line">31</td>
                <td>{{ report.totals.netProfit >= 0 ? 'Net profit' : 'Net loss' }}</td>
                <td class="num" :class="{ negative: report.totals.netProfit < 0 }">{{ money(report.totals.netProfit) }}</td>
              </tr>

              <template v-if="partIIIShown">
                <tr class="Report__section"><td colspan="3">Part III: Cost of goods sold</td></tr>
                <tr>
                  <td class="Line">35</td>
                  <td>Inventory at beginning of year<div class="subdued Small no-print">On hand at the end of {{ formatDay(report.partIII.openingDate) }}: last year's line 41</div></td>
                  <td class="num">
                    <TextField v-model="typed.opening" align="right" placeholder="0" class="no-print Input" @blur="saveInventory('opening')" @keydown.enter="saveInventory('opening')" />
                    <span class="print-only">{{ money(report.partIII.openingInventory) }}</span>
                  </td>
                </tr>
                <tr v-if="!cogs.length"><td /><td class="subdued" colspan="2">No purchases yet. Map a category to lines 36 to 39 in Categories.</td></tr>
                <tr v-for="l in cogs" :key="l.key">
                  <td class="Line">{{ l.line }}</td>
                  <td>{{ l.label.replace(' (cost of goods sold)', '') }}<div class="subdued Small">{{ l.categories.map((c) => c.name).join(', ') }}</div></td>
                  <td class="num">{{ money(l.total) }}</td>
                </tr>
                <tr class="Report__total">
                  <td class="Line">40</td>
                  <td>Add lines 35 through 39</td>
                  <td class="num">{{ money(report.partI.costOfGoodsSold + report.partIII.closingInventory) }}</td>
                </tr>
                <tr>
                  <td class="Line">41</td>
                  <td>Inventory at end of year<div class="subdued Small no-print">On hand at the end of {{ formatDay(range.to) }}, at cost</div></td>
                  <td class="num">
                    <TextField v-model="typed.closing" align="right" placeholder="0" class="no-print Input" @blur="saveInventory('closing')" @keydown.enter="saveInventory('closing')" />
                    <span class="print-only">{{ money(report.partIII.closingInventory) }}</span>
                  </td>
                </tr>
                <tr class="Report__grand"><td class="Line">42</td><td>Cost of goods sold</td><td class="num">{{ money(report.partI.costOfGoodsSold) }}</td></tr>
                <tr v-if="inventoryError" class="no-print"><td /><td class="negative" colspan="2">{{ inventoryError }}</td></tr>
              </template>

              <template v-if="report.vehicle.milesTenths">
                <tr class="Report__section"><td colspan="3">Part IV: Information on your vehicle</td></tr>
                <tr>
                  <td class="Line">44a</td>
                  <td>Business miles<div class="subdued Small no-print">From the <a href="#" @click.prevent="router.push('/mileage')">mileage log</a>. Lines 43 to 47 also ask when the car was first used for business, commuting and other miles, and about records.</div></td>
                  <td class="num">{{ miles(report.vehicle.milesTenths) }}</td>
                </tr>
              </template>

              <template v-if="otherExpenses">
                <tr class="Report__section"><td colspan="3">Part V: Other expenses</td></tr>
                <tr v-for="c in otherExpenses.categories" :key="c.id"><td /><td>{{ c.name }}</td><td class="num">{{ money(c.total) }}</td></tr>
                <tr class="Report__total"><td class="Line">48</td><td>Total other expenses (line {{ otherExpenses.line }})</td><td class="num">{{ money(otherExpenses.deductible) }}</td></tr>
              </template>
            </tbody>
          </table>
          <Button v-if="report && !partIIIShown" class="no-print AddPart" @click="showPartIII = true">Add cost of goods sold (Part III)</Button>
          <p class="subdued Note">
            A summary to fill in Schedule C (Form 1040) or to give your tax preparer. It doesn't work out depreciation
            (Form 4562), the regular home office method (Form 8829), or answer Part III's inventory method questions (lines
            33 and 34). It leaves out tax payments, owner draws, loans and assets bought. For a period shorter than the
            year, the home office amount is the same share of the year.
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

.Input {
  max-width: 160px;
  margin-left: auto;
}

.SqFt {
  display: inline-block;
  width: 120px;
  margin-right: 6px;
  vertical-align: middle;
}

.AddPart {
  margin-top: 16px;
}

.Note {
  margin: 16px 0 0;
  font-size: 12px;
}
</style>
