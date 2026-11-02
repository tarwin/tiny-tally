<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { AppFrame, Navigation, Spinner, UiProvider, toast, type NavigationSectionType } from '@octans/ui';
import AppSettings from './components/AppSettings.vue';
import EntryEditor from './components/EntryEditor.vue';
import PageHost from './components/PageHost.vue';
import TabStrip from './components/TabStrip.vue';
import TopBar from './components/TopBar.vue';
import UpdateBanner from './components/UpdateBanner.vue';
import Welcome from './views/Welcome.vue';
import character from './assets/tiny-tally-character.svg';
import { api } from './lib/api';
import { dropAttachments } from './lib/attachments';
import { DENSITY_OPTIONS, appSettings, appSettingsPanel, restoreAppSettings, updateAppSettings, type Density } from './lib/appSettings';
import { backupBooks, closeBooks, newBooks, openBooksAt, pickAndOpenBooks, refreshSession } from './lib/books';
import { today } from './lib/dates';
import { newEntry } from './lib/entryEditor';
import { booksChanged, booksVersion } from './lib/live';
import { canGoBack, canGoForward, goBack, goForward } from './lib/navHistory';
import { session } from './lib/session';
import { KEEP_ALIVE, closeTab, cycleTab, moveTabToNewWindow, openTab, shownKey, showTabNumber, startAt, tabs } from './lib/tabs';
import { THEME_OPTIONS, applyTheme, restoreTheme, syncThemeMenu } from './lib/theme';
import { checkForUpdates, updateFound } from './lib/updates';

const route = useRoute();
const router = useRouter();

const notice = ref<string | null>(null);
const noticePath = ref<string | null>(null);

