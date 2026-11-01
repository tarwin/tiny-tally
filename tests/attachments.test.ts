import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { makeBooks } from './support/books.ts';
import { all, getBooks, one } from '../backend/db.ts';
import { deleteEntry, listEntries, saveEntry } from '../backend/entries.ts';
import { addAttachment, deleteAttachment, getAttachment, listAttachments, openAttachment } from '../backend/attachments.ts';
import { toBase64 } from '../src/shared/base64.ts';

const bytes = Uint8Array.from({ length: 5000 }, (_, i) => (i * 13) & 255);

async function withEntry() {
  const b = await makeBooks({ country: 'AU', fiscalYearStart: '07-01', taxEnabled: true });
  const entryId = b.run(() => {
    const { db } = getBooks();
    return saveEntry({
      date: '2026-08-01',
      kind: 'expense',
      amount: 1100,
      accountId: one<{ id: number }>(db, 'SELECT id FROM accounts LIMIT 1')!.id,
      categoryId: one<{ id: number }>(db, "SELECT id FROM categories WHERE name = 'Rent'")!.id,
    } as any);
  });
  return { ...b, entryId };
}

test('an attachment keeps its bytes exactly, and opens as a real file', async () => {
  const b = await withEntry();
  const id = b.run(() => addAttachment({ entryId: b.entryId, name: 'receipt.pdf', mime: 'application/pdf', data: toBase64(bytes) }));
  b.run(() => {
    assert.deepEqual(listAttachments({ entryId: b.entryId }).map((a: any) => [a.name, a.mime, a.size]), [['receipt.pdf', 'application/pdf', 5000]]);
    assert.equal(getAttachment(id).data, toBase64(bytes));
    assert.equal(listEntries({}).rows[0].attachments, 1);
  });
  const path = await b.run(() => openAttachment(id));
  assert.deepEqual(new Uint8Array(readFileSync(path)), bytes);
  b.close();
});

test('attachments go with their transaction, and the log never holds the file', async () => {
  const b = await withEntry();
  b.run(() => {
    addAttachment({ entryId: b.entryId, name: 'a.jpg', mime: 'image/jpeg', data: toBase64(bytes) });
    const logged = all<{ after: string }>(getBooks().db, "SELECT after FROM change_log WHERE table_name = 'attachments'");
    assert.ok(logged.length);
    for (const l of logged) assert.equal(JSON.parse(l.after).data, '(file)');
    deleteEntry(b.entryId);
    assert.equal(one<{ n: number }>(getBooks().db, 'SELECT COUNT(*) AS n FROM attachments')!.n, 0);
  });
  b.close();
});

test('only PDFs and photos, on something that exists', async () => {
  const b = await withEntry();
  b.run(() => {
    assert.throws(() => addAttachment({ entryId: b.entryId, name: 'virus.exe', mime: 'application/x-msdownload', data: toBase64(bytes) }), /PDF or a photo/);
    assert.throws(() => addAttachment({ entryId: 9999, name: 'a.pdf', mime: 'application/pdf', data: toBase64(bytes) }), /no longer exists/);
    assert.throws(() => addAttachment({ entryId: b.entryId, name: 'a.pdf', mime: 'application/pdf', data: '' }), /empty/);
    // The name is only ever a name, never a path.
    const id = addAttachment({ entryId: b.entryId, name: '../../etc/x.pdf', mime: 'application/pdf', data: toBase64(bytes) });
    assert.equal(getAttachment(id).name, 'x.pdf');
    deleteAttachment(id);
  });
  b.close();
});
