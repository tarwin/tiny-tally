// QuickBooks Desktop / Reckon Accounts portable company files (.QBM). No
// published spec; worked out from real files and checked against the balances
// those files store. The layers, outside in:
//
//   1. An OLE compound file (the old Microsoft Office container).
//   2. Each stream is PKWARE DCL "implode" compressed. No password or encryption.
//   3. `reload.sql` is a SQL Anywhere dbunload script, and each N.dat holds one
//      table's rows. LOAD TABLE statements say which table and columns.
//
// Rows become the same shapes an IIF file gives, so the rest is parseLedger's.
import { parseAmount } from './parse';
import { parseLedger, type IifParse, type LedgerRow, type LedgerSource } from './iif';
import type { TaxMode } from './split';

// ---- 1. compound file ------------------------------------------------------------

const END_OF_CHAIN = 0xfffffffa; // this and above: free, end, FAT and DIFAT markers

/** The streams in an OLE compound file, by name. */
export function readCompoundFile(bytes: Uint8Array): Map<string, Uint8Array> {
  if (bytes.length < 512 || bytes[0] !== 0xd0 || bytes[1] !== 0xcf || bytes[2] !== 0x11 || bytes[3] !== 0xe0) {
    throw new Error("This isn't a portable company file.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u32 = (at: number) => view.getUint32(at, true);
  const sectorSize = 1 << view.getUint16(30, true);
  const miniSize = 1 << view.getUint16(32, true);
  const offset = (i: number) => (i + 1) * sectorSize;
  const perSector = sectorSize / 4;

  const fatSectors: number[] = [];
  for (let i = 0; i < 109; i++) fatSectors.push(u32(76 + i * 4));
  for (let s = u32(68), hops = 0; s < END_OF_CHAIN; hops++) {
    if (hops > bytes.length / sectorSize) throw new Error('This portable company file is damaged.');
    for (let i = 0; i < perSector - 1; i++) fatSectors.push(u32(offset(s) + i * 4));
    s = u32(offset(s) + (perSector - 1) * 4);
  }
  const fat: number[] = [];
  for (const f of fatSectors) {
    if (f >= END_OF_CHAIN) continue;
    for (let i = 0; i < perSector; i++) fat.push(u32(offset(f) + i * 4));
  }
  const chain = (start: number, table: number[]) => {
    const out: number[] = [];
    for (let s = start; s < END_OF_CHAIN; s = table[s]) {
      if (s >= table.length || out.length > table.length) throw new Error('This portable company file is damaged.');
      out.push(s);
    }
    return out;
  };
  // Every sector belongs to one stream, so honest copying adds up to the file's
  // size. Entries sharing a long chain would otherwise multiply it.
  let copied = 0;
  const spend = (n: number) => {
    copied += n;
    if (copied > bytes.length * 2) throw new Error('This portable company file is damaged.');
  };
  const regular = (start: number) => {
    const sectors = chain(start, fat);
    spend(sectors.length * sectorSize);
    const out = new Uint8Array(sectors.length * sectorSize);
    sectors.forEach((s, i) => out.set(bytes.subarray(offset(s), offset(s) + sectorSize), i * sectorSize));
    return out;
  };

  const cutoff = u32(56);
  const miniFatBytes = u32(64) < END_OF_CHAIN ? regular(u32(60) < END_OF_CHAIN ? u32(60) : END_OF_CHAIN) : new Uint8Array(0);
  const miniView = new DataView(miniFatBytes.buffer);
  const miniFat: number[] = [];
  for (let i = 0; i + 4 <= miniFatBytes.length; i += 4) miniFat.push(miniView.getUint32(i, true));

  const dir = regular(u32(48));
  const dirView = new DataView(dir.buffer);
  const decoder = new TextDecoder('utf-16le');
  const entries: { name: string; type: number; start: number; size: number }[] = [];
  for (let at = 0; at + 128 <= dir.length; at += 128) {
    const nameLength = dirView.getUint16(at + 64, true);
    if (nameLength < 2) continue;
    entries.push({
      name: decoder.decode(dir.subarray(at, at + nameLength - 2)),
      type: dir[at + 66],
      start: dirView.getUint32(at + 116, true),
      size: dirView.getUint32(at + 120, true),
    });
  }
  const root = entries.find((e) => e.type === 5);
  const mini = root && root.start < END_OF_CHAIN ? regular(root.start) : new Uint8Array(0);

  const streams = new Map<string, Uint8Array>();
  for (const e of entries) {
    if (e.type !== 2) continue;
    if (e.size >= cutoff) {
      streams.set(e.name, regular(e.start).subarray(0, e.size));
      continue;
    }
    const sectors = e.size ? chain(e.start, miniFat) : [];
    spend(sectors.length * miniSize);
    const out = new Uint8Array(sectors.length * miniSize);
    sectors.forEach((s, i) => out.set(mini.subarray(s * miniSize, (s + 1) * miniSize), i * miniSize));
    streams.set(e.name, out.subarray(0, e.size));
  }
  return streams;
}

// ---- 2. PKWARE DCL implode, after zlib's contrib/blast ----------------------------

function huffman(compact: number[]) {
  const lengths: number[] = [];
  for (const b of compact) for (let n = (b >> 4) + 1; n > 0; n--) lengths.push(b & 15);
  const count = new Array<number>(14).fill(0);
  for (const l of lengths) count[l]++;
  const offsets = new Array<number>(15).fill(0);
  for (let i = 1; i < 14; i++) offsets[i + 1] = offsets[i] + count[i];
  const symbol = new Array<number>(lengths.length).fill(0);
  lengths.forEach((l, s) => {
    if (l) symbol[offsets[l]++] = s;
  });
  return { count, symbol };
}
const LENGTH_CODE = huffman([2, 35, 36, 53, 38, 23]);
const DISTANCE_CODE = huffman([2, 20, 53, 230, 247, 151, 248]);
const LENGTH_BASE = [3, 2, 4, 5, 6, 7, 8, 9, 10, 12, 16, 24, 40, 72, 136, 264];
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8];

/** Far more than any real company file expands to. */
const MAX_DECODED = 1024 ** 3;

export function implodeDecode(input: Uint8Array, limit = MAX_DECODED): Uint8Array {
  const dictionaryBits = input[1];
  // Binary mode only: every stream seen is, and the literal table isn't needed.
  if (input[0] !== 0 || dictionaryBits < 4 || dictionaryBits > 6) throw new Error('This portable company file uses a format Tiny Tally doesn’t know.');
  const damaged = () => new Error('This portable company file is damaged.');
  let pos = 2;
  let buffer = 0;
  let held = 0;
  const bits = (n: number) => {
    while (held < n) {
      if (pos >= input.length) throw damaged();
      buffer |= input[pos++] << held;
      held += 8;
    }
    const value = buffer & ((1 << n) - 1);
    buffer >>>= n;
    held -= n;
    return value;
  };
  const decode = (h: { count: number[]; symbol: number[] }) => {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let l = 1; l < 14; l++) {
      code |= bits(1) ^ 1;
      const c = h.count[l];
      if (code < first + c) return h.symbol[index + code - first];
      index += c;
      first = (first + c) << 1;
      code <<= 1;
    }
    throw damaged();
  };

  let out = new Uint8Array(Math.min(limit, Math.max(1024, input.length * 4)));
  let size = 0;
  const room = (n: number) => {
    if (size + n <= out.length) return;
    if (size + n > limit) throw new Error('This portable company file is too big to read.');
    const bigger = new Uint8Array(Math.min(limit, Math.max(out.length * 2, size + n)));
    bigger.set(out.subarray(0, size));
    out = bigger;
  };
  for (;;) {
    if (!bits(1)) {
      room(1);
      out[size++] = bits(8);
      continue;
    }
    const symbol = decode(LENGTH_CODE);
    const length = LENGTH_BASE[symbol] + bits(LENGTH_EXTRA[symbol]);
    if (length === 519) return out.subarray(0, size);
    const shift = length === 2 ? 2 : dictionaryBits;
    const distance = (decode(DISTANCE_CODE) << shift) + bits(shift) + 1;
    if (distance > size) throw damaged();
    room(length);
    for (let i = 0; i < length; i++, size++) out[size] = out[size - distance];
  }
}

