// Auto-update: tinyjs checks the manifest (tinyjs.json "update") on launch
// and daily, and tells every window. The banner (UpdateBanner.vue) offers to
// restart into the new version; Check for Updates… asks straight away.
import { reactive } from 'vue';
import { toast } from '@octans/ui';
import { errorMessage } from './api';

export const update = reactive({
  /** The newer version, when there is one. */
  latest: null as string | null,
  notes: null as string | null,
  dismissed: false,
  installing: false,
});

export function updateFound(info: { latest: string | null; notes: string | null }) {
  if (!info.latest || info.latest === update.latest) return;
  Object.assign(update, { latest: info.latest, notes: info.notes, dismissed: false });
}

/** From the menu: says what it found, even when that's nothing. */
export async function checkForUpdates() {
  try {
    const r = await tiny.app.update.check();
    if (r.available) updateFound(r);
    else toast({ title: "You're up to date", content: `Tiny Tally ${r.current} is the latest version.` });
  } catch (e) {
    toast({ title: "Couldn't check for updates", content: errorMessage(e), tone: 'error' });
  }
}

export async function installUpdate() {
  update.installing = true;
  try {
    // Resolves just before the app quits and the new version opens.
    await tiny.app.update.install();
  } catch (e) {
    update.installing = false;
    toast({ title: "Couldn't install the update", content: errorMessage(e), tone: 'error' });
  }
}
