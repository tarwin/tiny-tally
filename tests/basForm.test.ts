// The BAS as the boxes of the quarterly statement: whole dollars, and the
// totals the statement works out agreeing with the BAS screen's.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { basFormFigures } from '../src/shared/basForm.ts';
import { RETURN_FORMS } from '../src/shared/taxReturns.ts';

const BAS = RETURN_FORMS.bas;

// The Jul–Sep 2026 figures from the Reckon file, in cents.
const figures = { G1: 2_528_635, '1A': 229_875, '1B': 38_425, G2: 0, G3: 120_050, G4: 0, G10: 0, G11: 476_790 };

test('the boxes are whole dollars, cents dropped', () => {
  const { boxes, owing, instalment } = basFormFigures(BAS.rows(figures, {}));
  assert.equal(boxes.G1, 25_286);
  assert.equal(boxes.G3, 1_200);
  assert.equal(boxes.G11, 4_767);
  assert.equal(boxes['1A'], 2_298);
  assert.equal(boxes['1B'], 384);
  assert.equal(boxes['8A'], 2_298);
  assert.equal(boxes['8B'], 384);
  assert.equal(boxes['9'], 1_914);
  assert.equal(owing, true);
  // No instalment: Option 1 isn't ticked and T7 stays empty, while 5A says 0.
  assert.equal(instalment, false);
  assert.equal(boxes.T7, null);
  assert.equal(boxes['5A'], 0);
  // What the books don't know is left for the person.
  assert.equal(boxes.W3, null);
  assert.equal(boxes['7'], null);
  assert.equal(boxes['5B'], null);
});

test('wages, no-ABN withholding and an instalment go through W5, 4 and 5A to 8A', () => {
  const inputs = { w1: 1_000_099, w2: 200_050, t7: 150_000 };
  const { boxes, instalment } = basFormFigures(BAS.rows({ ...figures, W4: 47_099 }, inputs));
  assert.equal(boxes.W1, 10_000);
  assert.equal(boxes.W2, 2_000);
  assert.equal(boxes.W4, 470);
  assert.equal(boxes.W5, 2_470);
  assert.equal(boxes['4'], 2_470);
  assert.equal(boxes.T7, 1_500);
  assert.equal(boxes['5A'], 1_500);
  assert.equal(boxes['8A'], 2_298 + 2_470 + 1_500);
  assert.equal(instalment, true);
  // 9 is what the BAS screen says is owed.
  assert.equal(boxes['9']! * 100, BAS.net({ ...figures, W4: 47_099 }, inputs));
});

test('a refund: 8B more than 8A', () => {
  const { boxes, owing } = basFormFigures(BAS.rows({ ...figures, '1A': 10_000, '1B': 90_000 }, {}));
  assert.equal(owing, false);
  assert.equal(boxes['9'], 800);
  assert.equal(basFormFigures(BAS.rows({ ...figures, '1A': 10_000, '1B': 10_000 }, {})).owing, null);
});
