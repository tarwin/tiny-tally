<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Badge, Card, CardSection, DataTable, Page, SegmentedControl, TextField, type DataTableColumnType } from '@octans/ui';
import { api, type InvoiceList, type InvoiceRow, type InvoiceStatus } from '../lib/api';
import { csvMoney, saveCsv } from '../lib/csv';
import { formatShortDay } from '../lib/dates';
import { dataVersion } from '../lib/entryEditor';
import { DOCS } from '../lib/documents';
import { dueText, statusInfo } from '../lib/invoiceStatus';
import { formatMoney } from '../lib/money';
import { session } from '../lib/session';

const route = useRoute();
const router = useRouter();
const doc = computed(() => DOCS[route.meta.docType ?? 'invoice']);
const list = ref<InvoiceList>({ rows: [], summary: { outstanding: 0, overdue: 0, overdueCount: 0, drafts: 0, open: 0, openValue: 0 } });
const loading = ref(true);
const filter = ref<InvoiceStatus | 'unpaid' | 'all'>('all');
const search = ref('');

const currency = computed(() => session.books!.currency);
const money = (v: number) => formatMoney(v, currency.value);

const filterOptions = computed(() => {
  switch (doc.value.type) {
    case 'quote':
      return [
        { label: 'All', value: 'all' },
        { label: 'Draft', value: 'draft' },
        { label: 'Sent', value: 'open' },
        { label: 'Expired', value: 'expired' },
        { label: 'Accepted', value: 'accepted' },
        { label: 'Declined', value: 'void' },
      ];
    case 'credit':
      return [
        { label: 'All', value: 'all' },
        { label: 'Draft', value: 'draft' },
        { label: 'Available', value: 'unpaid' },
        { label: 'Used', value: 'paid' },
        { label: 'Void', value: 'void' },
      ];
    default:
      return [
        { label: 'All', value: 'all' },
        { label: 'Draft', value: 'draft' },
        { label: doc.value.type === 'bill' ? 'To pay' : 'Unpaid', value: 'unpaid' },
        { label: 'Overdue', value: 'overdue' },
        { label: 'Paid', value: 'paid' },
        { label: 'Void', value: 'void' },
      ];
  }
});

const columns = computed<DataTableColumnType[]>(() => {
  const t = doc.value.type;
  return [
    { key: 'number', label: 'Number', width: 100 },
    { key: 'contactName', label: doc.value.contactLabel, minWidth: 140 },
    { key: 'issueDate', label: t === 'bill' ? 'Dated' : 'Issued', width: 100 },
    ...(t === 'credit' ? [] : [{ key: 'dueDate', label: t === 'quote' ? 'Expires' : 'Due', width: 125 }]),
    { key: 'total', label: 'Total', width: 110 },
    ...(t === 'quote' ? [] : [{ key: 'balance', label: t === 'credit' ? 'Left' : 'Balance', width: 105 }]),
    { key: 'status', label: 'Status', width: 170 },
  ];
});

let seq = 0;
async function load() {
  const mine = ++seq;
  loading.value = true;
  try {
    const r = await api.listInvoices({
      docType: doc.value.type,
      status: filter.value === 'all' ? undefined : filter.value,
      q: search.value || undefined,
    });
    if (mine === seq) list.value = r;
  } finally {
    if (mine === seq) loading.value = false;
  }
}

let timer: ReturnType<typeof setTimeout> | undefined;
watch(search, () => {
  clearTimeout(timer);
  timer = setTimeout(load, 250);
});
watch([filter, dataVersion], load);
onMounted(load);

/** The list as filtered, with the same columns. */
function exportCsv() {
  const t = doc.value.type;
  type Col = { label: string; get: (r: InvoiceRow) => string | null };
  const cols: Col[] = [
    { label: 'Number', get: (r) => r.number },
    ...(t === 'bill' ? [{ label: 'Supplier reference', get: (r: InvoiceRow) => r.reference }] : []),
    { label: doc.value.contactLabel, get: (r) => r.contactName },
    { label: t === 'bill' ? 'Dated' : 'Issued', get: (r) => r.issueDate },
    ...(t === 'credit' ? [] : [{ label: t === 'quote' ? 'Expires' : 'Due', get: (r: InvoiceRow) => r.dueDate }]),
    { label: 'Net', get: (r) => csvMoney(r.net) },
    { label: 'Tax', get: (r) => csvMoney(r.tax) },
    { label: 'Total', get: (r) => csvMoney(r.total) },
    ...(t === 'quote' ? [] : [{ label: t === 'credit' ? 'Left' : 'Balance', get: (r: InvoiceRow) => csvMoney(r.balance) }]),
    { label: 'Status', get: (r) => statusInfo(t, r.status).label },
  ];
  void saveCsv(doc.value.many, [cols.map((c) => c.label), ...list.value.rows.map((r) => cols.map((c) => c.get(r)))]);
}
</script>

