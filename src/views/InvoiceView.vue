<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  Badge,
  Banner,
  Button,
  Card,
  CardSection,
  DatePicker,
  FormLayout,
  Modal,
  ModalSection,
  Page,
  Select,
  TextField,
  confirmModal,
  toast,
} from '@octans/ui';
import InvoiceDocument from '../components/InvoiceDocument.vue';
import PaperPreview from '../components/PaperPreview.vue';
import ScheduleModal from '../components/ScheduleModal.vue';
import { api, errorMessage, type Account, type Invoice, type InvoiceRow, type InvoiceTemplate } from '../lib/api';
import { formatDay, today } from '../lib/dates';
import { DOCS, docPath } from '../lib/documents';
import { dataChanged, dataVersion } from '../lib/entryEditor';
import { dueText, statusInfo } from '../lib/invoiceStatus';
import { formatMoney, parseMoney, toInput } from '../lib/money';
import { printElement } from '../lib/print';
import { booksProfile, booksTax, session } from '../lib/session';
import { TAX_CODE_MAP, tracksTax } from '../shared/tax';

const route = useRoute();
const router = useRouter();

const invoice = ref<Invoice | null>(null);
const templates = ref<InvoiceTemplate[]>([]);
const accounts = ref<Account[]>([]);
const paper = ref<HTMLElement | null>(null);

const doc = computed(() => DOCS[invoice.value?.docType ?? route.meta.docType ?? 'invoice']);
const id = computed(() => Number(route.params.id));
const books = computed(() => session.books!);
/** The books' tax, where this document carries it (US bills don't). */
const tax = computed(() => {
  const t = booksTax();
  return t && tracksTax(booksProfile().tax, invoice.value?.docType === 'bill' ? 'expense' : 'income') ? t : null;
});
const currency = computed(() => books.value.currency);
const money = (v: number) => formatMoney(v, currency.value);
/** For the email to the customer, which follows the documents setting. */
const docMoney = (v: number) => formatMoney(v, currency.value, books.value.documentCurrencyDisplay);

const template = computed(
  () => templates.value.find((t) => t.id === invoice.value?.templateId) ?? templates.value.find((t) => t.isDefault) ?? null,
);
const status = computed(() => (invoice.value ? statusInfo(invoice.value.docType, invoice.value.status) : null));
const canPay = computed(
  () => !!invoice.value && invoice.value.docType !== 'quote' && ['awaiting', 'partial', 'overdue', 'draft'].includes(invoice.value.status),
);

async function load() {
  try {
    [invoice.value, templates.value, accounts.value] = await Promise.all([
      api.getInvoice(id.value),
      api.listTemplates(),
      api.listAccounts(),
    ]);
    // An old link to the wrong list (e.g. /invoices/12 for a bill) lands on the right one.
    if (invoice.value.docType !== (route.meta.docType ?? 'invoice')) await router.replace(docPath(invoice.value.docType, invoice.value.id));
    if (invoice.value.docType === 'invoice' || invoice.value.docType === 'credit') void loadCredits();
  } catch (e) {
    toast({ title: errorMessage(e), tone: 'error' });
    await router.replace(doc.value.base);
  }
}

watch([id, dataVersion], load);
onMounted(load);

async function run(fn: () => Promise<unknown>, done?: string) {
  try {
    await fn();
    dataChanged();
    if (done) toast({ title: done, tone: 'success' });
    await load();
  } catch (e) {
    toast({ title: errorMessage(e), tone: 'error' });
  }
}

function markSent() {
  return run(() => api.setInvoiceStatus(id.value, 'sent'), doc.value.type === 'quote' ? 'Quote marked as sent' : `${doc.value.one} approved`);
}

async function voidInvoice() {
  const inv = invoice.value!;
  const quote = inv.docType === 'quote';
  const ok = await confirmModal({
    title: quote ? `Mark ${inv.number} as declined?` : `Void ${inv.number}?`,
    content: quote
      ? 'It stays on record. You can reopen it later.'
      : `It stays on record with its number but no longer counts. This can't be undone.`,
    primaryActionLabel: quote ? 'Declined' : `Void ${doc.value.word}`,
    primaryActionType: 'destructive',
    secondaryActionLabel: 'Cancel',
  });
  if (ok) await run(() => api.setInvoiceStatus(id.value, 'void'), quote ? 'Quote declined' : `${doc.value.one} voided`);
}

