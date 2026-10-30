<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  Button,
  Icon,
  Card,
  CardSection,
  DatePicker,
  FormLayout,
  FormLayoutGroup,
  Page,
  SegmentedControl,
  Select,
  TextField,
  ToggleSwitch,
  confirmModal,
  toast,
} from '@octans/ui';
import { api, errorMessage, type Company } from '../lib/api';
import { backupCompany, closeCompany } from '../lib/company';
import { formatDay } from '../lib/dates';
import { CURRENCIES } from '../lib/money';
import { MONTHS, session } from '../lib/session';
import ThemeSwitch from '../components/ThemeSwitch.vue';

type Form = Omit<
  Company,
  'path' | 'internal' | 'taxRateBp' | 'lockDate' | 'invoiceNext' | 'paymentTermsDays' | 'billNext' | 'quoteNext' | 'creditNext'
> & {
  invoiceNext: string;
  paymentTermsDays: string;
};

const company = computed(() => session.company!);
const COMPANY_COLORS = ['#2d8c49', '#2f6fde', '#7c3aed', '#db2777', '#dc2626', '#ea580c', '#ca8a04', '#0891b2'];

const form = ref<Form>(fromCompany(company.value));
const saving = ref(false);
const nameError = ref<string | null>(null);

function fromCompany(c: Company): Form {
  return {
    name: c.name,
    currency: c.currency,
    fiscalYearStart: c.fiscalYearStart,
    taxEnabled: c.taxEnabled,
    abn: c.abn,
    taxBasis: c.taxBasis,
    basFrequency: c.basFrequency,
    pricesIncludeTax: c.pricesIncludeTax,
    invoicePrefix: c.invoicePrefix,
    quotePrefix: c.quotePrefix,
    creditPrefix: c.creditPrefix,
    billPrefix: c.billPrefix,
    invoiceNext: String(c.invoiceNext),
    paymentTermsDays: String(c.paymentTermsDays),
    businessAddress: c.businessAddress,
    businessEmail: c.businessEmail,
    businessPhone: c.businessPhone,
    color: c.color,
    logo: c.logo,
  };
}

watch(company, (c) => (form.value = fromCompany(c)));

const changed = computed(() => JSON.stringify(form.value) !== JSON.stringify(fromCompany(company.value)));

const currencyOptions = CURRENCIES.map((c) => ({ label: c, value: c }));
const monthOptions = MONTHS.map((m, i) => ({ label: m, value: i + 1 }));
const frequencyOptions = [
  { label: 'Quarterly', value: 'quarterly', description: 'Most small businesses. Uses Simpler BAS (G1, 1A, 1B).' },
  { label: 'Monthly', value: 'monthly', description: 'Required if GST turnover is $20 million or more; shows the full set of labels.' },
  { label: 'Annually', value: 'annual', description: 'For voluntary registrations under $75,000.' },
];

/** ABNs are 11 digits with a weighted checksum; catch typos early. */
function abnError(abn: string) {
  const digits = abn.replace(/\s/g, '');
  if (!digits) return null;
  if (!/^\d{11}$/.test(digits)) return 'An ABN is 11 digits.';
  const w = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  const sum = [...digits].reduce((t, d, i) => t + (Number(d) - (i === 0 ? 1 : 0)) * w[i], 0);
  return sum % 89 === 0 ? null : "That ABN doesn't look right. Check for a typo.";
}
const abnProblem = computed(() => (form.value.taxEnabled ? abnError(form.value.abn) : null));

async function chooseLogo() {
  const path = await tiny.dialog.openFile({ types: ['png', 'jpg', 'jpeg', 'svg', 'webp'] });
  if (!path) return;
  try {
    form.value.logo = await api.readLogo(path);
  } catch (e) {
    toast({ title: "Couldn't use that image", content: errorMessage(e), tone: 'error' });
  }
}

function reveal() {
  void tiny.app.shell.reveal(company.value.path);
}

async function save() {
  nameError.value = form.value.name.trim() ? null : 'Give the company a name.';
  if (nameError.value) return;
  saving.value = true;
  try {
    session.company = await api.updateSettings({
      ...form.value,
      invoiceNext: Number(form.value.invoiceNext),
      paymentTermsDays: Number(form.value.paymentTermsDays),
    });
    toast({ title: 'Settings saved', tone: 'success' });
  } catch (e) {
    toast({ title: "Couldn't save settings", content: errorMessage(e), tone: 'error' });
  } finally {
    saving.value = false;
  }
}

// ---- lock date ----------------------------------------------------------------

const newLock = ref<string>();

