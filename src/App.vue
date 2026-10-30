<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { AppFrame, Navigation, Spinner, UiProvider, toast, type NavigationSectionType } from '@octans/ui';
import EntryEditor from './components/EntryEditor.vue';
import Welcome from './views/Welcome.vue';
import character from './assets/tiny-tally-character.svg';
import { api } from './lib/api';
import { backupCompany, closeCompany, openCompanyAt, pickAndOpenCompany } from './lib/company';
import { today } from './lib/dates';
import { dataChanged, newEntry } from './lib/entryEditor';
import { session } from './lib/session';
import { THEME_OPTIONS, applyTheme, restoreTheme } from './lib/theme';

const route = useRoute();
const router = useRouter();

const notice = ref<string | null>(null);
const noticePath = ref<string | null>(null);

const sections = computed<NavigationSectionType[]>(() => [
  {
    id: 'main',
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: 'mdi:view-dashboard-outline', url: '/' },
      { id: 'transactions', label: 'Transactions', icon: 'mdi:format-list-bulleted', url: '/transactions' },
      { id: 'reports', label: 'Reports', icon: 'mdi:chart-box-outline', url: '/reports' },
    ],
  },
  {
    id: 'sales',
    title: 'Sales',
    items: [
      { id: 'invoices', label: 'Invoices', icon: 'mdi:file-document-outline', url: '/invoices' },
      { id: 'quotes', label: 'Quotes', icon: 'mdi:file-document-edit-outline', url: '/quotes' },
      { id: 'credits', label: 'Credit notes', icon: 'mdi:file-undo-outline', url: '/credit-notes' },
    ],
  },
  {
    id: 'purchases',
    title: 'Purchases',
    items: [{ id: 'bills', label: 'Bills', icon: 'mdi:receipt-text-outline', url: '/bills' }],
  },
  {
    id: 'books',
    title: 'Books',
    items: [
      { id: 'accounts', label: 'Money accounts', icon: 'mdi:bank-outline', url: '/accounts' },
      { id: 'contacts', label: 'Contacts', icon: 'mdi:account-multiple-outline', url: '/contacts' },
      { id: 'categories', label: 'Categories', icon: 'mdi:shape-outline', url: '/categories' },
      { id: 'recurring', label: 'Recurring', icon: 'mdi:repeat', url: '/recurring' },
    ],
  },
  {
    id: 'company',
    title: 'Company',
    items: [
      { id: 'import', label: 'Import', icon: 'mdi:tray-arrow-down', url: '/import' },
      { id: 'settings', label: 'Settings', icon: 'mdi:cog-outline', url: '/settings' },
    ],
  },
]);

// The icon-only sidebar, remembered between launches.
const navMin = ref(false);
function setNavMin(v: boolean) {
  navMin.value = v;
  void tiny.store.set('navMin', v).catch(() => {});
}

/** Menu items that need an open company. */
const COMPANY_ITEMS = ['company-close', 'company-backup', 'import', 'new-expense', 'new-income', 'new-transfer', 'new-invoice', 'new-quote', 'new-bill', 'settings'];

async function syncMenus() {
  const on = !!session.company;
  await Promise.all(COMPANY_ITEMS.map((id) => tiny.menu.update(id, { enabled: on }).catch(() => {})));
}

/** Creates whatever recurring transactions, invoices and bills fell due while the app was closed. */
async function runSchedules() {
  try {
    const r = await api.runSchedules(today());
    if (!r.created.length && !r.failed.length) return;
    dataChanged();
    const names = [...new Set(r.created.map((c) => c.name))];
    toast({
      title: r.created.length ? `Created ${r.created.length} recurring item${r.created.length === 1 ? '' : 's'}` : "Some recurring items weren't created",
      content: r.failed.length ? `${r.failed[0].name}: ${r.failed[0].message}` : names.slice(0, 3).join(', ') + (names.length > 3 ? '…' : ''),
      tone: r.failed.length ? 'warning' : 'success',
      actions: [{ label: 'Recurring', onAction: () => void router.push('/recurring') }],
    });
  } catch {
    // Not worth interrupting startup for.
  }
}

watch(
  () => session.company?.path,
  (path) => {
    void syncMenus();
    if (path) void runSchedules();
  },
);

// Left open overnight, the books still pick up what fell due.
let lastDay = today();
const dayTimer = setInterval(() => {
  if (today() === lastDay) return;
  lastDay = today();
  if (session.company) void runSchedules();
}, 10 * 60 * 1000);

// Item urls are router paths. Left as plain links they'd reload the page
// (hash history), so the click is cancelled and routed here instead.
function onNavItem(item: { url?: string }) {
  if (item.url && item.url !== route.path) void router.push(item.url);
}

const offs: Array<() => void> = [];

