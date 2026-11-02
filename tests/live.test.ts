import assert from 'node:assert/strict';
import { test } from 'node:test';
import './support/browser.ts';
import { nextTick } from 'vue';
import { booksChanged, booksVersion, onBooksChanged, useBooksVersion } from '../src/lib/live.ts';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('a burst of announcements reloads once; pages follow it', async () => {
  const seen = useBooksVersion();
  let loads = 0;
  onBooksChanged(() => loads++);
  const start = booksVersion.value;
  for (let i = 0; i < 20; i++) booksChanged();
  assert.equal(booksVersion.value, start, 'not straight away');
  await wait(50);
  await nextTick();
  assert.equal(booksVersion.value, start + 1);
  assert.equal(seen.value, start + 1);
  assert.equal(loads, 1);
  booksChanged();
  await wait(50);
  await nextTick();
  assert.equal(loads, 2);
});
