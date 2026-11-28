// The books' paper size (Settings) for everything printed: @page for the
// print panel and Save as PDF (with the margin set per printout by
// lib/print.ts), and --tt-paper-width / --tt-paper-height for
// sheets drawn at paper size (invoices, statements, PaperPreview).
import { computed, ref, watchEffect } from 'vue';
import { PAPER, type PaperSize } from '../shared/countries';
import { session } from './session';

export const paper = computed(() => PAPER[(session.books?.paperSize as PaperSize | undefined) ?? 'a4']);

/** Paper width in CSS pixels (96 per inch). */
export const paperWidthPx = computed(() => Math.round((paper.value.width / 25.4) * 96));

/**
 * The page margin in mm. Reports and forms print with a margin on every page;
 * documents (invoices, statements) are drawn at paper size with their own, so 0.
 */
export const pageMargin = ref(14);

export function followPaperSize() {
  const style = document.createElement('style');
  style.id = 'tt-page';
  document.head.appendChild(style);
  watchEffect(() => {
    const p = paper.value;
    style.textContent = `@page { size: ${p.css}; margin: ${pageMargin.value}mm; }`;
    document.documentElement.style.setProperty('--tt-paper-width', `${p.width}mm`);
    document.documentElement.style.setProperty('--tt-paper-height', `${p.height}mm`);
  });
}
