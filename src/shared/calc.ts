// The calculator's arithmetic: + − × ÷, brackets and percent, without eval.
// "200 + 10%" is 220 and "200 − 10%" is 180, as on a desk calculator;
// "200 × 10%" is 20. Commas are thousands separators and are ignored.
// No tjs:* imports and no Intl here: this file ships in both.

const OPS: Record<string, string> = { '×': '*', x: '*', X: '*', '÷': '/', '−': '-', '–': '-' };

type Val = { v: number; pct: boolean };

/** The value of an expression, or null if it isn't complete or valid (or divides by zero). */
export function evaluate(expr: string): number | null {
  const src = [...expr.replace(/,/g, '')].map((c) => OPS[c] ?? c).join('').replace(/\s+/g, '');
  if (!src) return null;
  let i = 0;
  const peek = () => src[i];

  function number(): Val | null {
    const m = /^(\d+\.?\d*|\.\d+)/.exec(src.slice(i));
    if (!m) return null;
    i += m[0].length;
    return { v: Number(m[0]), pct: false };
  }
  function primary(): Val | null {
    if (peek() === '(') {
      i++;
      const v = expression();
      if (!v || peek() !== ')') return null;
      i++;
      return { v: v.v, pct: false };
    }
    return number();
  }
  function factor(): Val | null {
    if (peek() === '-' || peek() === '+') {
      const neg = src[i++] === '-';
      const f = factor();
      return f && { v: neg ? -f.v : f.v, pct: f.pct };
    }
    const p = primary();
    if (p && peek() === '%') {
      i++;
      return { v: p.v / 100, pct: true };
    }
    return p;
  }
  function term(): Val | null {
    let a = factor();
    while (a && (peek() === '*' || peek() === '/')) {
      const op = src[i++];
      const b = factor();
      if (!b || (op === '/' && b.v === 0)) return null;
      a = { v: op === '*' ? a.v * b.v : a.v / b.v, pct: false };
    }
    return a;
  }
  function expression(): Val | null {
    let a = term();
    while (a && (peek() === '+' || peek() === '-')) {
      const op = src[i++];
      const b = term();
      if (!b) return null;
      // 200 + 10% adds ten percent of 200.
      const rhs = b.pct ? a.v * b.v : b.v;
      a = { v: op === '+' ? a.v + rhs : a.v - rhs, pct: false };
    }
    return a;
  }

  const out = expression();
  if (!out || i !== src.length || !Number.isFinite(out.v)) return null;
  return tidy(out.v);
}

/** Drops floating-point noise: 0.1 + 0.2 is 0.3. */
export function tidy(n: number) {
  const r = Number(n.toPrecision(12));
  return Object.is(r, -0) ? 0 : r;
}

/** A number as plain text to copy: no grouping, as many decimals as it has. */
export function plainNumber(n: number) {
  return String(tidy(n));
}

/**
 * Text pasted in, made into something the calculator reads: currency signs,
 * letters and spaces go, and "(1,234.50)" or "1,234.50-" (accounting
 * negatives) become -1234.50.
 */
export function cleanPasted(text: string) {
  let t = text.trim();
  const bracketed = /^\(([^()+*/×÷]*)\)$/.exec(t);
  if (bracketed) t = `-${bracketed[1]}`;
  if (/^[^+*/×÷-]*\d-$/.test(t)) t = `-${t.slice(0, -1)}`;
  return t
    .replace(/[−–]/g, '-')
    .replace(/[^0-9.+\-*/×÷%()]/g, '');
}

/**
 * The number in an amount typed or pasted, with a currency sign or code
 * around it taken off ("A$12.50", "AUD 12.50", "12.50 AUD") and "(12.50)"
 * made "-12.50". Null if anything else is there: "4.d" isn't an amount.
 */
export function amountText(text: string): string | null {
  let t = text.trim();
  const bracketed = /^\((.*)\)$/.exec(t);
  if (bracketed) t = `-${bracketed[1].trim()}`;
  t = t
    .replace(/^(-?)\s*(?:[A-Z]{1,3}\s?)?[$€£¥₹]\s*/u, '$1') // $, A$, NZ$, US$, €
    .replace(/^(-?)\s*[A-Z]{3}\s+/, '$1') // AUD 12
    .replace(/\s+[A-Z]{3}$/, ''); // 12 AUD
  return /^-?\s*[\d.,\s]*$/.test(t) ? t : null;
}