async function setLock(date: string | null) {
  if (date === null) {
    const ok = await confirmModal({
      title: 'Remove the lock?',
      content: 'Anything before the lock date becomes editable again. Changing it can make your books disagree with what you lodged.',
      primaryActionLabel: 'Remove lock',
      primaryActionType: 'destructive',
      secondaryActionLabel: 'Cancel',
    });
    if (!ok) return;
  }
  try {
    session.company = await api.updateSettings({ lockDate: date });
    newLock.value = undefined;
    toast({ title: date ? `Locked up to ${formatDay(date)}` : 'Lock removed' });
  } catch (e) {
    toast({ title: errorMessage(e), tone: 'error' });
  }
}
</script>

<template>
  <Page title="Settings" size="narrow">
    <div class="Stack">
      <Card title="Company">
        <CardSection>
          <FormLayout>
            <TextField v-model="form.name" label="Company name" required :error="nameError" />
            <FormLayoutGroup>
              <Select
                v-model="form.currency"
                label="Currency"
                :options="currencyOptions"
                searchable
                help-text="Changing this relabels amounts. It doesn't convert them."
              />
              <Select v-model="form.fiscalYearStart" label="Financial year starts" :options="monthOptions" />
            </FormLayoutGroup>
            <TextField v-model="form.businessAddress" label="Business address" multiline="3" help-text="Shown on your invoices." />
            <FormLayoutGroup>
              <TextField v-model="form.businessEmail" label="Email" type="email" />
              <TextField v-model="form.businessPhone" label="Phone" />
            </FormLayoutGroup>
            <div>
              <div class="Label">Logo</div>
              <div class="Logo">
                <span class="Logo__tile">
                  <img v-if="form.logo" :src="form.logo" alt="" />
                  <Icon v-else icon="mdi:image-outline" class="subdued" />
                </span>
                <Button icon="mdi:image-outline" @click="chooseLogo">{{ form.logo ? 'Change…' : 'Choose image…' }}</Button>
                <Button v-if="form.logo" type="plain" @click="form.logo = ''">Remove</Button>
              </div>
              <p class="subdued Help">Shown top left instead of the Tiny Tally logo. Square images work best. Invoice logos are set on each template.</p>
            </div>
            <div>
              <div class="Label">Colour</div>
              <div class="Swatches">
                <button
                  type="button"
                  class="Swatch Swatch--none"
                  :class="{ 'Swatch--on': !form.color }"
                  aria-label="No colour"
                  title="No colour"
                  @click="form.color = ''"
                />
                <button
                  v-for="c in COMPANY_COLORS"
                  :key="c"
                  type="button"
                  class="Swatch"
                  :class="{ 'Swatch--on': form.color === c }"
                  :style="{ background: c }"
                  :aria-label="c"
                  @click="form.color = c"
                />
                <label class="Swatch Swatch--custom" :style="{ background: form.color || undefined }" title="Pick any colour">
                  <input :value="form.color || '#2d8c49'" type="color" @input="form.color = ($event.target as HTMLInputElement).value" />
                </label>
              </div>
              <p class="subdued Help">A stripe down the left of the menu, so you can tell companies apart with several open.</p>
            </div>
          </FormLayout>
        </CardSection>
      </Card>

      <Card title="GST & BAS">
        <CardSection>
          <FormLayout>
            <ToggleSwitch v-model="form.taxEnabled" label="Registered for GST" />
            <template v-if="form.taxEnabled">
              <TextField v-model="form.abn" label="ABN" placeholder="51 824 753 556" :error="abnProblem ?? undefined" help-text="Required on tax invoices." />
              <div>
                <div class="Label">Accounting basis for GST</div>
                <SegmentedControl
                  v-model="form.taxBasis"
                  :options="[{ label: 'Cash', value: 'cash' }, { label: 'Accrual', value: 'accrual' }]"
                />
                <p class="subdued Hint">
                  Cash: report GST when money changes hands (most small businesses). Accrual: report it when you invoice or are billed.
                </p>
              </div>
              <Select v-model="form.basFrequency" label="BAS reporting" :options="frequencyOptions" show-description />
              <ToggleSwitch v-model="form.pricesIncludeTax" label="Invoice prices include GST by default" />
            </template>
          </FormLayout>
        </CardSection>
      </Card>

      <Card title="Invoices">
        <CardSection>
          <FormLayout>
            <FormLayoutGroup>
              <TextField v-model="form.invoicePrefix" label="Number prefix" placeholder="INV-" />
              <TextField v-model="form.invoiceNext" label="Next number" type="number" />
              <TextField v-model="form.paymentTermsDays" label="Payment terms" type="number" suffix="days" />
            </FormLayoutGroup>
            <p class="subdued Hint">The next invoice will be {{ form.invoicePrefix }}{{ String(form.invoiceNext).padStart(4, '0') }}.</p>
            <FormLayoutGroup>
              <TextField v-model="form.quotePrefix" label="Quote prefix" placeholder="QU-" />
              <TextField v-model="form.creditPrefix" label="Credit note prefix" placeholder="CN-" />
              <TextField v-model="form.billPrefix" label="Bill prefix" placeholder="BILL-" />
            </FormLayoutGroup>
          </FormLayout>
        </CardSection>
      </Card>

      <div v-if="changed" class="SaveBar">
        <span class="subdued">You have unsaved changes</span>
        <Button type="plain" @click="form = fromCompany(company)">Discard</Button>
        <Button type="primary" :loading="saving" @click="save">Save changes</Button>
      </div>

      <Card title="Lock date">
        <CardSection>
          <p class="Hint Top">
            <template v-if="company.lockDate">
              Transactions and invoices on or before <strong>{{ formatDay(company.lockDate) }}</strong> can't be changed.
              Lodging a BAS moves this forward automatically.
            </template>
            <template v-else>Nothing is locked. Lodging a BAS locks its period, or you can set a date yourself.</template>
          </p>
          <div class="Buttons Bottom">
            <DatePicker v-model="newLock" type="date" model-format="YYYY-MM-DD" placeholder="Lock up to…" />
            <Button :disabled="!newLock" @click="setLock(newLock ?? null)">Set lock</Button>
            <Button v-if="company.lockDate" type="plain" @click="setLock(null)">Remove lock</Button>
          </div>
        </CardSection>
      </Card>

      <Card title="Appearance">
        <CardSection>
          <div class="Row">
            <span>Theme</span>
            <ThemeSwitch />
          </div>
          <p class="subdued Hint">To follow your computer's light/dark setting instead, choose View → Appearance → System.</p>
        </CardSection>
      </Card>

      <Card title="Company file">
        <CardSection>
          <p class="subdued Label">{{ company.internal ? 'Stored internally' : 'Stored in your folder' }}</p>
          <p class="Path">{{ company.path }}</p>
          <div class="Buttons">
            <Button icon="mdi:folder-search-outline" @click="reveal">Show in Finder</Button>
            <Button icon="mdi:content-save-move-outline" @click="backupCompany">Back up now</Button>
          </div>
        </CardSection>
        <CardSection>
          <div class="Buttons">
            <Button type="plain" icon="mdi:logout" @click="closeCompany">Close company</Button>
          </div>
        </CardSection>
      </Card>
    </div>
  </Page>
