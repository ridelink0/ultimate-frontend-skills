'use strict';

const test = require('node:test');
const assert = require('node:assert');

const bars = require('../skills/usage-limits/scripts/bars.js');

const TRUE = { mode: 'truecolor' };
const HOUR = 60 * 60 * 1000;
const NOW = Date.parse('2026-09-05T12:00:00.000Z');

test('level turns warning at 80 and error at 90, per window', () => {
  assert.strictEqual(bars.level(0), 'fill');
  assert.strictEqual(bars.level(79.9), 'fill');
  assert.strictEqual(bars.level(80), 'warning');
  assert.strictEqual(bars.level(89.9), 'warning');
  assert.strictEqual(bars.level(90), 'error');
  assert.strictEqual(bars.level(100), 'error');
  assert.strictEqual(bars.level(140), 'error');
  assert.strictEqual(bars.level(NaN), 'fill');
  assert.strictEqual(bars.level(null), 'fill');
});

test('the bar fills in proportion and never lies at the ends', () => {
  assert.strictEqual(bars.stripAnsi(bars.bar(0, 10, TRUE)), '░'.repeat(10));
  assert.strictEqual(bars.stripAnsi(bars.bar(50, 10, TRUE)), '█'.repeat(5) + '░'.repeat(5));
  assert.strictEqual(bars.stripAnsi(bars.bar(100, 10, TRUE)), '█'.repeat(10));
  // Above 100 is clamped, below 0 is clamped.
  assert.strictEqual(bars.stripAnsi(bars.bar(130, 10, TRUE)), '█'.repeat(10));
  assert.strictEqual(bars.stripAnsi(bars.bar(-5, 10, TRUE)), '░'.repeat(10));
  // Something spent shows as at least a sliver; not full is never drawn full.
  assert.strictEqual(bars.stripAnsi(bars.bar(1, 10, TRUE)), '█' + '░'.repeat(9));
  assert.strictEqual(bars.stripAnsi(bars.bar(99, 10, TRUE)), '█'.repeat(9) + '░');
  assert.strictEqual(bars.bar(50, 0, TRUE), '');
  assert.strictEqual(bars.visibleWidth(bars.bar(37, 24, TRUE)), 24);
});

test('the bar takes its colour from the level', () => {
  const fill = bars.bar(50, 10, TRUE);
  const warn = bars.bar(85, 10, TRUE);
  const bad = bars.bar(95, 10, TRUE);
  assert.ok(fill.indexOf('38;2;177;185;249') !== -1, 'rate_limit_fill');
  assert.ok(fill.indexOf('38;2;80;83;112') !== -1, 'rate_limit_empty');
  assert.ok(warn.indexOf('38;2;255;193;7') !== -1, 'warning yellow');
  assert.ok(bad.indexOf('38;2;255;107;128') !== -1, 'error red');
  // An explicit level wins, so a row can be painted from a decision made elsewhere.
  assert.ok(bars.bar(10, 10, { mode: 'truecolor', level: 'error' }).indexOf('38;2;255;107;128') !== -1);
});

test('ascii bars use plain characters', () => {
  assert.strictEqual(bars.stripAnsi(bars.bar(50, 4, { mode: 'none', ascii: true })), '##--');
});

test('a styled bar paints its filled cells, and only those', () => {
  const rainbow = bars.bar(50, 10, { mode: 'truecolor', style: 'rainbow', tick: 1 });
  assert.strictEqual(bars.stripAnsi(rainbow), '█'.repeat(5) + '░'.repeat(5));
  const colours = new Set(rainbow.match(/38;2;[0-9;]+m/g) || []);
  assert.ok(colours.size >= 4, 'several rainbow colours, got ' + colours.size);
  assert.ok(rainbow.indexOf('38;2;80;83;112') !== -1, 'the empty cells keep their own colour');

  const ultra = bars.bar(50, 10, { mode: 'truecolor', style: 'ultra', tick: 1 });
  assert.strictEqual(bars.stripAnsi(ultra), '█'.repeat(5) + '░'.repeat(5));
  assert.ok(ultra.indexOf('38;2;175;135;255') !== -1, 'the ultra purple');
  assert.ok(ultra.indexOf('38;2;177;185;249') === -1, 'not the plain fill');

  // A style is animation, so it moves with the tick and stops under reduced motion.
  assert.notStrictEqual(bars.bar(50, 10, { mode: 'truecolor', style: 'rainbow', tick: 1 }), bars.bar(50, 10, { mode: 'truecolor', style: 'rainbow', tick: 2 }));
  assert.strictEqual(
    bars.bar(50, 10, { mode: 'truecolor', style: 'ultra', tick: 1, reduced: true }),
    bars.bar(50, 10, { mode: 'truecolor', style: 'ultra', tick: 9, reduced: true })
  );
  // No colour at all means no style either.
  assert.strictEqual(bars.bar(50, 4, { mode: 'none', style: 'rainbow' }), '██░░');
});

