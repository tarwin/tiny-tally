import { confirmModal, toast } from '@octans/ui';
import { api, errorMessage } from './api';
import { router } from '../router';
import { session } from './session';

async function refresh() {
  const s = await api.start();
  session.books = s.books;
  session.recent = s.recent;
  session.internalDir = s.internalDir;
}

/**
 * Opens a books file, asking before taking over one locked elsewhere.
 * A window that already has a set of books opens the new one in a window of its
 * own; a window on the welcome screen opens it in place.
 */
export async function openBooksAt(path: string, force = false): Promise<boolean> {
  if (session.books) {
    if (session.books.path === path) return true;
    try {
      await api.openInNewWindow(path);
      return true;
    } catch (e) {
      toast({ title: "Couldn't open books", content: errorMessage(e), tone: 'error' });
      return false;
    }
  }
  try {
    const r = await api.openBooks(path, force);
    // Open in another window, which has been brought to the front.
    if (!r.ok && r.elsewhere) return false;
    if (r.ok) {
      await refresh();
      await router.push('/');
      return true;
    }
    if (r.locked) {
      const go = await confirmModal({
        title: 'Books in use',
        content: `${r.message} If two computers edit it at once, one set of changes can be lost.`,
        primaryActionLabel: 'Open anyway',
        primaryActionType: 'destructive',
        secondaryActionLabel: 'Cancel',
      });
      return go ? openBooksAt(path, true) : false;
    }
    toast({ title: "Couldn't open books", content: r.message, tone: 'error' });
  } catch (e) {
    toast({ title: "Couldn't open books", content: errorMessage(e), tone: 'error' });
  }
  return false;
}

export async function pickAndOpenBooks() {
  const path = await tiny.dialog.openFile({ types: ['tally'] });
  if (path) await openBooksAt(path);
}

export async function closeBooks() {
  await api.closeBooks();
  await refresh();
}

/** "New Books…": the welcome screen, in a new window if this one has a set of books open. */
export async function newBooks() {
  if (session.books) await api.newWindow();
}

export async function backupBooks() {
  try {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
    const dest = await api.backupBooks(stamp);
    toast({
      title: 'Backup saved',
      content: dest.slice(dest.lastIndexOf('/') + 1),
      tone: 'success',
      actions: [{ label: 'Show', onAction: () => void tiny.app.shell.reveal(dest) }],
    });
  } catch (e) {
    toast({ title: 'Backup failed', content: errorMessage(e), tone: 'error' });
  }
}

export { refresh as refreshSession };
