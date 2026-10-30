<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  Banner,
  Button,
  Card,
  CardSection,
  ChoiceList,
  FormLayout,
  FormLayoutGroup,
  Heading,
  Select,
  TextField,
  ToggleSwitch,
  toast,
} from '@octans/ui';
import { api, errorMessage } from '../lib/api';
import { openCompanyAt, pickAndOpenCompany, refreshSession } from '../lib/company';
import { today } from '../lib/dates';
import { CURRENCIES } from '../lib/money';
import { MONTHS, session } from '../lib/session';
import ThemeSwitch from '../components/ThemeSwitch.vue';
import splashSvg from '../assets/tiny-tally-splash.svg?raw';

// Inlined (not an <img>) so dark mode can lighten the navy lettering. The
// Illustrator class names are prefixed so they can't clash with anything else.
const splash = splashSvg
  .replace(/<\?xml[^>]*>/, '')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\bst(\d)\b/g, 'tts$1');

const props = defineProps<{ notice?: string | null; noticePath?: string | null }>();

const name = ref('');
const currency = ref(guessCurrency());
const fiscalYearStart = ref(currency.value === 'AUD' ? 7 : 1);
const taxEnabled = ref(true);
const abn = ref('');
const isAud = computed(() => currency.value === 'AUD');
const demoing = ref(false);

// Australian financial years start in July.
watch(currency, (c, prev) => {
  if (c === 'AUD' && fiscalYearStart.value === 1) fiscalYearStart.value = 7;
  else if (prev === 'AUD' && fiscalYearStart.value === 7) fiscalYearStart.value = 1;
});
const storage = ref<'internal' | 'folder'>('internal');
const folder = ref<string | null>(null);
const creating = ref(false);
const nameError = ref<string | null>(null);

const storageOptions = [
  {
    label: 'Store internally',
    value: 'internal',
    helpText: "Kept in Tiny Tally's own data folder. Simplest choice.",
  },
  {
    label: 'In a folder I choose',
    value: 'folder',
    helpText: 'Put it somewhere you back up, like Documents or a synced folder.',
  },
];

const currencyOptions = CURRENCIES.map((c) => ({ label: c, value: c }));
const monthOptions = MONTHS.map((m, i) => ({ label: m, value: i + 1 }));

const fileName = computed(() => {
  const safe = name.value.replace(/[^\p{L}\p{N} _.-]+/gu, '').trim().replace(/\s+/g, ' ');
  return (safe || 'Company') + '.tally';
});

const destination = computed(() =>
  storage.value === 'internal' ? 'Tiny Tally data folder' : folder.value ? `${folder.value}/${fileName.value}` : null,
);

function guessCurrency() {
  try {
    const region = new Intl.Locale(navigator.language).maximize().region;
    const byRegion: Record<string, string> = {
      AU: 'AUD', CA: 'CAD', CH: 'CHF', CN: 'CNY', GB: 'GBP', HK: 'HKD', ID: 'IDR', IN: 'INR',
      JP: 'JPY', MY: 'MYR', NZ: 'NZD', PH: 'PHP', SG: 'SGD', TH: 'THB', US: 'USD', VN: 'VND',
      ZA: 'ZAR', DE: 'EUR', FR: 'EUR', ES: 'EUR', IT: 'EUR', NL: 'EUR', IE: 'EUR',
    };
    return (region && byRegion[region]) || 'USD';
  } catch {
    return 'USD';
  }
}

async function chooseFolder() {
  const picked = await tiny.dialog.pickFolder();
  if (picked) {
    folder.value = picked;
    storage.value = 'folder';
  }
}

async function create() {
  nameError.value = name.value.trim() ? null : 'Give the company a name.';
  if (nameError.value) return;
  if (storage.value === 'folder' && !folder.value) {
    await chooseFolder();
    if (!folder.value) return;
  }
  creating.value = true;
  try {
    await api.createCompany({
      name: name.value.trim(),
      currency: currency.value,
      fiscalYearStart: fiscalYearStart.value,
      ...(isAud.value ? { taxEnabled: taxEnabled.value, abn: taxEnabled.value ? abn.value.trim() : '' } : { taxEnabled: false }),
      dir: storage.value === 'internal' ? null : folder.value,
    });
    await refreshSession();
  } catch (e) {
    toast({ title: "Couldn't create company", content: errorMessage(e), tone: 'error' });
  } finally {
    creating.value = false;
  }
}

async function tryDemo() {
  demoing.value = true;
  try {
    await api.createDemo(null, today());
    await refreshSession();
    toast({ title: 'Demo company ready', content: 'Explore freely. It lives in its own file and is separate from your real books.' });
  } catch (e) {
    toast({ title: "Couldn't create the demo", content: errorMessage(e), tone: 'error' });
  } finally {
    demoing.value = false;
  }
}

async function forget(path: string) {
  session.recent = await api.forgetCompany(path);
}

function shortPath(path: string) {
  if (session.internalDir && path.startsWith(session.internalDir + '/')) return 'Stored internally';
  return path.slice(0, path.lastIndexOf('/'));
}
</script>

