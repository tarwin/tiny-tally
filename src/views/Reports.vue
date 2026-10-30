<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Card, CardSection, Icon, Page } from '@octans/ui';
import { api, type BasFigures } from '../lib/api';
import { formatMoney } from '../lib/money';
import { taxPeriods } from '../lib/periods';
import { session } from '../lib/session';

const router = useRouter();
const company = computed(() => session.company!);
const money = (v: number) => formatMoney(v, company.value.currency);

const period = computed(() => taxPeriods(company.value.basFrequency, company.value.fiscalYearStart, 1)[0]);
const gst = ref<BasFigures | null>(null);

const reports = computed(() => [
  {
    to: '/reports/profit-and-loss',
    icon: 'mdi:chart-line',
    title: 'Profit & Loss',
    body: 'Income minus expenses for any period, by category. Compare with the period before.',
  },
  ...(company.value.taxEnabled
    ? [{
        to: '/reports/bas',
        icon: 'mdi:bank-outline',
        title: 'BAS & GST',
        body: 'Your Business Activity Statement figures (G1, 1A, 1B…), ready to copy into the ATO portal.',
      }]
    : []),
  {
    to: '/reports/receivables',
    icon: 'mdi:account-cash-outline',
    title: 'Who owes you',
    body: 'Unpaid invoices by customer, grouped by how overdue they are.',
  },
  {
    to: '/reports/payables',
    icon: 'mdi:receipt-text-clock-outline',
    title: 'Who you owe',
    body: 'Unpaid bills by supplier, grouped by how overdue they are.',
  },
  {
    to: '/reports/balance-sheet',
    icon: 'mdi:scale-balance',
    title: 'Balance Sheet',
    body: 'What the business has and owes on a date: bank, money owed both ways, GST, loans and owner equity.',
  },
  {
    to: '/reports/journal',
    icon: 'mdi:book-open-variant',
    title: 'Journal & Trial Balance',
    body: 'Every transaction as double-entry debits and credits, for your accountant.',
  },
  {
    to: '/journals',
    icon: 'mdi:book-edit-outline',
    title: 'Journal entries',
    body: 'Depreciation, accruals and other adjustments your accountant asks for.',
  },
  {
    to: '/transactions',
    icon: 'mdi:format-list-bulleted',
    title: 'Transactions',
    body: 'Every transaction for a period, filterable and searchable.',
  },
]);

onMounted(async () => {
  if (!company.value.taxEnabled) return;
  gst.value = (await api.basReport({ from: period.value.from, to: period.value.to, basis: company.value.taxBasis })).figures;
});
</script>

<template>
  <Page title="Reports" size="wide">
    <Card v-if="gst" :title="`GST so far: ${period.label}`" class="Gst">
      <CardSection>
        <div class="Gst__row">
          <div><div class="subdued">GST on sales (1A)</div><div class="Gst__v money">{{ money(gst['1A']) }}</div></div>
          <div><div class="subdued">GST credits (1B)</div><div class="Gst__v money">{{ money(gst['1B']) }}</div></div>
          <div>
            <div class="subdued">{{ gst['1A'] - gst['1B'] >= 0 ? 'Estimated to pay' : 'Estimated refund' }}</div>
            <div class="Gst__v money">{{ money(Math.abs(gst['1A'] - gst['1B'])) }}</div>
          </div>
        </div>
      </CardSection>
    </Card>

    <div class="Grid">
      <button v-for="r in reports" :key="r.to" type="button" class="Tile" @click="router.push(r.to)">
        <Icon :icon="r.icon" class="Tile__icon" />
        <span class="Tile__title">{{ r.title }}</span>
        <span class="Tile__body subdued">{{ r.body }}</span>
      </button>
    </div>
  </Page>
</template>

<style scoped>
.Gst {
  margin-bottom: 16px;
}

.Gst__row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  font-size: 13px;
}

.Gst__v {
  font-size: 22px;
  font-weight: 600;
  margin-top: 2px;
}

.Grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 16px;
}

.Tile {
  font: inherit;
  color: var(--octans-text);
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 18px;
  border-radius: 12px;
  border: 1px solid var(--octans-border);
  background: var(--octans-surface);
  cursor: pointer;
}

.Tile:hover,
.Tile:focus-visible {
  background: var(--octans-surface-hover);
}

.Tile__icon {
  font-size: 26px;
  color: var(--octans-text-primary);
}

.Tile__title {
  font-weight: 600;
  font-size: 15px;
}

.Tile__body {
  font-size: 13px;
}
</style>
