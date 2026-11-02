<script setup lang="ts">
// A contact's statement: opening balance, every document and payment in the
// period, the closing balance, and how overdue it is. Printable.
//
// Customers get invoices, credit notes, payments and refunds. Suppliers get
// bills and what we've paid, to check against the statement they send.
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Card, CardSection, DatePicker, FormLayoutGroup, Page, Select, toast } from '@octans/ui';
import PaperPreview from '../components/PaperPreview.vue';
import { api, errorMessage, type InvoiceTemplate, type Statement, type StatementLine } from '../lib/api';
import { csvMoney, saveCsv } from '../lib/csv';
import { addDays, formatDay, today } from '../lib/dates';
import { docPath } from '../lib/documents';
import { onBooksChanged } from '../lib/live';
import { formatMoney } from '../lib/money';
import { printElement } from '../lib/print';
import { session } from '../lib/session';
import { countryProfile } from '../shared/countries';

const route = useRoute();
const router = useRouter();
const contactId = computed(() => Number(route.params.id));
const books = computed(() => session.books!);
// A document for the customer or vendor, so it follows the documents setting.
const money = (v: number) => formatMoney(v, books.value.currency, books.value.documentCurrencyDisplay);

const from = ref(addDays(today(), -90));
const to = ref(today());
const statement = ref<Statement | null>(null);
/** Which trading name the statement is from; null lets the backend pick the customer's usual one. */
const tradingNameId = ref<number | null>(null);
const template = ref<InvoiceTemplate | null>(null);
const paper = ref<HTMLElement | null>(null);

const TYPE_LABEL = { invoice: 'Invoice', credit: 'Credit note', payment: 'Payment', refund: 'Refund', bill: 'Bill' } as const;
const BUCKETS = [
  { key: 'current', label: 'Not yet due' },
  { key: 'd30', label: '1–30 days' },
  { key: 'd60', label: '31–60 days' },
  { key: 'd90', label: '61–90 days' },
  { key: 'older', label: '90+ days' },
] as const;

async function load() {
  try {
    const [s, templates] = await Promise.all([
      api.statement({ contactId: contactId.value, from: from.value, to: to.value, tradingNameId: tradingNameId.value }),
      api.listTemplates(),
    ]);
    statement.value = s;
    tradingNameId.value = s.tradingNameId;
    template.value = templates.find((t) => t.isDefault) ?? templates[0] ?? null;
  } catch (e) {
    toast({ title: errorMessage(e), tone: 'error' });
  }
}
watch(contactId, () => (tradingNameId.value = null));
watch([contactId, from, to, tradingNameId], load);
const sender = computed(() => statement.value?.sender);
onMounted(load);
onBooksChanged(load);

const supplier = computed(() => statement.value?.side === 'supplier');
const words = computed(() =>
  supplier.value
    ? { title: 'Account statement', charges: 'Bills', credits: 'Paid', owing: 'Balance we owe', newDoc: 'New bill', newPath: '/bills/new' }
    : { title: 'Statement', charges: 'Charges', credits: 'Credits', owing: 'Balance owing', newDoc: 'New invoice', newPath: '/invoices/new' },
);

function lineDoc(type: StatementLine['type']) {
  if (supplier.value) return 'bill' as const;
  return type === 'refund' || type === 'credit' ? ('credit' as const) : ('invoice' as const);
}

function exportCsv() {
  const s = statement.value;
  if (!s) return;
  void saveCsv(`Statement ${s.contact.name} ${s.from} to ${s.to}`, [
    ['Date', 'Type', 'Reference', ...(supplier.value ? ['Their reference'] : []), 'Due', 'Amount', 'Balance'],
    [s.from, 'Opening balance', '', ...(supplier.value ? [''] : []), '', '', csvMoney(s.opening)],
    ...s.lines.map((l) => [
      l.date, TYPE_LABEL[l.type], l.ref, ...(supplier.value ? [l.theirRef] : []), l.dueDate, csvMoney(l.amount), csvMoney(l.balance),
    ]),
    [s.to, 'Closing balance', '', ...(supplier.value ? [''] : []), '', '', csvMoney(s.closing)],
  ]);
}

