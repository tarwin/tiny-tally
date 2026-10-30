import { reactive, ref } from 'vue';
import type { Entry, EntryKind } from './api';

/**
 * One transaction editor for the whole app, so the menu, the dashboard and
 * every list open the same modal. Lists watch `dataVersion` to reload.
 */
export const entryEditor = reactive({
  visible: false,
  entry: null as Entry | null,
  kind: 'expense' as EntryKind,
  accountId: null as number | null,
  toAccountId: null as number | null,
  /** Starting values for a new entry (a statement line that's missing, say). */
  draft: null as EntryDraft | null,
});

export interface EntryDraft {
  /** cents */
  amount?: number;
  date?: string;
  memo?: string;
}

export const dataVersion = ref(0);

export function newEntry(kind: EntryKind, accountId: number | null = null, toAccountId: number | null = null, draft: EntryDraft | null = null) {
  entryEditor.entry = null;
  entryEditor.draft = draft;
  entryEditor.kind = kind;
  entryEditor.accountId = accountId;
  entryEditor.toAccountId = toAccountId;
  entryEditor.visible = true;
}

export function editEntry(entry: Entry) {
  entryEditor.entry = entry;
  entryEditor.draft = null;
  entryEditor.kind = entry.kind;
  entryEditor.accountId = entry.accountId;
  entryEditor.toAccountId = entry.toAccountId;
  entryEditor.visible = true;
}

export function dataChanged() {
  dataVersion.value++;
}

export const KIND_LABELS: Record<EntryKind, string> = {
  expense: 'Expense',
  income: 'Income',
  transfer: 'Transfer',
};
