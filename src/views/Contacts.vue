<script setup lang="ts">
import { useRouter } from 'vue-router';
import { computed, onMounted, ref, watch } from 'vue';
import {
  DataTable,
  FormLayout,
  FormLayoutGroup,
  Modal,
  ModalSection,
  Page,
  SegmentedControl,
  Select,
  TextField,
  ToggleSwitch,
  toast,
  type DataTableColumnType,
} from '@octans/ui';
import { api, errorMessage, type Contact, type ContactKind, type TaxRate, type TradingName } from '../lib/api';
import { ratePercent } from '../lib/money';
import { US_STATE_OPTIONS } from '../shared/usStates';
import { formatDay } from '../lib/dates';
import { useFillHeight } from '../lib/fillHeight';
import { useBooksVersion } from '../lib/live';
import { formatMoney } from '../lib/money';
import { session } from '../lib/session';

const dataVersion = useBooksVersion();

const router = useRouter();
const contacts = ref<Contact[]>([]);
const loading = ref(true);
const kind = ref<ContactKind | 'all'>('all');
const showArchived = ref(false);
const search = ref('');

const currency = computed(() => session.books!.currency);

const rows = computed(() => {
  const q = search.value.trim().toLowerCase();
  return contacts.value.filter(
    (c) =>
      (kind.value === 'all' || c.kind === kind.value) &&
      (showArchived.value || !c.archived) &&
      (!q || [c.name, c.email, c.phone].some((v) => v?.toLowerCase().includes(q))),
  );
});
const hasArchived = computed(() => contacts.value.some((c) => c.archived));

const filterOptions = [
  { label: 'All', value: 'all' },
  { label: 'Customers', value: 'customer' },
  { label: 'Vendors', value: 'vendor' },
];
const kindOptions = filterOptions.slice(1);

const columns = computed<DataTableColumnType[]>(() => [
  { key: 'name', label: 'Name', minWidth: 200, formatFunc: (v, row) => (row.archived ? `${v} (archived)` : v) },
  { key: 'kind', label: 'Type', width: 110, formatFunc: (v) => (v === 'customer' ? 'Customer' : 'Vendor') },
  { key: 'email', label: 'Email', minWidth: 180, formatFunc: (v) => v ?? '' },
  { key: 'received', label: 'Received', width: 130, formatFunc: (v) => (v ? formatMoney(v, currency.value) : '') },
  { key: 'paid', label: 'Paid', width: 130, formatFunc: (v) => (v ? formatMoney(v, currency.value) : '') },
  { key: 'lastDate', label: 'Last activity', width: 140, formatFunc: (v) => (v ? formatDay(v) : '') },
]);

const us = computed(() => session.books?.country === 'US');
const au = computed(() => session.books?.country === 'AU');
const nz = computed(() => session.books?.country === 'NZ');
const taxRates = ref<TaxRate[]>([]);
const rateOptions = computed(() => [
  { label: `${session.books?.taxRateName || 'Your rate'} (${ratePercent(session.books?.taxRatePpm ?? 0)}%)`, value: null },
  ...taxRates.value
    .filter((r) => !r.archived || r.id === form.value.taxRateId)
    .map((r) => ({ label: `${r.name} (${ratePercent(r.ratePpm)}%)`, value: r.id })),
]);
const stateOptions = [{ label: 'Not set', value: null }, ...US_STATE_OPTIONS];
/** Only show the TIN in full while it's being edited. */
const showTin = ref(false);

const tradingNames = ref<TradingName[]>([]);
/** Only worth asking when there's a choice. */
const defaultTradingName = computed(() => tradingNames.value.find((t) => t.isDefault)?.name ?? '');
const tradingNameOptions = computed(() => [
  { label: `Default (${defaultTradingName.value})`, value: null },
  ...tradingNames.value.filter((t) => !t.isArchived || t.id === form.value.tradingNameId).map((t) => ({ label: t.name, value: t.id })),
]);

async function load() {
  loading.value = true;
  try {
    [contacts.value, tradingNames.value, taxRates.value] = await Promise.all([
      api.listContacts(),
      api.listTradingNames(),
      us.value ? api.listTaxRates() : Promise.resolve([]),
    ]);
  } finally {
    loading.value = false;
  }
}

