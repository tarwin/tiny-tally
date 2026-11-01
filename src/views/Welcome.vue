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
import { openBooksAt, pickAndOpenBooks, refreshSession } from '../lib/books';
import { today } from '../lib/dates';
import { joinYearStart, splitYearStart, YEAR_START_DAYS } from '../lib/periods';
import { COUNTRIES, COUNTRY_OPTIONS, type Country } from '../shared/countries';
import { MONTHS, session } from '../lib/session';
import ThemeSwitch from '../components/ThemeSwitch.vue';
import { appSettingsPanel } from '../lib/appSettings';
import splashSvg from '../assets/tiny-tally-splash.svg?raw';

// Inlined (not an <img>) so dark mode can lighten the navy lettering. The
// Illustrator class names are prefixed so they can't clash with anything else.
const splash = splashSvg
  .replace(/<\?xml[^>]*>/, '')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\bst(\d)\b/g, 'tts$1');

const props = defineProps<{ notice?: string | null; noticePath?: string | null }>();

const name = ref('');
/** The first trading name; blank means trading under your own name. */
const tradingName = ref('');
// No default country: the webview's locale is often en-US even in
// Australia, and the country decides the tax rules.
const country = ref<Country | null>(null);
const countryError = ref<string | null>(null);
const profile = computed(() => (country.value ? COUNTRIES[country.value] : null));
const fiscalYearStart = ref('01-01');
const taxEnabled = ref(true);
const taxId = ref('');
const demoing = ref(false);

