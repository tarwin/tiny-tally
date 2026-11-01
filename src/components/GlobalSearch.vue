<script setup lang="ts">
// The search box in the top bar (⌘K). Pages and actions match here; what's in
// the books (transactions, documents, contacts, accounts, categories) comes
// from the backend (search.ts).
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Icon } from '@octans/ui';
import { api, type SearchResults } from '../lib/api';
import { appSettingsPanel } from '../lib/appSettings';
import { formatShortDay } from '../lib/dates';
import { DOCS, docPath } from '../lib/documents';
import { KIND_LABELS, editEntry, newEntry } from '../lib/entryEditor';
import { formatMoney } from '../lib/money';
import { booksProfile, booksTax, session } from '../lib/session';

interface Item {
  key: string;
  icon: string;
  label: string;
  detail?: string;
  amount?: string;
  run: () => void;
}

const router = useRouter();
const input = ref<HTMLInputElement | null>(null);
const text = ref('');
const open = ref(false);
const active = ref(0);
const found = ref<SearchResults | null>(null);

const currency = computed(() => session.books!.currency);
const go = (to: string) => () => void router.push(to);
/** Contacts and categories have no page of their own: their transactions are the useful view. */
const transactionsFor = (q: string) => go(`/transactions?q=${encodeURIComponent(q)}&period=all`);

/** Pages and actions, matched by name and a few other words people might type. */
const commands = computed<(Item & { words: string })[]>(() => {
  const tax = booksTax();
  const report = booksProfile().tax?.report;
  const list: (Item & { words?: string })[] = [
    { key: 'p-dash', icon: 'mdi:view-dashboard-outline', label: 'Dashboard', words: 'home', run: go('/') },
    { key: 'p-tx', icon: 'mdi:format-list-bulleted', label: 'Transactions', run: go('/transactions') },
    { key: 'p-reports', icon: 'mdi:chart-box-outline', label: 'Reports', run: go('/reports') },
    { key: 'p-pnl', icon: 'mdi:chart-line', label: 'Profit & Loss', words: 'pnl p&l income statement report', run: go('/reports/profit-and-loss') },
    { key: 'p-bs', icon: 'mdi:scale-balance', label: 'Balance Sheet', words: 'report', run: go('/reports/balance-sheet') },
    { key: 'p-ar', icon: 'mdi:account-cash-outline', label: 'Who owes you', words: 'receivables debtors overdue report', run: go('/reports/receivables') },
    { key: 'p-ap', icon: 'mdi:receipt-text-clock-outline', label: 'Who you owe', words: 'payables creditors report', run: go('/reports/payables') },
    { key: 'p-journal', icon: 'mdi:book-open-variant', label: 'Journal & Trial Balance', words: 'report accountant debits credits', run: go('/reports/journal') },
    ...(report === 'bas' ? [{ key: 'p-tax', icon: 'mdi:bank-outline', label: 'BAS & GST', words: 'tax return ato', run: go('/reports/tax-return') }] : []),
    ...(report === 'nz-gst' ? [{ key: 'p-tax', icon: 'mdi:bank-outline', label: 'GST return', words: 'tax ird myir', run: go('/reports/tax-return') }] : []),
    ...(report === 'us-sales-tax' ? [{ key: 'p-tax', icon: 'mdi:bank-outline', label: 'Sales tax', words: 'tax return', run: go('/reports/sales-tax') }] : []),
    ...(session.books?.country === 'US' ? [{ key: 'p-schc', icon: 'mdi:file-document-outline', label: 'Schedule C', words: 'tax irs', run: go('/reports/schedule-c') }] : []),
    { key: 'p-inv', icon: 'mdi:file-document-outline', label: 'Invoices', run: go('/invoices') },
    { key: 'p-quotes', icon: 'mdi:file-document-edit-outline', label: 'Quotes', words: 'estimates', run: go('/quotes') },
    { key: 'p-credits', icon: 'mdi:file-undo-outline', label: 'Credit notes', words: 'refunds adjustment', run: go('/credit-notes') },
    { key: 'p-bills', icon: 'mdi:receipt-text-outline', label: 'Bills', words: 'purchases suppliers', run: go('/bills') },
    { key: 'p-templates', icon: 'mdi:palette-outline', label: 'Invoice templates', words: 'design logo', run: go('/invoices/templates') },
    { key: 'p-accounts', icon: 'mdi:bank-outline', label: 'Money accounts', words: 'bank card cash reconcile', run: go('/accounts') },
    { key: 'p-contacts', icon: 'mdi:account-multiple-outline', label: 'Contacts', words: 'customers suppliers vendors clients', run: go('/contacts') },
    { key: 'p-cats', icon: 'mdi:shape-outline', label: 'Categories', run: go('/categories') },
    { key: 'p-rules', icon: 'mdi:auto-fix', label: 'Rules', words: 'import categorise automatic', run: go('/rules') },
    { key: 'p-recurring', icon: 'mdi:repeat', label: 'Recurring', words: 'schedules repeat', run: go('/recurring') },
    { key: 'p-journals', icon: 'mdi:book-edit-outline', label: 'Journal entries', words: 'depreciation accruals adjustments', run: go('/journals') },
    { key: 'p-import', icon: 'mdi:tray-arrow-down', label: 'Import', words: 'bank statement csv', run: go('/import') },
    { key: 'p-activity', icon: 'mdi:history', label: 'Activity', words: 'history changes undo', run: go('/activity') },
    { key: 'p-settings', icon: 'mdi:cog-outline', label: 'Books settings', words: `${tax?.name ?? ''} tax numbering logo colour currency`, run: go('/settings') },
    { key: 'a-settings', icon: 'mdi:tune-variant', label: 'App settings', words: 'theme dark density size', run: () => (appSettingsPanel.visible = true) },
    { key: 'a-expense', icon: 'mdi:arrow-up-bold-circle-outline', label: 'New expense', words: 'add record spend', run: () => newEntry('expense') },
    { key: 'a-income', icon: 'mdi:arrow-down-bold-circle-outline', label: 'New income', words: 'add record', run: () => newEntry('income') },
    { key: 'a-transfer', icon: 'mdi:swap-horizontal', label: 'New transfer', words: 'add move money', run: () => newEntry('transfer') },
    { key: 'a-invoice', icon: 'mdi:file-document-plus-outline', label: 'New invoice', words: 'add create', run: go('/invoices/new') },
    { key: 'a-quote', icon: 'mdi:file-document-plus-outline', label: 'New quote', words: 'add create estimate', run: go('/quotes/new') },
    { key: 'a-bill', icon: 'mdi:receipt-text-plus-outline', label: 'New bill', words: 'add create', run: go('/bills/new') },
  ];
  return list.map((c) => ({ ...c, words: `${c.label} ${c.words ?? ''}`.toLowerCase() }));
});

