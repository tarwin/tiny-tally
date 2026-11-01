<script setup lang="ts">
// Bank reconciliation: enter the statement's closing balance, tick what's on
// the statement, and finish when the cleared balance matches.
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  Banner,
  Button,
  Card,
  CardSection,
  Checkbox,
  DatePicker,
  FormLayout,
  FormLayoutGroup,
  Page,
  TextField,
  ToggleSwitch,
  confirmModal,
  toast,
} from '@octans/ui';
import { api, errorMessage, type ReconcileRow, type ReconcileState } from '../lib/api';
import { formatDay, formatShortDay, today } from '../lib/dates';
import { dataChanged, dataVersion, newEntry } from '../lib/entryEditor';
import { formatMoney, parseMoney, toInput } from '../lib/money';
import { session } from '../lib/session';
import { matchStatement, readStatement, type StatementLine } from '../lib/statementMatch';

const route = useRoute();
const router = useRouter();
const accountId = computed(() => Number(route.params.id));
const currency = computed(() => session.books!.currency);
const money = (v: number) => formatMoney(v, currency.value);

const state = ref<ReconcileState | null>(null);
const showLater = ref(false);
const busy = ref(false);

const isCard = computed(() => state.value?.account.kind === 'credit_card');
/** Card statements show what's owed as a positive number; we store it negative. */
const shown = (v: number) => (isCard.value ? -v : v);

