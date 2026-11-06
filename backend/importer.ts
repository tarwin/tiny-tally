// Imports from QuickBooks (IIF), bank files (OFX/QBO/QFX) and CSV. The page
// parses the file into an ImportBatch; this resolves it against the books
// and writes everything in one transaction.
import { saveJournal } from './journals';
import { all, getBooks, one, run } from './db';
import { OFF_BAS, saveEntry } from './entries';
import { recordPayment } from './invoices';
import { resolveTradingName, snapshotOf } from './tradingNames';
import { assertUnlocked, getSettings } from './settings';
import { countryProfile } from '../src/shared/countries';
import { taxCodeOr } from '../src/shared/tax';
import type { ImportPlan, ImportResult } from '../src/shared/import';

const MAX_FILE = 25 * 1024 * 1024;

export async function readImportFile(path: string) {
  if (typeof path !== 'string' || !path) throw new Error('Choose a file to import.');
  const st = await tjs.stat(path);
  if (st.size > MAX_FILE) throw new Error('That file is over 25 MB. Export a shorter date range and try again.');
  const bytes = await tjs.readFile(path);
  const name = path.split(/[\\/]/).pop() ?? path;
  // Excel files are zips and portable company files are compound files: the
  // page unpacks them, so send the bytes.
  if ((bytes[0] === 0x50 && bytes[1] === 0x4b) || /\.qbm$/i.test(name)) return { name, text: '', base64: toBase64(bytes) };
  let text = new TextDecoder('utf-8').decode(bytes);
  // Windows-1252 exports (older QuickBooks Desktop) decode with replacement
  // characters; fall back to a byte-for-byte reading so names survive.
  if (text.includes('�')) text = Array.from(bytes, (b) => String.fromCharCode(b)).join('');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return { name, text };
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function toBase64(bytes: Uint8Array) {
  const parts: string[] = [];
  for (let start = 0; start < bytes.length; start += 3 * 8192) {
    let s = '';
    const end = Math.min(bytes.length, start + 3 * 8192);
    for (let i = start; i < end; i += 3) {
      const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
      s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < end ? B64[(n >> 6) & 63] : '=') + (i + 2 < end ? B64[n & 63] : '=');
    }
    parts.push(s);
  }
  return parts.join('');
}

/**
 * For each payee/description, the category and contact last used with it, so
 * bank imports can be pre-categorised the way the user has done before.
 */
export function suggestCategories(names: string[]) {
  const { db } = getBooks();
  const out: Record<string, { categoryId: number; kind: 'income' | 'expense' }> = {};
  const byContact = db.prepare(
    `SELECT e.category_id AS categoryId, e.kind FROM entries e JOIN contacts c ON c.id = e.contact_id
     WHERE c.name = ? COLLATE NOCASE AND e.category_id IS NOT NULL ORDER BY e.date DESC, e.id DESC LIMIT 1`,
  );
  const byMemo = db.prepare(
    `SELECT category_id AS categoryId, kind FROM entries
     WHERE memo = ? COLLATE NOCASE AND category_id IS NOT NULL ORDER BY date DESC, id DESC LIMIT 1`,
  );
  try {
    for (const name of new Set(names.filter(Boolean).slice(0, 5000))) {
      const hit = (byContact.all(name)[0] ?? byMemo.all(name)[0]) as { categoryId: number; kind: 'income' | 'expense' } | undefined;
      if (hit) out[name] = hit;
    }
  } finally {
    byContact.finalize();
    byMemo.finalize();
  }
  return out;
}

