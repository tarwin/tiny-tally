import { reactive } from 'vue';

// App-wide preferences (not per company), kept in tiny.store beside the theme.
// The backend reads `reopenLast` from the same key at startup (app.start).
const STORE_KEY = 'appSettings';

export type Density = 'compact' | 'regular' | 'spacious';

export interface AppSettings {
  /** How much room the layout leaves: page and card padding, gaps, table rows. */
  density: Density;
  /** Whole-interface zoom, applied natively by the webview. */
  zoom: number;
  /** Open the last company again on launch. */
  reopenLast: boolean;
}

const DEFAULTS: AppSettings = { density: 'regular', zoom: 1, reopenLast: true };

export const DENSITY_OPTIONS: { label: string; value: Density; icon: string; help: string }[] = [
  { label: 'Compact', value: 'compact', icon: 'mdi:view-headline', help: 'More rows on screen, tighter margins.' },
  { label: 'Regular', value: 'regular', icon: 'mdi:view-sequential-outline', help: 'The default.' },
  { label: 'Spacious', value: 'spacious', icon: 'mdi:view-agenda-outline', help: 'Extra room around everything.' },
];

export const ZOOM_OPTIONS = [
  { label: '90%', value: 0.9 },
  { label: '100%', value: 1 },
  { label: '110%', value: 1.1 },
  { label: '125%', value: 1.25 },
];

export const appSettings = reactive<AppSettings>({ ...DEFAULTS });

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
  }
  apply();
}

export function updateAppSettings(patch: Partial<AppSettings>) {
  Object.assign(appSettings, patch);
  apply();
  void tiny.store.set(STORE_KEY, { ...appSettings }).then(() => tiny.api.call('app.settingsChanged')).catch(() => {});
}