// ---- 3. dbunload rows -------------------------------------------------------------

const windows1252 = new TextDecoder('windows-1252');

/** Comma separated; 'strings' with \xHH and \\ escapes; empty means NULL, read as ''. */
export function parseUnload(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  const n = text.length;
  let i = 0;
  while (i < n) {
    if (text[i] === "'") {
      let value = '';
      let from = ++i;
      for (; i < n; i++) {
        const c = text[i];
        if (c === '\\') {
          value += text.slice(from, i);
          if (text[i + 1] === 'x') {
            value += windows1252.decode(Uint8Array.of(parseInt(text.slice(i + 2, i + 4), 16)));
            i += 3;
          } else {
            value += text[i + 1] ?? '';
            i += 1;
          }
          from = i + 1;
        } else if (c === "'") {
          if (text[i + 1] === "'") {
            value += text.slice(from, i + 1);
            i += 1;
            from = i + 1;
          } else break;
        }
      }
      row.push(value + text.slice(from, i));
      i++; // the closing quote
    } else {
      let end = i;
      while (end < n && text[end] !== ',' && text[end] !== '\r' && text[end] !== '\n') end++;
      row.push(text.slice(i, end));
      i = end;
    }
    if (text[i] === ',') {
      i++;
      if (i >= n || text[i] === '\r' || text[i] === '\n') row.push('');
      if (i < n && text[i] !== '\r' && text[i] !== '\n') continue;
    }
    while (text[i] === '\r' || text[i] === '\n') i++;
    rows.push(row);
    row = [];
  }
  return rows;
}