</template>

<style scoped>
.Logo {
  display: flex;
  align-items: center;
  gap: 8px;
}

.Logo__tile {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: #fff;
  box-shadow: 0 0 0 1px var(--octans-border);
  display: grid;
  place-items: center;
  overflow: hidden;
  font-size: 20px;
}

.Logo__tile img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.Help {
  font-size: 12px;
  margin: 6px 0 0;
}

.Swatches {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.Swatch {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 2px solid var(--octans-surface);
  box-shadow: 0 0 0 1px var(--octans-border);
  cursor: pointer;
  padding: 0;
  position: relative;
  overflow: hidden;
}

.Swatch--on {
  box-shadow: 0 0 0 2px var(--octans-text);
}

/* Diagonal line: no colour. */
.Swatch--none {
  background: linear-gradient(135deg, transparent 45%, var(--octans-text-subdued) 45% 55%, transparent 55%), var(--octans-surface);
}

.Swatch--custom {
  background: conic-gradient(#e11d48, #f59e0b, #22c55e, #06b6d4, #6366f1, #e11d48);
}

.Swatch--custom input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}

.Stack {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.SaveBar {
  position: sticky;
  bottom: 12px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 12px 10px 16px;
  border-radius: 12px;
  background: var(--octans-surface-raised, var(--octans-surface));
  border: 1px solid var(--octans-border);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
  z-index: 2;
}

.SaveBar > :first-child {
  margin-right: auto;
}

.Top {
  margin-top: 0;
}

.Bottom {
  align-items: center;
}

.Row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.Hint {
  margin: 8px 0 0;
  font-size: 13px;
}

.Label {
  margin: 0 0 4px;
  font-size: 13px;
}

.Path {
  margin: 0 0 12px;
  font-family: var(--octans-font-mono);
  font-size: 12px;
  overflow-wrap: anywhere;
}

.Buttons {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
</style>
