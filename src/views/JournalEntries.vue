<script setup lang="ts">
// Manual journal entries: depreciation, accruals, prepayments, corrections.
// Everything else in the ledger is derived from transactions and documents.
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import {
  Button,
  DataTable,
  DatePicker,
  FormLayout,
  FormLayoutGroup,
  Modal,
  ModalSection,
  Page,
  Select,
  TextField,
  ToggleSwitch,
  confirmModal,
  toast,
  type DataTableColumnType,
} from '@octans/ui';
import { api, errorMessage, type JournalAccount, type JournalEntryRow } from '../lib/api';
import { addDays, formatDay, today } from '../lib/dates';
import { dataChanged, dataVersion } from '../lib/entryEditor';
import { formatMoney, parseMoney, toInput } from '../lib/money';
import { booksProfile, session } from '../lib/session';

const router = useRouter();
const currency = computed(() => session.books!.currency);
const money = (v: number) => formatMoney(v, currency.value);

const rows = ref<JournalEntryRow[]>([]);
const accounts = ref<JournalAccount[]>([]);
const loading = ref(true);

const columns: DataTableColumnType[] = [
  { key: 'date', label: 'Date', width: 130 },
  { key: 'reference', label: 'Reference', width: 130 },
  { key: 'memo', label: 'Description', minWidth: 200 },
  { key: 'total', label: 'Amount', width: 130 },
];

async function load() {
  loading.value = true;
  try {
    [rows.value, accounts.value] = await Promise.all([api.listJournals(), api.journalAccounts()]);
  } finally {
    loading.value = false;
  }
}
watch(dataVersion, load);
onMounted(load);

// ---- editor ------------------------------------------------------------------------
type LineForm = { account: string | null; debit: string; credit: string; memo: string };
const blankLine = (): LineForm => ({ account: null, debit: '', credit: '', memo: '' });

const visible = ref(false);
const saving = ref(false);
const error = ref<string | null>(null);
const form = ref({
  id: undefined as number | undefined,
  date: today(),
  reference: '',
  memo: '',
  lines: [blankLine(), blankLine()],
  reverse: false,
  reverseDate: '',
});

const accountGroups = computed(() => {
  const keep = new Set(form.value.lines.map((l) => l.account));
  const groups = new Map<string, { label: string; value: string }[]>();
  for (const a of accounts.value) {
    if (a.archived && !keep.has(a.key)) continue;
    (groups.get(a.group) ?? groups.set(a.group, []).get(a.group)!).push({ label: a.name, value: a.key });
  }
  return [...groups.entries()].map(([title, options]) => ({ title, options }));
});

const amounts = computed(() =>
  form.value.lines.map((l) => (parseMoney(l.debit, currency.value) ?? 0) - (parseMoney(l.credit, currency.value) ?? 0)),
);
const debits = computed(() => amounts.value.filter((a) => a > 0).reduce((s, a) => s + a, 0));
const credits = computed(() => -amounts.value.filter((a) => a < 0).reduce((s, a) => s + a, 0));
const outOfBalance = computed(() => debits.value - credits.value);

function firstOfNextMonth(iso: string) {
  const [y, m] = iso.split('-').map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
}

function openNew() {
  error.value = null;
  form.value = { id: undefined, date: today(), reference: '', memo: '', lines: [blankLine(), blankLine()], reverse: false, reverseDate: '' };
  visible.value = true;
}

async function openExisting(r: JournalEntryRow) {
  try {
    const j = await api.getJournal(r.id);
    error.value = null;
    form.value = {
      id: j.id,
      date: j.date,
      reference: j.reference ?? '',
      memo: j.memo ?? '',
      lines: j.lines.map((l) => ({
        account: l.account,
        debit: l.amount > 0 ? toInput(l.amount, currency.value) : '',
        credit: l.amount < 0 ? toInput(-l.amount, currency.value) : '',
        memo: l.memo ?? '',
      })),
      reverse: false,
      reverseDate: '',
    };
    visible.value = true;
  } catch (e) {
    toast({ title: errorMessage(e), tone: 'error' });
  }
}

// Typing a debit clears the credit on the same line, and the other way round.
function setSide(l: LineForm, side: 'debit' | 'credit', v: string) {
  l[side] = v;
  if (v.trim()) l[side === 'debit' ? 'credit' : 'debit'] = '';
}

