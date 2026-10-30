// Printing: copy the element into a top-level #print-root and hide the app
// for print media (style.css), so scroll containers can't clip it and it
// paginates normally. The native print panel offers "Save as PDF" on macOS.
export async function printElement(el: HTMLElement | null) {
  if (!el) return;
  let root = document.getElementById('print-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'print-root';
    document.body.appendChild(root);
  }
  // cloneNode keeps Vue's scoped-style attributes, so the styles still apply.
  root.replaceChildren(el.cloneNode(true));
  try {
    await tiny.win.print();
  } finally {
    // On some platforms print() returns before the page is snapshotted.
    setTimeout(() => root!.replaceChildren(), 2000);
  }
}
