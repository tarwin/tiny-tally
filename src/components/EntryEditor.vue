<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import {
  Button,
  DatePicker,
  FormLayout,
  FormLayoutGroup,
  Modal,
  ModalSection,
  SegmentedControl,
  Select,
  TextField,
  ToggleSwitch,
  confirmModal,
  toast,
} from '@octans/ui';
import { api, errorMessage, type Account, type Category, type Contact, type EntryKind, type Frequency, type TaxCode } from '../lib/api';
import { CLASS_INFO } from '../lib/categoryClass';
import { FREQUENCY_OPTIONS, nextOccurrence } from '../lib/schedule';
import { today } from '../lib/dates';
import { dataChanged, entryEditor } from '../lib/entryEditor';
import { formatMoney, parseMoney, toInput } from '../lib/money';
import { session } from '../lib/session';
import { TAX_CODES, TAX_CODE_MAP, taxFromInclusive } from '../shared/tax';

const accounts = ref<Account[]>([]);
const categories = ref<Category[]>([]);
const contacts = ref<Contact[]>([]);
const saving = ref(false);
const amountField = ref<InstanceType<typeof TextField> | null>(null);

const form = ref({
  kind: 'expense' as EntryKind,
  amount: '',
  date: today(),
  accountId: null as number | null,
  toAccountId: null as number | null,
  categoryId: null as number | null,
  contactId: null as number | null,
  memo: '',
  taxCode: null as TaxCode | null,
  /** null = work it out from the amount */
  taxAmount: null as string | null,
});
const errors = ref<Record<string, string | undefined>>({});

// Remembered between entries so a run of receipts doesn't need re-picking.
const lastUsed: Partial<Record<EntryKind, { accountId: number | null; date: string }>> = {};

const newContact = ref<{ name: string } | null>(null);

const currency = computed(() => session.company?.currency ?? 'USD');
const editing = computed(() => entryEditor.entry);
const isTransfer = computed(() => form.value.kind === 'transfer');

const kindOptions = [
  { label: 'Expense', value: 'expense', icon: 'mdi:arrow-up-bold-circle-outline' },
  { label: 'Income', value: 'income', icon: 'mdi:arrow-down-bold-circle-outline' },
  { label: 'Transfer', value: 'transfer', icon: 'mdi:swap-horizontal' },
];

function usable<T extends { id: number; archived: boolean }>(rows: T[], keep: (number | null)[]) {
  return rows.filter((r) => !r.archived || keep.includes(r.id));
}

const accountOptions = computed(() =>
  usable(accounts.value, [editing.value?.accountId ?? null, editing.value?.toAccountId ?? null]).map((a) => ({
    label: a.name,
    value: a.id,
    description: formatMoney(a.balance, currency.value),
  })),
);

const toAccountOptions = computed(() => accountOptions.value.filter((o) => o.value !== form.value.accountId));

const categoryOptions = computed(() =>
  usable(
    categories.value.filter((c) => c.kind === form.value.kind),
    [editing.value?.categoryId ?? null],
  ).map((c) => ({ label: c.name, value: c.id, description: c.class === 'pnl' ? undefined : CLASS_INFO[c.class].label })),
);
const category = computed(() => categories.value.find((c) => c.id === form.value.categoryId) ?? null);
/** Tax payments, owner's money and loans: no GST, not on the BAS. */
const offBas = computed(() => !!category.value && CLASS_INFO[category.value.class].offBas);

const contactGroups = computed(() => {
  const active = usable(contacts.value, [editing.value?.contactId ?? null]);
  const opt = (c: Contact) => ({ label: c.name, value: c.id });
  const vendors = { title: 'Vendors', options: active.filter((c) => c.kind === 'vendor').map(opt) };
  const customers = { title: 'Customers', options: active.filter((c) => c.kind === 'customer').map(opt) };
  const groups = form.value.kind === 'income' ? [customers, vendors] : [vendors, customers];
  return groups.filter((g) => g.options.length);
});

const labels = computed(() => {
  switch (form.value.kind) {
    case 'income':
      return { account: 'Deposited to', contact: 'Received from', title: 'income' };
    case 'transfer':
      return { account: 'From', contact: '', title: 'transfer' };
    default:
      return { account: 'Paid from', contact: 'Paid to', title: 'expense' };
  }
});

