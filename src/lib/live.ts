// Keeping open pages current. The backend announces every change to the books
// ("books-changed", main.ts) to each window showing them, this one included,
// so pages reload whoever made the change: this tab, another tab or another
// window. A tab that isn't showing waits and catches up when it's shown.
import { getCurrentInstance, onActivated, onDeactivated, ref, watch, type Ref } from 'vue';

/** Goes up once per burst of changes to this window's books. */
export const booksVersion = ref(0);

let timer: ReturnType<typeof setTimeout> | null = null;

/** Called for each announcement; a burst (an import saving many rows) reloads once. */
export function booksChanged() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    booksVersion.value++;
  }, 30);
}

/** booksVersion as this page sees it: frozen while its tab is hidden, caught up when shown again. */
export function useBooksVersion(): Ref<number> {
  const seen = ref(booksVersion.value);
  let active = true;
  watch(booksVersion, (v) => {
    if (active) seen.value = v;
  });
  if (getCurrentInstance()) {
    onDeactivated(() => (active = false));
    onActivated(() => {
      active = true;
      if (seen.value !== booksVersion.value) seen.value = booksVersion.value;
    });
  }
  return seen;
}

/** Runs `fn` when the books change (see useBooksVersion). */
export function onBooksChanged(fn: () => unknown) {
  watch(useBooksVersion(), () => void fn());
}
