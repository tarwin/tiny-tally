<script setup lang="ts">
// A quick calculator over everything (Go › Calculator). Type a sum, or click
// the keys; Enter (or =) works it out. ⌘C with nothing selected copies the
// answer, and pasted amounts lose their currency signs and commas. Esc closes
// it and focus goes back to where it was. Drag it by its title bar; it opens
// where it was left (double-click the title bar to centre it again).
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { Modal, ModalSection } from '@octans/ui';
import { calculator, closeCalculator, restoreFocus } from '../lib/calculator';
import { cleanPasted, evaluate, plainNumber } from '../shared/calc';

const isMac = tiny.system.isMacOS();
const input = ref<HTMLInputElement | null>(null);
const expr = ref('');
/** Just worked out: a digit starts a new sum, an operator carries on from the answer. */
const fresh = ref(false);
const copied = ref(false);

// ---- position ----------------------------------------------------------------------

const POS_KEY = 'calculatorPos';
/** Where it was dragged to, from where the dialog would put it. Kept as chosen. */
const wanted = ref({ x: 0, y: 0 });
/** Where it's drawn: `wanted`, pulled in to fit the window as it is now. */
const offset = ref({ x: 0, y: 0 });
let posLoaded = false;
const dialogStyle = computed(() => ({ width: '320px', translate: `${offset.value.x}px ${offset.value.y}px` }));

function dialogEl() {
  return input.value?.closest<HTMLElement>('[role="dialog"]') ?? null;
}

/** The title bar: the element holding the dialog's title. */
function headerEl(dialog: HTMLElement) {
  const id = dialog.getAttribute('aria-labelledby');
  return (id && document.getElementById(id)?.parentElement) || null;
}

/**
 * Pulls a position in so the title bar is on screen, with at least 80px of the
 * calculator showing across: enough to grab it and drag it back.
 */
function clamp(o: { x: number; y: number }, dialog: HTMLElement) {
  const r = dialog.getBoundingClientRect();
  // Where the dialog sits unmoved. offsetWidth, not the rect, so the opening animation's scale doesn't count.
  const w = dialog.offsetWidth;
  const base = { left: r.left + (r.width - w) / 2 - offset.value.x, top: r.top - offset.value.y };
  const head = headerEl(dialog)?.offsetHeight ?? 48;
  const keep = Math.min(80, w);
  const x = Math.min(Math.max(o.x, -base.left - w + keep), window.innerWidth - base.left - keep);
  const y = Math.min(Math.max(o.y, -base.top), window.innerHeight - base.top - head);
  return { x: Math.round(x), y: Math.round(y) };
}

/** Draws it at the chosen place, or as near as fits. */
function fit() {
  const dialog = dialogEl();
  if (dialog && calculator.visible) offset.value = clamp(wanted.value, dialog);
}

function savePos() {
  void tiny.store.set(POS_KEY, { ...wanted.value }).catch(() => {});
}

let drag: { startX: number; startY: number; from: { x: number; y: number }; dialog: HTMLElement } | null = null;

function onPointerDown(e: PointerEvent) {
  const dialog = dialogEl();
  const header = dialog && headerEl(dialog);
  if (e.button !== 0 || !dialog || !header?.contains(e.target as Node) || (e.target as Element).closest('button')) return;
  e.preventDefault();
  drag = { startX: e.clientX, startY: e.clientY, from: { ...offset.value }, dialog };
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp, { once: true });
}

function onPointerMove(e: PointerEvent) {
  if (!drag) return;
  offset.value = clamp({ x: drag.from.x + e.clientX - drag.startX, y: drag.from.y + e.clientY - drag.startY }, drag.dialog);
}

function onPointerUp() {
  window.removeEventListener('pointermove', onPointerMove);
  if (!drag) return;
  drag = null;
  // Dragged: where it is now is the new choice.
  wanted.value = { ...offset.value };
  savePos();
  focusInput();
}

function onDblClick(e: MouseEvent) {
  const dialog = dialogEl();
  if (!dialog || !headerEl(dialog)?.contains(e.target as Node) || (e.target as Element).closest('button')) return;
  wanted.value = { x: 0, y: 0 };
  fit();
  savePos();
  focusInput();
}

// Refit when the window changes size (or zoom), or the calculator does (history rows).
let resizeObs: ResizeObserver | null = null;

/** Set up the title bar once the dialog is there. */
function attachDrag() {
  const dialog = dialogEl();
  if (!dialog) return;
  if (!dialog.dataset.calcDrag) {
    dialog.dataset.calcDrag = '1';
    const header = headerEl(dialog);
    if (header) {
      header.style.cursor = 'move';
      header.style.userSelect = 'none';
      header.title = 'Drag to move. Double-click to centre.';
    }
    dialog.addEventListener('pointerdown', onPointerDown);
    dialog.addEventListener('dblclick', onDblClick);
    resizeObs?.disconnect();
    resizeObs = new ResizeObserver(() => fit());
    resizeObs.observe(dialog);
  }
  fit();
}

