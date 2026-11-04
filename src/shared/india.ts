// India's GST: states, GSTINs and what the rules ask of a tax invoice.
// Shared by the backend and the page, so no tjs:* imports and no Intl here.
// Where the rules came from: docs/TAX-SOURCES.md.

/** GST state and union territory codes. */
export const IN_STATES: { code: string; name: string }[] = [
  { code: '01', name: 'Jammu and Kashmir' },
  { code: '02', name: 'Himachal Pradesh' },
  { code: '03', name: 'Punjab' },
  { code: '04', name: 'Chandigarh' },
  { code: '05', name: 'Uttarakhand' },
  { code: '06', name: 'Haryana' },
  { code: '07', name: 'Delhi' },
  { code: '08', name: 'Rajasthan' },
  { code: '09', name: 'Uttar Pradesh' },
  { code: '10', name: 'Bihar' },
  { code: '11', name: 'Sikkim' },
  { code: '12', name: 'Arunachal Pradesh' },
  { code: '13', name: 'Nagaland' },
  { code: '14', name: 'Manipur' },
  { code: '15', name: 'Mizoram' },
  { code: '16', name: 'Tripura' },
  { code: '17', name: 'Meghalaya' },
  { code: '18', name: 'Assam' },
  { code: '19', name: 'West Bengal' },
  { code: '20', name: 'Jharkhand' },
  { code: '21', name: 'Odisha' },
  { code: '22', name: 'Chhattisgarh' },
  { code: '23', name: 'Madhya Pradesh' },
  { code: '24', name: 'Gujarat' },
  { code: '26', name: 'Dadra and Nagar Haveli and Daman and Diu' },
  { code: '27', name: 'Maharashtra' },
  { code: '29', name: 'Karnataka' },
  { code: '30', name: 'Goa' },
  { code: '31', name: 'Lakshadweep' },
  { code: '32', name: 'Kerala' },
  { code: '33', name: 'Tamil Nadu' },
  { code: '34', name: 'Puducherry' },
  { code: '35', name: 'Andaman and Nicobar Islands' },
  { code: '36', name: 'Telangana' },
  { code: '37', name: 'Andhra Pradesh' },
  { code: '38', name: 'Ladakh' },
  { code: '97', name: 'Other Territory' },
];

/** The place of supply on an export: outside India, so no state. */
export const EXPORT_PLACE = 'EXPORT';

export const inStateName = (code: string | null | undefined) => IN_STATES.find((s) => s.code === code)?.name ?? null;
export const isInState = (code: unknown) => IN_STATES.some((s) => s.code === code);

const GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** The 15th character of a GSTIN, from the first 14. */
function gstinCheckChar(first14: string) {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const product = GSTIN_CHARS.indexOf(first14[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return GSTIN_CHARS[(36 - (sum % 36)) % 36];
}

/** null when it looks fine (or is empty). */
export function gstinError(raw: string | null | undefined) {
  const v = (raw ?? '').replace(/\s/g, '').toUpperCase();
  if (!v) return null;
  if (!/^\d{2}[A-Z0-9]{13}$/.test(v)) return 'A GSTIN is 15 characters, like 27AAPFU0939F1ZV.';
  if (!isInState(v.slice(0, 2))) return "That GSTIN doesn't start with a state code. Check for a typo.";
  return gstinCheckChar(v.slice(0, 14)) === v[14] ? null : "That GSTIN doesn't look right. Check for a typo.";
}

export const gstinState = (gstin: string | null | undefined) => {
  const code = (gstin ?? '').trim().slice(0, 2);
  return isInState(code) ? code : null;
};

/** Rule 46(b): up to 16 characters, letters, digits, hyphen and slash. null when fine. */
export function gstNumberError(number: string) {
  if (number.length > 16) return `Number ${number} is too long: GST invoice numbers are at most 16 characters.`;
  if (!/^[A-Za-z0-9/-]+$/.test(number)) return `Number ${number} can only use letters, digits, hyphens and slashes.`;
  return null;
}

/** How GST on a sale is charged: half and half within a state, integrated tax otherwise. */
export function gstSplit(place: string | null | undefined, homeState: string | null | undefined): 'intra' | 'inter' {
  return place && place !== EXPORT_PLACE && place === homeState ? 'intra' : 'inter';
}

/** Where a customer's supply takes place, for most services: where the customer is. Canada uses this too. */
export function placeFor(contact: { country?: string | null; state?: string | null } | null | undefined, home = 'IN') {
  if (!contact) return null;
  if (contact.country && contact.country !== home) return EXPORT_PLACE;
  return contact.state ?? null;
}

/**
 * GST rates, in parts per million. A rate belongs to the goods or service (its
 * HSN or SAC), so it's set per line. The two marked older are for documents and
 * credit notes from before they ended. See docs/TAX-SOURCES.md.
 */
export const GST_RATES: { ppm: number; label: string }[] = [
  { ppm: 180_000, label: '18%' },
  { ppm: 50_000, label: '5%' },
  { ppm: 400_000, label: '40%' },
  { ppm: 30_000, label: '3%' },
  { ppm: 15_000, label: '1.5%' },
  { ppm: 2_500, label: '0.25%' },
  { ppm: 120_000, label: '12% (older)' },
  { ppm: 280_000, label: '28% (older)' },
];

const pct = (ppm: number) => ppm / 10_000;
export const gstRateText = (ppm: number) => `${pct(ppm)}%`;

/** The tax lines on an invoice's totals: one per rate, or two where the state's share is half. */
export function gstHeads(lines: { ratePpm: number; tax: number }[], split: 'intra' | 'inter') {
  const byRate = new Map<number, number>();
  for (const l of lines) if (l.tax) byRate.set(l.ratePpm, (byRate.get(l.ratePpm) ?? 0) + l.tax);
  return [...byRate.entries()].sort((a, b) => a[0] - b[0]).flatMap(([ppm, tax]) => {
    if (split === 'inter') return [{ label: `IGST @ ${pct(ppm)}%`, value: tax }];
    const half = Math.round(tax / 2);
    return [{ label: `CGST @ ${pct(ppm / 2)}%`, value: half }, { label: `SGST @ ${pct(ppm / 2)}%`, value: tax - half }];
  });
}

/** Rule 46's endorsement on an export invoice. */
export function exportEndorsement(mode: 'lut' | 'igst') {
  return mode === 'igst'
    ? 'SUPPLY MEANT FOR EXPORT ON PAYMENT OF INTEGRATED TAX'
    : 'SUPPLY MEANT FOR EXPORT UNDER BOND OR LETTER OF UNDERTAKING WITHOUT PAYMENT OF INTEGRATED TAX';
}
