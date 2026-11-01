<script setup lang="ts">
// The bar across the top of the window: back/forward and search, in the
// books' colour. On macOS the window has no title bar (tinyjs.json), so this
// is what you drag, and the traffic lights sit in its left end.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { GlobalNav, Icon } from '@octans/ui';
import GlobalSearch from './GlobalSearch.vue';
import { canGoBack, canGoForward, goBack, goForward } from '../lib/navHistory';
import { session } from '../lib/session';

const isMac = tiny.system.isMacOS();
const search = ref<InstanceType<typeof GlobalSearch> | null>(null);

// Full screen hides the traffic lights, so their space goes too.
const fullscreen = ref(false);
let off: (() => void) | undefined;
onMounted(async () => {
  if (!isMac) return;
  fullscreen.value = !!(await tiny.win.getState().catch(() => null))?.fullscreen;
  off = tiny.win.onState((s) => {
    if (s.win === tiny.win.id && typeof s.fullscreen === 'boolean') fullscreen.value = s.fullscreen;
  });
});
onBeforeUnmount(() => off?.());

/** '#rrggbb' → white or near-black text, whichever reads better on it. */
function textOn(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // Contrast against white vs against #1d1f24 (luminance ≈ 0.013).
  return (1.05 / (lum + 0.05) >= (lum + 0.05) / 0.063) ? '#ffffff' : '#1d1f24';
}

// Books without a colour keep the theme's own bar colour.
const colours = computed(() => {
  const c = session.books?.color;
  return c ? { '--octans-surface-nav': c, '--octans-text-on-nav': textOn(c) } : {};
});

const backKey = isMac ? '⌘[' : 'Ctrl+[';
const forwardKey = isMac ? '⌘]' : 'Ctrl+]';

defineExpose({ focusSearch: () => search.value?.focus() });
</script>

<template>
  <div class="TopBar" :class="{ 'TopBar--lights': isMac && !fullscreen }" :style="colours" data-tiny-drag>
    <GlobalNav logo>
      <template #logo>
        <div class="TopBar__side">
          <button type="button" class="TopBar__btn" :disabled="!canGoBack" :title="`Back (${backKey})`" aria-label="Back" @click="goBack">
            <Icon icon="mdi:arrow-left" />
          </button>
          <button type="button" class="TopBar__btn" :disabled="!canGoForward" :title="`Forward (${forwardKey})`" aria-label="Forward" @click="goForward">
            <Icon icon="mdi:arrow-right" />
          </button>
        </div>
      </template>
      <template #center>
        <GlobalSearch ref="search" />
      </template>
      <template #actions>
        <!-- Balances the left side so the search sits in the middle. -->
        <div class="TopBar__side TopBar__side--end" />
      </template>
    </GlobalNav>
  </div>
</template>

<style scoped>
.TopBar {
  user-select: none;
}

/* Room for the traffic lights (tinyjs.json windowControlsPos). */
.TopBar--lights :deep([class*='GlobalNav_bar']) {
  padding-left: 76px;
}

.TopBar__side {
  display: flex;
  align-items: center;
  gap: 2px;
  width: 120px;
  flex: none;
}

.TopBar--lights .TopBar__side--end {
  width: 186px;
}

.TopBar__btn {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: none;
  color: inherit;
  font-size: 18px;
}

.TopBar__btn:not(:disabled):hover {
  background: color-mix(in srgb, currentColor 16%, transparent);
}

.TopBar__btn:disabled {
  opacity: 0.4;
}
</style>
