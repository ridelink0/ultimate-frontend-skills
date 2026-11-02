'use strict';

// The brief's use of the running tally: tokens in the session line, the last
// reply's cost, the context size, what the previous session cost, and the
// instruction to close finished work with the figure.

const test = require('node:test');
const assert = require('node:assert');

const brief = require('../skills/usage-limits/scripts/brief.js');

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const NOW = Date.parse('2026-09-01T10:00:00.000Z');

function parts(over) {
  return Object.assign(
    {
      binding: { key: 'five_hour', label: '5-hour', percentUsed: 28, stale: false },
      othersSummary: 'weekly 12%',
      turnsLeft: 159,
      resetsIn: '2h 10m',
      sessions: 1,
      pressure: 'roomy',
    },
    over || {}
  );
}

test('the session line says tokens as well as money', () => {
  const text = brief.briefText(parts({ session: { turns: 48, cost: 12.4, tokens: 3086000 } }));
  assert.match(text, /This session: 48 turns, 3\.1M tokens, \$12\.40\./);
});

test('the last reply and the context ride along when the tally knows them', () => {
  const text = brief.briefText(
    parts({ session: { turns: 48, cost: 12.4, tokens: 3086000 }, lastReply: { cost: 0.95 }, context: 130000 })
  );
  assert.match(text, /Last reply \$0\.95\./);
  assert.match(text, /Context about 130k tokens\./);
  assert.doesNotMatch(text, /fresh session/, 'no advice while the context is a normal size');
});

test('a large context earns one clause of advice, not a lecture', () => {
  const text = brief.briefText(parts({ session: { turns: 48, cost: 30, tokens: 9e6 }, context: 283000 }));
  assert.match(text, /Context about 283k tokens; each turn re-reads that, so a fresh session or \/compact at the next clean boundary cuts per-turn cost\./);
});

test('a new session is told what the last one cost, once', () => {
  const text = brief.briefText(
    parts({
      lastSession: { turns: 210, tokens: 14.2e6, cost: 54, project: 'C--Users-OWNER', endedAgo: '2h 5m' },
    })
  );
  assert.match(text, /Last session: 210 turns, 14\.2M tokens, \$54 \(C--Users-OWNER, ended 2h 5m ago\)\./);
});

test('the instruction asks for a closing line when the work is done, whatever the pressure', () => {
  for (const pressure of ['roomy', 'tight']) {
    const text = brief.briefText(parts({ pressure }));
    assert.match(
      text,
      /When this reply completes what was asked, or wraps up the session, end it with one plain line giving the session total above/,
      pressure
    );
    assert.match(text, /Skip it on partial progress/, pressure);
  }
  // Nothing further will run once the budget is gone, so there is no reply to close.
  assert.doesNotMatch(brief.briefText(parts({ pressure: 'gone' })), /closing line|end it with one plain line/);
});

test('tallyContext reads this session from the tally', () => {
  const state = {
    _ids: ['a|b'],
    mine: { turns: 48, cost: 12.4, tokens: { input: 1, cacheWrite: 2, cacheRead: 3, output: 4, reasoning: 0 }, context: 130000, lastReply: { cost: 0.95, turns: 6 }, lastAt: NOW - MINUTE },
    older: { turns: 210, cost: 54, tokens: { input: 0, cacheWrite: 0, cacheRead: 14.2e6, output: 0, reasoning: 0 }, project: 'C--Users-OWNER', lastAt: NOW - 2 * HOUR, endedAt: NOW - 2 * HOUR },
  };
  const found = brief.tallyContext(state, 'mine', NOW);
  assert.deepStrictEqual(found.lastReply, { cost: 0.95, turns: 6 });
  assert.strictEqual(found.context, 130000);
  assert.strictEqual(found.lastSession, null, 'an established session is not told about the previous one');
});

test('tallyContext points a brand new session at the previous one', () => {
  const state = {
    older: { turns: 210, cost: 54, tokens: { input: 0, cacheWrite: 0, cacheRead: 14.2e6, output: 0, reasoning: 0 }, project: 'C--Users-OWNER', lastAt: NOW - 2 * HOUR, endedAt: NOW - 2 * HOUR },
    oldest: { turns: 5, cost: 1, tokens: { input: 0, cacheWrite: 0, cacheRead: 1000, output: 0, reasoning: 0 }, project: 'x', lastAt: NOW - 9 * HOUR },
  };
  const found = brief.tallyContext(state, 'fresh', NOW);
  assert.strictEqual(found.lastReply, null);
  assert.strictEqual(found.context, null);
  assert.deepStrictEqual(found.lastSession, {
    turns: 210,
    tokens: 14.2e6,
    cost: 54,
    project: 'C--Users-OWNER',
    open: false,
    endedAgo: '2h',
  });
});

test('a previous session that never closed is described as still open, not ended', () => {
  const state = {
    other: { turns: 16, cost: 11.36, tokens: { input: 0, cacheWrite: 0, cacheRead: 2.8e6, output: 0, reasoning: 0 }, project: 'C--Users-OWNER', lastAt: NOW - 6 * MINUTE, endedAt: null },
  };
  const found = brief.tallyContext(state, 'fresh', NOW);
  assert.strictEqual(found.lastSession.open, true);
  assert.strictEqual(found.lastSession.endedAgo, '6m');
  const text = brief.briefText(parts({ lastSession: found.lastSession }));
  assert.match(text, /Last session: 16 turns, 2\.8M tokens, \$11 \(C--Users-OWNER, still open, last active 6m ago\)\./);
  assert.doesNotMatch(text, /ended/);
});

test('tallyContext says nothing at all with no history', () => {
  const found = brief.tallyContext({}, 'fresh', NOW);
  assert.deepStrictEqual(found, { lastReply: null, context: null, lastSession: null });
  assert.deepStrictEqual(brief.tallyContext(null, null, NOW), { lastReply: null, context: null, lastSession: null });
});
