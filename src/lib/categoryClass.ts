// Categories that aren't profit or loss: money that moves without being
// income or spending (GST paid to the ATO, drawings, loans, buying assets).
import type { CategoryClass, CategoryKind } from './api';

export const CLASS_INFO: Record<CategoryClass, { label: string; help: string; offBas: boolean }> = {
  pnl: { label: 'Income or expense', help: 'Counts towards profit on the Profit & Loss.', offBas: false },
  tax: { label: 'Tax payment or refund', help: 'GST/BAS payments, refunds and income tax. Not profit, not on the BAS.', offBas: true },
  owner: { label: "Owner's money", help: 'Money you put in or take out for yourself (drawings). Not profit, not on the BAS.', offBas: true },
  loan: { label: 'Loan', help: 'Borrowing or repaying the amount borrowed. Interest is an expense. Not on the BAS.', offBas: true },
  asset: { label: 'Asset bought or sold', help: 'Equipment and vehicles you depreciate. GST still goes on the BAS (G10).', offBas: false },
};

export function classOptions(kind: CategoryKind) {
  return (Object.keys(CLASS_INFO) as CategoryClass[]).map((c) => ({
    value: c,
    label: kind === 'income' && c === 'owner' ? "Owner's money (put in)" : kind === 'expense' && c === 'owner' ? "Owner's money (drawings)" : CLASS_INFO[c].label,
    description: CLASS_INFO[c].help,
  }));
}
