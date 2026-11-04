<script setup lang="ts">
// The trip log: business trips with their purpose, as the tax office wants
// them recorded, in miles (US) or km. What they're worth depends on the
// country: the IRS standard mileage rate for the day (it can change
// mid-year), Australia's cents per km (up to 5,000 km), New Zealand's
// two-tier kilometre rates. With the year's total distance from the
// odometer, it also gives the car's business-use share, for claiming actual
// costs (a logbook).
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import {
  Banner,
  Card,
  CardSection,
  DataTable,
  DatePicker,
  FormLayout,
  FormLayoutGroup,
  Modal,
  ModalSection,
  Page,
  SegmentedControl,
  Select,
  TextField,
  confirmModal,
  toast,
  type DataTableColumnType,
} from '@octans/ui';
import { api, errorMessage, type CarYear, type Fuel, type Trip } from '../lib/api';
import { csvMoney, saveCsv } from '../lib/csv';
import { formatDay, today } from '../lib/dates';
import { onBooksChanged } from '../lib/live';
import { formatMoney } from '../lib/money';
import { session } from '../lib/session';
import { incomeYearLabel, incomeYearOf } from '../shared/incomeYear';

const router = useRouter();
const books = computed(() => session.books!);
const country = computed(() => books.value.country);
const money = (v: number) => formatMoney(v, books.value.currency);
const dist = (tenths: number) => (tenths / 10).toLocaleString(undefined, { maximumFractionDigits: 1 });
const cents = (tenthsOfCent: number) => `${(tenthsOfCent / 10).toLocaleString(undefined, { maximumFractionDigits: 1 })}¢`;

const unit = computed(() => (country.value === 'US' ? 'miles' : 'km'));
const words = computed(() => ({
  US: { title: 'Mileage', rate: 'Standard mileage rate', actual: 'Actual car costs', uses: 'Schedule C line 9 uses', report: '/reports/schedule-c', reportName: 'Schedule C', authority: 'the IRS' },
  AU: { title: 'Car trips', rate: 'Cents per km', actual: 'Logbook (actual costs)', uses: 'Motor vehicle expenses use', report: '/reports/income-tax-return', reportName: 'Business schedule', authority: 'the ATO' },
  NZ: { title: 'Vehicle trips', rate: 'Kilometre rates', actual: 'Actual costs (logbook)', uses: 'Vehicle expenses use', report: '/reports/income-tax-return', reportName: 'IR10', authority: 'IRD' },
}[country.value as 'US' | 'AU' | 'NZ']));

const ys = computed(() => books.value.fiscalYearStart);
const thisYear = incomeYearOf(today(), ys.value);
const year = ref(thisYear);
const yearOptions = computed(() => [0, 1, 2, 3].map((i) => ({ label: incomeYearLabel(thisYear - i, ys.value), value: thisYear - i })));
const data = ref<CarYear | null>(null);
const loading = ref(false);

// The year's inputs, as typed.
const typed = ref<Record<string, { total: string; pct: string }>>({});

async function load() {
  loading.value = true;
  try {
    data.value = await api.carYear(year.value);
    typed.value = Object.fromEntries(data.value.vehicles.map((v) => [v.name, {
      total: v.inputs.totalTenths ? String(v.inputs.totalTenths / 10) : '',
      pct: v.inputs.businessPct != null ? String(v.inputs.businessPct) : '',
    }]));
  } finally {
    loading.value = false;
  }
}
watch(year, load, { immediate: true });
onBooksChanged(load);

async function setInputs(p: Parameters<typeof api.setYearInputs>[0]) {
  try {
    await api.setYearInputs(p);
    await load();
  } catch (e) {
    toast({ title: "Couldn't save that", content: errorMessage(e), tone: 'error' });
  }
}
const setMethod = (v: 'rate' | 'actual') => setInputs({ year: year.value, vehicleMethod: v });
// Each car has its own odometer total, logbook share and fuel.
const setFuel = (vehicle: string, v: Fuel) => setInputs({ year: year.value, vehicle, vehicleFuel: v });
function saveTotal(vehicle: string) {
  const t = typed.value[vehicle]?.total ?? '';
  const n = Number(t.replace(/,/g, ''));
  void setInputs({ year: year.value, vehicle, vehicleTotalTenths: t.trim() && Number.isFinite(n) ? Math.round(n * 10) : null });
}
function savePct(vehicle: string) {
  const t = typed.value[vehicle]?.pct ?? '';
  const n = Number(t.replace('%', ''));
  void setInputs({ year: year.value, vehicle, vehicleBusinessPct: t.trim() && Number.isFinite(n) ? n : null });
}
const vehicleName = (name: string) => name || (data.value && data.value.vehicles.length > 1 ? 'No vehicle named' : 'The car');

