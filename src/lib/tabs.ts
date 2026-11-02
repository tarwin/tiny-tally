// Tabs: several pages of the same books in one window.
//
// There's one router; a tab is a history of locations (for Back and
// Forward) and switching tabs moves the router to the tab's current one.
// App.vue keeps each visit's page alive (KeepAlive, keyed by visitKey), so a
// tab comes back as it was left: filters, half-filled forms and all. Pages
// left in a hidden tab don't reload until shown (live.ts).
import { computed, onActivated, reactive, ref, shallowReactive, watch } from 'vue';
import type { RouteLocationNormalized } from 'vue-router';
import { api } from './api';
import { router } from '../router';
import { session } from './session';

interface Visit {
  path: string;
  /** Tells visits apart, so going back finds the page as it was, and a fresh visit gets a fresh page. */
  key: number;
}

export interface Tab {
  id: number;
  visits: Visit[];
  index: number;
  title: string;
}

/** Pages kept alive at once, across every tab; the least recently shown go first. */
export const KEEP_ALIVE = 12;

// ---- titles --------------------------------------------------------------------

const TITLES: Record<string, string> = {
  dashboard: 'Dashboard',
  transactions: 'Transactions',
  accounts: 'Accounts',
  register: 'Account',
  contacts: 'Contacts',
  remittance: 'Remittance advice',
  templates: 'Templates',
  reconcile: 'Reconcile',
  statement: 'Statement',
  recurring: 'Recurring',
  budget: 'Budget',
  items: 'Products & services',
  rules: 'Rules',
  'cash-flow': 'Cash flow',
  'sales-by-customer': 'Sales by customer',
  'expenses-by-supplier': 'Expenses by supplier',
  payables: 'Bills to pay',
  'balance-sheet': 'Balance sheet',
  journal: 'Journal',
  journals: 'Journal entries',
  activity: 'Activity',
  import: 'Import',
  reports: 'Reports',
  pnl: 'Profit & Loss',
  'tax-return': 'Tax return',
  'sales-tax': 'Sales tax',
  'schedule-c': 'Schedule C',
  receivables: 'Money owed to you',
  categories: 'Categories',
  settings: 'Settings',
};
const DOCS: Record<string, [string, string]> = {
  invoice: ['Invoices', 'Invoice'],
  quote: ['Quotes', 'Quote'],
  credit: ['Credit notes', 'Credit note'],
  bill: ['Bills', 'Bill'],
};

function titleFor(path: string) {
  const r = router.resolve(path);
  const name = String(r.name ?? '');
  const doc = /^(invoice|quote|credit|bill)-(list|new|view|edit)$/.exec(name);
  if (doc) {
    const [many, one] = DOCS[doc[1]];
    return { list: many, new: `New ${one.toLowerCase()}`, view: one, edit: `Edit ${one.toLowerCase()}` }[doc[2]]!;
  }
  return TITLES[name] ?? 'Tiny Tally';
}

let nextId = 1;
let nextKey = 1;
const visit = (path: string): Visit => ({ path, key: nextKey++ });
const makeTab = (path: string): Tab => ({ id: nextId++, visits: [visit(path)], index: 0, title: titleFor(path) });

export const tabs = reactive({ list: [makeTab('/')] as Tab[], activeId: 1 });

export const activeTab = computed(() => tabs.list.find((t) => t.id === tabs.activeId) ?? tabs.list[0]);
const visitKey = () => `${activeTab.value.id}:${activeTab.value.visits[activeTab.value.index].key}`;
/**
 * The page showing, for App.vue's KeepAlive. Moves once the router has
 * arrived, so a tab switch never shows the old route under the new tab's key.
 */
export const shownKey = ref(visitKey());

/**
 * The route as one kept-alive page sees it (PageHost.vue gives it to the
 * page's useRoute()). It follows the router only while `key` is the page
 * showing, so a page left in a hidden tab keeps its own id and query
 * instead of reloading for whatever another tab navigates to.
 */
