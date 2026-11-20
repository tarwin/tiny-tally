<script setup lang="ts">
// The adding-machine tape on number fields (src/shared/tape.ts). In a field
// marked inputmode="decimal" (or "numeric") that holds a number, typing
// + − × ÷ at the end, or with it all selected, opens a tape under it: the number, then a line for the
// next, set out as a sum on paper. More operators add lines; Enter (or =, or
// Tab) puts the total in the field; Esc leaves it as it was. Letters can't be
// typed into these fields at all.
//
// Focus stays in the field the whole time and the tape only draws, so it
// works inside dialogs that hold focus. Keys are read here, captured on the
// window before the field or the dialog sees them.
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { amountText, cleanPasted } from '../shared/calc';
import { TAPE_OPS, lineValue, startValue, tapeResult, tapeTotal, type TapeLine, type TapeOp } from '../shared/tape';

const field = ref<HTMLInputElement | null>(null);
const lines = ref<TapeLine[]>([]);
const pos = ref<{ top?: number; bottom?: number; left: number }>({ left: 0 });
const box = ref<HTMLElement | null>(null);
const shake = ref(false);

const active = computed(() => !!field.value);
const current = computed(() => lines.value[lines.value.length - 1]);
const total = computed(() => tapeTotal(lines.value));

const OP_SIGNS: Record<TapeOp, string> = { '+': '+', '-': '−', '*': '×', '/': '÷' };
const STARTERS = new Set(['+', '-', '*', '/']);
/** What can be typed into a number field: digits, separators, signs, brackets, % and currency signs. */
const NUMBER_CHARS = /^[\d.,\-+*/%() $€£¥₹]$/u;

const group = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
/** A line as typed, with thousands grouped: "1234.5" reads "1,234.5". */
function shown(text: string) {
  if (!text) return '';
  const neg = text.startsWith('-');
  const [int, dec] = text.replace(/^-/, '').split('.');
  const head = int ? group.format(Number(int)) : '0';
  return `${neg ? '−' : ''}${head}${text.includes('.') ? `.${dec}` : ''}`;
}
const fmt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 10 });

/** A number field that takes a tape: marked as decimal, and not the calculator's own. */
function tapeField(el: EventTarget | null): el is HTMLInputElement {
  if (!(el instanceof HTMLInputElement) || el.readOnly || el.disabled) return false;
  if (el.type !== 'text' && el.type !== 'search' && el.type !== '') return false;
  if (el.closest('[data-no-tape]')) return false;
  return !!el.closest('[inputmode="decimal"], [inputmode="numeric"]');
}

function open(el: HTMLInputElement, op: TapeOp, start: string) {
  field.value = el;
  lines.value = [{ op: null, text: start }, { op, text: '' }];
  void nextTick(place);
}

function close() {
  field.value = null;
  lines.value = [];
}

/** Puts the total in the field, as if it had been typed, and closes. */
function apply() {
  const el = field.value;
  if (!el) return;
  const out = tapeResult(lines.value);
  if (out === null) {
    shake.value = true;
    setTimeout(() => (shake.value = false), 300);
    return false;
  }
  close();
  el.value = out;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.setSelectionRange(out.length, out.length);
  return true;
}

function setCurrent(text: string, pct = current.value.pct) {
  lines.value[lines.value.length - 1] = { ...current.value, text, pct };
}

function onKeydown(e: KeyboardEvent) {
  if (!active.value) {
    if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing || !tapeField(e.target)) return;
    // Number fields take numbers: letters and other symbols don't go in.
    if (e.key.length === 1 && !NUMBER_CHARS.test(e.key)) {
      e.preventDefault();
      return;
    }
    // Opening: an operator typed at the end of a number.
    if (!STARTERS.has(e.key)) return;
    const el = e.target;
    // At the end, or with it all selected (as on tabbing in): an operator carries on
    // from the number. A digit isn't caught, so it types over the selection as usual.
    const len = el.value.length;
    const atEnd = el.selectionStart === len && el.selectionEnd === len;
    const allSelected = el.selectionStart === 0 && el.selectionEnd === len;
    if (!atEnd && !allSelected) return;
    // A minus in an empty field is a negative number, not a sum.
    const start = startValue(el.value);
    if (start === null) return;
    e.preventDefault();
    e.stopPropagation();
    open(el, TAPE_OPS[e.key], start);
    return;
  }

  if (e.target !== field.value) return;
  // ⌘C, ⌘V and the like carry on as normal (paste is caught below).
  if (e.metaKey || e.ctrlKey) return;
  const key = e.key;
  if (key === 'Tab') {
    // Put the total in and let Tab move on; an unfinished sum is left out.
    if (!apply()) close();
    return;
  }
  if (key === 'Shift' || key === 'Alt' || key === 'CapsLock') return;
  e.preventDefault();
  e.stopPropagation();

  const text = current.value.text;
  if (key === 'Escape') return close();
  if (key === 'Enter' || key === '=') return void apply();
  if (/^\d$/.test(key)) return setCurrent(text + key);
  if (key === '.' && !text.includes('.')) return setCurrent(text + '.');
  if (key === '%' && lineValue(text) !== null && current.value.op) return setCurrent(text, !current.value.pct);
  if (key === 'Backspace') {
    if (current.value.pct) return setCurrent(text, false);
    if (text) return setCurrent(text.slice(0, -1));
    // An empty line goes, and the one above can be changed again.
    if (lines.value.length > 1) lines.value.pop();
    else close();
    return;
  }
  const op = TAPE_OPS[key];
  if (op) {
    // An operator on an empty line changes it (typed + but meant −).
    if (lineValue(text) === null) {
      if (lines.value.length > 1) lines.value[lines.value.length - 1] = { ...current.value, op };
      return;
    }
    lines.value.push({ op, text: '' });
    void nextTick(place);
  }
}