function print() {
  void printElement(paper.value?.querySelector('.Doc') as HTMLElement | null);
}

function email() {
  const s = statement.value!;
  if (supplier.value) {
    const body = [
      `Hi ${s.contact.name},`,
      '',
      `Here is our record of your account for ${formatDay(s.from)} to ${formatDay(s.to)}. We show ${money(s.closing)} owing to you.`,
      'If your records differ, could you send us your statement so we can match them up?',
      '',
      'Thanks,',
      books.value.name,
    ].join('\n');
    void tiny.app.shell.open(
      `mailto:${encodeURIComponent(s.contact.email ?? '')}?subject=${encodeURIComponent(`Account statement from ${sender.value?.name ?? books.value.name}`)}&body=${encodeURIComponent(body)}`,
    );
    toast({ title: 'Email drafted', content: 'Print to PDF and attach the statement before sending.' });
    return;
  }
  const subject = `Statement from ${sender.value?.name ?? books.value.name}`;
  const body = [
    `Hi ${s.contact.name},`,
    '',
    `Here is your statement for ${formatDay(s.from)} to ${formatDay(s.to)}. The balance owing is ${money(s.closing)}.`,
    sender.value?.paymentDetails ? `\n${sender.value.paymentDetails}` : '',
    '',
    'Thanks,',
    books.value.name,
  ].join('\n');
  void tiny.app.shell.open(`mailto:${encodeURIComponent(s.contact.email ?? '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`);
  toast({ title: 'Email drafted', content: 'Print to PDF and attach the statement before sending.' });
}
</script>

<template>
  <Page
    :title="statement ? `Statement · ${statement.contact.name}` : 'Statement'"
    :breadcrumbs="[{ label: 'Contacts', onAction: () => router.push('/contacts') }]"
    size="wide"
    :primary-action="{ label: 'Print / Save PDF', icon: 'mdi:printer-outline', onAction: print }"
    :secondary-actions="[
      { label: 'Email', icon: 'mdi:email-outline', onAction: email },
      { label: 'Export CSV', icon: 'mdi:file-delimited-outline', onAction: exportCsv },
      { label: words.newDoc, icon: 'mdi:file-document-plus-outline', onAction: () => router.push(`${words.newPath}?contact=${contactId}`) },
    ]"
    :loading="!statement"
  >
    <Card>
      <CardSection>
        <FormLayoutGroup>
          <DatePicker v-model="from" type="date" model-format="YYYY-MM-DD" label="From" />
          <DatePicker v-model="to" type="date" model-format="YYYY-MM-DD" label="To" />
          <Select
            v-if="statement && statement.tradingNames.length > 1"
            v-model="tradingNameId"
            label="From"
            :options="statement.tradingNames.map((t) => ({ label: t.name, value: t.id }))"
            help-text="Each trading name has its own statement."
          />
        </FormLayoutGroup>
      </CardSection>
    </Card>

    <div v-if="statement" ref="paper" class="Paper">
      <PaperPreview>
        <article class="Doc" :style="{ '--accent': template?.accent ?? '#2f6fde' }">
          <header class="Doc__head">
            <div>
              <img v-if="template?.logo || sender?.logo" :src="template?.logo || sender?.logo || ''" alt="" class="Doc__logo" />
              <div class="Doc__fromName">{{ sender?.name ?? books.name }}</div>
              <div v-if="books.taxId">{{ countryProfile(books.country).taxId.label }} {{ books.taxId }}</div>
              <div v-if="sender?.address" class="Doc__pre">{{ sender.address }}</div>
              <div class="Doc__muted">{{ [sender?.email, sender?.phone].filter(Boolean).join(' · ') }}</div>
            </div>
            <div class="Doc__titleBlock">
              <h1 class="Doc__title">{{ words.title }}</h1>
              <div>{{ formatDay(statement.from) }} – {{ formatDay(statement.to) }}</div>
            </div>
          </header>

          <section>
            <div class="Doc__label">For</div>
            <div class="Doc__to">{{ statement.contact.name }}</div>
            <div v-if="statement.contact.address" class="Doc__pre">{{ statement.contact.address }}</div>
          </section>

          <table class="Doc__table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Details</th>
                <th class="num">{{ words.charges }}</th>
                <th class="num">{{ words.credits }}</th>
                <th class="num">Balance</th>
              </tr>
            </thead>
            <tbody>
              <tr class="Doc__opening">
                <td>{{ formatDay(statement.from) }}</td>
                <td>Balance brought forward</td>
                <td />
                <td />
                <td class="num">{{ money(statement.opening) }}</td>
              </tr>
              <tr v-for="(l, i) in statement.lines" :key="i" class="Doc__row" @click="router.push(docPath(lineDoc(l.type), l.docId))">
                <td>{{ formatDay(l.date) }}</td>
                <td>
                  {{ TYPE_LABEL[l.type] }} {{ supplier && l.theirRef ? l.theirRef : l.ref }}
                  <span v-if="supplier && l.theirRef" class="Doc__muted"> ({{ l.ref }})</span>
                  <span v-if="l.dueDate" class="Doc__muted"> · due {{ formatDay(l.dueDate) }}</span>
                </td>
                <td class="num">{{ l.amount > 0 ? money(l.amount) : '' }}</td>
                <td class="num">{{ l.amount < 0 ? money(-l.amount) : '' }}</td>
                <td class="num">{{ money(l.balance) }}</td>
              </tr>
            </tbody>
          </table>

          <section class="Doc__aging">
            <div v-for="b in BUCKETS" :key="b.key">
              <div class="Doc__label">{{ b.label }}</div>
              <div>{{ money(statement.aging[b.key]) }}</div>
            </div>
            <div class="Doc__due">
              <div class="Doc__label">{{ words.owing }}</div>
              <div>{{ money(statement.closing) }}</div>
            </div>
          </section>

          <footer v-if="sender?.paymentDetails && !supplier" class="Doc__foot">
            <div class="Doc__label">Payment</div>
            <div class="Doc__pre">{{ sender.paymentDetails }}</div>
          </footer>
        </article>
      </PaperPreview>
    </div>
  </Page>
