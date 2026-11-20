// Keyboard shortcuts for menu commands, which the person can change.
//
// Keys are in tinyjs's menu form: ⌘ (Ctrl on Windows and Linux) is always
// part of it; an uppercase letter carries shift ('N' is ⇧⌘N); anything more
// is a prefix ('alt+t' is ⌥⌘T, 'shift+]' is ⇧⌘]). '' means no shortcut.
// No tjs:* imports and no Intl here: this file ships in both.

export interface ShortcutCommand {
  /** The menu item id. */
  id: string;
  label: string;
  group: string;
  key: string;
}

export const SHORTCUT_COMMANDS: ShortcutCommand[] = [
  { id: 'new-expense', label: 'New expense', group: 'Transactions', key: 'e' },
  { id: 'new-income', label: 'New income', group: 'Transactions', key: 'i' },
  { id: 'new-transfer', label: 'New transfer', group: 'Transactions', key: 'alt+t' },
  { id: 'new-invoice', label: 'New invoice', group: 'Transactions', key: 'I' },
  { id: 'new-quote', label: 'New quote', group: 'Transactions', key: '' },
  { id: 'new-bill', label: 'New bill', group: 'Transactions', key: 'B' },
  { id: 'search', label: 'Search', group: 'Go', key: 'k' },
  { id: 'calculator', label: 'Calculator', group: 'Go', key: 'C' },
  { id: 'nav-back', label: 'Back', group: 'Go', key: '[' },
  { id: 'nav-forward', label: 'Forward', group: 'Go', key: ']' },
  { id: 'tab-new', label: 'New tab', group: 'Tabs and windows', key: 't' },
  { id: 'tab-close', label: 'Close tab', group: 'Tabs and windows', key: 'w' },
  { id: 'tab-next', label: 'Next tab', group: 'Tabs and windows', key: 'shift+]' },
  { id: 'tab-previous', label: 'Previous tab', group: 'Tabs and windows', key: 'shift+[' },
  { id: 'tab-window', label: 'Move tab to new window', group: 'Tabs and windows', key: '' },
  { id: 'window-new', label: 'New window', group: 'Tabs and windows', key: 'n' },
  { id: 'window-close', label: 'Close window', group: 'Tabs and windows', key: 'W' },
  { id: 'books-new', label: 'New books', group: 'Books', key: 'N' },
  { id: 'books-open', label: 'Open books', group: 'Books', key: 'o' },
  { id: 'books-close', label: 'Close books', group: 'Books', key: '' },
  { id: 'import', label: 'Import', group: 'Books', key: '' },
  { id: 'books-backup', label: 'Back up now', group: 'Books', key: '' },
  { id: 'books-shrink', label: 'Make file smaller', group: 'Books', key: '' },
  { id: 'books-settings', label: 'Books settings', group: 'Books', key: 'alt+,' },
  { id: 'app-settings', label: 'App settings', group: 'View', key: ',' },
  { id: 'zoom-in', label: 'Zoom in', group: 'View', key: '=' },
  { id: 'zoom-out', label: 'Zoom out', group: 'View', key: '-' },
  { id: 'zoom-reset', label: 'Actual size', group: 'View', key: '0' },
];

const DEFAULTS = new Map(SHORTCUT_COMMANDS.map((c) => [c.id, c.key]));

/** Written into its parts, so 'N', 'shift+n' and 'SHIFT+N' compare equal. */
export function normalizeKey(key: string): string {
  if (!key) return '';
  const parts = key.split('+');
  // A bare '+' key would split oddly; it's reserved anyway.
  let k = parts.pop() ?? '';
  if (k === '' && key.endsWith('+')) k = '+';
  const mods = new Set(parts.map((p) => p.toLowerCase()).filter(Boolean));
  if (/^[A-Z]$/.test(k)) mods.add('shift');
  if (/^[a-zA-Z]$/.test(k)) k = k.toLowerCase();
  return [...['alt', 'shift'].filter((m) => mods.has(m)), k].join('+');
}

/** The key tinyjs is given: shift alone on a letter is an uppercase letter ('N'); with ⌥ it's spelled out ('alt+shift+f'). */
export function menuKey(key: string): string {
  const n = normalizeKey(key);
  return /^shift\+[a-z]$/.test(n) ? n.slice(-1).toUpperCase() : n;
}

/** ⌘1–⌘9, ⌘+ and the Edit and app menus' own keys can't be given to anything else. */
export const RESERVED_KEYS = new Set(
  ['c', 'v', 'x', 'a', 'z', 'shift+z', 'q', 'h', 'm', 'alt+h', '+', 'shift+=', ...'123456789'].map(normalizeKey),
);

/** Each command's key, with the person's changes over the defaults. */
export function resolveShortcuts(overrides: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of SHORTCUT_COMMANDS) {
    const o = overrides[c.id];
    out[c.id] = typeof o === 'string' ? normalizeKey(o) : normalizeKey(c.key);
  }
  return out;
}

/** Keeps only what differs from the defaults, so a later default change still reaches everyone else. */
export function overridesFrom(keys: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [id, k] of Object.entries(keys)) {
    if (DEFAULTS.has(id) && normalizeKey(DEFAULTS.get(id)!) !== normalizeKey(k)) out[id] = normalizeKey(k);
  }
  return out;
}

/** Which other command already has this key. */
export function conflictFor(keys: Record<string, string>, id: string, key: string): string | null {
  const n = normalizeKey(key);
  if (!n) return null;
  return Object.entries(keys).find(([other, k]) => other !== id && k === n)?.[0] ?? null;
}

const MAC_GLYPHS: Record<string, string> = { alt: '⌥', shift: '⇧' };
const KEY_NAMES: Record<string, string> = { '-': '−', '=': '=', ',': ',', '[': '[', ']': ']' };

/** How a key reads: '⌥⇧⌘F' on a Mac, 'Ctrl Alt Shift F' elsewhere. */
export function displayKey(key: string, mac: boolean): string {
  const n = normalizeKey(key);
  if (!n) return '';
  const parts = n.split('+');
  const k = parts.pop()!;
  const name = KEY_NAMES[k] ?? k.toUpperCase();
  if (mac) return `${parts.map((p) => MAC_GLYPHS[p]).join('')}⌘${name}`;
  return ['Ctrl', ...parts.map((p) => (p === 'alt' ? 'Alt' : 'Shift')), name].join(' ');
}

const CODE_KEYS: Record<string, string> = {
  BracketLeft: '[', BracketRight: ']', Comma: ',', Period: '.', Slash: '/', Backslash: '\\',
  Semicolon: ';', Quote: "'", Minus: '-', Equal: '=', Backquote: '`',
};

/**
 * A key pressed, in menu form, or null if it can't be a shortcut: it needs
 * ⌘ (Ctrl), and a letter, digit or punctuation key. Read from the physical
 * key, since ⌥ and ⇧ change what e.key says.
 */
export function keyFromEvent(e: { code: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }, mac: boolean): string | null {
  if (!(mac ? e.metaKey : e.ctrlKey) || (mac && e.ctrlKey)) return null;
  let k: string | undefined;
  if (/^Key[A-Z]$/.test(e.code)) k = e.code.slice(3).toLowerCase();
  else if (/^Digit\d$/.test(e.code)) k = e.code.slice(5);
  else k = CODE_KEYS[e.code];
  if (!k) return null;
  return normalizeKey([e.altKey ? 'alt' : '', e.shiftKey ? 'shift' : '', k].filter(Boolean).join('+'));
}
