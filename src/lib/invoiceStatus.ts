// Octans doesn't export its badge status type; mirror it.
type BadgeStatusType = 'info' | 'success' | 'warning' | 'error' | 'attention' | 'new';
import type { DocType, InvoiceRow, InvoiceStatus } from './api';
import { daysUntil } from './dates';

type Info = { label: string; badge: BadgeStatusType | undefined };

export const STATUS_INFO: Record<InvoiceStatus, Info> = {
  draft: { label: 'Draft', badge: undefined },
  awaiting: { label: 'Awaiting payment', badge: 'info' },
  partial: { label: 'Part paid', badge: 'warning' },
  overdue: { label: 'Overdue', badge: 'error' },
  paid: { label: 'Paid', badge: 'success' },
  void: { label: 'Void', badge: undefined },
  open: { label: 'Sent', badge: 'info' },
  expired: { label: 'Expired', badge: 'warning' },
  accepted: { label: 'Accepted', badge: 'success' },
};

const OVERRIDES: Partial<Record<DocType, Partial<Record<InvoiceStatus, Info>>>> = {
  quote: { void: { label: 'Declined', badge: undefined } },
  credit: {
    awaiting: { label: 'Available', badge: 'info' },
    partial: { label: 'Part used', badge: 'warning' },
    paid: { label: 'Used', badge: 'success' },
  },
  bill: { awaiting: { label: 'To pay', badge: 'info' } },
};

export function statusInfo(type: DocType | undefined, status: InvoiceStatus): Info {
  return OVERRIDES[type ?? 'invoice']?.[status] ?? STATUS_INFO[status];
}

/** "Due in 3 days", "5 days overdue", "Expires in 4 days" … */
export function dueText(inv: Pick<InvoiceRow, 'status' | 'dueDate'> & { docType?: DocType }) {
  if (inv.docType === 'credit') return '';
  if (inv.docType === 'quote') {
    if (inv.status !== 'open') return '';
    const d = daysUntil(inv.dueDate);
    return d === 0 ? 'Expires today' : d === 1 ? 'Expires tomorrow' : `Expires in ${d} days`;
  }
  if (!['awaiting', 'partial', 'overdue'].includes(inv.status)) return '';
  const d = daysUntil(inv.dueDate);
  if (d === 0) return 'Due today';
  if (d > 0) return d === 1 ? 'Due tomorrow' : `Due in ${d} days`;
  return -d === 1 ? '1 day overdue' : `${-d} days overdue`;
}
