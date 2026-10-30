// Small, forgiving parsers shared by the importers.

export type DateOrder = 'ymd' | 'mdy' | 'dmy';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function iso(y: number, m: number, d: number) {
  if (y < 100) y += y < 70 ? 2000 : 1900;
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Parses the date formats banks and QuickBooks export. Returns YYYY-MM-DD or null. */
export function parseDate(raw: string, order: DateOrder = 'dmy'): string | null {
  const s = raw.trim().replace(/^"|"$/g, '');
  if (!s) return null;
  let m = /^(\d{4})(\d{2})(\d{2})/.exec(s); // OFX: 20261028120000.000[+10:AEST]
  if (m && !/[-/.]/.test(s.slice(0, 8))) return iso(+m[1], +m[2], +m[3]);
  m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/.exec(s);
  if (m) return order === 'mdy' ? iso(+m[3], +m[1], +m[2]) : iso(+m[3], +m[2], +m[1]);
  // 28 Oct 2026, 28-Oct-26, Oct 28 2026
  m = /^(\d{1,2})[\s-]([A-Za-z]{3})[A-Za-z]*[\s-,]+(\d{2,4})/.exec(s);
  if (m && MONTHS.includes(m[2].toLowerCase())) return iso(+m[3], MONTHS.indexOf(m[2].toLowerCase()) + 1, +m[1]);
  m = /^([A-Za-z]{3})[A-Za-z]*[\s-](\d{1,2}),?[\s-](\d{2,4})/.exec(s);
  if (m && MONTHS.includes(m[1].toLowerCase())) return iso(+m[3], MONTHS.indexOf(m[1].toLowerCase()) + 1, +m[2]);
  return null;
}

/**
 * Guesses day/month order from a sample of dates: a first part over 12 means
 * day-first, a second part over 12 means month-first. Ties go to `fallback`.
 */
export function detectDateOrder(samples: string[], fallback: DateOrder = 'dmy'): DateOrder {
  let dmy = 0;
  let mdy = 0;
  for (const s of samples) {
    const m = /^\s*"?(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}/.exec(s);
    if (!m) continue;
    if (+m[1] > 12) dmy++;
    if (+m[2] > 12) mdy++;
  }
  if (dmy && !mdy) return 'dmy';
  if (mdy && !dmy) return 'mdy';
  return fallback;
}

/** The order people in this locale write dates in. */
export function localeDateOrder(): DateOrder {
  try {
    const parts = new Intl.DateTimeFormat(undefined).formatToParts(new Date(2026, 11, 31));
    const first = parts.find((p) => p.type === 'day' || p.type === 'month' || p.type === 'year')?.type;
    return first === 'month' ? 'mdy' : first === 'year' ? 'ymd' : 'dmy';
  } catch {
    return 'dmy';
  }
}

/**
 * Money text to signed cents: "$1,234.56", "-12.30", "(45.00)", "12.30 CR",
 * "1.234,56" (European). Returns null when there's no number.
 */
export function parseAmount(raw: string): number | null {
  let s = String(raw ?? '').trim().replace(/^"|"$/g, '');
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  if (/\s*(CR)$/i.test(s)) s = s.replace(/\s*CR$/i, '');
  else if (/\s*(DR)$/i.test(s)) {
    neg = !neg;
    s = s.replace(/\s*DR$/i, '');
  }
  if (/-$/.test(s)) {
    neg = !neg;
    s = s.slice(0, -1);
  }
  if (s.includes('-')) {
    neg = !neg;
    s = s.replace('-', '');
  }
  s = s.replace(/[^\d.,]/g, '');
  if (!/\d/.test(s)) return null;
  // Decide which separator is the decimal point: the last one, if 1–2 digits follow it.
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  const dec = Math.max(lastDot, lastComma);
  let whole = s;
  let frac = '';
  if (dec >= 0 && s.length - dec - 1 <= 2 && s.length - dec - 1 > 0) {
    whole = s.slice(0, dec);
    frac = s.slice(dec + 1);
  }
  whole = whole.replace(/[.,]/g, '');
  const cents = Number(whole || '0') * 100 + Number(frac.padEnd(2, '0') || '0');
  if (!Number.isFinite(cents)) return null;
  return neg ? -cents : cents;
}

/** RFC 4180 CSV, with the delimiter sniffed from the first line (comma, semicolon or tab). */
export function parseCsv(text: string): string[][] {
  const nl = text.indexOf('\n');
  const firstLine = nl < 0 ? text : text.slice(0, nl);
  const counts = { ',': 0, ';': 0, '\t': 0 } as Record<string, number>;
  let quoted = false;
  for (const ch of firstLine) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch in counts) counts[ch]++;
  }
  const [best, bestCount] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  const delim = bestCount > 0 ? best : ',';

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"' && field === '') inQuotes = true;
    else if (ch === delim) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

/** Repeated identical rows (two $4.50 coffees on one day) need distinct refs. */
export function occurrenceRefs() {
  const seen = new Map<string, number>();
  return (base: string) => {
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}#${n}`;
  };
}
