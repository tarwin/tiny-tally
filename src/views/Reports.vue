<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Card, CardSection, Icon, Page } from '@octans/ui';
import { api } from '../lib/api';
import { formatMoney } from '../lib/money';
import { taxPeriods } from '../lib/periods';
import { booksTax, session } from '../lib/session';
import { RETURN_FORMS, isReturnKind } from '../shared/taxReturns';

const router = useRouter();
const books = computed(() => session.books!);
const money = (v: number) => formatMoney(v, books.value.currency);

const period = computed(() => taxPeriods(books.value.taxPeriod, books.value.fiscalYearStart, 1)[0]);
const tax = computed(() => booksTax());
/** The BAS or NZ GST return, where these books prepare one. */
const form = computed(() => (isReturnKind(tax.value?.report) ? RETURN_FORMS[tax.value.report] : null));
/** Tax on sales and purchases so far this period. */
const gst = ref<{ label: string; value: number }[] | null>(null);

const reports = computed(() => [
  {
    to: '/reports/profit-and-loss',
    icon: 'mdi:chart-line',
    title: 'Profit & Loss',
    body: 'Income minus expenses for any period, by category. Compare with the period before, or your budget.',
  },
  {
    to: '/budget',
    icon: 'mdi:target',
    title: 'Budget',
    body: 'Set what you expect to earn and spend each month, then see how you are tracking.',
  },
  {
    to: '/reports/sales-by-customer',
    icon: 'mdi:account-star-outline',
    title: 'Sales by customer',
    body: 'Who your income came from over a period, and how that compares with the period before.',
  },
  {
    to: '/reports/expenses-by-supplier',
    icon: 'mdi:storefront-outline',
    title: 'Expenses by supplier',
    body: 'Where your money went, by who you paid, for any period.',
  },
  ...(tax.value?.report === 'nz-gst'
    ? [{
        to: '/reports/tax-return',
        icon: 'mdi:bank-outline',
        title: 'GST return',
        body: 'Your GST return figures (Boxes 5 to 15), ready to copy into myIR.',
      }]
    : []),
  ...(tax.value?.report === 'bas'
    ? [{
        to: '/reports/tax-return',
        icon: 'mdi:bank-outline',
        title: 'BAS & GST',
        body: 'Your Business Activity Statement figures (G1, 1A, 1B…), ready to copy into the ATO portal.',
      }]
    : []),
  ...(tax.value?.report === 'us-sales-tax'
    ? [{
        to: '/reports/sales-tax',
        icon: 'mdi:bank-outline',
        title: 'Sales tax',
        body: 'Taxable and non-taxable sales and the sales tax you collected, for your state return.',
      }]
    : []),
  ...(books.value.country === 'US'
    ? [{
        to: '/reports/schedule-c',
        icon: 'mdi:file-document-outline',
        title: 'Schedule C',
        body: 'Profit & Loss by Schedule C line for the tax year, for your return or your tax preparer.',
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
    body: `What the business has and owes on a date: bank, money owed both ways, ${tax.value?.short ?? 'tax'}, loans and owner equity.`,
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
  if (!form.value) return;
  const { figures } = await api.taxReturnReport({ from: period.value.from, to: period.value.to, basis: books.value.taxBasis });
  gst.value = form.value.headline(figures);
});
</script>

<template>
  <Page title="Reports" size="wide">
    <Card v-if="gst" :title="`GST so far: ${period.label}`" class="Gst">
      <CardSection>
        <div class="Gst__row">
          <div v-for="g in gst" :key="g.label"><div class="subdued">{{ g.label }}</div><div class="Gst__v money">{{ money(g.value) }}</div></div>
          <div>
            <div class="subdued">{{ gst[0].value - gst[1].value >= 0 ? 'Estimated to pay' : 'Estimated refund' }}</div>
            <div class="Gst__v money">{{ money(Math.abs(gst[0].value - gst[1].value)) }}</div>
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
