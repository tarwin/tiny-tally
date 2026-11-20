import { computed, reactive } from 'vue';
import { SHORTCUT_COMMANDS, normalizeKey, resolveShortcuts } from '../shared/shortcuts';

// App-wide preferences (not per set of books), kept in tiny.store beside the theme.
// The backend reads `reopenLast` from the same key at startup (app.start).
const STORE_KEY = 'appSettings';

export type Density = 'compact' | 'regular' | 'spacious';

export interface AppSettings {
  /** How much room the layout leaves: page and card padding, gaps, table rows. */
  density: Density;
  /** Whole-interface zoom, applied natively by the webview. */
  zoom: number;
  /** Open the last books again on launch. */
  reopenLast: boolean;
  /** Keyboard shortcuts changed from the defaults, by menu item id ('' for none). */
  shortcuts: Record<string, string>;
}

const DEFAULTS: AppSettings = { density: 'regular', zoom: 1, reopenLast: true, shortcuts: {} };

export const DENSITY_OPTIONS: { label: string; value: Density; icon: string; help: string }[] = [
  { label: 'Compact', value: 'compact', icon: 'mdi:view-headline', help: 'More rows on screen, tighter margins.' },
  { label: 'Regular', value: 'regular', icon: 'mdi:view-sequential-outline', help: 'The default.' },
  { label: 'Spacious', value: 'spacious', icon: 'mdi:view-agenda-outline', help: 'Extra room around everything.' },
];

export const ZOOM_OPTIONS = [
  { label: '75%', value: 0.75 },
  { label: '90%', value: 0.9 },
  { label: '100%', value: 1 },
  { label: '110%', value: 1.1 },
  { label: '125%', value: 1.25 },
  { label: '150%', value: 1.5 },
];

/** View › Zoom In / Zoom Out (⌘+ / ⌘−): the next zoom step up or down; 0 is back to 100%. */
export function stepZoom(dir: -1 | 0 | 1) {
  const values = ZOOM_OPTIONS.map((o) => o.value);
  if (dir === 0) return updateAppSettings({ zoom: 1 });
  const next = dir > 0 ? values.find((v) => v > appSettings.zoom + 1e-6) : [...values].reverse().find((v) => v < appSettings.zoom - 1e-6);
  if (next) updateAppSettings({ zoom: next });
}

export const appSettings = reactive<AppSettings>({ ...DEFAULTS });

/** Every command's shortcut, in normal form ('shift+n'), with the person's changes. */
export const shortcutKeys = computed(() => resolveShortcuts(appSettings.shortcuts));

/** The keyboard shortcuts editor (Help › Keyboard Shortcuts, App settings). */
export const shortcutsPanel = reactive({ visible: false });

/** Set while the shortcuts editor waits for a key: the menu drops its keys so the press isn't also run. */
export const shortcutRecording = reactive({ on: false });

/** The app settings panel; App.vue renders it, the menu and Settings page open it. */
export const appSettingsPanel = reactive({ visible: false });

function apply() {
  document.documentElement.dataset.density = appSettings.density;
  void tiny.win.setZoom(appSettings.zoom).catch(() => {});
}

export async function restoreAppSettings() {
  const saved = (await tiny.store.get(STORE_KEY).catch(() => null)) as Partial<AppSettings> | null;
  if (saved) {
    if (DENSITY_OPTIONS.some((o) => o.value === saved.density)) appSettings.density = saved.density!;
    if (ZOOM_OPTIONS.some((o) => o.value === saved.zoom)) appSettings.zoom = saved.zoom!;
    if (typeof saved.reopenLast === 'boolean') appSettings.reopenLast = saved.reopenLast;
    const known = new Set(SHORTCUT_COMMANDS.map((c) => c.id));
    appSettings.shortcuts = Object.fromEntries(
      Object.entries(saved.shortcuts && typeof saved.shortcuts === 'object' ? saved.shortcuts : {})
        .filter(([id, k]) => known.has(id) && typeof k === 'string')
        .map(([id, k]) => [id, normalizeKey(k as string)]),
    );
  }
  apply();
}

export function updateAppSettings(patch: Partial<AppSettings>) {
  Object.assign(appSettings, patch);
  apply();
  void tiny.store.set(STORE_KEY, JSON.parse(JSON.stringify(appSettings))).then(() => tiny.api.call('app.settingsChanged')).catch(() => {});
}