// ---- GST ----------------------------------------------------------------------
const taxOn = computed(() => !!session.company?.taxEnabled && !isTransfer.value && !offBas.value);
const taxOptions = computed(() =>
  TAX_CODES.filter((t) => (form.value.kind === 'income' ? t.sales : t.purchases)).map((t) => ({
    label: t.label,
    value: t.code,
    description: t.help,
  })),
);
const autoTax = computed(() => {
  const amount = parseMoney(form.value.amount, currency.value) ?? 0;
  return taxFromInclusive(amount, form.value.taxCode, session.company?.taxRateBp);
});
const taxable = computed(() => !!form.value.taxCode && TAX_CODE_MAP[form.value.taxCode].taxable);
const taxDisplay = computed({
  get: () => form.value.taxAmount ?? toInput(autoTax.value, currency.value),
  set: (v: string) => (form.value.taxAmount = v),
});

// Picking a category brings its usual tax code along.
watch(
  () => form.value.categoryId,
  (id, prev) => {
    if (id === prev || !id) return;
    const cat = categories.value.find((c) => c.id === id);
    if (cat?.taxCode) {
      form.value.taxCode = cat.taxCode;
      form.value.taxAmount = null;
    }
  },
);

const title = computed(() => (editing.value ? `Edit ${labels.value.title}` : `New ${labels.value.title}`));

// ---- repeat ---------------------------------------------------------------------
const repeat = ref({ on: false, frequency: 'monthly' as Frequency });
const canRepeat = computed(() => !editing.value?.scheduleId);

async function loadLists() {
  [accounts.value, categories.value, contacts.value] = await Promise.all([
    api.listAccounts(),
    api.listCategories(),
    api.listContacts(),
  ]);
}

function defaultAccount(kind: EntryKind) {
  const remembered = lastUsed[kind]?.accountId;
  const active = accounts.value.filter((a) => !a.archived && a.id !== entryEditor.toAccountId);
  if (remembered && active.some((a) => a.id === remembered)) return remembered;
  if (kind === 'transfer' || kind === 'income') return active.find((a) => a.kind === 'bank')?.id ?? active[0]?.id ?? null;
  return active[0]?.id ?? null;
}

function reset() {
  errors.value = {};
  newContact.value = null;
  repeat.value = { on: false, frequency: 'monthly' };
  const e = entryEditor.entry;
  if (e) {
    form.value = {
      kind: e.kind,
      amount: toInput(e.amount, currency.value),
      date: e.date,
      accountId: e.accountId,
      toAccountId: e.toAccountId,
      categoryId: e.categoryId,
      contactId: e.contactId,
      memo: e.memo ?? '',
      taxCode: e.taxCode,
      taxAmount: null,
    };
    // Keep a hand-entered GST amount if it differs from the calculated one.
    void nextTick(() => {
      if (e.taxCode && e.taxAmount !== autoTax.value) form.value.taxAmount = toInput(e.taxAmount, currency.value);
    });
    return;
  }
  const kind = entryEditor.kind;
  form.value = {
    kind,
    amount: '',
    date: lastUsed[kind]?.date ?? today(),
    accountId: entryEditor.accountId ?? defaultAccount(kind),
    toAccountId: entryEditor.toAccountId,
    categoryId: null,
    contactId: null,
    memo: '',
    taxCode: null,
    taxAmount: null,
  };
}

watch(
  () => entryEditor.visible,
  async (open) => {
    if (!open) return;
    await loadLists();
    reset();
    await nextTick();
    amountField.value?.focus();
  },
);

// Switching type keeps what still makes sense and clears what doesn't.
watch(
  () => form.value.kind,
  (kind, prev) => {
    if (kind === prev) return;
    const cat = categories.value.find((c) => c.id === form.value.categoryId);
    if (cat && cat.kind !== kind) form.value.categoryId = null;
    if (kind !== 'transfer') form.value.toAccountId = null;
    if (kind === 'transfer') form.value.categoryId = null;
    errors.value = {};
  },
);

watch(
  () => form.value.accountId,
  (id) => {
    if (id !== null && id === form.value.toAccountId) form.value.toAccountId = null;
  },
);

function close() {
  entryEditor.visible = false;
}

