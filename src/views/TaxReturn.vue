<script setup lang="ts">
// The books' tax return for a period: the Australian BAS or the NZ GST
// return. The boxes, totals and wording come from the form (taxReturns.ts);
// this screen picks the period, takes the hand-typed boxes, and saves,
// lodges (which locks the period) and records the payment.
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import {
  Badge,
  Banner,
  Button,
  Card,
  CardSection,
  DataTable,
  DatePicker,
  FormLayout,
  Modal,
  ModalSection,
  Page,
  SegmentedControl,
  Select,
  TextField,
  confirmModal,
  toast,
  type DataTableColumnType,
} from '@octans/ui';
import { api, errorMessage, type Basis, type Category, type TaxReturn, type TaxReturnDetailRow, type TaxReturnReport } from '../lib/api';
import { csvMoney, saveCsv } from '../lib/csv';
import { addDays, formatDay, today } from '../lib/dates';
import { dataChanged } from '../lib/entryEditor';
import { formatMoney, parseMoney, toInput } from '../lib/money';
import { taxPeriods } from '../lib/periods';
import { printElement } from '../lib/print';
import { booksProfile, session } from '../lib/session';
import { TAX_CODE_MAP } from '../shared/tax';
import {
  ADJUSTMENT_MAP,
  RETURN_FORMS,
  adjustmentGst,
  adjustmentTotals,
  isReturnKind,
  threeTwentyThirds,
  type Adjustment,
  type AdjustmentContext,
  type AdjustmentType,
  type ReturnFigures,
  type ReturnInputs,
} from '../shared/taxReturns';

const router = useRouter();
const books = computed(() => session.books!);
const money = (v: number) => formatMoney(v, books.value.currency);
const profile = computed(() => booksProfile());
const form = computed(() => {
  const report = profile.value.tax?.report;
  return isReturnKind(report) ? RETURN_FORMS[report] : RETURN_FORMS.bas;
});
/** The BAS is lodged in whole dollars (the ATO says to drop the cents); the NZ return in dollars and cents. */
const boxMoney = (cents: number) =>
  form.value.wholeDollars
    ? formatMoney(Math.trunc(cents / 100) * 100, books.value.currency).replace(/\.00$/, '')
    : formatMoney(cents, books.value.currency);

const periods = computed(() => taxPeriods(books.value.taxPeriod, books.value.fiscalYearStart, 12));
const periodKey = ref('');
const period = computed(() => periods.value.find((p) => p.from === periodKey.value) ?? periods.value[0]);
const periodOptions = computed(() =>
  periods.value.map((p) => {
    const ret = returns.value.find((r) => r.periodStart === p.from);
    return {
      label: p.label,
      value: p.from,
      description: ret?.status === 'lodged' ? 'Lodged' : ret ? 'Draft saved' : p.current ? 'In progress' : undefined,
    };
  }),
);

const basis = ref<Basis>(books.value.taxBasis);
const report = ref<TaxReturnReport | null>(null);
const returns = ref<TaxReturn[]>([]);
const loading = ref(false);
const saving = ref(false);
const sheet = ref<HTMLElement | null>(null);
/** The hand-typed boxes, as typed. */
const typed = ref<Record<string, string>>({});

const saved = computed(() => returns.value.find((r) => r.periodStart === period.value?.from) ?? null);
const lodged = computed(() => saved.value?.status === 'lodged');
/** A lodged return shows what was lodged, not today's numbers. */
const figures = computed<ReturnFigures | null>(() => (lodged.value ? saved.value!.figures : report.value?.figures ?? null));

const inputs = computed<ReturnInputs>(() =>
  lodged.value
    ? saved.value!.inputs
    : {
        ...Object.fromEntries(form.value.inputs.map((i) => [i.key, parseMoney(typed.value[i.key] || '0', books.value.currency) ?? 0])),
        ...(form.value.adjustments ? adjustmentTotals(adjustments.value, context.value) : {}),
      },
);
const rows = computed(() => (figures.value ? form.value.rows(figures.value, inputs.value, books.value.taxPeriod) : []));
/** Positive to pay, negative for a refund. */
const net = computed(() => (figures.value ? form.value.net(figures.value, inputs.value) : 0));

async function load() {
  if (!period.value) return;
  loading.value = true;
  try {
    [report.value, returns.value] = await Promise.all([
      api.taxReturnReport({ from: period.value.from, to: period.value.to, basis: basis.value }),
      api.listTaxReturns(),
    ]);
  } catch (e) {
    toast({ title: errorMessage(e), tone: 'error' });
  } finally {
    loading.value = false;
  }
}

