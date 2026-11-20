import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lineValue, startValue, tapeResult, tapeTotal, type TapeLine } from '../src/shared/tape.ts';

const tape = (...lines: [TapeLine['op'], string, boolean?][]) => lines.map(([op, text, pct]) => ({ op, text, pct }));

test('line by line, top to bottom', () => {
  assert.equal(tapeTotal(tape([null, '100'], ['+', '20'], ['*', '2'])), 240);
  assert.equal(tapeTotal(tape([null, '1,234.50'], ['-', '34.5'])), 1200);
  assert.equal(tapeTotal(tape([null, '0.1'], ['+', '0.2'])), 0.3);
});

test('an unfinished last line is left out of the total so far', () => {
  assert.equal(tapeTotal(tape([null, '50'], ['+', ''])), 50);
  assert.equal(tapeTotal(tape([null, '50'], ['+', '-'])), 50);
  assert.equal(tapeTotal(tape([null, '50'], ['/', '0'])), null);
});

test('percent', () => {
  assert.equal(tapeTotal(tape([null, '200'], ['+', '10', true])), 220);
  assert.equal(tapeTotal(tape([null, '200'], ['-', '10', true])), 180);
  assert.equal(tapeTotal(tape([null, '200'], ['*', '10', true])), 20);
});

test('what goes in the field', () => {
  assert.equal(tapeResult(tape([null, '12.50'], ['+', '7.5'])), '20');
  assert.equal(tapeResult(tape([null, '100'], ['/', '3'])), '33.33');
  assert.equal(tapeResult(tape([null, '1.125'], ['*', '3'])), '3.375');
  assert.equal(tapeResult(tape([null, '10'], ['-', '25.25'])), '-15.25');
});

test('reading the field to start from', () => {
  assert.equal(startValue('$1,234.50'), '1234.50');
  assert.equal(startValue('(12.5)'), '-12.5');
  assert.equal(startValue('-7'), '-7');
  assert.equal(startValue(''), null);
  assert.equal(startValue('-'), null);
  assert.equal(startValue('12 apples'), null);
  assert.equal(startValue('€ 40'), '40');
  assert.equal(lineValue('.5'), 0.5);
  assert.equal(lineValue('1.2.3'), null);
});
