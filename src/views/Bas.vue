<script setup lang="ts">
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
import { api, errorMessage, type BasDetailRow, type BasFigures, type BasReport, type BasReturn, type Basis } from '../lib/api';
import { csvMoney, saveCsv } from '../lib/csv';
import { addDays, formatDay, today } from '../lib/dates';
import { dataChanged } from '../lib/entryEditor';
import { formatMoney, parseMoney, toInput } from '../lib/money';
import { taxPeriods } from '../lib/periods';
import { printElement } from '../lib/print';
import { session } from '../lib/session';
import { TAX_CODE_MAP } from '../shared/tax';

const router = useRouter();
const company = computed(() => session.company!);
const money = (v: number) => formatMoney(v, company.value.currency);
/** The BAS is lodged in whole dollars; the ATO says to drop the cents. */
const dollars = (cents: number) => Math.trunc(cents / 100);
const wholeMoney = (cents: number) => formatMoney(dollars(cents) * 100, company.value.currency).replace(/\.00$/, '');

const periods = computed(() => taxPeriods(company.value.basFrequency, company.value.fiscalYearStart, 12));
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

const basis = ref<Basis>(company.value.taxBasis);
const report = ref<BasReport | null>(null);
const returns = ref<BasReturn[]>([]);
const loading = ref(false);
const saving = ref(false);
const sheet = ref<HTMLElement | null>(null);
const w = ref({ w1: '', w2: '', t7: '' });

const saved = computed(() => returns.value.find((r) => r.periodStart === period.value?.from) ?? null);
const lodged = computed(() => saved.value?.status === 'lodged');
/** A lodged return shows what was lodged, not today's numbers. */
const figures = computed<BasFigures | null>(() => (lodged.value ? saved.value!.figures : report.value?.figures ?? null));

const amounts = computed(() => ({
  w1: lodged.value ? saved.value!.w1 : parseMoney(w.value.w1 || '0', company.value.currency) ?? 0,
  w2: lodged.value ? saved.value!.w2 : parseMoney(w.value.w2 || '0', company.value.currency) ?? 0,
  t7: lodged.value ? saved.value!.t7 : parseMoney(w.value.t7 || '0', company.value.currency) ?? 0,
}));

const summary = computed(() => {
  const f = figures.value;
  if (!f) return null;
  const a8 = dollars(f['1A']) + dollars(amounts.value.w2) + dollars(amounts.value.t7);
  const b8 = dollars(f['1B']);
  return { a8, b8, nine: a8 - b8 };
});

async function load() {
  if (!period.value) return;
  loading.value = true;
  try {
    [report.value, returns.value] = await Promise.all([
      api.basReport({ from: period.value.from, to: period.value.to, basis: basis.value }),
      api.listBasReturns(),
    ]);
  } catch (e) {
    toast({ title: errorMessage(e), tone: 'error' });
  } finally {
    loading.value = false;
  }
}

// Switching periods picks up whatever was saved for it.
watch(saved, (s) => {
  w.value = s
    ? { w1: toInput(s.w1, company.value.currency), w2: toInput(s.w2, company.value.currency), t7: toInput(s.t7, company.value.currency) }
    : { w1: '', w2: '', t7: '' };
  if (s) basis.value = s.basis;
});
watch([periodKey, basis], load);
onMounted(() => {
  periodKey.value = (periods.value.find((p) => !p.current) ?? periods.value[0]).from;
});

async function save(lodge: boolean) {
  if (lodge) {
    const ok = await confirmModal({
      title: `Mark ${period.value.label} as lodged?`,
      content:
        'Do this once you have lodged it with the ATO (Business Portal, online services or your agent). Transactions and invoices up to ' +
        `${formatDay(period.value.to)} will be locked so the figures can't drift. You can reopen it later if you need to amend.`,
      primaryActionLabel: 'Mark as lodged',
      secondaryActionLabel: 'Cancel',
    });
    if (!ok) return;
  }
  saving.value = true;
  try {
    session.company = (await api.saveBasReturn({
      periodStart: period.value.from,
      periodEnd: period.value.to,
      basis: basis.value,
      ...amounts.value,
      lodge,
    })) as typeof session.company;
    toast({ title: lodge ? 'BAS marked as lodged' : 'Draft saved', tone: 'success' });
    await load();
  } catch (e) {
    toast({ title: errorMessage(e), tone: 'error' });
  } finally {
    saving.value = false;
  }
}

async function reopen() {
  const ok = await confirmModal({
    title: 'Reopen this BAS?',
    content: 'The period unlocks so you can fix transactions. Remember to lodge a revision with the ATO if the figures change.',
    primaryActionLabel: 'Reopen',
    secondaryActionLabel: 'Cancel',
  });
  if (!ok) return;
  try {
    session.company = await api.reopenBasReturn(saved.value!.id);
    toast({ title: 'BAS reopened' });
    await load();
  } catch (e) {
    toast({ title: errorMessage(e), tone: 'error' });
  }
}

