// The search box in the top bar: a few of each kind of thing that matches.
// Pages and actions are matched in the page; this covers what's in the books.
import { all, getBooks } from './db';
import { listEntries } from './entries';

const EACH = 6;

/** '1,234.50', '$1234.5', '1234' → cents, or null if it isn't an amount. */
function amountOf(text: string) {
  const s = text.replace(/^[A-Z]{0,3}\$|[\s,]/gi, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const cents = Math.round(Number(s) * 100);
  return cents > 0 ? cents : null;
}

export function search(query: string) {
  const text = String(query ?? '').trim();
  if (!text) return { entries: [], documents: [], contacts: [], accounts: [], categories: [] };
  const { db } = getBooks();
  const like = '%' + text.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
  const amount = amountOf(text);

  // Typing an amount finds that amount; anything else searches the words.
  const byAmount = amount ? listEntries({ amount, limit: EACH }).rows : [];
  const byText = listEntries({ q: text, limit: EACH }).rows;
  const seen = new Set<number>();
  const entries = [...byAmount, ...byText].filter((e: any) => !seen.has(e.id) && seen.add(e.id)).slice(0, EACH);

  const documents = all(db,
    `SELECT i.id, i.number, i.doc_type AS docType, i.issue_date AS date, i.status, i.total, ct.name AS contactName
     FROM invoices i JOIN contacts ct ON ct.id = i.contact_id
     WHERE i.number LIKE ?1 ESCAPE '\\' OR ct.name LIKE ?1 ESCAPE '\\' OR i.reference LIKE ?1 ESCAPE '\\' OR i.total = ?2
     ORDER BY i.issue_date DESC, i.id DESC LIMIT ${EACH}`, like, amount ?? -1);

  const contacts = all(db,
    `SELECT id, kind, name, email FROM contacts
     WHERE is_archived = 0 AND (name LIKE ?1 ESCAPE '\\' OR email LIKE ?1 ESCAPE '\\')
     ORDER BY name COLLATE NOCASE LIMIT ${EACH}`, like);

  const accounts = all(db,
    `SELECT id, name, kind FROM accounts WHERE is_archived = 0 AND name LIKE ? ESCAPE '\\'
     ORDER BY sort, name COLLATE NOCASE LIMIT ${EACH}`, like);

  const categories = all(db,
    `SELECT id, name, kind FROM categories WHERE is_archived = 0 AND name LIKE ? ESCAPE '\\'
     ORDER BY name COLLATE NOCASE LIMIT ${EACH}`, like);

  return { entries, documents, contacts, accounts, categories };
}
