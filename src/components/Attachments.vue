<script setup lang="ts">
// Receipts and other files on a transaction or document. Without an owner
// yet (a new transaction), files wait in `pending` and the parent saves them.
import { onBeforeUnmount, ref, watch } from 'vue';
import { Button, Icon, Modal, ModalSection, confirmModal, toast } from '@octans/ui';
import { api, errorMessage, type Attachment, type AttachmentFile, type AttachmentOwner } from '../lib/api';
import { ATTACHABLE, readForAttaching, registerDropTarget, sizeText } from '../lib/attachments';

const props = withDefaults(defineProps<{ owner: AttachmentOwner | null; active?: boolean; label?: string }>(), {
  active: true,
  label: 'Attach receipt',
});
const pending = defineModel<AttachmentFile[]>('pending', { default: () => [] });
const emit = defineEmits<{ changed: [] }>();

const list = ref<Attachment[]>([]);
const busy = ref(false);

async function load() {
  list.value = props.owner ? await api.listAttachments(props.owner).catch(() => []) : [];
}
watch(() => JSON.stringify(props.owner), load, { immediate: true });

async function attach(paths: string[]) {
  busy.value = true;
  try {
    for (const path of paths) {
      const file = await readForAttaching(path);
      if (props.owner) await api.addAttachment(props.owner, file);
      else pending.value = [...pending.value, file];
    }
    if (props.owner) {
      await load();
      emit('changed');
    }
    toast({ title: paths.length === 1 ? 'Attached' : `Attached ${paths.length} files`, tone: 'success' });
  } catch (e) {
    toast({ title: "Couldn't attach that", content: errorMessage(e), tone: 'error' });
  } finally {
    busy.value = false;
  }
}

async function pick() {
  const paths = await tiny.dialog.openFiles({ types: ATTACHABLE });
  if (paths?.length) await attach(paths);
}

// Dropped receipts land here while this is showing.
let unregister: (() => void) | null = null;
watch(
  () => props.active,
  (on) => {
    unregister?.();
    unregister = on ? registerDropTarget((paths) => void attach(paths)) : null;
  },
  { immediate: true },
);
onBeforeUnmount(() => unregister?.());

// ---- view, save, remove -------------------------------------------------------------

const preview = ref<{ name: string; src: string } | null>(null);

async function view(a: Attachment) {
  try {
    // Photos show here; PDFs (and anything the webview can't show) open in the system viewer.
    if (a.mime.startsWith('image/') && !a.mime.includes('hei')) {
      const f = await api.getAttachment(a.id);
      preview.value = { name: f.name, src: `data:${f.mime};base64,${f.data}` };
    } else await tiny.app.shell.open(await api.openAttachment(a.id));
  } catch (e) {
    toast({ title: "Couldn't open it", content: errorMessage(e), tone: 'error' });
  }
}

async function saveCopy(a: Attachment) {
  const ext = a.name.slice(a.name.lastIndexOf('.') + 1);
  const path = await tiny.dialog.saveFile({ types: [ext], name: a.name });
  if (!path) return;
  try {
    const dest = await api.saveAttachmentCopy(a.id, path);
    toast({ title: 'Saved', content: dest.slice(dest.lastIndexOf('/') + 1), tone: 'success', actions: [{ label: 'Show', onAction: () => void tiny.app.shell.reveal(dest) }] });
  } catch (e) {
    toast({ title: "Couldn't save it", content: errorMessage(e), tone: 'error' });
  }
}

async function remove(a: Attachment) {
  const ok = await confirmModal({
    title: `Remove ${a.name}?`,
    content: "The file is deleted from the books. This can't be undone.",
    primaryActionLabel: 'Remove',
    primaryActionType: 'destructive',
    secondaryActionLabel: 'Cancel',
  });
  if (!ok) return;
  try {
    await api.deleteAttachment(a.id);
    await load();
    emit('changed');
  } catch (e) {
    toast({ title: errorMessage(e), tone: 'error' });
  }
}

const iconFor = (mime: string) => (mime === 'application/pdf' ? 'mdi:file-pdf-box' : 'mdi:file-image-outline');
const pendingSize = (f: AttachmentFile) => sizeText(Math.round((f.data.length * 3) / 4));
</script>

<template>
  <div class="Att">
    <ul v-if="list.length || pending.length" class="Att__list">
      <li v-for="a in list" :key="a.id" class="Att__item">
        <button type="button" class="Att__open" :title="`Open ${a.name}`" @click="view(a)">
          <Icon :icon="iconFor(a.mime)" class="Att__icon" />
          <span class="Att__name">{{ a.name }}</span>
          <span class="subdued Att__size">{{ sizeText(a.size) }}</span>
        </button>
        <Button type="plain" size="small" icon="mdi:download-outline" tooltip="Save a copy" @click="saveCopy(a)" />
        <Button type="plain" size="small" icon="mdi:close" tooltip="Remove" @click="remove(a)" />
      </li>
      <li v-for="(f, i) in pending" :key="'p' + i" class="Att__item">
        <span class="Att__open">
          <Icon :icon="iconFor(f.mime)" class="Att__icon" />
          <span class="Att__name">{{ f.name }}</span>
          <span class="subdued Att__size">{{ pendingSize(f) }} · attached when saved</span>
        </span>
        <Button type="plain" size="small" icon="mdi:close" tooltip="Remove" @click="pending = pending.filter((_, j) => j !== i)" />
      </li>
    </ul>
    <div class="Att__add">
      <Button size="small" icon="mdi:paperclip" :loading="busy" @click="pick">{{ label }}</Button>
      <span class="subdued Att__hint">or drop a PDF or photo on the window</span>
    </div>

    <Modal :visible="!!preview" :title="preview?.name ?? ''" size="large" @close="preview = null">
      <ModalSection>
        <img v-if="preview" :src="preview.src" :alt="preview.name" class="Att__preview" />
      </ModalSection>
    </Modal>
  </div>
</template>

<style scoped>
.Att {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.Att__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.Att__item {
  display: flex;
  align-items: center;
  gap: 4px;
}

.Att__open {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 6px;
  border: 0;
  border-radius: 6px;
  background: none;
  font: inherit;
  color: var(--octans-text);
  text-align: left;
}

button.Att__open {
  cursor: pointer;
}

button.Att__open:hover {
  background: var(--octans-surface-hover);
}

.Att__icon {
  flex: none;
  font-size: 18px;
  color: var(--octans-text-subdued);
}

.Att__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.Att__size {
  flex: none;
  font-size: 12px;
}

.Att__add {
  display: flex;
  align-items: center;
  gap: 10px;
}

.Att__hint {
  font-size: 12px;
}

.Att__preview {
  display: block;
  max-width: 100%;
  max-height: 70vh;
  margin: 0 auto;
}
</style>