const fuelOptions = [
  { label: 'Petrol', value: 'petrol' },
  { label: 'Diesel', value: 'diesel' },
  { label: 'Petrol hybrid', value: 'hybrid' },
  { label: 'Electric', value: 'electric' },
];

const columns = computed<DataTableColumnType[]>(() => [
  { key: 'date', label: 'Date', width: 120 },
  { key: 'purpose', label: 'Purpose', minWidth: 220 },
  { key: 'distanceTenths', label: country.value === 'US' ? 'Miles' : 'Km', width: 100 },
  { key: 'rate', label: country.value === 'NZ' ? 'Tier 1 rate' : 'Rate', width: 100 },
  { key: 'value', label: 'At the rate', width: 120 },
]);

// ---- editor -------------------------------------------------------------------------

const editing = ref(false);
const saving = ref(false);
const form = ref({ id: undefined as number | undefined, date: today(), distance: '', purpose: '', fromPlace: '', toPlace: '', vehicle: '', roundTrip: false });
const errors = ref<{ distance?: string; purpose?: string }>({});
let lastVehicle = '';

function openEditor(t?: Trip) {
  errors.value = {};
  const vehicles = [...new Set(data.value?.trips.map((x) => x.vehicle).filter((v): v is string => !!v) ?? [])];
  form.value = t
    ? { id: t.id, date: t.date, distance: String(t.distanceTenths / 10), purpose: t.purpose, fromPlace: t.fromPlace ?? '', toPlace: t.toPlace ?? '', vehicle: t.vehicle ?? '', roundTrip: false }
    : { id: undefined, date: today(), distance: '', purpose: '', fromPlace: '', toPlace: '', vehicle: lastVehicle || vehicles[0] || '', roundTrip: false };
  editing.value = true;
}

async function save() {
  const m = Number(form.value.distance.replace(/,/g, ''));
  errors.value = {
    ...(Number.isFinite(m) && m > 0 ? {} : { distance: `Enter the ${unit.value} driven.` }),
    ...(form.value.purpose.trim() ? {} : { purpose: 'Say what the trip was for.' }),
  };
  if (errors.value.distance || errors.value.purpose) return;
  saving.value = true;
  try {
    const tenths = Math.round(m * 10) * (form.value.roundTrip ? 2 : 1);
    await api.saveTrip({
      id: form.value.id,
      date: form.value.date,
      distanceTenths: tenths,
      purpose: form.value.purpose,
      fromPlace: form.value.fromPlace,
      toPlace: form.value.toPlace,
      vehicle: form.value.vehicle,
    });
    lastVehicle = form.value.vehicle;
    editing.value = false;
    await load();
  } catch (e) {
    toast({ title: "Couldn't save the trip", content: errorMessage(e), tone: 'error' });
  } finally {
    saving.value = false;
  }
}

async function remove(t: Trip) {
  if (!(await confirmModal({ title: 'Delete this trip?', content: `${dist(t.distanceTenths)} ${unit.value} on ${formatDay(t.date)}: ${t.purpose}`, primaryActionLabel: 'Delete', primaryActionType: 'destructive', secondaryActionLabel: 'Cancel' }))) return;
  await api.deleteTrip(t.id);
  await load();
}

function rowActions(t: Trip) {
  return [
    { label: 'Edit', icon: 'mdi:pencil-outline', onAction: () => openEditor(t) },
    { label: 'Duplicate', icon: 'mdi:content-copy', onAction: () => { openEditor(t); form.value.id = undefined; form.value.date = today(); } },
    { label: 'Delete', icon: 'mdi:delete-outline', onAction: () => remove(t) },
  ];
}

function exportCsv() {
  const d = data.value;
  if (!d) return;
  const u = country.value === 'US' ? 'Miles' : 'Km';
  void saveCsv(`${words.value.title} ${incomeYearLabel(year.value, ys.value)}`, [
    ['Date', 'Purpose', 'From', 'To', 'Vehicle', u, `Rate (cents a ${country.value === 'US' ? 'mile' : 'km'})`, 'At the rate'],
    ...[...d.trips].reverse().map((t) => [t.date, t.purpose, t.fromPlace ?? '', t.toPlace ?? '', t.vehicle ?? '', (t.distanceTenths / 10).toFixed(1), (t.rate / 10).toFixed(1), csvMoney(Math.round((t.distanceTenths * t.rate) / 100))]),
    ['', 'Total', '', '', '', (d.distanceTenths / 10).toFixed(1), '', csvMoney(d.claim.deduction)],
    ...(d.inputs.vehicleTotalTenths ? [['', `Total ${u.toLowerCase()} for the year (odometer)`, '', '', '', (d.inputs.vehicleTotalTenths / 10).toFixed(1), '', '']] : []),
    ...(d.businessPct != null ? [['', 'Business use', '', '', '', `${d.businessPct}%`, '', '']] : []),
  ]);
}
</script>