test('colour mode respects NO_COLOR, FORCE_COLOR and the terminal', () => {
  assert.strictEqual(bars.colourMode({ NO_COLOR: '1', COLORTERM: 'truecolor' }, true), 'none');
  assert.strictEqual(bars.colourMode({ FORCE_COLOR: '1' }, false), 'truecolor');
  assert.strictEqual(bars.colourMode({}, false), 'none');
  assert.strictEqual(bars.colourMode({ COLORTERM: 'truecolor' }, true), 'truecolor');
  assert.strictEqual(bars.colourMode({ WT_SESSION: 'abc' }, true), 'truecolor');
  assert.strictEqual(bars.colourMode({ TERM_PROGRAM: 'vscode' }, true), 'truecolor');
  assert.strictEqual(bars.colourMode({ TERM: 'xterm-256color' }, true), '256');
  assert.strictEqual(bars.colourMode({ TERM: 'dumb' }, true), 'none');
  assert.strictEqual(bars.colourMode({ COLORTERM: 'truecolor', USAGE_LIMITS_COLOUR: '256' }, true), '256');
});

test('none mode paints nothing and 256 mode uses the palette index', () => {
  assert.strictEqual(bars.paint('x', bars.THEME.claude, 'none'), 'x');
  assert.strictEqual(bars.bar(50, 4, { mode: 'none' }), '██░░');
  const eight = bars.paint('x', bars.THEME.claude, '256');
  assert.ok(eight.indexOf('38;5;') !== -1);
  assert.strictEqual(eight.indexOf('38;2;'), -1);
  assert.strictEqual(bars.stripAnsi(eight), 'x');
  const truecolor = bars.paint('x', [1, 2, 3], 'truecolor');
  assert.strictEqual(truecolor, '\x1b[38;2;1;2;3mx\x1b[39m');
});

test('the spinner plays forward then back, one frame per tick', () => {
  assert.strictEqual(bars.spinner(0), '·');
  assert.strictEqual(bars.spinner(1), '✢');
  assert.strictEqual(bars.spinner(5), '✽');
  assert.strictEqual(bars.spinner(6), '✽');
  assert.strictEqual(bars.spinner(11), '·');
  assert.strictEqual(bars.spinner(12), '·');
  assert.strictEqual(bars.spinner(13), '✢');
  assert.strictEqual(bars.spinner(-1), '·');
  assert.strictEqual(bars.spinner(7, { reduced: true }), '·');
  assert.strictEqual(bars.spinner(2, { ascii: true }), '*');
  assert.strictEqual(bars.TICK_MS, 150);
});

test('shimmer keeps the text and sweeps a highlight across it', () => {
  const base = bars.THEME.claude;
  const light = bars.THEME.claudeShimmer;
  const a = bars.shimmer('Thinking', 0, base, light, TRUE);
  const b = bars.shimmer('Thinking', 3, base, light, TRUE);
  assert.strictEqual(bars.stripAnsi(a), 'Thinking');
  assert.notStrictEqual(a, b, 'the highlight moves with the tick');
  assert.ok(b.indexOf('38;2;235;159;127') !== -1, 'the shimmer colour appears');
  assert.ok(b.indexOf('38;2;215;119;87') !== -1, 'the base colour appears');
  const still = bars.shimmer('Thinking', 3, base, light, { mode: 'truecolor', reduced: true });
  assert.strictEqual(still.indexOf('38;2;235;159;127'), -1, 'reduced motion has no highlight');
  assert.strictEqual(bars.shimmer('Thinking', 3, base, light, { mode: 'none' }), 'Thinking');
});

test('rainbow paints every character and cycles with the tick', () => {
  const a = bars.rainbow('ultracode', 0, TRUE);
  const b = bars.rainbow('ultracode', 1, TRUE);
  assert.strictEqual(bars.stripAnsi(a), 'ultracode');
  assert.notStrictEqual(a, b);
  const colours = new Set((a.match(/38;2;[0-9;]+m/g) || []));
  assert.ok(colours.size >= 5, 'several distinct rainbow colours, got ' + colours.size);
  assert.strictEqual(bars.rainbow('ultracode', 4, { mode: 'none' }), 'ultracode');
  // Reduced motion keeps the rainbow but stops it moving.
  assert.strictEqual(
    bars.rainbow('ultracode', 4, { mode: 'truecolor', reduced: true }),
    bars.rainbow('ultracode', 9, { mode: 'truecolor', reduced: true })
  );
});

