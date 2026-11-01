// Products and services: saved lines for invoices (things you sell) and
// bills (things you buy). A document line copies what it takes from an item.
import { all, getBooks, one, run } from './db';
import { getSettings } from './settings';
import { countryProfile } from '../src/shared/countries';
import { isTaxCode, taxCodeOr } from '../src/shared/tax';

export interface ItemInput {
  id?: number;
  kind: 'income' | 'expense';
  name: string;
  /** The line's text on a document; blank uses the name. */
  description?: string | null;
  /** cents */
  unitPrice: number;
  priceIncludesTax: boolean;
  categoryId?: number | null;
  taxCode?: string | null;
}

export function listItems() {
  return all(getBooks().db,
    `SELECT i.id, i.kind, i.name, i.description, i.unit_price AS unitPrice, i.price_includes_tax AS priceIncludesTax,
            i.category_id AS categoryId, c.name AS categoryName, i.tax_code AS taxCode, i.is_archived AS archived
     FROM items i LEFT JOIN categories c ON c.id = i.category_id
     ORDER BY i.is_archived, i.name COLLATE NOCASE`,
  ).map((r: any) => ({ ...r, priceIncludesTax: !!r.priceIncludesTax, archived: !!r.archived }));
}

export function saveItem(input: ItemInput) {
  const { db } = getBooks();
  if (input.kind !== 'income' && input.kind !== 'expense') throw new Error('Choose whether you sell or buy it.');
  const name = String(input.name ?? '').trim().slice(0, 200);
  if (!name) throw new Error('Give it a name.');
  const description = String(input.description ?? '').trim() || null;
  const unitPrice = Math.round(Number(input.unitPrice));
  if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new Error("The price can't be negative.");
  let categoryId: number | null = null;
  if (typeof input.categoryId === 'number') {
    const cat = one<any>(db, 'SELECT id, kind FROM categories WHERE id = ?', input.categoryId);
    if (!cat) throw new Error('That category no longer exists.');
    if (cat.kind !== input.kind) throw new Error(`Choose ${input.kind === 'income' ? 'an income' : 'an expense'} category.`);
    categoryId = cat.id;
  }
  const settings = getSettings();
  const taxCode = settings.taxEnabled && isTaxCode(input.taxCode)
    ? taxCodeOr(countryProfile(settings.country).tax, input.kind, input.taxCode)
    : null;
  const fields = [input.kind, name, description, unitPrice, input.priceIncludesTax ? 1 : 0, categoryId, taxCode];
  if (input.id) {
    run(db,
      `UPDATE items SET kind = ?, name = ?, description = ?, unit_price = ?, price_includes_tax = ?, category_id = ?, tax_code = ?
       WHERE id = ?`, ...fields, input.id);
    return input.id;
  }
  return one<{ id: number }>(db,
    `INSERT INTO items (kind, name, description, unit_price, price_includes_tax, category_id, tax_code)
     VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`, ...fields)!.id;
}

export function archiveItem(id: number, archived: boolean) {
  run(getBooks().db, 'UPDATE items SET is_archived = ? WHERE id = ?', archived ? 1 : 0, id);
  return true;
}

/** Documents keep their own copy of each line, so nothing else changes. */
export function deleteItem(id: number) {
  run(getBooks().db, 'DELETE FROM items WHERE id = ?', id);
  return true;
}
