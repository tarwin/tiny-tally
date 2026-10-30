import { toast } from '@octans/ui';
import { api, errorMessage } from './api';

type Cell = string | number | null | undefined;

function escape(v: Cell) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Cell[][]) {
  return rows.map((r) => r.map(escape).join(',')).join('\r\n') + '\r\n';
}

/** Cents → "1234.50" (spreadsheet-friendly, no currency symbol). */
export function csvMoney(minor: number) {
  return (minor / 100).toFixed(2);
}

export async function saveCsv(suggestedName: string, rows: Cell[][]) {
  const path = await tiny.dialog.saveFile({ types: ['csv'], name: suggestedName });
  if (!path) return;
  try {
    const dest = await api.writeText(path.endsWith('.csv') ? path : path + '.csv', toCsv(rows));
    toast({
      title: 'Exported',
      content: dest.slice(dest.lastIndexOf('/') + 1),
      tone: 'success',
      actions: [{ label: 'Show', onAction: () => void tiny.app.shell.reveal(dest) }],
    });
  } catch (e) {
    toast({ title: "Couldn't export", content: errorMessage(e), tone: 'error' });
  }
}
