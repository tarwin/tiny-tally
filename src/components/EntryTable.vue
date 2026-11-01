<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { DataTable, Icon, type DataTableColumnType, type DataTablePaginationType } from '@octans/ui';
import type { Entry } from '../lib/api';
import { formatShortDay } from '../lib/dates';
import { docPath } from '../lib/documents';
import { editEntry } from '../lib/entryEditor';
import { formatMoney } from '../lib/money';
import { session } from '../lib/session';

const props = defineProps<{
  rows: Entry[];
  loading?: boolean;
  /** Register mode: amounts signed for this account, plus a running balance. */
  accountId?: number;
  pagination?: DataTablePaginationType;
  emptyText?: string;
  compact?: boolean;
}>();

const currency = computed(() => session.books!.currency);
const router = useRouter();

/** Payments belong to their invoice or bill and are changed from there. */
function open(e: Entry) {
  if (e.invoiceId) void router.push(docPath(e.invoiceType, e.invoiceId));
  else editEntry(e);
}

/** Ticked off against a bank statement (on this register's side, outside a register either side). */
function reconciled(e: Entry) {
  if (!props.accountId) return !!(e.recId || e.toRecId);
  return e.toAccountId === props.accountId ? !!e.toRecId : !!e.recId;
}

const columns = computed<DataTableColumnType[]>(() => [
  { key: 'date', label: 'Date', width: 100 },
  { key: 'description', label: 'Description', minWidth: 160, maxWidth: 260 },
  // Compact tables (the dashboard) keep just the essentials so nothing is cut off.
  ...(props.compact ? [] : [{ key: 'category', label: props.accountId ? 'Category / account' : 'Category', width: 170 }]),
  ...(props.accountId || props.compact ? [] : [{ key: 'accountName', label: 'Account', width: 130 }]),
  { key: 'signed', label: 'Amount', width: 120 },
  ...(props.accountId ? [{ key: 'balance', label: 'Balance', width: 130 }] : []),
]);

function description(e: Entry) {
  if (e.contactName && e.memo) return `${e.contactName}: ${e.memo}`;
  return e.contactName || e.memo || (e.kind === 'transfer' ? 'Transfer' : '—');
}

function category(e: Entry) {
  if (e.invoiceId) {
    const word = e.invoiceType === 'bill' ? 'Bill payment' : e.invoiceType === 'credit' ? 'Refund' : 'Payment';
    return `${word} · ${e.invoiceNumber}`;
  }
  if (e.kind !== 'transfer') return e.categoryName ?? 'Uncategorised';
  if (!props.accountId) return `${e.accountName} → ${e.toAccountName}`;
  return e.toAccountId === props.accountId ? `From ${e.accountName}` : `To ${e.toAccountName}`;
}

function amountText(e: Entry) {
  // Transfers have no sign outside a register: money moved, none was earned or spent.
  if (!props.accountId && e.kind === 'transfer') return formatMoney(e.amount, currency.value);
  const s = formatMoney(Math.abs(e.signed), currency.value);
  return e.signed < 0 ? `−${s}` : `+${s}`;
}

function amountClass(e: Entry) {
  if (!props.accountId && e.kind === 'transfer') return 'Amount--neutral';
  return e.signed < 0 ? 'Amount--out' : 'Amount--in';
}
</script>

<template>
  <DataTable
    :columns="columns"
    :rows="rows"
    :loading="loading"
    :pagination="pagination"
    :compact="compact"
    :empty-text="emptyText ?? 'No transactions yet.'"
    :row-actions="compact ? undefined : [{ label: 'Open', icon: 'mdi:pencil-outline', onAction: open }]"
    @click-row="open"
  >
    <template #col:date="{ row }">
      <span class="money">{{ formatShortDay(row.date) }}</span>
    </template>
    <template #col:description="{ row }">
      <span class="Desc">
        <Icon
          :icon="row.kind === 'income' ? 'mdi:arrow-down-bold-circle-outline' : row.kind === 'expense' ? 'mdi:arrow-up-bold-circle-outline' : 'mdi:swap-horizontal'"
          :class="`Kind Kind--${row.kind}`"
        />
        <span class="Clip" :title="description(row)">{{ description(row) }}</span>
        <Icon v-if="row.attachments" icon="mdi:paperclip" class="Flag" :title="row.attachments === 1 ? '1 attachment' : `${row.attachments} attachments`" />
        <Icon v-if="row.scheduleId" icon="mdi:repeat" class="Flag" title="Created by a recurring schedule" />
        <Icon v-if="reconciled(row)" icon="mdi:check-decagram-outline" class="Flag Flag--rec" title="Reconciled" />
      </span>
    </template>
    <template #col:category="{ row }">
      <span class="Clip" :class="{ subdued: row.kind === 'transfer' }" :title="category(row)">{{ category(row) }}</span>
    </template>
    <template #col:signed="{ row }">
      <span class="money Amount" :class="amountClass(row)">{{ amountText(row) }}</span>
    </template>
    <template #col:balance="{ row }">
      <span class="money" :class="{ negative: (row.balance ?? 0) < 0 }">{{ formatMoney(row.balance ?? 0, currency) }}</span>
    </template>
  </DataTable>
</template>

<style scoped>
.Desc {
  display: flex;
  max-width: 100%;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.Clip {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.Kind {
  flex: none;
}

.Flag {
  flex: none;
  font-size: 14px;
  color: var(--octans-text-subdued);
}

.Flag--rec {
  color: var(--octans-text-success);
}

.Kind--income {
  color: var(--octans-text-success);
}

.Kind--expense {
  color: var(--octans-text-subdued);
}

.Kind--transfer {
  color: var(--octans-text-info);
}

.Amount--in {
  color: var(--octans-text-success);
}

.Amount--out {
  color: var(--octans-text);
}

.Amount--neutral {
  color: var(--octans-text-subdued);
}
</style>