</template>

<style scoped>
.Paper {
  margin-top: 16px;
  background: var(--octans-surface-sunken);
  border-radius: 12px;
  padding: 20px;
}

/* Paper colours on purpose: it must print the same in dark mode. */
.Doc {
  --ink: #1d1f24;
  --muted: #6b6f78;
  --rule: #e3e5e9;
  box-sizing: border-box;
  width: 210mm;
  min-height: 297mm;
  padding: 18mm 16mm;
  background: #fff;
  color: var(--ink);
  font: 13px/1.45 -apple-system, 'Helvetica Neue', 'Segoe UI', Roboto, Arial, sans-serif;
  display: flex;
  flex-direction: column;
  gap: 9mm;
}

.Doc__head {
  display: flex;
  justify-content: space-between;
  gap: 12mm;
}

.Doc__logo {
  max-height: 20mm;
  max-width: 60mm;
  display: block;
  margin-bottom: 4mm;
}

.Doc__fromName {
  font-size: 17px;
  font-weight: 700;
}

.Doc__titleBlock {
  text-align: right;
}

.Doc__title {
  margin: 0 0 2mm;
  font-size: 26px;
  color: var(--accent);
}

.Doc__pre {
  white-space: pre-line;
}

.Doc__muted {
  color: var(--muted);
}

.Doc__label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
}

.Doc__to {
  font-weight: 600;
  font-size: 15px;
}

.Doc__table {
  width: 100%;
  border-collapse: collapse;
}

.Doc__table th {
  text-align: left;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--muted);
  border-bottom: 2px solid var(--accent);
  padding: 2mm 1.5mm;
}

.Doc__table td {
  padding: 2mm 1.5mm;
  border-bottom: 1px solid var(--rule);
}

.Doc__table .num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.Doc__opening td {
  color: var(--muted);
}

.Doc__row {
  cursor: pointer;
}

.Doc__aging {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 3mm;
  font-variant-numeric: tabular-nums;
}

.Doc__due {
  font-weight: 700;
  font-size: 15px;
}

.Doc__foot {
  margin-top: auto;
  padding-top: 5mm;
  border-top: 1px solid var(--rule);
}
</style>
