<script setup lang="ts">
// Australia's taxable payments annual report: what was paid in the income
// year to each contractor marked for it (on the contact), with the GST, from
// the money that actually went out. Due 28 August. Also flags payments to
// contractors with no ABN, which may have needed 47% withheld.
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Banner, Button, Card, CardSection, DataTable, Page, Select, type DataTableColumnType } from '@octans/ui';
import { api, type TparReport } from '../lib/api';
import { saveCsv } from '../lib/csv';
import { formatDay, today } from '../lib/dates';
import { onBooksChanged } from '../lib/live';
import { formatMoney } from '../lib/money';
import { printElement } from '../lib/print';
import { session } from '../lib/session';
import { incomeYearLabel, incomeYearOf } from '../shared/incomeYear';

const router = useRouter();
const books = computed(() => session.books!);
const money = (v: number) => formatMoney(v, books.value.currency);
const ys = computed(() => books.value.fiscalYearStart);
const thisYear = incomeYearOf(today(), ys.value);
const year = ref(thisYear - 1);
const yearOptions = computed(() => [0, 1, 2, 3].map((i) => ({ label: incomeYearLabel(thisYear - i, ys.value), value: thisYear - i })));
const report = ref<TparReport | null>(null);
const noAbn = ref<{ id: number; name: string; payments: number; gross: number }[]>([]);
const loading = ref(false);
const sheet = ref<HTMLElement | null>(null);

async function load() {
  loading.value = true;
  try {
    report.value = await api.tparReport(year.value);
    noAbn.value = await api.noAbnPayments({ from: report.value.from, to: report.value.to });
  } finally {
    loading.value = false;
  }
}
watch(year, load, { immediate: true });
onBooksChanged(load);

const columns: DataTableColumnType[] = [
  { key: 'name', label: 'Contractor', minWidth: 200 },
  { key: 'abn', label: 'ABN', width: 150 },
  { key: 'gross', label: 'Paid (with GST)', width: 150 },
  { key: 'gst', label: 'GST', width: 110 },
  { key: 'missing', label: '', width: 180 },
];
const paid = computed(() => report.value?.payees.filter((p) => p.gross) ?? []);
const incomplete = computed(() => paid.value.filter((p) => p.missing.length));
/** The ATO wants whole dollars. */
const dollars = (cents: number) => String(Math.round(cents / 100));

function exportCsv() {
  const r = report.value;
  if (!r) return;
  void saveCsv(`TPAR ${incomeYearLabel(r.year, ys.value)}`, [
    ['ABN', 'Name', 'Address', 'Phone', 'Email', 'Gross amount paid (incl. GST)', 'Total GST', 'Total tax withheld'],
    ...paid.value.map((p) => [p.abn ?? '', p.legalName ?? p.name, p.address ?? '', p.phone ?? '', p.email ?? '', dollars(p.gross), dollars(p.gst), '0']),
  ]);
}
</script>

<template>
  <Page
    title="Taxable payments annual report"
    :breadcrumbs="[{ label: 'Reports', onAction: () => router.push('/reports') }]"
    size="wide"
    :primary-action="{ label: 'Export CSV', icon: 'mdi:file-delimited-outline', onAction: exportCsv }"
    :secondary-actions="[{ label: 'Print / Save PDF', icon: 'mdi:printer-outline', onAction: () => printElement(sheet) }]"
  >
    <div class="Controls">
      <Select v-model="year" label="Income year" :options="yearOptions" />
    </div>

    <Banner v-if="report && !report.payees.length" status="info" title="No contractors marked for the TPAR" class="Gap">
      <p>
        If your business is in building and construction, cleaning, courier or road freight, IT, or security, investigation
        or surveillance, turn on "On my TPAR" for each contractor you pay for those services.
      </p>
      <Button @click="router.push('/contacts')">Contacts</Button>
    </Banner>
    <Banner v-if="incomplete.length" status="warning" title="Some details are missing" class="Gap">
      <p>{{ incomplete.map((p) => `${p.name} (${p.missing.join(' and ')})`).join(', ') }}. The ATO needs each contractor's ABN, name and address.</p>
      <Button @click="router.push('/contacts')">Contacts</Button>
    </Banner>
    <Banner v-if="noAbn.length" status="critical" title="Payments to contractors with no ABN" class="Gap">
      <p>
        {{ noAbn.map((c) => `${c.name}: ${c.payments} over $75 (${money(c.gross)})`).join(', ') }}. Without an ABN you have to
        withhold 47% and report it on your BAS (W4), unless they gave you a written statement that it's a hobby or not a
        business. Add their ABN if they have one.
      </p>
    </Banner>

    <Card>
      <CardSection>
        <div ref="sheet" :class="{ Loading: loading }">
          <div class="ReportHead">
            <h2>{{ books.name }}: Taxable payments, {{ incomeYearLabel(year, ys) }}</h2>
            <p v-if="report">{{ formatDay(report.from) }} – {{ formatDay(report.to) }} · due {{ formatDay(report.due) }} · ABN {{ report.payer.abn || 'not set' }}</p>
          </div>
          <DataTable :columns="columns" :rows="paid" :loading="loading" empty-text="Nothing paid to marked contractors this year.">
            <template #col:name="{ row }">
              <div>{{ row.legalName ?? row.name }}</div>
              <div class="subdued Small">{{ row.address }}</div>
            </template>
            <template #col:abn="{ row }">{{ row.abn ?? '' }}</template>
            <template #col:gross="{ row }"><span class="money">{{ money(row.gross) }}</span></template>
            <template #col:gst="{ row }"><span class="money">{{ money(row.gst) }}</span></template>
            <template #col:missing="{ row }"><span v-if="row.missing.length" class="negative">No {{ row.missing.join(' or ') }}</span></template>
          </DataTable>
          <p v-if="report" class="subdued Note">
            Total {{ money(report.totals.gross) }}, GST {{ money(report.totals.gst) }}. Payments made in the year, whatever date
            the invoice was. Lodge online (Business Portal, or your agent) by {{ formatDay(report.due) }}; the export has the
            details each line needs, in whole dollars. You only have to lodge if those services are 10% or more of your income
            (building and construction always).
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
  margin: 0 0 8px;
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
</style>
