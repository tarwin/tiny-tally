<script setup lang="ts">
// The asset register: what the business owns that lasts more than a year,
// with each income year's depreciation worked out by the country's rules
// (src/shared/depreciation.ts). Posting the year makes one journal, dated
// its last day, so the P&L, balance sheet and tax return lines include it
// (backend/assets.ts).
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  Badge,
  Banner,
  Button,
  Card,
  CardSection,
  DataTable,
  DatePicker,
  FormLayout,
  FormLayoutGroup,
  Modal,
  ModalSection,
  Page,
  Select,
  TextField,
  confirmModal,
  toast,
  type DataTableColumnType,
} from '@octans/ui';
import { api, errorMessage, type Asset, type AssetRegister, type AssetYearRow, type DepreciationMethod } from '../lib/api';
import { csvMoney, saveCsv } from '../lib/csv';
import { formatDay, today } from '../lib/dates';
import { onBooksChanged } from '../lib/live';
import { formatMoney, parseMoney, toInput } from '../lib/money';
import { session } from '../lib/session';
import { METHODS } from '../shared/depreciation';
import { incomeYearLabel, incomeYearOf } from '../shared/incomeYear';

const router = useRouter();
const books = computed(() => session.books!);
const country = computed(() => books.value.country as 'AU' | 'NZ' | 'US');
const money = (v: number) => formatMoney(v, books.value.currency);
const ys = computed(() => books.value.fiscalYearStart);
const yearWord = computed(() => (country.value === 'US' ? 'Tax year' : 'Income year'));
const thisYear = incomeYearOf(today(), ys.value);
// ?year= opens a particular income year (the screenshot tour shows last year's, posted).
const year = ref(Number(useRoute().query.year) || thisYear);
const yearOptions = computed(() => [0, 1, 2, 3, 4].map((i) => ({ label: incomeYearLabel(thisYear - i, ys.value), value: thisYear - i })));
const methods = computed(() => METHODS[country.value]);
const methodLabel = (m: DepreciationMethod) => methods.value.find((x) => x.value === m)?.label ?? m;
const registered = computed(() => books.value.taxEnabled && country.value !== 'US');
const words = computed(() => ({
  AU: { report: '/reports/income-tax-return', reportName: 'business schedule (P8, label M)', limitName: 'instant asset write-off' },
  NZ: { report: '/reports/income-tax-return', reportName: 'IR10 (box 13)', limitName: 'low-value asset limit' },
  US: { report: '/reports/schedule-c', reportName: 'Schedule C line 13 (Form 4562)', limitName: 'de minimis safe harbor' },
}[country.value]));

const data = ref<AssetRegister | null>(null);
const loading = ref(false);
async function load() {
  loading.value = true;
  try {
    data.value = await api.assetRegister(year.value);
  } catch (e) {
    toast({ title: errorMessage(e), tone: 'error' });
  } finally {
    loading.value = false;
  }
}
watch(year, load, { immediate: true });
onBooksChanged(load);

const columns: DataTableColumnType[] = [
  { key: 'name', label: 'Asset', minWidth: 180 },
  { key: 'method', label: 'Method', width: 160 },
  { key: 'opening', label: 'At start', width: 110 },
  { key: 'depreciation', label: 'Depreciation', width: 115 },
  { key: 'claimed', label: 'Claimed', width: 110 },
  { key: 'closing', label: 'At end', width: 110 },
];

// ---- posting the year ------------------------------------------------------------

const posting = ref(false);
async function post() {
  posting.value = true;
  try {
    const id = await api.postDepreciation(year.value);
    toast({ title: id ? `Depreciation for ${incomeYearLabel(year.value, ys.value)} posted` : 'Nothing to post: the journal was removed' });
    await load();
  } catch (e) {
    toast({ title: "Couldn't post it", content: errorMessage(e), tone: 'error' });
  } finally {
    posting.value = false;
  }
}

// ---- editor ----------------------------------------------------------------------