// ---- company file -> ledger -------------------------------------------------------

/** QuickBooks' own account list order. 4, 6, 8, 11 and 15 are inferred from it, not yet seen in a real file. */
const ACCOUNT_TYPES = ['BANK', 'AR', 'OCASSET', 'FIXASSET', 'OASSET', 'AP', 'CCARD', 'OCLIAB', 'LTLIAB', 'EQUITY', 'INC', 'COGS', 'EXP', 'EXINC', 'EXEXP', 'NONPOSTING', 'SUSPENSE'];
/** Audit history, and forms that never post to the books. */
const NOT_POSTED = /^abmc_(audit|estimate|purchase_order|sales_order)_/;

/** Reckon's Australian tax codes, in Tiny Tally's terms. */
const TAX_CODE_NAMES: Record<string, string> = {
  GST: 'GST', NCG: 'GST', ADJ: 'GST', WGST: 'GST', CDG: 'GST',
  CAG: 'CAP',
  FRE: 'FRE', NCF: 'FRE', CAF: 'FRE',
  EXP: 'EXP',
  INP: 'INP', NCI: 'INP', CAI: 'INP',
};
const DOCUMENT_TABLES: Record<string, { docType: 'invoice' | 'bill' | 'credit'; side: 1 | -1 }> = {
  // Income lines are credits (negative) on an invoice; expense lines debits on a bill; a credit note reverses a sale.
  abmc_invoice_lineitem: { docType: 'invoice', side: -1 },
  abmc_bill_lineitem: { docType: 'bill', side: 1 },
  abmc_credit_memo_lineitem: { docType: 'credit', side: 1 },
};
/** Which link type joins a payment to what it pays, and the side of the payment's line. */
const PAYMENT_LINKS: Record<string, { table: string; kind: 'income' | 'expense' }> = {
  '4': { table: 'abmc_received_payment_lineitem', kind: 'income' },
  '6': { table: 'abmc_bill_check_lineitem', kind: 'expense' },
};

