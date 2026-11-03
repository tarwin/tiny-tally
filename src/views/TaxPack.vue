<script setup lang="ts">
// Year-end tax pack (US): everything a tax preparer asks a sole proprietor
// for, for one tax year, on one page to print, or saved as CSV files into a
// folder: Schedule C, the mileage log, 1099-NEC payees, estimated tax
// payments, sales tax collected, assets bought and every transaction.
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Banner, Card, CardSection, Page, Select, toast } from '@octans/ui';
import {
  api,
  errorMessage,
  type EstimatedTaxReport,
  type Nec1099Report,
  type OtherMovement,
  type SalesTaxReport,
  type ScheduleCReport,
  type TripList,
} from '../lib/api';
import { allEntries, csvMoney, entryCsvRows, toCsv } from '../lib/csv';
import { formatDay, today } from '../lib/dates';
import { onBooksChanged } from '../lib/live';
import { formatMoney, ratePercent } from '../lib/money';
import { printElement } from '../lib/print';
import { session } from '../lib/session';
import type { Cell } from '../shared/csv';

const router = useRouter();
const books = computed(() => session.books!);
const money = (v: number) => formatMoney(v, books.value.currency);
const miles = (tenths: number) => (tenths / 10).toLocaleString(undefined, { maximumFractionDigits: 1 });

const now = new Date();
// Tax season is for last year until it's over.
const year = ref(now.getMonth() < 10 ? now.getFullYear() - 1 : now.getFullYear());
const yearOptions = [0, 1, 2, 3].map((i) => ({ label: String(now.getFullYear() - i), value: now.getFullYear() - i }));
const range = computed(() => ({ from: `${year.value}-01-01`, to: `${year.value}-12-31` }));

const sc = ref<ScheduleCReport | null>(null);
const est = ref<EstimatedTaxReport | null>(null);
const nec = ref<Nec1099Report | null>(null);
const sales = ref<SalesTaxReport | null>(null);
const trips = ref<TripList | null>(null);
const assets = ref<OtherMovement[]>([]);
const loading = ref(false);
const sheet = ref<HTMLElement | null>(null);

async function load() {
  loading.value = true;
  try {
    const basis = books.value.taxBasis;
    const [a, b, c, d, e, pnl] = await Promise.all([
      api.scheduleCReport({ ...range.value, basis }),
      api.estimatedTaxReport({ year: year.value, today: today(), project: false }),
      api.nec1099Report(year.value),
      books.value.taxEnabled ? api.salesTaxReport({ ...range.value, basis }) : Promise.resolve(null),
      api.listTrips(range.value),
      api.profitAndLoss({ ...range.value, basis }),
    ]);
    sc.value = a;
    est.value = b;
    nec.value = c;
    sales.value = d;
    trips.value = e;
    assets.value = pnl.other.filter((o) => o.class === 'asset');
  } finally {
    loading.value = false;
  }
}
watch(year, load, { immediate: true });
onBooksChanged(load);

const yearOver = computed(() => today() > range.value.to);
const necNeeded = computed(() => nec.value?.payees.filter((p) => p.needsForm) ?? []);

// ---- files -----------------------------------------------------------------------

function scheduleCRows(r: ScheduleCReport): Cell[][] {
  return [
    ['Line', 'Description', 'Category', 'Amount'],
    ['1', 'Gross receipts or sales', '', csvMoney(r.partI.grossReceipts)],
    ['2', 'Returns and allowances', '', csvMoney(r.partI.returns)],
    ['4', 'Cost of goods sold', '', csvMoney(r.partI.costOfGoodsSold)],
    ['5', 'Gross profit', '', csvMoney(r.partI.grossProfit)],
    ...r.lines.flatMap((l) => [
      ...l.categories.map((c) => [l.line, l.label, c.name, csvMoney(c.total)]),
      [l.line, l.label, 'Total' + (l.deductible !== l.total ? ' (deductible)' : ''), csvMoney(l.deductible)],
    ]),
    ['7', 'Gross income', '', csvMoney(r.totals.grossIncome)],
    ['28', 'Total expenses', '', csvMoney(r.totals.totalExpenses)],
    ['30', `Business use of home (simplified, ${r.homeOffice.sqFt} sq ft)`, '', csvMoney(r.totals.homeOffice)],
    ['31', 'Net profit or loss', '', csvMoney(r.totals.netProfit)],
    ...(r.partIII.used
      ? [['35', 'Inventory at beginning of year', '', csvMoney(r.partIII.openingInventory)], ['41', 'Inventory at end of year', '', csvMoney(r.partIII.closingInventory)]]
      : []),
    ...(r.vehicle.milesTenths ? [['44a', 'Business miles', '', (r.vehicle.milesTenths / 10).toFixed(1)]] : []),
    ...r.unmapped.map((u) => ['', 'Not on a line', u.name, csvMoney(u.total)]),
  ];
}