watch(country, (c) => {
  if (c) fiscalYearStart.value = COUNTRIES[c].fiscalYearStart;
  countryError.value = null;
});
const fyMonth = computed({
  get: () => splitYearStart(fiscalYearStart.value).month,
  set: (m: number) => (fiscalYearStart.value = joinYearStart(m, splitYearStart(fiscalYearStart.value).day)),
});
const fyDay = computed({
  get: () => splitYearStart(fiscalYearStart.value).day,
  set: (d: number) => (fiscalYearStart.value = joinYearStart(splitYearStart(fiscalYearStart.value).month, d)),
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

const monthOptions = MONTHS.map((m, i) => ({ label: m, value: i + 1 }));

const fileName = computed(() => {
  const safe = (tradingName.value.trim() || name.value).replace(/[^\p{L}\p{N} _.-]+/gu, '').trim().replace(/\s+/g, ' ');
  return (safe || 'Books') + '.tally';
});

const destination = computed(() =>
  storage.value === 'internal' ? 'Tiny Tally data folder' : folder.value ? `${folder.value}/${fileName.value}` : null,
);

async function chooseFolder() {
  const picked = await tiny.dialog.pickFolder();
  if (picked) {
    folder.value = picked;
    storage.value = 'folder';
  }
}

async function create() {
  nameError.value = name.value.trim() ? null : 'Enter your name.';
  countryError.value = country.value ? null : 'Choose the country your business is in.';
  if (nameError.value || !country.value) return;
  if (storage.value === 'folder' && !folder.value) {
    await chooseFolder();
    if (!folder.value) return;
  }
  creating.value = true;
  try {
    await api.createBooks({
      name: name.value.trim(),
      tradingName: tradingName.value.trim() || undefined,
      country: country.value,
      fiscalYearStart: fiscalYearStart.value,
      taxEnabled: !!profile.value?.tax && taxEnabled.value,
      taxId: taxId.value.trim(),
      dir: storage.value === 'internal' ? null : folder.value,
    });
    await refreshSession();
  } catch (e) {
    toast({ title: "Couldn't create books", content: errorMessage(e), tone: 'error' });
  } finally {
    creating.value = false;
  }
}

async function tryDemo() {
  demoing.value = true;
  try {
    await api.createDemo(null, today());
    await refreshSession();
    toast({ title: 'Demo books ready', content: 'Explore freely. They live in their own file and is separate from your real books.' });
  } catch (e) {
    toast({ title: "Couldn't create the demo", content: errorMessage(e), tone: 'error' });
  } finally {
    demoing.value = false;
  }
}

async function forget(path: string) {
  session.recent = await api.forgetBooks(path);
}

function shortPath(path: string) {
  if (session.internalDir && path.startsWith(session.internalDir + '/')) return 'Stored internally';
  return path.slice(0, path.lastIndexOf('/'));
}
</script>

<template>
  <div class="Welcome">
    <div class="Welcome__theme">
      <Button type="plain" icon="mdi:tune-variant" tooltip="App settings" tooltip-position="left" @click="appSettingsPanel.visible = true" />
      <ThemeSwitch />
    </div>
    <div class="Welcome__inner">
      <header class="Welcome__header">
        <div class="Welcome__splash" role="img" aria-label="Tiny Tally: Simple. Free. Local." v-html="splash" />
        <Heading element="h1" class="sr-only">Welcome to Tiny Tally</Heading>
        <p class="subdued">Bookkeeping for small businesses. Your data stays in one file on your computer.</p>
      </header>

      <Banner v-if="props.notice" status="warning" title="Couldn't reopen your last books">
        <p>{{ props.notice }}</p>
        <Button
          v-if="props.noticePath"
          type="plain"
          @click="forget(props.noticePath)"
        >Remove from recent</Button>
      </Banner>

      <Card v-if="session.recent.length" title="Recent books">
        <CardSection>
          <ul class="Recent">
            <li v-for="r in session.recent" :key="r.path" class="Recent__row">
              <button class="Recent__open" type="button" @click="openBooksAt(r.path)">
                <span class="Recent__name"><span v-if="r.color" class="Recent__dot" :style="{ background: r.color }" />{{ r.name }}</span>
                <span class="Recent__path subdued">{{ shortPath(r.path) }}</span>
              </button>
              <Button type="plain" icon="mdi:close" tooltip="Remove from list" @click="forget(r.path)" />
            </li>
          </ul>
        </CardSection>
      </Card>

      <Card title="Start new books">
        <CardSection>
          <FormLayout>
            <FormLayoutGroup>
              <TextField
                v-model="name"
                label="Your name"
                placeholder="e.g. Sam Rivera"
                required
                :error="nameError"
                @keydown.enter="create"
              />
              <TextField
                v-model="tradingName"
                label="Trading as (optional)"
                placeholder="e.g. Acme Design Studio"
                help-text="The name on your invoices. You can add more later."
                @keydown.enter="create"
              />
            </FormLayoutGroup>
            <Select
              v-model="country"
              label="Country"
              :options="COUNTRY_OPTIONS"
              placeholder="Choose…"
              required
              :error="countryError ?? undefined"
              :help-text="profile ? `Amounts are in ${profile.currency}. This can't be changed later.` : 'Sets the currency and tax rules.'"
            />
            <template v-if="profile">
              <FormLayoutGroup>
                <Select v-model="fyMonth" label="Financial year starts" :options="monthOptions" />
                <Select v-model="fyDay" label="Day" :options="YEAR_START_DAYS" />
              </FormLayoutGroup>
              <ToggleSwitch v-if="profile.tax" v-model="taxEnabled" label="Registered for GST" help-text="Tracks GST on sales and purchases and prepares your BAS." />
              <TextField
                v-model="taxId"
                :label="`${profile.taxId.label} (optional)`"
                :placeholder="profile.taxId.placeholder"
                :error="profile.taxId.check(taxId) ?? undefined"
                help-text="Shown on your invoices. You can add it later in Settings."
              />
            </template>
            <ChoiceList v-model="storage" label="Where should your books live?" :options="storageOptions" />
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
            <Button type="plain" icon="mdi:file-outline" @click="pickAndOpenBooks">Open existing file…</Button>
            <Button type="primary" :loading="creating" @click="create">Create books</Button>
          </div>
        </CardSection>
      </Card>

      <div class="Demo">
        <span class="subdued">Just looking?</span>
        <Button type="plain" icon="mdi:storefront-outline" :loading="demoing" @click="tryDemo">Try demo books with sample data</Button>
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
  display: flex;
  gap: 4px;
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