// ---- paying the ATO ----------------------------------------------------------------
// Payments and refunds go to the tax categories, which stay off Profit & Loss
// and off the BAS itself.

const paying = ref(false);
const pay = ref({ amount: '', date: today(), accountId: null as number | null });
const payError = ref<string | null>(null);
const payAccounts = ref<{ label: string; value: number }[]>([]);
const refund = computed(() => (summary.value?.nine ?? 0) < 0);

async function openPay() {
  payError.value = null;
  const accounts = await api.listAccounts();
  payAccounts.value = accounts.filter((a) => !a.archived).map((a) => ({ label: a.name, value: a.id }));
  // Quarterly BAS is due on the 28th of the month after the quarter (Q2 in February).
  const due = addDays(period.value!.to, 28);
  pay.value = {
    amount: toInput(Math.abs(summary.value!.nine) * 100, company.value.currency),
    date: due < today() ? due : today(),
    accountId: payAccounts.value[0]?.value ?? null,
  };
  paying.value = true;
}

async function savePay() {
  const amount = parseMoney(pay.value.amount, company.value.currency);
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
      memo: `BAS ${period.value!.label}`,
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
const labelOptions = [
  { label: 'All transactions', value: 'all' },
  ...['G1', 'G2', 'G3', 'G4', 'G10', 'G11', '1A', '1B'].map((l) => ({ label: l, value: l })),
];
const detailColumns: DataTableColumnType[] = [
  { key: 'date', label: 'Date', width: 110 },
  { key: 'memo', label: 'Description', minWidth: 200 },
  { key: 'taxCode', label: 'Tax code', width: 140, formatFunc: (v) => TAX_CODE_MAP[v as keyof typeof TAX_CODE_MAP]?.label ?? v },
  { key: 'labels', label: 'Labels', width: 140, formatFunc: (v) => (v as string[]).join(', ') },
  { key: 'gross', label: 'Amount', width: 120 },
  { key: 'tax', label: 'GST', width: 100 },
];

function openRow(r: BasDetailRow) {
  if (r.invoiceId) void router.push(`/invoices/${r.invoiceId}`);
}

function exportCsv() {
  if (!report.value) return;
  void saveCsv(`BAS ${period.value.from} to ${period.value.to}`, [
    ['Date', 'Kind', 'Description', 'Contact', 'Category', 'Tax code', 'Labels', 'Amount (inc. GST)', 'GST'],
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

const LABELS: { key: keyof BasFigures; label: string; help: string }[] = [
  { key: 'G1', label: 'Total sales', help: 'Including GST, and including GST-free and export sales' },
  { key: 'G2', label: 'Export sales', help: '' },
  { key: 'G3', label: 'Other GST-free sales', help: '' },
  { key: 'G10', label: 'Capital purchases', help: 'Including GST' },
  { key: 'G11', label: 'Non-capital purchases', help: 'Including GST' },
];
const simpler = computed(() => company.value.basFrequency !== 'monthly');
</script>

<template>
  <Page
    title="BAS & GST"
    :breadcrumbs="[{ label: 'Reports', onAction: () => router.push('/reports') }]"
    size="wide"
    :primary-action="{ label: 'Export detail CSV', icon: 'mdi:file-delimited-outline', onAction: exportCsv }"
    :secondary-actions="[{ label: 'Print', icon: 'mdi:printer-outline', onAction: () => printElement(sheet) }]"
  >
    <Banner v-if="!company.taxEnabled" status="info" title="GST is turned off">
      Turn on “Registered for GST” in Settings to track GST and prepare your BAS.
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
      {{ report.untagged }} transaction{{ report.untagged === 1 ? '' : 's' }} in this period aren't on the BAS. Give their categories a tax code in
      <a href="#/categories">Categories</a>.
    </Banner>

    <div class="Grid">
      <Card>
        <CardSection>
          <div ref="sheet" class="Sheet" :class="{ Loading: loading }">
            <div class="ReportHead">
              <h2>{{ company.name }}: Business Activity Statement</h2>
              <p>
                {{ period ? `${period.label} · ${formatDay(period.from)} – ${formatDay(period.to)}` : '' }}
                · {{ basis === 'cash' ? 'Cash' : 'Accrual' }} basis
                <template v-if="company.abn"> · ABN {{ company.abn }}</template>
              </p>
            </div>

            <table v-if="figures && summary" class="Report">
              <tbody>
                <tr class="Report__section"><td colspan="3">GST on sales and purchases</td></tr>
                <template v-for="l in LABELS" :key="l.key">
                  <tr v-if="!simpler || l.key === 'G1'">
                    <td class="Code">{{ l.key }}</td>
                    <td>{{ l.label }} <span v-if="l.help" class="subdued Small">{{ l.help }}</span></td>
                    <td class="num">{{ wholeMoney(figures[l.key]) }}</td>
                  </tr>
                </template>
                <tr>
                  <td class="Code">1A</td>
                  <td>GST on sales</td>
                  <td class="num">{{ wholeMoney(figures['1A']) }}</td>
                </tr>
                <tr>
                  <td class="Code">1B</td>
                  <td>GST on purchases</td>
                  <td class="num">{{ wholeMoney(figures['1B']) }}</td>
                </tr>

                <tr class="Report__section"><td colspan="3">PAYG withholding and instalments</td></tr>
                <tr>
                  <td class="Code">W1</td>
                  <td>Total salary, wages and other payments</td>
                  <td class="num">
                    <span v-if="lodged">{{ wholeMoney(amounts.w1) }}</span>
                    <TextField v-else v-model="w.w1" align="right" placeholder="0" class="no-print Input" />
                  </td>
                </tr>
                <tr>
                  <td class="Code">W2</td>
                  <td>Amounts withheld from payments at W1</td>
                  <td class="num">
                    <span v-if="lodged">{{ wholeMoney(amounts.w2) }}</span>
                    <TextField v-else v-model="w.w2" align="right" placeholder="0" class="no-print Input" />
                  </td>
                </tr>
                <tr>
                  <td class="Code">T7</td>
                  <td>PAYG income tax instalment</td>
                  <td class="num">
                    <span v-if="lodged">{{ wholeMoney(amounts.t7) }}</span>
                    <TextField v-else v-model="w.t7" align="right" placeholder="0" class="no-print Input" />
                  </td>
                </tr>

                <tr class="Report__section"><td colspan="3">Summary</td></tr>
                <tr>
                  <td class="Code">8A</td>
                  <td>Amounts you owe the ATO (1A + W2 + T7)</td>
                  <td class="num">{{ wholeMoney(summary.a8 * 100) }}</td>
                </tr>
                <tr>
                  <td class="Code">8B</td>
                  <td>Amounts the ATO owes you (1B)</td>
                  <td class="num">{{ wholeMoney(summary.b8 * 100) }}</td>
                </tr>
                <tr class="Report__grand">
                  <td class="Code">9</td>
                  <td>{{ summary.nine >= 0 ? 'Payable to the ATO' : 'Refund from the ATO' }}</td>
                  <td class="num">{{ wholeMoney(Math.abs(summary.nine) * 100) }}</td>
                </tr>
              </tbody>
            </table>
            <p class="subdued Note">
              Amounts are in whole dollars with cents dropped, as the ATO asks. Sales and purchases include GST.
              <template v-if="simpler">Simpler BAS only needs G1, 1A and 1B; switch to monthly reporting in Settings for the full set of labels.</template>
            </p>
          </div>
        </CardSection>
        <CardSection v-if="figures">
          <div class="Actions">
            <template v-if="lodged">
              <Button v-if="summary && summary.nine !== 0" type="primary" icon="mdi:bank-transfer" @click="openPay">
                {{ refund ? 'Record the refund' : 'Record payment to the ATO' }}
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
            <li>Check the figures. Click through the transactions below if something looks off.</li>
            <li>Enter wages (W1, W2) and any PAYG instalment (T7) if they apply to you.</li>
            <li>Copy the figures into the ATO Business Portal, or send them to your agent.</li>
            <li>Come back and <strong>mark it as lodged</strong>. That locks the period so the numbers can't change underneath you.</li>
          </ol>
          <p class="subdued Small">
            Tiny Tally works the figures out from your transactions' tax codes. It doesn't lodge for you. Check with your
            accountant if you're unsure about anything.
          </p>
        </CardSection>
      </Card>
    </div>

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
              <th class="num">1A</th>
              <th class="num">1B</th>
              <th class="num">Net GST</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in returns" :key="r.id" class="Clickable" @click="periodKey = r.periodStart">
              <td>{{ formatDay(r.periodStart) }} – {{ formatDay(r.periodEnd) }}</td>
              <td>
                <Badge :status="r.status === 'lodged' ? 'success' : undefined">{{ r.status === 'lodged' ? 'Lodged' : 'Draft' }}</Badge>
              </td>
              <td class="num">{{ wholeMoney(r.figures['1A']) }}</td>
              <td class="num">{{ wholeMoney(r.figures['1B']) }}</td>
              <td class="num">{{ wholeMoney(r.figures['1A'] - r.figures['1B']) }}</td>
            </tr>
          </tbody>
        </table>
      </CardSection>
    </Card>
    <Modal
      :visible="paying"
      :title="refund ? 'Refund from the ATO' : 'Pay the ATO'"
      :primary-action="{ label: refund ? 'Record refund' : 'Record payment', onAction: savePay }"
      :secondary-actions="[{ label: 'Cancel', onAction: () => (paying = false) }]"
      overflow-visible
      @close="paying = false"
    >
      <ModalSection>
        <FormLayout>
          <TextField v-model="pay.amount" label="Amount" :prefix="company.currency" align="right" :error="payError" />
          <DatePicker v-model="pay.date" type="date" model-format="YYYY-MM-DD" :label="refund ? 'Date received' : 'Date paid'" />
          <Select v-model="pay.accountId" :label="refund ? 'Received into' : 'Paid from'" :options="payAccounts" />
        </FormLayout>
      </ModalSection>
    </Modal>
  </Page>
</template>

<style scoped>
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
