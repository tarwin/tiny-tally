<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  Badge,
  Banner,
  Button,
  Card,
  CardSection,
  Checkbox,
  Icon,
  Page,
  SegmentedControl,
  Select,
  ToggleSwitch,
  toast,
} from '@octans/ui';
import {
  api,
  errorMessage,
  type Account,
  type Category,
  type ImportBatch,
  type ImportResult,
  type ImportTarget,
} from '../lib/api';
import { CLASS_INFO } from '../lib/categoryClass';
import { dataChanged } from '../lib/entryEditor';
import { formatShortDay } from '../lib/dates';
import { formatMoney } from '../lib/money';
import { session } from '../lib/session';
import { IIF_TYPE_LABELS, looksLikeIif, parseIif } from '../lib/import/iif';
import { looksLikeOfx, parseOfx } from '../lib/import/ofx';
import {
  csvToBatch,
  csvToContacts,
  guessBankMapping,
  guessContactMapping,
  looksLikeContacts,
  type BankMapping,
  type ContactMapping,
} from '../lib/import/csvImport';
import { detectDateOrder, localeDateOrder, parseCsv, type DateOrder } from '../lib/import/parse';
import { looksLikeQboReport, parseQboReport } from '../lib/import/qboReport';
import { readXlsx } from '../lib/import/xlsx';
import { hashRef, type ImportCategory } from '../shared/import';

const route = useRoute();
const router = useRouter();
const company = computed(() => session.company!);
const money = (v: number) => formatMoney(v, company.value.currency);

type Step = 'pick' | 'review' | 'done';
const step = ref<Step>('pick');
const busy = ref(false);
const fileName = ref('');
const text = ref('');
const format = ref<'iif' | 'ofx' | 'csv' | 'qbo'>('csv');
/** Excel files are read into rows; text files into `text`. */
const excel = ref(false);

const accounts = ref<Account[]>([]);
const categories = ref<Category[]>([]);

// ---- step 1: choose a file ------------------------------------------------------

async function chooseFile() {
  const path = await tiny.dialog.openFile({ types: ['iif', 'qbo', 'qfx', 'ofx', 'csv', 'txt', 'xlsx'] });
  if (path) await loadFile(path);
}

async function loadFile(path: string) {
  busy.value = true;
  try {
    const file = await api.readImportFile(path);
    [accounts.value, categories.value] = await Promise.all([api.listAccounts(), api.listCategories()]);
    fileName.value = file.name;
    excel.value = !!file.base64;
    if (file.base64) {
      csvRows.value = await readXlsx(Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0)));
      text.value = '';
      format.value = looksLikeQboReport(csvRows.value) ? 'qbo' : 'csv';
    } else {
      text.value = file.text;
      format.value = looksLikeIif(file.text) ? 'iif' : looksLikeOfx(file.text) ? 'ofx' : 'csv';
      if (format.value === 'csv') {
        csvRows.value = parseCsv(file.text);
        if (looksLikeQboReport(csvRows.value)) format.value = 'qbo';
      }
    }
    await setupFormat();
    step.value = 'review';
  } catch (e) {
    toast({ title: "Couldn't read that file", content: errorMessage(e), tone: 'error' });
  } finally {
    busy.value = false;
  }
}

// Files dropped on the window come here as ?file=… (see App.vue).
async function fromQuery() {
  const file = route.query.file;
  if (typeof file !== 'string' || !file) return;
  void router.replace('/import');
  await loadFile(file);
}
watch(() => route.query.file, fromQuery);
onMounted(fromQuery);

// ---- parsing ---------------------------------------------------------------------

// Ambiguous dates (03/10/2026) follow the company's country: only US-dollar
// books default to month-first. The webview's locale is often en-US even in
// Australia, so it's only the tie-breaker for currencies we can't place.
const MONTH_FIRST = new Set(['USD', 'PHP']);
const DAY_FIRST = new Set(['AUD', 'NZD', 'GBP', 'EUR', 'ZAR', 'INR', 'SGD', 'HKD', 'MYR', 'IDR', 'THB', 'VND', 'CHF']);
const fallbackOrder: DateOrder = MONTH_FIRST.has(company.value.currency)
  ? 'mdy'
  : DAY_FIRST.has(company.value.currency)
    ? 'dmy'
    : localeDateOrder() === 'mdy' ? 'mdy' : 'dmy';
const iifDateOrder = ref<DateOrder>('mdy');
const csvRows = ref<string[][]>([]);
const csvMode = ref<'bank' | 'customer' | 'vendor'>('bank');
const bankMap = ref<BankMapping | null>(null);
const contactMap = ref<ContactMapping | null>(null);
const csvAccountKey = 'csv-account';