<template>
  <Page
    :title="words.title"
    size="fullWidth"
    :primary-action="{ label: 'Add trip', icon: 'mdi:plus', onAction: () => openEditor() }"
    :secondary-actions="[{ label: 'Export CSV', icon: 'mdi:file-delimited-outline', onAction: exportCsv }]"
  >
    <div class="Controls">
      <Select v-model="year" :label="country === 'US' ? 'Tax year' : 'Income year'" :options="yearOptions" />
      <div>
        <div class="Label">{{ words.uses }}</div>
        <SegmentedControl
          :model-value="data?.method ?? 'rate'"
          :options="[{ label: words.rate, value: 'rate' }, { label: words.actual, value: 'actual' }]"
          @update:model-value="setMethod"
        />
      </div>
    </div>

    <Banner v-if="data && data.claim.status !== 'checked'" status="warning" title="This year's rate hasn't been checked" class="Gap">
      <p>Tiny Tally is using the latest rate it knows. Update the app once {{ words.authority }} sets the rate for {{ incomeYearLabel(year, ys) }}.</p>
    </Banner>
    <Banner v-if="data?.claim.capped" status="info" title="Over 5,000 km" class="Gap">
      <p>Cents per km covers up to 5,000 business km a car. Past that, the logbook method may claim more.</p>
    </Banner>

    <div class="Tiles">
      <Card>
        <CardSection>
          <div class="subdued Small">Business {{ unit }}</div>
          <div class="Big">{{ dist(data?.distanceTenths ?? 0) }}</div>
          <div class="subdued Small">{{ data?.trips.length ?? 0 }} trips</div>
        </CardSection>
      </Card>
      <Card>
        <CardSection>
          <div class="subdued Small">At the {{ words.rate.toLowerCase() }}</div>
          <div class="Big">{{ money(data?.claim.deduction ?? 0) }}</div>
          <div class="subdued Small">
            <template v-if="country === 'NZ' && data">
              Tier 1 {{ cents(data.claim.rates[0].tenthsOfCent) }} on {{ dist(data.claim.tier1Tenths ?? 0) }} km<template v-if="data.claim.tier2Tenths">, Tier 2 {{ cents(data.claim.rates[1].tenthsOfCent) }} on {{ dist(data.claim.tier2Tenths) }} km</template>
            </template>
            <template v-else-if="data">{{ data.claim.rates.map((r) => `${cents(r.tenthsOfCent)} ${r.label.toLowerCase()}`).join(', then ') }}</template>
          </div>
        </CardSection>
      </Card>
      <Card v-if="country !== 'US'">
        <CardSection>
          <div class="subdued Small">Business use</div>
          <div class="Big">{{ data?.businessPct != null ? `${data.businessPct}%` : '–' }}</div>
          <div class="subdued Small">{{ data && data.vehicles.length > 1 ? 'All the cars together' : data?.loggedPct != null ? `${data.loggedPct}% from the trips logged` : 'Enter the year’s total km to work it out' }}</div>
        </CardSection>
      </Card>
    </div>

    <Card v-if="country !== 'US' && data" class="Gap">
      <CardSection
        v-for="v in data.vehicles"
        :key="v.name"
        :title="`${vehicleName(v.name)} this year`"
      >
        <p v-if="data.vehicles.length > 1" class="subdued Small Vehicle">
          {{ dist(v.distanceTenths) }} business km in {{ v.trips }} trips · {{ money(v.claim.deduction) }} at the rate{{ v.claim.capped ? ' (5,000 km most)' : '' }}{{ v.businessPct != null ? ` · ${v.businessPct}% business use` : '' }}
        </p>
        <FormLayout v-if="typed[v.name]">
          <FormLayoutGroup>
            <TextField
              v-model="typed[v.name].total"
              label="Total km driven in the year"
              inputmode="decimal"
              :help-text="country === 'NZ' ? 'From the odometer, private km too. Tier 1 covers the business share of the first 14,000 km.' : 'From the odometer at the start and end of the year, private km too.'"
              @blur="saveTotal(v.name)"
              @keydown.enter="saveTotal(v.name)"
            />
            <TextField
              v-model="typed[v.name].pct"
              label="Business use from your logbook"
              suffix="%"
              :placeholder="v.loggedPct != null ? String(v.loggedPct) : ''"
              :help-text="country === 'AU' ? 'A 12-week logbook sets it for 5 years.' : 'A 90-day logbook sets it for 3 years.'"
              @blur="savePct(v.name)"
              @keydown.enter="savePct(v.name)"
            />
            <Select v-if="country === 'NZ'" :model-value="v.inputs.fuel ?? 'petrol'" label="Fuel" :options="fuelOptions" @update:model-value="(f: Fuel) => setFuel(v.name, f)" />
          </FormLayoutGroup>
        </FormLayout>
      </CardSection>
      <CardSection v-if="data.vehicles.length > 1 && data.method === 'actual'">
        <p class="subdued Small Vehicle">
          Car costs aren't split by vehicle, so actual costs are claimed at the cars' combined business use ({{ data.businessPct ?? '–' }}%).
          For an exact claim, give each car its own expense category and use its own share.
        </p>
      </CardSection>
    </Card>

    <Card>
      <DataTable
        :columns="columns"
        :rows="data?.trips ?? []"
        :loading="loading"
        :empty-text="`No trips this year. Add each business trip as you go: the date, where, why and the ${unit}.`"
        :row-actions="rowActions"
        @click-row="(row: Trip) => openEditor(row)"
      >
        <template #col:date="{ row }">{{ formatDay(row.date) }}</template>
        <template #col:purpose="{ row }">
          <div>{{ row.purpose }}</div>
          <div class="subdued Small">{{ [row.fromPlace && row.toPlace ? `${row.fromPlace} → ${row.toPlace}` : row.fromPlace || row.toPlace, row.vehicle].filter(Boolean).join(' · ') }}</div>
        </template>
        <template #col:distanceTenths="{ row }"><span class="money">{{ dist(row.distanceTenths) }}</span></template>
        <template #col:rate="{ row }"><span class="subdued">{{ cents(row.rate) }}</span></template>
        <template #col:value="{ row }"><span class="money">{{ money(row.value) }}</span></template>
      </DataTable>
    </Card>
    <p class="subdued Note">
      <template v-if="country === 'US'">
        The standard mileage rate covers gas, repairs, insurance and depreciation, so those aren't deducted as well; parking
        and tolls are. You have to choose it in the first year you use the car for business. Commuting from home to a
        regular workplace isn't business mileage.
      </template>
      <template v-else-if="country === 'AU'">
        Cents per km covers all the car's costs, including depreciation, for up to 5,000 business km. With a logbook (12
        continuous weeks, good for 5 years) you claim the business share of actual costs instead. Keep the odometer
        readings either way. Travel between home and a regular workplace is private.
      </template>
      <template v-else>
        Kilometre rates include depreciation, so don't claim it as well, and once you choose a method for a vehicle you
        keep it. Without a logbook (90 days, good for 3 years) a sole trader can claim at most 25% of running costs.
        Travel between home and a regular workplace is private.
      </template>
      <a href="#" @click.prevent="router.push(words.report)">{{ words.reportName }}</a>
    </p>

    <Modal
      :visible="editing"
      :title="form.id ? 'Edit trip' : 'Add trip'"
      :loading="saving"
      :primary-action="{ label: form.id ? 'Save' : 'Add trip', onAction: save }"
      :secondary-actions="[{ label: 'Cancel', onAction: () => (editing = false) }]"
      @close="editing = false"
    >
      <ModalSection>
        <FormLayout>
          <FormLayoutGroup>
            <DatePicker v-model="form.date" type="date" model-format="YYYY-MM-DD" label="Date" />
            <TextField v-model="form.distance" :label="country === 'US' ? 'Miles' : 'Km'" inputmode="decimal" :error="errors.distance" />
          </FormLayoutGroup>
          <TextField v-model="form.purpose" label="Business purpose" placeholder="e.g. Site visit for the Lee kitchen job" required :error="errors.purpose" />
          <FormLayoutGroup>
            <TextField v-model="form.fromPlace" label="From" placeholder="Office" />
            <TextField v-model="form.toPlace" label="To" placeholder="Client, supplier…" />
          </FormLayoutGroup>
          <FormLayoutGroup>
            <TextField v-model="form.vehicle" label="Vehicle" :placeholder="country === 'US' ? 'e.g. 2021 RAV4' : 'e.g. RAV4, ABC123'" />
            <div v-if="!form.id" class="RoundTrip">
              <SegmentedControl v-model="form.roundTrip" :options="[{ label: 'One way', value: false }, { label: 'Round trip (×2)', value: true }]" />
            </div>
          </FormLayoutGroup>
        </FormLayout>
      </ModalSection>
    </Modal>
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
  margin: 0;
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

.Vehicle {
  margin: 0 0 12px;
}

.RoundTrip {
  display: flex;
  align-items: flex-end;
}
</style>