async function deleteInvoice() {
  const ok = await confirmModal({
    title: `Delete ${invoice.value!.number}?`,
    content: `This ${doc.value.word} will be removed for good.`,
    primaryActionLabel: 'Delete',
    primaryActionType: 'destructive',
    secondaryActionLabel: 'Cancel',
  });
  if (!ok) return;
  try {
    await api.deleteInvoice(id.value);
    dataChanged();
    toast({ title: `${doc.value.one} deleted` });
    await router.replace(doc.value.base);
  } catch (e) {
    toast({ title: errorMessage(e), tone: 'error' });
  }
}

async function goNew(fn: () => Promise<number>, type: keyof typeof DOCS, done: string) {
  try {
    const newId = await fn();
    dataChanged();
    toast({ title: done, tone: 'success' });
    await router.push(`${DOCS[type].base}/${newId}/edit`);
  } catch (e) {
    toast({ title: errorMessage(e), tone: 'error' });
  }
}

const duplicate = () => goNew(() => api.duplicateInvoice(id.value, today()), invoice.value!.docType, 'Copied to a new draft');
const acceptQuote = () => goNew(() => api.convertQuote(id.value, today()), 'invoice', 'Quote accepted. Here is the invoice to check and send.');
const creditNote = () => goNew(() => api.creditInvoice(id.value, today()), 'credit', 'Credit note started. Trim the lines to what you are crediting.');

function print() {
  void printElement(paper.value?.querySelector('.Doc') as HTMLElement | null);
}

const overdue = computed(() => invoice.value?.docType === 'invoice' && invoice.value.status === 'overdue');

function email() {
  const inv = invoice.value!;
  const word = doc.value.one.toLowerCase();
  const subject = overdue.value
    ? `Reminder: invoice ${inv.number} from ${inv.sender?.name ?? books.value.name} is overdue`
    : `${doc.value.one} ${inv.number} from ${inv.sender?.name ?? books.value.name}`;
  const lead = overdue.value
    ? `Just a reminder that invoice ${inv.number} for ${docMoney(inv.balance)} was due on ${formatDay(inv.dueDate)}. If you've already paid, thank you, and please ignore this. If not, could you let us know when we can expect payment?`
    : inv.docType === 'quote'
      ? `Please find quote ${inv.number} for ${docMoney(inv.total)}, valid until ${formatDay(inv.dueDate)}.`
      : inv.docType === 'credit'
        ? `Please find credit note ${inv.number} for ${docMoney(inv.total)}.`
        : `Please find ${word} ${inv.number} for ${docMoney(inv.balance || inv.total)}, due ${formatDay(inv.dueDate)}.`;
  const body = [
    `Hi ${inv.contactName},`,
    '',
    lead,
    inv.docType === 'invoice' && inv.sender?.paymentDetails ? `\n${inv.sender.paymentDetails}` : '',
    '',
    'Thanks,',
    books.value.name,
  ].join('\n');
  void tiny.app.shell.open(`mailto:${encodeURIComponent(inv.contactEmail ?? '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`);
  toast({ title: 'Email drafted', content: `Print to PDF and attach the ${word} before sending.` });
}

// ---- payments (received, paid, or refunded) ---------------------------------

const payWords = computed(() => {
  switch (invoice.value?.docType) {
    case 'bill': return { title: 'Record payment', amount: 'Amount paid', date: 'Date paid', account: 'Paid from', action: 'Record payment', left: 'still to pay' };
    case 'credit': return { title: 'Refund credit', amount: 'Amount refunded', date: 'Date refunded', account: 'Paid from', action: 'Record refund', left: 'left on this credit note' };
    default: return { title: 'Record payment', amount: 'Amount received', date: 'Date received', account: 'Deposited to', action: 'Record payment', left: 'still owing' };
  }
});

