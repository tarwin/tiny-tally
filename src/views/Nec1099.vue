<script setup lang="ts">
// Form 1099-NEC (US): who you paid $2,000 or more for services in a year
// ($600 before 2026), from the vendors marked as 1099 payees, with what's
// missing from their W-9 details. Nothing is filed from here: copy the figures
// into IRIS or a filing service, or send the CSV.
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Banner, Card, CardSection, DataTable, Page, Select, type DataTableColumnType } from '@octans/ui';
import { api, type Nec1099Payee, type Nec1099Report } from '../lib/api';
import { csvMoney, saveCsv } from '../lib/csv';
import { formatDay } from '../lib/dates';
import { onBooksChanged } from '../lib/live';
import { formatMoney } from '../lib/money';
import { printElement } from '../lib/print';
import { session } from '../lib/session';
import { US_STATE_MAP } from '../shared/usStates';

const router = useRouter();
const books = computed(() => session.books!);
const money = (v: number) => formatMoney(v, books.value.currency);

const now = new Date();
// 1099s for last year are due at the end of January, so that's the year to show early on.
const year = ref(now.getMonth() < 3 ? now.getFullYear() - 1 : now.getFullYear());
const yearOptions = [0, 1, 2, 3].map((i) => ({ label: String(now.getFullYear() - i), value: now.getFullYear() - i }));
const report = ref<Nec1099Report | null>(null);
const loading = ref(false);
const sheet = ref<HTMLElement | null>(null);

async function load() {
  loading.value = true;
  try {
    report.value = await api.nec1099Report(year.value);
  } finally {
    loading.value = false;
  }
}
watch(year, load, { immediate: true });
onBooksChanged(load);

/** Last four only on screen and paper. */
const maskTin = (tin: string | null) => (tin ? `•••••${tin.replace(/\D/g, '').slice(-4)}` : '');

const columns: DataTableColumnType[] = [
  { key: 'name', label: 'Payee', minWidth: 220 },
  { key: 'tin', label: 'TIN', width: 110 },
  { key: 'paid', label: 'Paid (box 1)', width: 140 },
  { key: 'byCard', label: 'By card', width: 120 },
  { key: 'needsForm', label: '', width: 200 },
];

const needing = computed(() => report.value?.payees.filter((p) => p.needsForm) ?? []);
const incomplete = computed(() => needing.value.filter((p) => p.missing.length));

function exportCsv() {
  const r = report.value;
  if (!r) return;
  void saveCsv(`1099-NEC ${r.year}`, [
    ['Recipient TIN', 'Recipient name', 'Business name', 'Address', 'State', 'Email', 'Box 1 nonemployee compensation', 'Paid by card (not included)', 'Needs a 1099'],
    ...r.payees.map((p) => [
      p.tin ?? '',
      p.legalName ?? p.name,
      p.legalName && p.legalName !== p.name ? p.name : '',
      p.address ?? '',
      p.state ?? '',
      p.email ?? '',
      csvMoney(p.paid),
      csvMoney(p.byCard),
      p.needsForm ? 'Yes' : 'No',
    ]),
  ]);
}

function status(p: Nec1099Payee) {
  if (!p.needsForm) return { text: `Under ${money(report.value!.threshold)}`, tone: 'subdued' };
  if (p.missing.length) return { text: `Needs a 1099 · no ${p.missing.join(' or ')}`, tone: 'negative' };
  return { text: 'Needs a 1099', tone: '' };
}
</script>

