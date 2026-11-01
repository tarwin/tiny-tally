import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fromBase64, toBase64 } from '../src/shared/base64.ts';

test('base64 matches Node for every length and round-trips', () => {
  for (let n = 0; n < 40; n++) {
    const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37 + n) & 255);
    const b64 = Buffer.from(bytes).toString('base64');
    assert.equal(toBase64(bytes), b64, `length ${n}`);
    assert.deepEqual(fromBase64(b64), bytes, `length ${n}`);
  }
  const big = Uint8Array.from({ length: 100_003 }, (_, i) => (i * 7) & 255);
  assert.equal(toBase64(big), Buffer.from(big).toString('base64'));
  assert.throws(() => fromBase64('ab!d'));
});