const editing = ref(false);
const saving = ref(false);
const blank = () => ({
  id: undefined as number | undefined,
  kind: (kind.value === 'all' ? 'customer' : kind.value) as ContactKind,
  name: '',
  email: '',
  phone: '',
  address: '',
  notes: '',
  tradingNameId: null as number | null,
  state: null as string | null,
  taxRateId: null as number | null,
  exempt: false,
  taxExempt: '',
  is1099: false,
  legalName: '',
  tin: '',
  whtPct: '',
});
const form = ref(blank());
const nameError = ref<string | null>(null);

function openEditor(c?: Contact) {
  nameError.value = null;
  showTin.value = false;
  form.value = c
    ? {
        id: c.id, kind: c.kind, name: c.name, email: c.email ?? '', phone: c.phone ?? '', address: c.address ?? '', notes: c.notes ?? '',
        tradingNameId: c.tradingNameId, state: c.state, taxRateId: c.taxRateId, exempt: !!c.taxExempt, taxExempt: c.taxExempt ?? '',
        is1099: c.is1099, legalName: c.legalName ?? '', tin: c.tin ?? '',
        whtPct: c.whtRatePpm ? String(c.whtRatePpm / 10_000) : '',
      }
    : blank();
  editing.value = true;
}

async function save() {
  if (!form.value.name.trim()) {
    nameError.value = 'Give the contact a name.';
    return;
  }
  saving.value = true;
  try {
    const { exempt, whtPct, ...rest } = form.value;
    const pct = whtPct.trim() ? Number(whtPct.replace('%', '')) : null;
    if (pct != null && (!Number.isFinite(pct) || pct < 0 || pct > 100)) {
      toast({ title: 'Check the withholding rate', content: 'Enter it as a percent, like 20.', tone: 'error' });
      return;
    }
    if (exempt && !rest.taxExempt.trim()) {
      toast({ title: 'Add the certificate', content: 'Enter the resale or exemption certificate number, so there is a record of why no tax was charged.', tone: 'error' });
      return;
    }
    await api.saveContact({ ...rest, taxExempt: exempt ? rest.taxExempt : null, whtRatePpm: pct == null ? null : Math.round(pct * 10_000) });
    editing.value = false;
    toast({ title: form.value.id ? 'Contact updated' : 'Contact added', tone: 'success' });
    await load();
  } catch (e) {
    toast({ title: "Couldn't save contact", content: errorMessage(e), tone: 'error' });
  } finally {
    saving.value = false;
  }
}

async function setArchived(c: Contact, archived: boolean) {
  await api.archiveContact(c.id, archived);
  toast({ title: archived ? `Archived ${c.name}` : `Restored ${c.name}` });
  await load();
}

watch(dataVersion, load);
onMounted(load);

// The table scrolls inside itself, filling the window below the filters.
const tableBox = ref<HTMLElement | null>(null);
const maxHeight = useFillHeight(tableBox);
</script>