function onMenu(id: string) {
  if (id.startsWith('theme-')) {
    applyTheme(id.slice('theme-'.length) as (typeof THEME_OPTIONS)[number]['value']);
    return;
  }
  switch (id) {
    case 'company-new':
      void closeCompany();
      break;
    case 'company-open':
      void pickAndOpenCompany();
      break;
    case 'company-close':
      void closeCompany();
      break;
    case 'company-backup':
      if (session.company) void backupCompany();
      break;
    case 'new-expense':
    case 'new-income':
    case 'new-transfer':
      if (session.company) newEntry(id.slice('new-'.length) as 'expense' | 'income' | 'transfer');
      break;
    case 'import':
      if (session.company) void router.push('/import');
      break;
    case 'new-invoice':
      if (session.company) void router.push('/invoices/new');
      break;
    case 'new-quote':
      if (session.company) void router.push('/quotes/new');
      break;
    case 'new-bill':
      if (session.company) void router.push('/bills/new');
      break;
    case 'settings':
      if (session.company) void router.push('/settings');
      break;
  }
}

onMounted(async () => {
  await tiny.menu.set([
    { role: 'app', items: [{ id: 'settings', label: 'Settings…', key: ',' }] },
    {
      title: 'File',
      items: [
        { id: 'company-new', label: 'New Company…', key: 'N' },
        { id: 'company-open', label: 'Open Company…', key: 'o' },
        { separator: true },
        { id: 'import', label: 'Import…' },
        { id: 'company-backup', label: 'Back Up Now' },
        { separator: true },
        { id: 'company-close', label: 'Close Company', key: 'W' },
      ],
    },
    { role: 'edit' },
    {
      title: 'Transaction',
      items: [
        { id: 'new-expense', label: 'New Expense…', key: 'e' },
        { id: 'new-income', label: 'New Income…', key: 'i' },
        { id: 'new-transfer', label: 'New Transfer…', key: 't' },
        { separator: true },
        { id: 'new-invoice', label: 'New Invoice…', key: 'I' },
        { id: 'new-quote', label: 'New Quote…' },
        { id: 'new-bill', label: 'New Bill…', key: 'B' },
      ],
    },
    {
      title: 'View',
      items: [
        {
          id: 'appearance',
          label: 'Appearance',
          submenu: THEME_OPTIONS.map((o) => ({ id: `theme-${o.value}`, label: o.label, checked: false })),
        },
      ],
    },
  ]);
  await restoreTheme();
  navMin.value = (await tiny.store.get('navMin').catch(() => false)) === true;
  offs.push(tiny.menu.on(onMenu));
  // Drop a company file to open it, or anything else to import it.
  offs.push(
    tiny.win.onDrop((paths) => {
      const company = paths.find((p) => p.endsWith('.tally'));
      if (company) void openCompanyAt(company);
      else if (paths[0] && session.company) void router.push({ path: '/import', query: { file: paths[0] } });
    }),
  );
  offs.push(
    tiny.app.onOpenFiles((paths) => {
      const file = paths.find((p) => p.endsWith('.tally'));
      if (file) void openCompanyAt(file);
    }),
  );

  const s = await api.start();
  session.company = s.company;
  session.recent = s.recent;
  session.internalDir = s.internalDir;
  if (!s.company && s.lastPath) {
    if (s.locked) {
      // Ask now rather than leaving them on the welcome screen.
      await openCompanyAt(s.lastPath);
    } else if (s.reopenError) {
      notice.value = s.reopenError;
      noticePath.value = s.lastPath;
    }
  }
  session.ready = true;
  await syncMenus();
});

onBeforeUnmount(() => {
  offs.forEach((off) => off());
  clearInterval(dayTimer);
});
</script>

<template>
  <UiProvider>
    <div v-if="!session.ready" class="Boot"><Spinner /></div>
    <Welcome v-else-if="!session.company" :notice="notice" :notice-path="noticePath" />
    <AppFrame v-else layout="sidebarOnly" :sidebar-min="navMin">
      <template #sidebar>
        <Navigation :sections="sections" :location="route.path" highlight logo allow-minimize :accent-stripe="session.company.color || false" prevent-default @click-item="onNavItem" @toggle-min="setNavMin">
          <template #logo>
            <RouterLink to="/" class="Brand">
              <span class="Brand__tile" :class="{ 'Brand__tile--own': session.company.logo }"><img :src="session.company.logo || character" alt="" /></span>
              <span class="Brand__text">
                <span class="Brand__company">{{ session.company.name }}</span>
                <span class="Brand__app">Tiny Tally</span>
              </span>
            </RouterLink>
          </template>
          <template #logoMin>
            <RouterLink to="/" class="Brand">
              <span class="Brand__tile" :class="{ 'Brand__tile--own': session.company.logo }">
                <img :src="session.company.logo || character" :alt="session.company.logo ? session.company.name : 'Tiny Tally'" />
              </span>
            </RouterLink>
          </template>
        </Navigation>
      </template>
      <RouterView :key="`${session.company.path}|${route.path}`" />
      <EntryEditor />
    </AppFrame>
  </UiProvider>
</template>

<style scoped>
.Brand {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  color: inherit;
  text-decoration: none;
}

/* The character's navy outlines need a light tile on dark sidebars. */
.Brand__tile {
  flex: none;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: #fff;
  display: grid;
  place-items: center;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
}

.Brand__tile img {
  width: 32px;
}

/* A company's own logo fills the tile, whatever its shape. */
.Brand__tile--own {
  overflow: hidden;
}

.Brand__tile--own img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.Brand__text {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.2;
}

.Brand__company {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.Brand__app {
  font-size: 11px;
  opacity: 0.7;
}

.Boot {
  height: 100%;
  display: grid;
  place-items: center;
}
</style>