// ---- remembered CSV columns ----
// Each bank's export has its own columns; the mapping is saved per header row.
type SavedMapping = { mode: 'bank' | 'customer' | 'vendor'; bank: BankMapping | null; contact: ContactMapping | null };
const mappingKey = computed(() => {
  const head = csvRows.value[0] ?? [];
  return head.some((c) => /[a-z]/i.test(c)) ? `csv-mapping:${hashRef(...head.map((c) => c.trim().toLowerCase()))}` : null;
});
const mappingRestored = ref(false);

async function setupFormat() {
  mappingRestored.value = false;
  if (format.value === 'iif') {
    iifDateOrder.value = parseIif(text.value, undefined, fallbackOrder).dateOrder;
  } else if (format.value === 'qbo') {
    iifDateOrder.value = parseQboReport(csvRows.value, undefined, fallbackOrder).dateOrder;
  } else if (format.value === 'csv') {
    csvMode.value = looksLikeContacts(csvRows.value) ? 'customer' : 'bank';
    const order = detectDateOrder(csvRows.value.slice(0, 200).flat(), fallbackOrder);
    bankMap.value = guessBankMapping(csvRows.value, order);
    contactMap.value = csvRows.value.length ? guessContactMapping(csvRows.value) : null;
    const saved = mappingKey.value ? await api.getPref<SavedMapping>(mappingKey.value).catch(() => null) : null;
    if (saved) {
      csvMode.value = saved.mode;
      if (saved.bank) bankMap.value = saved.bank;
      if (saved.contact) contactMap.value = saved.contact;
      mappingRestored.value = true;
    }
  }
  initTargets();
}

function rememberMapping() {
  if (format.value !== 'csv' || !mappingKey.value) return;
  const saved: SavedMapping = { mode: csvMode.value, bank: bankMap.value, contact: contactMap.value };
  void api.setPref(mappingKey.value, JSON.parse(JSON.stringify(saved))).catch(() => {});
}

const parsed = computed(() => {
  if (format.value === 'iif') return parseIif(text.value, iifDateOrder.value);
  if (format.value === 'qbo') return parseQboReport(csvRows.value, iifDateOrder.value);
  return null;
});
const batch = computed<ImportBatch>(() => {
  if (parsed.value) return parsed.value;
  if (format.value === 'ofx') return parseOfx(text.value);
  if (csvMode.value !== 'bank' && contactMap.value) return csvToContacts(csvRows.value, contactMap.value, csvMode.value);
  return csvToBatch(csvRows.value, bankMap.value!, csvAccountKey, fileName.value.replace(/\.[^.]+$/, ''));
});
/** QuickBooks account type per category key ('' when unknown). */
const qbTypes = computed<Record<string, string>>(() => parsed.value?.categoryTypes ?? {});
/** Double-entry sources: categories come from the file, not payee groups. */
const ledgerFile = computed(() => format.value === 'iif' || format.value === 'qbo');

// ---- mapping targets ---------------------------------------------------------------

const accountTargets = ref<Record<string, string>>({});
const categoryTargets = ref<Record<string, string>>({});
/** Per-payee category for bank lines (keyed by group). */
const groupCategory = ref<Record<string, number | null>>({});
const fallbackIncome = ref<number | null>(null);
const fallbackExpense = ref<number | null>(null);

function initTargets() {
  const b = batch.value;
  const acc: Record<string, string> = {};
  const activeAccounts = accounts.value.filter((a) => !a.archived);
  for (const a of b.accounts) {
    const byName = activeAccounts.find((x) => x.name.toLowerCase() === a.name.toLowerCase());
    const last4 = a.name.match(/··(\d{4})$/)?.[1];
    const byDigits = last4 ? activeAccounts.find((x) => x.name.includes(last4)) : undefined;
    // A CSV has no account details at all; the first bank account is the likely home.
    const csvGuess = format.value === 'csv' ? activeAccounts.find((x) => x.kind === 'bank') ?? activeAccounts[0] : undefined;
    const hit = byName ?? byDigits ?? csvGuess;
    acc[a.key] = hit ? `id:${hit.id}` : 'create';
  }
  accountTargets.value = acc;

  const usable = categories.value.filter((c) => !c.archived);
  /** The first of `names` that exists, in that order of preference. */
  const find = (kind: 'income' | 'expense', ...names: string[]) =>
    names.map((n) => usable.find((c) => c.kind === kind && c.name === n)).find(Boolean)?.id ??
    usable.find((c) => c.kind === kind && c.class === 'pnl')?.id ??
    null;
  fallbackIncome.value = find('income', 'Other Income', 'Sales');
  fallbackExpense.value = find('expense', 'Uncategorised Expense', 'Other Expenses');

  const cat: Record<string, string> = {};
  for (const c of b.categories) {
    const same = categories.value.find((x) => x.kind === c.kind && !x.archived && x.name.toLowerCase() === c.name.toLowerCase());
    const qbType = qbTypes.value[c.key] ?? '';
    // Payments against receivables and payables are sales and purchases on the cash basis.
    const control = qbType === 'AR' ? find('income', 'Sales', 'Other Income') : qbType === 'AP' ? fallbackExpense.value : null;
    cat[c.key] = same ? `id:${same.id}` : control ? `id:${control}` : qbType === 'NONPOSTING' ? 'skip' : 'create';
  }
  categoryTargets.value = cat;
  groupCategory.value = {};
  remember.value = {};
  void suggest();
}

