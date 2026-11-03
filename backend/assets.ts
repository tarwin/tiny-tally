// The asset register: equipment, vehicles and the like that last more than a
// year. Depreciation is worked out per income year (src/shared/depreciation.ts)
// and posted as one journal for the year, dated its last day, so it reaches
// the Profit & Loss, the balance sheet and the tax return lines like
// anything else:
//
//   year bought   the cost moves from an expense category to Business Assets
//                 (if it was booked as an expense and isn't written off at once)
//   each year     Depreciation (the business share) and Owner Drawings (the
//                 private share) against Accumulated depreciation
//   year sold     the cost, the depreciation and the sale money (recorded in
//                 Asset Sales when it was sold) come off; what's left is a
//                 gain, or a loss in Depreciation
//
// An asset written off at once that was booked as an expense needs nothing:
// the expense already is the deduction.
import { all, getBooks, one, run } from './db';
import { deleteEntry, saveEntry } from './entries';
import { deleteJournal, saveJournal } from './journals';
import { getSettings } from './settings';
import { auTaxYear } from '../src/shared/auTaxYears';
import { nzTaxYear } from '../src/shared/nzTaxYears';
import { depreciationYear, METHODS, type AssetIn, type Country, type Method } from '../src/shared/depreciation';
import { incomeYearOf, incomeYearRange } from '../src/shared/incomeYear';

/** US: the de minimis safe harbor, per item (no applicable financial statement). */
const US_DE_MINIMIS = 250_000;

export function writeOffLimit(country: Country, year: number) {
  if (country === 'AU') return auTaxYear(year).rules.instantWriteOff;
  if (country === 'NZ') return nzTaxYear(year).rules.lowValueAsset;
  return US_DE_MINIMIS;
}

// ---- categories the register posts to, made the first time they're needed ----

const LINES: Record<Country, { depreciation: string; gain: string | null }> = {
  AU: { depreciation: 'au-depreciation', gain: 'au-other-income' },
  NZ: { depreciation: 'nz-depreciation', gain: 'nz-other-income' },
  // A gain on business property goes on Form 4797, not Schedule C.
  US: { depreciation: 'depreciation', gain: 'form-4797' },
};

function category(name: string, kind: 'income' | 'expense', cls: string, taxCode: string | null, line: string | null) {
  const { db } = getBooks();
  const found = one<{ id: number }>(db, 'SELECT id FROM categories WHERE name = ? AND kind = ? ORDER BY is_archived, id LIMIT 1', name, kind);
  if (found) return found.id;
  return one<{ id: number }>(db,
    `INSERT INTO categories (name, kind, class, sort, tax_code, report_line)
     VALUES (?, ?, ?, (SELECT COALESCE(MAX(sort), 0) + 1 FROM categories), ?, ?) RETURNING id`,
    name, kind, cls, taxCode, line)!.id;
}

const country = () => getSettings().country as Country;
// Journal lines never reach the BAS or GST return; the code only matters for entries.
const notTax = () => 'NTR';

/** Where an asset's cost sits on the balance sheet. */
export function assetsCategory() {
  const c = country();
  if (c === 'US') {
    const us = one<{ id: number }>(getBooks().db, "SELECT id FROM categories WHERE class = 'asset' AND kind = 'expense' ORDER BY is_archived, id LIMIT 1");
    if (us) return us.id;
  }
  return category(c === 'US' ? 'Equipment & Assets' : 'Business Assets', 'expense', 'asset', c === 'AU' ? 'CAP' : c === 'NZ' ? 'GST' : 'NTR', null);
}
const depreciationCategory = () => category('Depreciation', 'expense', 'pnl', notTax(), LINES[country()].depreciation);
const gainCategory = () => category('Gain on Assets Sold', 'income', 'pnl', notTax(), LINES[country()].gain);
/** The money received for an asset, with GST where registered. Netted out again by the year's journal. */
const salesCategory = () => category('Asset Sales', 'income', 'pnl', country() === 'US' ? 'NON' : 'GST', LINES[country()].gain);
function drawingsCategory() {
  const { db } = getBooks();
  return one<{ id: number }>(db, "SELECT id FROM categories WHERE class = 'owner' AND kind = 'expense' ORDER BY name <> 'Owner Drawings', id LIMIT 1")?.id
    ?? category('Owner Drawings', 'expense', 'owner', 'NTR', null);
}

// ---- the register -------------------------------------------------------------

export interface AssetRow extends AssetIn {
  categoryId: number | null;
  categoryName: string | null;
  /** The cost was booked in a Profit & Loss category (an expense), not an asset one. */
  expensed: boolean;
  entryId: number | null;
  saleEntryId: number | null;
  notes: string | null;
}

