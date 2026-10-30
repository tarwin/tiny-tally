<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { AppFrame, Navigation, Spinner, UiProvider, toast, type NavigationSectionType } from '@octans/ui';
import AppSettings from './components/AppSettings.vue';
import EntryEditor from './components/EntryEditor.vue';
import Welcome from './views/Welcome.vue';
import character from './assets/tiny-tally-character.svg';
import { api } from './lib/api';
import { DENSITY_OPTIONS, appSettings, appSettingsPanel, restoreAppSettings, updateAppSettings, type Density } from './lib/appSettings';
import { backupCompany, closeCompany, newCompany, openCompanyAt, pickAndOpenCompany, refreshSession } from './lib/company';
import { today } from './lib/dates';
import { dataChanged, newEntry } from './lib/entryEditor';
import { session } from './lib/session';
import { THEME_OPTIONS, applyTheme, restoreTheme, syncThemeMenu } from './lib/theme';

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
      { id: 'journals', label: 'Journal entries', icon: 'mdi:book-edit-outline', url: '/journals' },
    ],
  },
  {
    id: 'company',
    title: 'Company',
    items: [
      { id: 'import', label: 'Import', icon: 'mdi:tray-arrow-down', url: '/import' },
      { id: 'activity', label: 'Activity', icon: 'mdi:history', url: '/activity' },
      { id: 'settings', label: 'Settings', icon: 'mdi:cog-outline', url: '/settings' },
    ],
  },
]);

// The icon-only sidebar, remembered between launches.
const navMin = ref(false);
function setNavMin(v: boolean) {
  navMin.value = v;
  void tiny.store.set('navMin', v).then(() => api.settingsChanged()).catch(() => {});
}

// Each window has its own company, so its own menu bar: macOS shows the
// focused window's, Windows and Linux draw each in its window.
const isMain = tiny.win.id === 'main';

/** Menu items that need an open company. */
const COMPANY_ITEMS = [
  'company-close', 'company-backup', 'company-reveal', 'company-settings', 'import',
  'new-expense', 'new-income', 'new-transfer', 'new-invoice', 'new-quote', 'new-bill',
];

async function syncMenus() {
  const on = !!session.company;
  await Promise.all(COMPANY_ITEMS.map((id) => tiny.win.menu.update(id, { enabled: on }).catch(() => {})));
}

function syncDensityMenu() {
  for (const o of DENSITY_OPTIONS) void tiny.win.menu.update(`density-${o.value}`, { checked: appSettings.density === o.value }).catch(() => {});
}

const isMac = tiny.system.isMacOS();
const REVEAL_LABEL = isMac ? 'Show in Finder' : tiny.system.isWindows() ? 'Show in File Explorer' : 'Show in Folder';

/** Recent companies, with the folder added where two share a name. */
function recentItems() {
  const names = session.recent.map((r) => r.name);
  return session.recent.map((r, i) => {
    const folder = r.path.split(/[\\/]/).slice(-2, -1)[0];
    const label = names.filter((n) => n === r.name).length > 1 && folder ? `${r.name} — ${folder}` : r.name;
    return { id: `recent-${i}`, label, checked: r.path === session.company?.path };
  });
}

// The menu is rebuilt whenever the recent list changes (Open Recent), so
// ticks and enabled states are re-applied after each set().
async function buildMenu() {
  const recent = recentItems();
  await tiny.win.menu.set([
    { role: 'app', items: [{ id: 'app-settings', label: 'Settings…', key: ',' }] },
    {
      title: 'File',
      items: [
        { id: 'company-new', label: 'New Company…', key: 'N' },
        { id: 'window-new', label: 'New Window', key: 'alt+n' },
        { id: 'company-open', label: 'Open Company…', key: 'o' },
        {
          id: 'company-recent',
          label: 'Open Recent',
          submenu: recent.length
            ? [...recent, { separator: true }, { id: 'recent-clear', label: 'Clear Menu' }]
            : [{ id: 'recent-none', label: 'No recent companies', enabled: false }],
        },
        { separator: true },
        { id: 'import', label: 'Import…' },
        { id: 'company-backup', label: 'Back Up Now' },
        { id: 'company-reveal', label: REVEAL_LABEL },
        { separator: true },
        { id: 'company-settings', label: 'Company Settings…', key: 'alt+,' },
        // Windows and Linux have no app menu, so app settings live here too.
        ...(isMac ? [] : [{ id: 'app-settings', label: 'App Settings…', key: ',' }]),
        { separator: true },
        { id: 'company-close', label: 'Close Company', key: 'W' },
        { id: 'window-close', label: 'Close Window', key: 'w' },
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
        {
          id: 'density',
          label: 'Density',
          submenu: DENSITY_OPTIONS.map((o) => ({ id: `density-${o.value}`, label: o.label, checked: false })),
        },
      ],
    },
  ]);
  syncThemeMenu();
  syncDensityMenu();
  await syncMenus();
}

