// Bank statement files: OFX, and the QuickBooks (.qbo, "Web Connect") and
// Quicken (.qfx) variants, which are OFX with an extra header. Both the old
// SGML form (no closing tags) and OFX 2 XML are read the same way.
import type { ImportBatch, ImportEntry } from '../../shared/import';
import { occurrenceRefs, parseAmount, parseDate } from './parse';

export function looksLikeOfx(text: string) {
  return /<OFX>/i.test(text.slice(0, 20000)) || /OFXHEADER/i.test(text.slice(0, 2000));
}

/** The value of `<TAG>value` up to the next tag. */
function tag(block: string, name: string) {
  const m = new RegExp(`<${name}>([^<\\r\\n]*)`, 'i').exec(block);
  return m ? m[1].trim().replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>') : '';
}

function blocks(text: string, name: string) {
  const out: string[] = [];
  const re = new RegExp(`<${name}>([\\s\\S]*?)(?=</${name}>|<${name}>|$)`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push(m[1]);
  return out;
}

export function parseOfx(text: string): ImportBatch {
  const accounts: ImportBatch['accounts'] = [];
  const entries: ImportEntry[] = [];
  let unreadable = 0;

  const statements = [
    ...blocks(text, 'STMTRS').map((b) => ({ b, kind: 'bank' as const })),
    ...blocks(text, 'CCSTMTRS').map((b) => ({ b, kind: 'credit_card' as const })),
  ];

  for (const { b, kind } of statements) {
    const acctId = tag(b, 'ACCTID') || 'account';
    const key = `${kind}:${acctId}`;
    const last4 = acctId.replace(/\D/g, '').slice(-4);
    const ref = occurrenceRefs();
    let sum = 0;
    for (const t of blocks(b, 'STMTTRN')) {
      const amount = parseAmount(tag(t, 'TRNAMT'));
      const date = parseDate(tag(t, 'DTPOSTED') || tag(t, 'DTUSER'));
      if (amount === null || !date || amount === 0) {
        unreadable++;
        continue;
      }
      sum += amount;
      const name = tag(t, 'NAME') || tag(t, 'PAYEE');
      const memo = tag(t, 'MEMO');
      const fitid = tag(t, 'FITID');
      entries.push({
        ref: ref(fitid ? `fitid:${fitid}` : `ofx:${date}:${amount}:${name}:${memo}`),
        date,
        kind: amount > 0 ? 'income' : 'expense',
        amount: Math.abs(amount),
        accountKey: key,
        memo: [name, memo && memo !== name ? memo : ''].filter(Boolean).join(' · ') || undefined,
      });
    }
    // The ledger balance is at the end of the statement; work back to the start.
    const closing = parseAmount(tag(b, 'BALAMT'));
    accounts.push({
      key,
      name: `${kind === 'credit_card' ? 'Card' : 'Bank account'}${last4 ? ` ··${last4}` : ''}`,
      kind,
      openingBalance: closing === null ? 0 : closing - sum,
    });
  }

  const skipped: ImportBatch['skipped'] = [];
  if (unreadable) skipped.push({ reason: "Lines without a readable date or amount", count: unreadable });
  return { source: 'ofx', accounts, categories: [], contacts: [], entries, skipped };
}
