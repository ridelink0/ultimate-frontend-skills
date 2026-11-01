'use strict';

// The Codex block: the other agent's meter drawn under Claude's, counting the
// other way. Codex writes what it has SPENT and shows what is LEFT, so every
// one of these guards the direction.

const test = require('node:test');
const assert = require('node:assert');

const view = require('../skills/usage-limits/scripts/view.js');
const bars = require('../skills/usage-limits/scripts/bars.js');

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const NOW = Date.parse('2026-09-06T12:00:00.000Z');

function meter(overrides) {
  return Object.assign(
    {
      now: NOW,
      fetchedAtMs: NOW - MINUTE,
      plan: 'ChatGPT Plus',
      windowSpecs: [
        { key: 'five_hour', label: '5-hour' },
        { key: 'seven_day', label: 'weekly' },
      ],
      utilization: {
        // What Codex actually writes: used_percent, rising.
        five_hour: { utilization: 94, resets_at: new Date(NOW + HOUR).toISOString() },
        seven_day: { utilization: 15, resets_at: new Date(NOW + 6 * 24 * HOUR).toISOString() },
      },
    },
    overrides
  );
}

test('the thresholds mirror exactly: every used percentage maps to its remaining twin', () => {
  for (let used = 0; used <= 100; used += 1) {
    assert.strictEqual(
      bars.levelLeft(100 - used),
      bars.level(used),
      used + '% used should colour the same as ' + (100 - used) + '% left'
    );
  }
});

test('80 used is 20 left is yellow, and 90 used is 10 left is red', () => {
  assert.strictEqual(bars.levelLeft(21), 'fill');
  assert.strictEqual(bars.levelLeft(20), 'warning');
  assert.strictEqual(bars.levelLeft(11), 'warning');
  assert.strictEqual(bars.levelLeft(10), 'error');
  assert.strictEqual(bars.levelLeft(0), 'error');
  assert.strictEqual(bars.levelLeft(null), 'fill');
});

test('a Codex row reports what is left, not what is spent', () => {
  const block = view.buildCodex(meter());
  const week = block.rows.find((row) => row.key === 'seven_day');
  // 15% used on the wire is 85% left on screen.
  assert.strictEqual(week.percent, 15);
  assert.strictEqual(week.percentLeft, 85);
  assert.strictEqual(week.percentText, '85% left');
  assert.strictEqual(week.remaining, true);
});

test('a nearly-spent Codex window is red, where the same number used would be green', () => {
  const block = view.buildCodex(meter());
  const five = block.rows.find((row) => row.key === 'five_hour');
  assert.strictEqual(five.percentLeft, 6);
  assert.strictEqual(five.level, 'error');
  // The trap this guards: 6 read as "used" is a comfortable green bar.
  assert.strictEqual(bars.level(6), 'fill');
});

test('every drawn figure carries the word left, so it cannot be read as spend', () => {
  const block = view.buildCodex(meter());
  for (const row of block.rows) {
    if (row.percentLeft === null) continue;
    assert.ok(/ left$/.test(row.percentText), row.percentText + ' must say "left"');
  }
});

test('a window past its reset reports nothing rather than a stale remainder', () => {
  const block = view.buildCodex(
    meter({
      utilization: {
        five_hour: { utilization: 94, resets_at: new Date(NOW - MINUTE).toISOString() },
      },
      windowSpecs: [{ key: 'five_hour', label: '5-hour' }],
    })
  );
  const five = block.rows[0];
  assert.strictEqual(five.stale, true);
  // 6% left in red would claim Codex is nearly out when the window has just
  // come back. Unknown is the honest answer.
  assert.strictEqual(five.percentLeft, null);
  assert.strictEqual(five.percentText, 'rolling');
  assert.strictEqual(five.level, 'fill');
});

test('the titles are the ones Codex uses for itself', () => {
  const block = view.buildCodex(meter());
  assert.strictEqual(block.rows.find((row) => row.key === 'five_hour').title, '5h limit');
  assert.strictEqual(block.rows.find((row) => row.key === 'seven_day').title, 'Weekly limit');
  assert.strictEqual(block.title, 'Codex usage');
});

test('no reading means the block is not present, and that is not an error', () => {
  const block = view.buildCodex(meter({ utilization: null, fetchedAtMs: null }));
  assert.strictEqual(block.present, false);
  assert.strictEqual(block.rows.length, 0);
  assert.strictEqual(block.state, 'none');
  assert.match(block.note, /run Codex once/);
});

test('a plan that meters no rolling window is present and says so', () => {
  const block = view.buildCodex(meter({ utilization: null, fetchedAtMs: null, windowless: true }));
  assert.strictEqual(block.present, true);
  assert.match(block.note, /no rolling window/);
});

test('the freshness of the Codex reading is judged on its own clock', () => {
  assert.strictEqual(view.buildCodex(meter({ fetchedAtMs: NOW - MINUTE })).state, 'live');
  assert.strictEqual(view.buildCodex(meter({ fetchedAtMs: NOW - 15 * HOUR })).state, 'cached');
});

test('Codex is labelled by name, because no font can draw its logo', () => {
  // There is no Blossom codepoint in Unicode, and the nearest rosette is a
  // flower - a different picture in the slot where the logo should be, which
  // is worse than none. So there is no Codex glyph to get wrong.
  assert.strictEqual(bars.CODEX_LABEL, 'Codex');
  assert.strictEqual(bars.CODEX_MARK, undefined, 'no Codex glyph is exported');
  assert.strictEqual(bars.CODEX_MARK_ASCII, undefined);

  // Claude keeps its mark, and it stays one narrow column: visibleWidth counts
  // codepoints rather than display columns, so a wide one would silently push
  // every bar on the line out of true.
  assert.strictEqual(Array.from(bars.CLAUDE_MARK).length, 1);
  assert.strictEqual(bars.visibleWidth(bars.CLAUDE_MARK), 1);
  assert.strictEqual(bars.mark(), bars.CLAUDE_MARK);
  assert.strictEqual(bars.mark({ ascii: true }), '*');
});

test('the two marks are painted in different colours', () => {
  assert.notDeepStrictEqual(bars.markColour('codex'), bars.markColour('claude'));
  assert.deepStrictEqual(bars.markColour('codex'), bars.THEME.codex);
  assert.deepStrictEqual(bars.markShimmer('codex'), bars.THEME.codexShimmer);
});

test('a Codex window not present in the payload produces no row', () => {
  const block = view.buildCodex(
    meter({ utilization: { seven_day: { utilization: 15, resets_at: new Date(NOW + HOUR).toISOString() } } })
  );
  assert.strictEqual(block.rows.length, 1);
  assert.strictEqual(block.rows[0].key, 'seven_day');
});

test('used percentages outside 0-100 are clamped rather than drawn past the ends', () => {
  const block = view.buildCodex(
    meter({
      utilization: {
        five_hour: { utilization: 130, resets_at: new Date(NOW + HOUR).toISOString() },
        seven_day: { utilization: -5, resets_at: new Date(NOW + HOUR).toISOString() },
      },
    })
  );
  assert.strictEqual(block.rows.find((row) => row.key === 'five_hour').percentLeft, 0);
  assert.strictEqual(block.rows.find((row) => row.key === 'seven_day').percentLeft, 100);
});