/** Puts the difference on a line so the entry balances. */
function balanceLine(i: number) {
  const l = form.value.lines[i];
  const others = amounts.value.reduce((s, a, j) => (j === i ? s : s + a), 0);
  l.debit = others < 0 ? toInput(-others, currency.value) : '';
  l.credit = others > 0 ? toInput(others, currency.value) : '';
}

async function save() {
  const f = form.value;
  const lines = f.lines
    .map((l, i) => ({ account: l.account, amount: amounts.value[i], memo: l.memo.trim() || null }))
    .filter((l) => l.amount !== 0 || l.account);
  if (lines.some((l) => !l.account && l.amount)) return void (error.value = 'Choose an account for every line with an amount.');
  if (lines.filter((l) => l.amount).length < 2) return void (error.value = 'Enter at least one debit and one credit.');
  if (outOfBalance.value !== 0) return void (error.value = `Debits and credits are ${money(Math.abs(outOfBalance.value))} apart.`);
  if (f.reverse && (!f.reverseDate || f.reverseDate <= f.date)) return void (error.value = 'Pick a reversal date after the journal date.');
  error.value = null;
  saving.value = true;
  const payload = lines.filter((l) => l.amount).map((l) => ({ account: l.account!, amount: l.amount, memo: l.memo }));
  try {
    await api.saveJournal({ id: f.id, date: f.date, reference: f.reference, memo: f.memo, lines: payload });
    if (f.reverse) {
      // The usual accrual: it undoes itself when the real bill arrives next period.
      await api.saveJournal({
        date: f.reverseDate,
        reference: f.reference ? `${f.reference} reversal` : null,
        memo: `Reversal: ${f.memo || 'journal of ' + formatDay(f.date)}`,
        lines: payload.map((l) => ({ ...l, amount: -l.amount })),
      });
    }
    dataChanged();
    toast({ title: f.reverse ? 'Journal and reversal saved' : 'Journal saved', tone: 'success' });
    visible.value = false;
  } catch (e) {
    error.value = errorMessage(e);
  } finally {
    saving.value = false;
  }
}

async function remove() {
  const id = form.value.id;
  if (!id) return;
  const ok = await confirmModal({
    title: 'Delete this journal entry?',
    content: "Reports go back to how they were without it. This can't be undone.",
    primaryActionLabel: 'Delete',
    primaryActionType: 'destructive',
    secondaryActionLabel: 'Cancel',
  });
  if (!ok) return;
  try {
    await api.deleteJournal(id);
    dataChanged();
    visible.value = false;
    toast({ title: 'Journal deleted' });
  } catch (e) {
    toast({ title: errorMessage(e), tone: 'error' });
  }
}

watch(
  () => form.value.reverse,
  (on) => {
    if (on && !form.value.reverseDate) form.value.reverseDate = firstOfNextMonth(form.value.date);
  },
);
</script>