const paying = ref(false);
const savingPayment = ref(false);
const payment = ref({ date: today(), amount: '', accountId: null as number | null, memo: '' });
const paymentError = ref<string | null>(null);
// Money paid out can come off a card; money in lands in a bank or cash account.
const accountOptions = computed(() =>
  accounts.value
    .filter((a) => !a.archived && (invoice.value?.docType !== 'invoice' || a.kind !== 'credit_card'))
    .map((a) => ({ label: a.name, value: a.id })),
);

function openPayment() {
  paymentError.value = null;
  payment.value = {
    date: today(),
    amount: toInput(invoice.value!.balance, currency.value),
    accountId: accountOptions.value[0]?.value ?? null,
    memo: '',
  };
  paying.value = true;
}

async function savePayment() {
  const amount = parseMoney(payment.value.amount, currency.value);
  if (!amount || amount <= 0) {
    paymentError.value = 'Enter the amount.';
    return;
  }
  savingPayment.value = true;
  try {
    await api.recordPayment({ invoiceId: id.value, date: payment.value.date, amount, accountId: payment.value.accountId!, memo: payment.value.memo });
    paying.value = false;
    dataChanged();
    toast({ title: invoice.value?.docType === 'credit' ? 'Refund recorded' : 'Payment recorded', tone: 'success' });
    await load();
  } catch (e) {
    paymentError.value = errorMessage(e);
  } finally {
    savingPayment.value = false;
  }
}

async function removePayment(entryId: number) {
  const ok = await confirmModal({
    title: invoice.value?.docType === 'credit' ? 'Delete this refund?' : 'Delete this payment?',
    content: invoice.value?.docType === 'credit' ? 'The credit becomes available again.' : `The ${doc.value.word} goes back to owing this amount.`,
    primaryActionLabel: 'Delete',
    primaryActionType: 'destructive',
    secondaryActionLabel: 'Cancel',
  });
  if (ok) await run(() => api.deletePayment(entryId), 'Deleted');
}

// ---- credit notes ---------------------------------------------------------------

/** Credit notes with credit left (on an invoice), or open invoices (on a credit note), for the same customer. */
const credits = ref<InvoiceRow[]>([]);
async function loadCredits() {
  const inv = invoice.value;
  if (!inv || inv.status === 'draft' || inv.status === 'void') {
    credits.value = [];
    return;
  }
  const other = inv.docType === 'credit' ? 'invoice' : 'credit';
  const list = await api.listInvoices({ docType: other, contactId: inv.contactId, status: 'unpaid' });
  credits.value = list.rows.filter((r) => r.balance > 0);
}

const applying = ref(false);
const apply = ref({ otherId: null as number | null, amount: '', date: today() });
const applyError = ref<string | null>(null);
const applyOptions = computed(() =>
  credits.value.map((r) => ({ label: `${r.number} · ${money(r.balance)} ${invoice.value?.docType === 'credit' ? 'owing' : 'available'}`, value: r.id })),
);

function openApply() {
  applyError.value = null;
  const first = credits.value[0];
  apply.value = { otherId: first?.id ?? null, amount: '', date: today() };
  syncApplyAmount();
  applying.value = true;
}

function syncApplyAmount() {
  const other = credits.value.find((r) => r.id === apply.value.otherId);
  if (other && invoice.value) apply.value.amount = toInput(Math.min(other.balance, invoice.value.balance), currency.value);
}

async function saveApply() {
  const inv = invoice.value!;
  const amount = parseMoney(apply.value.amount, currency.value);
  if (!apply.value.otherId) {
    applyError.value = inv.docType === 'credit' ? 'Choose an invoice.' : 'Choose a credit note.';
    return;
  }
  if (!amount || amount <= 0) {
    applyError.value = 'Enter an amount.';
    return;
  }
  try {
    await api.applyCredit({
      creditId: inv.docType === 'credit' ? inv.id : apply.value.otherId,
      invoiceId: inv.docType === 'credit' ? apply.value.otherId : inv.id,
      amount,
      date: apply.value.date,
    });
    applying.value = false;
    dataChanged();
    toast({ title: 'Credit applied', tone: 'success' });
    await load();
  } catch (e) {
    applyError.value = errorMessage(e);
  }
}

