import { reactive } from 'vue';

// The calculator (Go › Calculator). App.vue renders it, over everything,
// dialogs included. It remembers what had focus and gives it back on close.
export const calculator = reactive({
  visible: false,
  /** Recent sums, newest first, for this session. */
  history: [] as { expr: string; result: number }[],
});

let returnTo: HTMLElement | null = null;

export function openCalculator() {
  if (calculator.visible) return;
  const el = document.activeElement;
  returnTo = el instanceof HTMLElement && el !== document.body ? el : null;
  calculator.visible = true;
}

export function closeCalculator() {
  calculator.visible = false;
}

export function toggleCalculator() {
  if (calculator.visible) closeCalculator();
  else openCalculator();
}

/** After it's gone: focus back where it was, if that's still on the page. */
export function restoreFocus() {
  const el = returnTo;
  returnTo = null;
  if (el?.isConnected) el.focus({ preventScroll: true });
}
