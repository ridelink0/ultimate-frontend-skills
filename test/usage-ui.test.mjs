// usage-limits display: the session line names input and output separately,
// the four token kinds add up to the total shown, and the dollar figure is
// stated as a list-price value, never hedged as "about $N". The plugin's own
// tests live under plugins/usage-limits/test and npm run test:fast does not
// reach them, so the behaviour that matters is pinned here as well.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../', import.meta.url));
const tally = require(join(root, 'plugins/usage-limits/skills/usage-limits/scripts/tally.js'));

const NOW = Date.parse('2026-09-01T10:00:00.000Z');
function session(over) {
  return {
    prompts: 9,
    turns: 48,
    subagentTurns: 0,
    tokens: { input: 5000, cacheWrite: 120000, cacheRead: 2900000, output: 61000 },
    cost: 199.6,
    context: 130000,
    firstAt: NOW - 102 * 60 * 1000,
    lastAt: NOW,
    ...over,
  };
}

test('the session line shows input and output, not only cache read and output', () => {
  const text = tally.formatTally(session(), {}, {});
  assert.match(text, /\(5k input, 120k cache write, 2\.9M cache read, 61k output\)/);
  const closed = tally.formatClosed(session(), NOW);
  assert.match(closed, /\(5k input, 120k cache write, 2\.9M cache read, 61k output\)/);
});

test('input and output are named even when zero', () => {
  assert.equal(tally.tokenBreakdown({}), '0 input, 0 output');
});

test('the token kinds add up to the total', () => {
  const t = session().tokens;
  assert.equal(tally.totalTokens(t), t.input + t.cacheWrite + t.cacheRead + t.output);
});

test('no "about $N" text on a large session, before or after it closes', () => {
  const live = tally.formatTally(session(), { turns: 2, subagentTurns: 0, tokens: 1000, cost: 1 }, {});
  const closed = tally.formatClosed(session(), NOW);
  for (const text of [live, closed]) {
    assert.doesNotMatch(text, /about \$/);
    assert.match(text, /\$200 at API list prices/);
  }
});