export function commitImport(plan: ImportPlan): ImportResult {
  const { db } = getBooks();
  const { batch } = plan;
  const settings = getSettings();
  const result: ImportResult = {
    accountsCreated: 0,
    categoriesCreated: 0,
    contactsCreated: 0,
    entriesCreated: 0,
    documentsCreated: 0,
    journalsCreated: 0,
    duplicates: 0,
    skipped: 0,
    failed: [],
    failedCount: 0,
  };
  const fail = (ref: string, date: string, reason: string) => {
    result.failedCount++;
    if (result.failed.length < 50) result.failed.push({ ref, date, reason });
  };

  db.transaction(() => {
    // ---- accounts ----
    const accountIds = new Map<string, number>();
    for (const a of batch.accounts) {
      const target = plan.accounts[a.key] ?? { create: true };
      if ('skip' in target) continue;
      if ('existingId' in target) {
        if (!one(db, 'SELECT id FROM accounts WHERE id = ?', target.existingId)) throw new Error(`An account picked for “${a.name}” no longer exists.`);
        accountIds.set(a.key, target.existingId);
        continue;
      }
      const firstDate = batch.entries
        .filter((e) => e.accountKey === a.key || e.toAccountKey === a.key)
        .reduce((min, e) => (e.date < min ? e.date : min), '9999-12-31');
      const openingDate = firstDate === '9999-12-31' ? new Date().toISOString().slice(0, 10) : firstDate;
      const name = uniqueName('accounts', a.name.trim() || 'Imported account');
      const id = one<{ id: number }>(db,
        'INSERT INTO accounts (name, kind, opening_balance, opening_date) VALUES (?, ?, ?, ?) RETURNING id',
        name, a.kind, Math.round(a.openingBalance ?? 0), openingDate)!.id;
      accountIds.set(a.key, id);
      result.accountsCreated++;
    }

    // ---- categories ----
    const categoryIds = new Map<string, number>();
    for (const c of batch.categories) {
      const target = plan.categories[c.key] ?? { create: true };
      if ('skip' in target) continue;
      if ('existingId' in target) {
        const row = one<{ kind: string }>(db, 'SELECT kind FROM categories WHERE id = ?', target.existingId);
        if (!row) throw new Error(`A category picked for “${c.name}” no longer exists.`);
        if (row.kind !== c.kind) throw new Error(`“${c.name}” is ${c.kind}, so it has to map to an ${c.kind} category.`);
        categoryIds.set(c.key, target.existingId);
        continue;
      }
      const name = c.name.trim() || 'Imported';
      const same = one<{ id: number }>(db, 'SELECT id FROM categories WHERE kind = ? AND name = ? COLLATE NOCASE', c.kind, name);
      if (same) {
        categoryIds.set(c.key, same.id);
        continue;
      }
      const cls = c.class && ['pnl', 'tax', 'owner', 'loan', 'asset'].includes(c.class) ? c.class : 'pnl';
      // Tax payments, owner's money and loans never carry GST; assets bought are capital purchases.
      const taxCode = !settings.taxEnabled ? null : OFF_BAS.includes(cls) ? 'NTR' : taxCodeOr(countryProfile(settings.country).tax, c.kind, cls === 'asset' ? 'CAP' : null);
      const id = one<{ id: number }>(db,
        'INSERT INTO categories (name, kind, tax_code, class) VALUES (?, ?, ?, ?) RETURNING id',
        name, c.kind, taxCode, cls)!.id;
      categoryIds.set(c.key, id);
      result.categoriesCreated++;
    }

    // ---- contacts: matched by name, created when new ----
    const contactIds = new Map<string, number>();
    const findContact = (name: string) =>
      one<{ id: number }>(db, 'SELECT id FROM contacts WHERE name = ? COLLATE NOCASE ORDER BY is_archived, id LIMIT 1', name);
    const ensureContact = (name: string, kind: 'customer' | 'vendor', extra: { email?: string; phone?: string; address?: string } = {}) => {
      const clean = name.trim();
      if (!clean) return null;
      const lower = clean.toLowerCase();
      if (contactIds.has(lower)) return contactIds.get(lower)!;
      const found = findContact(clean);
      let id: number;
      if (found) {
        id = found.id;
        // Fill gaps only; never overwrite details the user already has.
        run(db,
          `UPDATE contacts SET email = COALESCE(email, ?), phone = COALESCE(phone, ?), address = COALESCE(address, ?) WHERE id = ?`,
          extra.email || null, extra.phone || null, extra.address || null, id);
      } else {
        id = one<{ id: number }>(db,
          'INSERT INTO contacts (kind, name, email, phone, address) VALUES (?, ?, ?, ?, ?) RETURNING id',
          kind, clean, extra.email || null, extra.phone || null, extra.address || null)!.id;
        result.contactsCreated++;
      }
      contactIds.set(lower, id);
      return id;
    };
    for (const c of batch.contacts) ensureContact(c.name, c.kind, c);

    // ---- invoices, bills and credit notes ----
    // Written directly: the source's exact cents, not worked out again from a rate.
    const documentIds = new Map<string, number>();
    const taxRules = countryProfile(settings.country).tax;
    for (const d of batch.documents ?? []) {
      const kind = d.docType === 'bill' ? 'expense' : 'income';
      const contactId = ensureContact(d.contactName, d.docType === 'bill' ? 'vendor' : 'customer');
      if (!contactId) {
        fail(d.ref, d.issueDate, `${d.number} has nobody to go to.`);
        continue;
      }
      const lines = d.lines.map((l) => {
        const tax = settings.taxEnabled ? l.tax : 0;
        return {
          ...l,
          // Without tax turned on, a line is simply what was charged.
          net: settings.taxEnabled ? l.net : l.net + l.tax,
          tax,
          categoryId: categoryIds.get(l.categoryKey) ?? plan.fallbackCategory[kind],
          taxCode: settings.taxEnabled ? taxCodeOr(taxRules, kind, l.taxCode) : null,
        };
      });
      const net = lines.reduce((t, l) => t + l.net, 0);
      const tax = lines.reduce((t, l) => t + l.tax, 0);
      const same = one<{ id: number }>(db,
        'SELECT id FROM invoices WHERE doc_type = ? AND contact_id = ? AND issue_date = ? AND total = ? AND (number = ? OR number LIKE ?)',
        d.docType, contactId, d.issueDate, net + tax, d.number, `${d.number} (%)`);
      if (same) {
        documentIds.set(d.ref, same.id);
        result.duplicates++;
        continue;
      }
      if (lines.some((l) => !l.categoryId)) {
        fail(d.ref, d.issueDate, `${d.number} has a line with no category.`);
        continue;
      }
      try {
        assertUnlocked(d.issueDate);
      } catch (err) {
        fail(d.ref, d.issueDate, err instanceof Error ? err.message : String(err));
        continue;
      }
      let number = d.number;
      for (let i = 2; one(db, 'SELECT id FROM invoices WHERE number = ?', number); i++) number = `${d.number} (${i})`;
      const tradingNameId = d.docType === 'bill' ? null : resolveTradingName(null, contactId, null);
      const id = one<{ id: number }>(db,
        `INSERT INTO invoices (doc_type, number, contact_id, issue_date, due_date, status, notes, trading_name_id, from_snapshot,
           prices_include_tax, net, tax, total, sent_at)
         VALUES (?, ?, ?, ?, ?, 'sent', ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        d.docType, number, contactId, d.issueDate, d.dueDate, d.notes ?? null, tradingNameId,
        tradingNameId === null ? null : snapshotOf(tradingNameId), d.pricesIncludeTax ? 1 : 0, net, tax, net + tax, d.issueDate)!.id;
      lines.forEach((l, sort) => {
        run(db,
          `INSERT INTO invoice_lines (invoice_id, sort, description, qty_milli, unit_price, category_id, tax_code, net, tax)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          id, sort, l.description, l.qtyMilli, l.unitPrice, l.categoryId, l.taxCode, l.net, l.tax);
      });
      documentIds.set(d.ref, id);
      result.documentsCreated++;
    }

    // ---- entries ----
    const dupe = db.prepare('SELECT 1 FROM entries WHERE account_id = ? AND import_ref = ?');
    try {
      for (const e of batch.entries) {
        const accountId = accountIds.get(e.accountKey);
        if (!accountId) continue; // its account was skipped
        if (dupe.all(accountId, e.ref).length) {
          result.duplicates++;
          continue;
        }
        if (e.documentRef) {
          const invoiceId = documentIds.get(e.documentRef);
          if (!invoiceId) {
            fail(e.ref, e.date, 'The document this pays wasn’t brought in.');
            continue;
          }
          try {
            const id = recordPayment({ invoiceId, date: e.date, amount: e.amount, accountId, memo: e.memo ?? null });
            run(db, 'UPDATE entries SET import_ref = ? WHERE id = ?', e.ref, id);
            result.entriesCreated++;
          } catch (err) {
            fail(e.ref, e.date, err instanceof Error ? err.message : String(err));
          }
          continue;
        }
        let toAccountId: number | null = null;
        let categoryId: number | null = null;
        if (e.kind === 'transfer') {
          toAccountId = (e.toAccountKey && accountIds.get(e.toAccountKey)) || null;
          if (!toAccountId) {
            fail(e.ref, e.date, 'The other account in this transfer was skipped.');
            continue;
          }
        } else {
          // A category the user chose to skip takes its transactions with it.
          if (e.categoryKey && !e.categoryId && 'skip' in (plan.categories[e.categoryKey] ?? {})) {
            result.skipped++;
            continue;
          }
          categoryId = e.categoryId ?? (e.categoryKey ? categoryIds.get(e.categoryKey) : undefined) ?? plan.fallbackCategory[e.kind] ?? null;
          if (!categoryId) {
            fail(e.ref, e.date, 'No category.');
            continue;
          }
        }
        const contactId = e.contactName && e.kind !== 'transfer'
          ? ensureContact(e.contactName, e.kind === 'income' ? 'customer' : 'vendor')
          : null;
        try {
          const id = saveEntry({
            kind: e.kind,
            date: e.date,
            amount: e.amount,
            accountId,
            toAccountId,
            categoryId,
            contactId,
            memo: e.memo ?? null,
            ...(e.taxAmount === undefined ? {} : { taxCode: e.taxCode, taxAmount: e.taxAmount }),
          } as Parameters<typeof saveEntry>[0]);
          run(db, 'UPDATE entries SET import_ref = ? WHERE id = ?', e.ref, id);
          result.entriesCreated++;
        } catch (err) {
          fail(e.ref, e.date, err instanceof Error ? err.message : String(err));
        }
      }
    } finally {
      dupe.finalize();
    }

    // ---- journals ----
    if (batch.journals?.length) {
      // They have no import reference, so one that's already here is known by its figures.
      const signature = (date: string, lines: { account: string; amount: number }[]) =>
        `${date}|${lines.map((l) => `${l.account}:${l.amount}`).sort().join(',')}`;
      const already = new Map<number, { date: string; lines: { account: string; amount: number }[] }>();
      for (const l of all<any>(db, 'SELECT j.id, j.date, l.category_id, l.system, l.amount FROM journal_lines l JOIN journals j ON j.id = l.journal_id')) {
        const j = already.get(l.id) ?? { date: l.date as string, lines: [] as { account: string; amount: number }[] };
        j.lines.push({ account: l.category_id !== null ? `cat:${l.category_id}` : l.system, amount: l.amount });
        already.set(l.id, j);
      }
      const seen = new Map<string, number>();
      for (const j of already.values()) {
        const sig = signature(j.date, j.lines);
        seen.set(sig, (seen.get(sig) ?? 0) + 1);
      }
      for (const j of batch.journals) {
        // Leaving out a line would unbalance it, so a skipped category leaves out the whole journal.
        if (j.lines.some((l) => l.categoryKey && !categoryIds.has(l.categoryKey))) {
          result.skipped++;
          continue;
        }
        const lines = j.lines.map((l) => ({ account: l.system ?? `cat:${categoryIds.get(l.categoryKey!)}`, amount: l.amount, memo: l.memo }));
        const sig = signature(j.date, lines);
        const left = seen.get(sig) ?? 0;
        if (left) {
          seen.set(sig, left - 1);
          result.duplicates++;
          continue;
        }
        try {
          saveJournal({ date: j.date, memo: j.memo, lines });
          result.journalsCreated++;
        } catch (err) {
          fail(`journal:${j.date}`, j.date, err instanceof Error ? err.message : String(err));
        }
      }
    }
  })();

  return result;
}

function uniqueName(table: 'accounts', base: string) {
  const { db } = getBooks();
  const taken = new Set(all<{ name: string }>(db, `SELECT name FROM ${table}`).map((r) => r.name.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base} (${i})`.toLowerCase())) return `${base} (${i})`;
}
