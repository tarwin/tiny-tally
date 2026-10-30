<script setup lang="ts">
// Shows an A4 page scaled down to fit its column, so the whole width is always
// visible. With `zoomable`, the page can be zoomed in (buttons, or pinch /
// ⌘-scroll) and then scrolls inside the frame.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { Button } from '@octans/ui';

const props = defineProps<{ zoomable?: boolean }>();

const A4_PX = 794; // 210mm at 96dpi
const STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2];

const host = ref<HTMLElement | null>(null);
const fit = ref(0.75);
/** null = fit the width. */
const zoom = ref<number | null>(null);
const scale = computed(() => zoom.value ?? fit.value);
let observer: ResizeObserver | undefined;

onMounted(() => {
  // Applied a frame later: rescaling changes the page height, which can toggle a
  // scrollbar and resize us again inside the same observer callback.
  observer = new ResizeObserver(([entry]) => {
    const next = Math.min(1, Math.max(0.3, Math.floor((entry.contentRect.width / A4_PX) * 100) / 100));
    if (next !== fit.value) requestAnimationFrame(() => (fit.value = next));
  });
  if (host.value) observer.observe(host.value);
});
onBeforeUnmount(() => observer?.disconnect());

function step(dir: 1 | -1) {
  const now = scale.value;
  const next = dir > 0 ? STEPS.find((s) => s > now + 0.01) : [...STEPS].reverse().find((s) => s < now - 0.01);
  if (next) zoom.value = next;
}

// Trackpad pinch arrives as a wheel event with ctrlKey; ⌘-scroll is handled the same way.
function onWheel(e: WheelEvent) {
  if (!props.zoomable || !(e.ctrlKey || e.metaKey)) return;
  e.preventDefault();
  zoom.value = Math.min(2, Math.max(0.3, Math.round(scale.value * Math.exp(-e.deltaY / 200) * 100) / 100));
}
</script>

<template>
  <div class="Wrap">
    <div v-if="zoomable" class="Zoom">
      <Button size="small" icon="mdi:magnify-minus-outline" tooltip="Zoom out" :disabled="scale <= STEPS[0]" @click="step(-1)" />
      <span class="Zoom__value">{{ Math.round(scale * 100) }}%</span>
      <Button size="small" icon="mdi:magnify-plus-outline" tooltip="Zoom in" :disabled="scale >= STEPS[STEPS.length - 1]" @click="step(1)" />
      <Button size="small" :pressed="zoom === null" @click="zoom = null">Fit</Button>
      <Button size="small" :pressed="zoom === 1" @click="zoom = 1">100%</Button>
    </div>
    <div ref="host" class="Paper" :class="{ 'Paper--zoomed': zoom !== null && zoom > fit }" @wheel="onWheel">
      <div class="Paper__sheet" :style="{ zoom: scale }">
        <slot />
      </div>
    </div>
  </div>
</template>

<style scoped>
.Wrap {
  min-width: 0;
}

.Zoom {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  margin-bottom: 8px;
}

.Zoom__value {
  min-width: 44px;
  text-align: center;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--octans-text-subdued);
}

.Paper {
  min-width: 0;
  overflow: hidden;
}

/* Zoomed past the column: scroll inside a frame the height of the window. */
.Paper--zoomed {
  overflow: auto;
  max-height: calc(100vh - 170px);
  border-radius: 8px;
}

.Paper__sheet {
  width: max-content;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.18);
}
</style>
