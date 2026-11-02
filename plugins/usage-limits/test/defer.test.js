'use strict';

// Deferral: "not now, then."
//
// The risk in this feature is not that it fails loudly. It is that it fires at
// the wrong hour, quietly, while the user is asleep. So the parser refuses
// anything ambiguous rather than picking a reading, and these tests are mostly
// about what it REFUSES.

const test = require('node:test');
const assert = require('node:assert');

const defer = require('../skills/usage-limits/scripts/defer.js');
const tempdirs = require('../tools/test-tempdirs.js');

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
// A fixed afternoon, so "9:50pm" is later today and "9am" is tomorrow.
const NOW = new Date('2026-09-14T14:00:00').getTime();
const RESET = NOW + 3 * HOUR;

function at(text) {
  const parsed = defer.parseWhen(text, NOW, RESET);
  assert.ok(!parsed.error, 'expected "' + text + '" to parse, got: ' + parsed.error);
  return parsed;
}

test('clock times parse, in both notations', () => {
  assert.equal(defer.formatClock(at('9:50pm').at), '9:50 PM');
  assert.equal(defer.formatClock(at('21:50').at), '9:50 PM');
  assert.equal(defer.formatClock(at('9:50 PM').at), '9:50 PM');
  assert.equal(defer.formatClock(at('9pm').at), '9:00 PM');
  assert.equal(defer.formatClock(at('09:05').at), '9:05 AM');
  assert.equal(defer.formatClock(at('12am').at), '12:00 AM');
  assert.equal(defer.formatClock(at('12pm').at), '12:00 PM');
});

test('a time already past today means tomorrow', () => {
  // Said at 2pm, "9am" cannot mean five hours ago.
  const morning = at('9am');
  assert.ok(morning.at > NOW, 'must be in the future');
  assert.ok(morning.at - NOW > 18 * HOUR, 'should be tomorrow morning');
  // And a later time today stays today.
  assert.ok(at('9:50pm').at - NOW < 8 * HOUR);
});

test('relative times parse', () => {
  assert.equal(at('in 90m').at, NOW + 90 * MINUTE);
  assert.equal(at('in 2h').at, NOW + 2 * HOUR);
  assert.equal(at('in 45 minutes').at, NOW + 45 * MINUTE);
  assert.equal(at('in 1.5 hours').at, NOW + 90 * MINUTE);
});

test('reset uses the window, plus a moment for the meter to turn over', () => {
  const parsed = at('reset');
  assert.equal(parsed.at, RESET + 5 * MINUTE);
  assert.match(parsed.label, /window resets/);
});

test('reset refuses when the reset time is unknown, rather than guessing', () => {
  const parsed = defer.parseWhen('reset', NOW, null);
  assert.ok(parsed.error, 'should refuse');
  assert.match(parsed.error, /name a clock time/);
});

test('ambiguity is refused, never resolved', () => {
  // "9" is the one that would silently fire twelve hours out.
  const bare = defer.parseWhen('9', NOW, RESET);
  assert.ok(bare.error);
  assert.match(bare.error, /Ambiguous/);
});

test('nonsense is refused with the accepted formats', () => {
  // 'in 400h' is past the fortnight cap; 'in 300h' (12.5 days) is legitimately
  // inside it and must NOT be refused.
  for (const bad of ['banana', '', '   ', '25:00', '9:99pm', '13pm', '0pm', 'in 0m', 'in -5m', 'in 400h']) {
    const parsed = defer.parseWhen(bad, NOW, RESET);
    assert.ok(parsed.error, '"' + bad + '" should be refused');
  }
  assert.match(defer.parseWhen('banana', NOW, RESET).error, /9:50pm/);
});

test('the confirmation says nothing was started and how to undo it', () => {
  const decided = defer.plan({ now: NOW, when: '9:50pm', binding: { resetsAt: RESET, percent: 94 } });
  assert.equal(decided.ok, true);
  const line = defer.confirmation({
    label: decided.label,
    clock: decided.clock,
    in: decided.in,
    items: '14 lines',
    resetNote: decided.resetNote,
  });
  // One line. The command exists to not do things; a paragraph defeats it.
  assert.equal(line.split('\n').length, 1);
  assert.match(line, /9:50 PM/);
  assert.match(line, /Nothing has been started/);
  assert.match(line, /cancel/);
  // And it tells you the budget will be there, which is the whole reason to
  // defer past a reset.
  assert.match(line, /window will have reset/);
});

