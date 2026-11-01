<script setup lang="ts">
// What the business has and owes on a date. Derived from the double-entry
// view of the books (backend/ledger.ts), so it always balances.
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Banner, Card, CardSection, DatePicker, Page } from '@octans/ui';
import { api, type BalanceSection, type BalanceSheet } from '../lib/api';
import { csvMoney, saveCsv } from '../lib/csv';
import { formatDay, today } from '../lib/dates';
import { formatMoney } from '../lib/money';
import { toIso, yearStartFor } from '../lib/periods';
import { printElement } from '../lib/print';
import { booksProfile, session } from '../lib/session';

const router = useRouter();
const books = computed(() => session.books!);
const taxNote = computed(() => {
  const tax = booksProfile().tax;
  if (!tax) return '';
  return tax.report === 'bas'
    ? "GST is what you've collected less what you've claimed and paid the ATO."
    : `${tax.account} is what you've collected less what you've paid the state.`;
});
const money = (v: number) => formatMoney(v, books.value.currency);

const asOf = ref(today());
const sheet = ref<BalanceSheet | null>(null);
const el = ref<HTMLElement | null>(null);

/** Start of the financial year that `iso` falls in. */
function yearStart(iso: string) {
  return toIso(yearStartFor(iso, books.value.fiscalYearStart));
}

async function load() {
  sheet.value = await api.balanceSheet(asOf.value, yearStart(asOf.value));
}
watch(asOf, load);
onMounted(load);

const net = computed(() => (sheet.value ? sheet.value.totals.assets - sheet.value.totals.liabilities : 0));
const balanced = computed(() => !sheet.value || sheet.value.totals.assets === sheet.value.totals.liabilities + sheet.value.totals.equity);

function exportCsv() {
  const s = sheet.value!;
  const block = (title: string, sections: BalanceSection[], total: number) => [
    [title, ''],
    ...sections.flatMap((g) => [[g.group, ''], ...g.items.map((i) => [`  ${i.name}`, csvMoney(i.amount)]), [`Total ${g.group}`, csvMoney(g.total)]]),
    [`Total ${title.toLowerCase()}`, csvMoney(total)],
    ['', ''],
  ];
  void saveCsv(`Balance sheet ${asOf.value}`, [
    ['Account', 'Amount'],
    ...block('Assets', s.assets, s.totals.assets),
    ...block('Liabilities', s.liabilities, s.totals.liabilities),
    ...block('Equity', s.equity, s.totals.equity),
  ]);
}
</script>

<template>
  <Page
    title="Balance Sheet"
    :breadcrumbs="[{ label: 'Reports', onAction: () => router.push('/reports') }]"
    size="wide"
    :primary-action="{ label: 'Export CSV', icon: 'mdi:file-delimited-outline', onAction: exportCsv }"
    :secondary-actions="[{ label: 'Print / Save PDF', icon: 'mdi:printer-outline', onAction: () => printElement(el) }]"
    :loading="!sheet"
  >
    <div class="Controls">
      <DatePicker v-model="asOf" type="date" model-format="YYYY-MM-DD" label="As at" />
    </div>
    <Banner v-if="!balanced" status="warning" title="This doesn't balance">Please let us know: it's a bug, not something you did.</Banner>
    <Card v-if="sheet">
      <CardSection>
        <div ref="el">
          <div class="ReportHead">
            <h2>{{ books.name }}: Balance Sheet</h2>
            <p>As at {{ formatDay(asOf) }} · accrual basis (invoices and bills count once approved)</p>
          </div>
          <table class="Report">
            <tbody>
              <template v-for="part in [
                { title: 'Assets', note: 'What the business has', sections: sheet.assets, total: sheet.totals.assets },
                { title: 'Liabilities', note: 'What it owes', sections: sheet.liabilities, total: sheet.totals.liabilities },
              ]" :key="part.title">
                <tr class="Report__section"><td colspan="2">{{ part.title }} <span class="subdued">· {{ part.note }}</span></td></tr>
                <tr v-if="!part.sections.length"><td class="Report__indent subdued">None</td><td /></tr>
                <template v-for="g in part.sections" :key="g.group">
                  <tr v-for="i in g.items" :key="i.key">
                    <td class="Report__indent">{{ i.name }}</td>
                    <td class="num money" :class="{ negative: i.amount < 0 }">{{ money(i.amount) }}</td>
                  </tr>
                </template>
                <tr class="Report__total"><td>Total {{ part.title.toLowerCase() }}</td><td class="num money">{{ money(part.total) }}</td></tr>
              </template>
              <tr class="Report__grand"><td>Net assets</td><td class="num money">{{ money(net) }}</td></tr>
              <tr class="Report__section"><td colspan="2">Equity <span class="subdued">· how the net assets came about</span></td></tr>
              <template v-for="g in sheet.equity" :key="g.group">
                <tr v-for="i in g.items" :key="i.key">
                  <td class="Report__indent">{{ g.group === 'Profit' ? `Profit: ${i.name.toLowerCase()}` : i.name }}</td>
                  <td class="num money" :class="{ negative: i.amount < 0 }">{{ money(i.amount) }}</td>
                </tr>
              </template>
              <tr class="Report__grand"><td>Total equity</td><td class="num money">{{ money(sheet.totals.equity) }}</td></tr>
            </tbody>
          </table>
          <p class="subdued Note no-print">
            Owner drawings show as negative equity. {{ taxNote }}
          </p>
        </div>
      </CardSection>
    </Card>
  </Page>
</template>

<style scoped>
.Controls {
  margin-bottom: 16px;
}

.Note {
  font-size: 12px;
  margin: 12px 0 0;
}
</style>