<template>
  <div class="Welcome">
    <div class="Welcome__theme"><ThemeSwitch /></div>
    <div class="Welcome__inner">
      <header class="Welcome__header">
        <div class="Welcome__splash" role="img" aria-label="Tiny Tally: Simple. Free. Local." v-html="splash" />
        <Heading element="h1" class="sr-only">Welcome to Tiny Tally</Heading>
        <p class="subdued">Bookkeeping for small businesses. Your data stays in one file on your computer.</p>
      </header>

      <Banner v-if="props.notice" status="warning" title="Couldn't reopen your last company">
        <p>{{ props.notice }}</p>
        <Button
          v-if="props.noticePath"
          type="plain"
          @click="forget(props.noticePath)"
        >Remove from recent</Button>
      </Banner>

      <Card v-if="session.recent.length" title="Recent companies">
        <CardSection>
          <ul class="Recent">
            <li v-for="r in session.recent" :key="r.path" class="Recent__row">
              <button class="Recent__open" type="button" @click="openCompanyAt(r.path)">
                <span class="Recent__name"><span v-if="r.color" class="Recent__dot" :style="{ background: r.color }" />{{ r.name }}</span>
                <span class="Recent__path subdued">{{ shortPath(r.path) }}</span>
              </button>
              <Button type="plain" icon="mdi:close" tooltip="Remove from list" @click="forget(r.path)" />
            </li>
          </ul>
        </CardSection>
      </Card>

      <Card title="Start a new company">
        <CardSection>
          <FormLayout>
            <TextField
              v-model="name"
              label="Company name"
              placeholder="e.g. Acme Design Studio"
              required
              :error="nameError"
              @keydown.enter="create"
            />
            <FormLayoutGroup>
              <Select v-model="currency" label="Currency" :options="currencyOptions" searchable />
              <Select
                v-model="fiscalYearStart"
                label="Financial year starts"
                :options="monthOptions"
              />
            </FormLayoutGroup>
            <template v-if="isAud">
              <ToggleSwitch v-model="taxEnabled" label="Registered for GST" help-text="Tracks GST on sales and purchases and prepares your BAS." />
              <TextField v-if="taxEnabled" v-model="abn" label="ABN (optional)" placeholder="51 824 753 556" help-text="Shown on tax invoices. You can add it later in Settings." />
            </template>
            <ChoiceList v-model="storage" label="Where should the company file live?" :options="storageOptions" />
            <div v-if="storage === 'folder'" class="Folder">
              <span class="Folder__path" :class="{ subdued: !folder }">
                {{ folder ? destination : 'No folder chosen yet' }}
              </span>
              <Button icon="mdi:folder-open-outline" @click="chooseFolder">
                {{ folder ? 'Change…' : 'Choose folder…' }}
              </Button>
            </div>
          </FormLayout>
        </CardSection>
        <CardSection>
          <div class="Actions">
            <Button type="plain" icon="mdi:file-outline" @click="pickAndOpenCompany">Open existing file…</Button>
            <Button type="primary" :loading="creating" @click="create">Create company</Button>
          </div>
        </CardSection>
      </Card>

      <div class="Demo">
        <span class="subdued">Just looking?</span>
        <Button type="plain" icon="mdi:storefront-outline" :loading="demoing" @click="tryDemo">Try a demo company with sample data</Button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.Recent__dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  margin-right: 8px;
  vertical-align: 0;
}

.Demo {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 4px;
  font-size: 14px;
}

.Welcome {
  min-height: 100%;
  display: flex;
  justify-content: center;
  padding: 48px 24px;
  background: var(--octans-surface-app);
  overflow: auto;
}

.Welcome__theme {
  position: fixed;
  top: 12px;
  right: 12px;
}

.Welcome__inner {
  width: 100%;
  max-width: 560px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.Welcome__header {
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.Welcome__splash {
  width: 240px;
  padding: 12px;
}

.Welcome__splash :deep(svg) {
  display: block;
  width: 100%;
  height: auto;
}

.Recent {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.Recent__row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.Recent__open {
  font: inherit;
  color: var(--octans-text);
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  text-align: left;
  gap: 2px;
  padding: 8px 10px;
  border: 0;
  border-radius: 8px;
  background: none;
  cursor: pointer;
}

.Recent__open:hover,
.Recent__open:focus-visible {
  background: var(--octans-surface-hover);
}

.Recent__name {
  font-weight: 600;
}

.Recent__path {
  font-size: 12px;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.Folder {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-left: 28px;
}

.Folder__path {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  overflow-wrap: anywhere;
}

.Actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
</style>

<style>
/* Dark mode: the logo's navy (tts4 in the splash SVG) becomes a soft white. */
html[data-octans-theme='dark'] .Welcome__splash .tts4 {
  fill: #e6edf5;
}

@media (prefers-color-scheme: dark) {
  html:not([data-octans-theme='light']) .Welcome__splash .tts4 {
    fill: #e6edf5;
  }
}
</style>
