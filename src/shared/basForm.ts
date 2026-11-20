// The BAS figures as they go into the boxes of the quarterly statement (the
// ATO's BAS A layout): whole dollars, cents dropped, with the totals the
// form has you work out (W5, 8A, 8B, 9). BasForm.vue draws them.
// No tjs:* imports and no Intl here: this file ships in both.
import type { ReturnRow } from './taxReturns';

/**
 * The ATO statement this layout follows, and when it was last compared with
 * it. The ATO revises the form now and then (the NAT number's date part):
 * re-check the sections, boxes and wording against the newest BAS A sample
 * on ato.gov.au each July, with the BAS rules (RELEASING.md).
 */
export const BAS_FORM_LAYOUT = { form: 'BAS A, NAT 4189-09.2025', checked: '2026-11-20' };

/** A box's figure in whole dollars, or null to leave it empty. */
export type BasBoxes = Record<string, number | null>;

export interface BasFormFigures {
  boxes: BasBoxes;
  /** Is 8A more than 8B? null when they're equal. */
  owing: boolean | null;
  /** PAYG instalment Option 1 (an instalment amount at T7) applies. */
  instalment: boolean;
}

/** The boxes the books don't know, left for the person to fill in by hand if they apply. */
export const BAS_BLANK_BOXES = ['W3', '7', '5B', 'G21', 'G22', 'G23', 'G24', 'T8', 'T9', 'T4', 'T1', 'T2', 'T3', 'T11'];

const whole = (cents: number) => Math.trunc(cents / 100);

/** The BAS return rows (taxReturns.ts) as the boxes of the statement. */
export function basFormFigures(rows: ReturnRow[]): BasFormFigures {
  const box = (code: string) => {
    const r = rows.find((x) => x.code === code);
    return r ? whole(r.value) : 0;
  };
  const w2 = box('W2');
  const w4 = box('W4');
  const t7 = box('T7');
  const a1 = box('1A');
  const b1 = box('1B');
  const w5 = w2 + w4;
  const a8 = a1 + w5 + t7;
  const b8 = b1;
  const boxes: BasBoxes = {
    G1: box('G1'),
    G2: box('G2'),
    G3: box('G3'),
    G10: box('G10'),
    G11: box('G11'),
    W1: box('W1'),
    W2: w2,
    W4: w4,
    W5: w5,
    T7: t7 || null,
    '1A': a1,
    '4': w5,
    '5A': t7,
    '8A': a8,
    '1B': b1,
    '8B': b8,
    '9': Math.abs(a8 - b8),
  };
  for (const code of BAS_BLANK_BOXES) boxes[code] = null;
  return { boxes, owing: a8 === b8 ? null : a8 > b8, instalment: t7 > 0 };
}