const editing = ref(false);
const saving = ref(false);
const blank = () => ({
  id: undefined as number | undefined,
  name: '',
  bought: today(),
  cost: '',
  businessPct: '100',
  method: methods.value[0].value as DepreciationMethod,
  lifeYears: '',
  ratePct: '',
  broughtIn: false,
  openingYear: thisYear as number,
  openingValue: '',
  categoryId: null as number | null,
  entryId: null as number | null,
  notes: '',
});
const form = ref(blank());
const needs = computed(() => methods.value.find((m) => m.value === form.value.method)?.needs);
const methodOptions = computed(() => methods.value.map((m) => ({ label: m.label, value: m.value, description: m.help })));

function openEditor(a?: Asset) {
  form.value = a
    ? {
        id: a.id, name: a.name, bought: a.bought, cost: toInput(a.cost, books.value.currency), businessPct: String(a.businessPct),
        method: a.method, lifeYears: a.lifeYears != null ? String(a.lifeYears) : '', ratePct: a.ratePct != null ? String(a.ratePct) : '',
        broughtIn: a.openingYear != null, openingYear: a.openingYear ?? thisYear, openingValue: a.openingValue != null ? toInput(a.openingValue, books.value.currency) : '',
        categoryId: a.categoryId, entryId: a.entryId, notes: a.notes ?? '',
      }
    : blank();
  editing.value = true;
}

/** From a purchase in the books: its date, cost (before GST when registered) and category. */
function fromPurchase(p: AssetRegister['purchases'][number]) {
  openEditor();
  const limit = data.value?.limit ?? 0;
  form.value = {
    ...form.value,
    name: p.memo || p.contact || p.category,
    bought: p.date,
    cost: toInput(p.cost, books.value.currency),
    categoryId: p.categoryId,
    entryId: p.entryId,
    method: (p.cost < limit ? methods.value[0].value : methods.value[1].value) as DepreciationMethod,
  };
}

async function save() {
  const f = form.value;
  const cost = parseMoney(f.cost, books.value.currency);
  saving.value = true;
  try {
    await api.saveAsset({
      id: f.id,
      name: f.name,
      bought: f.bought,
      cost: cost ?? 0,
      businessPct: Number(f.businessPct.replace('%', '')),
      method: f.method,
      lifeYears: needs.value === 'life' ? Number(f.lifeYears) : null,
      ratePct: needs.value === 'rate' ? Number(f.ratePct.replace('%', '')) : null,
      openingYear: f.broughtIn ? f.openingYear : null,
      openingValue: f.broughtIn ? parseMoney(f.openingValue, books.value.currency) : null,
      categoryId: f.categoryId,
      entryId: f.entryId,
      notes: f.notes,
    });
    editing.value = false;
    await load();
  } catch (e) {
    toast({ title: "Couldn't save the asset", content: errorMessage(e), tone: 'error' });
  } finally {
    saving.value = false;
  }
}

async function remove(a: Asset) {
  if (!(await confirmModal({
    title: `Delete ${a.name}?`,
    content: 'It comes out of the register. Post the years it was in again to update their depreciation.' + (a.saleEntryId ? ' The sale money recorded for it is deleted too.' : ''),
    primaryActionLabel: 'Delete', primaryActionType: 'destructive', secondaryActionLabel: 'Cancel',
  }))) return;
  try {
    await api.deleteAsset(a.id);
    await load();
  } catch (e) {
    toast({ title: "Couldn't delete it", content: errorMessage(e), tone: 'error' });
  }
}

// ---- sold or scrapped ----------------------------------------------------------------

const selling = ref<Asset | null>(null);
const sale = ref({ date: today(), amount: '', accountId: null as number | null });
const accounts = ref<{ label: string; value: number }[]>([]);
async function openSale(a: Asset) {
  const list = await api.listAccounts();
  accounts.value = list.filter((x) => !x.archived && !x.holds && x.kind !== 'credit_card').map((x) => ({ label: x.name, value: x.id }));
  sale.value = { date: a.sold ?? today(), amount: '', accountId: accounts.value[0]?.value ?? null };
  selling.value = a;
}
async function saveSale() {
  const a = selling.value!;
  try {
    await api.sellAsset({ id: a.id, date: sale.value.date, amount: parseMoney(sale.value.amount || '0', books.value.currency) ?? 0, accountId: sale.value.accountId });
    selling.value = null;
    await load();
  } catch (e) {
    toast({ title: "Couldn't record that", content: errorMessage(e), tone: 'error' });
  }
}
async function unsell(a: Asset) {
  await api.sellAsset({ id: a.id, date: null });
  await load();
}

