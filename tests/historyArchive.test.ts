// Archiving the change history into a .tallylog file shrinks the books file,
// including everything up to now (an import's history is all from today).
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { makeBooks } from './support/books.ts';
import { getBooks, inWindow, one, openBooks, run } from '../backend/db.ts';
import { archiveCommit, archivePrepare, beginBatch, endBatch, historySize, splitPath } from '../backend/changelog.ts';

test('archiving everything up to now moves all the history out and shrinks the file', async () => {
  const b = await makeBooks({ country: 'AU', fiscalYearStart: '07-01', taxEnabled: true });
  // Reopened as the app opens books, without "create". Under txiki.js that
  // stops ATTACH making the new history file (fixed in archiveCommit); node's
  // SQLite allows it anyway, so this was checked by hand under tjs.
  await openBooks(b.win, { path: inWindow(b.win, () => getBooks().path), internal: true, force: true });
  b.run(() => {
    const db = getBooks().db;
    // A big import's worth of history: every row it brings in is logged.
    const batch = beginBatch('import.commit');
    const acct = one<{ id: number }>(db, "INSERT INTO accounts (name, kind, opening_balance, opening_date) VALUES ('Cheque', 'bank', 0, '2026-01-01') RETURNING id")!.id;
    for (let i = 0; i < 3000; i++) {
      run(db, "INSERT INTO entries (date, kind, amount, account_id, memo) VALUES ('2026-08-01', 'expense', ?, ?, ?)", 100 + i, acct, `Imported line ${i} with a memo long enough to take some room`);
    }
    endBatch(batch);

    const before = historySize();
    assert.ok(before.changes >= 3000);

    const now = new Date().toISOString();
    const prep = archivePrepare({ before: now.slice(0, 10), beforeAt: now });
    assert.equal(prep.counts.changes, before.changes);
    const r = archiveCommit({ dest: prep.dest, before: prep.before, day: prep.day, hash: 'test' });

    // Only the marker saying where it went is left.
    const after = historySize();
    assert.equal(after.changes, 0);
    assert.deepEqual(
      { ...one<{ action: string; n: number }>(db, 'SELECT action, COUNT(*) AS n FROM change_batches')! },
      { action: 'history.archive', n: 1 },
    );
    assert.ok(r.sizeAfter < r.sizeBefore / 2, `${r.sizeBefore} → ${r.sizeAfter}`);
    assert.equal(r.sizeAfter, after.bytes);
    // The transactions are all still there.
    assert.equal(one<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM entries')!.n, 3000);

    // Next to the books file, with every change in it.
    assert.ok(r.file.endsWith('.tallylog') && existsSync(r.file));
    const arch = new DatabaseSync(r.file, { readOnly: true });
    assert.equal((arch.prepare('SELECT COUNT(*) AS n FROM change_log').get() as { n: number }).n, before.changes);
    arch.close();
  });
  b.close();
});

test('the history file goes beside the books, whichever way the path is written', () => {
  assert.deepEqual(splitPath('C:\\Users\\Daan\\Documents\\Daan Test.tally'), { dir: 'C:\\Users\\Daan\\Documents', name: 'Daan Test.tally', sep: '\\' });
  assert.deepEqual(splitPath('C:\\Users\\Daan\\AppData\\Roaming\\tiny-tally/books/Daan Test.tally'), { dir: 'C:\\Users\\Daan\\AppData\\Roaming\\tiny-tally/books', name: 'Daan Test.tally', sep: '/' });
  assert.deepEqual(splitPath('/Users/daan/Daan Test.tally'), { dir: '/Users/daan', name: 'Daan Test.tally', sep: '/' });
});
