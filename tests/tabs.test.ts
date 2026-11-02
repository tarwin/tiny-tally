import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calls, dispatch, element, store } from './support/browser.ts';
import { nextTick } from 'vue';
import { router } from '../src/router.ts';
import { session } from '../src/lib/session.ts';
import {
  activateTab, activeTab, canGoBack, canGoForward, closeOtherTabs, closeTab, cycleTab, goBack, goForward,
  moveTab, moveTabToNewWindow, openTab, pageRoute, shownKey, showTabNumber, startAt, tabs,
} from '../src/lib/tabs.ts';

const settle = () => new Promise((r) => setTimeout(r, 0)).then(nextTick);
const here = () => router.currentRoute.value.fullPath;
const titles = () => tabs.list.map((t) => t.title);

async function openBooks(path: string) {
  session.books = { path } as any;
  for (let i = 0; i < 5; i++) await settle();
}

test('tabs: history per tab, switching, closing, ordering, ⌘-click and saved tabs', async (t) => {
  await router.push('/');
  await openBooks('/books/a.tally');
  assert.equal(tabs.list.length, 1);
  assert.equal(here(), '/');

  await t.test('each navigation is a visit; Back and Forward step through them', async () => {
    await router.push('/transactions');
    await router.push('/reports/profit-and-loss');
    assert.equal(activeTab.value.title, 'Profit & Loss');
    assert.ok(canGoBack.value);
    goBack();
    await settle();
    assert.equal(here(), '/transactions');
    assert.ok(canGoForward.value);
    goForward();
    await settle();
    assert.equal(here(), '/reports/profit-and-loss');
    // A filter change (replace, same page) stays the same visit and the same page instance.
    const key = shownKey.value;
    await router.replace('/reports/profit-and-loss?compare=budget');
    assert.equal(shownKey.value, key);
    assert.equal(activeTab.value.visits.length, 3);
    // A new page is a new visit, with a page of its own.
    await router.push('/invoices/12');
    assert.notEqual(shownKey.value, key);
    assert.equal(activeTab.value.title, 'Invoice');
  });

  await t.test('tabs keep their own place and history', async () => {
    const first = activeTab.value.id;
    const second = openTab('/contacts');
    await settle();
    assert.equal(here(), '/contacts');
    assert.ok(!canGoBack.value, 'a new tab starts with no history');
    await router.push('/bills');
    activateTab(first);
    await settle();
    assert.equal(here(), '/invoices/12');
    activateTab(second.id);
    await settle();
    assert.equal(here(), '/bills');
    goBack();
    await settle();
    assert.equal(here(), '/contacts');
    // Opening in the background leaves you where you are.
    openTab('/accounts', false);
    await settle();
    assert.equal(here(), '/contacts');
    assert.deepEqual(titles(), ['Invoice', 'Contacts', 'Accounts']);
  });

  await t.test('switching to a tab on the same page as this one still swaps the page shown', async () => {
    const a = activeTab.value;
    const b = openTab(a.visits[a.index].path);
    await settle();
    const key = shownKey.value;
    activateTab(a.id);
    await settle();
    assert.notEqual(shownKey.value, key);
    closeTab(b.id);
    await settle();
  });

  await t.test('⌘1–9, cycling and reordering', async () => {
    showTabNumber(1);
    await settle();
    assert.equal(here(), '/invoices/12');
    showTabNumber(9);
    await settle();
    assert.equal(here(), '/accounts');
    cycleTab(1);
    await settle();
    assert.equal(here(), '/invoices/12', 'wraps round');
    cycleTab(-1);
    await settle();
    assert.equal(here(), '/accounts');
    moveTab(activeTab.value.id, 0);
    assert.deepEqual(titles(), ['Accounts', 'Invoice', 'Contacts']);
    showTabNumber(5);
    assert.equal(here(), '/accounts', 'no such tab: nothing happens');
  });

  await t.test('closing tabs', async () => {
    // Closing the showing tab shows the one that took its place.
    showTabNumber(2);
    await settle();
    closeTab();
    await settle();
    assert.deepEqual(titles(), ['Accounts', 'Contacts']);
    assert.equal(here(), '/contacts');
    closeOtherTabs();
    await settle();
    assert.deepEqual(titles(), ['Contacts']);
    assert.equal(closeTab(), false, 'the last tab is left for the window to close');
  });

  await t.test('⌘-click opens a link or a navigation in a new tab', async () => {
    dispatch('click', { metaKey: true, target: element('#/reports') });
    await settle();
    assert.deepEqual(titles(), ['Contacts', 'Reports']);
    assert.equal(here(), '/reports', 'and shows it');
    showTabNumber(1);
    await settle();
    // Rows and buttons navigate in code: the click marks the navigation it starts.
    dispatch('click', { metaKey: true, shiftKey: true, target: element(null) });
    await router.push('/budget');
    await settle();
    assert.deepEqual(titles(), ['Contacts', 'Budget', 'Reports']);
    assert.equal(here(), '/contacts', 'with ⇧, in the background');
    showTabNumber(2);
    await settle();
    assert.equal(here(), '/budget');
    // The mark doesn't outlive the click.
    dispatch('click', { metaKey: true, target: element(null) });
    await settle();
    await router.push('/items');
    assert.equal(tabs.list.length, 3);
    assert.equal(here(), '/items');
    // Middle click too; a plain click does nothing special.
    dispatch('auxclick', { button: 1, target: element('#/rules') });
    dispatch('click', { target: element('#/categories') });
    assert.equal(tabs.list.length, 4);
  });

  await t.test("a page in a hidden tab keeps its own route", async () => {
    await router.push('/accounts/1');
    const mine = pageRoute(shownKey.value);
    // Filters on the page itself are followed.
    await router.replace('/accounts/1?period=all');
    await settle();
    assert.equal(mine.route.fullPath, '/accounts/1?period=all');
    // Another page in this tab, or another tab on another account: not.
    await router.push('/accounts');
    await settle();
    openTab('/accounts/2');
    await settle();
    assert.equal(here(), '/accounts/2');
    assert.equal(mine.route.params.id, '1');
    assert.equal(mine.route.fullPath, '/accounts/1?period=all');
    mine.stop();
    closeTab();
    await settle();
  });

  await t.test('Move Tab to New Window', async () => {
    calls.length = 0;
    const id = activeTab.value.id;
    const route = here();
    await moveTabToNewWindow(id, true);
    assert.deepEqual(calls, [{ method: 'app.newWindow', params: { share: true, route, atCursor: true } }]);
    assert.ok(!tabs.list.some((x) => x.id === id));
  });

  await t.test('tabs are saved per books file and come back', async () => {
    await new Promise((r) => setTimeout(r, 600));
    const saved = store.get('tabs:/books/a.tally') as any;
    assert.deepEqual(saved.list.map((s: any) => s.path), tabs.list.map((x) => x.visits[x.index].path));

    store.set('tabs:/books/b.tally', { list: [{ path: '/accounts', title: 'Accounts' }, { path: '/invoices/7', title: 'INV-0007' }], active: 1 });
    await openBooks('/books/b.tally');
    assert.deepEqual(titles(), ['Accounts', 'INV-0007']);
    assert.equal(here(), '/invoices/7');

    // A window opened from another starts on that page instead.
    startAt('/reports/cash-flow');
    await openBooks('/books/a.tally');
    assert.deepEqual(titles(), ['Cash flow']);
    assert.equal(here(), '/reports/cash-flow');

    // Books with nothing saved, or junk saved: a dashboard.
    store.set('tabs:/books/c.tally', { list: [{ path: 'http://evil' }], active: 0 });
    await openBooks('/books/c.tally');
    assert.deepEqual(titles(), ['Dashboard']);
    assert.equal(here(), '/');
  });
});
