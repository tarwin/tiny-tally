import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RESERVED_KEYS, SHORTCUT_COMMANDS, conflictFor, displayKey, keyFromEvent, menuKey, normalizeKey, overridesFrom, resolveShortcuts,
} from '../src/shared/shortcuts.ts';

test('keys normalise, and go back to the form tinyjs takes', () => {
  assert.equal(normalizeKey('N'), 'shift+n');
  assert.equal(normalizeKey('alt+shift+F'), 'alt+shift+f');
  assert.equal(normalizeKey('shift+alt+f'), 'alt+shift+f');
  assert.equal(menuKey('shift+n'), 'N');
  assert.equal(menuKey('alt+shift+f'), 'alt+shift+f');
  assert.equal(menuKey('alt+t'), 'alt+t');
  assert.equal(menuKey('shift+]'), 'shift+]');
  assert.equal(menuKey(''), '');
});

test('the defaults have no clashes and nothing reserved', () => {
  const keys = resolveShortcuts();
  const used = Object.values(keys).filter(Boolean);
  assert.equal(new Set(used).size, used.length);
  for (const k of used) assert.ok(!RESERVED_KEYS.has(k), k);
  assert.equal(keys.calculator, 'shift+c');
});

test('changes are kept as differences from the defaults', () => {
  const keys = resolveShortcuts({ 'new-expense': 'shift+e', 'new-income': '' });
  assert.equal(keys['new-expense'], 'shift+e');
  assert.equal(keys['new-income'], '');
  assert.deepEqual(overridesFrom({ ...keys, search: 'k' }), { 'new-expense': 'shift+e', 'new-income': '' });
  assert.equal(conflictFor(keys, 'calculator', 'K'.toLowerCase()), 'search');
  assert.equal(conflictFor(keys, 'search', 'k'), null);
  // Overrides for commands that no longer exist are dropped.
  assert.equal(SHORTCUT_COMMANDS.some((c) => c.id === 'gone'), false);
  assert.deepEqual(overridesFrom({ gone: 'j' }), {});
});

test('how keys read', () => {
  assert.equal(displayKey('alt+t', true), '⌥⌘T');
  assert.equal(displayKey('N', true), '⇧⌘N');
  assert.equal(displayKey('-', true), '⌘−');
  assert.equal(displayKey('alt+shift+f', false), 'Ctrl Alt Shift F');
  assert.equal(displayKey('', false), '');
});

test('reading a pressed key', () => {
  const ev = (code: string, m: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) => ({
    code, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...m,
  });
  assert.equal(keyFromEvent(ev('KeyE', { metaKey: true }), true), 'e');
  assert.equal(keyFromEvent(ev('KeyF', { metaKey: true, altKey: true, shiftKey: true }), true), 'alt+shift+f');
  assert.equal(keyFromEvent(ev('BracketRight', { ctrlKey: true, shiftKey: true }), false), 'shift+]');
  assert.equal(keyFromEvent(ev('KeyE'), true), null);
  assert.equal(keyFromEvent(ev('KeyE', { ctrlKey: true }), true), null);
  assert.equal(keyFromEvent(ev('F5', { metaKey: true }), true), null);
});
