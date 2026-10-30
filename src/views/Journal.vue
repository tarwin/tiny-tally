<script setup lang="ts">
// The books as double-entry: a general journal for a period and a trial
// balance at its end. For accountants; nothing here is stored separately.
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Card, CardSection, DatePicker, FormLayoutGroup, Page, SegmentedControl } from '@octans/ui';
import { api, type JournalLine, type LedgerAccount, type TrialBalance } from '../lib/api';
import { csvMoney, saveCsv } from '../lib/csv';
import { formatDay, formatShortDay, today } from '../lib/dates';
import { formatMoney } from '../lib/money';
import { periodRange } from '../lib/periods';
import { printElement } from '../lib/print';
import { session } from '../lib/session';

const router = useRouter();
const company = computed(() => session.company!);
const money = (v: number) => (v ? formatMoney(v, company.value.currency) : '');

const range = periodRange('thisMonth');
const from = ref(range.from!);
const to = ref(range.to! > today() ? today() : range.to!);
const view = ref<'journal' | 'trial'>('journal');
const lines = ref<JournalLine[]>([]);
const accounts = ref<Map<string, LedgerAccount>>(new Map());
const trial = ref<TrialBalance | null>(null);
const el = ref<HTMLElement | null>(null);

async function load() {
  if (view.value === 'journal') {
    const j = await api.journal({ from: from.value, to: to.value });
    accounts.value = new Map(j.accounts.map((a) => [a.key, a]));
    lines.value = j.lines;
  } else trial.value = await api.trialBalance(to.value);
}
watch([from, to, view], load);
onMounted(load);

/** Lines grouped into journal entries (same date and reference). */
const groups = computed(() => {
  const out: { date: string; ref: string; memo: string; lines: JournalLine[] }[] = [];
  for (const l of lines.value) {
    const last = out[out.length - 1];
    if (last && last.date === l.date && last.ref === l.ref) last.lines.push(l);
    else out.push({ date: l.date, ref: l.ref, memo: l.memo, lines: [l] });
  }
  // Debits first, as accountants write them.
  for (const g of out) g.lines.sort((a, b) => b.amount - a.amount);
  return out;
});

const name = (key: string) => accounts.value.get(key)?.name ?? key;

function exportCsv() {
  if (view.value === 'journal') {
    void saveCsv(`Journal ${from.value} to ${to.value}`, [
      ['Date', 'Reference', 'Description', 'Account', 'Debit', 'Credit'],
      ...lines.value.map((l) => [l.date, l.ref, l.memo, name(l.account), l.amount > 0 ? csvMoney(l.amount) : '', l.amount < 0 ? csvMoney(-l.amount) : '']),
    ]);
  } else if (trial.value) {
    void saveCsv(`Trial balance ${to.value}`, [
      ['Account', 'Type', 'Debit', 'Credit'],
      ...trial.value.rows.map((r) => [r.name, r.type, r.debit ? csvMoney(r.debit) : '', r.credit ? csvMoney(r.credit) : '']),
      ['Total', '', csvMoney(trial.value.debit), csvMoney(trial.value.credit)],
    ]);
  }
}
</script>

<template>
  <Page
    title="Journal & Trial Balance"
    subtitle="Your books as double-entry debits and credits, for your accountant."
    :breadcrumbs="[{ label: 'Reports', onAction: () => router.push('/reports') }]"
    size="wide"
    :primary-action="{ label: 'Export CSV', icon: 'mdi:file-delimited-outline', onAction: exportCsv }"
    :secondary-actions="[{ label: 'Print / Save PDF', icon: 'mdi:printer-outline', onAction: () => printElement(el) }]"
  >
    <div class="Controls">
      <SegmentedControl v-model="view" :options="[{ label: 'General journal', value: 'journal' }, { label: 'Trial balance', value: 'trial' }]" />
      <FormLayoutGroup>
        <DatePicker v-if="view === 'journal'" v-model="from" type="date" model-format="YYYY-MM-DD" label="From" />
        <DatePicker v-model="to" type="date" model-format="YYYY-MM-DD" :label="view === 'journal' ? 'To' : 'As at'" />
      </FormLayoutGroup>
    </div>
    <Card>
      <CardSection>
        <div ref="el">
          <div class="ReportHead">
            <h2>{{ company.name }}: {{ view === 'journal' ? 'General journal' : 'Trial balance' }}</h2>
            <p v-if="view === 'journal'">{{ formatDay(from) }} to {{ formatDay(to) }} · accrual basis</p>
            <p v-else>As at {{ formatDay(to) }} · accrual basis</p>
          </div>

          <table v-if="view === 'journal'" class="Report">
            <thead>
              <tr><th>Date</th><th>Account</th><th class="num">Debit</th><th class="num">Credit</th></tr>
            </thead>
            <tbody>
              <tr v-if="!groups.length"><td colspan="4" class="subdued">Nothing in this period.</td></tr>
              <template v-for="(g, gi) in groups" :key="gi">
                <tr class="Report__section">
                  <td class="money">{{ formatShortDay(g.date) }}</td>
                  <td colspan="3">{{ g.ref }} <span class="subdued">{{ g.memo }}</span></td>
                </tr>
                <tr v-for="(l, li) in g.lines" :key="li">
                  <td />
                  <td :class="{ Credit: l.amount < 0 }">{{ name(l.account) }}</td>
                  <td class="num money">{{ l.amount > 0 ? money(l.amount) : '' }}</td>
                  <td class="num money">{{ l.amount < 0 ? money(-l.amount) : '' }}</td>
                </tr>
              </template>
            </tbody>
          </table>

          <table v-else-if="trial" class="Report">
            <thead>
              <tr><th>Account</th><th>Type</th><th class="num">Debit</th><th class="num">Credit</th></tr>
            </thead>
            <tbody>
              <tr v-for="r in trial.rows" :key="r.key">
                <td>{{ r.name }}</td>
                <td class="subdued Type">{{ r.type }}</td>
                <td class="num money">{{ money(r.debit) }}</td>
                <td class="num money">{{ money(r.credit) }}</td>
              </tr>
              <tr class="Report__grand">
                <td>Total</td>
                <td />
                <td class="num money">{{ money(trial.debit) }}</td>
                <td class="num money">{{ money(trial.credit) }}</td>
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
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 16px;
}

.Credit {
  padding-left: 32px;
}

.Type {
  text-transform: capitalize;
}
</style>
