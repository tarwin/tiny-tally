// The screenshot tour (scripts/screenshots.sh): on fresh demo books, step
// through the app and have each screen captured. Only runs when the backend
// was started with TINY_TALLY_TOUR (main.ts says so in app.start).
import { nextTick } from 'vue';
import { setTheme } from '@octans/ui';
import { api, type Entry } from './api';
import { editEntry, entryEditor } from './entryEditor';
import { router } from '../router';
import { closeOtherTabs, openTab } from './tabs';
import { themePreference } from './theme';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function go(path: string) {
  await router.push(path);
  // Lists and reports load, charts draw.
  await wait(1400);
}

const shot = async (name: string) => {
  await nextTick();
  await wait(250);
  await tiny.api.call('tour.shot', { name });
};

/** Clicks the first button (or link) whose text is `text`; a missing one is skipped. */
async function click(text: string) {
  const el = [...document.querySelectorAll<HTMLElement>('button, a, [role="menuitem"]')].find((b) => b.textContent?.trim() === text);
  if (!el) {
    console.warn(`Tour: no "${text}" to click.`);
    return;
  }
  el.click();
  await wait(900);
}

async function typeSearch(text: string) {
  const input = document.querySelector<HTMLInputElement>('.TopBar input');
  if (!input) return;
  input.focus();
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await wait(900);
}

export async function runTour() {
  try {
    await wait(1500);
    const accounts = await api.listAccounts();
    const bank = accounts.find((a) => a.kind === 'bank') ?? accounts[0];
    const invoices = (await api.listInvoices({})).rows;
    const paid = invoices.find((i) => i.status === 'paid') ?? invoices[0];
    const contact = (await api.listContacts()).find((c) => c.id === paid.contactId) ?? null;
    const entries = (await api.listEntries({ limit: 20 })).rows;
    const expense = entries.find((e: Entry) => e.kind === 'expense' && e.contactId) ?? entries[0];

    await go('/');
    await shot('dashboard');
    await go('/transactions');
    await shot('transactions');
    editEntry(expense);
    await wait(900);
    await shot('transaction-editor');
    entryEditor.visible = false;
    await wait(500);
    await go(`/accounts/${bank.id}`);
    await shot('register');
    await go(`/accounts/${bank.id}/reconcile`);
    await shot('reconcile');

    await go('/invoices');
    await shot('invoices');
    await go(`/invoices/${paid.id}`);
    await shot('invoice');
    await go(`/invoices/${paid.id}/edit`);
    await shot('invoice-editor');
    await go('/invoices/templates');
    await shot('templates');
    await go('/quotes');
    await shot('quotes');
    await go('/bills');
    await shot('bills');
    if (contact) {
      await go(`/contacts/${contact.id}/statement`);
      await shot('statement');
    }

    await go('/reports');
    await shot('reports');
    await go('/budget');
    await click('Start from last year');
    await click(findSaveLabel());
    await wait(800);
    await shot('budget');
    await go('/reports/profit-and-loss?compare=budget');
    await shot('profit-and-loss');
    await go('/reports/balance-sheet');
    await shot('balance-sheet');
    await go('/reports/cash-flow');
    await shot('cash-flow');
    await go('/reports/tax-return');
    await shot('tax-return');
    await go('/recurring');
    await shot('recurring');
    await go('/activity');
    await shot('activity');

    await go('/transactions');
    await typeSearch('office');
    await shot('search');
    document.querySelector<HTMLInputElement>('.TopBar input')?.blur();
    (document.activeElement as HTMLElement | null)?.blur();
    await wait(400);

    openTab('/reports/profit-and-loss');
    openTab(`/invoices/${paid.id}`);
    await wait(1600);
    await shot('tabs');
    closeOtherTabs();
    await wait(400);

    setTheme('dark');
    await go('/');
    await shot('dashboard-dark');
    await go(`/invoices/${paid.id}`);
    await shot('invoice-dark');
    setTheme(themePreference.value);
  } catch (e) {
    console.error('Tour stopped:', e);
  } finally {
    await tiny.api.call('tour.done');
  }
}

/** The budget page's save button reads "Save (n)" once something changed. */
function findSaveLabel() {
  const b = [...document.querySelectorAll('button')].find((x) => /^Save \(\d+\)$/.test(x.textContent?.trim() ?? ''));
  return b?.textContent?.trim() ?? 'Save';
}
