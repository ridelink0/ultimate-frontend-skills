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

// Without --game, a local canvas game still gets the sizes it is played at.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gameWidths, targetWidths } from '../scripts/args.mjs';

test('a canvas game with keyboard controls defaults to the game widths', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ufs-game-'));
  writeFileSync(join(dir, 'index.html'), '<canvas id="c"></canvas><script src="game.js"></script>');
  writeFileSync(join(dir, 'game.js'), "addEventListener('keydown', (e) => { if (e.code === 'KeyW') up(); });");
  assert.equal(targetWidths(dir), GAME_WIDTHS);
  assert.equal(defaultWidths(parseArgs(['look', dir]).flag, targetWidths(dir)), GAME_WIDTHS);
});
test('touch controls bring the phone width back; a canvas without keys is a page', () => {
  assert.equal(gameWidths("<canvas></canvas> keydown 'ArrowLeft' touchstart"), GAME_WIDTHS + ',390');
  assert.equal(gameWidths('<canvas></canvas><script>new OrbitControls()</script>'), null);
  const dir = mkdtempSync(join(tmpdir(), 'ufs-page-'));
  writeFileSync(join(dir, 'index.html'), '<h1>Roofing</h1><canvas></canvas>');
  assert.equal(targetWidths(dir), PAGE_WIDTHS);
});