function validate() {
  const f = form.value;
  const amount = parseMoney(f.amount, currency.value);
  errors.value = {
    amount: amount === null || amount <= 0 ? 'Enter an amount greater than zero.' : undefined,
    accountId: f.accountId ? undefined : 'Choose an account.',
    toAccountId: isTransfer.value && !f.toAccountId ? 'Choose where the money goes.' : undefined,
    categoryId: !isTransfer.value && !f.categoryId ? 'Choose a category.' : undefined,
    taxAmount:
      taxOn.value && taxable.value && f.taxAmount !== null && (parseMoney(f.taxAmount, currency.value) ?? -1) < 0
        ? 'Enter the GST amount.'
        : taxOn.value && f.taxAmount !== null && (parseMoney(f.taxAmount, currency.value) ?? 0) > (amount ?? 0)
          ? "GST can't be more than the amount."
          : undefined,
  };
  return Object.values(errors.value).some(Boolean) ? null : amount!;
}

async function save(andNew = false) {
  const amount = validate();
  if (amount === null) return;
  const f = form.value;
  saving.value = true;
  try {
    await api.saveEntry({
      id: editing.value?.id,
      kind: f.kind,
      amount,
      date: f.date,
      accountId: f.accountId!,
      toAccountId: isTransfer.value ? f.toAccountId : null,
      categoryId: isTransfer.value ? null : f.categoryId,
      contactId: isTransfer.value ? null : f.contactId,
      memo: f.memo,
      ...(taxOn.value
        ? {
            taxCode: f.taxCode,
            taxAmount: f.taxAmount !== null && taxable.value ? parseMoney(f.taxAmount, currency.value) : null,
          }
        : {}),
    });
    lastUsed[f.kind] = { accountId: f.accountId, date: f.date };
    let repeated = '';
    if (repeat.value.on && canRepeat.value) {
      const cat = categories.value.find((c) => c.id === f.categoryId);
      const who = contacts.value.find((c) => c.id === f.contactId)?.name;
      await api.saveSchedule({
        kind: 'entry',
        name: f.memo.trim() || who || cat?.name || (isTransfer.value ? 'Transfer' : 'Transaction'),
        frequency: repeat.value.frequency,
        startDate: nextOccurrence(f.date, repeat.value.frequency),
        payload: {
          kind: f.kind,
          amount,
          accountId: f.accountId,
          toAccountId: isTransfer.value ? f.toAccountId : null,
          categoryId: isTransfer.value ? null : f.categoryId,
          contactId: isTransfer.value ? null : f.contactId,
          memo: f.memo || null,
          ...(taxOn.value ? { taxCode: f.taxCode } : {}),
        },
      });
      repeated = ` Repeats ${FREQUENCY_OPTIONS.find((o) => o.value === repeat.value.frequency)!.label.toLowerCase()}.`;
    }
    dataChanged();
    toast({
      title: editing.value ? 'Transaction updated' : `${labels.value.title[0].toUpperCase()}${labels.value.title.slice(1)} saved`,
      content: repeated.trim() || undefined,
      tone: 'success',
    });
    if (andNew) {
      entryEditor.entry = null;
      entryEditor.kind = f.kind;
      entryEditor.accountId = f.accountId;
      entryEditor.toAccountId = null;
      await loadLists();
      reset();
      await nextTick();
      amountField.value?.focus();
    } else {
      close();
    }
  } catch (e) {
    toast({ title: "Couldn't save", content: errorMessage(e), tone: 'error' });
  } finally {
    saving.value = false;
  }
}

async function remove() {
  const e = editing.value;
  if (!e) return;
  const ok = await confirmModal({
    title: 'Delete this transaction?',
    content: `${formatMoney(e.amount, currency.value)} on ${e.date}. This can't be undone.`,
    primaryActionLabel: 'Delete',
    primaryActionType: 'destructive',
    secondaryActionLabel: 'Cancel',
  });
  if (!ok) return;
  try {
    await api.deleteEntry(e.id);
    dataChanged();
    toast({ title: 'Transaction deleted' });
    close();
  } catch (err) {
    toast({ title: "Couldn't delete", content: errorMessage(err), tone: 'error' });
  }
}

async function addContact() {
  const name = newContact.value?.name.trim();
  if (!name) return;
  try {
    const id = await api.saveContact({ name, kind: form.value.kind === 'income' ? 'customer' : 'vendor' });
    contacts.value = await api.listContacts();
    form.value.contactId = id;
    newContact.value = null;
  } catch (e) {
    toast({ title: "Couldn't add contact", content: errorMessage(e), tone: 'error' });
  }
}
</script>

