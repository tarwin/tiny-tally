// Printing: copy the element into a top-level #print-root and hide the app
// for print media (style.css), so scroll containers can't clip it and it
// paginates normally. Paper size and margins: lib/paper.ts.
import { nextTick } from 'vue';
import { pageMargin } from './paper';
// The native print panel offers "Save as PDF" on macOS.
export async function printElement(el: HTMLElement | null) {
  if (!el) return;
  // A document sheet (.Doc) has its own margins; anything else gets the page's, on every page.
  pageMargin.value = el.classList.contains('Doc') ? 0 : 14;
  await nextTick();
  let root = document.getElementById('print-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'print-root';
    document.body.appendChild(root);
  }
  // cloneNode keeps Vue's scoped-style attributes, so the styles still apply.
  root.replaceChildren(el.cloneNode(true));
  // Left in place (it's hidden on screen): on macOS print() returns once the
  // panel opens, and Save as PDF renders the pages again when you click Save,
  // so emptying it any earlier saves a blank page. clearPrintout() empties it
  // on the next page change.
  await tiny.win.print();
}

/** Empties the last printout (router.ts, on leaving a page). */
export function clearPrintout() {
  // Tests drive the router with a stub document.
  document.getElementById?.('print-root')?.replaceChildren();
}