// Switching periods picks up whatever was saved for it.
watch(saved, (s) => {
  adjustments.value = (s?.adjustments ?? []).map(({ gst: _, ...a }) => a);
  typed.value = Object.fromEntries(
    form.value.inputs.map((i) => [i.key, s?.inputs[i.key] ? toInput(s.inputs[i.key], books.value.currency) : '']),
  );
  if (s) basis.value = s.basis;
});
watch([periodKey, basis], load);
onMounted(() => {
  if (form.value.adjustments) void api.listCategories().then((c) => (categories.value = c));
  periodKey.value = (periods.value.find((p) => !p.current) ?? periods.value[0]).from;
});

async function save(lodge: boolean) {
  if (lodge) {
    const ok = await confirmModal({
      title: `Mark ${period.value.label} as lodged?`,
      content:
        `Do this once you have filed it with ${form.value.authority} (${form.value.lodgeWhere}). Transactions and invoices up to ` +
        `${formatDay(period.value.to)} will be locked so the figures can't drift. You can reopen it later if you need to amend.`,
      primaryActionLabel: 'Mark as lodged',
      secondaryActionLabel: 'Cancel',
    });
    if (!ok) return;
  }
  saving.value = true;
  try {
    session.books = (await api.saveTaxReturn({
      periodStart: period.value.from,
      periodEnd: period.value.to,
      basis: basis.value,
      inputs: inputs.value,
      adjustments: adjustments.value,
      lodge,
    })) as typeof session.books;
    toast({ title: lodge ? `${form.value.short} marked as lodged` : 'Draft saved', tone: 'success' });
    await load();
  } catch (e) {
    toast({ title: errorMessage(e), tone: 'error' });
  } finally {
    saving.value = false;
  }
}

async function reopen() {
  const ok = await confirmModal({
    title: `Reopen this ${form.value.short}?`,
    content: `The period unlocks so you can fix transactions. Remember to file an amendment with ${form.value.authority} if the figures change.`,
    primaryActionLabel: 'Reopen',
    secondaryActionLabel: 'Cancel',
  });
  if (!ok) return;
  try {
    session.books = await api.reopenTaxReturn(saved.value!.id);
    toast({ title: `${form.value.short} reopened` });
    await load();
  } catch (e) {
    toast({ title: errorMessage(e), tone: 'error' });
  }
}

// ---- NZ GST adjustments (IR372) -----------------------------------------------
// They fill in Boxes 9 and 13. Shares of GST claimed are worked out from the
// period's purchases (entertainment from the year to date).

const adjustments = ref<Adjustment[]>([]);
const context = computed<AdjustmentContext>(() => report.value?.context ?? { period: {}, yearToDate: {} });
const categories = ref<Category[]>([]);
const categoryName = (id: number | null | undefined) => categories.value.find((c) => c.id === id)?.name ?? 'a deleted category';
/** Lodged returns show the GST each adjustment came to when it was lodged. */
const adjustmentRows = computed(() =>
  (lodged.value ? saved.value!.adjustments : adjustments.value).map((a, i) => ({
    i,
    a,
    def: ADJUSTMENT_MAP[a.type],
    gst: lodged.value ? a.gst ?? 0 : adjustmentGst(a, context.value),
  })),
);

function describe(a: Adjustment) {
  const def = ADJUSTMENT_MAP[a.type];
  if (def?.how === 'percent') {
    const base = (def.yearToDate ? context.value.yearToDate : context.value.period)[a.categoryId ?? -1] ?? 0;
    return `${def.fixedPercent ?? a.percent}% of ${money(threeTwentyThirds(base))} GST claimed on ${categoryName(a.categoryId)}${def.yearToDate ? ' this year' : ''}`;
  }
  if (def?.how === 'inclusive') return `3/23 of ${money(a.amount ?? 0)}`;
  return 'GST amount';
}