window.addEventListener('resize', fit);

onBeforeUnmount(() => {
  window.removeEventListener('resize', fit);
  window.removeEventListener('pointermove', onPointerMove);
  resizeObs?.disconnect();
});

const live = computed(() => evaluate(expr.value));
const shown = computed(() => (live.value === null ? null : format(live.value)));

const fmt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 10 });
function format(n: number) {
  return fmt.format(n);
}

function focusInput() {
  const el = input.value;
  if (!el) return;
  el.focus({ preventScroll: true });
}

watch(
  () => calculator.visible,
  async (v) => {
    if (!v) return;
    copied.value = false;
    if (!posLoaded) {
      posLoaded = true;
      const saved = (await tiny.store.get(POS_KEY).catch(() => null)) as { x?: unknown; y?: unknown } | null;
      if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) wanted.value = { x: saved.x as number, y: saved.y as number };
    }
    await nextTick();
    attachDrag();
    focusInput();
    input.value?.select();
    fresh.value = true;
  },
);

function onAfterEnter() {
  attachDrag();
  // The dialog's focus trap may have put focus on its first button.
  if (document.activeElement !== input.value) {
    focusInput();
    input.value?.select();
  }
}

/** Puts text where the cursor is, replacing any selection. */
function insert(text: string) {
  const el = input.value;
  if (!el) return;
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  el.setRangeText(text, start, end, 'end');
  expr.value = el.value;
  copied.value = false;
}

const OPERATOR = /^[+\-*/×÷%−]$/;

function equals() {
  const r = live.value;
  if (r === null) return;
  if (expr.value.trim() !== plainNumber(r)) {
    calculator.history.unshift({ expr: expr.value.trim(), result: r });
    calculator.history.splice(6);
  }
  expr.value = plainNumber(r);
  void nextTick(() => {
    input.value?.select();
    fresh.value = true;
  });
}

/** A key from the pad or the keyboard: an operator after an answer carries on from it. */
function beforeKey(text: string) {
  const el = input.value;
  if (fresh.value && el && OPERATOR.test(text)) el.setSelectionRange(el.value.length, el.value.length);
  fresh.value = false;
}

function press(text: string) {
  beforeKey(text);
  insert(text);
  focusInput();
}

function clearAll() {
  expr.value = '';
  fresh.value = false;
  copied.value = false;
  focusInput();
}

function backspace() {
  const el = input.value;
  if (!el) return;
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? start;
  if (start !== end) el.setRangeText('', start, end, 'end');
  else if (start > 0) el.setRangeText('', start - 1, start, 'end');
  expr.value = el.value;
  fresh.value = false;
  focusInput();
}

async function copyAnswer() {
  const r = live.value ?? calculator.history[0]?.result;
  if (r === undefined || r === null) return;
  await tiny.clipboard.write({ text: plainNumber(r) }).catch(() => navigator.clipboard?.writeText(plainNumber(r)));
  copied.value = true;
  focusInput();
}

function onKeydown(e: KeyboardEvent) {
  const mod = isMac ? e.metaKey : e.ctrlKey;
  const el = e.target as HTMLInputElement;
  if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'c' && el.selectionStart === el.selectionEnd) {
    // Nothing selected: copy the answer.
    e.preventDefault();
    void copyAnswer();
    return;
  }
  if (e.key === 'Enter' || (e.key === '=' && !mod)) {
    e.preventDefault();
    equals();
    return;
  }
  if (mod || e.altKey) return;
  if (e.key.length === 1) {
    // x and * are both times; letters and anything else don't go in.
    const key = e.key === 'x' || e.key === 'X' ? '×' : e.key;
    e.preventDefault();
    if (/^[0-9.,+\-*/×÷%() ]$/.test(key)) press(key);
  } else if (e.key === 'Backspace' || e.key === 'Delete') {
    fresh.value = false;
  }
}

function onInput() {
  expr.value = input.value?.value ?? '';
  copied.value = false;
  fresh.value = false;
}

async function onPaste(e: ClipboardEvent) {
  e.preventDefault();
  let text = e.clipboardData?.getData('text/plain') ?? '';
  if (!text) text = (await tiny.clipboard.read().catch(() => null))?.text ?? '';
  const clean = cleanPasted(text);
  if (!clean) return;
  beforeKey(clean[0]);
  insert(clean);
}

function useHistory(h: { expr: string; result: number }) {
  beforeKey('0');
  insert(plainNumber(h.result));
  focusInput();
}