<template>
  <Page
    title="1099-NEC"
    :breadcrumbs="[{ label: 'Reports', onAction: () => router.push('/reports') }]"
    size="fullWidth"
    :primary-action="{ label: 'Export CSV', icon: 'mdi:file-delimited-outline', onAction: exportCsv }"
    :secondary-actions="[{ label: 'Print / Save PDF', icon: 'mdi:printer-outline', onAction: () => printElement(sheet) }]"
  >
    <div class="Controls">
      <Select v-model="year" label="Tax year" :options="yearOptions" />
    </div>

    <Banner v-if="report && report.status !== 'checked'" status="warning" title="This year's 1099 threshold hasn't been checked" class="Gap">
      <p>
        Tiny Tally is using {{ money(report.threshold) }}, the latest amount it knows. From 2027 the IRS adjusts it for
        inflation each year: check the Instructions for Form 1099-NEC, or update the app.
      </p>
    </Banner>
    <Banner v-if="report && !report.payer.tin" status="warning" title="Add your EIN or SSN" class="Gap">
      <p>The payer's TIN goes on every 1099. Add it in Settings (your EIN, or your SSN if you don't have one).</p>
    </Banner>
    <Banner v-if="incomplete.length" status="critical" :title="`${incomplete.length} ${incomplete.length === 1 ? 'payee is' : 'payees are'} missing W-9 details`" class="Gap">
      <p>Ask them for a Form W-9, then add their TIN and address on the contact.</p>
    </Banner>

    <Card>
      <CardSection>
        <div ref="sheet" :class="{ Loading: loading }">
          <div class="ReportHead">
            <h2>{{ books.name }}: Form 1099-NEC, {{ year }}</h2>
            <p v-if="report">
              Payees paid {{ money(report.threshold) }} or more for services. Due to them and the IRS by {{ formatDay(report.due) }}.
            </p>
          </div>
          <DataTable :columns="columns" :rows="report?.payees ?? []" :loading="loading" empty-text="No vendors are marked as getting a 1099. Mark them on the contact.">
            <template #col:name="{ row }">
              <div>{{ row.legalName ?? row.name }}</div>
              <div class="subdued Small">
                {{ [row.legalName && row.legalName !== row.name ? row.name : '', row.address?.split('\n').join(', '), row.state ? US_STATE_MAP[row.state]?.name : ''].filter(Boolean).join(' · ') }}
              </div>
            </template>
            <template #col:tin="{ row }">{{ maskTin(row.tin) }}</template>
            <template #col:paid="{ row }"><span class="money">{{ money(row.paid) }}</span></template>
            <template #col:byCard="{ row }"><span class="money subdued">{{ row.byCard ? money(row.byCard) : '' }}</span></template>
            <template #col:needsForm="{ row }">
              <span :class="status(row).tone">{{ status(row).text }}</span>
            </template>
          </DataTable>
          <p class="subdued Note">
            Payments made in {{ year }} from bank and cash accounts. Payments by credit card or a payment app (PayPal,
            Venmo for business) are left out: the card company or app reports them on a 1099-K. Corporations usually don't
            get a 1099-NEC, except for legal services.
          </p>
          <p v-if="report" class="subdued Note">
            Threshold and due date checked {{ formatDay(report.checked) }}. Payer: {{ report.payer.name }}{{ report.payer.tin ? `, TIN ${maskTin(report.payer.tin)}` : '' }}.
          </p>
        </div>
      </CardSection>
    </Card>

    <Card v-if="report?.suggested.length" title="May need a 1099" class="Gap Top">
      <CardSection>
        <p class="subdued Note First">
          Not marked as getting a 1099, but paid {{ money(report.threshold) }} or more for contract labor, professional
          services, commissions, repairs or advertising. Mark them on the contact if they're a person or partnership.
        </p>
        <ul class="Suggested">
          <li v-for="s in report.suggested" :key="s.id">
            <a href="#" @click.prevent="router.push('/contacts')">{{ s.name }}</a>
            <span class="subdued"> · {{ money(s.forServices) }} for services, {{ money(s.paid) }} in all</span>
          </li>
        </ul>
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

.Top {
  margin-top: 16px;
}

.Gap p {
  margin: 0;
}

.Loading {
  opacity: 0.6;
  transition: opacity 0.15s;
}

.Small {
  font-size: 12px;
}

.negative {
  color: var(--octans-text-error);
}

.Note {
  margin: 16px 0 0;
  font-size: 12px;
}

.First {
  margin-top: 0;
}

.Suggested {
  margin: 12px 0 0;
  padding-left: 18px;
}
</style>
