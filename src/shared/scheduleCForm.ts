// Schedule C as the IRS form lays it out: every line of Parts I to V in
// order, filled in from the Schedule C report (backend/reports.ts), so the
// form view and the table always agree. Lines the books don't know (12
// depletion, the energy efficient buildings deduction, Part IV's questions)
// are left empty. ScheduleCForm.vue draws it.
// No tjs:* imports and no Intl here: this file ships in both.
import { SCHEDULE_C_YEARS, partOf } from './scheduleC';

/** What the form needs from the Schedule C report. */
export interface ScheduleCFormSource {
  lines: { key: string; line: string; label: string; part: 'I' | 'II' | 'III'; deductible: number; categories: { name: string; total: number }[] }[];
  partI: { grossReceipts: number; returns: number; netReceipts: number; costOfGoodsSold: number; grossProfit: number };
  partIII: { used: boolean; openingInventory: number; closingInventory: number };
  vehicle: { method: 'mileage' | 'actual'; milesTenths: number };
  homeOffice: { sqFt: number };
  totals: { grossIncome: number; totalExpenses: number; tentativeProfit: number; homeOffice: number; netProfit: number };
  rules: { id: string };
}

export interface FormLine {
  line: string;
  label: string;
  /** Cents; null when the books have nothing for it. */
  value: number | null;
  /** A total the form works out. */
  total?: boolean;
}

export interface ScheduleCForm {
  partI: FormLine[];
  partII: FormLine[];
  totals: FormLine[];
  partIII: FormLine[];
  /** Line 44a: business miles, when the mileage log has any. */
  businessMiles: number | null;
  partV: { items: { name: string; total: number }[]; total: number };
}

/** '16b' → [16, 'b'], for putting lines in the form's order. */
const order = (line: string) => [Number.parseInt(line, 10), line.replace(/^\d+/, '')] as const;
const byLine = (a: { line: string }, b: { line: string }) => {
  const [an, al] = order(a.line);
  const [bn, bl] = order(b.line);
  return an - bn || al.localeCompare(bl);
};

/** Labels as the form prints them where several keys share a line. */
const LINE_LABEL: Record<string, string> = { '9': 'Car and truck expenses' };

export function scheduleCForm(r: ScheduleCFormSource): ScheduleCForm {
  const year = SCHEDULE_C_YEARS.find((y) => y.id === r.rules.id) ?? SCHEDULE_C_YEARS[SCHEDULE_C_YEARS.length - 1];
  const sumLine = (line: string, part: 'II' | 'III') =>
    r.lines.filter((l) => l.line === line && l.part === part).reduce<number | null>((t, l) => (t ?? 0) + l.deductible, null);

  // Part II: the year's expense lines, one per line number, plus the ones no category maps to.
  const lines = new Map<string, string>();
  for (const l of year.lines) if (partOf(l) === 'II' && !lines.has(l.line)) lines.set(l.line, LINE_LABEL[l.line] ?? l.label);
  lines.set('12', 'Depletion');
  const otherExpenses = year.lines.find((l) => l.key === 'other-expenses')!.line;
  lines.set(otherExpenses === '27b' ? '27a' : '27b', 'Energy efficient commercial buildings deduction');
  const partII = [...lines].map(([line, label]) => ({ line, label, value: sumLine(line, 'II') })).sort(byLine);

  const otherIncome = r.lines.filter((l) => l.part === 'I' && l.key !== 'gross-receipts').reduce<number | null>((t, l) => (t ?? 0) + l.deductible, null);
  const partI: FormLine[] = [
    { line: '1', label: 'Gross receipts or sales', value: r.partI.grossReceipts },
    { line: '2', label: 'Returns and allowances', value: r.partI.returns },
    { line: '3', label: 'Subtract line 2 from line 1', value: r.partI.netReceipts, total: true },
    { line: '4', label: 'Cost of goods sold (from line 42)', value: r.partI.costOfGoodsSold },
    { line: '5', label: 'Gross profit. Subtract line 4 from line 3', value: r.partI.grossProfit, total: true },
    { line: '6', label: 'Other income', value: otherIncome },
    { line: '7', label: 'Gross income. Add lines 5 and 6', value: r.totals.grossIncome, total: true },
  ];

  const totals: FormLine[] = [
    { line: '28', label: `Total expenses before business use of home. Add lines 8 through ${otherExpenses}`, value: r.totals.totalExpenses, total: true },
    { line: '29', label: 'Tentative profit or (loss). Subtract line 28 from line 7', value: r.totals.tentativeProfit, total: true },
    {
      line: '30',
      label: r.homeOffice.sqFt ? `Business use of home, simplified method (${String(r.homeOffice.sqFt).replace(/\B(?=(\d{3})+$)/g, ',')} sq ft)` : 'Business use of home',
      value: r.homeOffice.sqFt ? r.totals.homeOffice : null,
    },
    { line: '31', label: 'Net profit or (loss). Subtract line 30 from line 29', value: r.totals.netProfit, total: true },
  ];

  const cogs = (line: string) => sumLine(line, 'III');
  const purchases = ['36', '37', '38', '39'].reduce((t, l) => t + (cogs(l) ?? 0), 0);
  const partIII: FormLine[] = r.partIII.used
    ? [
        { line: '35', label: 'Inventory at beginning of year', value: r.partIII.openingInventory },
        { line: '36', label: 'Purchases less cost of items withdrawn for personal use', value: cogs('36') },
        { line: '37', label: 'Cost of labor. Do not include any amounts paid to yourself', value: cogs('37') },
        { line: '38', label: 'Materials and supplies', value: cogs('38') },
        { line: '39', label: 'Other costs', value: cogs('39') },
        { line: '40', label: 'Add lines 35 through 39', value: r.partIII.openingInventory + purchases, total: true },
        { line: '41', label: 'Inventory at end of year', value: r.partIII.closingInventory },
        { line: '42', label: 'Cost of goods sold. Subtract line 41 from line 40', value: r.partI.costOfGoodsSold, total: true },
      ]
    : [];

  const other = r.lines.find((l) => l.key === 'other-expenses');
  return {
    partI,
    partII,
    totals,
    partIII,
    businessMiles: r.vehicle.method === 'mileage' && r.vehicle.milesTenths ? Math.round(r.vehicle.milesTenths / 10) : null,
    partV: { items: other?.categories ?? [], total: other?.deductible ?? 0 },
  };
}