/** Overdue counts for the sidebar badges. */
const overdue = ref({ invoices: 0, bills: 0 });
async function loadOverdue() {
  if (!session.books) return;
  try {
    const [inv, bill] = await Promise.all([
      api.listInvoices({ status: 'overdue' }),
      api.listInvoices({ docType: 'bill', status: 'overdue' }),
    ]);
    overdue.value = { invoices: inv.rows.length, bills: bill.rows.length };
  } catch {
    // A badge isn't worth an error.
  }
}
watch([booksVersion, () => session.books?.path], loadOverdue, { immediate: true });
const badge = (n: number) => (n ? String(n) : undefined);

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
      { id: 'invoices', label: 'Invoices', icon: 'mdi:file-document-outline', url: '/invoices', badge: badge(overdue.value.invoices) },
      { id: 'quotes', label: 'Quotes', icon: 'mdi:file-document-edit-outline', url: '/quotes' },
      { id: 'credits', label: 'Credit notes', icon: 'mdi:file-undo-outline', url: '/credit-notes' },
    ],
  },
  {
    id: 'purchases',
    title: 'Purchases',
    items: [{ id: 'bills', label: 'Bills', icon: 'mdi:receipt-text-outline', url: '/bills', badge: badge(overdue.value.bills) }],
  },
  {
    id: 'books',
    title: 'Books',
    items: [
      { id: 'accounts', label: 'Money accounts', icon: 'mdi:bank-outline', url: '/accounts' },
      { id: 'contacts', label: 'Contacts', icon: 'mdi:account-multiple-outline', url: '/contacts' },
      { id: 'items', label: 'Products & services', icon: 'mdi:package-variant-closed', url: '/items' },
      { id: 'categories', label: 'Categories', icon: 'mdi:shape-outline', url: '/categories' },
      { id: 'budget', label: 'Budget', icon: 'mdi:target', url: '/budget' },
      { id: 'recurring', label: 'Recurring', icon: 'mdi:repeat', url: '/recurring' },
      { id: 'journals', label: 'Journal entries', icon: 'mdi:book-edit-outline', url: '/journals' },
    ],
  },
  {
    id: 'books',
    title: 'Books',
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

// Each window has its own books, so its own menu bar: macOS shows the
// focused window's, Windows and Linux draw each in its window.
const isMain = tiny.win.id === 'main';

/** Menu items that need open books. */
const BOOKS_ITEMS = [
  'books-close', 'books-backup', 'books-reveal', 'books-settings', 'import', 'search', 'tab-new', 'tab-next', 'tab-previous',
  'new-expense', 'new-income', 'new-transfer', 'new-invoice', 'new-quote', 'new-bill',
];

async function syncMenus() {
  const on = !!session.books;
  await Promise.all(BOOKS_ITEMS.map((id) => tiny.win.menu.update(id, { enabled: on }).catch(() => {})));
  syncNavMenu();
}

function syncNavMenu() {
  void tiny.win.menu.update('nav-back', { enabled: !!session.books && canGoBack.value }).catch(() => {});
  void tiny.win.menu.update('nav-forward', { enabled: !!session.books && canGoForward.value }).catch(() => {});
  void tiny.win.menu.update('tab-window', { enabled: !!session.books && tabs.list.length > 1 }).catch(() => {});
}

watch([canGoBack, canGoForward, () => tabs.list.length], syncNavMenu);

// ---- tabs ------------------------------------------------------------------------

/** Kept-alive pages lose their scroll position when put back: remember it per visit. */
const host = ref<HTMLElement | null>(null);
const scrolls = new Map<string, [Element, number][]>();
watch(shownKey, async (key, old) => {
  if (host.value) {
    scrolls.set(old, [...host.value.querySelectorAll('*')].filter((el) => el.scrollTop > 0).map((el) => [el, el.scrollTop]));
    if (scrolls.size > 60) scrolls.delete(scrolls.keys().next().value!);
  }
  await nextTick();
  for (const [el, top] of scrolls.get(key) ?? []) if (el.isConnected) el.scrollTop = top;
});

function closeWindow() {
  // The main window hides rather than closes: closing it would quit (main.ts).
  if (isMain) void tiny.win.hide({ app: false });
  else void tiny.win.close();
}

/** ⌘1–⌘9 and Ctrl+Tab, which have no menu items. */
function onKey(e: KeyboardEvent) {
  if (!session.books || tabs.list.length < 2) return;
  const mod = isMac ? e.metaKey : e.ctrlKey;
  if (mod && !e.shiftKey && !e.altKey && /^[1-9]$/.test(e.key)) {
    e.preventDefault();
    showTabNumber(Number(e.key));
  } else if (e.ctrlKey && e.key === 'Tab') {
    e.preventDefault();
    cycleTab(e.shiftKey ? -1 : 1);
  }
}

const topBar = ref<InstanceType<typeof TopBar> | null>(null);

function syncDensityMenu() {
  for (const o of DENSITY_OPTIONS) void tiny.win.menu.update(`density-${o.value}`, { checked: appSettings.density === o.value }).catch(() => {});
}

const isMac = tiny.system.isMacOS();
const REVEAL_LABEL = isMac ? 'Show in Finder' : tiny.system.isWindows() ? 'Show in File Explorer' : 'Show in Folder';

/** Recent books, with the folder added where two share a name. */
function recentItems() {
  const names = session.recent.map((r) => r.name);
  return session.recent.map((r, i) => {
    const folder = r.path.split(/[\\/]/).slice(-2, -1)[0];
    const label = names.filter((n) => n === r.name).length > 1 && folder ? `${r.name} — ${folder}` : r.name;
    return { id: `recent-${i}`, label, checked: r.path === session.books?.path };
  });
}

// The menu is rebuilt whenever the recent list changes (Open Recent), so
// ticks and enabled states are re-applied after each set().
async function buildMenu() {
  const recent = recentItems();
  await tiny.win.menu.set([
    {
      role: 'app',
      items: [
        { id: 'app-settings', label: 'Settings…', key: ',' },
        { id: 'check-updates', label: 'Check for Updates…' },
      ],
    },
    {
      title: 'File',
      items: [
        { id: 'tab-new', label: 'New Tab', key: 't' },
        { id: 'window-new', label: 'New Window', key: 'n' },
        { id: 'books-new', label: 'New Books…', key: 'N' },
        { id: 'books-open', label: 'Open Books…', key: 'o' },
        {
          id: 'books-recent',
          label: 'Open Recent',
          submenu: recent.length
            ? [...recent, { separator: true }, { id: 'recent-clear', label: 'Clear Menu' }]
            : [{ id: 'recent-none', label: 'No recent books', enabled: false }],
        },
        { separator: true },
        { id: 'import', label: 'Import…' },
        { id: 'books-backup', label: 'Back Up Now' },
        { id: 'books-reveal', label: REVEAL_LABEL },
        { separator: true },
        { id: 'books-settings', label: 'Books Settings…', key: 'alt+,' },
        // Windows and Linux have no app menu, so app settings live here too.
        ...(isMac ? [] : [{ id: 'app-settings', label: 'App Settings…', key: ',' }]),
        { separator: true },
        { id: 'tab-close', label: 'Close Tab', key: 'w' },
        { id: 'window-close', label: 'Close Window', key: 'W' },
        { id: 'books-close', label: 'Close Books' },
      ],
    },
    { role: 'edit' },
    {
      title: 'Transaction',
      items: [
        { id: 'new-expense', label: 'New Expense…', key: 'e' },
        { id: 'new-income', label: 'New Income…', key: 'i' },
        { id: 'new-transfer', label: 'New Transfer…', key: 'alt+t' },
        { separator: true },
        { id: 'new-invoice', label: 'New Invoice…', key: 'I' },
        { id: 'new-quote', label: 'New Quote…' },
        { id: 'new-bill', label: 'New Bill…', key: 'B' },
      ],
    },
    {
      title: 'Go',
      items: [
        { id: 'nav-back', label: 'Back', key: '[' },
        { id: 'nav-forward', label: 'Forward', key: ']' },
        { separator: true },
        { id: 'search', label: 'Search…', key: 'k' },
        { separator: true },
        { id: 'tab-next', label: 'Show Next Tab', key: 'shift+]' },
        { id: 'tab-previous', label: 'Show Previous Tab', key: 'shift+[' },
        { id: 'tab-window', label: 'Move Tab to New Window' },
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
    // macOS has Check for Updates… in the app menu.
    ...(isMac ? [] : [{ title: 'Help', items: [{ id: 'check-updates', label: 'Check for Updates…' }] }]),
  ]);
  syncThemeMenu();
  syncDensityMenu();
  await syncMenus();
}

watch(
  () => [session.recent.map((r) => r.path).join('\n'), session.books?.path, session.recent.map((r) => r.name).join('\n')],
  () => void buildMenu(),
);

async function clearRecent() {
  for (const r of [...session.recent]) await api.forgetBooks(r.path).catch(() => {});
  await refreshSession();
}

/** Creates whatever recurring transactions, invoices and bills fell due while the app was closed. */
async function runSchedules() {
  try {
    const r = await api.runSchedules(today());
    if (!r.created.length && !r.failed.length) return;
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
  () => session.books?.path,
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
  if (session.books) void runSchedules();
}, 10 * 60 * 1000);

// Item urls are router paths. Left as plain links they'd reload the page
// (hash history), so the click is cancelled and routed here instead.
function onNavItem(item: { url?: string }) {
  if (item.url && item.url !== route.path) void router.push(item.url);
}

const offs: Array<() => void> = [];

/** Books files double-clicked in Finder (or dropped): open them. */
function openFiles(paths: string[]) {
  const file = paths.find((p) => p.endsWith('.tally'));
  if (file) void openBooksAt(file);
}

// Drop a books file to open it, a receipt onto what's open, or anything else to import it.
function onDropped(paths: string[]) {
  if (paths.some((p) => p.endsWith('.tally'))) openFiles(paths);
  // Receipts go to the open transaction or document, if one is showing.
  else if (session.books && dropAttachments(paths)) return;
  else if (paths[0] && session.books) void router.push({ path: '/import', query: { file: paths[0] } });
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
    if (r && r.path !== session.books?.path) void openBooksAt(r.path);
    return;
  }
  switch (id) {
    case 'recent-clear':
      void clearRecent();
      break;
    case 'nav-back':
      if (session.books) goBack();
      break;
    case 'nav-forward':
      if (session.books) goForward();
      break;
    case 'search':
      topBar.value?.focusSearch();
      break;
    case 'app-settings':
      appSettingsPanel.visible = true;
      break;
    case 'check-updates':
      void checkForUpdates();
      break;
    case 'books-reveal':
      if (session.books) void tiny.app.shell.reveal(session.books.path);
      break;
    case 'books-new':
      void newBooks();
      break;
    case 'tab-new':
      if (session.books) openTab();
      break;
    case 'tab-close':
      // The last tab closes the window.
      if (!session.books || !closeTab()) closeWindow();
      break;
    case 'tab-next':
    case 'tab-previous':
      if (session.books) cycleTab(id === 'tab-next' ? 1 : -1);
      break;
    case 'tab-window':
      if (session.books) void moveTabToNewWindow();
      break;
    case 'window-new':
      // These books, on the page showing; the welcome screen with none open.
      void api.newWindow(session.books ? { share: true, route: route.fullPath } : {});
      break;
    case 'window-close':
      closeWindow();
      break;
    case 'books-open':
      void pickAndOpenBooks();
      break;
    case 'books-close':
      void closeBooks();
      break;
    case 'books-backup':
      if (session.books) void backupBooks();
      break;
    case 'new-expense':
    case 'new-income':
    case 'new-transfer':
      if (session.books) newEntry(id.slice('new-'.length) as 'expense' | 'income' | 'transfer');
      break;
    case 'import':
      if (session.books) void router.push('/import');
      break;
    case 'new-invoice':
      if (session.books) void router.push('/invoices/new');
      break;
    case 'new-quote':
      if (session.books) void router.push('/quotes/new');
      break;
    case 'new-bill':
      if (session.books) void router.push('/bills/new');
      break;
    case 'books-settings':
      if (session.books) void router.push('/settings');
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
  offs.push(tiny.api.on('window-menu', ({ id }: { id: string }) => onMenu(id)));
  offs.push(tiny.api.on('window-open-files', ({ paths }: { paths: string[] }) => openFiles(paths)));
  offs.push(tiny.api.on('window-drop', ({ paths }: { paths: string[] }) => onDropped(paths)));
  offs.push(tiny.api.on('update-available', (info: TinyUpdateInfo) => updateFound(info)));
  let dragOverAt = 0;
  const onDragOver = () => (dragOverAt = Date.now());
  window.addEventListener('dragover', onDragOver);
  offs.push(() => window.removeEventListener('dragover', onDragOver));
  offs.push(tiny.win.onDrop((paths) => void api.claimDrop(paths, Date.now() - dragOverAt < 3000, document.hasFocus())));
  // Main was closed (hidden): the backend let go of its books; start fresh for when it's shown again.
  offs.push(
    tiny.api.on('window-hidden', () => {
      session.books = null;
      notice.value = null;
      void router.replace('/');
    }),
  );
  if (isMain) {
    const onVisibility = () => document.hidden && void api.windowHidden().catch(() => {});
    document.addEventListener('visibilitychange', onVisibility);
    offs.push(() => document.removeEventListener('visibilitychange', onVisibility));
  }
  // The books changed, here or in another window showing them: reload what's showing.
  offs.push(
    tiny.api.on('books-changed', ({ books }: { books: typeof session.books }) => {
      if (books && books.path === session.books?.path) session.books = books;
      booksChanged();
    }),
  );
  // Main, hidden and empty, reused for a new window on another window's books.
  offs.push(
    tiny.api.on('books-shared', async ({ route: at }: { route: string | null }) => {
      startAt(at ?? '/');
      notice.value = null;
      await refreshSession();
    }),
  );
  window.addEventListener('keydown', onKey);
  offs.push(() => window.removeEventListener('keydown', onKey));
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
  // A window opened on another's books starts on the page it was showing.
  if (s.route) startAt(s.route);
  session.books = s.books;
  session.recent = s.recent;
  session.internalDir = s.internalDir;
  if (!s.books && s.lastPath) {
    if (s.locked) {
      // Ask now rather than leaving them on the welcome screen.
      await openBooksAt(s.lastPath);
    } else if (s.reopenError) {
      notice.value = s.reopenError;
      noticePath.value = s.lastPath;
    }
  }
  session.ready = true;
  await syncMenus();
  if (s.openFiles.length) openFiles(s.openFiles);
  if (s.tour) void import('./lib/tour').then((m) => m.runTour());
});

onBeforeUnmount(() => {
  offs.forEach((off) => off());
  clearInterval(dayTimer);
});
</script>

<template>
  <UiProvider>
    <!-- macOS windows have no title bar: something to drag them by until the top bar shows. -->
    <div v-if="isMac && !session.books" class="DragStrip" data-tiny-drag />
    <div v-if="!session.ready" class="Boot"><Spinner /></div>
    <Welcome v-else-if="!session.books" :notice="notice" :notice-path="noticePath" />
    <AppFrame v-else layout="topbar" :sidebar-min="navMin">
      <template #topbar>
        <TopBar ref="topBar" />
      </template>
      <template #sidebar>
        <!-- The books' colour fills the top bar, so no stripe here. -->
        <Navigation :sections="sections" :location="route.path" highlight logo allow-minimize prevent-default @click-item="onNavItem" @toggle-min="setNavMin">
          <template #logo>
            <RouterLink to="/" class="Brand">
              <span class="Brand__tile" :class="{ 'Brand__tile--own': session.books.logo }"><img :src="session.books.logo || character" alt="" /></span>
              <span class="Brand__text">
                <span class="Brand__books">{{ session.books.name }}</span>
                <span class="Brand__app">Tiny Tally</span>
              </span>
            </RouterLink>
          </template>
          <template #logoMin>
            <RouterLink to="/" class="Brand">
              <span class="Brand__tile" :class="{ 'Brand__tile--own': session.books.logo }">
                <img :src="session.books.logo || character" :alt="session.books.logo ? session.books.name : 'Tiny Tally'" />
              </span>
            </RouterLink>
          </template>
        </Navigation>
      </template>
      <TabStrip v-if="tabs.list.length > 1" />
      <div ref="host" class="TabHost">
        <RouterView v-slot="{ Component }">
          <KeepAlive :max="KEEP_ALIVE">
            <PageHost v-if="Component" :key="`${session.books.path}|${shownKey}|${route.path}`" :page="Component" :page-key="shownKey" />
          </KeepAlive>
        </RouterView>
      </div>
      <EntryEditor />
    </AppFrame>
    <AppSettings :nav-min="navMin" @update:nav-min="setNavMin" />
    <UpdateBanner />
  </UiProvider>
</template>

<style scoped>
.TabHost {
  display: contents;
}

.DragStrip {
  position: fixed;
  top: 0;
  left: 0;
  /* Clear of the Welcome screen's settings buttons, top right. */
  right: 120px;
  height: 36px;
  z-index: 10;
}

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

/* The books' own logo fills the tile, whatever its shape. */
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

.Brand__books {
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
