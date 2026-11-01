'use strict';

// The session history: what sessionSpend carries, and how the tally is shown
// by --sessions and --session.

const test = require('node:test');
const assert = require('node:assert');

const usage = require('../skills/usage-limits/scripts/usage.js');

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const NOW = Date.parse('2026-09-01T10:00:00.000Z');

test('sessionSpend carries the tokens along with the money', () => {
  const events = [
    { sessionId: 'a', cost: 1, tokens: 1000 },
    { sessionId: 'b', cost: 10, tokens: 5 },
    { sessionId: 'a', cost: 2, tokens: 2000 },
  ];
  assert.deepStrictEqual(usage.sessionSpend(events, 'a'), { turns: 2, cost: 3, tokens: 3000 });
});

function session(over) {
  return Object.assign(
    {
      sessionId: '4940f126-4215-4fac-8348-49643379749d',
      project: 'C--Users-OWNER',
      prompts: 1,
      turns: 16,
      subagentTurns: 0,
      tokens: { input: 12000, cacheWrite: 380000, cacheRead: 2400000, output: 76000, reasoning: 40000 },
      cost: 11.36,
      context: 283000,
      firstAt: NOW - 18 * MINUTE,
      lastAt: NOW - MINUTE,
      endedAt: null,
      reason: null,
      models: { 'claude-fable-5': { turns: 16, cost: 11.36 } },
    },
    over || {}
  );
}

test('renderSessions lists the newest first with tokens and cost, and marks the open ones', () => {
  const text = usage.renderSessions(
    [
      session(),
      session({
        sessionId: '380e664a-e290-4782-9f38-f0083d515a3c',
        prompts: 10,
        turns: 112,
        subagentTurns: 35,
        tokens: { input: 0, cacheWrite: 0, cacheRead: 49.2e6, output: 347000, reasoning: 0 },
        cost: 93.11,
        lastAt: NOW - 3 * HOUR,
        endedAt: NOW - 3 * HOUR,
        reason: 'clear',
      }),
    ],
    NOW
  );
  const lines = text.split('\n');
  assert.match(lines[0], /^Sessions/);
  assert.match(text, /When\s+Project\s+Prompts\s+Turns\s+Tokens\s+Cost/);
  const first = lines.find((line) => line.indexOf('4940f126') !== -1);
  const second = lines.find((line) => line.indexOf('380e664a') !== -1);
  assert.ok(first && second, 'both sessions are listed by the start of their id');
  assert.ok(lines.indexOf(first) < lines.indexOf(second), 'newest first');
  assert.match(first, /1m ago/);
  assert.match(first, /C--Users-OWNER/);
  assert.match(first, /\b1\b.*\b16\b.*2\.9M.*\$11\.36.*open/);
  assert.match(second, /3h ago/);
  assert.match(second, /112\+35/);
  assert.match(second, /49\.5M.*\$93\.11/);
  assert.doesNotMatch(second, /open/);
});

test('renderSessions explains itself when there is nothing yet', () => {
  const text = usage.renderSessions([], NOW);
  assert.match(text, /No sessions on record yet/);
  assert.match(text, /Stop hook/);
});

test('renderSession shows one session in full', () => {
  const text = usage.renderSession(session({ subagentTurns: 35 }), NOW);
  assert.match(text, /^Session 4940f126 \(C--Users-OWNER\)/);
  assert.match(text, /Started\s+.*18m ago, still open/);
  assert.match(text, /Prompts\s+1\b/);
  assert.match(text, /Turns\s+16, plus 35 by subagents/);
  assert.match(text, /Tokens\s+2\.9M: input 12k, cache write 380k, cache read 2\.4M, output 76k \(40k of it reasoning\)/);
  assert.match(text, /Cost\s+\$11\.36/);
  assert.match(text, /Context\s+283k tokens at the last call/);
  assert.match(text, /Models\s+claude-fable-5\s+16 turns\s+\$11\.36/);
});

test('renderSession says when and why a closed session ended', () => {
  const text = usage.renderSession(session({ endedAt: NOW - HOUR, reason: 'clear' }), NOW);
  assert.match(text, /closed 1h ago \(clear\)/);
  assert.doesNotMatch(text, /still open/);
});

test('pickSession finds the newest, an exact id, or a unique prefix', () => {
  const list = [session(), session({ sessionId: '380e664a-e290-4782-9f38-f0083d515a3c', lastAt: NOW - 3 * HOUR })];
  assert.strictEqual(usage.pickSession(list, 'last').sessionId, '4940f126-4215-4fac-8348-49643379749d');
  assert.strictEqual(usage.pickSession(list, '380e664a-e290-4782-9f38-f0083d515a3c').sessionId, '380e664a-e290-4782-9f38-f0083d515a3c');
  assert.strictEqual(usage.pickSession(list, '380e').sessionId, '380e664a-e290-4782-9f38-f0083d515a3c');
  assert.strictEqual(usage.pickSession(list, 'nope'), null);
  assert.strictEqual(usage.pickSession([], 'last'), null);
});
