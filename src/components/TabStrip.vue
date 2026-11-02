<script setup lang="ts">
// The row of tabs under the top bar, shown once a window has more than one.
// Drag a tab sideways to reorder it, or out of the window to give it a
// window of its own. Right-click for the rest.
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { Icon } from '@octans/ui';
import { activateTab, closeOtherTabs, closeTab, moveTab, moveTabToNewWindow, openTab, tabs } from '../lib/tabs';

const strip = ref<HTMLElement | null>(null);

// ---- dragging ------------------------------------------------------------------

/** How far past the strip a tab must be let go to leave the window. */
const OUT = 48;
const drag = ref<{ id: number; x: number; y: number; moved: boolean; outside: boolean } | null>(null);

function down(e: PointerEvent, id: number) {
  if (e.button !== 0 || (e.target as Element).closest('.Tab__close')) return;
  activateTab(id);
  drag.value = { id, x: e.clientX, y: e.clientY, moved: false, outside: false };
  // Keeps the pointer's events coming here when it leaves the window.
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
}

function move(e: PointerEvent) {
  const d = drag.value;
  if (!d || !strip.value) return;
  if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5) return;
  d.moved = true;
  const r = strip.value.getBoundingClientRect();
  d.outside =
    tabs.list.length > 1 &&
    (e.clientY < r.top - OUT || e.clientY > r.bottom + OUT || e.clientX < 0 || e.clientX > window.innerWidth);
  if (d.outside) return;
  // Reorder: the tab takes the place of whichever one the pointer is over.
  const over = [...strip.value.querySelectorAll<HTMLElement>('[data-tab]')].findIndex((el) => {
    const b = el.getBoundingClientRect();
    return e.clientX >= b.left && e.clientX < b.right;
  });
  if (over >= 0) moveTab(d.id, over);
}

function up() {
  const d = drag.value;
  drag.value = null;
  if (d?.outside) void moveTabToNewWindow(d.id, true);
}

// ---- right-click menu ---------------------------------------------------------------

// The native right-click menu is the app's own while the pointer is over a tab.
const hovered = ref<number | null>(null);

function enter(id: number) {
  hovered.value = id;
  void tiny.menu.setContext([
    { id: 'tab-new', label: 'New Tab' },
    { id: 'tab-window', label: 'Move Tab to New Window' },
    { separator: true },
    { id: 'tab-close', label: 'Close Tab' },
    { id: 'tab-others', label: 'Close Other Tabs' },
  ]);
}

function leave() {
  hovered.value = null;
  void tiny.menu.setContext(null);
}

let off: (() => void) | null = null;
onMounted(() => {
  off = tiny.menu.onContext((item) => {
    const id = hovered.value;
    if (id === null) return;
    if (item === 'tab-new') openTab();
    else if (item === 'tab-window') void moveTabToNewWindow(id);
    else if (item === 'tab-close') closeTab(id);
    else if (item === 'tab-others') closeOtherTabs(id);
  });
});
onBeforeUnmount(() => {
  off?.();
  if (hovered.value !== null) leave();
});
</script>

<template>
  <div ref="strip" class="Tabs" role="tablist" :class="{ 'Tabs--out': drag?.outside }" @dblclick.self="openTab()">
    <div
      v-for="t in tabs.list"
      :key="t.id"
      data-tab
      role="tab"
      class="Tab"
      :class="{ 'Tab--active': t.id === tabs.activeId, 'Tab--dragging': drag?.id === t.id && drag.moved }"
      :aria-selected="t.id === tabs.activeId"
      :title="t.title"
      @pointerdown="down($event, t.id)"
      @pointermove="move"
      @pointerup="up"
      @lostpointercapture="drag = null"
      @pointerenter="enter(t.id)"
      @pointerleave="leave"
      @auxclick.prevent="$event.button === 1 && closeTab(t.id)"
    >
      <span class="Tab__title">{{ t.title }}</span>
      <button type="button" class="Tab__close" :aria-label="`Close ${t.title}`" title="Close Tab" @click.stop="closeTab(t.id)">
        <Icon icon="mdi:close" />
      </button>
    </div>
    <button type="button" class="Tabs__new" aria-label="New Tab" title="New Tab" @click="openTab()">
      <Icon icon="mdi:plus" />
    </button>
    <span v-if="drag?.outside" class="Tabs__hint">Let go to open it in a new window</span>
  </div>
</template>

<style scoped>
.Tabs {
  flex: none;
  display: flex;
  align-items: stretch;
  gap: 2px;
  height: 34px;
  padding: 4px 8px 0;
  box-sizing: border-box;
  background: var(--octans-surface-app);
  border-bottom: 1px solid var(--octans-border);
  user-select: none;
  position: relative;
}

.Tab {
  flex: 1 1 0;
  min-width: 60px;
  max-width: 220px;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 4px 0 12px;
  border: 1px solid transparent;
  border-bottom: 0;
  border-radius: 8px 8px 0 0;
  font-size: 13px;
  color: var(--octans-text-subdued);
  cursor: default;
}

.Tab:hover {
  background: var(--octans-surface-hover);
}

.Tab--active,
.Tab--active:hover {
  background: var(--octans-surface);
  border-color: var(--octans-border);
  color: var(--octans-text);
  /* Sits over the strip's bottom border, joined to the page. */
  margin-bottom: -1px;
}

.Tab--dragging {
  opacity: 0.85;
  box-shadow: var(--octans-shadow-sm);
}

.Tabs--out .Tab--dragging {
  opacity: 0.4;
}

.Tab__title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.Tab__close,
.Tabs__new {
  flex: none;
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: none;
  color: var(--octans-text-subdued);
  font-size: 14px;
  cursor: pointer;
}

.Tab__close {
  visibility: hidden;
}

.Tab:hover .Tab__close,
.Tab--active .Tab__close {
  visibility: visible;
}

.Tab__close:hover,
.Tabs__new:hover {
  background: var(--octans-surface-hover);
  color: var(--octans-text);
}

.Tabs__new {
  align-self: center;
  margin-left: 2px;
}

.Tabs__hint {
  position: absolute;
  right: 12px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 12px;
  color: var(--octans-text-subdued);
}
</style>