const adjusting = ref(false);
const adjustIndex = ref<number | null>(null);
const adj = ref({ type: 'private-use' as AdjustmentType, description: '', amount: '', categoryId: null as number | null, percent: '' });
const adjError = ref<string | null>(null);
const adjDef = computed(() => ADJUSTMENT_MAP[adj.value.type]);
const adjTypeOptions = computed(() =>
  (form.value.adjustments ?? []).map((d) => ({ label: `Box ${d.box}: ${d.label}`, value: d.type, description: d.help })),
);
const adjCategoryOptions = computed(() =>
  categories.value.filter((c) => c.kind === 'expense' && c.class === 'pnl' && !c.archived).map((c) => ({ label: c.name, value: c.id })),
);
/** The adjustment being edited, as it would be saved. */
const adjDraft = computed<Adjustment>(() => ({
  type: adj.value.type,
  description: adj.value.description.trim(),
  ...(adjDef.value?.how === 'percent'
    ? { categoryId: adj.value.categoryId, percent: adjDef.value.fixedPercent ?? Number(adj.value.percent) }
    : { amount: parseMoney(adj.value.amount, books.value.currency) ?? 0 }),
}));

function openAdjustment(i?: number) {
  adjError.value = null;
  adjustIndex.value = i ?? null;
  const a = i === undefined ? null : adjustments.value[i];
  adj.value = {
    type: a?.type ?? 'private-use',
    description: a?.description ?? '',
    amount: a?.amount ? toInput(a.amount, books.value.currency) : '',
    categoryId: a?.categoryId ?? null,
    percent: a?.percent != null ? String(a.percent) : '',
  };
  adjusting.value = true;
}

function saveAdjustment() {
  const d = adjDraft.value;
  const def = adjDef.value;
  if (def.how === 'percent' && !d.categoryId) adjError.value = 'Choose the category the GST was claimed on.';
  else if (def.how === 'percent' && !(d.percent! > 0 && d.percent! <= 100)) adjError.value = 'Enter a percentage between 0 and 100.';
  else if (def.how !== 'percent' && !(d.amount! > 0)) adjError.value = 'Enter an amount.';
  else adjError.value = null;
  if (adjError.value) return;
  if (adjustIndex.value === null) adjustments.value.push(d);
  else adjustments.value[adjustIndex.value] = d;
  adjusting.value = false;
}

function removeAdjustment(i: number) {
  adjustments.value.splice(i, 1);
}

// ---- paying ----------------------------------------------------------------------
// Payments and refunds go to the tax categories, which stay off Profit & Loss
// and off the return itself.

const paying = ref(false);
const pay = ref({ amount: '', date: today(), accountId: null as number | null });
const payError = ref<string | null>(null);
const payAccounts = ref<{ label: string; value: number }[]>([]);
const refund = computed(() => net.value < 0);

async function openPay() {
  payError.value = null;
  const accounts = await api.listAccounts();
  payAccounts.value = accounts.filter((a) => !a.archived).map((a) => ({ label: a.name, value: a.id }));
  // Roughly when it's due: about four weeks after the period ends (BAS and GST alike).
  const due = addDays(period.value!.to, 28);
  pay.value = {
    amount: toInput(Math.abs(net.value), books.value.currency),
    date: due < today() ? due : today(),
    accountId: payAccounts.value[0]?.value ?? null,
  };
  paying.value = true;
}

async function savePay() {
  const amount = parseMoney(pay.value.amount, books.value.currency);
  if (!amount || amount <= 0 || !pay.value.accountId) {
    payError.value = 'Enter the amount and account.';
    return;
  }
  const cats = await api.listCategories();
  const kind = refund.value ? 'income' : 'expense';
  const cat =
    cats.find((c) => c.kind === kind && c.class === 'tax' && /gst|bas/i.test(c.name) && !c.archived) ??
    cats.find((c) => c.kind === kind && c.class === 'tax' && !c.archived);
  if (!cat) {
    payError.value = `Add a ${kind} category with the type “Tax payment or refund” first (Categories).`;
    return;
  }
  try {
    await api.saveEntry({
      date: pay.value.date,
      kind,
      amount,
      accountId: pay.value.accountId,
      categoryId: cat.id,
      memo: `${form.value.short} ${period.value!.label}`,
    });
    paying.value = false;
    dataChanged();
    toast({ title: refund.value ? 'Refund recorded' : 'Payment recorded', content: `Saved under ${cat.name}. It doesn't count as an expense.`, tone: 'success' });
  } catch (e) {
    payError.value = errorMessage(e);
  }
}

// ---- detail ------------------------------------------------------------------