watch(
  () => [session.recent.map((r) => r.path).join('\n'), session.company?.path, session.recent.map((r) => r.name).join('\n')],
  () => void buildMenu(),
);

async function clearRecent() {
  for (const r of [...session.recent]) await api.forgetCompany(r.path).catch(() => {});
  await refreshSession();
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

/** Company files double-clicked in Finder (or dropped): open them. */
function openFiles(paths: string[]) {
  const file = paths.find((p) => p.endsWith('.tally'));
  if (file) void openCompanyAt(file);
}

// Drop a company file to open it, or anything else to import it.
function onDropped(paths: string[]) {
  if (paths.some((p) => p.endsWith('.tally'))) openFiles(paths);
  else if (paths[0] && session.company) void router.push({ path: '/import', query: { file: paths[0] } });
}

function onMenu(id: string) {
  if (id.startsWith('theme-')) {
    applyTheme(id.slice('theme-'.length) as (typeof THEME_OPTIONS)[number]['value']);
    return;
  }
  if (id.startsWith('density-')) {
    updateAppSettings({ density: id.slice('density-'.length) as Density });
    syncDensityMenu();
    return;
  }
  if (id.startsWith('recent-') && id !== 'recent-clear') {
    const r = session.recent[Number(id.slice('recent-'.length))];
    if (r && r.path !== session.company?.path) void openCompanyAt(r.path);
    return;
  }
  switch (id) {
    case 'recent-clear':
      void clearRecent();
      break;
    case 'app-settings':
      appSettingsPanel.visible = true;
      break;
    case 'company-reveal':
      if (session.company) void tiny.app.shell.reveal(session.company.path);
      break;
    case 'company-new':
      void newCompany();
      break;
    case 'window-new':
      void api.newWindow();
      break;
    case 'window-close':
      // The main window hides rather than closes: closing it would quit (main.ts).
      if (isMain) void tiny.win.hide({ app: false });
      else void tiny.win.close();
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
    case 'company-settings':
      if (session.company) void router.push('/settings');
      break;
  }
}

onMounted(async () => {
  await restoreAppSettings();
  await buildMenu();
  await restoreTheme();
  navMin.value = (await tiny.store.get('navMin').catch(() => false)) === true;
  // The backend sends menu clicks, opened files and drops to one window
  // (main.ts), since tinyjs delivers them to every window.
  offs.push(tiny.api.on('menu', ({ id }: { id: string }) => onMenu(id)));
  offs.push(tiny.api.on('open-files', ({ paths }: { paths: string[] }) => openFiles(paths)));
  offs.push(tiny.api.on('drop', ({ paths }: { paths: string[] }) => onDropped(paths)));
  let dragOverAt = 0;
  const onDragOver = () => (dragOverAt = Date.now());
  window.addEventListener('dragover', onDragOver);
  offs.push(() => window.removeEventListener('dragover', onDragOver));
  offs.push(tiny.win.onDrop((paths) => void api.claimDrop(paths, Date.now() - dragOverAt < 3000, document.hasFocus())));
  // Main was closed (hidden): the backend let go of its company; start fresh for when it's shown again.
  offs.push(
    tiny.api.on('window-hidden', () => {
      session.company = null;
      notice.value = null;
      void router.replace('/');
    }),
  );
  if (isMain) {
    const onVisibility = () => document.hidden && void api.windowHidden().catch(() => {});
    document.addEventListener('visibilitychange', onVisibility);
    offs.push(() => document.removeEventListener('visibilitychange', onVisibility));
  }
  offs.push(
    tiny.api.on('recent-changed', ({ recent }: { recent: typeof session.recent }) => {
      session.recent = recent;
    }),
  );
  // Theme, density, size or the sidebar changed in another window.
  offs.push(
    tiny.api.on('app-settings-changed', async ({ from }: { from: string }) => {
      if (from === tiny.win.id) return;
      await restoreTheme();
      await restoreAppSettings();
      syncDensityMenu();
      navMin.value = (await tiny.store.get('navMin').catch(() => false)) === true;
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
  if (s.openFiles.length) openFiles(s.openFiles);
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
    <AppSettings :nav-min="navMin" @update:nav-min="setNavMin" />
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