watch(
  () => [format.value === 'qbo' ? iifDateOrder.value : null, csvMode.value, bankMap.value?.amount, bankMap.value?.debit, bankMap.value?.credit, bankMap.value?.date, bankMap.value?.description, bankMap.value?.flip, bankMap.value?.dateOrder, iifDateOrder.value],
  () => {
    if (step.value === 'review') initTargets();
  },
);

const targetOf = (v: string | undefined): ImportTarget =>
  !v || v === 'create' ? { create: true } : v === 'skip' ? { skip: true } : { existingId: Number(v.slice(3)) };

function accountOptions(kind: string, name: string) {
  return [
    { label: `Create “${name}”`, value: 'create' },
    ...accounts.value
      .filter((a) => !a.archived)
      .map((a) => ({ label: a.name, value: `id:${a.id}`, description: a.kind === kind ? undefined : a.kind === 'credit_card' ? 'Credit card' : a.kind === 'cash' ? 'Cash' : 'Bank' })),
    { label: "Don't import", value: 'skip' },
  ];
}

function categoryOptions(kind: 'income' | 'expense', name: string, cls: ImportCategory['class'] = 'pnl') {
  return [
    { label: `Create “${name}”`, value: 'create', description: cls === 'pnl' ? undefined : CLASS_INFO[cls].label },
    ...categories.value.filter((c) => c.kind === kind && !c.archived).map((c) => ({ label: c.name, value: `id:${c.id}` })),
    { label: "Don't import these", value: 'skip' },
  ];
}

const incomeCats = computed(() => categories.value.filter((c) => c.kind === 'income' && !c.archived).map((c) => ({ label: c.name, value: c.id })));
const expenseCats = computed(() => categories.value.filter((c) => c.kind === 'expense' && !c.archived).map((c) => ({ label: c.name, value: c.id })));

// ---- bank lines grouped by payee -------------------------------------------------

