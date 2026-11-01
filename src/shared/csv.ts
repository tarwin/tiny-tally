// CSV text: no app imports, so the tests can load it.
export type Cell = string | number | null | undefined;

function escape(v: Cell) {
  if (v === null || v === undefined) return '';
  let s = String(v);
  // Text from bank files and contacts could start a spreadsheet formula
  // (=HYPERLINK…); a leading quote keeps it text. Plain numbers stay numbers.
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Cell[][]) {
  return rows.map((r) => r.map(escape).join(',')).join('\r\n') + '\r\n';
}

/** Cents → "1234.50" (spreadsheet-friendly, no currency symbol). */
export function csvMoney(minor: number) {
  return (minor / 100).toFixed(2);
}