<template>
  <Page
    :title="doc.many"
    size="wide"
    :primary-action="{ label: `New ${doc.word}`, icon: 'mdi:plus', onAction: () => router.push(`${doc.base}/new`) }"
    :secondary-actions="[
      { label: 'Export CSV', icon: 'mdi:file-delimited-outline', onAction: exportCsv },
      ...(doc.printable ? [{ label: 'Templates', icon: 'mdi:palette-outline', onAction: () => router.push('/invoices/templates') }] : []),
    ]"
  >
    <div v-if="doc.type === 'quote'" class="Tiles">
      <Card>
        <CardSection>
          <div class="Tile__label subdued">Waiting on an answer</div>
          <div class="Tile__value money">{{ money(list.summary.openValue) }}</div>
          <div class="subdued Tile__sub">{{ list.summary.open }} quote{{ list.summary.open === 1 ? '' : 's' }}</div>
        </CardSection>
      </Card>
      <Card>
        <CardSection>
          <div class="Tile__label subdued">Drafts</div>
          <div class="Tile__value">{{ list.summary.drafts }}</div>
        </CardSection>
      </Card>
    </div>
    <div v-else-if="doc.type === 'credit'" class="Tiles">
      <Card>
        <CardSection>
          <div class="Tile__label subdued">Credit still to use or refund</div>
          <div class="Tile__value money">{{ money(list.summary.outstanding) }}</div>
        </CardSection>
      </Card>
      <Card>
        <CardSection>
          <div class="Tile__label subdued">Drafts</div>
          <div class="Tile__value">{{ list.summary.drafts }}</div>
        </CardSection>
      </Card>
    </div>
    <div v-else class="Tiles">
      <Card>
        <CardSection>
          <div class="Tile__label subdued">{{ doc.type === 'bill' ? 'You owe' : 'Owed to you' }}</div>
          <div class="Tile__value money">{{ money(list.summary.outstanding) }}</div>
        </CardSection>
      </Card>
      <Card>
        <CardSection>
          <div class="Tile__label subdued">Overdue</div>
          <div class="Tile__value money" :class="{ negative: list.summary.overdue > 0 }">{{ money(list.summary.overdue) }}</div>
          <div class="subdued Tile__sub">{{ list.summary.overdueCount }} {{ doc.word }}{{ list.summary.overdueCount === 1 ? '' : 's' }}</div>
        </CardSection>
      </Card>
      <Card>
        <CardSection>
          <div class="Tile__label subdued">Drafts</div>
          <div class="Tile__value">{{ list.summary.drafts }}</div>
        </CardSection>
      </Card>
    </div>

    <div class="Bar">
      <SegmentedControl v-model="filter" :options="filterOptions" />
      <TextField v-model="search" :placeholder="`Search number, ${doc.contactLabel.toLowerCase()} or reference`" />
    </div>

    <DataTable
      :columns="columns"
      :rows="list.rows"
      :loading="loading"
      :empty-text="`No ${doc.many.toLowerCase()} here. Create one with New ${doc.word}.`"
      @click-row="(row: InvoiceRow) => router.push(`${doc.base}/${row.id}`)"
    >
      <template #col:contactName="{ row }">
        <span>{{ row.contactName }}</span>
        <span v-if="doc.type === 'bill' && row.reference" class="Due">Their ref. {{ row.reference }}</span>
      </template>
      <template #col:issueDate="{ row }">
        <span>{{ formatShortDay(row.issueDate) }}</span>
      </template>
      <template #col:dueDate="{ row }">
        <span>{{ formatShortDay(row.dueDate) }}</span>
        <span v-if="dueText(row)" class="Due" :class="{ 'Due--late': row.status === 'overdue' }">{{ dueText(row) }}</span>
      </template>
      <template #col:total="{ row }">
        <span class="money">{{ money(row.total) }}</span>
      </template>
      <template #col:balance="{ row }">
        <span class="money" :class="{ subdued: row.balance === 0 || row.status === 'void' }">
          {{ row.status === 'void' ? '—' : money(row.balance) }}
        </span>
      </template>
      <template #col:status="{ row }">
        <Badge :status="statusInfo(row.docType, row.status as InvoiceStatus).badge">{{ statusInfo(row.docType, row.status as InvoiceStatus).label }}</Badge>
      </template>
    </DataTable>
  </Page>
</template>

<style scoped>
.Tiles {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 16px;
  margin-bottom: 16px;
}

.Tile__label {
  font-size: 13px;
}

.Tile__value {
  font-size: 24px;
  font-weight: 600;
  margin-top: 4px;
}

.Tile__sub {
  font-size: 12px;
}

.Bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 12px;
}

.Bar > :last-child {
  min-width: 280px;
}

.Due {
  display: block;
  font-size: 12px;
  color: var(--octans-text-subdued);
}

.Due--late {
  color: var(--octans-text-error);
}
</style>
