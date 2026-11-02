import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fakeApp } from './support/app.ts';
import { makeBooks } from './support/books.ts';
import { closeBooks, getBooks, inWindow, one, shareBooks, windowsSharing } from '../backend/db.ts';
import { api } from '../backend/main.ts';
import { listEntries, saveEntry } from '../backend/entries.ts';

test('windows sharing books: every one hears about a change, and the file stays open until the last lets go', async () => {
  const pushes = fakeApp();
  const b = await makeBooks({ country: 'AU' });
  const other = `${b.win}-b`;
  shareBooks(other, b.win);
  assert.deepEqual(windowsSharing(b.win).sort(), [b.win, other].sort());
  const call = (win: string, name: string, params: unknown) => api[name](params, null as any, { window: win } as any) as Promise<any>;

  await call(other, 'categories.save', { name: 'Fuel', kind: 'expense' });
  const changed = pushes.filter((p) => p.event === 'books-changed');
  assert.deepEqual(changed.map((p) => p.win).sort(), [b.win, other].sort());
  assert.deepEqual(changed[0].data.tables, ['categories']);
  assert.equal(changed[0].data.books.path, b.run(() => getBooks().path));

  // Reading announces nothing.
  pushes.length = 0;
  await call(b.win, 'categories.list', {});
  assert.equal(pushes.length, 0);

  // Settings changes carry the new name for every window's title and session.
  await call(b.win, 'settings.update', { name: 'Renamed' });
  assert.ok(pushes.some((p) => p.win === other && p.data.tables.includes('meta') && p.data.books.name === 'Renamed'));

  closeBooks(b.win);
  assert.equal(inWindow(other, () => one<{ n: number }>(getBooks().db, 'SELECT COUNT(*) AS n FROM categories WHERE name = ?', 'Fuel')!.n), 1);
  closeBooks(other);
  assert.throws(() => inWindow(other, () => getBooks()), /No books are open/);
});

test('saving over a change made since opening it is refused', async () => {
  const b = await makeBooks({ country: 'AU' });
  b.run(() => {
    const { db } = getBooks();
    const bank = one<{ id: number }>(db, 'SELECT id FROM accounts LIMIT 1')!.id;
    const cat = one<{ id: number }>(db, "SELECT id FROM categories WHERE kind = 'expense' LIMIT 1")!.id;
    const base = { date: '2026-07-10', kind: 'expense', amount: 1000, accountId: bank, categoryId: cat, taxCode: 'FRE' } as any;
    const id = saveEntry(base);
    // Saves a millisecond apart are told apart; make sure this one is.
    db.prepare("UPDATE entries SET updated_at = '2026-01-01T00:00:00.000Z' WHERE id = ?").run(id);
    const opened = listEntries({}).rows.find((e: any) => e.id === id)!.updatedAt;
    // Another tab saves first.
    saveEntry({ ...base, id, updatedAt: opened, amount: 2000 });
    assert.throws(() => saveEntry({ ...base, id, updatedAt: opened, amount: 3000 }), /changed in another tab or window/);
    const now = listEntries({}).rows.find((e: any) => e.id === id)!;
    assert.equal(now.amount, 2000);
    saveEntry({ ...base, id, updatedAt: now.updatedAt, amount: 3000 });
  });
  b.close();
});
