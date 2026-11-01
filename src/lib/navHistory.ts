import { computed, reactive, watch } from 'vue';
import { router } from '../router';
import { session } from './session';

/**
 * Back and forward for the top bar. Kept here rather than read from the
 * browser's history, which can't say whether forward is possible and would
 * step back into a set of books this window no longer has open.
 */
const nav = reactive({ stack: [] as string[], index: -1 });
let stepping = false;

router.afterEach((to, _from, failure) => {
  if (failure || stepping) {
    stepping = false;
    return;
  }
  if (nav.stack[nav.index] === to.fullPath) return;
  if ((window.history.state as { replaced?: boolean } | null)?.replaced && nav.index >= 0) {
    nav.stack[nav.index] = to.fullPath;
    return;
  }
  nav.stack.splice(nav.index + 1, Infinity, to.fullPath);
  nav.index = nav.stack.length - 1;
});

// Other books, other pages: start again.
watch(
  () => session.books?.path,
  () => {
    nav.stack = [router.currentRoute.value.fullPath];
    nav.index = 0;
  },
);

export const canGoBack = computed(() => nav.index > 0);
export const canGoForward = computed(() => nav.index < nav.stack.length - 1);

function step(by: number) {
  const target = nav.stack[nav.index + by];
  if (target === undefined) return;
  nav.index += by;
  stepping = true;
  void router.push(target).catch(() => (stepping = false));
}

export const goBack = () => step(-1);
export const goForward = () => step(1);
