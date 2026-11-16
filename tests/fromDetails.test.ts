// Your details at the top of a document: business name, then your name with
// its post-nominals, address, phone, email and website, each on a line.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeBooks } from './support/books.ts';
import { getBooks, one } from '../backend/db.ts';
import { defaultTradingNameId, saveTradingName, senderFor, snapshotOf } from '../backend/tradingNames.ts';
import { fromLines, normaliseLayout, type FromKey } from '../src/shared/templateLayout.ts';

const values = (v: Partial<Record<FromKey, string>>): Record<FromKey, string> =>
  ({ business: '', name: '', postnominals: '', address: '', phone: '', email: '', website: '', tax_id: '', ...v });
const text = (lines: ReturnType<typeof fromLines>) =>
  lines.map((l) => l.parts.map((p) => (p.bold ? `**${p.text}**` : p.text)).join(''));

test('the standard layout: a line each, your name bold, and nothing for what is empty', () => {
  const v = values({
    business: 'Seventh House', name: 'Sally Smith', postnominals: 'BA (Hons)', address: '1 Long St\nCarlton VIC 3053',
    phone: '0400 000 000', email: 'sally@example.com', website: 'example.com', tax_id: 'ABN 12 345 678 901',
  });
  assert.deepEqual(text(fromLines('', v)), [
    'Seventh House', '**Sally Smith** BA (Hons)', '1 Long St\nCarlton VIC 3053', '0400 000 000', 'sally@example.com', 'example.com', 'ABN 12 345 678 901',
  ]);
  assert.deepEqual(text(fromLines('', values({ business: 'Seventh House', email: 'sally@example.com' }))), ['Seventh House', 'sally@example.com']);
  // No name: the letters after it still show, on their own.
  assert.deepEqual(text(fromLines('', values({ business: 'B', postnominals: 'CPA' }))), ['B', 'CPA']);
});

test('a layout of your own: placeholders, bold, leftover separators tidied, and the tax ID kept when it must show', () => {
  const layout = '**{name}**, {postnominals}\n{business}\nWriter and editor\n{phone} · {email}';
  const v = values({ business: 'Seventh House', name: 'Sally', phone: '0400', tax_id: 'ABN 1' });
  assert.deepEqual(text(fromLines(layout, v)), ['**Sally**', 'Seventh House', 'Writer and editor', '0400']);
  assert.deepEqual(text(fromLines(layout, v, { taxIdRequired: true })).at(-1), 'ABN 1');
  // While editing, an empty detail keeps its place, to click on.
  const editing = fromLines(layout, values({ business: 'B' }), { editing: true });
  assert.deepEqual(editing.map((l) => [l.empty, l.field, l.ghost]), [
    [true, 'from.personName', 'Your name Post-nominals'],
    [false, 'from.name', 'Business name'],
    [false, null, ''],
    [true, 'from.phone', 'Phone Email'],
  ]);
  assert.equal(normaliseLayout({ from: '  {business}  ' }).from, '{business}');
  assert.equal(normaliseLayout({}).from, '');
});

test('a trading name keeps your name, post-nominals and website, and a sent document keeps them as they were', async () => {
  const b = await makeBooks({ country: 'AU', fiscalYearStart: '07-01', taxEnabled: true });
  b.run(() => {
    const id = defaultTradingNameId();
    const t = one<any>(getBooks().db, 'SELECT * FROM trading_names WHERE id = ?', id);
    saveTradingName({ id, name: t.name, personName: ' Sally Smith ', postnominals: 'BA (Hons)', website: 'example.com' });
    const snap = snapshotOf(id);
    // Something that doesn't know the new fields leaves them alone.
    saveTradingName({ id, name: t.name, email: 'sally@example.com' });
    assert.deepEqual(
      (({ personName, postnominals, website, email }) => ({ personName, postnominals, website, email }))(senderFor(id, null)!),
      { personName: 'Sally Smith', postnominals: 'BA (Hons)', website: 'example.com', email: 'sally@example.com' },
    );
    saveTradingName({ id, name: t.name, personName: '', website: null });
    assert.equal(senderFor(id, null)!.personName, null);
    assert.equal(senderFor(id, snap)!.personName, 'Sally Smith');
  });
  b.close();
});