function lastMonthEnd() {
  const d = new Date();
  const end = new Date(d.getFullYear(), d.getMonth(), 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}`;
}

const start = ref({ date: lastMonthEnd(), balance: '' });
const startError = ref<string | null>(null);
const editingStatement = ref(false);

async function load() {
  try {
    state.value = await api.reconcileState(accountId.value);
    if (state.value.open && !editingStatement.value) {
      start.value = { date: state.value.open.statementDate, balance: toInput(shown(state.value.open.statementBalance), currency.value) };
    }
  } catch (e) {
    toast({ title: errorMessage(e), tone: 'error' });
    await router.replace('/accounts');
  }
}
watch([accountId, dataVersion], load);
onMounted(load);

async function begin() {
  const v = parseMoney(start.value.balance, currency.value);
  if (v === null) {
    startError.value = isCard.value ? 'Enter the amount owed on the statement.' : 'Enter the closing balance on the statement.';
    return;
  }
  startError.value = null;
  busy.value = true;
  try {
    await api.startReconcile({ accountId: accountId.value, statementDate: start.value.date, statementBalance: isCard.value ? -v : v });
    editingStatement.value = false;
    await load();
  } catch (e) {
    startError.value = errorMessage(e);
  } finally {
    busy.value = false;
  }
}

const visibleRows = computed(() => {
  const s = state.value;
  if (!s?.open) return [];
  return s.rows.filter((r) => showLater.value || r.date <= s.open!.statementDate || r.ticked);
});
const laterCount = computed(() => (state.value?.open ? state.value.rows.filter((r) => r.date > state.value!.open!.statementDate && !r.ticked).length : 0));

async function setTicked(rows: ReconcileRow[], cleared: boolean) {
  const s = state.value;
  if (!s?.open || !rows.length) return;
  // Feels instant; the reload corrects it if the save fails.
  for (const r of rows) r.ticked = cleared;
  const delta = rows.reduce((t, r) => t + r.signed, 0) * (cleared ? 1 : -1);
  s.open.cleared += delta;
  s.open.difference -= delta;
  try {
    await api.tick(s.open.id, rows.map((r) => r.id), cleared);
  } catch (e) {
    toast({ title: errorMessage(e), tone: 'error' });
    await load();
  }
}

// ---- statement file ----------------------------------------------------------------
// Ticks what a downloaded statement shows, and lists what it shows that the
// books don't have yet.
const matching = ref(false);
const fileResult = ref<{ name: string; ticked: number; near: number; unmatched: StatementLine[] } | null>(null);

async function matchFile() {
  const s = state.value;
  if (!s?.open) return;
  const path = await tiny.dialog.openFile({ types: ['ofx', 'qbo', 'qfx', 'csv', 'txt', 'xlsx'] });
  if (!path) return;
  matching.value = true;
  try {
    const file = await readStatement(path, session.books!.country);
    const { matched, unmatched } = matchStatement(file.lines, s.rows, s.open.statementDate);
    await setTicked(matched.map((m) => m.row), true);
    fileResult.value = { name: file.name, ticked: matched.length, near: matched.filter((m) => !m.exact).length, unmatched };
  } catch (e) {
    toast({ title: "Couldn't read that statement", content: errorMessage(e), tone: 'error' });
  } finally {
    matching.value = false;
  }
}

function addMissing(line: StatementLine) {
  newEntry(line.signed > 0 ? 'income' : 'expense', accountId.value, null, { amount: Math.abs(line.signed), date: line.date, memo: line.memo });
}

// A missing line that's since been added drops off the list.
watch(
  () => state.value?.rows,
  (rows) => {
    const r = fileResult.value;
    if (!r || !rows) return;
    r.unmatched = r.unmatched.filter((l) => !rows.some((row) => row.date === l.date && row.signed === l.signed && !row.ticked));
  },
);

const allTicked = computed(() => visibleRows.value.length > 0 && visibleRows.value.every((r) => r.ticked));

async function finish() {
  busy.value = true;
  try {
    await api.finishReconcile(state.value!.open!.id);
    dataChanged();
    toast({ title: `Reconciled to ${formatDay(state.value!.open!.statementDate)}`, tone: 'success' });
    await load();
  } catch (e) {
    toast({ title: errorMessage(e), tone: 'error' });
  } finally {
    busy.value = false;
  }
}

async function cancel() {
  const ok = await confirmModal({
    title: 'Stop this reconciliation?',
    content: 'Your ticks are cleared. Nothing else changes.',
    primaryActionLabel: 'Stop',
    primaryActionType: 'destructive',
    secondaryActionLabel: 'Keep going',
  });
  if (!ok) return;
  await api.cancelReconcile(state.value!.open!.id);
  start.value = { date: lastMonthEnd(), balance: '' };
  await load();
}

async function undo(id: number, date: string) {
  const ok = await confirmModal({
    title: `Undo the reconciliation to ${formatDay(date)}?`,
    content: 'It reopens with the same ticks so you can fix it and finish again.',
    primaryActionLabel: 'Undo',
    secondaryActionLabel: 'Cancel',
  });
  if (!ok) return;
  try {
    await api.undoReconcile(id);
    dataChanged();
    await load();
  } catch (e) {
    toast({ title: errorMessage(e), tone: 'error' });
  }
}

function describe(r: ReconcileRow) {
  if (r.kind === 'transfer') return r.memo || `Transfer · ${r.otherAccount}`;
  const who = r.contactName && r.memo ? `${r.contactName}: ${r.memo}` : r.contactName || r.memo;
  return who || r.categoryName || (r.invoiceNumber ? `Payment · ${r.invoiceNumber}` : '—');
}

const differenceText = computed(() => {
  const d = state.value?.open?.difference ?? 0;
  return d === 0 ? 'Balanced' : money(Math.abs(shown(d)));
});
</script>

<template>
  <Page
    :title="state ? `Reconcile ${state.account.name}` : 'Reconcile'"
    :subtitle="state ? (state.start.date ? `Last reconciled to ${formatDay(state.start.date)} at ${money(shown(state.start.balance))}` : 'Never reconciled. Starting from the opening balance.') : ''"
    :breadcrumbs="[
      { label: 'Money accounts', onAction: () => router.push('/accounts') },
      ...(state ? [{ label: state.account.name, onAction: () => router.push(`/accounts/${accountId}`) }] : []),
    ]"
    size="wide"
    :loading="!state"
  >
    <template v-if="state">
      <Card v-if="!state.open || editingStatement" :title="editingStatement ? 'Change statement' : 'Start with your statement'">
        <CardSection>
          <p class="subdued Lead">
            Get your {{ isCard ? 'card' : 'bank' }} statement for {{ state.account.name }}. Tick each transaction that appears on it
            until the balances match. That proves the books agree with the {{ isCard ? 'card issuer' : 'bank' }}.
          </p>
          <FormLayout>
            <FormLayoutGroup>
              <DatePicker v-model="start.date" type="date" model-format="YYYY-MM-DD" label="Statement end date" :max="today()" />
              <TextField
                v-model="start.balance"
                :label="isCard ? 'Amount owed on the statement' : 'Closing balance on the statement'"
                :prefix="currency"
                align="right"
                :error="startError"
                @keydown.enter="begin"
              />
            </FormLayoutGroup>
            <div class="Row">
              <Button type="primary" :loading="busy" @click="begin">{{ editingStatement ? 'Save' : 'Start reconciling' }}</Button>
              <Button v-if="editingStatement" type="plain" @click="editingStatement = false">Cancel</Button>
            </div>
          </FormLayout>
        </CardSection>
      </Card>

      <template v-else>
        <div class="Summary">
          <div>
            <div class="subdued Small">Statement {{ formatDay(state.open.statementDate) }}</div>
            <div class="money Big">{{ money(shown(state.open.statementBalance)) }}</div>
          </div>
          <div>
            <div class="subdued Small">Cleared in Tiny Tally</div>
            <div class="money Big">{{ money(shown(state.open.cleared)) }}</div>
          </div>
          <div>
            <div class="subdued Small">Difference</div>
            <div class="money Big" :class="state.open.difference === 0 ? 'Ok' : 'Off'">{{ differenceText }}</div>
          </div>
          <div class="Summary__actions">
            <Button type="primary" icon="mdi:check" :disabled="state.open.difference !== 0" :loading="busy" @click="finish">Finish</Button>
            <Button type="plain" @click="editingStatement = true">Change statement</Button>
            <Button type="plain" @click="cancel">Stop</Button>
          </div>
        </div>

        <Banner v-if="state.open.difference !== 0 && allTicked" status="warning" title="Everything's ticked but it doesn't balance">
          Look for something on the statement that isn't here yet (bank fees and interest are the usual ones), a typo in an amount,
          or a transaction dated after the statement.
        </Banner>

        <Banner
          v-if="fileResult"
          :status="fileResult.unmatched.length ? 'warning' : 'success'"
          :title="`Ticked ${fileResult.ticked} from ${fileResult.name}`"
          @close="fileResult = null"
        >
          <p v-if="fileResult.near" class="FileNote">
            {{ fileResult.near }} matched on amount with a date a day or two apart. Glance over the ticks to be sure.
          </p>
          <template v-if="fileResult.unmatched.length">
            <p class="FileNote">
              {{ fileResult.unmatched.length === 1 ? 'This line is' : `These ${fileResult.unmatched.length} lines are` }}
              on the statement but not in Tiny Tally:
            </p>
            <table class="Report Missing">
              <tbody>
                <tr v-for="(l, i) in fileResult.unmatched" :key="i">
                  <td class="money">{{ formatShortDay(l.date) }}</td>
                  <td>{{ l.memo || '—' }}</td>
                  <td class="num money">{{ money(l.signed) }}</td>
                  <td class="num"><Button size="small" type="plain" icon="mdi:plus" @click="addMissing(l)">Add</Button></td>
                </tr>
              </tbody>
            </table>
          </template>
        </Banner>

        <Card>
          <CardSection>
            <div class="Toolbar">
              <Checkbox
                :model-value="allTicked"
                label="Tick all shown"
                @update:model-value="(v: boolean) => setTicked(visibleRows.filter((r) => r.ticked !== v), v)"
              />
              <ToggleSwitch v-if="laterCount" v-model="showLater" :label="`Show ${laterCount} after the statement date`" />
              <span class="Spacer" />
              <Button
                size="small"
                icon="mdi:file-compare"
                :loading="matching"
                tooltip="Tick everything a downloaded statement (OFX, QBO, CSV or Excel) shows, matched on date and amount"
                @click="matchFile"
              >
                Match statement file…
              </Button>
              <Button size="small" icon="mdi:plus" @click="newEntry('expense', accountId)">Add missing transaction</Button>
            </div>
            <table class="Report Rec">
              <thead>
                <tr>
                  <th class="Rec__tick" />
                  <th>Date</th>
                  <th>Description</th>
                  <th class="num">{{ isCard ? 'Charges' : 'Money out' }}</th>
                  <th class="num">{{ isCard ? 'Payments' : 'Money in' }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-if="!visibleRows.length">
                  <td colspan="5" class="subdued">Nothing left to tick up to this date.</td>
                </tr>
                <tr
                  v-for="r in visibleRows"
                  :key="r.id"
                  class="Rec__row"
                  :class="{ 'Rec__row--on': r.ticked, 'Rec__row--late': r.date > state.open.statementDate }"
                  @click="setTicked([r], !r.ticked)"
                >
                  <td class="Rec__tick" @click.stop>
                    <Checkbox :model-value="r.ticked" :label="false" @update:model-value="(v: boolean) => setTicked([r], v)" />
                  </td>
                  <td class="money">{{ formatShortDay(r.date) }}</td>
                  <td>{{ describe(r) }}</td>
                  <td class="num money">{{ r.signed < 0 ? money(-r.signed) : '' }}</td>
                  <td class="num money">{{ r.signed > 0 ? money(r.signed) : '' }}</td>
                </tr>
              </tbody>
            </table>
          </CardSection>
        </Card>
      </template>

      <Card v-if="state.history.length" title="Past reconciliations">
        <CardSection>
          <table class="Report">
            <thead>
              <tr><th>Statement date</th><th class="num">Balance</th><th class="num">Transactions</th><th /></tr>
            </thead>
            <tbody>
              <tr v-for="(h, i) in state.history" :key="h.id">
                <td>{{ formatDay(h.statementDate) }}</td>
                <td class="num money">{{ money(shown(h.statementBalance)) }}</td>
                <td class="num">{{ h.count }}</td>
                <td class="num">
                  <Button v-if="i === 0 && !state.open" type="plain" size="small" @click="undo(h.id, h.statementDate)">Undo</Button>
                </td>
              </tr>
            </tbody>
          </table>
        </CardSection>
      </Card>
    </template>
  </Page>
</template>

<style scoped>
.Lead {
  margin: 0 0 16px;
  max-width: 640px;
}

.Row {
  display: flex;
  gap: 8px;
}

.Summary {
  position: sticky;
  top: 0;
  z-index: 2;
  display: grid;
  grid-template-columns: repeat(3, minmax(120px, 1fr)) auto;
  gap: 16px;
  align-items: center;
  padding: 14px 18px;
  margin-bottom: 16px;
  border-radius: 12px;
  background: var(--octans-surface);
  border: 1px solid var(--octans-border);
  box-shadow: 0 4px 16px rgb(0 0 0 / 6%);
}

.Summary__actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.Small {
  font-size: 12px;
}

.Big {
  font-size: 20px;
  font-weight: 600;
}

.Ok {
  color: var(--octans-text-success);
}

.Off {
  color: var(--octans-text-warning);
}

.Toolbar {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 8px;
}

.Spacer {
  flex: 1;
}

.FileNote {
  margin: 0 0 6px;
}

.Missing td {
  padding: 4px 8px;
}

.Rec__tick {
  width: 36px;
}

.Rec__row {
  cursor: pointer;
}

.Rec__row:hover td {
  background: var(--octans-surface-hover);
}

.Rec__row--on td {
  color: var(--octans-text-subdued);
}

.Rec__row--late td:nth-child(2) {
  color: var(--octans-text-warning);
}

@media (max-width: 900px) {
  .Summary {
    grid-template-columns: repeat(3, 1fr);
  }

  .Summary__actions {
    grid-column: 1 / -1;
    justify-content: flex-start;
  }
}
</style>
