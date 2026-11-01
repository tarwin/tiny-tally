<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Button, Card, CardSection, Icon, Page } from '@octans/ui';
import EntryTable from '../components/EntryTable.vue';
import MonthlyChart from '../components/MonthlyChart.vue';
import { api, type Account, type Entry, type InvoiceList, type Summary } from '../lib/api';
import { dataVersion, newEntry } from '../lib/entryEditor';
import { formatMoney } from '../lib/money';
import { periodRange } from '../lib/periods';
import { session } from '../lib/session';

const router = useRouter();
const accounts = ref<Account[]>([]);
const month = ref<Summary>({ income: 0, expense: 0, byCategory: [], other: [] });
const recent = ref<Entry[]>([]);
const totalEntries = ref(0);
const loaded = ref(false);
const emptySummary = (): InvoiceList['summary'] => ({ outstanding: 0, overdue: 0, overdueCount: 0, drafts: 0, open: 0, openValue: 0 });
const invoices = ref(emptySummary());
const bills = ref(emptySummary());
const months = ref<{ month: string; income: number; expense: number }[]>([]);
const hasHistory = computed(() => months.value.some((m) => m.income || m.expense));

/** The first of the month eleven months back, to the end of this one. */
function lastTwelveMonths() {
  const now = new Date();
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { from: iso(new Date(now.getFullYear(), now.getMonth() - 11, 1)), to: iso(new Date(now.getFullYear(), now.getMonth() + 1, 0)) };
}

const currency = computed(() => session.books!.currency);
const active = computed(() => accounts.value.filter((a) => !a.archived));
const cash = computed(() => active.value.filter((a) => a.kind !== 'credit_card').reduce((s, a) => s + a.balance, 0));
const owed = computed(() => active.value.filter((a) => a.kind === 'credit_card').reduce((s, a) => s - a.balance, 0));
const net = computed(() => month.value.income - month.value.expense);
const monthName = new Date().toLocaleDateString(undefined, { month: 'long' });

const topExpenses = computed(() => {
  const rows = month.value.byCategory.filter((c) => c.kind === 'expense').slice(0, 6);
  const max = rows[0]?.total ?? 1;
  return rows.map((r) => ({ ...r, pct: Math.max(4, Math.round((r.total / max) * 100)) }));
});

const steps = computed(() => [
  {
    done: active.value.some((a) => a.openingBalance !== 0),
    title: 'Set opening balances',
    body: 'Enter what each account held on the day you start tracking, so balances match your statements.',
    action: () => router.push('/accounts'),
    label: 'Money accounts',
  },
  {
    done: totalEntries.value > 0,
    title: 'Bring in your history',
    body: 'Import from QuickBooks, or a statement downloaded from your bank (OFX, QBO or CSV).',
    action: () => router.push('/import'),
    label: 'Import',
  },
  {
    done: totalEntries.value > 0,
    title: 'Record your first transaction',
    body: 'Add an expense or some income. ⌘E and ⌘I work from anywhere.',
    action: () => newEntry('expense'),
    label: 'New expense',
  },
]);
const showSteps = computed(() => loaded.value && steps.value.some((s) => !s.done));

async function load() {
  const { from, to } = periodRange('thisMonth');
  const [a, m, r, inv, bill, year] = await Promise.all([
    api.listAccounts(),
    api.summary(from!, to!),
    api.listEntries({ limit: 8 }),
    api.listInvoices({ status: 'unpaid' }),
    api.listInvoices({ docType: 'bill', status: 'unpaid' }),
    api.monthly(lastTwelveMonths()),
  ]);
  months.value = year;
  invoices.value = inv.summary;
  bills.value = bill.summary;
  accounts.value = a;
  month.value = m;
  recent.value = r.rows;
  totalEntries.value = r.total;
  loaded.value = true;
}

watch(dataVersion, load);
onMounted(load);
</script>