function rowActions(r: AssetYearRow) {
  const a = r.asset;
  return [
    a.sold
      ? { label: 'Not sold after all', icon: 'mdi:undo', onAction: () => unsell(a) }
      : { label: 'Sold…', icon: 'mdi:cash-minus', onAction: () => openSale(a) },
    { label: 'Delete', icon: 'mdi:delete-outline', onAction: () => remove(a) },
  ];
}

function exportCsv() {
  const d = data.value;
  if (!d) return;
  const c = (v: number) => csvMoney(v);
  void saveCsv(`Asset register ${incomeYearLabel(d.year, ys.value)}`, [
    ['Asset', 'Bought', 'Cost', 'Method', 'Effective life / rate', 'Business use %', 'Value at start', 'Depreciation', 'Claimed', 'Value at end', 'Sold', 'Proceeds', 'Balancing adjustment (claimed)'],
    ...d.rows.map((r) => [
      r.name, r.asset.bought, c(r.asset.cost), methodLabel(r.method),
      r.asset.lifeYears ? `${r.asset.lifeYears} years` : r.asset.ratePct ? `${r.asset.ratePct}%` : '',
      String(r.asset.businessPct), c(r.opening), c(r.depreciation), c(r.claimed), c(r.closing),
      r.disposal?.date ?? '', r.disposal ? c(r.disposal.proceeds) : '', r.disposal ? c(r.disposal.claimed) : '',
    ]),
    ['Total', '', '', '', '', '', '', c(d.totals.depreciation), c(d.totals.claimed), c(d.totals.closing), '', '', c(d.totals.adjustment)],
  ]);
}
</script>