export function listAssets(): AssetRow[] {
  return all<any>(getBooks().db,
    `SELECT a.id, a.name, a.bought, a.cost, a.business_pct AS businessPct, a.method, a.life_years AS lifeYears,
            a.rate_pct AS ratePct, a.opening_year AS openingYear, a.opening_value AS openingValue, a.sold, a.proceeds,
            a.category_id AS categoryId, c.name AS categoryName, COALESCE(c.class, '') = 'pnl' AS expensed,
            a.entry_id AS entryId, a.sale_entry_id AS saleEntryId, a.notes
     FROM assets a LEFT JOIN categories c ON c.id = a.category_id ORDER BY a.bought, a.id`)
    .map((r) => ({ ...r, expensed: !!r.expensed }));
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function saveAsset(p: {
  id?: number;
  name: string;
  bought: string;
  cost: number;
  businessPct?: number;
  method: Method;
  lifeYears?: number | null;
  ratePct?: number | null;
  openingYear?: number | null;
  openingValue?: number | null;
  categoryId?: number | null;
  entryId?: number | null;
  notes?: string | null;
}) {
  const { db } = getBooks();
  const c = country();
  const name = String(p.name ?? '').trim();
  if (!name) throw new Error('Give the asset a name.');
  if (!DATE.test(String(p.bought))) throw new Error('Pick the date it was bought.');
  const cost = Math.round(Number(p.cost));
  if (!(cost > 0)) throw new Error('Enter what it cost.');
  const method = METHODS[c].find((m) => m.value === p.method);
  if (!method) throw new Error('Pick how it’s depreciated.');
  const pct = p.businessPct == null ? 100 : Number(p.businessPct);
  if (!(pct >= 0 && pct <= 100)) throw new Error('Business use is a percent between 0 and 100.');
  const life = p.lifeYears == null || (p.lifeYears as any) === '' ? null : Number(p.lifeYears);
  const rate = p.ratePct == null || (p.ratePct as any) === '' ? null : Number(p.ratePct);
  if (method.needs === 'life' && !(life! > 0 && life! <= 100)) throw new Error('Enter its effective life in years.');
  if (method.needs === 'rate' && !(rate! > 0 && rate! <= 100)) throw new Error('Enter IRD’s depreciation rate for it.');
  const year = incomeYearOf(p.bought, getSettings().fiscalYearStart);
  if (p.method === 'writeoff' && cost >= writeOffLimit(c, year)) {
    throw new Error(c === 'AU'
      ? `The instant asset write-off is for assets under ${(writeOffLimit(c, year) / 100).toLocaleString()} dollars. Use the small business pool.`
      : `Low-value assets are under ${(writeOffLimit(c, year) / 100).toLocaleString()} dollars. Use IRD’s rate for it.`);
  }
  const openingYear = p.openingYear ? Number(p.openingYear) : null;
  const openingValue = openingYear ? Math.round(Number(p.openingValue ?? cost)) : null;
  if (openingYear && (openingYear < year || !(openingValue! >= 0) || openingValue! > cost)) {
    throw new Error('The value brought in is for a year after it was bought, and no more than it cost.');
  }
  const args = [name, p.categoryId ?? null, p.entryId ?? null, p.bought, cost, pct, p.method,
    method.needs === 'life' ? life : null, method.needs === 'rate' ? rate : null, openingYear, openingValue, String(p.notes ?? '').trim() || null];
  if (p.id) {
    if (!one(db, 'SELECT id FROM assets WHERE id = ?', p.id)) throw new Error('That asset no longer exists.');
    run(db, `UPDATE assets SET name = ?, category_id = ?, entry_id = ?, bought = ?, cost = ?, business_pct = ?, method = ?,
             life_years = ?, rate_pct = ?, opening_year = ?, opening_value = ?, notes = ? WHERE id = ?`, ...args, p.id);
    return p.id;
  }
  return one<{ id: number }>(db,
    `INSERT INTO assets (name, category_id, entry_id, bought, cost, business_pct, method, life_years, rate_pct, opening_year, opening_value, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`, ...args)!.id;
}

export function deleteAsset(id: number) {
  const { db } = getBooks();
  const a = one<any>(db, 'SELECT sale_entry_id FROM assets WHERE id = ?', id);
  if (!a) return true;
  if (a.sale_entry_id) deleteEntry(a.sale_entry_id);
  run(db, 'DELETE FROM assets WHERE id = ?', id);
  return true;
}

/**
 * Sold or scrapped. With money received, it's recorded in Asset Sales (with
 * GST where registered) to the account it went into; the register takes the
 * price before GST. `date: null` undoes it.
 */
export function sellAsset(p: { id: number; date: string | null; amount?: number; accountId?: number | null }) {
  const { db } = getBooks();
  const a = one<any>(db, 'SELECT * FROM assets WHERE id = ?', p.id);
  if (!a) throw new Error('That asset no longer exists.');
  db.transaction(() => {
    if (a.sale_entry_id) deleteEntry(a.sale_entry_id);
    if (!p.date) {
      run(db, 'UPDATE assets SET sold = NULL, proceeds = NULL, sale_entry_id = NULL WHERE id = ?', p.id);
      return;
    }
    if (!DATE.test(p.date)) throw new Error('Pick the date it went.');
    if (p.date < a.bought) throw new Error('That’s before it was bought.');
    const amount = Math.round(Number(p.amount) || 0);
    let entryId: number | null = null;
    let proceeds = 0;
    if (amount > 0) {
      if (!p.accountId) throw new Error('Pick the account the money went into.');
      entryId = saveEntry({ date: p.date, kind: 'income', amount, accountId: p.accountId, categoryId: salesCategory(), memo: `Sold: ${a.name}` });
      const e = one<{ amount: number; tax_amount: number | null }>(db, 'SELECT amount, tax_amount FROM entries WHERE id = ?', entryId)!;
      proceeds = e.amount - (getSettings().taxEnabled && country() !== 'US' ? (e.tax_amount ?? 0) : 0);
    }
    run(db, 'UPDATE assets SET sold = ?, proceeds = ?, sale_entry_id = ? WHERE id = ?', p.date, proceeds, entryId, p.id);
  })();
  return true;
}

// ---- a year's depreciation ------------------------------------------------------

function postedJournals(): Record<string, number> {
  const raw = one<{ value: string }>(getBooks().db, "SELECT value FROM meta WHERE key = 'depreciation_journals'")?.value;
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
function setPosted(map: Record<string, number>) {
  run(getBooks().db, "INSERT OR REPLACE INTO meta (key, value) VALUES ('depreciation_journals', ?)", JSON.stringify(map));
}

/** The journal lines for income year `year`, worked out from the register. */
function journalLines(rows: ReturnType<typeof depreciationYear>, assets: AssetRow[]) {
  const lines: { account: string; amount: number; memo: string }[] = [];
  const cat = (id: number) => `cat:${id}`;
  const byId = new Map(assets.map((a) => [a.id, a]));
  const assetsCat = () => assetsCategory();
  for (const r of rows) {
    const a = byId.get(r.id)!;
    const instant = a.method === 'writeoff' || a.method === 'expense';
    // Booked as an expense and written off at once: the expense is the deduction already.
    if (a.expensed && instant) continue;
    // Brought in with a value: its cost isn't in these books, only its depreciation from here.
    const inBooks = a.openingYear == null;
    if (r.isNew && a.expensed && a.categoryId) {
      lines.push({ account: cat(assetsCat()), amount: a.cost, memo: `${a.name}: bought` });
      lines.push({ account: cat(a.categoryId), amount: -a.cost, memo: `${a.name}: to the asset register` });
    }
    if (r.depreciation) {
      lines.push({ account: cat(depreciationCategory()), amount: r.claimed, memo: a.name });
      if (r.depreciation - r.claimed) lines.push({ account: cat(drawingsCategory()), amount: r.depreciation - r.claimed, memo: `${a.name}: private use` });
      lines.push({ account: 'accumdep', amount: -r.depreciation, memo: a.name });
    }
    if (r.disposal && inBooks) {
      const d = r.disposal;
      // Take the cost and its depreciation off, and the sale money back out of Asset Sales.
      const accumulated = a.cost - d.value;
      if (accumulated) lines.push({ account: 'accumdep', amount: accumulated, memo: `${a.name}: sold` });
      lines.push({ account: cat(a.expensed || !a.categoryId ? assetsCat() : a.categoryId), amount: -a.cost, memo: `${a.name}: sold` });
      if (d.proceeds) lines.push({ account: cat(salesCategory()), amount: d.proceeds, memo: `${a.name}: sold` });
      // What's left balances it: a loss (debit) or a gain (credit), private share to drawings.
      const left = a.cost - accumulated - d.proceeds;
      const business = Math.round(left * (a.businessPct / 100));
      if (left > 0) {
        lines.push({ account: cat(depreciationCategory()), amount: business, memo: `${a.name}: loss on sale` });
      } else if (left < 0) {
        lines.push({ account: cat(gainCategory()), amount: business, memo: `${a.name}: gain on sale` });
      }
      if (left - business) lines.push({ account: cat(drawingsCategory()), amount: left - business, memo: `${a.name}: private use` });
    }
  }
  // Same account and memo together.
  const merged = new Map<string, { account: string; amount: number; memo: string }>();
  for (const l of lines) {
    const k = `${l.account}|${l.memo}`;
    const m = merged.get(k);
    if (m) m.amount += l.amount;
    else merged.set(k, { ...l });
  }
  return [...merged.values()].filter((l) => l.amount !== 0);
}

function computeYear(year: number) {
  const s = getSettings();
  const c = s.country as Country;
  const assets = listAssets();
  const rows = assets.length ? depreciationYear(c, assets, year, s.fiscalYearStart, (y) => ({ writeOff: writeOffLimit(c, y) })) : [];
  return { assets, rows };
}

/** The register for income year `year`: each asset's figures, totals, and whether the journal is posted and up to date. */
export function assetRegister(year: number) {
  const s = getSettings();
  const c = s.country as Country;
  const { from, to } = incomeYearRange(year, s.fiscalYearStart);
  const { assets, rows } = computeYear(year);
  const byId = new Map(assets.map((a) => [a.id, a]));
  const posted = postedJournals()[String(year)] ?? null;
  const want = journalLines(rows, assets);
  let journal: null | { id: number; upToDate: boolean } = null;
  if (posted) {
    const have = all<{ category_id: number | null; system: string | null; amount: number; memo: string | null }>(getBooks().db,
      'SELECT category_id, system, amount, memo FROM journal_lines WHERE journal_id = ? ORDER BY sort, id', posted);
    const key = (l: { account: string; amount: number; memo: string }) => `${l.account}|${l.amount}|${l.memo}`;
    const same = have.length === want.length
      && have.map((h) => key({ account: h.system ?? `cat:${h.category_id}`, amount: h.amount, memo: h.memo ?? '' })).sort().join()
        === want.map(key).sort().join();
    journal = have.length ? { id: posted, upToDate: same } : null;
  }
  // Earlier years with depreciation that were never posted.
  const postedYears = postedJournals();
  const first = assets.length ? Math.min(...assets.map((a) => a.openingYear ?? incomeYearOf(a.bought, s.fiscalYearStart))) : year;
  const unposted: number[] = [];
  for (let y = first; y < year; y++) {
    if (postedYears[String(y)]) continue;
    const r = computeYear(y);
    if (journalLines(r.rows, r.assets).length) unposted.push(y);
  }
  // Bought this year in an asset category, or over the limit in Equipment, and not in the register.
  const linked = new Set(assets.map((a) => a.entryId).filter(Boolean));
  const purchases = all<any>(getBooks().db,
    `SELECT e.id AS entryId, e.date, e.amount, COALESCE(e.tax_amount, 0) AS tax, e.memo, c.id AS categoryId, c.name AS category, c.class AS categoryClass, ct.name AS contact
     FROM entries e JOIN categories c ON c.id = e.category_id LEFT JOIN contacts ct ON ct.id = e.contact_id
     WHERE e.kind = 'expense' AND e.date BETWEEN ? AND ?
       AND (c.class = 'asset' OR c.name IN ('Equipment', 'Small Equipment', 'Equipment & Assets'))
     ORDER BY e.date`, from, to)
    .filter((e) => !linked.has(e.entryId))
    .map((e) => ({ ...e, cost: s.taxEnabled && c !== 'US' ? e.amount - e.tax : e.amount }))
    // Booked as an expense and under the limit: already written off, nothing to add.
    .filter((e) => e.categoryClass === 'asset' || e.cost >= writeOffLimit(c, year));
  const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((t, r) => t + f(r), 0);
  return {
    year, from, to, country: c,
    limit: writeOffLimit(c, year),
    rows: rows.map((r) => ({ ...r, asset: byId.get(r.id)! })),
    // Fully depreciated or sold in an earlier year: listed, without figures.
    others: assets.filter((a) => !rows.some((r) => r.id === a.id) && (a.openingYear ?? incomeYearOf(a.bought, s.fiscalYearStart)) <= year),
    totals: {
      depreciation: sum((r) => r.depreciation),
      claimed: sum((r) => r.claimed),
      closing: sum((r) => r.closing),
      adjustment: sum((r) => r.disposal?.claimed ?? 0),
    },
    journal,
    journalLines: want.length,
    unposted,
    purchases,
  };
}

/** Posts (or updates) the year's depreciation journal, dated the year's last day. */
export function postDepreciation(year: number) {
  const s = getSettings();
  const { to } = incomeYearRange(year, s.fiscalYearStart);
  const { assets, rows } = computeYear(year);
  const lines = journalLines(rows, assets);
  const map = postedJournals();
  const existing = map[String(year)];
  const exists = existing && one(getBooks().db, 'SELECT id FROM journals WHERE id = ?', existing);
  if (!lines.length) {
    if (exists) deleteJournal(existing);
    delete map[String(year)];
    setPosted(map);
    return null;
  }
  const id = saveJournal({
    id: exists ? existing : undefined,
    date: to,
    reference: `Depreciation ${year}`,
    memo: 'From the asset register',
    lines,
  } as any);
  map[String(year)] = id;
  setPosted(map);
  return id;
}