export function parseQbm(bytes: Uint8Array, taxMode: TaxMode = 'merge'): IifParse {
  const streams = readCompoundFile(bytes);
  // Shared across streams, since a small file can expand enormously, and more than once.
  let budget = MAX_DECODED;
  const stream = (name: string) => {
    const s = streams.get(name);
    if (!s) return null;
    const out = implodeDecode(s, budget);
    budget -= out.length;
    return out;
  };
  const header = stream('header');
  const script = stream('reload.sql');
  if (!header || !script || windows1252.decode(header.subarray(0, 8)) !== 'PORTFILE') throw new Error("This isn't a portable company file.");
  const sql = windows1252.decode(script);

  const tables = new Map<string, { file: string; columns: string[] }>();
  for (const m of sql.matchAll(/LOAD TABLE\s+"\w+"\."(\w+)"\s*\(([^)]*)\)\s*FROM\s+'[^']*?([\w.]+\.dat)'/g)) {
    tables.set(m[1], { file: m[3], columns: m[2].split(',').map((c) => c.trim().replace(/"/g, '')) });
  }
  const load = (name: string): Record<string, string>[] => {
    const t = tables.get(name);
    const raw = t && stream(t.file);
    if (!t || !raw) return [];
    return parseUnload(windows1252.decode(raw)).map((cells) => {
      const row: Record<string, string> = {};
      t.columns.forEach((c, i) => (row[c] = cells[i] ?? ''));
      return row;
    });
  };
  if (!tables.has('abmc_account_user')) throw new Error('This portable company file uses a format Tiny Tally doesn’t know.');

  // ---- accounts ----
  const accountRows = load('abmc_account_user');
  const accountById = new Map(accountRows.map((a) => [a.account_id, a]));
  const fullName = (id: string) => {
    const parts: string[] = [];
    for (let a = accountById.get(id); a && parts.length < 16; a = accountById.get(a.parent_id)) parts.unshift(a.name);
    return parts.join(':');
  };
  const accnt: LedgerRow[] = accountRows.map((a) => ({
    NAME: fullName(a.account_id),
    ACCNTTYPE: ACCOUNT_TYPES[Number(a.type || 0)] ?? '',
    // The lines below are the whole history, so accounts start from nothing.
    OBAMOUNT: '',
  }));

  // ---- contacts ----
  const details = new Map<string, Record<string, string>>();
  for (const c of load('abmc_contacts')) if (!details.has(c.name_id) || !c.expired_date) details.set(c.name_id, c);
  const person = (name: string, id: string): LedgerRow => {
    const c = details.get(id);
    return {
      NAME: name,
      EMAIL: c?.email ?? '',
      PHONE1: c?.telephone_num1 ?? '',
      ADDR1: c?.address_line1 ?? '',
      ADDR2: c?.address_line2 ?? '',
      ADDR3: c?.address_line3 ?? '',
      ADDR4: c?.address_line4 ?? '',
      ADDR5: c?.address_line5 ?? '',
    };
  };
  const names = { customer: new Map<string, string>(), vendor: new Map<string, string>(), other: new Map<string, string>() };
  const people: { kind: 'customer' | 'vendor'; row: LedgerRow }[] = [];
  const addPeople = (table: string, idColumn: string, from: Map<string, string>, kind: 'customer' | 'vendor') => {
    for (const p of load(table)) {
      if (!p.name) continue;
      from.set(p[idColumn], p.name);
      if (p.is_deleted_bool !== '1') people.push({ kind, row: person(p.name, p[idColumn]) });
    }
  };
  addPeople('abmc_customer_user', 'customer_id', names.customer, 'customer');
  addPeople('abmc_vendor_user', 'vendor_id', names.vendor, 'vendor');
  addPeople('abmc_other_user', 'other_id', names.other, 'vendor');
  const nameOf = (r: Record<string, string> | undefined) =>
    (r && (names.vendor.get(r.vendor_id) || names.customer.get(r.customer_id) || names.other.get(r.other_id))) || '';

  // ---- transactions ----
  const taxCodeNames = new Map(load('rkn_taxcodes').map((t) => [t.TaxCodeId, t.TaxCodeName]));
  const taxCodeOf = (line: Record<string, string>, tax: number) => {
    const named = TAX_CODE_NAMES[taxCodeNames.get(line.tax_code_id || line.sales_tax_code_id) ?? ''];
    if (tax) return named && named !== 'FRE' && named !== 'INP' && named !== 'EXP' ? named : 'GST';
    // No code means it was left off the return. A taxable code with no tax on it reads as free.
    return !named ? 'NTR' : named === 'GST' || named === 'CAP' ? 'FRE' : named;
  };
  const itemNames = new Map(load('abmc_item_user').map((i) => [i.item_id, i.name]));
  type Txn = { id: string; table: string; date: string; lines: Record<string, string>[]; head?: Record<string, string> };
  const txns = new Map<string, Txn>();
  const sums = new Map<string, number>();
  let unreadable = 0;
  for (const [table, info] of tables) {
    if (!/_lineitem$/.test(table) || NOT_POSTED.test(table)) continue;
    const rows = load(table);
    if (!rows.length) continue;
    if (!info.columns.includes('amount_amt') || !info.columns.includes('account_id')) {
      unreadable += rows.length;
      continue;
    }
    const heads = new Map(load(table.replace(/_lineitem$/, '_header')).map((h) => [h.transaction_id, h]));
    for (const line of rows) {
      const head = heads.get(line.transaction_id);
      if (head?.is_memorized_transaction_bool === '1') continue;
      sums.set(line.account_id, (sums.get(line.account_id) ?? 0) + (parseAmount(line.amount_amt) ?? 0));
      let txn = txns.get(line.transaction_id);
      if (!txn) {
        txn = { id: line.transaction_id, table, date: line.transaction_date.slice(0, 10), lines: [], head };
        txns.set(line.transaction_id, txn);
      }
      txn.lines.push(line);
    }
  }
  const money = (v: string | undefined) => parseAmount(v ?? '') ?? 0;

  // ---- invoices, bills and credit notes ----
  const documents: NonNullable<LedgerSource['documents']> = [];
  const documentIds = new Set<string>();
  let notDocuments = 0;
  for (const t of txns.values()) {
    const kind = DOCUMENT_TABLES[t.table];
    if (!kind) continue;
    const total = Math.abs(money(t.lines.find((l) => l.is_source_bool === '1')?.amount_amt));
    const contact = nameOf(t.head);
    const lines: NonNullable<LedgerSource['documents']>[number]['lines'] = [];
    let pending: string[] = [];
    for (const l of t.lines) {
      if (l.is_source_bool === '1' || l.is_trans_tax_bool === '1') continue;
      if (!l.account_id) {
        if (l.memo) pending.push(l.memo); // a line of words, which the next line carries
        continue;
      }
      const net = kind.side * money(l.amount_amt);
      const tax = kind.side * money(l.tax_amount_amt);
      if (!net && !tax && !l.memo && !pending.length) continue;
      const includesTax = t.head?.is_amt_incl_tax_bool === '1';
      const price = includesTax ? net + tax : net;
      const qty = Math.round(Math.abs(Number(l.quantity_qnty || 0)) * 1000) || 1000;
      const unit = Math.round((price * 1000) / qty);
      const exact = Math.round((unit * qty) / 1000) === price;
      lines.push({
        accnt: fullName(l.account_id),
        description: [...pending, l.memo || itemNames.get(l.item_id) || ''].filter(Boolean).join('\n'),
        qtyMilli: exact ? qty : 1000,
        unitPrice: exact ? unit : price,
        net,
        tax,
        taxCode: taxCodeOf(l, tax),
      });
      pending = [];
    }
    if (pending.length && lines.length) lines[lines.length - 1].description += `\n${pending.join('\n')}`;
    const sum = lines.reduce((n, l) => n + l.net + l.tax, 0);
    // Only exact documents come across: anything else stays as ledger lines.
    if (!total || !contact || !lines.length || sum !== total) {
      notDocuments++;
      continue;
    }
    const due = t.head?.due_date?.slice(0, 10) ?? '';
    documentIds.add(t.id);
    documents.push({
      ref: `qbm:${t.id}`,
      docType: kind.docType,
      number: t.head?.doc_num || `QB-${t.id}`,
      contactName: contact,
      issueDate: t.date,
      dueDate: due >= t.date ? due : t.date,
      pricesIncludeTax: t.head?.is_amt_incl_tax_bool === '1',
      notes: t.head?.memo || undefined,
      lines,
    });
  }

  // ---- payments on them ----
  const allocations = new Map<string, Map<string, number>>();
  for (const link of load('abmc_transaction_link')) {
    if (link.is_t1_source_bool !== '1' || !PAYMENT_LINKS[link.link_type] || !documentIds.has(link.transaction_2_id)) continue;
    if (txns.get(link.transaction_id)?.table !== PAYMENT_LINKS[link.link_type].table) continue;
    const to = allocations.get(link.transaction_id) ?? new Map<string, number>();
    to.set(link.transaction_2_id, (to.get(link.transaction_2_id) ?? 0) + Math.abs(money(link.amount_amt)));
    allocations.set(link.transaction_id, to);
  }
  const typeOfAccount = (id: string) => ACCOUNT_TYPES[Number(accountById.get(id)?.type || 0)];
  const payments: NonNullable<LedgerSource['payments']> = [];
  /** What's left of a payment after its documents, by transaction: all of it unless allocated. */
  const unallocated = new Map<string, number>();
  for (const [id, to] of allocations) {
    const t = txns.get(id)!;
    const control = t.lines.filter((l) => typeOfAccount(l.account_id) === 'AR' || typeOfAccount(l.account_id) === 'AP');
    const others = t.lines.filter((l) => l.account_id && !control.includes(l));
    const paying = PAYMENT_LINKS[t.table === 'abmc_received_payment_lineitem' ? '4' : '6'].kind;
    const moved = money(others[0]?.amount_amt);
    const allocated = [...to.values()].reduce((a, b) => a + b, 0);
    // Only the plain shape: one money line, the right way round, covering what's allocated.
    if (others.length !== 1 || (paying === 'income' ? moved <= 0 : moved >= 0) || allocated > Math.abs(moved)) continue;
    for (const [documentId, amount] of to) {
      if (!amount) continue;
      payments.push({
        ref: `qbm:${id}:${documentId}`,
        date: t.date,
        kind: paying,
        amount,
        accnt: fullName(others[0].account_id),
        memo: others[0].memo || t.head?.memo || undefined,
        documentRef: `qbm:${documentId}`,
        contactName: nameOf(t.head),
      });
    }
    unallocated.set(id, Math.abs(moved) - allocated);
  }

  // ---- everything else, as ledger lines ----
  const ordered = [...txns.values()]
    .filter((t) => !documentIds.has(t.id) && unallocated.get(t.id) !== 0)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : Number(a.id) - Number(b.id)));
  const blocks = ordered.map((t) => {
    const left = unallocated.get(t.id);
    // A payment partly on documents: the rest of it stays as an ordinary line pair.
    const lines: Record<string, string>[] = left === undefined ? t.lines : t.lines.filter((l) => l.account_id).map((l) => {
      const sign = Math.sign(money(l.amount_amt)) || 1;
      return { ...l, amount_amt: String((sign * left) / 100) };
    });
    return lines.map((line, i): LedgerRow => {
      const tax = money(line.tax_amount_amt);
      return {
        TRNSID: `qbm:${t.id}`,
        TRNSTYPE: t.table.replace(/^abmc_|_lineitem$/g, '').toUpperCase(),
        DATE: t.date,
        ACCNT: line.account_id ? fullName(line.account_id) : '',
        AMOUNT: line.amount_amt,
        NAME: nameOf(line) || nameOf(t.head),
        // Only the first row's memo is the transaction's own, in an IIF block.
        MEMO: line.memo || (i ? '' : t.head?.memo ?? ''),
        TAX: line.tax_amount_amt ?? '',
        TAXCODE: taxCodeOf(line, tax),
        TAXLINE: line.is_trans_tax_bool === '1' ? '1' : '0',
      };
    });
  });

  // ---- does it add up? ----
  // The file stores each account's balance. Disagreeing means lines were misread or missed.
  let offBalance = 0;
  for (const a of load('abmc_account_internal')) {
    if ((parseAmount(a.ending_balance_amt) ?? 0) !== (sums.get(a.account_id) ?? 0)) offBalance++;
  }

  const result = parseLedger(
    {
      accnt,
      people,
      blocks,
      documents,
      payments,
      unknownBlocks: new Map(),
      product: [...tables.keys()].some((t) => t.startsWith('rkn_')) ? 'Reckon Accounts' : 'QuickBooks Desktop',
    },
    'ymd',
    undefined,
    taxMode,
  );
  result.source = 'qbm';
  if (notDocuments) result.skipped.push({ reason: 'Invoices, bills or credit notes with nothing to bring across, such as a zero total', count: notDocuments });
  if (unreadable) result.skipped.push({ reason: 'Inventory lines Tiny Tally can’t read yet', count: unreadable });
  if (offBalance) result.skipped.push({ reason: 'Accounts whose transactions don’t add up to the balance in the file. Some may be missing, so check them after importing.', count: offBalance });
  return result;
}