async function saveFiles() {
  const folder = await tiny.dialog.pickFolder();
  if (!folder || !sc.value) return;
  const sep = folder.includes('\\') && !folder.includes('/') ? '\\' : '/';
  const safe = (s: string) => s.replace(/[\\/:*?"<>|]/g, '-');
  const dir = `${folder}${sep}${safe(`${books.value.name} tax pack ${year.value}`)}`;
  try {
    await api.makeDir(dir);
    const files: [string, Cell[][]][] = [
      ['Schedule C', scheduleCRows(sc.value)],
      ['Mileage log', [
        ['Date', 'Purpose', 'From', 'To', 'Vehicle', 'Miles', 'Rate (cents a mile)', 'Deduction'],
        ...[...(trips.value?.trips ?? [])].reverse().map((t) => [t.date, t.purpose, t.fromPlace ?? '', t.toPlace ?? '', t.vehicle ?? '', (t.distanceTenths / 10).toFixed(1), (t.rate / 10).toFixed(1), csvMoney(t.value)]),
      ]],
      ['1099-NEC payees', [
        ['Recipient TIN', 'Recipient name', 'Address', 'State', 'Box 1 nonemployee compensation', 'Needs a 1099'],
        ...(nec.value?.payees ?? []).map((p) => [p.tin ?? '', p.legalName ?? p.name, p.address ?? '', p.state ?? '', csvMoney(p.paid), p.needsForm ? 'Yes' : 'No']),
      ]],
      ['Estimated tax payments', [
        ['Date', 'Memo', 'Amount'],
        ...(est.value?.payments ?? []).map((p) => [p.date, p.memo ?? '', csvMoney(p.amount)]),
      ]],
      ['Assets bought or sold', [
        ['Category', 'Money out or in', 'Total', 'Transactions'],
        ...assets.value.map((a) => [a.name, a.kind === 'expense' ? 'Bought' : 'Sold', csvMoney(a.total), a.count]),
      ]],
      ...(sales.value
        ? [['Sales tax', [
            ['Rate', 'State', 'Taxable sales', 'Sales tax'],
            ...sales.value.byRate.map((r) => [`${r.name} (${ratePercent(r.ratePpm)}%)`, r.state ?? '', csvMoney(r.taxableSales), csvMoney(r.taxCollected)]),
            ['Non-taxable sales', '', csvMoney(sales.value.totals.nonTaxableSales), ''],
          ]] as [string, Cell[][]]]
        : []),
      ['Transactions', entryCsvRows(await allEntries({ from: range.value.from, to: range.value.to }))],
    ];
    for (const [name, rows] of files) await api.writeText(`${dir}${sep}${safe(`${name} ${year.value}`)}.csv`, toCsv(rows));
    toast({
      title: 'Tax pack saved',
      content: `${files.length} files in ${dir.slice(dir.lastIndexOf(sep) + 1)}`,
      tone: 'success',
      actions: [{ label: 'Show', onAction: () => void tiny.app.shell.reveal(dir) }],
    });
  } catch (e) {
    toast({ title: "Couldn't save the tax pack", content: errorMessage(e), tone: 'error' });
  }
}
</script>

<template>
  <Page
    title="Year-end tax pack"
    :breadcrumbs="[{ label: 'Reports', onAction: () => router.push('/reports') }]"
    size="fullWidth"
    :primary-action="{ label: 'Save files…', icon: 'mdi:folder-download-outline', onAction: saveFiles }"
    :secondary-actions="[{ label: 'Print / Save PDF', icon: 'mdi:printer-outline', onAction: () => printElement(sheet) }]"
  >
    <div class="Controls">
      <Select v-model="year" label="Tax year" :options="yearOptions" />
    </div>

    <Banner v-if="!yearOver" status="info" title="This year isn't over yet" class="Gap">
      <p>The figures are up to today. Make the pack again after December 31.</p>
    </Banner>
    <Banner v-if="sc?.unmapped.length" status="warning" title="Some categories aren't on a Schedule C line" class="Gap">
      <p>{{ sc.unmapped.map((u) => u.name).join(', ') }}. Map them in Categories so they're counted.</p>
    </Banner>

    <Card>
      <CardSection>
        <div ref="sheet" :class="{ Loading: loading }">
          <div class="ReportHead">
            <h2>{{ books.name }}: Tax pack, {{ year }}</h2>
            <p>{{ books.taxBasis === 'cash' ? 'Cash' : 'Accrual' }} basis{{ books.taxId ? ` · EIN ${books.taxId}` : '' }} · Made {{ formatDay(today()) }}</p>
          </div>

          <template v-if="sc">
            <h3>Schedule C</h3>
            <table class="Report">
              <tbody>
                <tr><td class="Line">1</td><td>Gross receipts or sales</td><td class="num">{{ money(sc.partI.grossReceipts) }}</td></tr>
                <tr v-if="sc.partI.returns"><td class="Line">2</td><td>Returns and allowances</td><td class="num">{{ money(sc.partI.returns) }}</td></tr>
                <tr v-if="sc.partI.costOfGoodsSold"><td class="Line">4</td><td>Cost of goods sold</td><td class="num">{{ money(sc.partI.costOfGoodsSold) }}</td></tr>
                <tr v-for="l in sc.lines.filter((x) => x.part === 'I' && x.key !== 'gross-receipts')" :key="l.key"><td class="Line">{{ l.line }}</td><td>{{ l.label }}</td><td class="num">{{ money(l.total) }}</td></tr>
                <tr class="Report__total"><td class="Line">7</td><td>Gross income</td><td class="num">{{ money(sc.totals.grossIncome) }}</td></tr>
                <tr v-for="l in sc.lines.filter((x) => x.part === 'II')" :key="l.key">
                  <td class="Line">{{ l.line }}</td>
                  <td>{{ l.label }}<span class="subdued Small"> · {{ l.categories.map((c) => c.name).join(', ') }}</span></td>
                  <td class="num">{{ money(l.deductible) }}</td>
                </tr>
                <tr class="Report__total"><td class="Line">28</td><td>Total expenses</td><td class="num">{{ money(sc.totals.totalExpenses) }}</td></tr>
                <tr v-if="sc.totals.homeOffice"><td class="Line">30</td><td>Business use of home ({{ sc.homeOffice.sqFt }} sq ft, simplified)</td><td class="num">{{ money(sc.totals.homeOffice) }}</td></tr>
                <tr class="Report__grand"><td class="Line">31</td><td>Net profit or loss</td><td class="num">{{ money(sc.totals.netProfit) }}</td></tr>
              </tbody>
            </table>
          </template>

          <h3>Vehicle</h3>
          <p v-if="!trips?.distanceTenths" class="subdued">No trips in the mileage log.</p>
          <p v-else>
            {{ miles(trips.distanceTenths) }} business miles in {{ trips.trips.length }} trips, {{ money(trips.value) }} at the standard
            mileage rate. Line 9 uses {{ sc?.vehicle.method === 'mileage' ? 'the standard mileage rate' : 'actual car costs' }}.
          </p>

          <h3>Estimated tax paid</h3>
          <p v-if="!est?.payments.length" class="subdued">No estimated tax payments recorded.</p>
          <table v-else class="Report">
            <tbody>
              <tr v-for="p in est.payments" :key="p.id"><td>{{ formatDay(p.date) }}</td><td class="subdued">{{ p.memo }}</td><td class="num">{{ money(p.amount) }}</td></tr>
              <tr class="Report__total"><td colspan="2">Total</td><td class="num">{{ money(est.totalPaid) }}</td></tr>
            </tbody>
          </table>

          <h3>1099-NEC</h3>
          <p v-if="!necNeeded.length" class="subdued">Nobody was paid enough for a 1099-NEC (from the vendors marked as 1099 payees).</p>
          <table v-else class="Report">
            <tbody>
              <tr v-for="p in necNeeded" :key="p.id">
                <td>{{ p.legalName ?? p.name }}<span v-if="p.missing.length" class="negative Small"> · no {{ p.missing.join(' or ') }}</span></td>
                <td class="num">{{ money(p.paid) }}</td>
              </tr>
            </tbody>
          </table>

          <h3>Assets bought or sold</h3>
          <p v-if="!assets.length" class="subdued">None. Equipment and vehicles you'll depreciate go in an asset category.</p>
          <table v-else class="Report">
            <tbody>
              <tr v-for="a in assets" :key="a.id"><td>{{ a.name }} <span class="subdued">({{ a.kind === 'expense' ? 'bought' : 'sold' }}, {{ a.count }})</span></td><td class="num">{{ money(a.total) }}</td></tr>
            </tbody>
          </table>

          <template v-if="sales">
            <h3>Sales tax collected</h3>
            <table class="Report">
              <tbody>
                <tr v-for="r in sales.byRate" :key="r.id ?? 'own'"><td>{{ r.name }} ({{ ratePercent(r.ratePpm) }}%)</td><td class="num">{{ money(r.taxCollected) }}</td></tr>
                <tr class="Report__total"><td>Total, on {{ money(sales.totals.taxableSales) }} of taxable sales</td><td class="num">{{ money(sales.totals.taxCollected) }}</td></tr>
              </tbody>
            </table>
          </template>

          <p class="subdued Note">
            Your preparer may also ask for: bank and card statements, Forms 1099-K and 1099-NEC you received, receipts for
            assets (with the date first used), health insurance and retirement contributions, and last year's return.
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
  margin: 0;
}

.Loading {
  opacity: 0.6;
  transition: opacity 0.15s;
}

h3 {
  margin: 24px 0 8px;
  font-size: 15px;
}

.Line {
  width: 56px;
}

.Small {
  font-size: 12px;
}

.negative {
  color: var(--octans-text-error);
}

.Note {
  margin: 24px 0 0;
  font-size: 12px;
}
</style>