<template>
  <Page
    title="Contacts"
    subtitle="Customers you get paid by and vendors you pay."
    size="wide"
    :primary-action="{ label: 'Add contact', icon: 'mdi:plus', onAction: () => openEditor() }"
  >
    <div class="Toolbar">
      <SegmentedControl v-model="kind" :options="filterOptions" />
      <div class="Toolbar__right">
        <ToggleSwitch v-if="hasArchived" v-model="showArchived" label="Show archived" />
        <TextField v-model="search" placeholder="Search contacts" />
      </div>
    </div>
    <div ref="tableBox">
      <DataTable
        :max-height="maxHeight"
        :columns="columns"
        :rows="rows"
        :loading="loading"
        empty-text="No contacts yet. Add one here, or while recording a transaction."
        :row-actions="(row: Contact) => [
          { label: 'Edit', icon: 'mdi:pencil-outline', onAction: () => openEditor(row) },
          { label: 'Statement', icon: 'mdi:file-document-multiple-outline', onAction: () => router.push(`/contacts/${row.id}/statement`) },
          row.kind === 'customer'
            ? { label: 'New invoice', icon: 'mdi:file-document-plus-outline', onAction: () => router.push(`/invoices/new?contact=${row.id}`) }
            : { label: 'New bill', icon: 'mdi:receipt-text-plus-outline', onAction: () => router.push(`/bills/new?contact=${row.id}`) },
          row.archived
            ? { label: 'Restore', icon: 'mdi:archive-arrow-up-outline', onAction: () => setArchived(row, false) }
            : { label: 'Archive', icon: 'mdi:archive-outline', onAction: () => setArchived(row, true) },
        ]"
        @click-row="(row: Contact) => openEditor(row)"
      />
    </div>

    <Modal
      :visible="editing"
      :title="form.id ? 'Edit contact' : 'Add contact'"
      :loading="saving"
      :primary-action="{ label: form.id ? 'Save' : 'Add contact', onAction: save }"
      :secondary-actions="[{ label: 'Cancel', onAction: () => (editing = false) }]"
      @close="editing = false"
    >
      <ModalSection>
        <FormLayout>
          <SegmentedControl v-model="form.kind" :options="kindOptions" />
          <TextField v-model="form.name" label="Name" required :error="nameError" />
          <FormLayoutGroup>
            <TextField v-model="form.email" label="Email" type="email" />
            <TextField v-model="form.phone" label="Phone" type="tel" />
          </FormLayoutGroup>
          <TextField v-model="form.address" label="Address" multiline="3" />
          <Select
            v-if="form.kind === 'customer' && tradingNameOptions.length > 2"
            v-model="form.tradingNameId"
            label="Invoice as"
            :options="tradingNameOptions"
            :placeholder="`Default (${defaultTradingName})`"
            help-text="New invoices and quotes for them start from this trading name."
          />
          <Select v-if="us" v-model="form.state" label="State" :options="stateOptions" :help-text="form.kind === 'customer' ? 'Where you deliver to. Counts towards that state\'s sales tax threshold.' : ''" />
          <template v-if="us && form.kind === 'customer' && session.books?.taxEnabled">
            <Select
              v-model="form.taxRateId"
              label="Sales tax rate"
              :options="rateOptions"
              help-text="New invoices for them start at this rate. Add rates in Settings."
            />
            <ToggleSwitch v-model="form.exempt" label="Doesn't pay sales tax (resale or exempt)" />
            <TextField
              v-if="form.exempt"
              v-model="form.taxExempt"
              label="Certificate"
              placeholder="e.g. Resale certificate 12-3456789, expires 2028"
              help-text="Keep a copy of the certificate. New invoices for them start with no sales tax."
            />
          </template>
          <template v-if="us && form.kind === 'vendor'">
            <ToggleSwitch v-model="form.is1099" label="Gets a Form 1099-NEC" />
            <p class="subdued Hint">
              For people and partnerships you pay for services, not goods. Corporations usually don't get one, except
              for legal services. Payments by card or a payment app are left out: those are reported on a 1099-K.
            </p>
            <template v-if="form.is1099">
              <FormLayoutGroup>
                <TextField v-model="form.legalName" label="Legal name (from their W-9)" :placeholder="form.name" />
                <TextField
                  v-model="form.tin"
                  label="TIN (SSN or EIN)"
                  :type="showTin ? 'text' : 'password'"
                  placeholder="123-45-6789"
                  @focus="showTin = true"
                  @blur="showTin = false"
                />
              </FormLayoutGroup>
              <p class="subdued Hint">The 1099 goes to the address above. Ask for a Form W-9 before you pay them.</p>
            </template>
          </template>
          <template v-if="au && form.kind === 'vendor'">
            <FormLayoutGroup>
              <TextField v-model="form.tin" label="ABN" placeholder="12 345 678 901" help-text="Without one, payments over $75 (before GST) need 47% withheld." />
              <TextField v-if="form.is1099" v-model="form.legalName" label="Legal name" :placeholder="form.name" />
            </FormLayoutGroup>
            <ToggleSwitch v-model="form.is1099" label="On my taxable payments annual report (TPAR)" />
            <p class="subdued Hint">
              For contractors you pay for services, if your business is in building and construction, cleaning,
              courier or road freight, IT, or security, investigation or surveillance. The TPAR is due 28 August.
            </p>
          </template>
          <template v-if="nz && form.kind === 'customer'">
            <TextField
              v-model="form.whtPct"
              label="Tax they withhold"
              suffix="%"
              placeholder="None"
              help-text="If they deduct withholding tax from what they pay you (schedular payments), the rate on the IR330C you gave them. Payments start with it worked out."
            />
          </template>
          <TextField v-model="form.notes" label="Notes" multiline="2" />
        </FormLayout>
      </ModalSection>
    </Modal>
  </Page>
</template>

<style scoped>
.Toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 12px;
}

.Toolbar__right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.Hint {
  margin: -4px 0 0;
  font-size: 12px;
}
</style>