const labelFilter = ref<string>('all');
const detailRows = computed(() =>
  (report.value?.detail ?? []).filter((r) => labelFilter.value === 'all' || r.labels.includes(labelFilter.value)),
);
const labelOptions = computed(() => [
  { label: 'All transactions', value: 'all' },
  ...form.value.filters.map((l) => ({ label: form.value.kind === 'nz-gst' ? `Box ${l}` : l, value: l })),
]);
const detailColumns: DataTableColumnType[] = [
  { key: 'date', label: 'Date', width: 110 },
  { key: 'memo', label: 'Description', minWidth: 200 },
  { key: 'taxCode', label: 'Tax code', width: 140, formatFunc: (v) => TAX_CODE_MAP[v as keyof typeof TAX_CODE_MAP]?.label ?? v },
  { key: 'labels', label: 'Boxes', width: 140, formatFunc: (v) => (v as string[]).join(', ') },
  { key: 'gross', label: 'Amount', width: 120 },
  { key: 'tax', label: 'GST', width: 100 },
];

function openRow(r: TaxReturnDetailRow) {
  if (r.invoiceId) void router.push(`/invoices/${r.invoiceId}`);
}

function exportCsv() {
  if (!report.value) return;
  void saveCsv(`${form.value.short} ${period.value.from} to ${period.value.to}`, [
    ['Date', 'Kind', 'Description', 'Contact', 'Category', 'Tax code', 'Boxes', 'Amount (inc. GST)', 'GST'],
    ...report.value.detail.map((r) => [
      r.date,
      r.kind,
      r.memo ?? '',
      r.contactName ?? '',
      r.categoryName ?? '',
      r.taxCode,
      r.labels.join(' '),
      csvMoney(r.gross),
      csvMoney(r.tax),
    ]),
  ]);
}

const historyHeads = computed(() => form.value.headline({}).map((h) => h.label));
</script>

