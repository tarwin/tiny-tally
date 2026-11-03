/**
 * A draft invoice handed over by another app (Tiny Time, the time tracker),
 * as a `.tallyinvoice` file: JSON, opened like a books file. It only fills in
 * the invoice editor; nothing is saved until you save it there.
 *
 * {
 *   "tallyInvoice": 1,
 *   "source": "Tiny Time",
 *   "customer": { "name": "Climate and Wildfire Institute", "address": "…" },
 *   "number": "CW-3",              // optional: blank uses Tiny Tally's next number
 *   "issueDate": "2026-11-03",     // optional
 *   "dueDays": 30,                 // optional
 *   "currency": "USD",             // optional: checked against the books
 *   "reference": "",
 *   "notes": "",
 *   "lines": [{ "description": "CWI Database: Programming (18 Jun – 9 Sep 2026)", "quantity": 7, "unitPrice": 250 }]
 * }
 *
 * Amounts are in currency units (250 = $250.00), not cents.
 */
export interface InvoiceHandoff {
  source: string;
  customer: { name: string; address: string };
  number: string;
  issueDate: string | null;
  dueDays: number | null;
  currency: string | null;
  reference: string;
  notes: string;
  lines: Array<{ description: string; quantity: number; unitPrice: number }>;
}

export const HANDOFF_EXT = '.tallyinvoice';

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const finite = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);

export function parseInvoiceHandoff(raw: string): InvoiceHandoff {
  let d: Record<string, unknown>;
  try {
    d = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
  } catch {
    throw new Error("This invoice file can't be read: it isn't valid JSON.");
  }
  if (!d || typeof d !== 'object' || finite(d.tallyInvoice) === null) throw new Error("This isn't a Tiny Tally invoice file.");
  if (finite(d.tallyInvoice)! > 1) throw new Error('This invoice file is from a newer version. Update Tiny Tally to open it.');
  const c = (d.customer && typeof d.customer === 'object' ? d.customer : {}) as Record<string, unknown>;
  const name = text(c.name, 200);
  if (!name) throw new Error('The invoice file has no customer name.');
  const lines = (Array.isArray(d.lines) ? d.lines : [])
    .map((l) => {
      const o = (l && typeof l === 'object' ? l : {}) as Record<string, unknown>;
      return { description: text(o.description, 2000), quantity: finite(o.quantity) ?? 1, unitPrice: finite(o.unitPrice) };
    })
    .filter((l): l is { description: string; quantity: number; unitPrice: number } => l.unitPrice !== null && l.quantity > 0);
  if (!lines.length) throw new Error('The invoice file has no lines with a quantity and price.');
  const issue = text(d.issueDate, 10);
  const due = finite(d.dueDays);
  const cur = text(d.currency, 3).toUpperCase();
  return {
    source: text(d.source, 60) || 'another app',
    customer: { name, address: text(c.address, 2000) },
    number: text(d.number, 60),
    issueDate: /^\d{4}-\d{2}-\d{2}$/.test(issue) ? issue : null,
    dueDays: due !== null && due >= 0 ? Math.round(due) : null,
    currency: /^[A-Z]{3}$/.test(cur) ? cur : null,
    reference: text(d.reference, 200),
    notes: text(d.notes, 4000),
    lines,
  };
}