<template>
  <Modal
    :visible="entryEditor.visible"
    :title="title"
    :loading="saving"
    :primary-action="{ label: 'Save', onAction: () => save(false) }"
    :secondary-actions="editing ? [{ label: 'Cancel', onAction: close }] : [{ label: 'Save & new', onAction: () => save(true) }]"
    :tertiary-actions="editing ? [{ label: 'Delete', type: 'destructive', onAction: remove }] : []"
    :dialog-style="{ width: '560px' }"
    overflow-visible
    @close="close"
  >
    <ModalSection>
      <FormLayout>
        <SegmentedControl v-model="form.kind" :options="kindOptions" full-width />

        <FormLayoutGroup>
          <TextField
            ref="amountField"
            v-model="form.amount"
            label="Amount"
            :prefix="currency"
            placeholder="0.00"
            align="right"
            required
            :error="errors.amount"
            @keydown.enter="save(false)"
          />
          <DatePicker v-model="form.date" type="date" model-format="YYYY-MM-DD" label="Date" required />
        </FormLayoutGroup>

        <FormLayoutGroup>
          <Select
            v-model="form.accountId"
            :label="labels.account"
            :options="accountOptions"
            show-description
            required
            :error="errors.accountId"
          />
          <Select
            v-if="isTransfer"
            v-model="form.toAccountId"
            label="To"
            :options="toAccountOptions"
            show-description
            required
            :error="errors.toAccountId"
          />
          <Select
            v-else
            v-model="form.categoryId"
            label="Category"
            :options="categoryOptions"
            searchable
            show-description
            required
            :error="errors.categoryId"
          />
        </FormLayoutGroup>

        <FormLayoutGroup v-if="taxOn">
          <Select v-model="form.taxCode" label="Tax code" :options="taxOptions" show-description @update:model-value="form.taxAmount = null" />
          <TextField
            v-model="taxDisplay"
            label="GST included"
            :prefix="currency"
            align="right"
            :disabled="!taxable"
            :error="errors.taxAmount"
            :help-text="form.taxAmount !== null ? 'Entered by hand' : taxable ? 'Worked out at 1/11 of the amount' : ''"
          />
        </FormLayoutGroup>

        <div v-if="!isTransfer" class="Contact">
          <div v-if="newContact" class="Contact__new">
            <TextField
              v-model="newContact.name"
              :label="`New ${form.kind === 'income' ? 'customer' : 'vendor'}`"
              placeholder="Name"
              @keydown.enter.prevent="addContact"
            />
            <Button type="primary" @click="addContact">Add</Button>
            <Button type="plain" @click="newContact = null">Cancel</Button>
          </div>
          <div v-else class="Contact__pick">
            <Select
              v-model="form.contactId"
              :label="`${labels.contact} (optional)`"
              :option-groups="contactGroups"
              :options="[]"
              searchable
              clearable
              placeholder="No one in particular"
            />
            <Button icon="mdi:account-plus-outline" tooltip="Add a new contact" @click="newContact = { name: '' }" />
          </div>
        </div>

        <p v-if="offBas && category" class="subdued OffBas">
          {{ CLASS_INFO[category.class].label }}: not counted as {{ form.kind === 'income' ? 'income' : 'an expense' }} and left off the BAS.
        </p>

        <TextField v-model="form.memo" label="Description (optional)" placeholder="What was it for?" @keydown.enter="save(false)" />

        <div v-if="canRepeat" class="Repeat">
          <ToggleSwitch v-model="repeat.on" :label="editing ? 'Repeat this from here on' : 'Repeat this'" />
          <Select v-if="repeat.on" v-model="repeat.frequency" :options="FREQUENCY_OPTIONS" size="small" />
        </div>
        <p v-else class="subdued OffBas">Created by a recurring schedule. Change future ones under Recurring.</p>
      </FormLayout>
    </ModalSection>
  </Modal>
</template>

<style scoped>
.OffBas {
  font-size: 12px;
  margin: 0;
}

.Repeat {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 32px;
}

.Contact__pick,
.Contact__new {
  display: flex;
  align-items: flex-end;
  gap: 8px;
}

.Contact__pick > :first-child,
.Contact__new > :first-child {
  flex: 1;
  min-width: 0;
}
</style>