<template>
  <Page
    title="Journal entries"
    subtitle="Depreciation, accruals, prepayments and corrections: adjustments that aren't money moving."
    :primary-action="{ label: 'New journal', icon: 'mdi:plus', onAction: openNew }"
    :secondary-actions="[{ label: 'General journal', icon: 'mdi:book-open-variant', onAction: () => router.push('/reports/journal') }]"
  >
    <DataTable
      :columns="columns"
      :rows="rows"
      :loading="loading"
      empty-text="No journal entries yet. Most books never need one; your accountant may ask for depreciation at year end."
      @click-row="openExisting"
    >
      <template #col:date="{ row }">{{ formatDay(row.date) }}</template>
      <template #col:reference="{ row }">{{ row.reference || `J${row.id}` }}</template>
      <template #col:memo="{ row }">{{ row.memo || '' }}</template>
      <template #col:total="{ row }"><span class="money">{{ money(row.total) }}</span></template>
    </DataTable>

    <Modal
      :visible="visible"
      :title="form.id ? 'Edit journal' : 'New journal'"
      :loading="saving"
      :primary-action="{ label: 'Save', onAction: save }"
      :secondary-actions="[{ label: 'Cancel', onAction: () => (visible = false) }]"
      :tertiary-actions="
        form.id
          ? [
              { label: 'Delete', type: 'destructive', onAction: remove },
              { label: 'History', onAction: () => { visible = false; router.push({ path: '/activity', query: { table: 'journals', id: form.id } }); } },
            ]
          : []
      "
      :dialog-style="{ width: '860px' }"
      overflow-visible
      @close="visible = false"
    >
      <ModalSection>
        <FormLayout>
          <FormLayoutGroup>
            <DatePicker v-model="form.date" type="date" model-format="YYYY-MM-DD" label="Date" required />
            <TextField v-model="form.reference" label="Reference (optional)" placeholder="e.g. DEP-2026" />
          </FormLayoutGroup>
          <TextField v-model="form.memo" label="Description" placeholder="e.g. Depreciation on equipment, FY2026" />

          <table class="Lines">
            <thead>
              <tr>
                <th>Account</th>
                <th>Line note</th>
                <th class="num">Debit</th>
                <th class="num">Credit</th>
                <th />
              </tr>
            </thead>
            <tbody>
              <tr v-for="(l, i) in form.lines" :key="i">
                <td class="Lines__account">
                  <Select v-model="l.account" :option-groups="accountGroups" :options="[]" searchable placeholder="Choose…" :label="false" />
                </td>
                <td><TextField v-model="l.memo" :label="false" placeholder="Optional" /></td>
                <td class="Lines__money">
                  <TextField :model-value="l.debit" :label="false" align="right" placeholder="0.00" @update:model-value="(v) => setSide(l, 'debit', String(v ?? ''))" />
                </td>
                <td class="Lines__money">
                  <TextField :model-value="l.credit" :label="false" align="right" placeholder="0.00" @update:model-value="(v) => setSide(l, 'credit', String(v ?? ''))" />
                </td>
                <td class="Lines__actions">
                  <Button
                    v-if="outOfBalance !== 0"
                    type="plain"
                    size="small"
                    icon="mdi:scale-balance"
                    tooltip="Put the difference here"
                    @click="balanceLine(i)"
                  />
                  <Button
                    type="plain"
                    size="small"
                    icon="mdi:close"
                    tooltip="Remove line"
                    :disabled="form.lines.length <= 2"
                    @click="form.lines.splice(i, 1)"
                  />
                </td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td colspan="2">
                  <Button size="small" type="plain" icon="mdi:plus" @click="form.lines.push(blankLine())">Add line</Button>
                </td>
                <td class="num money">{{ money(debits) }}</td>
                <td class="num money">{{ money(credits) }}</td>
                <td />
              </tr>
              <tr v-if="outOfBalance !== 0">
                <td colspan="5" class="num Off">
                  Out of balance by {{ money(Math.abs(outOfBalance)) }} (more {{ outOfBalance > 0 ? 'debits' : 'credits' }})
                </td>
              </tr>
            </tfoot>
          </table>

          <div v-if="!form.id" class="Reverse">
            <ToggleSwitch v-model="form.reverse" label="Reverse it on" />
            <DatePicker v-if="form.reverse" v-model="form.reverseDate" type="date" model-format="YYYY-MM-DD" :min="addDays(form.date, 1)" />
            <span class="subdued Small">For accruals: undoes itself in the next period, when the real bill or invoice is recorded.</span>
          </div>

          <p v-if="error" class="Error">{{ error }}</p>
          <p class="subdued Small">
            Journals can use any category plus {{ booksProfile().tax?.account ?? 'GST' }}, opening balance equity, accrued expenses, prepayments and accumulated
            depreciation. Money accounts, receivables and payables change through transactions, invoices and bills
            instead.
          </p>
        </FormLayout>
      </ModalSection>
    </Modal>
  </Page>
</template>

<style scoped>
.Lines {
  width: 100%;
  border-collapse: collapse;
}

.Lines th {
  font-size: 12px;
  font-weight: 600;
  color: var(--octans-text-subdued);
  text-align: left;
  padding: 0 4px 4px;
}

.Lines td {
  padding: 3px 4px;
  vertical-align: middle;
}

.Lines .num {
  text-align: right;
  white-space: nowrap;
}

.Lines tfoot td {
  padding-top: 8px;
  font-weight: 600;
}

.Lines__account {
  width: 32%;
}

.Lines__money {
  width: 16%;
}

.Lines__actions {
  width: 72px;
  white-space: nowrap;
  text-align: right;
}

.Off {
  color: var(--octans-text-warning);
}

.Error {
  margin: 0;
  color: var(--octans-text-error);
}

.Reverse {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.Small {
  font-size: 12px;
  margin: 0;
}
</style>
