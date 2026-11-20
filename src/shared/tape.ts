// The adding-machine tape on number fields: type 120, then + and the tape
// opens with 120 on its first line; each operator starts a new line, and
// Enter puts the total in the field. Worked line by line, top to bottom, as
// a tape is (not × before +): 100 + 20 × 2 is 240.
// No tjs:* imports and no Intl here: this file ships in both.
import { tidy } from './calc';

export type TapeOp = '+' | '-' | '*' | '/';

export interface TapeLine {
  op: TapeOp | null;
  /** As typed. */
  text: string;
  /** "10%": a percentage of the total so far (for + and −), or of the line above. */
  pct?: boolean;
}

export const TAPE_OPS: Record<string, TapeOp> = { '+': '+', '-': '-', '−': '-', '*': '*', '×': '*', x: '*', X: '*', '/': '/', '÷': '/' };

/** The number on a line, or null while it isn't one yet ('', '-', '.'). */
export function lineValue(text: string): number | null {
  const t = text.replace(/,/g, '');
  return /^-?(\d+\.?\d*|\.\d+)$/.test(t) ? Number(t) : null;
}

/** The total of the lines, skipping an unfinished last line; null if dividing by zero. */
export function tapeTotal(lines: TapeLine[]): number | null {
  let total = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    let v = lineValue(l.text);
    if (v === null) {
      if (i === lines.length - 1 && i > 0) break;
      return null;
    }
    if (l.pct) v = l.op === '+' || l.op === '-' ? (total * v) / 100 : v / 100;
    switch (l.op) {
      case null:
        total = v;
        break;
      case '+':
        total += v;
        break;
      case '-':
        total -= v;
        break;
      case '*':
        total *= v;
        break;
      case '/':
        if (v === 0) return null;
        total /= v;
        break;
    }
  }
  return tidy(total);
}

/** Decimals typed on a line. */
const decimalsOf = (text: string) => (text.split('.')[1] ?? '').length;

/**
 * The total as the field gets it: to the most decimals any line had, at
 * least 2 when it doesn't come out whole (100 ÷ 3 is 33.33), and no
 * thousands separators.
 */
export function tapeResult(lines: TapeLine[]): string | null {
  const t = tapeTotal(lines);
  if (t === null) return null;
  if (Number.isInteger(t)) return String(t);
  const places = Math.max(2, ...lines.map((l) => decimalsOf(l.text)));
  return String(tidy(Number(t.toFixed(Math.min(places, 10)))));
}

/** What a field holds, read as the tape's first number: "$1,234.50" is 1234.5. Null if it isn't a plain number. */
export function startValue(fieldText: string): string | null {
  // Currency signs and spaces go; anything with letters isn't a number.
  if (/\p{L}/u.test(fieldText)) return null;
  let t = fieldText.trim().replace(/[^\d.,\-()]/g, '');
  const neg = /^\(.*\)$/.test(t);
  t = t.replace(/[()]/g, '');
  if (lineValue(t) === null) return null;
  const n = String(lineValue(t)! * (neg ? -1 : 1));
  // Keep the decimals as typed ("12.50"), so the answer keeps them too.
  const dec = decimalsOf(t.replace(/,/g, ''));
  return dec ? (Number(n) < 0 ? '-' : '') + Math.abs(Number(n)).toFixed(dec) : n;
}
