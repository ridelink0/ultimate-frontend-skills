'use strict';

// "It said it would restart at 4:30 and nothing happened."
//
// Register-ScheduledTask reports success for tasks that will never run. Until
// this check existed, the relay took a zero exit code as proof of a wake and
// told the user a time that nothing was going to happen at. Every case below
// is one where Windows says yes and means no.

const test = require('node:test');
const assert = require('node:assert');

const relay = require('../skills/usage-limits/scripts/relay.js');
const tempdirs = require('../tools/test-tempdirs.js');

const NOW = Date.parse('2026-09-14T10:00:00Z');
const WANTED = Date.parse('2026-09-14T14:30:00Z');

function iso(stamp) {
  // What PowerShell's .ToString("s") produces: LOCAL wall-clock, no zone.
  //
  // Formatting UTC and stripping the Z would shift every case by the machine's
  // offset - which is what the first version of this helper did, and it failed
  // by exactly five hours on a UTC-5 machine. Date.parse treats a zoneless
  // stamp as local, which is precisely why the production path is right.
  const d = new Date(stamp);
  const two = (n) => String(n).padStart(2, '0');
  return (
    d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate()) + 'T' +
    two(d.getHours()) + ':' + two(d.getMinutes()) + ':' + two(d.getSeconds())
  );
}

test('a task Windows will actually run passes', () => {
  const verdict = relay.verifyRegistration('Ready', iso(WANTED), WANTED, NOW);
  assert.equal(verdict.ok, true, verdict.error);
  assert.equal(verdict.nextRun, WANTED);
});

test('a Disabled task is refused, however cleanly it registered', () => {
  const verdict = relay.verifyRegistration('Disabled', iso(WANTED), WANTED, NOW);
  assert.equal(verdict.ok, false);
  assert.match(verdict.error, /Disabled/);
});

test('no next run time is refused - this is the silent one', () => {
  // The exact shape of the reported failure: registration succeeded, Windows
  // scheduled nothing, and the relay announced a time anyway.
  for (const empty of ['', '   ', null, undefined]) {
    const verdict = relay.verifyRegistration('Ready', empty, WANTED, NOW);
    assert.equal(verdict.ok, false, 'empty next run must be refused');
    assert.match(verdict.error, /no next run time/);
  }
});

test('a next run time already in the past is refused', () => {
  const verdict = relay.verifyRegistration('Ready', iso(NOW - 60000), WANTED, NOW);
  assert.equal(verdict.ok, false);
  assert.match(verdict.error, /in the past/);
});

test('a next run time that is not the one asked for is refused', () => {
  // The trigger did not take: Windows kept an older one, or rounded to
  // something else entirely. Firing at the wrong hour unattended is worse than
  // not firing.
  const elsewhere = WANTED + 3 * 60 * 60 * 1000;
  const verdict = relay.verifyRegistration('Ready', iso(elsewhere), WANTED, NOW);
  assert.equal(verdict.ok, false);
  assert.match(verdict.error, /not the requested/);
});

test('a few minutes of rounding is tolerated', () => {
  // Task Scheduler rounds to the minute and a trigger can be nudged slightly.
  for (const drift of [-60000, 1000, 4 * 60 * 1000]) {
    const verdict = relay.verifyRegistration('Ready', iso(WANTED + drift), WANTED, NOW);
    assert.equal(verdict.ok, true, String(drift) + 'ms of drift should be fine');
  }
});

test('an unreadable next run time is refused rather than guessed at', () => {
  const verdict = relay.verifyRegistration('Ready', 'sometime next week', WANTED, NOW);
  assert.equal(verdict.ok, false);
  assert.match(verdict.error, /could not read/);
});

test('with no requested time, any future run is accepted', () => {
  // schedulePosix and the deferral path both call through here; only the
  // Windows path knows what it asked for.
  const verdict = relay.verifyRegistration('Ready', iso(NOW + 60 * 60 * 1000), null, NOW);
  assert.equal(verdict.ok, true, verdict.error);
});

test('a failed re-arm leaves the previous wake in place', () => {
  // Names are unique per wake, so re-arming is no longer an atomic -Force
  // replace. Cancelling the old task before registering the new one opens a
  // window where neither exists - and if registration fails, that window never
  // closes: a working relay is destroyed and nothing replaces it.
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const saved = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = tempdirs.make(path.join(os.tmpdir(), 'usage-limits-rearm-'));
  try {
    const now = Date.now();
    const first = relay.arm({
      now,
      sessionId: 'ordering-test',
      cwd: process.cwd(),
      hostName: 'claude',
      at: now + 40 * 60 * 1000,
      binding: { percentUsed: 10, resetsAt: now + 3 * 60 * 60 * 1000 },
      work: { hasWork: true, pending: 1, todos: [] },
      schedule: false, // no real task; this test is about bookkeeping order
    });
    assert.equal(first.ok, true, first.error);
    const original = relay.read().armed;
    assert.ok(original && original.id === 'ordering-test');

    // A deadline already past makes scheduleWindows refuse before registering.
    const second = relay.arm({
      now,
      sessionId: 'ordering-test',
      cwd: process.cwd(),
      hostName: 'claude',
      at: now + 90 * 60 * 1000,
      binding: { percentUsed: 10, resetsAt: now + 3 * 60 * 60 * 1000 },
      work: { hasWork: true, pending: 1, todos: [] },
      deadline: now - 1,
    });
    assert.equal(second.ok, false, 'registration should have been refused');

    // The old record must survive a failed replacement.
    const after = relay.read().armed;
    assert.ok(after, 'something must still be armed after a failed re-arm');
    assert.equal(after.task, original.task, 'the previous wake must be left in place');
  } finally {
    if (saved === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = saved;
  }
});

test('garbage is not accepted as proof that a task will fire', () => {
  // Date.parse is far too willing. Date.parse("12345") is the year 12345 -
  // finite, in the future, and it would pass every other check in here. A
  // function whose whole job is refusing wakes that will not happen must not
  // accept nonsense as evidence that one will.
  for (const junk of [12345, '12345', 'Ready', '99', 'next Tuesday', {}, []]) {
    const verdict = relay.verifyRegistration('Ready', junk, null, NOW);
    assert.equal(verdict.ok, false, JSON.stringify(junk) + ' must be refused');
  }
  // And a real stamp still passes, with or without seconds.
  assert.equal(relay.verifyRegistration('Ready', iso(NOW + 3600000), null, NOW).ok, true);
  assert.equal(relay.verifyRegistration('Ready', iso(NOW + 3600000).slice(0, 16), null, NOW).ok, true);
});
