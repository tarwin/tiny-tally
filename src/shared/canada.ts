// Canada's GST/HST: provinces, rates and the Business Number. Shared by the
// backend and the page, so no tjs:* imports and no Intl here.
// Where the rules came from: docs/TAX-SOURCES.md.
//
// Only the federal tax is tracked. Québec's QST and the PST in British Columbia,
// Saskatchewan and Manitoba are separate taxes with their own agencies.

export const CA_PROVINCES: { code: string; name: string }[] = [
  { code: 'AB', name: 'Alberta' },
  { code: 'BC', name: 'British Columbia' },
  { code: 'MB', name: 'Manitoba' },
  { code: 'NB', name: 'New Brunswick' },
  { code: 'NL', name: 'Newfoundland and Labrador' },
  { code: 'NS', name: 'Nova Scotia' },
  { code: 'NT', name: 'Northwest Territories' },
  { code: 'NU', name: 'Nunavut' },
  { code: 'ON', name: 'Ontario' },
  { code: 'PE', name: 'Prince Edward Island' },
  { code: 'QC', name: 'Québec' },
  { code: 'SK', name: 'Saskatchewan' },
  { code: 'YT', name: 'Yukon' },
];

export const isCaProvince = (code: unknown) => CA_PROVINCES.some((p) => p.code === code);

/** Where a registrant also has a separate provincial sales tax to deal with. */
export const CA_OTHER_TAX: Record<string, string> = {
  BC: 'PST',
  MB: 'RST',
  QC: 'QST',
  SK: 'PST',
};

const GST = 50_000;

/** The GST/HST rate for a supply made in a province on a date. No province: the 5% GST. */
export function caRatePpm(province: string | null | undefined, date: string) {
  switch (province) {
    case 'ON': return 130_000;
    case 'NB': case 'NL': case 'PE': return 150_000;
    case 'NS': return date >= '2025-04-01' ? 140_000 : 150_000;
    default: return GST;
  }
}

/** Every rate in use, so a bill from any province can be entered at what it shows. */
export const CA_RATES: { ppm: number; label: string }[] = [
  { ppm: GST, label: '5% GST' },
  { ppm: 130_000, label: '13% HST' },
  { ppm: 140_000, label: '14% HST' },
  { ppm: 150_000, label: '15% HST' },
];

/** The word for the tax at a rate: HST includes the GST, so it's one or the other. */
export const caTaxWord = (ppm: number) => (ppm === GST ? 'GST' : 'HST');

/** A Business Number is 9 digits, and the GST/HST account adds RT and 4 more. */
export function businessNumberError(raw: string | null | undefined) {
  const v = (raw ?? '').replace(/[\s-]/g, '').toUpperCase();
  if (!v) return null;
  return /^\d{9}(RT\d{4})?$/.test(v) ? null : 'A Business Number is 9 digits, and your GST/HST account adds RT and 4 more, like 123456789 RT 0001.';
}