export function pageRoute(key: string) {
  const route = shallowReactive({ ...router.currentRoute.value });
  const stop = watch(router.currentRoute, (r) => {
    if (shownKey.value === key) Object.assign(route, r);
  });
  return { route, stop };
}

/** A page names its tab ("INV-1042", an account's name) once it knows, and again whenever it's shown. */
export function useTabTitle(get: () => string | null | undefined) {
  const id = tabs.activeId;
  const apply = () => {
    const title = get();
    const t = tabs.list.find((x) => x.id === id);
    if (t && title) t.title = title;
  };
  watch(get, apply, { immediate: true });
  onActivated(apply);
}

// ---- moving around ---------------------------------------------------------------

/** Set while the router moves for a tab switch or Back/Forward, which mustn't add a visit. */
let moving = false;

function go(path: string) {
  moving = true;
  return router.push(path).catch(() => {}).finally(() => (moving = false));
}

router.afterEach((to, _from, failure) => {
  if (!failure && !moving) addVisit(to);
  shownKey.value = visitKey();
});

function addVisit(to: RouteLocationNormalized) {
  const t = activeTab.value;
  const replaced = (window.history.state as { replaced?: boolean } | null)?.replaced;
  if (t.visits[t.index]?.path === to.fullPath) return;
  if (replaced) {
    // Same visit, so the same page: only a query (filters) changed, or a redirect.
    const v = t.visits[t.index];
    if (router.resolve(v.path).path === to.path) v.path = to.fullPath;
    else t.visits[t.index] = visit(to.fullPath);
  } else {
    t.visits.splice(t.index + 1, Infinity, visit(to.fullPath));
    t.index = t.visits.length - 1;
  }
  t.title = titleFor(to.fullPath);
}

export const canGoBack = computed(() => activeTab.value.index > 0);
export const canGoForward = computed(() => activeTab.value.index < activeTab.value.visits.length - 1);

function step(by: number) {
  const t = activeTab.value;
  const target = t.visits[t.index + by];
  if (!target) return;
  t.index += by;
  t.title = titleFor(target.path);
  void go(target.path);
}

export const goBack = () => step(-1);
export const goForward = () => step(1);

export function activateTab(id: number) {
  const t = tabs.list.find((x) => x.id === id);
  if (!t || id === tabs.activeId) return;
  tabs.activeId = id;
  void go(t.visits[t.index].path);
}

/** Opens `path` in a new tab after the current one; in the background unless `show`. */
export function openTab(path = '/', show = true) {
  const t = makeTab(path);
  tabs.list.splice(tabs.list.indexOf(activeTab.value) + 1, 0, t);
  if (show) activateTab(t.id);
  return t;
}

/** Closes a tab. Returns false for the last one, which the window's own closing handles. */
export function closeTab(id = tabs.activeId) {
  if (tabs.list.length < 2) return false;
  const i = tabs.list.findIndex((t) => t.id === id);
  if (i < 0) return true;
  tabs.list.splice(i, 1);
  if (id === tabs.activeId) activateTab(tabs.list[Math.min(i, tabs.list.length - 1)].id);
  return true;
}

export function closeOtherTabs(id = tabs.activeId) {
  tabs.list = tabs.list.filter((t) => t.id === id);
  activateTab(id);
}

/** Next (1) or previous (-1) tab, wrapping round. */
export function cycleTab(by: 1 | -1) {
  const i = tabs.list.indexOf(activeTab.value);
  activateTab(tabs.list[(i + by + tabs.list.length) % tabs.list.length].id);
}

/** ⌘1–⌘8 go to that tab; ⌘9 to the last, as in browsers. */
export function showTabNumber(n: number) {
  const t = n === 9 ? tabs.list.at(-1) : tabs.list[n - 1];
  if (t) activateTab(t.id);
}

export function moveTab(id: number, to: number) {
  const from = tabs.list.findIndex((t) => t.id === id);
  if (from < 0 || from === to) return;
  const [t] = tabs.list.splice(from, 1);
  tabs.list.splice(Math.max(0, Math.min(to, tabs.list.length)), 0, t);
}

