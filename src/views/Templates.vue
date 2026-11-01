<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  Badge,
  Button,
  Card,
  CardSection,
  Checkbox,
  FormLayout,
  Page,
  SegmentedControl,
  TextField,
  ToggleSwitch,
  confirmModal,
  toast,
} from '@octans/ui';
import InvoiceDocument, { type InvoiceDocData } from '../components/InvoiceDocument.vue';
import PaperPreview from '../components/PaperPreview.vue';
import { api, errorMessage, type InvoiceTemplate, type TemplateInput, type TemplateStyle } from '../lib/api';
import { addDays, today } from '../lib/dates';
import { session } from '../lib/session';
import { countryProfile } from '../shared/countries';
import { lineTotals, sumTotals } from '../shared/tax';
import {
  LABELS,
  PLACEHOLDERS,
  SECTION_INFO,
  SHOW,
  defaultLayout,
  normaliseLayout,
  type LabelKey,
  type ShowKey,
  type TemplateSection,
} from '../shared/templateLayout';

const router = useRouter();
const templates = ref<InvoiceTemplate[]>([]);
const selectedId = ref<number | null>(null);
const saving = ref(false);
const form = ref<TemplateInput>(blank());
const dirty = ref(false);

const books = computed(() => session.books!);
const profile = computed(() => countryProfile(books.value.country));

const ACCENTS = ['#2f6fde', '#0f766e', '#7c3aed', '#be123c', '#c2410c', '#1d1f24'];

const styleOptions: { label: string; value: TemplateStyle }[] = [
  { label: 'Classic', value: 'classic' },
  { label: 'Modern', value: 'modern' },
  { label: 'Minimal', value: 'minimal' },
];

function blank(): TemplateInput {
  return {
    name: 'New template',
    style: 'classic',
    accent: '#2f6fde',
    logo: null,
    title: countryProfile(books.value.country).invoiceTitle(true),
    paymentDetails: '',
    footer: '',
    showTaxColumn: true,
    layout: defaultLayout(),
  };
}

function select(t: InvoiceTemplate | null) {
  selectedId.value = t?.id ?? null;
  form.value = t
    ? {
        id: t.id,
        name: t.name,
        style: t.style,
        accent: t.accent,
        logo: t.logo,
        title: t.title,
        paymentDetails: t.paymentDetails ?? '',
        footer: t.footer ?? '',
        showTaxColumn: t.showTaxColumn,
        layout: normaliseLayout(JSON.parse(JSON.stringify(t.layout))),
      }
    : blank();
  dirty.value = false;
}

async function load(keep?: number | null) {
  templates.value = await api.listTemplates();
  const t = templates.value.find((x) => x.id === (keep ?? selectedId.value)) ?? templates.value[0] ?? null;
  select(t);
}

function touch() {
  dirty.value = true;
}

// ---- wording and layout ----------------------------------------------------------

const panel = ref<'style' | 'wording' | 'layout'>('style');
const panelOptions = [
  { label: 'Style', value: 'style' },
  { label: 'Wording', value: 'wording' },
  { label: 'Layout', value: 'layout' },
];

const labelKeys = (Object.keys(LABELS) as LabelKey[]).filter((k) => books.value.taxEnabled || !['gst', 'gstTotal', 'subtotal'].includes(k));
const showKeys = Object.keys(SHOW) as ShowKey[];
const placeholderText = Object.keys(PLACEHOLDERS).map((k) => `{${k}}`).join(' ');
const priceDefault = computed(() => (books.value.taxEnabled ? 'Price ex. GST / inc. GST' : 'Price'));

function setLabel(key: LabelKey, value: string) {
  form.value.layout.labels[key] = value;
  touch();
}

function setShow(key: ShowKey, value: boolean) {
  form.value.layout.show[key] = value;
  touch();
}

function move(i: number, dir: -1 | 1) {
  const list = form.value.layout.sections;
  const j = i + dir;
  if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  touch();
}

function patchSection(s: TemplateSection, patch: Partial<TemplateSection>) {
  Object.assign(s, patch);
  touch();
}

function resetLayout() {
  const d = defaultLayout();
  form.value.layout.sections = d.sections;
  touch();
}

const ALIGN_OPTIONS = [
  { label: '', value: 'left', icon: 'mdi:format-align-left' },
  { label: '', value: 'center', icon: 'mdi:format-align-center' },
  { label: '', value: 'right', icon: 'mdi:format-align-right' },
];
const SIZE_OPTIONS = [
  { label: 'S', value: 'small' },
  { label: 'M', value: 'normal' },
  { label: 'L', value: 'large' },
];