test('deferring to before a reset while nearly empty is flagged, not refused', () => {
  const soon = defer.plan({ now: NOW, when: 'in 30m', binding: { resetsAt: RESET, percent: 94 } });
  assert.equal(soon.ok, true);
  assert.match(soon.resetNote || '', /before the window resets/);
});

test('a comfortable window gets no reset note at all', () => {
  const easy = defer.plan({ now: NOW, when: 'in 30m', binding: { resetsAt: RESET, percent: 12 } });
  assert.equal(easy.ok, true);
  assert.equal(easy.resetNote, null);
});

test('plan refuses an unreadable time without scheduling anything', () => {
  const bad = defer.plan({ now: NOW, when: 'whenever', binding: { resetsAt: RESET, percent: 10 } });
  assert.equal(bad.ok, false);
  assert.ok(bad.error);
});

test('formatSpan reads the way a person would say it', () => {
  assert.equal(defer.formatSpan(45 * MINUTE), '45m');
  assert.equal(defer.formatSpan(90 * MINUTE), '1h 30m');
  assert.equal(defer.formatSpan(2 * HOUR), '2h');
  assert.equal(defer.formatSpan(-1), 'now');
});

test('help and status are reachable without scheduling anything', () => {
  assert.match(defer.main(['help'], NOW), /defer <time>/);
  // status must not throw on a machine with nothing armed.
  assert.equal(typeof defer.main(['status'], NOW), 'string');
});

test('cancel records a readable outcome, not an object', () => {
  // disarm(reason, now) takes a STRING. Passing { reason } stored an object as
  // the history outcome, and the next session's briefing read it back to the
  // user as: The last relay ended as "[object Object]".
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const relay = require('../skills/usage-limits/scripts/relay.js');

  const saved = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = tempdirs.make(path.join(os.tmpdir(), 'usage-limits-defer-'));
  try {
    const state = relay.read();
    state.armed = {
      id: 'cancel-test',
      task: null, // no real scheduled task to cancel
      host: 'claude',
      cwd: process.cwd(),
      project: 'cancel-test',
      wakeAt: Date.now() + 3600000,
      deferred: true,
    };
    relay.write(state);

    const said = defer.main(['cancel'], Date.now());
    assert.match(said, /Cancelled/);

    const after = relay.read();
    assert.equal(after.armed, null, 'nothing should still be armed');
    const last = after.history[after.history.length - 1];
    assert.equal(typeof last.outcome, 'string', 'the outcome must be a string');
    assert.notEqual(String(last.outcome), '[object Object]');
  } finally {
    if (saved === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = saved;
  }
});

test('relay.arm honours an exact wake time', () => {
  // ISOLATED, and it must be. Without this the test armed against the REAL
  // config: on 2026-09-14 it displaced another session's live relay seven
  // seconds after that relay was armed, and the cleanup disarm then cleared a
  // record that was no longer ours. arm() displaces by design - one machine,
  // one relay - so anything that arms a throwaway session has to isolate.
  // A deferral fires at a time a person named, so arm() must NOT add the relay's
  // graceMinutes to it: 9:50 means 9:50. This is pinned because relay.js is
  // shared and the `at` option is easy to drop in a refactor.
  const relay = require('../skills/usage-limits/scripts/relay.js');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const savedDir = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = tempdirs.make(path.join(os.tmpdir(), 'usage-limits-arm-'));
  try {
  const now = Date.now();
  const target = now + 90 * MINUTE;

  const scheduled = [];
  const armed = relay.arm({
    now,
    sessionId: 'at-option-test',
    cwd: process.cwd(),
    hostName: 'claude',
    at: target,
    binding: { percentUsed: 10, resetsAt: now + 3 * HOUR },
    work: { hasWork: true, pending: 1, todos: [] },
    // Never register a real scheduled task from a test.
    schedule: false,
  });
  assert.equal(armed.ok, true, armed.error || 'arm should succeed');

  const record = relay.read().armed;
  assert.ok(record, 'something should be armed');
  // Within a second of the exact time asked for - no grace added.
  assert.ok(
    Math.abs(Number(record.wakeAt) - target) < 1000,
    'wakeAt ' + new Date(Number(record.wakeAt)).toISOString() + ' should equal the requested ' + new Date(target).toISOString()
  );
  relay.disarm('test cleanup', Date.now(), 'at-option-test');
  } finally {
    if (savedDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = savedDir;
  }
});