<template>
  <Page
    title="Assets"
    size="fullWidth"
    :primary-action="{ label: 'Add asset', icon: 'mdi:plus', onAction: () => openEditor() }"
    :secondary-actions="[{ label: 'Export CSV', icon: 'mdi:file-delimited-outline', onAction: exportCsv }]"
  >
    <div class="Controls">
      <Select v-model="year" :label="yearWord" :options="yearOptions" />
      <div v-if="data" class="Post">
        <Badge v-if="data.journal?.upToDate" status="success">Posted</Badge>
        <Badge v-else-if="data.journal" status="warning">Changed since it was posted</Badge>
        <Badge v-else-if="data.journalLines" status="info">Not posted</Badge>
        <Button v-if="data.journalLines || data.journal" :type="data.journal?.upToDate ? 'plain' : 'primary'" :disabled="posting" @click="post">
          {{ data.journal ? 'Post again' : `Post ${incomeYearLabel(year, ys)} depreciation` }}
        </Button>
      </div>
    </div>

    <Banner v-if="data?.unposted.length" status="warning" title="Earlier years aren't posted" class="Gap">
      <p>
        {{ data.unposted.map((y) => incomeYearLabel(y, ys)).join(', ') }}: post those first, so each year's figures are in the
        books in order.
      </p>
    </Banner>

    <Banner v-if="data?.purchases.length" status="info" title="Bought this year, not in the register" class="Gap">
      <p>
        {{ country === 'US' ? 'Bought as assets, to depreciate or expense through Form 4562.' : `Over the ${words.limitName} (${money(data.limit)}), so they're depreciated rather than written off at once.` }}
      </p>
      <div class="Purchases">
        <div v-for="p in data.purchases" :key="p.entryId" class="Purchase">
          <span>{{ formatDay(p.date) }} · {{ p.memo || p.contact || p.category }} · {{ money(p.cost) }}</span>
          <Button size="small" @click="fromPurchase(p)">Add to register</Button>
        </div>
      </div>
    </Banner>

    <div class="Tiles">
      <Card>
        <CardSection>
          <div class="subdued Small">Depreciation claimed</div>
          <div class="Big">{{ money(data?.totals.claimed ?? 0) }}</div>
          <div class="subdued Small">
            {{ data && data.totals.claimed !== data.totals.depreciation ? `Of ${money(data.totals.depreciation)}, at each asset's business use` : `On your ${words.reportName}` }}
          </div>
        </CardSection>
      </Card>
      <Card>
        <CardSection>
          <div class="subdued Small">Value left at year end</div>
          <div class="Big">{{ money(data?.totals.closing ?? 0) }}</div>
          <div class="subdued Small">{{ data?.rows.length ?? 0 }} {{ data?.rows.length === 1 ? 'asset' : 'assets' }} this year</div>
        </CardSection>
      </Card>
      <Card v-if="data?.totals.adjustment">
        <CardSection>
          <div class="subdued Small">{{ data.totals.adjustment > 0 ? 'Gain on assets sold' : 'Loss on assets sold' }}</div>
          <div class="Big">{{ money(Math.abs(data.totals.adjustment)) }}</div>
          <div class="subdued Small">
            {{ country === 'US' ? 'Goes on Form 4797' : data.totals.adjustment > 0 ? 'Income on your return' : 'A deduction on your return' }}
          </div>
        </CardSection>
      </Card>
      <Card>
        <CardSection>
          <div class="subdued Small">{{ country === 'US' ? 'De minimis safe harbor' : country === 'AU' ? 'Instant asset write-off' : 'Low-value assets' }}</div>
          <div class="Big">Under {{ money(data?.limit ?? 0) }}</div>
          <div class="subdued Small">{{ country === 'US' ? 'An item, expensed as supplies' : registered ? 'An asset, before GST' : 'An asset, including GST' }}</div>
        </CardSection>
      </Card>
    </div>

    <Card>
      <DataTable
        :columns="columns"
        :rows="data?.rows ?? []"
        :loading="loading"
        empty-text="No assets this year. Add equipment, computers, vehicles and furniture you bought for the business."
        :row-actions="rowActions"
        @click-row="(r: AssetYearRow) => openEditor(r.asset)"
      >
        <template #col:name="{ row }">
          <div>{{ row.name }} <Badge v-if="row.isNew" status="info">New</Badge></div>
          <div class="subdued Small">
            Bought {{ formatDay(row.asset.bought) }} for {{ money(row.asset.cost) }}<template v-if="row.asset.businessPct < 100"> · {{ row.asset.businessPct }}% business use</template>
            <template v-if="row.disposal"> · went {{ formatDay(row.disposal.date) }}{{ row.disposal.proceeds ? ` for ${money(row.disposal.proceeds)}` : '' }}</template>
          </div>
        </template>
        <template #col:method="{ row }">
          <div>{{ methodLabel(row.method) }}</div>
          <div class="subdued Small">{{ row.asset.lifeYears ? `${row.asset.lifeYears}-year life` : row.asset.ratePct ? `${row.asset.ratePct}%` : '' }}</div>
        </template>
        <template #col:opening="{ row }"><span class="money">{{ money(row.opening) }}</span></template>
        <template #col:depreciation="{ row }"><span class="money">{{ money(row.depreciation) }}</span></template>
        <template #col:claimed="{ row }">
          <span class="money">{{ money(row.claimed) }}</span>
          <div v-if="row.disposal" class="subdued Small money">{{ row.disposal.claimed >= 0 ? 'Gain' : 'Loss' }} {{ money(Math.abs(row.disposal.claimed)) }}</div>
        </template>
        <template #col:closing="{ row }"><span class="money">{{ row.disposal ? 'Sold' : money(row.closing) }}</span></template>
      </DataTable>
    </Card>

    <p v-if="data?.others.length" class="subdued Note">
      Also in the register, fully depreciated or gone: {{ data.others.map((a) => a.name).join(', ') }}.
    </p>
    <p class="subdued Note">
      <template v-if="country === 'AU'">
        Small businesses write off assets under the limit at once, and pool the rest (15% the first year, 30% after). Not using
        the simpler rules: diminishing value or prime cost over the ATO's effective life (TR 2022/1). Cars are depreciated only
        with the logbook method; cents per km already includes it.
      </template>
      <template v-else-if="country === 'NZ'">
        Assets under the limit are written off at once. Otherwise use IRD's rate for the asset (the depreciation rate finder
        on ird.govt.nz), diminishing value or straight line. There's no depreciation in the year it's sold. Vehicles on
        kilometre rates aren't depreciated separately.
      </template>
      <template v-else>
        Most small purchases can be expensed: section 179, bonus depreciation, or $2,500 an item under the de minimis safe
        harbor. Otherwise MACRS: 5-year for computers and vehicles, 7-year for furniture and most equipment. Not with the
        standard mileage rate, which includes depreciation.
      </template>
      Posting puts the year's figures on your <a href="#" @click.prevent="router.push(words.report)">{{ words.reportName }}</a>.
    </p>

    <Modal
      :visible="editing"
      :title="form.id ? 'Edit asset' : 'Add asset'"
      :loading="saving"
      :primary-action="{ label: form.id ? 'Save' : 'Add asset', onAction: save }"
      :secondary-actions="[{ label: 'Cancel', onAction: () => (editing = false) }]"
      @close="editing = false"
    >
      <ModalSection>
        <FormLayout>
          <TextField v-model="form.name" label="What it is" placeholder="e.g. MacBook Pro, Ute, Office desk" required />
          <FormLayoutGroup>
            <DatePicker v-model="form.bought" type="date" model-format="YYYY-MM-DD" :label="country === 'US' ? 'Placed in service' : 'First used'" />
            <TextField v-model="form.cost" label="Cost" :prefix="books.currency" align="right" :help-text="registered ? 'Before GST' : undefined" />
            <TextField v-model="form.businessPct" label="Business use" suffix="%" />
          </FormLayoutGroup>
          <Select v-model="form.method" label="Depreciation" :options="methodOptions" show-description />
          <TextField v-if="needs === 'life'" v-model="form.lifeYears" label="Effective life (years)" inputmode="decimal"
            :help-text="country === 'AU' ? 'From the ATO\'s effective life tables, e.g. computers 4, desks 10, cars 8.' : 'The recovery period, e.g. 5 or 7 years.'" />
          <TextField v-if="needs === 'rate'" v-model="form.ratePct" label="IRD rate" suffix="%" inputmode="decimal"
            help-text="From IRD's depreciation rate finder, e.g. laptops 50% DV, office furniture 16% DV." />
          <Select
            v-model="form.broughtIn"
            label="Bought before these books"
            :options="[{ label: 'No: the cost is in these books', value: false }, { label: 'Yes: start from its value then', value: true }]"
          />
          <FormLayoutGroup v-if="form.broughtIn">
            <Select v-model="form.openingYear" :label="`From ${yearWord.toLowerCase()}`" :options="yearOptions" />
            <TextField v-model="form.openingValue" label="Its value at the start of that year" :prefix="books.currency" align="right" help-text="The value left for tax, from last year's return." />
          </FormLayoutGroup>
          <TextField v-model="form.notes" label="Notes" placeholder="Serial number, where it is…" />
        </FormLayout>
      </ModalSection>
    </Modal>

    <Modal
      :visible="!!selling"
      :title="`${selling?.name ?? ''}: sold or scrapped`"
      :primary-action="{ label: 'Save', onAction: saveSale }"
      :secondary-actions="[{ label: 'Cancel', onAction: () => (selling = null) }]"
      @close="selling = null"
    >
      <ModalSection>
        <FormLayout>
          <FormLayoutGroup>
            <DatePicker v-model="sale.date" type="date" model-format="YYYY-MM-DD" label="When it went" />
            <TextField v-model="sale.amount" label="Money received" :prefix="books.currency" align="right" placeholder="0" :help-text="registered ? 'Including GST' : 'Nothing if it was scrapped'" />
          </FormLayoutGroup>
          <Select v-if="sale.amount" v-model="sale.accountId" label="Into" :options="accounts" />
          <p class="subdued Small">
            The money is recorded as income in Asset Sales{{ registered ? ', with GST' : '' }}. Posting the year then works out the
            gain or loss against the value left.
          </p>
        </FormLayout>
      </ModalSection>
    </Modal>
  </Page>
</template>

<style scoped>
.Controls {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 16px;
  margin-bottom: 16px;
}

.Controls > :first-child {
  min-width: 160px;
}

.Post {
  display: flex;
  align-items: center;
  gap: 12px;
}

.Gap {
  margin-bottom: 16px;
}

.Gap p {
  margin: 0 0 8px;
}

.Purchases {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.Purchase {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.Tiles {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 16px;
  margin-bottom: 16px;
}

.Big {
  font-size: 22px;
  font-weight: 600;
  margin: 4px 0;
  font-variant-numeric: tabular-nums;
}

.Small {
  font-size: 12px;
}

.Note {
  margin: 12px 0 0;
  font-size: 12px;
}
</style>
