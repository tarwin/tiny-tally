// Real books in a temp folder, for backend tests.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeBooks, createBooks, inWindow } from '../../backend/db.ts';
import type { BooksSetup } from '../../backend/seed.ts';

let n = 0;

/** Makes a fresh set of books and returns a runner bound to them. */
export async function makeBooks(setup: Partial<BooksSetup> & Pick<BooksSetup, 'country'>) {
  const win = `test-${++n}`;
  const dir = mkdtempSync(join(tmpdir(), 'tally-test-'));
  await createBooks(win, join(dir, 'books.tally'), false, { name: 'Test Books', fiscalYearStart: '01-01', ...setup });
  return {
    run: <T>(fn: () => T) => inWindow(win, fn),
    close: () => closeBooks(win),
  };
}