<template>
  <Page
    :title="form.kind === 'bas' ? 'BAS & GST' : 'GST return'"
    :breadcrumbs="[{ label: 'Reports', onAction: () => router.push('/reports') }]"
    size="wide"
    :primary-action="{ label: 'Export detail CSV', icon: 'mdi:file-delimited-outline', onAction: exportCsv }"
    :secondary-actions="[{ label: 'Print', icon: 'mdi:printer-outline', onAction: () => printElement(sheet) }]"
  >
    <Banner v-if="!books.taxEnabled" status="info" title="GST is turned off">
      Turn on “Registered for GST” in Settings to track GST and prepare your {{ form.short }}.
    </Banner>

    <div class="Controls">
      <Select v-model="periodKey" label="Period" :options="periodOptions" show-description />
      <div>
        <div class="Label">Accounting basis</div>
        <SegmentedControl
          v-model="basis"
          :disabled="lodged"
          :options="[{ label: 'Cash', value: 'cash' }, { label: 'Accrual', value: 'accrual' }]"
        />
      </div>
      <Badge v-if="lodged" status="success">Lodged {{ saved?.lodgedAt ? formatDay(saved.lodgedAt.slice(0, 10)) : '' }}</Badge>
      <Badge v-else-if="saved">Draft saved</Badge>
      <Badge v-else-if="period?.current" status="info">Period still running</Badge>
    </div>

    <Banner v-if="report && report.untagged && !lodged" status="warning" title="Some transactions have no tax code">
      {{ report.untagged }} transaction{{ report.untagged === 1 ? '' : 's' }} in this period aren't on the {{ form.short }}. Give their categories a tax code in
      <a href="#/categories">Categories</a>.
    </Banner>

    <div class="Grid">
      <Card>
        <CardSection>
          <div ref="sheet" class="Sheet" :class="{ Loading: loading }">
            <div class="ReportHead">
              <h2>{{ books.name }}: {{ form.title }}</h2>
              <p>
                {{ period ? `${period.label} · ${formatDay(period.from)} – ${formatDay(period.to)}` : '' }}
                · {{ basis === 'cash' ? 'Cash' : 'Accrual' }} basis
                <template v-if="books.taxId"> · {{ profile.taxId.label }} {{ books.taxId }}</template>
              </p>
            </div>

            <table v-if="figures" class="Report">
              <tbody>
                <template v-for="r in rows" :key="r.code">
                  <tr v-if="r.section" class="Report__section"><td colspan="3">{{ r.section }}</td></tr>
                  <tr :class="{ Report__grand: r.grand }">
                    <td class="Code">{{ r.code }}</td>
                    <td>{{ r.label }} <span v-if="r.help" class="subdued Small">{{ r.help }}</span></td>
                    <td class="num">
                      <TextField v-if="r.input && !lodged" v-model="typed[r.input]" align="right" placeholder="0" class="no-print Input" />
                      <template v-else>{{ boxMoney(r.value) }}</template>
                    </td>
                  </tr>
                </template>
              </tbody>
            </table>
            <p class="subdued Note">{{ form.note(books.taxPeriod) }}</p>
          </div>
        </CardSection>
        <CardSection v-if="figures">
          <div class="Actions">
            <template v-if="lodged">
              <Button v-if="net !== 0" type="primary" icon="mdi:bank-transfer" @click="openPay">
                {{ refund ? 'Record the refund' : `Record payment to ${form.authority}` }}
              </Button>
              <Button @click="reopen">Reopen to amend</Button>
            </template>
            <template v-else>
              <Button :loading="saving" @click="save(false)">Save draft</Button>
              <Button type="primary" :disabled="saving || period?.current" @click="save(true)">Mark as lodged…</Button>
              <span v-if="period?.current" class="subdued Small">You can lodge once the period has ended.</span>
            </template>
          </div>
        </CardSection>
      </Card>

      <Card title="How this works">
        <CardSection>
          <ol class="Steps">
            <li v-for="step in form.steps" :key="step">{{ step }}</li>
            <li>Come back and <strong>mark it as lodged</strong>. That locks the period so the numbers can't change underneath you.</li>
          </ol>
          <p class="subdued Small">
            Tiny Tally works the figures out from your transactions' tax codes. It doesn't lodge for you. Check with your
            accountant if you're unsure about anything.
          </p>
        </CardSection>
      </Card>
    </div>

    <Card v-if="form.adjustments" title="GST adjustments" class="Detail">
      <CardSection>
        <p class="subdued Small Hint">
          From IRD's calculation sheet (IR372). Debit adjustments add to Box 9, credit adjustments to Box 13. Keep
          a note of how you worked each one out.
        </p>
        <table v-if="adjustmentRows.length" class="Report">
          <thead>
            <tr><th class="Code">Box</th><th>Adjustment</th><th>Worked out as</th><th class="num">GST</th><th v-if="!lodged" /></tr>
          </thead>
          <tbody>
            <tr v-for="r in adjustmentRows" :key="r.i">
              <td class="Code">{{ r.def?.box }}</td>
              <td>{{ r.def?.label ?? r.a.type }}<div v-if="r.a.description" class="subdued Small">{{ r.a.description }}</div></td>
              <td class="subdued">{{ describe(r.a) }}</td>
              <td class="num">{{ money(r.gst) }}</td>
              <td v-if="!lodged" class="num RowActions">
                <Button type="plain" size="small" icon="mdi:pencil-outline" tooltip="Edit" @click="openAdjustment(r.i)" />
                <Button type="plain" size="small" icon="mdi:close" tooltip="Remove" @click="removeAdjustment(r.i)" />
              </td>
            </tr>
          </tbody>
        </table>
        <p v-else class="subdued">No adjustments for this period.</p>
        <div v-if="!lodged" class="Actions AddAdj">
          <Button icon="mdi:plus" @click="openAdjustment()">Add adjustment</Button>
          <span v-if="adjustmentRows.length" class="subdued Small">Save the draft to keep them.</span>
        </div>
      </CardSection>
    </Card>

    <Card title="Transactions in this period" class="Detail">
      <CardSection>
        <Select v-model="labelFilter" :options="labelOptions" class="Filter" />
      </CardSection>
      <DataTable
        :columns="detailColumns"
        :rows="detailRows"
        :loading="loading"
        empty-text="No GST transactions in this period."
        @click-row="openRow"
      >
        <template #col:date="{ row }">{{ formatDay(row.date) }}</template>
        <template #col:memo="{ row }">
          <div>{{ row.memo || row.contactName || '—' }}</div>
          <div class="subdued Small">{{ [row.contactName, row.categoryName].filter(Boolean).join(' · ') }}</div>
        </template>
        <template #col:gross="{ row }">
          <span class="money" :class="{ subdued: row.kind === 'expense' }">{{ row.kind === 'expense' ? '−' : '' }}{{ money(row.gross) }}</span>
        </template>
        <template #col:tax="{ row }">
          <span class="money">{{ money(row.tax) }}</span>
        </template>
      </DataTable>
    </Card>

    <Card v-if="returns.length" title="History" class="Detail">
      <CardSection>
        <table class="Report">
          <thead>
            <tr>
              <th>Period</th>
              <th>Status</th>
              <th v-for="h in historyHeads" :key="h" class="num">{{ h }}</th>
              <th class="num">To pay</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in returns" :key="r.id" class="Clickable" @click="periodKey = r.periodStart">
              <td>{{ formatDay(r.periodStart) }} – {{ formatDay(r.periodEnd) }}</td>
              <td>
                <Badge :status="r.status === 'lodged' ? 'success' : undefined">{{ r.status === 'lodged' ? 'Lodged' : 'Draft' }}</Badge>
              </td>
              <td v-for="h in form.headline(r.figures)" :key="h.label" class="num">{{ boxMoney(h.value) }}</td>
              <td class="num">{{ boxMoney(form.net(r.figures, r.inputs)) }}</td>
            </tr>
          </tbody>
        </table>
      </CardSection>
    </Card>
    <Modal
      :visible="paying"
      :title="refund ? `Refund from ${form.authority}` : `Pay ${form.authority}`"
      :primary-action="{ label: refund ? 'Record refund' : 'Record payment', onAction: savePay }"
      :secondary-actions="[{ label: 'Cancel', onAction: () => (paying = false) }]"
      overflow-visible
      @close="paying = false"
    >
      <ModalSection>
        <FormLayout>
          <TextField v-model="pay.amount" label="Amount" :prefix="books.currency" align="right" :error="payError" />
          <DatePicker v-model="pay.date" type="date" model-format="YYYY-MM-DD" :label="refund ? 'Date received' : 'Date paid'" />
          <Select v-model="pay.accountId" :label="refund ? 'Received into' : 'Paid from'" :options="payAccounts" />
        </FormLayout>
      </ModalSection>
    </Modal>
    <Modal
      :visible="adjusting"
      :title="adjustIndex === null ? 'Add a GST adjustment' : 'Edit GST adjustment'"
      :primary-action="{ label: adjustIndex === null ? 'Add' : 'Save', onAction: saveAdjustment }"
      :secondary-actions="[{ label: 'Cancel', onAction: () => (adjusting = false) }]"
      overflow-visible
      @close="adjusting = false"
    >
      <ModalSection>
        <FormLayout>
          <Select v-model="adj.type" label="Adjustment" :options="adjTypeOptions" show-description :help-text="adjDef?.help" />
          <template v-if="adjDef?.how === 'percent'">
            <Select v-model="adj.categoryId" label="Category the GST was claimed on" :options="adjCategoryOptions" />
            <TextField
              v-if="!adjDef.fixedPercent"
              v-model="adj.percent"
              :label="adj.type === 'exempt-use' ? 'Share used for exempt supplies' : 'Private share'"
              suffix="%"
              inputmode="decimal"
            />
          </template>
          <TextField
            v-else
            v-model="adj.amount"
            :label="adjDef?.how === 'inclusive' ? 'Amount including GST' : 'GST amount'"
            :prefix="books.currency"
            align="right"
          />
          <TextField v-model="adj.description" label="Note (optional)" placeholder="e.g. Phone, 30% private" />
          <p class="Preview">
            Comes to <strong>{{ money(adjustmentGst(adjDraft, context)) }}</strong> of GST in Box {{ adjDef?.box }}.
          </p>
          <p v-if="adjError" class="Error">{{ adjError }}</p>
        </FormLayout>
      </ModalSection>
    </Modal>
  </Page>
</template>

<style scoped>
.Hint {
  margin: 0 0 12px;
}

.RowActions {
  white-space: nowrap;
}

.AddAdj {
  margin-top: 12px;
}

.Preview {
  margin: 0;
}

.Error {
  margin: 0;
  color: var(--octans-text-error);
}

.Controls {
  display: flex;
  align-items: flex-end;
  flex-wrap: wrap;
  gap: 16px;
  margin-bottom: 16px;
}

.Controls > :first-child {
  min-width: 260px;
}

.Label {
  font-size: 13px;
  margin-bottom: 6px;
}

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

.Loading {
  opacity: 0.6;
}

.Code {
  width: 48px;
  font-weight: 700;
  color: var(--octans-text-subdued);
}

.Input {
  max-width: 140px;
  margin-left: auto;
}

.Small {
  font-size: 12px;
}

.Note {
  margin: 16px 0 0;
  font-size: 12px;
}

.Actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.Steps {
  margin: 0 0 12px;
  padding-left: 20px;
  display: grid;
  gap: 8px;
}

.Detail {
  margin-top: 16px;
}

.Filter {
  max-width: 220px;
}

.Clickable {
  cursor: pointer;
}

.Clickable:hover td {
  background: var(--octans-surface-hover);
}
</style>
