// Reconciliation helper: read a bank statement file (OFX/QBO/QFX, CSV or
// Excel) and find the unticked transactions it shows.
import { api, type ReconcileRow } from './api';
import { addDays } from './dates';
import { guessBankMapping, csvToBatch, type BankMapping } from './import/csvImport';
import { looksLikeOfx, parseOfx } from './import/ofx';
import { companyDateOrder, detectDateOrder, parseCsv } from './import/parse';
import { readXlsx } from './import/xlsx';
import { hashRef } from '../shared/import';

export interface StatementLine {
  date: string;
  /** cents; + money in, − money out (from the account's side, as in ReconcileRow.signed) */
  signed: number;
  memo: string;
}

/** Banks often post a day or two after the transaction date. */
const NEAR_DAYS = 3;

export async function readStatement(path: string, currency: string): Promise<{ name: string; lines: StatementLine[] }> {
  const file = await api.readImportFile(path);
  let batch;
  if (!file.base64 && looksLikeOfx(file.text)) batch = parseOfx(file.text);
  else {
    const rows = file.base64 ? await readXlsx(Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0))) : parseCsv(file.text);
    // Use the columns picked the last time this bank's file was imported.
    const head = rows[0] ?? [];
    const key = head.some((c) => /[a-z]/i.test(c)) ? `csv-mapping:${hashRef(...head.map((c) => c.trim().toLowerCase()))}` : null;
    const saved = key ? await api.getPref<{ bank: BankMapping | null }>(key).catch(() => null) : null;
    const mapping = saved?.bank ?? guessBankMapping(rows, detectDateOrder(rows.slice(0, 200).flat(), companyDateOrder(currency)));
    batch = csvToBatch(rows, mapping, 'statement', file.name);
  }
  const lines = batch.entries.map((e) => ({ date: e.date, signed: e.kind === 'income' ? e.amount : -e.amount, memo: e.memo ?? '' }));
  if (!lines.length) throw new Error("Couldn't find any transactions in that file.");
  return { name: file.name, lines };
}

/**
 * Pairs statement lines with unticked rows one to one: same amount and date
 * first, then the same amount within a few days. Rows after `upTo` (the
 * statement date) are left alone, since they can't be ticked.
 */
export function matchStatement(lines: StatementLine[], rows: ReconcileRow[], upTo: string) {
  const open = rows.filter((r) => !r.ticked && r.date <= upTo);
  const used = new Set<number>();
  const matched: { line: StatementLine; row: ReconcileRow; exact: boolean }[] = [];
  const unmatched: StatementLine[] = [];
  const pending = lines.filter((l) => l.date <= addDays(upTo, NEAR_DAYS));
  // Lines matching an already-ticked row are already accounted for.
  const ticked = rows.filter((r) => r.ticked);
  const tickedUsed = new Set<number>();

  const take = (line: StatementLine, pool: ReconcileRow[], taken: Set<number>, near: boolean) => {
    let best: ReconcileRow | null = null;
    let bestGap = Infinity;
    for (const r of pool) {
      if (taken.has(r.id) || r.signed !== line.signed) continue;
      const gap = Math.abs(dayNumber(r.date) - dayNumber(line.date));
      if (gap === 0 || (near && gap <= NEAR_DAYS && gap < bestGap)) {
        best = r;
        bestGap = gap;
        if (gap === 0) break;
      }
    }
    if (best) taken.add(best.id);
    return best;
  };

  const second: StatementLine[] = [];
  for (const line of pending) {
    if (take(line, ticked, tickedUsed, false)) continue;
    const row = take(line, open, used, false);
    if (row) matched.push({ line, row, exact: true });
    else second.push(line);
  }
  for (const line of second) {
    if (take(line, ticked, tickedUsed, true)) continue;
    const row = take(line, open, used, true);
    if (row) matched.push({ line, row, exact: false });
    else if (line.date <= upTo) unmatched.push(line);
  }
  return { matched, unmatched };
}

function dayNumber(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
}