const KEYS: { label: string; text?: string; act?: () => void; kind?: string; title?: string }[] = [
  { label: 'C', act: clearAll, kind: 'fn', title: 'Clear' },
  { label: '(', text: '(', kind: 'fn' },
  { label: ')', text: ')', kind: 'fn' },
  { label: '÷', text: '÷', kind: 'op' },
  { label: '7', text: '7' }, { label: '8', text: '8' }, { label: '9', text: '9' },
  { label: '×', text: '×', kind: 'op' },
  { label: '4', text: '4' }, { label: '5', text: '5' }, { label: '6', text: '6' },
  { label: '−', text: '-', kind: 'op' },
  { label: '1', text: '1' }, { label: '2', text: '2' }, { label: '3', text: '3' },
  { label: '+', text: '+', kind: 'op' },
  { label: '%', text: '%', kind: 'fn' },
  { label: '0', text: '0' },
  { label: '.', text: '.' },
  { label: '=', act: equals, kind: 'eq' },
];
</script>

<template>
  <Modal
    :visible="calculator.visible"
    title="Calculator"
    :dialog-style="dialogStyle"
    @close="closeCalculator"
    @after-enter="onAfterEnter"
    @after-leave="restoreFocus"
  >
    <ModalSection>
      <div class="Calc">
        <div class="Calc__screen">
          <input
            ref="input"
            :value="expr"
            class="Calc__input"
            inputmode="decimal"
            data-no-tape
            spellcheck="false"
            autocomplete="off"
            aria-label="Sum"
            placeholder="0"
            @keydown="onKeydown"
            @input="onInput"
            @paste="onPaste"
          />
          <div class="Calc__result" aria-live="polite">
            <template v-if="shown !== null && expr.trim() !== plainNumber(live!)">= {{ shown }}</template>
            <template v-else-if="expr.trim() && live === null"><span class="subdued">…</span></template>
            &nbsp;
          </div>
        </div>

        <!-- The pad keeps focus in the sum: mousedown is stopped so clicks don't take it. -->
        <div class="Calc__pad" @mousedown.prevent>
          <button
            v-for="k in KEYS"
            :key="k.label"
            type="button"
            tabindex="-1"
            class="Calc__key"
            :class="k.kind && `Calc__key--${k.kind}`"
            :title="k.title"
            @click="k.act ? k.act() : press(k.text!)"
          >
            {{ k.label }}
          </button>
        </div>

        <div class="Calc__bar" @mousedown.prevent>
          <button type="button" tabindex="-1" class="Calc__link" @click="backspace">⌫ Delete</button>
          <button type="button" tabindex="-1" class="Calc__link" :disabled="live === null && !calculator.history.length" @click="copyAnswer">
            {{ copied ? 'Copied' : `Copy answer (${isMac ? '⌘C' : 'Ctrl C'})` }}
          </button>
        </div>

        <ul v-if="calculator.history.length" class="Calc__history" @mousedown.prevent>
          <li v-for="(h, i) in calculator.history" :key="i">
            <button type="button" tabindex="-1" :title="'Use ' + format(h.result)" @click="useHistory(h)">
              <span class="subdued">{{ h.expr }} =</span>
              <span class="money">{{ format(h.result) }}</span>
            </button>
          </li>
        </ul>
      </div>
    </ModalSection>
  </Modal>
</template>

<style scoped>
.Calc {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.Calc__screen {
  border: 1px solid var(--octans-border);
  border-radius: 8px;
  background: var(--octans-surface-sunken);
  padding: 8px 10px 6px;
}

.Calc__screen:focus-within {
  border-color: var(--octans-border-focus);
}

.Calc__input {
  width: 100%;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--octans-text);
  font: inherit;
  font-size: 22px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.Calc__result {
  min-height: 18px;
  text-align: right;
  color: var(--octans-text-subdued);
  font-variant-numeric: tabular-nums;
}

.Calc__pad {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
}

.Calc__key {
  height: 40px;
  border: 1px solid var(--octans-border);
  border-radius: 8px;
  background: var(--octans-surface);
  color: var(--octans-text);
  font: inherit;
  font-size: 16px;
  cursor: pointer;
}

.Calc__key:hover {
  background: var(--octans-surface-hover);
}

.Calc__key--fn,
.Calc__key--op {
  background: var(--octans-surface-sunken);
}

.Calc__key--op {
  font-weight: 600;
}

.Calc__key--eq {
  background: var(--octans-primary);
  border-color: var(--octans-primary);
  color: #fff;
  font-weight: 600;
}

.Calc__key--eq:hover {
  background: var(--octans-primary);
  filter: brightness(1.08);
}

.Calc__bar {
  display: flex;
  justify-content: space-between;
}

.Calc__link {
  border: 0;
  background: none;
  padding: 2px 0;
  color: var(--octans-text-link);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.Calc__link:disabled {
  color: var(--octans-text-subdued);
  cursor: default;
}

.Calc__history {
  list-style: none;
  margin: 0;
  padding: 6px 0 0;
  border-top: 1px solid var(--octans-border);
}

.Calc__history button {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  border: 0;
  border-radius: 6px;
  background: none;
  padding: 4px 6px;
  color: var(--octans-text);
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.Calc__history button:hover {
  background: var(--octans-surface-hover);
}

.Calc__history .subdued {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
