// --game checks a keyboard-and-mouse game at the sizes it is played at.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, defaultWidths, GAME_WIDTHS, PAGE_WIDTHS } from '../scripts/args.mjs';

test('--game switches the default widths to laptop and desktop sizes', () => {
  assert.equal(defaultWidths(parseArgs(['look', 'x', '--game']).flag), GAME_WIDTHS);
  assert.equal(GAME_WIDTHS, '1366,1280,1920');
});
test('a page keeps its desktop and phone widths', () => {
  assert.equal(defaultWidths(parseArgs(['look', 'x']).flag), PAGE_WIDTHS);
});
test('an explicit --widths still wins over --game', () => {
  assert.equal(defaultWidths(parseArgs(['look', 'x', '--game', '--widths', '800']).flag), '800');
});
