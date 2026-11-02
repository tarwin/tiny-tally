<script setup lang="ts">
// Remittance advice: tells a supplier which bills a payment covers, so they
// can match the money when it lands. Bills paid to them from the same account
// on the same day share one advice. Printable.
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Page, toast } from '@octans/ui';
import PaperPreview from '../components/PaperPreview.vue';
import { api, errorMessage, type InvoiceTemplate, type Remittance } from '../lib/api';
import { formatDay } from '../lib/dates';
import { docPath } from '../lib/documents';
import { onBooksChanged } from '../lib/live';
import { formatMoney } from '../lib/money';
import { printElement } from '../lib/print';
import { session } from '../lib/session';
import { countryProfile } from '../shared/countries';

const route = useRoute();
const router = useRouter();
const entryId = computed(() => Number(route.params.entryId));
const books = computed(() => session.books!);
// A document for the customer or vendor, so it follows the documents setting.
const money = (v: number) => formatMoney(v, books.value.currency, books.value.documentCurrencyDisplay);

const advice = ref<Remittance | null>(null);
const template = ref<InvoiceTemplate | null>(null);
const paper = ref<HTMLElement | null>(null);

async function load() {
  try {
    const [r, templates] = await Promise.all([api.remittance(entryId.value), api.listTemplates()]);
    advice.value = r;
    template.value = templates.find((t) => t.isDefault) ?? templates[0] ?? null;
  } catch (e) {
    toast({ title: errorMessage(e), tone: 'error' });
    await router.replace('/bills');
  }
}
watch(entryId, load);
onMounted(load);
onBooksChanged(load);
const sender = computed(() => advice.value?.sender);

const billRef = (i: Remittance['items'][number]) => i.reference || i.number;

function print() {
  void printElement(paper.value?.querySelector('.Doc') as HTMLElement | null);
}

function email() {
  const r = advice.value!;
  const refs = r.items.map((i) => `  ${billRef(i)}: ${money(i.paid)}`).join('\n');
  const body = [
    `Hi ${r.contact.name},`,
    '',
    `We paid ${money(r.total)} on ${formatDay(r.date)}, covering:`,
    refs,
    '',
    'Thanks,',
    books.value.name,
  ].join('\n');
  void tiny.app.shell.open(
    `mailto:${encodeURIComponent(r.contact.email ?? '')}?subject=${encodeURIComponent(`Remittance advice from ${sender.value?.name ?? books.value.name}`)}&body=${encodeURIComponent(body)}`,
  );
  toast({ title: 'Email drafted', content: 'Print to PDF and attach the advice if they need it on letterhead.' });
}
</script>

<template>
  <Page
    title="Remittance advice"
    :subtitle="advice ? `${advice.contact.name} · ${formatDay(advice.date)}` : ''"
    :breadcrumbs="[
      { label: 'Bills', onAction: () => router.push('/bills') },
      ...(advice?.items.length === 1 ? [{ label: advice.items[0].number, onAction: () => router.push(docPath('bill', advice!.items[0].billId)) }] : []),
    ]"
    size="wide"
    :primary-action="{ label: 'Print / Save PDF', icon: 'mdi:printer-outline', onAction: print }"
    :secondary-actions="[{ label: 'Email', icon: 'mdi:email-outline', onAction: email }]"
    :loading="!advice"
  >
    <div v-if="advice" ref="paper" class="Paper">
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
              <h1 class="Doc__title">Remittance advice</h1>
              <div>Paid {{ formatDay(advice.date) }}</div>
            </div>
          </header>

          <section>
            <div class="Doc__label">To</div>
            <div class="Doc__to">{{ advice.contact.name }}</div>
            <div v-if="advice.contact.address" class="Doc__pre">{{ advice.contact.address }}</div>
          </section>

          <table class="Doc__table">
            <thead>
              <tr>
                <th>Your invoice</th>
                <th>Dated</th>
                <th class="num">Invoice total</th>
                <th class="num">Paid now</th>
                <th class="num">Still owing</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="i in advice.items" :key="i.entryId" class="Doc__row" @click="router.push(docPath('bill', i.billId))">
                <td>
                  {{ billRef(i) }}
                  <span v-if="i.memo" class="Doc__muted"> · {{ i.memo }}</span>
                </td>
                <td>{{ formatDay(i.issueDate) }}</td>
                <td class="num">{{ money(i.total) }}</td>
                <td class="num">{{ money(i.paid) }}</td>
                <td class="num">{{ i.remaining > 0 ? money(i.remaining) : '—' }}</td>
              </tr>
            </tbody>
          </table>

          <section class="Doc__total">
            <div class="Doc__label">Total paid</div>
            <div>{{ money(advice.total) }}</div>
          </section>
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

.Doc__row {
  cursor: pointer;
}

.Doc__total {
  align-self: flex-end;
  text-align: right;
  font-weight: 700;
  font-size: 17px;
  font-variant-numeric: tabular-nums;
}
</style>
