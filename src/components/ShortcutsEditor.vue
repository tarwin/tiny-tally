<script setup lang="ts">
// Keyboard shortcuts, changeable (Help › Keyboard Shortcuts, or App settings).
// Click a shortcut, then press the new keys. While it waits, the menu bar's
// keys are switched off (App.vue) so pressing ⌘E doesn't also make an expense.
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { Button, KeyboardKey, Modal, ModalSection } from '@octans/ui';
import { appSettings, shortcutKeys, shortcutRecording, updateAppSettings } from '../lib/appSettings';
import { RESERVED_KEYS, SHORTCUT_COMMANDS, conflictFor, displayKey, keyFromEvent, normalizeKey, overridesFrom } from '../shared/shortcuts';

const props = defineProps<{ visible: boolean }>();
const emit = defineEmits<{ close: [] }>();

const isMac = tiny.system.isMacOS();
const recording = ref<string | null>(null);
/** What happened last, shown under the list: a clash moved, a key refused. */
const message = ref('');

const groups = computed(() => {
  const out: { name: string; items: typeof SHORTCUT_COMMANDS }[] = [];
  for (const c of SHORTCUT_COMMANDS) {
    let g = out.find((x) => x.name === c.group);
    if (!g) out.push((g = { name: c.group, items: [] }));
    g.items.push(c);
  }
  return out;
});

const labelOf = (id: string) => SHORTCUT_COMMANDS.find((c) => c.id === id)?.label ?? id;
const changed = computed(() => Object.keys(appSettings.shortcuts).length > 0);

function save(keys: Record<string, string>) {
  updateAppSettings({ shortcuts: overridesFrom(keys) });
}

function start(id: string) {
  message.value = '';
  recording.value = recording.value === id ? null : id;
}

function stop() {
  recording.value = null;
}

function setKey(id: string, key: string) {
  const keys = { ...shortcutKeys.value };
  const other = conflictFor(keys, id, key);
  if (other) {
    keys[other] = '';
    message.value = `${displayKey(key, isMac)} was ${labelOf(other)}'s. ${labelOf(other)} has no shortcut now.`;
  } else message.value = '';
  keys[id] = key;
  save(keys);
}

// Captured before anything else sees it, so Esc doesn't close the dialog.
function onKey(e: KeyboardEvent) {
  const id = recording.value;
  if (!id) return;
  if (['Meta', 'Control', 'Alt', 'Shift'].includes(e.key)) return;
  e.preventDefault();
  e.stopPropagation();
  if (e.key === 'Escape' && !e.metaKey && !e.ctrlKey) return stop();
  if ((e.key === 'Backspace' || e.key === 'Delete') && !e.metaKey && !e.ctrlKey) {
    setKey(id, '');
    return stop();
  }
  const key = keyFromEvent(e, isMac);
  if (!key) {
    message.value = `A shortcut needs ${isMac ? '⌘' : 'Ctrl'} and a letter, number or punctuation key.`;
    return;
  }
  if (RESERVED_KEYS.has(key)) {
    message.value = `${displayKey(key, isMac)} is kept for ${/^\d$/.test(key) ? 'tabs' : 'the system'}. Try another.`;
    return;
  }
  setKey(id, key);
  stop();
}

watch(recording, (id) => {
  shortcutRecording.on = !!id;
  if (id) window.addEventListener('keydown', onKey, true);
  else window.removeEventListener('keydown', onKey, true);
});

watch(
  () => props.visible,
  (v) => {
    if (!v) stop();
    message.value = '';
  },
);

onBeforeUnmount(stop);

function reset(id: string) {
  const def = SHORTCUT_COMMANDS.find((c) => c.id === id)!.key;
  setKey(id, def);
}

function resetAll() {
  stop();
  message.value = '';
  updateAppSettings({ shortcuts: {} });
}

function close() {
  stop();
  emit('close');
}
</script>

<template>
  <Modal
    :visible="props.visible"
    title="Keyboard shortcuts"
    :dialog-style="{ width: '520px' }"
    :tertiary-actions="[{ label: 'Reset all', disabled: !changed, onAction: resetAll }]"
    :primary-action="{ label: 'Done', onAction: close }"
    @close="close"
  >
    <ModalSection>
      <p class="subdued Hint">
        Click a shortcut, then press the new keys. Delete removes it, Esc cancels.
      </p>
      <section v-for="g in groups" :key="g.name" class="Group">
        <h3>{{ g.name }}</h3>
        <div v-for="c in g.items" :key="c.id" class="Row" :class="{ 'Row--recording': recording === c.id }">
          <span>{{ c.label }}</span>
          <button type="button" class="Key" :aria-label="`Change the shortcut for ${c.label}`" @click="start(c.id)">
            <template v-if="recording === c.id"><span class="Waiting">Press keys…</span></template>
            <KeyboardKey v-else-if="shortcutKeys[c.id]" size="small">{{ displayKey(shortcutKeys[c.id], isMac) }}</KeyboardKey>
            <span v-else class="subdued">None</span>
          </button>
          <Button
            size="small"
            type="plain"
            icon="mdi:restore"
            tooltip="Back to the default"
            :disabled="shortcutKeys[c.id] === normalizeKey(c.key)"
            @click="reset(c.id)"
          />
        </div>
      </section>
      <p v-if="message" class="Message" role="status">{{ message }}</p>
    </ModalSection>
  </Modal>
</template>

<style scoped>
.Hint {
  margin: 0 0 8px;
}

.Group h3 {
  margin: 14px 0 4px;
  font-size: 13px;
  font-weight: 600;
  color: var(--octans-text-subdued);
}

.Row {
  display: grid;
  grid-template-columns: 1fr 140px 32px;
  align-items: center;
  gap: 8px;
  padding: 2px 0;
}

.Key {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  min-height: 28px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: none;
  padding: 2px 8px;
  color: var(--octans-text);
  font: inherit;
  cursor: pointer;
}

.Key:hover {
  border-color: var(--octans-border);
  background: var(--octans-surface-hover);
}

.Row--recording .Key {
  border-color: var(--octans-border-focus);
}

.Waiting {
  color: var(--octans-text-primary);
  font-size: 13px;
}

.Message {
  position: sticky;
  bottom: 0;
  margin: 12px 0 0;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--octans-surface-sunken);
  font-size: 13px;
}
</style>