test('effort levels take the colours the effort picker uses', () => {
  assert.deepStrictEqual(bars.effortColour('low').rgb, bars.THEME.warning);
  assert.deepStrictEqual(bars.effortColour('medium').rgb, bars.THEME.success);
  assert.deepStrictEqual(bars.effortColour('high').rgb, bars.THEME.permission);
  assert.deepStrictEqual(bars.effortColour('xhigh').rgb, bars.THEME.ultra);
  assert.ok(bars.effortColour('xhigh').shimmer);
  assert.strictEqual(bars.effortColour('max').rainbow, true);
  // Claude Code's effort picker paints Ultracode purple, not rainbow.
  assert.strictEqual(bars.effortColour('ultracode').rainbow, false);
  assert.deepStrictEqual(bars.effortColour('ultracode').rgb, bars.THEME.ultra);
  assert.deepStrictEqual(bars.effortColour('whatever').rgb, bars.THEME.inactive);
  assert.deepStrictEqual(bars.effortColour(null).rgb, bars.THEME.inactive);
});

test('stripAnsi and visibleWidth ignore escapes', () => {
  const painted = bars.bold(bars.paint('abc', [1, 2, 3], 'truecolor'), 'truecolor') + bars.dim('de', 'truecolor');
  assert.strictEqual(bars.stripAnsi(painted), 'abcde');
  assert.strictEqual(bars.visibleWidth(painted), 5);
  assert.strictEqual(bars.visibleWidth(''), 0);
  assert.strictEqual(bars.visibleWidth('✻ ab'), 4);
});

test('formatReset says how long and at what time', () => {
  const in4h12 = 4 * HOUR + 12 * 60 * 1000;
  const text = bars.formatReset(in4h12, NOW + in4h12, NOW, { clock: '24h', utc: true });
  assert.strictEqual(text, 'resets in 4h 12m at 16:12');
  const twelve = bars.formatReset(in4h12, NOW + in4h12, NOW, { clock: '12h', utc: true });
  assert.strictEqual(twelve, 'resets in 4h 12m at 4:12 PM');
  // More than a day away names the day.
  const in29h = 29 * HOUR;
  assert.strictEqual(
    bars.formatReset(in29h, NOW + in29h, NOW, { clock: '24h', utc: true }),
    'resets in 1d 5h at Sun 17:00'
  );
  assert.strictEqual(bars.formatReset(30 * 1000, NOW + 30 * 1000, NOW, { utc: true }), 'resets in 1m at 12:00 PM');
  assert.strictEqual(bars.formatReset(-5, NOW - 5, NOW, {}), 'resets now');
  assert.strictEqual(bars.formatReset(null, null, NOW, {}), '');
  // No clock time when the reset moment is unknown.
  assert.strictEqual(bars.formatReset(in4h12, null, NOW, {}), 'resets in 4h 12m');
});

test('prettyModel reads like the model picker', () => {
  assert.strictEqual(bars.prettyModel('claude-fable-5-1[1m]'), 'Fable 5.1 1M');
  assert.strictEqual(bars.prettyModel('claude-opus-5'), 'Opus 5');
  assert.strictEqual(bars.prettyModel('claude-sonnet-5'), 'Sonnet 5');
  assert.strictEqual(bars.prettyModel('claude-haiku-4-5-20251001'), 'Haiku 4.5');
  assert.strictEqual(bars.prettyModel('us.anthropic.claude-opus-5-v1:0'), 'Opus 5');
  assert.strictEqual(bars.prettyModel('default'), 'Default model');
  assert.strictEqual(bars.prettyModel('opusplan'), 'Opus plan');
  assert.strictEqual(bars.prettyModel('opus'), 'Opus');
  assert.strictEqual(bars.prettyModel(null), 'Unknown model');
  assert.strictEqual(bars.prettyModel(''), 'Unknown model');
});

test('prettyModel names OpenAI models the way Codex does', () => {
  assert.strictEqual(bars.prettyModel('gpt-6-astra'), 'GPT-6 Astra');
  assert.strictEqual(bars.prettyModel('gpt-5.6-sol'), 'GPT-5.6 Sol');
  assert.strictEqual(bars.prettyModel('gpt-5'), 'GPT-5');
  assert.strictEqual(bars.prettyModel('o4-mini'), 'o4 Mini');
});