function onPaste(e: ClipboardEvent) {
  if (!active.value) {
    // Into a number field: "A$1,234.50" goes in as 1,234.50; text that isn't an amount doesn't go in.
    if (!tapeField(e.target)) return;
    const raw = e.clipboardData?.getData('text/plain') ?? '';
    // Anything that could be typed goes in as usual ("7.25 %" into a rate).
    if ([...raw.trim()].every((c) => NUMBER_CHARS.test(c) || /\s/.test(c))) return;
    const amount = amountText(raw);
    e.preventDefault();
    if (amount) e.target.setRangeText(amount.replace(/\s+/g, ''), e.target.selectionStart ?? 0, e.target.selectionEnd ?? 0, 'end');
    e.target.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }
  if (e.target !== field.value) return;
  e.preventDefault();
  e.stopPropagation();
  const text = cleanPasted(e.clipboardData?.getData('text/plain') ?? '');
  if (lineValue(text) !== null) setCurrent(text);
}

/** Clicked or tabbed away some other way: keep the sum if it's whole, else drop it. */
function onFocusOut(e: FocusEvent) {
  if (!active.value || e.target !== field.value) return;
  if (!apply()) close();
}

/** Under the field, right edges lined up; above it if there's no room below. */
function place() {
  const el = field.value;
  if (!el) return;
  if (!el.isConnected) return close();
  const r = (el.closest('[inputmode]') ?? el).getBoundingClientRect();
  const h = box.value?.offsetHeight ?? 120;
  const w = box.value?.offsetWidth ?? 200;
  const left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8));
  pos.value = r.bottom + 6 + h <= window.innerHeight ? { top: r.bottom + 6, left } : { bottom: window.innerHeight - r.top + 6, left };
}

let frame = 0;
function onMove() {
  if (!active.value) return;
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(place);
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown, true);
  window.addEventListener('paste', onPaste, true);
  window.addEventListener('focusout', onFocusOut, true);
  window.addEventListener('scroll', onMove, true);
  window.addEventListener('resize', onMove);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown, true);
  window.removeEventListener('paste', onPaste, true);
  window.removeEventListener('focusout', onFocusOut, true);
  window.removeEventListener('scroll', onMove, true);
  window.removeEventListener('resize', onMove);
  cancelAnimationFrame(frame);
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="active"
      ref="box"
      class="Tape"
      :class="{ 'Tape--shake': shake }"
      :style="{ top: pos.top !== undefined ? `${pos.top}px` : undefined, bottom: pos.bottom !== undefined ? `${pos.bottom}px` : undefined, left: `${pos.left}px` }"
      role="status"
      aria-live="polite"
    >
      <div v-for="(l, i) in lines" :key="i" class="Tape__line" :class="{ 'Tape__line--current': i === lines.length - 1 }">
        <span class="Tape__op">{{ l.op ? OP_SIGNS[l.op] : '' }}</span>
        <span class="Tape__num">
          {{ shown(l.text) }}<template v-if="l.pct">%</template><span v-if="i === lines.length - 1" class="Tape__caret" />
        </span>
      </div>
      <div class="Tape__rule" />
      <div class="Tape__line Tape__total">
        <span class="Tape__op">=</span>
        <span class="Tape__num">{{ total === null ? '—' : fmt.format(total) }}</span>
      </div>
      <div class="Tape__hint">Enter to use · Esc to cancel</div>
    </div>
  </Teleport>
</template>

<style scoped>
.Tape {
  position: fixed;
  z-index: 4000;
  min-width: 180px;
  max-width: 320px;
  padding: 8px 12px 6px;
  border: 1px solid var(--octans-border);
  border-radius: 8px;
  background: var(--octans-surface-raised);
  box-shadow: 0 6px 20px rgb(0 0 0 / 0.18);
  color: var(--octans-text);
  font-variant-numeric: tabular-nums;
  pointer-events: none;
}

.Tape--shake {
  animation: tape-shake 0.3s;
}

@keyframes tape-shake {
  25% { translate: -4px 0; }
  75% { translate: 4px 0; }
}

.Tape__line {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  font-size: 15px;
  line-height: 1.5;
}

.Tape__op {
  width: 1em;
  color: var(--octans-text-subdued);
  font-weight: 600;
}

.Tape__line--current .Tape__op {
  color: var(--octans-text-primary);
}

.Tape__num {
  text-align: right;
  white-space: nowrap;
}

.Tape__caret {
  display: inline-block;
  width: 1px;
  height: 1.1em;
  margin-left: 1px;
  vertical-align: text-bottom;
  background: var(--octans-text);
  animation: tape-blink 1s steps(1) infinite;
}

@keyframes tape-blink {
  50% { opacity: 0; }
}

.Tape__rule {
  margin: 3px 0 2px;
  border-top: 1px solid var(--octans-text);
}

.Tape__total {
  font-weight: 700;
}

.Tape__hint {
  margin-top: 4px;
  color: var(--octans-text-subdued);
  font-size: 11px;
  text-align: right;
}
</style>
