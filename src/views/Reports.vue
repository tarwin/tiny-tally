<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Card, CardSection, Icon, Page } from '@octans/ui';
import { api } from '../lib/api';
import { formatMoney } from '../lib/money';
import { booksTaxPeriods } from '../lib/periods';
import { booksTax, session } from '../lib/session';
import { RETURN_FORMS, isReturnKind } from '../shared/taxReturns';

const router = useRouter();
const books = computed(() => session.books!);
const money = (v: number) => formatMoney(v, books.value.currency);

const period = computed(() => booksTaxPeriods(books.value, 1)[0]);
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
    to: '/reports/cash-flow',
    icon: 'mdi:cash-sync',
    title: 'Cash flow',
    body: 'Where your cash came from and went: day-to-day trading, buying assets, and owner and loan money.',
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
  ...(tax.value?.report === 'in-gst'
    ? [{
        to: '/reports/tax-return',
        icon: 'mdi:bank-outline',
        title: 'GST summary',
        body: 'Sales by CGST, SGST and IGST, zero-rated exports and input tax credit, to file GSTR-1 and GSTR-3B from.',
      }]
    : []),
  ...(tax.value?.report === 'ca-gst'
    ? [{
        to: '/reports/tax-return',
        icon: 'mdi:bank-outline',
        title: 'GST/HST return',
        body: 'Your return lines (101 to 115), ready to type into GST/HST NETFILE or My Business Account.',
      }]
    : []),
  ...(tax.value?.report === 'uk-vat'
    ? [{
        to: '/reports/tax-return',
        icon: 'mdi:bank-outline',
        title: 'VAT return',
        body: 'Your nine boxes, exported as a file to send to HMRC with bridging software.',
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
      }, {
        to: '/reports/estimated-tax',
        icon: 'mdi:calendar-clock',
        title: 'Estimated tax',
        body: 'What to set aside and pay each quarter (Form 1040-ES), and what you have paid so far.',
      }, {
        to: '/reports/1099-nec',
        icon: 'mdi:account-tie-outline',
        title: '1099-NEC',
        body: 'Contractors you paid enough to send a 1099-NEC, with their W-9 details and anything missing.',
      }, {
        to: '/reports/tax-pack',
        icon: 'mdi:folder-zip-outline',
        title: 'Year-end tax pack',
        body: 'Everything your tax preparer needs for the year, printed together or saved as files in one folder.',
      }]
    : []),
  ...(books.value.country === 'AU' || books.value.country === 'NZ'
    ? [{
        to: '/reports/income-tax-return',
        icon: 'mdi:file-document-outline',
        title: books.value.country === 'AU' ? 'Business schedule' : 'IR10 summary',
        body: books.value.country === 'AU'
          ? 'Profit & Loss by label for item P8 of your tax return, with your car and working from home.'
          : 'Profit & Loss by IR10 box, to go with your IR3, with your vehicle and home office.',
      }, {
        to: '/reports/income-tax',
        icon: 'mdi:calendar-clock',
        title: books.value.country === 'AU' ? 'PAYG instalments' : 'Provisional tax',
        body: books.value.country === 'AU'
          ? 'Each quarter’s PAYG instalment for your BAS, and what you have paid.'
          : 'Your three provisional tax instalments, less tax clients withheld, and what you have paid.',
      },
      ...(books.value.country === 'AU'
        ? [{
            to: '/reports/tpar',
            icon: 'mdi:account-tie-outline',
            title: 'Taxable payments (TPAR)',
            body: 'What you paid each contractor in the year, with GST, for the report due 28 August.',
          }]
        : []),
      {
        to: '/reports/year-end',
        icon: 'mdi:folder-zip-outline',
        title: 'Year-end pack',
        body: 'Everything your accountant needs for the year, printed together or saved as files in one folder.',
      }]
    : []),
  ...(books.value.country === 'US'
    ? [{
        to: '/reports/sales-by-state',
        icon: 'mdi:map-outline',
        title: 'Sales by state',
        body: "Sales into each state against its sales tax threshold, so you know when to register there.",
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
  <Page title="Reports" size="fullWidth">
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