/** "OFFICEWORKS 0423 · EFTPOS 28/10" and "OFFICEWORKS 1187 · EFTPOS" are the same payee. */
function payeeKey(memo: string | undefined, kind: string) {
  const base = (memo ?? '')
    .toLowerCase()
    .replace(/\d+/g, ' ')
    .replace(/[^a-z&' ]+/g, ' ')
    .replace(/\b(eftpos|visa|debit|purchase|pos|card|value date|ref|reference|aus|au|nsw|vic|qld|sa|wa|tas|act|nt|pty|ltd)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return `${kind}:${base || '—'}`;
}

const groups = computed(() => {
  if (ledgerFile.value) return [];
  const map = new Map<string, { key: string; kind: 'income' | 'expense'; label: string; count: number; total: number; memos: string[] }>();
  for (const e of batch.value.entries) {
    if (e.kind === 'transfer') continue;
    const key = payeeKey(e.memo, e.kind);
    const g = map.get(key) ?? { key, kind: e.kind, label: e.memo ?? '(no description)', count: 0, total: 0, memos: [] };
    g.count++;
    g.total += e.amount;
    if (g.memos.length < 5 && e.memo) g.memos.push(e.memo);
    map.set(key, g);
  }
  return [...map.values()].sort((a, b) => b.count - a.count || b.total - a.total);
});
const GROUP_LIMIT = 150;

/** Groups whose category came from a rule, so "Remember" isn't offered twice. */
const fromRule = ref<Record<string, string>>({});
/** Groups to save as rules on import. */
const remember = ref<Record<string, boolean>>({});

/** The words every line in the group shares, e.g. "officeworks" or "corner cafe". */
function rulePattern(g: { key: string; memos: string[] }) {
  const words = g.key.slice(g.key.indexOf(':') + 1).split(' ').filter((w) => w.length > 1 && w !== '—');
  const lower = g.memos.map((m) => m.toLowerCase());
  for (let n = words.length; n > 0; n--) {
    const p = words.slice(0, n).join(' ');
    if (p.length >= 3 && lower.every((m) => m.includes(p))) return p;
  }
  return null;
}

async function suggest() {
  if (ledgerFile.value || !batch.value.entries.length) return;
  const memos = groups.value.flatMap((g) => g.memos);
  try {
    const [hits, ruled] = await Promise.all([
      api.suggestCategories(memos),
      api.matchRules(groups.value.map((g) => ({ text: g.memos.join(' | ') || g.label, kind: g.kind }))),
    ]);
    const next: Record<string, number | null> = {};
    const rules: Record<string, string> = {};
    groups.value.forEach((g, i) => {
      const r = ruled[i];
      if (r) {
        next[g.key] = r.categoryId;
        rules[g.key] = r.pattern;
      }
    });
    fromRule.value = rules;
    for (const g of groups.value) {
      if (rules[g.key]) continue;
      // Lines that only landed in the catch-all category last time teach nothing.
      const hit = g.memos
        .map((m) => hits[m])
        .find((h) => h && h.kind === g.kind && h.categoryId !== fallbackIncome.value && h.categoryId !== fallbackExpense.value);
      if (hit) next[g.key] = hit.categoryId;
    }
    groupCategory.value = { ...next, ...groupCategory.value };
  } catch {
    // Suggestions are a nicety; the user can still pick categories.
  }
}

const categorised = computed(() => groups.value.filter((g) => groupCategory.value[g.key]).reduce((t, g) => t + g.count, 0));
const ruleCount = computed(() => groups.value.filter((g) => fromRule.value[g.key] && groupCategory.value[g.key]).length);

// ---- summary + commit ---------------------------------------------------------------

const csvColumns = computed(() => {
  const head = bankMap.value?.hasHeader || contactMap.value?.hasHeader ? csvRows.value[0] ?? [] : [];
  const width = Math.max(0, ...csvRows.value.slice(0, 20).map((r) => r.length));
  return [...Array(width).keys()].map((i) => ({ label: head[i]?.trim() ? `${head[i].trim()}` : `Column ${i + 1}`, value: i }));
});
const optionalColumns = computed(() => [{ label: 'None', value: -1 }, ...csvColumns.value]);
const amountStyle = computed({
  get: () => (bankMap.value?.amount !== null ? 'one' : 'two'),
  set: (v: string) => {
    const m = bankMap.value!;
    if (v === 'one') {
      m.amount = m.debit ?? m.credit ?? csvColumns.value.find((c) => c.value !== m.date && c.value !== m.description)?.value ?? 0;
      m.debit = m.credit = null;
    } else {
      m.debit = m.amount ?? 0;
      m.credit = null;
      m.amount = null;
    }
  },
});
const nullable = (v: number | null) => v ?? -1;
const unnull = (v: number) => (v < 0 ? null : v);

const counts = computed(() => {
  const b = batch.value;
  const skippedAccounts = new Set(b.accounts.filter((a) => accountTargets.value[a.key] === 'skip').map((a) => a.key));
  const skippedCats = new Set(b.categories.filter((c) => categoryTargets.value[c.key] === 'skip').map((c) => c.key));
  const entries = b.entries.filter(
    (e) =>
      !skippedAccounts.has(e.accountKey) &&
      !(e.toAccountKey && skippedAccounts.has(e.toAccountKey)) &&
      !(e.categoryKey && skippedCats.has(e.categoryKey)),
  );
  const range = entries.reduce((r, e) => ({ from: e.date < r.from ? e.date : r.from, to: e.date > r.to ? e.date : r.to }), { from: '9999', to: '0000' });
  return {
    entries: entries.length,
    leftOut: b.entries.length - entries.length,
    contacts: b.contacts.length,
    from: range.from,
    to: range.to,
    income: entries.filter((e) => e.kind === 'income').reduce((t, e) => t + e.amount, 0),
    expense: entries.filter((e) => e.kind === 'expense').reduce((t, e) => t + e.amount, 0),
  };
});

const lockWarning = computed(() => {
  const lock = company.value.lockDate;
  if (!lock || !counts.value.entries) return null;
  const n = batch.value.entries.filter((e) => e.date <= lock).length;
  return n ? `${n} transaction${n === 1 ? ' is' : 's are'} dated on or before your lock date (${formatShortDay(lock)}) and will be left out.` : null;
});

const result = ref<ImportResult | null>(null);
const rulesSaved = ref(0);

async function commit() {
  const b = batch.value;
  busy.value = true;
  try {
    const entries = b.entries.map((e) =>
      e.kind !== 'transfer' && !e.categoryKey ? { ...e, categoryId: groupCategory.value[payeeKey(e.memo, e.kind)] ?? undefined } : e,
    );
    result.value = await api.commitImport({
      batch: { ...b, entries },
      accounts: Object.fromEntries(b.accounts.map((a) => [a.key, targetOf(accountTargets.value[a.key])])),
      categories: Object.fromEntries(b.categories.map((c) => [c.key, targetOf(categoryTargets.value[c.key])])),
      fallbackCategory: { income: fallbackIncome.value, expense: fallbackExpense.value },
    });
    rememberMapping();
    let rules = 0;
    for (const g of groups.value) {
      const pattern = remember.value[g.key] ? rulePattern(g) : null;
      const categoryId = groupCategory.value[g.key];
      if (!pattern || !categoryId) continue;
      await api.saveRule({ pattern, kind: g.kind, categoryId }).then(() => rules++, () => {});
    }
    rulesSaved.value = rules;
    dataChanged();
    step.value = 'done';
  } catch (e) {
    toast({ title: 'Import failed. Nothing was changed.', content: errorMessage(e), tone: 'error' });
  } finally {
    busy.value = false;
  }
}

function reset() {
  step.value = 'pick';
  text.value = '';
  result.value = null;
}

const formatLabel = computed(() => {
  if (format.value === 'iif') return 'QuickBooks Desktop (IIF)';
  if (format.value === 'ofx') return 'Bank statement (OFX / QBO / QFX)';
  if (format.value === 'qbo') return `QuickBooks Online ${parsed.value && 'report' in parsed.value && parsed.value.report === 'list' ? 'Transaction List' : 'Journal'}${excel.value ? ' (Excel)' : ''}`;
  return excel.value ? 'Excel spreadsheet' : 'CSV';
});
const importLabel = computed(() => {
  const n = counts.value.entries;
  const c = counts.value.contacts;
  if (n && c) return `Import ${n} transactions and ${c} contacts`;
  if (n) return `Import ${n} transaction${n === 1 ? '' : 's'}`;
  if (c) return `Import ${c} contact${c === 1 ? '' : 's'}`;
  return 'Nothing to import';
});
</script>

<template>
  <Page
    title="Import"
    subtitle="Bring in transactions and contacts from QuickBooks, your bank, or a spreadsheet."
    size="wide"
    :breadcrumbs="step !== 'pick' ? [{ label: 'Import', onAction: reset }] : undefined"
  >
    <!-- ---------------------------------------------------------------- pick -->
    <template v-if="step === 'pick'">
      <div class="Pick">
        <Card>
          <CardSection>
            <div class="Drop">
              <Icon icon="mdi:tray-arrow-down" class="Drop__icon" />
              <p class="Drop__title">Choose a file to import, or drop it on the window</p>
              <p class="subdued">IIF, QBO, QFX, OFX, CSV or Excel. You'll see everything before it's saved.</p>
              <Button type="primary" icon="mdi:file-search-outline" :loading="busy" @click="chooseFile">Choose file…</Button>
            </div>
          </CardSection>
        </Card>

        <div class="Help">
          <Card>
            <CardSection>
              <h3><Icon icon="mdi:desktop-classic" /> QuickBooks Desktop</h3>
              <p>
                <strong>File → Utilities → Export → Lists to IIF Files</strong> for your chart of accounts, customers and vendors.
                For transactions, export a date range from <strong>File → Utilities → Export</strong>, or use your bank file below.
              </p>
              <p class="subdued Small">The .QBW company file itself is a locked, proprietary format that no other app can read.</p>
            </CardSection>
          </Card>
          <Card>
            <CardSection>
              <h3><Icon icon="mdi:cloud-outline" /> QuickBooks Online</h3>
              <p>
                <strong>Reports → Journal</strong>, set the dates, then <strong>Export → Excel or CSV</strong>. That brings every
                bank and card transaction with its categories. <strong>Transaction List by Date</strong> works too.
                <strong>Customers</strong> or <strong>Suppliers → Export</strong> gives your contacts.
              </p>
            </CardSection>
          </Card>
          <Card>
            <CardSection>
              <h3><Icon icon="mdi:bank-outline" /> Your bank</h3>
              <p>
                Most banks offer <strong>OFX</strong>, <strong>QBO</strong> (QuickBooks Web Connect) or <strong>CSV</strong> downloads
                in internet banking. Re-importing is safe: transactions already brought in are skipped.
              </p>
            </CardSection>
          </Card>
        </div>
      </div>
    </template>

    <!-- -------------------------------------------------------------- review -->
    <template v-else-if="step === 'review'">
      <div class="Head">
        <div>
          <div class="Head__file"><Icon icon="mdi:file-document-outline" /> {{ fileName }}</div>
          <Badge status="info">{{ formatLabel }}</Badge>
        </div>
        <Button type="plain" @click="chooseFile">Choose a different file</Button>
      </div>

      <div class="Grid">
        <div class="Main">
          <!-- CSV columns -->
          <Card v-if="format === 'csv'" title="What's in this file?">
            <CardSection>
              <SegmentedControl
                v-model="csvMode"
                :options="[
                  { label: 'Bank transactions', value: 'bank' },
                  { label: 'Customers', value: 'customer' },
                  { label: 'Suppliers', value: 'vendor' },
                ]"
              />
            </CardSection>
            <CardSection v-if="mappingRestored">
              <p class="subdued Small Flush"><Icon icon="mdi:history" /> Using the columns you chose last time for this kind of file.</p>
            </CardSection>
            <CardSection v-if="csvMode === 'bank' && bankMap">
              <div class="Map">
                <Select v-model="bankMap.date" label="Date" :options="csvColumns" />
                <Select
                  v-model="bankMap.dateOrder"
                  label="Dates are written"
                  :options="[
                    { label: 'Day first (31/12/2026)', value: 'dmy' },
                    { label: 'Month first (12/31/2026)', value: 'mdy' },
                    { label: 'Year first (2026-12-31)', value: 'ymd' },
                  ]"
                />
                <Select v-model="bankMap.description" label="Description" :options="csvColumns" />
                <Select
                  v-model="amountStyle"
                  label="Amounts are in"
                  :options="[
                    { label: 'One column (+ in, − out)', value: 'one' },
                    { label: 'Separate in and out columns', value: 'two' },
                  ]"
                />
                <Select v-if="bankMap.amount !== null" v-model="bankMap.amount" label="Amount" :options="csvColumns" />
                <template v-else>
                  <Select :model-value="nullable(bankMap.debit)" label="Money out" :options="optionalColumns" @update:model-value="(v: number) => (bankMap!.debit = unnull(v))" />
                  <Select :model-value="nullable(bankMap.credit)" label="Money in" :options="optionalColumns" @update:model-value="(v: number) => (bankMap!.credit = unnull(v))" />
                </template>
              </div>
              <div class="Toggles">
                <ToggleSwitch v-model="bankMap.hasHeader" label="First row is column names" />
                <ToggleSwitch v-model="bankMap.flip" label="Flip signs (purchases show as positive)" />
              </div>
            </CardSection>
            <CardSection v-else-if="contactMap">
              <div class="Map">
                <Select v-model="contactMap.name" label="Name" :options="csvColumns" />
                <Select :model-value="nullable(contactMap.email)" label="Email" :options="optionalColumns" @update:model-value="(v: number) => (contactMap!.email = unnull(v))" />
                <Select :model-value="nullable(contactMap.phone)" label="Phone" :options="optionalColumns" @update:model-value="(v: number) => (contactMap!.phone = unnull(v))" />
              </div>
              <p class="subdued Small">
                Address from: {{ contactMap.address.map((i) => csvColumns[i]?.label).join(', ') || 'no address columns found' }}
              </p>
            </CardSection>
          </Card>

          <Card v-if="ledgerFile" title="Dates">
            <CardSection>
              <SegmentedControl
                v-model="iifDateOrder"
                :options="[
                  { label: 'Month first (US QuickBooks)', value: 'mdy' },
                  { label: 'Day first (AU, UK, NZ…)', value: 'dmy' },
                ]"
              />
              <p class="subdued Small">
                Check the dates in the summary look right. Exports follow the date format
                {{ format === 'qbo' ? 'of your QuickBooks region' : 'of the computer QuickBooks ran on' }}.
              </p>
            </CardSection>
          </Card>

          <!-- Accounts -->
          <Card v-if="batch.accounts.length && !(format === 'csv' && csvMode !== 'bank')" title="Accounts">
            <CardSection>
              <div v-for="a in batch.accounts" :key="a.key" class="MapRow">
                <div class="MapRow__from">
                  <div class="MapRow__name">{{ format === 'csv' ? 'Transactions in this file' : a.name }}</div>
                  <div class="subdued Small">
                    {{ a.kind === 'credit_card' ? 'Credit card' : 'Bank account' }}
                    <template v-if="a.openingBalance"> · <span class="Nowrap">opening balance {{ money(a.openingBalance) }}</span></template>
                  </div>
                </div>
                <Icon icon="mdi:arrow-right" class="subdued" />
                <Select v-model="accountTargets[a.key]" :options="accountOptions(a.kind, a.name)" class="MapRow__to" />
              </div>
            </CardSection>
          </Card>

          <!-- QuickBooks categories -->
          <Card v-if="batch.categories.length" title="Categories">
            <CardSection>
              <p class="subdued Small Top">
                Equity, loans, tax and asset accounts come across as categories that don't count towards profit.
                Payments against receivables and payables count as sales and purchases.
              </p>
              <div v-for="c in batch.categories" :key="c.key" class="MapRow">
                <div class="MapRow__from">
                  <div class="MapRow__name">{{ c.name }}</div>
                  <div class="subdued Small">
                    {{ c.kind === 'income' ? 'Money in' : 'Money out' }}
                    <template v-if="qbTypes[c.key]"> · QuickBooks {{ IIF_TYPE_LABELS[qbTypes[c.key]] ?? qbTypes[c.key] }}</template>
                  </div>
                </div>
                <Icon icon="mdi:arrow-right" class="subdued" />
                <Select v-model="categoryTargets[c.key]" :options="categoryOptions(c.kind, c.name, c.class)" searchable show-description class="MapRow__to" />
              </div>
            </CardSection>
          </Card>

          <!-- Bank lines by payee -->
          <Card v-if="groups.length" title="Categorise">
            <CardSection>
              <p class="subdued Small Top">
                Lines are grouped by payee. Pick a category once and it applies to every line in the group.
                {{ categorised }} of {{ batch.entries.length }} lines have a category{{ ruleCount ? ` (${ruleCount} payee${ruleCount === 1 ? '' : 's'} from your rules)` : categorised ? ' (some from your past transactions)' : '' }}.
                Tick <strong>Remember</strong> to categorise that payee the same way next time.
              </p>
              <div v-for="g in groups.slice(0, GROUP_LIMIT)" :key="g.key" class="Group">
                <div class="Group__info">
                  <div class="Group__label" :title="g.memos.join('\n')">{{ g.label }}</div>
                  <div class="subdued Small">
                    {{ g.count }} line{{ g.count === 1 ? '' : 's' }} ·
                    <span :class="g.kind === 'income' ? 'In' : ''">{{ g.kind === 'income' ? '+' : '−' }}{{ money(g.total) }}</span>
                  </div>
                </div>
                <Select
                  v-model="groupCategory[g.key]"
                  :options="g.kind === 'income' ? incomeCats : expenseCats"
                  searchable
                  clearable
                  :placeholder="g.kind === 'income' ? 'Other income' : 'Uncategorised'"
                  class="Group__select"
                />
                <span v-if="fromRule[g.key]" class="Group__rule subdued Small" :title="`Rule: contains “${fromRule[g.key]}”`">
                  <Icon icon="mdi:auto-fix" /> Rule
                </span>
                <span v-else class="Group__rule" :title="rulePattern(g) ? `Lines containing “${rulePattern(g)}”` : 'These lines have nothing in common to match on'">
                  <Checkbox
                    :model-value="!!remember[g.key]"
                    label="Remember"
                    :disabled="!rulePattern(g) || !groupCategory[g.key]"
                    @update:model-value="(v: boolean) => (remember[g.key] = v)"
                  />
                </span>
              </div>
              <p v-if="groups.length > GROUP_LIMIT" class="subdued Small">
                {{ groups.length - GROUP_LIMIT }} more payees use the default categories below. You can recategorise them afterwards.
              </p>
            </CardSection>
          </Card>

          <Card v-if="batch.entries.length && !ledgerFile" title="Anything left uncategorised goes to">
            <CardSection>
              <div class="Map">
                <Select v-model="fallbackIncome" label="Money in" :options="incomeCats" />
                <Select v-model="fallbackExpense" label="Money out" :options="expenseCats" />
              </div>
            </CardSection>
          </Card>

          <Card v-if="batch.contacts.length" :title="`Contacts (${batch.contacts.length})`">
            <CardSection>
              <p class="Names">
                {{ batch.contacts.slice(0, 30).map((c) => c.name).join(', ') }}<template v-if="batch.contacts.length > 30">, and {{ batch.contacts.length - 30 }} more</template>
              </p>
              <p class="subdued Small">Existing contacts with the same name are kept; only missing email, phone and address are filled in.</p>
            </CardSection>
          </Card>
        </div>

        <aside class="Side">
          <Card title="Summary">
            <CardSection>
              <dl class="Sum">
                <div v-if="counts.entries"><dt>Transactions</dt><dd>{{ counts.entries }}</dd></div>
                <div v-if="counts.entries"><dt>Dates</dt><dd>{{ formatShortDay(counts.from) }} – {{ formatShortDay(counts.to) }}</dd></div>
                <div v-if="counts.income"><dt>Money in</dt><dd class="money In">{{ money(counts.income) }}</dd></div>
                <div v-if="counts.expense"><dt>Money out</dt><dd class="money">{{ money(counts.expense) }}</dd></div>
                <div v-if="counts.contacts"><dt>Contacts</dt><dd>{{ counts.contacts }}</dd></div>
                <div v-if="counts.leftOut"><dt>Left out by your choices</dt><dd>{{ counts.leftOut }}</dd></div>
              </dl>
            </CardSection>
            <CardSection v-if="batch.skipped.length || lockWarning">
              <Banner v-if="lockWarning" status="warning">{{ lockWarning }}</Banner>
              <ul class="Skipped">
                <li v-for="s in batch.skipped" :key="s.reason" class="subdued Small">{{ s.count }} × {{ s.reason }}</li>
              </ul>
            </CardSection>
            <CardSection>
              <Button type="primary" full-width :loading="busy" :disabled="!counts.entries && !counts.contacts" @click="commit">
                {{ importLabel }}
              </Button>
            </CardSection>
          </Card>
        </aside>
      </div>
    </template>

    <!-- ---------------------------------------------------------------- done -->
    <template v-else-if="result">
      <Card>
        <CardSection>
          <div class="Done">
            <Icon icon="mdi:check-circle" class="Done__icon" />
            <h2>Import finished</h2>
            <p>
              {{ result.entriesCreated }} transaction{{ result.entriesCreated === 1 ? '' : 's' }} added<template v-if="result.contactsCreated">, {{ result.contactsCreated }} new contact{{ result.contactsCreated === 1 ? '' : 's' }}</template><template v-if="result.accountsCreated">, {{ result.accountsCreated }} new account{{ result.accountsCreated === 1 ? '' : 's' }}</template><template v-if="result.categoriesCreated">, {{ result.categoriesCreated }} new categor{{ result.categoriesCreated === 1 ? 'y' : 'ies' }}</template>.
            </p>
            <p v-if="result.duplicates" class="subdued">{{ result.duplicates }} were already imported before and were skipped.</p>
            <p v-if="result.skipped" class="subdued">{{ result.skipped }} were left out because of your choices.</p>
            <p v-if="rulesSaved" class="subdued">
              {{ rulesSaved }} new rule{{ rulesSaved === 1 ? '' : 's' }} saved for next time.
              <Button type="plain" @click="router.push('/rules')">See rules</Button>
            </p>
            <div class="Done__actions">
              <Button type="primary" @click="router.push('/transactions')">View transactions</Button>
              <Button @click="reset">Import another file</Button>
            </div>
          </div>
        </CardSection>
        <CardSection v-if="result.failedCount">
          <Banner status="warning" :title="`${result.failedCount} line${result.failedCount === 1 ? '' : 's'} couldn't be imported`">
            <ul class="Failed">
              <li v-for="f in result.failed" :key="f.ref">{{ formatShortDay(f.date) }}: {{ f.reason }}</li>
            </ul>
          </Banner>
        </CardSection>
      </Card>
    </template>
  </Page>