async function removeAllocation(allocId: number) {
  const ok = await confirmModal({
    title: 'Remove this credit?',
    content: 'The invoice owes this amount again and the credit becomes available.',
    primaryActionLabel: 'Remove',
    primaryActionType: 'destructive',
    secondaryActionLabel: 'Cancel',
  });
  if (ok) await run(() => api.removeAllocation(allocId), 'Credit removed');
}

// ---- recurring ------------------------------------------------------------------

const repeating = ref(false);
const schedulePayload = computed(() => {
  const inv = invoice.value;
  if (!inv) return null;
  return {
    contactId: inv.contactId,
    dueDays: Math.max(0, Math.round((Date.parse(inv.dueDate) - Date.parse(inv.issueDate)) / 86400000)),
    reference: inv.docType === 'bill' ? null : inv.reference,
    notes: inv.notes,
    templateId: inv.templateId,
    tradingNameId: inv.tradingNameId,
    pricesIncludeTax: inv.pricesIncludeTax,
    lines: inv.lines.map((l) => ({ description: l.description, qtyMilli: l.qtyMilli, unitPrice: l.unitPrice, categoryId: l.categoryId, taxCode: l.taxCode })),
  };
});

// ---- actions --------------------------------------------------------------------

const primary = computed(() => {
  const inv = invoice.value;
  if (!inv) return undefined;
  if (inv.status === 'draft') return { label: inv.docType === 'quote' ? 'Mark as sent' : 'Approve', icon: 'mdi:check', onAction: markSent };
  if (inv.docType === 'quote' && (inv.status === 'open' || inv.status === 'expired')) {
    return { label: 'Accept & invoice', icon: 'mdi:file-document-arrow-right-outline', onAction: acceptQuote };
  }
  if (inv.docType === 'credit' && canPay.value && credits.value.length) return { label: 'Apply to invoice', icon: 'mdi:link-variant', onAction: openApply };
  if (canPay.value) return { label: inv.docType === 'credit' ? 'Refund' : 'Record payment', icon: 'mdi:cash-plus', onAction: openPayment };
  if (doc.value.printable) return { label: 'Print / Save PDF', icon: 'mdi:printer-outline', onAction: print };
  return undefined;
});

const secondary = computed(() => {
  const inv = invoice.value;
  if (!inv) return [];
  const acts = [];
  if (inv.status !== 'void') acts.push({ label: 'Edit', icon: 'mdi:pencil-outline', onAction: () => router.push(`${doc.value.base}/${inv.id}/edit`) });
  if (doc.value.printable && primary.value?.label !== 'Print / Save PDF') acts.push({ label: 'Print / Save PDF', icon: 'mdi:printer-outline', onAction: print });
  if (doc.value.printable) acts.push({ label: overdue.value ? 'Send reminder' : 'Email', icon: overdue.value ? 'mdi:email-alert-outline' : 'mdi:email-outline', onAction: email });
  if (inv.docType === 'credit' && canPay.value && credits.value.length) acts.push({ label: 'Refund', icon: 'mdi:cash-refund', onAction: openPayment });
  if (inv.docType === 'invoice' && inv.rawStatus === 'sent') acts.push({ label: 'Credit note', icon: 'mdi:file-undo-outline', onAction: creditNote });
  if ((inv.docType === 'invoice' || inv.docType === 'bill') && !inv.scheduleId) {
    acts.push({ label: 'Make recurring', icon: 'mdi:repeat', onAction: () => (repeating.value = true) });
  }
  acts.push({ label: 'Duplicate', icon: 'mdi:content-copy', onAction: duplicate });
  if (inv.docType === 'quote' && inv.status === 'void') acts.push({ label: 'Reopen', icon: 'mdi:restore', onAction: markSent });
  if (inv.status === 'draft' || (inv.docType === 'quote' && inv.status !== 'accepted')) {
    acts.push({ label: 'Delete', icon: 'mdi:delete-outline', onAction: deleteInvoice });
  }
  if (inv.status !== 'void' && inv.status !== 'draft' && inv.status !== 'accepted' && !inv.paid && !inv.credited) {
    acts.push({ label: inv.docType === 'quote' ? 'Declined' : 'Void', icon: 'mdi:cancel', onAction: voidInvoice });
  }
  acts.push({ label: 'History', icon: 'mdi:history', onAction: () => router.push({ path: '/activity', query: { table: 'invoices', id: inv.id } }) });
  return acts;
});

