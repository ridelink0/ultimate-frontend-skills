// usage-limits display: the session line names input and output separately,
// the four token kinds add up to the total shown, and the dollar figure is
// stated as a list-price value, never hedged as "about $N". The plugin's own
// tests live under plugins/usage-limits/test and npm run test:fast does not
// reach them, so the behaviour that matters is pinned here as well.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
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

const usage = require(join(root, 'plugins/usage-limits/skills/usage-limits/scripts/usage.js'));

test('the reasoning line states a list-price value, never "about $N", and SKILL.md shows the same line', () => {
  const reasoning = { tokens: 74000, shareOfOutput: 0.4, cost: 1.85 };
  const priced = usage.reasoningLine(reasoning, true);
  assert.equal(priced, '    Of that output, 74k was reasoning (40%, $1.85 at API list prices), the part effort controls.');
  assert.doesNotMatch(priced, /about \$/);
  // A host that quotes no price (Codex) and an unpriced model both drop the money clause.
  assert.equal(usage.reasoningLine(reasoning, false), '    Of that output, 74k was reasoning (40%), the part effort controls.');
  assert.equal(usage.reasoningLine({ ...reasoning, cost: null }, true), '    Of that output, 74k was reasoning (40%), the part effort controls.');
  assert.equal(usage.reasoningLine({ tokens: 0, shareOfOutput: 0, cost: 0 }, true), null);
  assert.equal(usage.reasoningLine(null, true), null);
  const doc = readFileSync(join(root, 'plugins/usage-limits/skills/usage-limits/SKILL.md'), 'utf8');
  assert.doesNotMatch(doc, /about \$\d/, 'SKILL.md hedges no figure as about $N');
  assert.ok(doc.split(/\r?\n/).includes(priced), 'SKILL.md carries the line the report prints');
});

test('the closing line SKILL.md teaches names every token kind, as the hook line does', () => {
  const doc = readFileSync(join(root, 'plugins/usage-limits/skills/usage-limits/SKILL.md'), 'utf8');
  const line = doc.split(/\r?\n/).find((l) => l.startsWith('> Spent this session:'));
  assert.ok(line, 'SKILL.md carries the example closing line');
  const shown = /tokens \(([^)]*)\)/.exec(line);
  assert.ok(shown, 'the example breaks the total down');
  // Same figures as session(): a breakdown that leaves out cache read cannot add up to 3.1M.
  assert.equal(shown[1], tally.tokenBreakdown(session().tokens));
});
