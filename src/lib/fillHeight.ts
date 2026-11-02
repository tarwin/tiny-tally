// Tables that scroll inside themselves: a DataTable's max-height set to the
// room left between its top edge and the bottom of the window, so the page
// stays put and only the rows move. Measured, because Page doesn't lay out
// to the window's height.
import { onActivated, onBeforeUnmount, onMounted, ref, type Ref } from 'vue';

function scrollParent(el: HTMLElement) {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const { overflowY } = getComputedStyle(p);
    if (overflowY === 'auto' || overflowY === 'scroll') return p;
  }
  return null;
}

/**
 * `fill` is an element wrapping the table (its template ref); pass the
 * returned `maxHeight` on to the table. `below` is the space to leave under it (the page's bottom padding, a
 * card's); `min` keeps a usable table in a short window, where the page
 * scrolls instead.
 */
export function useFillHeight(fill: Ref<HTMLElement | null>, { below = 24, min = 260 } = {}) {
  const maxHeight = ref<number | undefined>(undefined);
  let scroller: HTMLElement | null = null;
  let observer: ResizeObserver | null = null;

  function measure() {
    const el = fill.value;
    if (!el?.isConnected) return;
    scroller ??= scrollParent(el);
    const bottom = scroller ? scroller.getBoundingClientRect().bottom : window.innerHeight;
    // Where the top would be with the page scrolled to the top.
    const top = el.getBoundingClientRect().top + (scroller?.scrollTop ?? 0);
    maxHeight.value = Math.max(min, Math.floor(bottom - top - below));
  }

  onMounted(() => {
    measure();
    observer = new ResizeObserver(() => measure());
    if (scroller) observer.observe(scroller);
    // Filters above the table wrapping onto another line move it down.
    if (fill.value?.parentElement) observer.observe(fill.value.parentElement);
    window.addEventListener('resize', measure);
  });
  onActivated(measure);
  onBeforeUnmount(() => {
    observer?.disconnect();
    window.removeEventListener('resize', measure);
  });

  return maxHeight;
}