async function save() {
  saving.value = true;
  try {
    const id = await api.saveTemplate(form.value);
    toast({ title: 'Template saved', tone: 'success' });
    await load(id);
  } catch (e) {
    toast({ title: "Couldn't save template", content: errorMessage(e), tone: 'error' });
  } finally {
    saving.value = false;
  }
}

async function makeDefault() {
  if (!selectedId.value) return;
  await api.setDefaultTemplate(selectedId.value);
  toast({ title: `${form.value.name} is now the default` });
  await load();
}

async function remove() {
  const t = templates.value.find((x) => x.id === selectedId.value);
  if (!t) return;
  const ok = await confirmModal({
    title: `Delete “${t.name}”?`,
    content: t.uses ? `${t.uses} invoice${t.uses === 1 ? '' : 's'} use it. They'll switch to the default template.` : 'This template will be removed.',
    primaryActionLabel: 'Delete',
    primaryActionType: 'destructive',
    secondaryActionLabel: 'Cancel',
  });
  if (!ok) return;
  try {
    await api.deleteTemplate(t.id);
    selectedId.value = null;
    await load();
  } catch (e) {
    toast({ title: errorMessage(e), tone: 'error' });
  }
}

async function chooseLogo() {
  const path = await tiny.dialog.openFile({ types: ['png', 'jpg', 'jpeg', 'svg', 'webp'] });
  if (!path) return;
  try {
    form.value.logo = await api.readLogo(path);
    touch();
  } catch (e) {
    toast({ title: "Couldn't use that image", content: errorMessage(e), tone: 'error' });
  }
}

function startNew() {
  select(null);
  dirty.value = true;
}

// A realistic sample so layout decisions are made against real content.
const sample = computed<InvoiceDocData>(() => {
  const taxOn = books.value.taxEnabled;
  const raw = [
    { description: 'Brand strategy workshop', qtyMilli: 1000, unitPrice: 150000, taxCode: 'GST' as const },
    { description: 'Logo design: three concepts, two rounds of changes', qtyMilli: 1000, unitPrice: 240000, taxCode: 'GST' as const },
    { description: 'Design hours', qtyMilli: 6500, unitPrice: 14000, taxCode: 'GST' as const },
  ];
  const lines = raw.map((l) => ({ ...l, categoryId: null, ...lineTotals(l, false, taxOn, books.value.taxRateBp) }));
  const t = sumTotals(lines);
  return {
    number: `${books.value.invoicePrefix}0042`,
    issueDate: today(),
    dueDate: addDays(today(), books.value.paymentTermsDays),
    reference: 'PO 7781',
    notes: 'Thanks for the brief. Final files are delivered once this invoice is paid.',
    contactName: 'Sample Customer Pty Ltd',
    contactEmail: 'accounts@customer.example',
    contactAddress: '1 Sample Street\nSydney NSW 2000',
    pricesIncludeTax: false,
    lines,
    net: t.net,
    tax: t.tax,
    total: t.gross,
  };
});

onMounted(() => load());
</script>

