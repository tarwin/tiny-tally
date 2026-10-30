// Just enough of the Excel .xlsx format to read the first sheet as rows of
// text: the zip container (inflated with the browser's DecompressionStream),
// shared strings, and date-formatted cells turned into YYYY-MM-DD.

async function unzip(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("That doesn't look like an Excel file.");
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const out = new Map<string, Uint8Array>();
  const decoder = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) break;
    const method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!/\.(xml|rels)$/.test(name)) continue;
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + size);
    if (method === 0) out.set(name, data);
    else if (method === 8) {
      const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      out.set(name, new Uint8Array(await new Response(stream).arrayBuffer()));
    }
  }
  return out;
}

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

function isDateFormat(code: string) {
  // Drop quoted text, escapes and [colour]/[$-locale] blocks before looking for date parts.
  const bare = code.replace(/"[^"]*"|\\.|\[[^\]]*\]/g, '');
  return /[dy]/i.test(bare) || /m{3,}/i.test(bare);
}

function serialToIso(serial: number) {
  return new Date(Date.UTC(1899, 11, 30) + Math.round(serial * 86400000)).toISOString().slice(0, 10);
}

function colIndex(ref: string) {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function looksLikeXlsx(bytes: Uint8Array) {
  return bytes[0] === 0x50 && bytes[1] === 0x4b;
}

/** Rows of the first sheet, every cell as text. */
export async function readXlsx(bytes: Uint8Array): Promise<string[][]> {
  const files = await unzip(bytes);
  const text = (name: string) => {
    const b = files.get(name);
    return b ? new TextDecoder().decode(b) : null;
  };
  const xml = (name: string) => {
    const t = text(name);
    return t ? new DOMParser().parseFromString(t, 'application/xml') : null;
  };
  const tags = (node: Document | Element, name: string) => Array.from(node.getElementsByTagNameNS('*', name));

  // First sheet, via the workbook's relationships.
  let sheetPath = '';
  const workbook = xml('xl/workbook.xml');
  const rels = xml('xl/_rels/workbook.xml.rels');
  const first = workbook ? tags(workbook, 'sheet')[0] : undefined;
  const rid = first ? [...first.attributes].find((a) => a.name.endsWith(':id'))?.value : undefined;
  const target = rid && rels ? tags(rels, 'Relationship').find((r) => r.getAttribute('Id') === rid)?.getAttribute('Target') : undefined;
  if (target) sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
  if (!files.has(sheetPath)) sheetPath = [...files.keys()].filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort()[0] ?? '';
  const sheet = xml(sheetPath);
  if (!sheet) throw new Error('That Excel file has no sheets.');

  const strings = (() => {
    const doc = xml('xl/sharedStrings.xml');
    if (!doc) return [];
    // Rich text is split into runs; phonetic hints (rPh) aren't part of the text.
    return tags(doc, 'si').map((si) => tags(si, 't').filter((t) => !t.closest('rPh')).map((t) => t.textContent ?? '').join(''));
  })();

  const dateStyles = new Set<number>();
  const styles = xml('xl/styles.xml');
  if (styles) {
    const custom = new Map(tags(styles, 'numFmt').map((f) => [Number(f.getAttribute('numFmtId')), f.getAttribute('formatCode') ?? '']));
    const xfs = tags(styles, 'cellXfs')[0];
    if (xfs) {
      Array.from(xfs.children).forEach((xf, i) => {
        const id = Number(xf.getAttribute('numFmtId') ?? 0);
        if (BUILTIN_DATE_FORMATS.has(id) || (custom.has(id) && isDateFormat(custom.get(id)!))) dateStyles.add(i);
      });
    }
  }

  const rows: string[][] = [];
  for (const row of tags(sheet, 'row')) {
    const r = Number(row.getAttribute('r') ?? rows.length + 1) - 1;
    const cells: string[] = [];
    let next = 0;
    for (const c of tags(row, 'c')) {
      const ref = c.getAttribute('r');
      const i = ref ? colIndex(ref) : next;
      next = i + 1;
      const type = c.getAttribute('t');
      const v = tags(c, 'v')[0]?.textContent ?? '';
      let value: string;
      if (type === 's') value = strings[Number(v)] ?? '';
      else if (type === 'inlineStr') value = tags(c, 't').map((t) => t.textContent ?? '').join('');
      else if (type === 'b') value = v === '1' ? 'TRUE' : 'FALSE';
      else if (!type || type === 'n') {
        const style = Number(c.getAttribute('s') ?? -1);
        // Floats like 45.499999999999993 come back to 45.5.
        value = !v ? v : dateStyles.has(style) ? serialToIso(Number(v)) : String(Number(Number(v).toFixed(9)));
      } else value = v;
      cells[i] = value;
    }
    rows[r] = Array.from(cells, (x) => x ?? '');
  }
  return Array.from(rows, (x) => x ?? []);
}
