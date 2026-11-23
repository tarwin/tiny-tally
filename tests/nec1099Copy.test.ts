// Form 1099-NEC Copy B: the revision per tax year and the recipient's TIN.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nec1099Revision, truncateTin } from '../src/shared/nec1099Copy.ts';

test('Copy B follows the form revision for the tax year', () => {
  assert.equal(nec1099Revision(2025).rev, 'Rev. April 2025');
  assert.equal(nec1099Revision(2025).compBox, '1');
  assert.deepEqual(nec1099Revision(2025).extraBoxes, []);
  const r = nec1099Revision(2026);
  assert.equal(r.rev, 'Rev. December 2026');
  assert.equal(r.compBox, '1a');
  assert.deepEqual(r.extraBoxes.map((b) => b.box), ['1b', '1c', '1d']);
  // Every revision carries the recipient instructions for its compensation box.
  for (const y of [2024, 2025, 2026]) {
    const v = nec1099Revision(y);
    assert.ok(v.instructions.some((t) => t.startsWith(`Box ${v.compBox}. `)), String(y));
  }
});

test("the recipient's TIN shows only its last four digits", () => {
  assert.equal(truncateTin('123-45-6789'), 'XXX-XX-6789');
  assert.equal(truncateTin('123456789'), 'XXX-XX-6789');
  assert.equal(truncateTin('98-7654321'), 'XX-XXX4321');
  assert.equal(truncateTin(null), '');
  assert.equal(truncateTin('12'), '');
});
