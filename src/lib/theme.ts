import { ref } from 'vue';
import { setTheme, type ThemePreferenceType } from '@octans/ui';

// Kept in tiny.store (the app's settings file) rather than localStorage, so
// it lives with the rest of the app's own settings and survives rebuilds.
const STORE_KEY = 'theme';

export const themePreference = ref<ThemePreferenceType>('system');

export const THEME_OPTIONS: { label: string; value: ThemePreferenceType; icon: string }[] = [
  { label: 'System', value: 'system', icon: 'mdi:theme-light-dark' },
  { label: 'Light', value: 'light', icon: 'mdi:white-balance-sunny' },
  { label: 'Dark', value: 'dark', icon: 'mdi:weather-night' },
];

export function syncThemeMenu() {
  for (const o of THEME_OPTIONS) {
    void tiny.win.menu.update(`theme-${o.value}`, { checked: themePreference.value === o.value }).catch(() => {});
  }
}

export function applyTheme(pref: ThemePreferenceType) {
  themePreference.value = pref;
  setTheme(pref);
  syncThemeMenu();
  // Other windows reload it (App.vue listens for app-settings-changed).
  void tiny.store.set(STORE_KEY, pref).then(() => tiny.api.call('app.settingsChanged')).catch(() => {});
}

export async function restoreTheme() {
  const saved = (await tiny.store.get(STORE_KEY)) as ThemePreferenceType | null;
  themePreference.value = saved === 'light' || saved === 'dark' ? saved : 'system';
  setTheme(themePreference.value);
  syncThemeMenu();
}

/** Light ↔ dark, starting from whatever is on screen now. */
export function toggleTheme() {
  const dark =
    themePreference.value === 'dark' ||
    (themePreference.value === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  applyTheme(dark ? 'light' : 'dark');
}
