// Form 1099-NEC Copy B, the recipient's statement: which revision of the form
// a tax year is furnished on, its boxes and the Instructions for Recipient
// that a substitute statement must carry (Pub. 1179). Copy A (the IRS's) is
// still filed through IRIS or a filing service; Copy B can be on plain paper.
// Checked against Form 1099-NEC (Rev. April 2025) and (Rev. December 2026)
// from irs.gov. Recheck each autumn when the IRS posts the next revision.
// No tjs:* imports and no Intl here: this file ships in both.

export interface Nec1099Revision {
  /** As the form prints it: 'Rev. December 2026'. */
  rev: string;
  /** The compensation box: '1' before the 2026 revision, '1a' from it. */
  compBox: string;
  /** Boxes printed between compensation and box 2, left empty: tips and overtime from 2026. */
  extraBoxes: { box: string; label: string }[];
  instructions: string[];
}

export const NEC1099_COPY_CHECKED = '2026-11-24';

const BEFORE = [
  'You received this form instead of Form W-2 because the payer did not consider you an employee and did not withhold income tax or social security and Medicare taxes.',
  'If you believe you are an employee and cannot get the payer to correct this form, report the amount shown in box 1 on the line for “Wages, salaries, tips, etc.” of Form 1040, 1040-SR, or 1040-NR. You must also complete Form 8919 and attach it to your return. For more information, see Pub. 1779, Independent Contractor or Employee.',
  'If you are not an employee but the amount in box 1 is not self-employment (SE) income (for example, it is income from a sporadic activity or a hobby), report the amount shown in box 1 on the “Other income” line (on Schedule 1 (Form 1040)).',
  'Recipient’s taxpayer identification number (TIN). For your protection, this form may show only the last four digits of your TIN (social security number (SSN), individual taxpayer identification number (ITIN), adoption taxpayer identification number (ATIN), or employer identification number (EIN)). However, the issuer has reported your complete TIN to the IRS.',
  'Account number. May show an account or other unique number the payer assigned to distinguish your account.',
];
const AFTER = [
  'Box 2. If checked, consumer products totaling $5,000 or more were sold to you for resale on a buy-sell, a deposit-commission, or another basis. Generally, report any income from your sale of these products on Schedule C (Form 1040).',
  'Box 3. Shows your total compensation of excess golden parachute payments subject to a 20% excise tax. See your tax return instructions for where to report.',
  'Box 4. Shows backup withholding. A payer must backup withhold on certain payments if you did not give your TIN to the payer. See Form W-9, Request for Taxpayer Identification Number and Certification, for information on backup withholding. Include this amount on your income tax return as tax withheld.',
  'Boxes 5–7. State income tax withheld reporting boxes.',
  'Future developments. For the latest information about developments related to Form 1099-NEC and its instructions, such as legislation enacted after they were published, go to www.irs.gov/Form1099NEC.',
];
const NOTE =
  'Note: If you are receiving payments on which no income, social security, and Medicare taxes are withheld, you should make estimated tax payments. See Form 1040-ES (or Form 1040-ES (NR)). Individuals must report these amounts as explained in these box 1 instructions. Corporations, fiduciaries, and partnerships must report these amounts on the appropriate lines of their tax returns.';

const REV_2025: Omit<Nec1099Revision, 'rev'> = {
  compBox: '1',
  extraBoxes: [],
  instructions: [
    ...BEFORE,
    'Box 1. Shows nonemployee compensation. If the amount in this box is SE income, report it on Schedule C or F (Form 1040) if a sole proprietor, or on Form 1065 and Schedule K-1 (Form 1065) if a partnership, and the recipient/partner completes Schedule SE (Form 1040).',
    NOTE,
    ...AFTER,
  ],
};

const REV_2026: Nec1099Revision = {
  rev: 'Rev. December 2026',
  compBox: '1a',
  extraBoxes: [
    { box: '1b', label: 'Cash tips' },
    { box: '1c', label: 'TTOC' },
    { box: '1d', label: 'Overtime compensation' },
  ],
  instructions: [
    ...BEFORE,
    'Box 1a. Shows your total nonemployee compensation. If the amount in this box is SE income, report it on Schedule C or F (Form 1040) if a sole proprietor or on Form 1065 and Schedule K-1 (Form 1065) if a partnership, and the recipient/partner completes Schedule SE (Form 1040).',
    'Box 1b. Shows the total amount of cash tips. “Cash tips” include tips received in cash or charged. This amount has been included in the amount reported in box 1a. Use the amount in box 1b when determining the qualified tip deduction in Part II of Schedule 1-A (Form 1040).',
    'Box 1c. Shows up to two Treasury Tipped Occupation Code(s) (TTOC) for your tipped occupation(s). Use this code(s) in determining the deduction for qualified tips in Part II of Schedule 1-A (Form 1040). If the occupation code 000 is used, and no other code is included in box 1c, your cash tips are not qualified tips; do not use the amount reported in box 1b for the deduction for qualified tips.',
    'Box 1d. Shows the total amount of qualified overtime compensation. This amount has been included in the amount reported in box 1a. Use the amount in box 1d when determining the qualified overtime compensation deduction in Part III of Schedule 1-A (Form 1040).',
    NOTE,
    ...AFTER,
  ],
};

/** The revision a tax year's Copy B is furnished on. */
export function nec1099Revision(year: number): Nec1099Revision {
  if (year >= 2026) return REV_2026;
  return { ...REV_2025, rev: year === 2025 ? 'Rev. April 2025' : 'Rev. January 2024' };
}

/** The recipient's TIN as Copy B may show it: the last four digits only. */
export function truncateTin(tin: string | null): string {
  const d = (tin ?? '').replace(/\D/g, '');
  if (d.length < 4) return '';
  // An EIN is written 12-3456789, an SSN 123-45-6789: keep the shape it was typed in.
  return /^\d{2}-\d{7}$/.test((tin ?? '').trim()) ? `XX-XXX${d.slice(-4)}` : `XXX-XX-${d.slice(-4)}`;
}
