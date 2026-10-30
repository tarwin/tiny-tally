// Categorisation rules: "description contains X" -> a category (and contact).
// Imports use them before falling back to history; the first match wins.
import { all, getCompany, one, run } from './db';

export interface RuleInput {
  id?: number;
  pattern: string;
  /** Only match money in, or out. Null = either. */
  kind?: 'income' | 'expense' | null;
  categoryId: number;
  contactId?: number | null;
}

export function listRules() {
  return all(getCompany().db,
    `SELECT r.id, r.pattern, r.kind, r.category_id AS categoryId, c.name AS categoryName, c.kind AS categoryKind,
            r.contact_id AS contactId, ct.name AS contactName, r.sort
     FROM rules r JOIN categories c ON c.id = r.category_id LEFT JOIN contacts ct ON ct.id = r.contact_id
     ORDER BY r.sort, r.id`);
}

export function saveRule(input: RuleInput) {
  const { db } = getCompany();
  const pattern = String(input.pattern ?? '').trim();
  if (pattern.length < 2) throw new Error('Enter at least two characters to match.');
  const cat = one<any>(db, 'SELECT * FROM categories WHERE id = ?', input.categoryId);
  if (!cat) throw new Error('Choose a category.');
  const kind = input.kind === 'income' || input.kind === 'expense' ? input.kind : cat.kind;
  if (cat.kind !== kind) throw new Error(`“${cat.name}” is an ${cat.kind} category.`);
  const contactId = typeof input.contactId === 'number' && one(db, 'SELECT id FROM contacts WHERE id = ?', input.contactId)
    ? input.contactId
    : null;
  if (input.id) {
    run(db, 'UPDATE rules SET pattern = ?, kind = ?, category_id = ?, contact_id = ? WHERE id = ?',
      pattern, kind, cat.id, contactId, input.id);
    return input.id;
  }
  // Newer rules go first: they're usually more specific fixes.
  const sort = one<{ n: number }>(db, 'SELECT COALESCE(MIN(sort), 1) - 1 AS n FROM rules')!.n;
  return one<{ id: number }>(db,
    'INSERT INTO rules (pattern, kind, category_id, contact_id, sort) VALUES (?, ?, ?, ?, ?) RETURNING id',
    pattern, kind, cat.id, contactId, sort)!.id;
}

export function deleteRule(id: number) {
  run(getCompany().db, 'DELETE FROM rules WHERE id = ?', id);
  return true;
}

/** For each text, the first rule that matches it (by kind when given). */
export function matchRules(items: { text: string; kind?: 'income' | 'expense' }[]) {
  const rules = listRules() as any[];
  return items.map(({ text, kind }) => {
    const t = String(text ?? '').toLowerCase();
    const r = rules.find((r) => t.includes(String(r.pattern).toLowerCase()) && (!kind || r.kind === kind));
    return r ? { ruleId: r.id, pattern: r.pattern, categoryId: r.categoryId, kind: r.categoryKind, contactId: r.contactId } : null;
  });
}