</template>

<style scoped>
.Group__rule {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}

.Flush {
  margin: 0;
}

.Pick {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.Drop {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 6px;
  padding: 24px 0;
}

.Drop p {
  margin: 0 0 8px;
}

.Drop__icon {
  font-size: 40px;
  color: var(--octans-text-primary);
}

.Drop__title {
  font-size: 17px;
  font-weight: 600;
}

.Help {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 16px;
}

.Help > * {
  margin-top: 0 !important;
}

.Help h3 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 8px;
  font-size: 15px;
}

.Help p {
  margin: 0 0 8px;
  font-size: 13px;
  line-height: 1.5;
}

.Head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.Head__file {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  margin-bottom: 4px;
}

.Grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  gap: 16px;
  align-items: start;
}

.Main,
.Side {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.Side {
  position: sticky;
  top: 16px;
}

.Map {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px;
}

.Toggles {
  display: flex;
  flex-wrap: wrap;
  gap: 24px;
  margin-top: 16px;
}

.MapRow {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 20px minmax(0, 1fr);
  align-items: center;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px solid var(--octans-border);
}

.MapRow:last-child {
  border-bottom: 0;
}

.MapRow__name {
  font-weight: 500;
}

.Group {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 220px 96px;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px solid var(--octans-border);
}

.Group__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.In {
  color: var(--octans-text-success);
}

.Small {
  font-size: 12px;
}

.Nowrap {
  white-space: nowrap;
}

.Top {
  margin-top: 0;
}

.Names {
  margin: 0 0 8px;
  line-height: 1.5;
}

.Sum {
  margin: 0;
  display: grid;
  gap: 8px;
}

.Sum div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.Sum dt {
  color: var(--octans-text-subdued);
}

.Sum dd {
  margin: 0;
  text-align: right;
}

.Skipped {
  margin: 8px 0 0;
  padding-left: 16px;
  display: grid;
  gap: 6px;
}

.Done {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 24px 0;
}

.Done h2 {
  margin: 8px 0;
}

.Done p {
  margin: 0 0 6px;
}

.Done__icon {
  font-size: 44px;
  color: var(--octans-text-success);
}

.Done__actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

.Failed {
  margin: 4px 0 0;
  padding-left: 16px;
  font-size: 13px;
}
</style>