/** The tab's page in a window of its own, on the same books. `atCursor` places it where a dragged tab was let go. */
export async function moveTabToNewWindow(id = tabs.activeId, atCursor = false) {
  const t = tabs.list.find((x) => x.id === id);
  if (!t || tabs.list.length < 2) return;
  await api.newWindow({ share: true, route: t.visits[t.index].path, atCursor });
  closeTab(id);
}

// ---- ⌘-click opens in a new tab -----------------------------------------------------

const isMac = tiny.system.isMacOS();
/** Set by a ⌘-click (Ctrl-click off macOS) or middle click for the navigation it starts: a new tab, shown unless ⇧ is held too. */
let newTabFromClick: { show: boolean } | null = null;

function noteClick(e: MouseEvent) {
  const mod = isMac ? e.metaKey : e.ctrlKey;
  if (!session.books || !(mod || e.button === 1)) return;
  // A link: the router leaves modified clicks to the browser, so open it here.
  const a = (e.target as Element | null)?.closest?.('a[href^="#/"]');
  if (a) {
    e.preventDefault();
    e.stopPropagation();
    openTab(a.getAttribute('href')!.slice(1), !e.shiftKey);
    return;
  }
  // Anything else that navigates (rows, buttons, search results) does so straight away.
  newTabFromClick = { show: !e.shiftKey };
  setTimeout(() => (newTabFromClick = null));
}
window.addEventListener('click', noteClick, true);
window.addEventListener('auxclick', noteClick, true);

router.beforeEach((to: RouteLocationNormalized, from: RouteLocationNormalized) => {
  if (!newTabFromClick || moving || to.fullPath === from.fullPath) return true;
  const { show } = newTabFromClick;
  newTabFromClick = null;
  openTab(to.fullPath, show);
  return false;
});

// ---- per books file ------------------------------------------------------------------

const storeKey = (path: string) => `tabs:${path}`;
interface SavedTabs {
  list: { path: string; title: string }[];
  active: number;
}

/** Where a window opened on shared books starts (App.vue sets it before the books arrive). */
let startRoute: string | null = null;
export function startAt(route: string | null) {
  startRoute = route;
}

function resetTo(saved: SavedTabs) {
  tabs.list = saved.list.map((s) => ({ ...makeTab(s.path), title: s.title || titleFor(s.path) }));
  const t = tabs.list[Math.min(Math.max(saved.active, 0), tabs.list.length - 1)];
  tabs.activeId = t.id;
  moving = true;
  void router.replace(t.visits[0].path).catch(() => {}).finally(() => (moving = false));
}

// Other books, other tabs: the ones last left open on them, or a dashboard.
let restoring = false;
watch(
  () => session.books?.path,
  async (path) => {
    if (!path) {
      resetTo({ list: [{ path: '/', title: '' }], active: 0 });
      return;
    }
    if (startRoute) {
      const route = startRoute;
      startRoute = null;
      resetTo({ list: [{ path: route, title: '' }], active: 0 });
      return;
    }
    restoring = true;
    const saved = (await tiny.store.get(storeKey(path)).catch(() => null)) as SavedTabs | null;
    restoring = false;
    const ok = saved?.list?.filter((s) => typeof s?.path === 'string' && s.path.startsWith('/'));
    resetTo(ok?.length ? { list: ok, active: saved!.active } : { list: [{ path: '/', title: '' }], active: 0 });
  },
);

let saveTimer: ReturnType<typeof setTimeout> | null = null;
watch(
  () => tabs.list.map((t) => `${t.visits[t.index].path}\t${t.title}`).join('\n') + `|${tabs.activeId}`,
  () => {
    const path = session.books?.path;
    if (!path || restoring) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const saved: SavedTabs = {
        list: tabs.list.map((t) => ({ path: t.visits[t.index].path, title: t.title })),
        active: tabs.list.indexOf(activeTab.value),
      };
      void tiny.store.set(storeKey(path), saved);
    }, 500);
  },
);