const matchedCommands = computed(() => {
  const words = text.value.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return commands.value.filter((c) => words.every((w) => c.words.includes(w))).slice(0, 5);
});

function money(minor: number) {
  return formatMoney(minor, currency.value);
}

const groups = computed<{ title: string; items: Item[] }[]>(() => {
  const q = text.value.trim();
  if (!q) return [];
  const f = found.value;
  const out: { title: string; items: Item[] }[] = [];
  if (matchedCommands.value.length) out.push({ title: 'Go to', items: matchedCommands.value });
  if (f?.entries.length) {
    out.push({
      title: 'Transactions',
      items: f.entries.map((e) => ({
        key: `e${e.id}`,
        icon: e.kind === 'income' ? 'mdi:arrow-down-bold-circle-outline' : e.kind === 'expense' ? 'mdi:arrow-up-bold-circle-outline' : 'mdi:swap-horizontal',
        label: e.memo || e.contactName || e.categoryName || KIND_LABELS[e.kind],
        detail: [formatShortDay(e.date), e.kind === 'transfer' ? `${e.accountName} → ${e.toAccountName}` : e.accountName, e.contactName && e.memo ? e.contactName : null]
          .filter(Boolean)
          .join(' · '),
        amount: money(e.kind === 'expense' ? -e.amount : e.amount),
        run: () => editEntry(e),
      })),
    });
  }
  if (f?.documents.length) {
    out.push({
      title: 'Invoices, quotes & bills',
      items: f.documents.map((d) => ({
        key: `d${d.id}`,
        icon: 'mdi:file-document-outline',
        label: `${d.number} · ${d.contactName}`,
        detail: [DOCS[d.docType].one, formatShortDay(d.date), d.status === 'draft' ? 'draft' : d.status === 'void' ? 'void' : null].filter(Boolean).join(' · '),
        amount: money(d.total),
        run: go(docPath(d.docType, d.id)),
      })),
    });
  }
  if (f?.contacts.length) {
    out.push({
      title: 'Contacts',
      items: f.contacts.map((c) => ({
        key: `c${c.id}`,
        icon: 'mdi:account-outline',
        label: c.name,
        detail: [c.kind === 'customer' ? 'Customer' : 'Supplier', c.email].filter(Boolean).join(' · '),
        run: transactionsFor(c.name),
      })),
    });
  }
  if (f?.accounts.length) {
    out.push({
      title: 'Money accounts',
      items: f.accounts.map((a) => ({ key: `a${a.id}`, icon: 'mdi:bank-outline', label: a.name, run: go(`/accounts/${a.id}`) })),
    });
  }
  if (f?.categories.length) {
    out.push({
      title: 'Categories',
      items: f.categories.map((c) => ({
        key: `k${c.id}`,
        icon: 'mdi:shape-outline',
        label: c.name,
        detail: c.kind === 'income' ? 'Income' : 'Expense',
        run: transactionsFor(c.name),
      })),
    });
  }
  out.push({
    title: '',
    items: [{ key: 'all', icon: 'mdi:magnify', label: `All transactions matching “${q}”`, run: transactionsFor(q) }],
  });
  return out;
});

const flat = computed(() => groups.value.flatMap((g) => g.items));

