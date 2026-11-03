<script setup lang="ts">
// Year-end pack (Australia and New Zealand): what an accountant or tax agent
// asks a sole trader for, for one income year, on one page to print or saved
// as CSV files into a folder: the business schedule (P8) or IR10, the car
// and trip log, income tax instalments paid, tax withheld by clients (NZ),
// TPAR contractors (AU), assets bought and every transaction.
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Banner, Card, CardSection, Page, Select, toast } from '@octans/ui';
import {
  api,
  errorMessage,
  type AssetBought,
  type CarYear,
  type IncomeReturnReport,
  type PaygReport,
  type ProvisionalReport,
  type TparReport,
} from '../lib/api';
import { allEntries, csvMoney, entryCsvRows, toCsv } from '../lib/csv';
import { formatDay, today } from '../lib/dates';
import { onBooksChanged } from '../lib/live';
import { formatMoney } from '../lib/money';
import { printElement } from '../lib/print';
import { session } from '../lib/session';
import type { Cell } from '../shared/csv';
import { incomeYearLabel, incomeYearOf, incomeYearRange } from '../shared/incomeYear';

const router = useRouter();
const books = computed(() => session.books!);
const au = computed(() => books.value.country === 'AU');
const money = (v: number) => formatMoney(v, books.value.currency);
const km = (tenths: number) => (tenths / 10).toLocaleString(undefined, { maximumFractionDigits: 1 });
const ys = computed(() => books.value.fiscalYearStart);

const thisYear = incomeYearOf(today(), ys.value);
const year = ref(thisYear - 1);
const yearOptions = computed(() => [0, 1, 2, 3].map((i) => ({ label: incomeYearLabel(thisYear - i, ys.value), value: thisYear - i })));
const range = computed(() => incomeYearRange(year.value, ys.value));
const label = computed(() => incomeYearLabel(year.value, ys.value));

const ret = ref<IncomeReturnReport | null>(null);
const car = ref<CarYear | null>(null);
const instalments = ref<PaygReport | ProvisionalReport | null>(null);
const tpar = ref<TparReport | null>(null);
const assets = ref<{ limit: number; assets: AssetBought[]; writeOff: number; depreciate: number } | null>(null);
const loading = ref(false);
const sheet = ref<HTMLElement | null>(null);

async function load() {
  loading.value = true;
  try {
    const t = today();
    const [a, b, c, d, e] = await Promise.all([
      api.incomeReturnReport(range.value),
      api.carYear(year.value),
      au.value ? api.paygReport({ year: year.value, today: t }) : api.provisionalReport({ year: year.value, today: t }),
      au.value ? api.tparReport(year.value) : Promise.resolve(null),
      api.assetsBought(range.value),
    ]);
    ret.value = a;
    car.value = b;
    instalments.value = c;
    tpar.value = d;
    assets.value = e;
  } finally {
    loading.value = false;
  }
}
watch(year, load, { immediate: true });
onBooksChanged(load);

const yearOver = computed(() => today() > range.value.to);
const withheld = computed(() => (!au.value && instalments.value ? (instalments.value as ProvisionalReport).withheld : null));
const tparPaid = computed(() => tpar.value?.payees.filter((p) => p.gross) ?? []);

// ---- files -----------------------------------------------------------------------