const settledLabel = computed(() => (invoice.value?.docType === 'credit' ? 'Refunded' : 'Paid'));
const contactLink = computed(() => `/contacts/${invoice.value?.contactId}/statement`);
</script>

<template>
  <Page
    :title="invoice?.number ?? doc.one"
    :subtitle="invoice ? `${invoice.contactName} · ${money(invoice.total)}${invoice.docType === 'bill' && invoice.reference ? ` · their ref. ${invoice.reference}` : ''}` : ''"
    :breadcrumbs="[{ label: doc.many, onAction: () => router.push(doc.base) }]"
    :primary-action="primary"
    :secondary-actions="secondary"
    size="wide"
    :loading="!invoice"
  >
    <template v-if="invoice">
      <Banner v-if="invoice.status === 'draft'" status="info" title="This is a draft">
        {{
          invoice.docType === 'quote'
            ? "Mark it as sent once it's with the customer."
            : invoice.docType === 'bill'
              ? "It isn't counted as money you owe until you approve it."
              : invoice.docType === 'credit'
                ? 'Approve it to use the credit against an invoice or refund it.'
                : "It isn't counted as money owed until you approve it."
        }}
      </Banner>
      <Banner v-else-if="invoice.status === 'overdue'" status="warning" :title="dueText(invoice)">
        {{ money(invoice.balance) }} was due {{ formatDay(invoice.dueDate) }}.
      </Banner>
      <Banner v-else-if="invoice.status === 'expired'" status="warning" title="This quote has expired">
        It was valid until {{ formatDay(invoice.dueDate) }}. You can still accept it, or duplicate it with new dates.
      </Banner>

      <div class="Grid">
        <div v-if="doc.printable" ref="paper" class="Paper">
          <PaperPreview>
            <InvoiceDocument :invoice="invoice" :books="books" :sender="invoice.sender" :template="template" />
          </PaperPreview>
        </div>
        <Card v-else title="Lines">
          <CardSection>
            <table class="Report">
              <thead>
                <tr><th>Description</th><th>Category</th><th v-if="tax">Tax</th><th class="num">Amount</th></tr>
              </thead>
              <tbody>
                <tr v-for="l in invoice.lines" :key="l.id">
                  <td>{{ l.description || '—' }}</td>
                  <td class="subdued">{{ l.categoryName }}</td>
                  <td v-if="tax" class="subdued">{{ l.taxCode ? TAX_CODE_MAP[l.taxCode].label : '' }}</td>
                  <td class="num money">{{ money(l.net + l.tax) }}</td>
                </tr>
              </tbody>
            </table>
            <p v-if="invoice.notes" class="subdued Notes">{{ invoice.notes }}</p>
          </CardSection>
        </Card>

        <aside class="Side">
          <Card>
            <CardSection>
              <div class="Status">
                <Badge v-if="status" :status="status.badge">{{ status.label }}</Badge>
                <span v-if="dueText(invoice)" class="subdued">{{ dueText(invoice) }}</span>
              </div>
              <dl class="Sum">
                <div><dt>Total</dt><dd class="money">{{ money(invoice.total) }}</dd></div>
                <div v-if="tax"><dt>Includes {{ tax.short }}</dt><dd class="money">{{ money(invoice.tax) }}</dd></div>
                <template v-if="invoice.docType !== 'quote'">
                  <div v-if="invoice.credited"><dt>{{ invoice.docType === 'credit' ? 'Used on invoices' : 'Credited' }}</dt><dd class="money">{{ money(invoice.credited) }}</dd></div>
                  <div><dt>{{ settledLabel }}</dt><dd class="money">{{ money(invoice.paid) }}</dd></div>
                  <div class="Sum__due">
                    <dt>{{ invoice.docType === 'credit' ? 'Left' : 'Balance' }}</dt>
                    <dd class="money">{{ invoice.status === 'void' ? '—' : money(invoice.balance) }}</dd>
                  </div>
                </template>
              </dl>
            </CardSection>
            <CardSection v-if="invoice.sourceNumber || invoice.derived.length || invoice.scheduleId">
              <div v-if="invoice.sourceNumber" class="Small">
                From {{ DOCS[invoice.sourceType!].word }}
                <a href="#" @click.prevent="router.push(docPath(invoice.sourceType, invoice.sourceId!))">{{ invoice.sourceNumber }}</a>
              </div>
              <div v-for="d in invoice.derived" :key="d.id" class="Small">
                {{ DOCS[d.docType].one }}
                <a href="#" @click.prevent="router.push(docPath(d.docType, d.id))">{{ d.number }}</a>
                <span class="subdued"> · {{ money(d.total) }}{{ d.rawStatus === 'draft' ? ' · draft' : d.rawStatus === 'void' ? ' · void' : '' }}</span>
              </div>
              <div v-if="invoice.scheduleId" class="Small">
                Created by a <a href="#" @click.prevent="router.push('/recurring')">recurring schedule</a>
              </div>
            </CardSection>
          </Card>

          <Card
            v-if="invoice.docType !== 'quote'"
            :title="invoice.docType === 'credit' ? 'Refunds' : 'Payments'"
            :actions="canPay ? [{ label: 'Record', onAction: openPayment }] : []"
          >
            <CardSection>
              <p v-if="!invoice.payments.length" class="subdued Empty">{{ invoice.docType === 'credit' ? 'No refunds.' : 'No payments yet.' }}</p>
              <ul class="Payments">
                <li v-for="p in invoice.payments" :key="p.id">
                  <div>
                    <div class="money">{{ money(p.amount) }}</div>
                    <div class="subdued Small">{{ formatDay(p.date) }} · {{ p.accountName }}{{ p.memo ? ` · ${p.memo}` : '' }}</div>
                  </div>
                  <span class="PaymentActions">
                    <Button
                      v-if="invoice.docType === 'bill'"
                      type="plain"
                      icon="mdi:email-fast-outline"
                      tooltip="Remittance advice"
                      @click="router.push(`/bills/remittance/${p.id}`)"
                    />
                    <Button type="plain" icon="mdi:delete-outline" tooltip="Delete" @click="removePayment(p.id)" />
                  </span>
                </li>
              </ul>
            </CardSection>
          </Card>

          <Card
            v-if="invoice.docType === 'invoice' || invoice.docType === 'credit'"
            :title="invoice.docType === 'credit' ? 'Used on invoices' : 'Credit notes'"
            :actions="canPay && credits.length ? [{ label: 'Apply', onAction: openApply }] : []"
          >
            <CardSection>
              <p v-if="!invoice.allocations.length" class="subdued Empty">
                {{
                  invoice.docType === 'credit'
                    ? credits.length ? 'Not used yet.' : 'This customer has no invoices owing. Refund it instead.'
                    : credits.length ? `${invoice.contactName} has credit you can use here.` : 'None applied.'
                }}
              </p>
              <ul class="Payments">
                <li v-for="a in invoice.allocations" :key="a.id">
                  <div>
                    <div class="money">{{ money(a.amount) }}</div>
                    <div class="subdued Small">
                      {{ formatDay(a.date) }} ·
                      <a href="#" @click.prevent="router.push(docPath(invoice.docType === 'credit' ? 'invoice' : 'credit', a.docId))">{{ a.number }}</a>
                    </div>
                  </div>
                  <Button type="plain" icon="mdi:link-variant-off" tooltip="Remove" @click="removeAllocation(a.id)" />
                </li>
              </ul>
            </CardSection>
          </Card>

          <Card :title="doc.contactLabel">
            <CardSection>
              <div class="Customer">{{ invoice.contactName }}</div>
              <div v-if="invoice.contactEmail" class="subdued Small">{{ invoice.contactEmail }}</div>
              <div class="Links">
                <Button type="plain" size="small" @click="router.push(`${doc.base}/new?contact=${invoice.contactId}`)">New {{ doc.word }} for them</Button>
                <Button v-if="contactLink" type="plain" size="small" @click="router.push(contactLink)">Statement</Button>
              </div>
            </CardSection>
          </Card>
        </aside>
      </div>
    </template>

    <Modal
      :visible="paying"
      :title="payWords.title"
      :loading="savingPayment"
      :primary-action="{ label: payWords.action, onAction: savePayment }"
      :secondary-actions="[{ label: 'Cancel', onAction: () => (paying = false) }]"
      overflow-visible
      @close="paying = false"
    >
      <ModalSection>
        <FormLayout>
          <TextField
            v-model="payment.amount"
            :label="payWords.amount"
            :prefix="currency"
            align="right"
            :error="paymentError"
            :help-text="invoice ? `${money(invoice.balance)} ${payWords.left}` : ''"
            @keydown.enter="savePayment"
          />
          <DatePicker v-model="payment.date" type="date" model-format="YYYY-MM-DD" :label="payWords.date" />
          <Select v-model="payment.accountId" :label="payWords.account" :options="accountOptions" />
          <TextField v-model="payment.memo" label="Note (optional)" placeholder="e.g. bank reference" />
        </FormLayout>
      </ModalSection>
    </Modal>

    <Modal
      :visible="applying"
      :title="invoice?.docType === 'credit' ? 'Use credit on an invoice' : 'Apply a credit note'"
      :primary-action="{ label: 'Apply credit', onAction: saveApply }"
      :secondary-actions="[{ label: 'Cancel', onAction: () => (applying = false) }]"
      overflow-visible
      @close="applying = false"
    >
      <ModalSection>
        <FormLayout>
          <Select
            v-model="apply.otherId"
            :label="invoice?.docType === 'credit' ? 'Invoice' : 'Credit note'"
            :options="applyOptions"
            @update:model-value="syncApplyAmount"
          />
          <TextField v-model="apply.amount" label="Amount" :prefix="currency" align="right" :error="applyError" />
          <DatePicker v-model="apply.date" type="date" model-format="YYYY-MM-DD" label="Date" />
        </FormLayout>
      </ModalSection>
    </Modal>

    <ScheduleModal
      v-if="invoice && schedulePayload"
      :visible="repeating"
      :kind="invoice.docType === 'bill' ? 'bill' : 'invoice'"
      :payload="schedulePayload"
      :name="`${invoice.contactName}${invoice.lines[0]?.description ? ` · ${invoice.lines[0].description}` : ''}`"
      :from="invoice.issueDate"
      @close="repeating = false"
      @saved="repeating = false"
    />
  </Page>
</template>

<style scoped>
.Grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  gap: 16px;
  align-items: start;
  margin-top: 16px;
}

@media (max-width: 1100px) {
  .Grid {
    grid-template-columns: 1fr;
  }
}

.Paper {
  background: var(--octans-surface-sunken);
  border-radius: 12px;
  padding: 20px;
  min-width: 0;
}

.Side {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.Status {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.Sum {
  margin: 0;
  display: grid;
  gap: 6px;
}

.Sum div {
  display: flex;
  justify-content: space-between;
}

.Sum dt {
  color: var(--octans-text-subdued);
}

.Sum dd {
  margin: 0;
}

.Sum__due {
  font-weight: 600;
  font-size: 16px;
  padding-top: 6px;
  border-top: 1px solid var(--octans-border);
}

.Sum__due dt {
  color: var(--octans-text);
}

.Payments {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.Payments li {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.Small {
  font-size: 12px;
}

.Empty {
  margin: 0;
}

.Customer {
  font-weight: 600;
}

.Links {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 6px;
}

.Notes {
  white-space: pre-line;
  margin: 12px 0 0;
}
</style>
