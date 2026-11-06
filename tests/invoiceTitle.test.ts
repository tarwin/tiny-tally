import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Database } from 'tjs:sqlite';
import { installChangeLog } from '../backend/changelog';
import { migrations } from '../backend/schema';
import { seedBooks } from '../backend/seed';

const title = (db: Database, name = 'Standard') =>
  (db.prepare('SELECT title FROM invoice_templates WHERE name = ?').all(name) as { title: string }[])[0].title;

/** A file as the last version left it: every migration but the newest, with a country. */
function booksBeforeFix(country: string) {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)');
  for (const m of migrations.slice(0, -1)) db.exec(m);
  db.prepare("INSERT INTO meta (key, value) VALUES ('country', ?)").run(country);
  installChangeLog(db); // a real file has its log triggers on while it migrates
  return db;
}

test('new books start with the title their country uses', () => {
  for (const [country, expected] of [['AU', 'Tax Invoice'], ['GB', 'VAT Invoice'], ['US', 'Invoice']] as const) {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)');
    for (const m of migrations) db.exec(m);
    seedBooks(db, { name: 'Test', country, fiscalYearStart: '07-01' });
    assert.equal(title(db), expected, country);
    db.close();
  }
});

test('existing Australian books get Tax Invoice on the template they started with, and nothing else moves', () => {
  const db = booksBeforeFix('AU');
  db.exec(`INSERT INTO invoice_templates (name, title) VALUES ('Receipts', 'Invoice'), ('Custom', 'Bill')`);
  db.exec(migrations[migrations.length - 1]);
  assert.equal(title(db), 'Tax Invoice');
  assert.equal(title(db, 'Receipts'), 'Invoice');
  assert.equal(title(db, 'Custom'), 'Bill');
  db.close();
});

test('existing books elsewhere keep their title', () => {
  const db = booksBeforeFix('NZ');
  db.exec(migrations[migrations.length - 1]);
  assert.equal(title(db), 'Invoice');
  db.close();
});