let seq = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
watch(text, (q) => {
  active.value = 0;
  clearTimeout(timer);
  if (!q.trim()) {
    found.value = null;
    return;
  }
  timer = setTimeout(async () => {
    const mine = ++seq;
    try {
      const r = await api.search(q);
      if (mine === seq) found.value = r;
    } catch {
      if (mine === seq) found.value = null;
    }
  }, 150);
});

// Other books: nothing from the last ones.
watch(
  () => session.books?.path,
  () => {
    text.value = '';
    found.value = null;
  },
);

function choose(item: Item | undefined) {
  if (!item) return;
  item.run();
  text.value = '';
  open.value = false;
  input.value?.blur();
}

function onKey(e: KeyboardEvent) {
  const n = flat.value.length;
  if (e.key === 'ArrowDown' && n) {
    e.preventDefault();
    active.value = (active.value + 1) % n;
  } else if (e.key === 'ArrowUp' && n) {
    e.preventDefault();
    active.value = (active.value - 1 + n) % n;
  } else if (e.key === 'Enter') {
    e.preventDefault();
    choose(flat.value[active.value]);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    if (text.value) text.value = '';
    else input.value?.blur();
  }
}

watch(active, () => {
  requestAnimationFrame(() => document.querySelector('.Search__item--active')?.scrollIntoView({ block: 'nearest' }));
});

/** For ⌘K from the menu. */
function focus() {
  input.value?.focus();
  input.value?.select();
}

defineExpose({ focus });

const shortcut = tiny.system.isMacOS() ? '⌘K' : 'Ctrl+K';
</script>

<template>
  <div class="Search" data-tiny-nodrag>
    <label class="Search__field">
      <Icon icon="mdi:magnify" class="Search__icon" />
      <input
        ref="input"
        v-model="text"
        type="search"
        placeholder="Search"
        spellcheck="false"
        autocomplete="off"
        aria-label="Search the books"
        @focus="open = true"
        @blur="open = false"
        @keydown="onKey"
      />
      <kbd v-if="!text" class="Search__kbd">{{ shortcut }}</kbd>
    </label>
    <div v-if="open && text.trim()" class="Search__panel" role="listbox">
      <template v-for="g in groups" :key="g.title || 'more'">
        <div v-if="g.title" class="Search__group">{{ g.title }}</div>
        <div v-else class="Search__rule" />
        <div
          v-for="item in g.items"
          :key="item.key"
          class="Search__item"
          :class="{ 'Search__item--active': flat[active]?.key === item.key }"
          role="option"
          :aria-selected="flat[active]?.key === item.key"
          @mousedown.prevent="choose(item)"
          @mousemove="active = flat.indexOf(item)"
        >
          <Icon :icon="item.icon" class="Search__itemIcon" />
          <span class="Search__text">
            <span class="Search__label">{{ item.label }}</span>
            <span v-if="item.detail" class="Search__detail">{{ item.detail }}</span>
          </span>
          <span v-if="item.amount" class="Search__amount money">{{ item.amount }}</span>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.Search {
  position: relative;
  width: min(520px, 100%);
}

/* Tinted from the bar's text colour, so it reads on any books colour. */
.Search__field {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 8px;
  border-radius: 8px;
  background: color-mix(in srgb, currentColor 16%, transparent);
  cursor: text;
}

.Search__field:focus-within {
  background: color-mix(in srgb, currentColor 24%, transparent);
}

.Search__icon {
  flex: none;
  opacity: 0.8;
}

.Search__field input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: 0;
  background: none;
  color: inherit;
  font: inherit;
  font-size: 13px;
}

.Search__field input::placeholder {
  color: inherit;
  opacity: 0.75;
}

.Search__field input::-webkit-search-cancel-button {
  display: none;
}

.Search__kbd {
  font: inherit;
  font-size: 11px;
  opacity: 0.7;
}

.Search__panel {
  position: absolute;
  top: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  width: max(100%, 480px);
  max-height: min(70vh, 560px);
  overflow-y: auto;
  padding: 6px;
  border-radius: 10px;
  background: var(--octans-surface-raised);
  color: var(--octans-text);
  box-shadow: 0 12px 32px rgba(20, 28, 40, 0.24), 0 1px 4px rgba(20, 28, 40, 0.12);
  z-index: 1900;
}

.Search__group {
  padding: 8px 8px 4px;
  font-size: 11px;
  font-weight: 600;
  color: var(--octans-text-subdued);
}

.Search__rule {
  margin: 6px 4px;
  border-top: 1px solid var(--octans-border);
}

.Search__item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px;
  border-radius: 6px;
  cursor: default;
}

.Search__item--active {
  background: var(--octans-surface-hover);
}

.Search__itemIcon {
  flex: none;
  color: var(--octans-text-subdued);
}

.Search__text {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}

.Search__label,
.Search__detail {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.Search__detail {
  font-size: 12px;
  color: var(--octans-text-subdued);
}

.Search__amount {
  flex: none;
  font-size: 13px;
}
</style>