<template>
  <Page
    title="Invoice templates"
    :breadcrumbs="[{ label: 'Invoices', onAction: () => router.push('/invoices') }]"
    size="fullWidth"
    :primary-action="{ label: 'New template', icon: 'mdi:plus', onAction: startNew }"
  >
    <div class="Grid">
      <aside class="Side">
        <Card>
          <CardSection>
            <ul class="List">
              <li v-for="t in templates" :key="t.id">
                <button type="button" class="List__item" :class="{ 'List__item--on': t.id === selectedId }" @click="select(t)">
                  <span class="List__swatch" :style="{ background: t.accent }" />
                  <span class="List__name">{{ t.name }}</span>
                  <Badge v-if="t.isDefault" size="small">Default</Badge>
                </button>
              </li>
              <li v-if="!selectedId">
                <span class="List__item List__item--on">
                  <span class="List__swatch" :style="{ background: form.accent }" />
                  <span class="List__name">{{ form.name || 'New template' }}</span>
                </span>
              </li>
            </ul>
          </CardSection>
        </Card>

        <Card>
          <CardSection>
            <SegmentedControl v-model="panel" :options="panelOptions" full-width />
          </CardSection>
          <CardSection v-if="panel === 'style'">
            <FormLayout>
              <TextField v-model="form.name" label="Template name" @update:model-value="touch" />
              <div>
                <div class="Label">Layout</div>
                <SegmentedControl v-model="form.style" :options="styleOptions" full-width @update:model-value="touch" />
              </div>
              <div>
                <div class="Label">Accent colour</div>
                <div class="Swatches">
                  <button
                    v-for="c in ACCENTS"
                    :key="c"
                    type="button"
                    class="Swatch"
                    :class="{ 'Swatch--on': form.accent.toLowerCase() === c }"
                    :style="{ background: c }"
                    :aria-label="c"
                    @click="(form.accent = c), touch()"
                  />
                  <label class="Swatch Swatch--custom" :style="{ background: form.accent }" title="Pick any colour">
                    <input v-model="form.accent" type="color" @input="touch" />
                  </label>
                </div>
              </div>
              <div>
                <div class="Label">Logo</div>
                <div class="Logo">
                  <img v-if="form.logo" :src="form.logo" alt="" />
                  <Button icon="mdi:image-outline" @click="chooseLogo">{{ form.logo ? 'Change…' : 'Choose image…' }}</Button>
                  <Button v-if="form.logo" type="plain" @click="(form.logo = null), touch()">Remove</Button>
                </div>
              </div>
              <TextField
                v-model="form.title"
                label="Document title"
                :help-text="books.taxEnabled ? 'GST-registered businesses must use “Tax Invoice” for taxable sales.' : ''"
                @update:model-value="touch"
              />
              <TextField
                v-model="form.paymentDetails"
                label="Payment details"
                multiline="3"
                placeholder="Bank name, BSB and account number, PayID…"
                @update:model-value="touch"
              />
              <TextField v-model="form.footer" label="Footer" multiline="2" placeholder="Thank-you note, terms, website…" @update:model-value="touch" />
              <ToggleSwitch v-if="books.taxEnabled" v-model="form.showTaxColumn" label="Show GST on each line" @update:model-value="touch" />
            </FormLayout>
          </CardSection>

          <CardSection v-else-if="panel === 'wording'">
            <FormLayout>
              <TextField
                :model-value="form.layout.intro"
                label="Intro text"
                multiline="3"
                placeholder="Hi {customer}, thanks for your business. Here's invoice {number}."
                @update:model-value="(v) => ((form.layout.intro = String(v ?? '')), touch())"
              />
              <p class="subdued Small Flush">
                The intro, payment details and footer can use <code>{{ placeholderText }}</code>.
              </p>
              <div>
                <div class="Label">Show</div>
                <div class="Checks">
                  <Checkbox
                    v-for="k in showKeys"
                    :key="k"
                    :model-value="k === 'taxId' && books.taxEnabled ? true : form.layout.show[k]"
                    :disabled="k === 'taxId' && books.taxEnabled"
                    :label="k === 'taxId' ? profile.taxId.label : SHOW[k]"
                    @update:model-value="(v: boolean) => setShow(k, v)"
                  />
                </div>
                <p v-if="books.taxEnabled" class="subdued Small Flush">Tax invoices must show your {{ profile.taxId.label }}, so it can't be hidden.</p>
              </div>
              <div>
                <div class="Label">Labels <span class="subdued Small">· leave blank for the standard wording</span></div>
                <div class="Labels">
                  <TextField
                    v-for="k in labelKeys"
                    :key="k"
                    :model-value="form.layout.labels[k] ?? ''"
                    :label="LABELS[k].label"
                    :placeholder="k === 'price' ? priceDefault : LABELS[k].default"
                    size="small"
                    @update:model-value="(v) => setLabel(k, String(v ?? ''))"
                  />
                </div>
                <p class="subdued Small Flush">Quotes and credit notes keep their own wording for the number, customer and total.</p>
              </div>
            </FormLayout>
          </CardSection>

          <CardSection v-else>
            <p class="subdued Small Top">Top to bottom. Sections pinned to the bottom sit side by side at the foot of the page.</p>
            <ol class="Sections">
              <li v-for="(sec, i) in form.layout.sections" :key="sec.key" class="Sec">
                <div class="Sec__head">
                  <span class="Sec__name">{{ SECTION_INFO[sec.key].label }}</span>
                  <Button size="small" type="plain" icon="mdi:arrow-up" tooltip="Move up" :disabled="i === 0" @click="move(i, -1)" />
                  <Button size="small" type="plain" icon="mdi:arrow-down" tooltip="Move down" :disabled="i === form.layout.sections.length - 1" @click="move(i, 1)" />
                </div>
                <div class="Sec__controls">
                  <SegmentedControl
                    v-if="SECTION_INFO[sec.key].aligns"
                    :model-value="sec.align"
                    :options="ALIGN_OPTIONS"
                    size="small"
                    @update:model-value="(v: TemplateSection['align']) => patchSection(sec, { align: v })"
                  />
                  <SegmentedControl
                    :model-value="sec.size"
                    :options="SIZE_OPTIONS"
                    size="small"
                    @update:model-value="(v: TemplateSection['size']) => patchSection(sec, { size: v })"
                  />
                  <Checkbox
                    v-if="sec.key !== 'header' && sec.key !== 'lines' && sec.key !== 'totals'"
                    :model-value="sec.bottom"
                    label="Bottom"
                    @update:model-value="(v: boolean) => patchSection(sec, { bottom: v })"
                  />
                </div>
                <p v-if="SECTION_INFO[sec.key].help" class="subdued Small Flush">{{ SECTION_INFO[sec.key].help }}</p>
              </li>
            </ol>
            <Button type="plain" icon="mdi:restore" @click="resetLayout">Reset order and sizes</Button>
          </CardSection>
          <CardSection>
            <div class="Actions">
              <Button v-if="selectedId && !templates.find((t) => t.id === selectedId)?.isDefault" type="plain" @click="makeDefault">Make default</Button>
              <Button v-if="selectedId && !templates.find((t) => t.id === selectedId)?.isDefault" type="plain" icon="mdi:delete-outline" @click="remove" />
              <span class="Spacer" />
              <Button type="primary" :disabled="!dirty" :loading="saving" @click="save">Save</Button>
            </div>
          </CardSection>
        </Card>
      </aside>

      <div class="Preview">
        <div class="Preview__label subdued">Preview with sample data</div>
        <PaperPreview zoomable>
          <InvoiceDocument :invoice="sample" :books="books" :template="form" />
        </PaperPreview>
        <p v-if="!books.taxId || !books.businessAddress" class="subdued Preview__hint">
          Add your {{ profile.taxId.label }} and address in <a href="#/settings">Settings</a> so they appear on invoices.
        </p>
      </div>
    </div>
  </Page>