async function saveFiles() {
  const folder = await tiny.dialog.pickFolder();
  if (!folder || !ret.value) return;
  const sep = folder.includes('\\') && !folder.includes('/') ? '\\' : '/';
  const safe = (s: string) => s.replace(/[\\/:*?"<>|]/g, '-');
  const dir = `${folder}${sep}${safe(`${books.value.name} year end ${label.value}`)}`;
  const r = ret.value;
  try {
    await api.makeDir(dir);
    const files: [string, Cell[][]][] = [
      [au.value ? 'Business schedule' : 'IR10 summary', [
        [au.value ? 'Label' : 'Box', 'Description', 'Category', 'Amount'],
        ...r.lines.flatMap((l) => [
          ...l.categories.map((c) => [l.code, l.label, c.name, csvMoney(c.total)]),
          ...l.notes.map((n) => [l.code, l.label, n, '']),
          [l.code, l.label, 'Total', csvMoney(l.total)],
        ]),
        ['', 'Opening stock', '', csvMoney(r.stock.opening)],
        ['', 'Closing stock', '', csvMoney(r.stock.closing)],
        ['', 'Total income', '', csvMoney(r.totals.income)],
        ['', 'Cost of sales', '', csvMoney(r.totals.costOfSales)],
        ['', 'Total expenses', '', csvMoney(r.totals.expenses)],
        ['', 'Net profit', '', csvMoney(r.totals.net)],
      ]],
      ['Trip log', [
        ['Date', 'Purpose', 'From', 'To', 'Vehicle', 'Km'],
        ...[...(car.value?.trips ?? [])].reverse().map((t) => [t.date, t.purpose, t.fromPlace ?? '', t.toPlace ?? '', t.vehicle ?? '', (t.distanceTenths / 10).toFixed(1)]),
        ['', 'Business km', '', '', '', ((car.value?.distanceTenths ?? 0) / 10).toFixed(1)],
        ...(car.value?.inputs.vehicleTotalTenths ? [['', 'Total km for the year', '', '', '', (car.value.inputs.vehicleTotalTenths / 10).toFixed(1)]] : []),
        ...(car.value?.businessPct != null ? [['', 'Business use', '', '', '', `${car.value.businessPct}%`]] : []),
      ]],
      [au.value ? 'PAYG instalments paid' : 'Provisional tax paid', [
        ['Date', 'Memo', 'Amount'],
        ...(instalments.value?.payments ?? []).map((p) => [p.date, p.memo ?? '', csvMoney(p.amount)]),
      ]],
      ...(withheld.value
        ? [['Tax withheld by clients', [['Client', 'Tax withheld'], ...withheld.value.byClient.map((c) => [c.name ?? '', csvMoney(c.amount)])]] as [string, Cell[][]]]
        : []),
      ...(tpar.value
        ? [['TPAR contractors', [
            ['ABN', 'Name', 'Address', 'Gross paid (incl. GST)', 'GST'],
            ...tparPaid.value.map((p) => [p.abn ?? '', p.legalName ?? p.name, p.address ?? '', csvMoney(p.gross), csvMoney(p.gst)]),
          ]] as [string, Cell[][]]]
        : []),
      ['Assets bought', [
        ['Date', 'Category', 'From', 'Memo', 'Cost', au.value ? 'Instant asset write-off' : 'Low-value asset'],
        ...(assets.value?.assets ?? []).map((a) => [a.date, a.category, a.contact ?? '', a.memo ?? '', csvMoney(a.cost), a.writeOff ? 'Yes' : 'No']),
      ]],
      ['Transactions', entryCsvRows(await allEntries({ from: range.value.from, to: range.value.to }))],
    ];
    for (const [name, rows] of files) await api.writeText(`${dir}${sep}${safe(`${name} ${label.value}`)}.csv`, toCsv(rows));
    toast({
      title: 'Year-end pack saved',
      content: `${files.length} files in ${dir.slice(dir.lastIndexOf(sep) + 1)}`,
      tone: 'success',
      actions: [{ label: 'Show', onAction: () => void tiny.app.shell.reveal(dir) }],
    });
  } catch (e) {
    toast({ title: "Couldn't save the pack", content: errorMessage(e), tone: 'error' });
  }
}
/** Every car's odometer total, when each has one. */
const carTotal = computed(() =>
  car.value && car.value.vehicles.every((v) => v.inputs.totalTenths) ? car.value.vehicles.reduce((t, v) => t + v.inputs.totalTenths!, 0) : 0);
</script>

<template>
  <Page
    title="Year-end pack"
    :breadcrumbs="[{ label: 'Reports', onAction: () => router.push('/reports') }]"
    size="fullWidth"
    :primary-action="{ label: 'Save files…', icon: 'mdi:folder-download-outline', onAction: saveFiles }"
    :secondary-actions="[{ label: 'Print / Save PDF', icon: 'mdi:printer-outline', onAction: () => printElement(sheet) }]"
  >
    <div class="Controls">
      <Select v-model="year" label="Income year" :options="yearOptions" />
    </div>

    <Banner v-if="!yearOver" status="info" title="This year isn't over yet" class="Gap">
      <p>The figures are up to today. Make the pack again after {{ formatDay(range.to) }}.</p>
    </Banner>
    <Banner v-if="ret?.unmapped.length" status="warning" :title="`Some categories aren't on ${au ? 'a P8 label' : 'an IR10 box'}`" class="Gap">
      <p>{{ ret.unmapped.map((u) => u.name).join(', ') }} are counted as other income or expenses. Map them in Categories.</p>
    </Banner>

    <Card>
      <CardSection>
        <div ref="sheet" :class="{ Loading: loading }">
          <div class="ReportHead">
            <h2>{{ books.name }}: Year-end pack, {{ label }}</h2>
            <p>{{ formatDay(range.from) }} – {{ formatDay(range.to) }} · {{ books.taxBasis === 'cash' ? 'Cash' : 'Accrual' }} basis{{ books.taxId ? ` · ${au ? 'ABN' : 'GST number'} ${books.taxId}` : '' }} · Made {{ formatDay(today()) }}</p>
          </div>

          <template v-if="ret">
            <h3>{{ au ? 'Business schedule (P8)' : 'IR10 summary' }}</h3>
            <table class="Report">
              <tbody>
                <tr v-for="l in ret.lines.filter((x) => x.kind === 'income')" :key="l.key"><td class="Line">{{ l.code }}</td><td>{{ l.label }}</td><td class="num">{{ money(l.total) }}</td></tr>
                <tr class="Report__total"><td /><td>Total income</td><td class="num">{{ money(ret.totals.income) }}</td></tr>
                <tr v-if="ret.totals.costOfSales"><td /><td>Cost of sales</td><td class="num">{{ money(ret.totals.costOfSales) }}</td></tr>
                <tr v-for="l in ret.lines.filter((x) => x.kind === 'expense' && !x.costOfSales)" :key="l.key">
                  <td class="Line">{{ l.code }}</td>
                  <td>{{ l.label }}<span class="subdued Small"> · {{ [...l.categories.map((c) => c.name), ...l.notes].join(', ') }}</span></td>
                  <td class="num">{{ money(l.total) }}</td>
                </tr>
                <tr class="Report__total"><td /><td>Total expenses</td><td class="num">{{ money(ret.totals.expenses) }}</td></tr>
                <tr class="Report__grand"><td /><td>Net profit or loss</td><td class="num">{{ money(ret.totals.net) }}</td></tr>
              </tbody>
            </table>
          </template>

          <h3>Car</h3>
          <p v-if="!car?.distanceTenths" class="subdued">No trips logged.</p>
          <p v-else>
            {{ km(car.distanceTenths) }} business km in {{ car.trips.length }} trips<template v-if="carTotal"> of {{ km(carTotal) }} km in all</template><template v-if="car.vehicles.length > 1"> across {{ car.vehicles.length }} vehicles</template><template v-if="car.businessPct != null"> ({{ car.businessPct }}% business use)</template>.
            Claimed {{ car.method === 'rate' ? `at the ${au ? 'cents per km' : 'kilometre'} rate: ${money(car.claim.deduction)}` : 'as actual costs at the business share' }}.
          </p>

          <h3>{{ au ? 'PAYG instalments paid' : 'Provisional tax paid' }}</h3>
          <p v-if="!instalments?.payments.length" class="subdued">None recorded.</p>
          <table v-else class="Report">
            <tbody>
              <tr v-for="p in instalments.payments" :key="p.id"><td>{{ formatDay(p.date) }}</td><td class="subdued">{{ p.memo }}</td><td class="num">{{ money(p.amount) }}</td></tr>
              <tr class="Report__total"><td colspan="2">Total</td><td class="num">{{ money(instalments.totalPaid) }}</td></tr>
            </tbody>
          </table>

          <template v-if="withheld">
            <h3>Tax withheld by clients</h3>
            <p v-if="!withheld.total" class="subdued">None recorded.</p>
            <table v-else class="Report">
              <tbody>
                <tr v-for="c in withheld.byClient" :key="c.id"><td>{{ c.name }}</td><td class="num">{{ money(c.amount) }}</td></tr>
                <tr class="Report__total"><td>Total (IR3 schedular payments, Box 12A)</td><td class="num">{{ money(withheld.total) }}</td></tr>
              </tbody>
            </table>
          </template>

          <template v-if="tpar">
            <h3>TPAR contractors</h3>
            <p v-if="!tparPaid.length" class="subdued">None paid this year.</p>
            <table v-else class="Report">
              <tbody>
                <tr v-for="p in tparPaid" :key="p.id">
                  <td>{{ p.legalName ?? p.name }}<span v-if="p.missing.length" class="negative Small"> · no {{ p.missing.join(' or ') }}</span></td>
                  <td class="num">{{ money(p.gross) }}</td>
                </tr>
              </tbody>
            </table>
          </template>

          <h3>Assets bought</h3>
          <p v-if="!assets?.assets.length" class="subdued">None in the equipment or asset categories.</p>
          <template v-else>
            <table class="Report">
              <tbody>
                <tr v-for="(a, i) in assets.assets" :key="i">
                  <td>{{ formatDay(a.date) }}</td>
                  <td>{{ a.memo || a.category }}<span class="subdued Small"> · {{ a.contact ?? a.category }}</span></td>
                  <td>{{ a.writeOff ? (au ? 'Write off now' : 'Low-value, expense it') : 'Depreciate' }}</td>
                  <td class="num">{{ money(a.cost) }}</td>
                </tr>
              </tbody>
            </table>
            <p class="subdued Small">
              {{ au ? `Instant asset write-off: each asset under ${money(assets.limit)}, first used or installed this year (turnover under $10 million).`
                : `Low-value assets: ${money(assets.limit)} or less. New assets first used from 22 May 2025 may also get Investment Boost (20%).` }}
            </p>
          </template>
          <p class="subdued Small no-print">
            Depreciation on everything you own is worked out in the <a href="#" @click.prevent="router.push('/assets')">asset register</a>.
          </p>

          <p class="subdued Note">
            <template v-if="au">Your agent may also ask for: bank statements, PAYG payment summaries, receipts for assets, your logbook, super contributions, private health insurance and last year's notice of assessment.</template>
            <template v-else>Your accountant may also ask for: bank statements, receipts for assets, your vehicle logbook, ACC invoices, home office measurements and last year's assessment.</template>
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