<template>
  <Page :title="session.books!.name" subtitle="Dashboard" size="wide">
    <div class="Quick">
      <Button type="primary" icon="mdi:arrow-up-bold-circle-outline" @click="newEntry('expense')">Expense</Button>
      <Button icon="mdi:arrow-down-bold-circle-outline" @click="newEntry('income')">Income</Button>
      <Button icon="mdi:swap-horizontal" @click="newEntry('transfer')">Transfer</Button>
      <Button icon="mdi:file-document-plus-outline" @click="router.push('/invoices/new')">Invoice</Button>
    </div>

    <div class="Tiles">
      <Card>
        <CardSection>
          <div class="Tile__label subdued">Money in the bank</div>
          <div class="Tile__value money" :class="{ negative: cash < 0 }">{{ formatMoney(cash, currency) }}</div>
        </CardSection>
      </Card>
      <Card v-if="owed > 0">
        <CardSection>
          <div class="Tile__label subdued">Owed on credit cards</div>
          <div class="Tile__value money">{{ formatMoney(owed, currency) }}</div>
        </CardSection>
      </Card>
      <Card class="Tile--link" @click="router.push('/invoices')">
        <CardSection>
          <div class="Tile__label subdued">Owed to you</div>
          <div class="Tile__value money">{{ formatMoney(invoices.outstanding, currency) }}</div>
          <div v-if="invoices.overdueCount" class="Tile__sub Tile__sub--loss">
            {{ formatMoney(invoices.overdue, currency) }} overdue ({{ invoices.overdueCount }})
          </div>
        </CardSection>
      </Card>
      <Card v-if="bills.outstanding > 0" class="Tile--link" @click="router.push('/bills')">
        <CardSection>
          <div class="Tile__label subdued">Bills to pay</div>
          <div class="Tile__value money">{{ formatMoney(bills.outstanding, currency) }}</div>
          <div v-if="bills.overdueCount" class="Tile__sub Tile__sub--loss">
            {{ formatMoney(bills.overdue, currency) }} overdue ({{ bills.overdueCount }})
          </div>
        </CardSection>
      </Card>
      <Card>
        <CardSection>
          <div class="Tile__label subdued">{{ monthName }} income</div>
          <div class="Tile__value money">{{ formatMoney(month.income, currency) }}</div>
        </CardSection>
      </Card>
      <Card>
        <CardSection>
          <div class="Tile__label subdued">{{ monthName }} expenses</div>
          <div class="Tile__value money">{{ formatMoney(month.expense, currency) }}</div>
          <div class="Tile__sub" :class="net < 0 ? 'Tile__sub--loss' : 'Tile__sub--profit'">
            {{ net < 0 ? 'Loss' : 'Profit' }} {{ formatMoney(Math.abs(net), currency) }}
          </div>
        </CardSection>
      </Card>
    </div>

    <Card v-if="showSteps" title="Getting started" class="Steps">
      <CardSection v-for="s in steps" :key="s.title">
        <div class="Step">
          <Icon
            :icon="s.done ? 'mdi:check-circle' : 'mdi:circle-outline'"
            :class="s.done ? 'Step__icon Step__icon--done' : 'Step__icon'"
          />
          <div class="Step__body">
            <strong>{{ s.title }}</strong>
            <p class="subdued">{{ s.body }}</p>
          </div>
          <Button v-if="!s.done" size="small" @click="s.action">{{ s.label }}</Button>
        </div>
      </CardSection>
    </Card>

    <Card
      v-if="hasHistory"
      title="Last 12 months"
      :actions="[{ label: 'Profit & Loss', onAction: () => router.push('/reports/profit-and-loss') }]"
      class="Trend"
    >
      <CardSection>
        <MonthlyChart :months="months" :currency="currency" />
      </CardSection>
    </Card>

    <div class="Columns">
      <Card
        title="Recent transactions"
        :actions="[{ label: 'View all', onAction: () => router.push('/transactions') }]"
        class="Columns__wide"
      >
        <EntryTable :rows="recent" compact empty-text="Nothing recorded yet." />
      </Card>

      <div class="Side">
        <Card title="Accounts" :actions="[{ label: 'Manage', onAction: () => router.push('/accounts') }]">
          <CardSection>
            <p v-if="loaded && !active.length" class="subdued">No accounts yet.</p>
            <ul class="List">
              <li v-for="a in active" :key="a.id">
                <RouterLink :to="`/accounts/${a.id}`" class="List__link">{{ a.name }}</RouterLink>
                <span class="money" :class="{ negative: a.balance < 0 }">{{ formatMoney(a.balance, currency) }}</span>
              </li>
            </ul>
          </CardSection>
        </Card>

        <Card :title="`Where ${monthName}'s money went`">
          <CardSection>
            <p v-if="!topExpenses.length" class="subdued">No expenses this month.</p>
            <ul class="Bars">
              <li v-for="c in topExpenses" :key="c.id">
                <div class="Bars__row">
                  <span>{{ c.name }}</span>
                  <span class="money">{{ formatMoney(c.total, currency) }}</span>
                </div>
                <div class="Bars__track"><div class="Bars__fill" :style="{ width: c.pct + '%' }" /></div>
              </li>
            </ul>
          </CardSection>
        </Card>
      </div>
    </div>
  </Page>
</template>

<style scoped>
.Tile--link {
  cursor: pointer;
}

.Quick {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
}

.Tiles {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 16px;
  margin-bottom: 16px;
}

.Tile__label {
  font-size: 13px;
}

.Tile__value {
  font-size: 21px;
  white-space: nowrap;
  font-weight: 600;
  margin-top: 4px;
}

.Tile__sub {
  font-size: 12px;
  margin-top: 2px;
}

.Tile__sub--profit {
  color: var(--octans-text-success);
}

.Tile__sub--loss {
  color: var(--octans-text-error);
}

.Steps,
.Trend {
  margin-bottom: 16px;
}

.Step {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.Step__body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.Step__body p {
  margin: 0;
}

.Step__icon {
  color: var(--octans-text-subdued);
  font-size: 20px;
}

.Step__icon--done {
  color: var(--octans-text-success);
}

.Columns {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(280px, 1fr);
  gap: 16px;
  align-items: start;
}

@media (max-width: 1000px) {
  .Columns {
    grid-template-columns: 1fr;
  }
}

.Side {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.List,
.Bars {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.List li,
.Bars__row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.List__link {
  color: var(--octans-text-link);
  text-decoration: none;
}

.List__link:hover {
  text-decoration: underline;
}

.Bars__row {
  font-size: 13px;
  margin-bottom: 4px;
}

.Bars__track {
  height: 6px;
  border-radius: 3px;
  background: var(--octans-surface-sunken);
  overflow: hidden;
}

.Bars__fill {
  height: 100%;
  border-radius: 3px;
  background: var(--octans-primary);
}
</style>