</template>

<style scoped>
.Small {
  font-size: 12px;
}

.Flush {
  margin: 4px 0 0;
}

.Top {
  margin: 0 0 10px;
}

.Checks {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px 12px;
}

.Labels {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.Sections {
  list-style: none;
  margin: 0 0 8px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.Sec {
  padding: 8px 10px;
  border: 1px solid var(--octans-border);
  border-radius: 8px;
}

.Sec__head {
  display: flex;
  align-items: center;
  gap: 2px;
}

.Sec__name {
  flex: 1;
  font-weight: 500;
}

.Sec__controls {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 6px;
}

.Grid {
  display: grid;
  grid-template-columns: 360px minmax(0, 1fr);
  gap: 20px;
  align-items: start;
}

.Side {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.List {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.List__item {
  font: inherit;
  color: var(--octans-text);
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: 0;
  border-radius: 8px;
  background: none;
  cursor: pointer;
  text-align: left;
}

.List__item:hover {
  background: var(--octans-surface-hover);
}

.List__item--on {
  background: var(--octans-surface-selected);
}

.List__name {
  flex: 1;
}

.List__swatch {
  width: 14px;
  height: 14px;
  border-radius: 4px;
  flex: none;
}

.Label {
  font-size: 13px;
  margin-bottom: 6px;
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

.Swatch--custom {
  background-image: conic-gradient(red, yellow, lime, aqua, blue, magenta, red) !important;
}

.Swatch--custom input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}

.Logo {
  display: flex;
  align-items: center;
  gap: 8px;
}

.Logo img {
  max-height: 40px;
  max-width: 120px;
  object-fit: contain;
  background: #fff;
  border-radius: 4px;
  padding: 4px;
}

.Actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.Spacer {
  flex: 1;
}

.Preview {
  background: var(--octans-surface-sunken);
  border-radius: 12px;
  padding: 20px;
  min-width: 0;
  position: sticky;
  top: 16px;
}

.Preview__label {
  font-size: 12px;
  margin-bottom: 12px;
}

.Preview__hint {
  margin: 16px 0 0;
  font-size: 13px;
  text-align: center;
}

.Preview__hint a {
  color: var(--octans-text-link);
}
</style>
