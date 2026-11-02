<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Card, CardSection, DatePicker, Page } from '@octans/ui';
import { api, type AgedContact } from '../lib/api';
import { csvMoney, saveCsv } from '../lib/csv';
import { formatDay, today } from '../lib/dates';
import { docPath } from '../lib/documents';
import { onBooksChanged } from '../lib/live';
import { formatMoney } from '../lib/money';
import { printElement } from '../lib/print';
import { session } from '../lib/session';

const route = useRoute();
const router = useRouter();
/** The same report both ways: invoices customers owe you, or bills you owe suppliers. */
const payables = computed(() => route.meta.docType === 'bill');
const words = computed(() =>
  payables.value
    ? { title: 'Who you owe', heading: 'Aged payables', who: 'Supplier', sub: 'Unpaid approved bills', none: 'No bills to pay.' }
    : { title: 'Who owes you', heading: 'Aged receivables', who: 'Customer', sub: 'Unpaid approved invoices (less unused credit)', none: 'Nothing owing. Nice.' },
);
const books = computed(() => session.books!);
const money = (v: number) => (v ? formatMoney(v, books.value.currency) : '—');

const asOf = ref(today());
const rows = ref<AgedContact[]>([]);
const open = ref(new Set<number>());
const loading = ref(false);
const sheet = ref<HTMLElement | null>(null);

const BUCKETS = [
  { key: 'current', label: 'Not yet due' },
  { key: 'd30', label: '1–30 days' },
  { key: 'd60', label: '31–60 days' },
  { key: 'd90', label: '61–90 days' },
  { key: 'older', label: '90+ days' },
] as const;

const totals = computed(() => {
  const t = { current: 0, d30: 0, d60: 0, d90: 0, older: 0, total: 0 };
  for (const r of rows.value) for (const k of Object.keys(t) as (keyof typeof t)[]) t[k] += r[k];
  return t;
});

async function load() {
  loading.value = true;
  try {
    rows.value = await (payables.value ? api.agedPayables(asOf.value) : api.agedReceivables(asOf.value));
  } finally {
    loading.value = false;
  }
}

function toggle(id: number) {
  const s = new Set(open.value);
  if (s.has(id)) s.delete(id);
  else s.add(id);
  open.value = s;
}

function exportCsv() {
  void saveCsv(`${words.value.heading} ${asOf.value}`, [
    [words.value.who, 'Number', 'Issued', 'Due', 'Days overdue', 'Balance'],
    ...rows.value.flatMap((r) =>
      r.invoices.map((i) => [r.contactName, i.number, i.issueDate, i.dueDate, String(Math.max(0, i.daysOverdue)), csvMoney(i.balance)]),
    ),
  ]);
}

watch(asOf, load);
onMounted(load);
onBooksChanged(load);
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
      <DatePicker v-model="asOf" type="date" model-format="YYYY-MM-DD" label="As of" />
    </div>
    <Card>
      <CardSection>
        <div ref="sheet" :class="{ Loading: loading }">
          <div class="ReportHead">
            <h2>{{ books.name }}: {{ words.heading }}</h2>
            <p>{{ words.sub }} as of {{ formatDay(asOf) }}</p>
          </div>
          <table class="Report">
            <thead>
              <tr>
                <th>{{ words.who }}</th>
                <th v-for="b in BUCKETS" :key="b.key" class="num">{{ b.label }}</th>
                <th class="num">Total</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!rows.length"><td :colspan="BUCKETS.length + 2" class="subdued">{{ words.none }}</td></tr>
              <template v-for="r in rows" :key="r.contactId">
                <tr class="Clickable" @click="toggle(r.contactId)">
                  <td><span class="Caret no-print">{{ open.has(r.contactId) ? '▾' : '▸' }}</span> {{ r.contactName }}</td>
                  <td v-for="b in BUCKETS" :key="b.key" class="num" :class="{ negative: b.key !== 'current' && r[b.key] > 0 && b.key !== 'd30' }">
                    {{ money(r[b.key]) }}
                  </td>
                  <td class="num"><strong>{{ money(r.total) }}</strong></td>
                </tr>
                <template v-if="open.has(r.contactId)">
                  <tr v-for="i in r.invoices" :key="i.id" class="Clickable Sub" @click="router.push(docPath(i.docType, i.id))">
                    <td class="Report__indent">
                      {{ i.number }}
                      <span v-if="i.docType === 'credit'" class="subdued">· unused credit</span>
                      <span v-else class="subdued">· due {{ formatDay(i.dueDate) }}{{ i.daysOverdue > 0 ? ` · ${i.daysOverdue} days overdue` : '' }}</span>
                    </td>
                    <td :colspan="BUCKETS.length" />
                    <td class="num">{{ money(i.balance) }}</td>
                  </tr>
                </template>
              </template>
              <tr v-if="rows.length" class="Report__grand">
                <td>Total</td>
                <td v-for="b in BUCKETS" :key="b.key" class="num">{{ money(totals[b.key]) }}</td>
                <td class="num">{{ money(totals.total) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </CardSection>
    </Card>
  </Page>
</template>

<style scoped>
.Controls {
  display: flex;
  gap: 16px;
  margin-bottom: 16px;
}

.Loading {
  opacity: 0.6;
}

.Clickable {
  cursor: pointer;
}

.Clickable:hover td {
  background: var(--octans-surface-hover);
}

.Caret {
  display: inline-block;
  width: 14px;
  color: var(--octans-text-subdued);
}

.Sub td {
  font-size: 13px;
}
</style>
