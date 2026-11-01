'use strict';

const test = require('node:test');
const assert = require('node:assert');

const pulse = require('../skills/usage-limits/scripts/pulse.js');

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const NOW = Date.parse('2026-08-31T05:00:00.000Z');

test('a session is due the first time it is seen', () => {
  assert.strictEqual(pulse.due({}, 'a', NOW, 2 * MINUTE), true);
  assert.strictEqual(pulse.due(null, 'a', NOW, 2 * MINUTE), true);
});

test('a session is not due again until the interval has passed', () => {
  const state = { a: { at: NOW } };
  assert.strictEqual(pulse.due(state, 'a', NOW + MINUTE, 2 * MINUTE), false);
  assert.strictEqual(pulse.due(state, 'a', NOW + 2 * MINUTE, 2 * MINUTE), true);
  assert.strictEqual(pulse.due(state, 'a', NOW + 5 * MINUTE, 2 * MINUTE), true);
});

test('sessions are throttled independently', () => {
  // Two windows working at once must not silence each other: the whole point is
  // that each one is told the budget is draining under it.
  const state = { a: { at: NOW } };
  assert.strictEqual(pulse.due(state, 'a', NOW + MINUTE, 2 * MINUTE), false);
  assert.strictEqual(pulse.due(state, 'b', NOW + MINUTE, 2 * MINUTE), true);
});

test('a corrupt or missing slot does not silence the ping', () => {
  assert.strictEqual(pulse.due({ a: null }, 'a', NOW, 2 * MINUTE), true);
  assert.strictEqual(pulse.due({ a: { at: 'soon' } }, 'a', NOW, 2 * MINUTE), true);
  assert.strictEqual(pulse.due({ a: {} }, 'a', NOW, 2 * MINUTE), true);
});

test('trim keeps the newest sessions and records this one', () => {
  // More slots than the cap, so the trimming is actually exercised however
  // many the cap allows. Two keys per session are written now - the spoken
  // pulse and the quiet subagent refresh - so the cap moves with that.
  const extra = 4;
  const count = pulse.KEEP_SESSIONS + extra;
  const many = {};
  for (let index = 0; index < count; index += 1) many['s' + index] = { at: NOW - index * MINUTE };
  const kept = pulse.trim(many, 'fresh', NOW + MINUTE);

  assert.strictEqual(Object.keys(kept).length, pulse.KEEP_SESSIONS);
  assert.strictEqual(kept.fresh.at, NOW + MINUTE);
  assert.ok(!kept['s' + (count - 1)], 'the oldest slot is dropped rather than growing the file');
  assert.ok(kept.s0, 'the newest of the old slots is kept');
});

test('the quiet subagent refresh keeps a throttle of its own', () => {
  // A workflow's subagents must not use up the interval that the next tool
  // call needs in order to say anything to Claude.
  const state = pulse.trim({}, 'abc#subagent', NOW);
  assert.strictEqual(pulse.due(state, 'abc#subagent', NOW, 2 * MINUTE), false);
  assert.strictEqual(pulse.due(state, 'abc', NOW, 2 * MINUTE), true);
});

test('an unnamed session still gets a slot', () => {
  const kept = pulse.trim({}, null, NOW);
  assert.strictEqual(kept._.at, NOW);
});

test('the envelope is the documented PostToolUse shape', () => {
  const parsed = JSON.parse(pulse.envelope('hello'));
  assert.strictEqual(parsed.hookSpecificOutput.hookEventName, 'PostToolUse');
  assert.strictEqual(parsed.hookSpecificOutput.additionalContext, 'hello');
});

test('the line names the window, the runway and the sharing', () => {
  const text = pulse.pulseText({
    label: '5-hour',
    percentUsed: 69,
    approximate: true,
    turnsLeft: 34,
    runsOutIn: '14m',
    sessions: 3,
    pressure: 'tight',
  });
  assert.match(text, /5-hour now about 69%/);
  assert.match(text, /about 34 turns left/);
  assert.match(text, /14m at this pace/);
  assert.match(text, /3 sessions sharing it/);
  assert.match(text, /make a cutoff cheap/);
});

test('an exhausted budget says to stop rather than to hurry', () => {
  const text = pulse.pulseText({ label: '5-hour', percentUsed: 100, sessions: 1, pressure: 'gone' });
  assert.match(text, /budget is gone/);
  assert.match(text, /handoff/);
});

test('a window at zero is still reported, not treated as missing', () => {
  const text = pulse.pulseText({ label: '5-hour', percentUsed: 0, sessions: 1, pressure: 'tight' });
  assert.match(text, /5-hour now 0%/);
});

test('nothing worth saying produces no line at all', () => {
  assert.strictEqual(pulse.pulseText({ label: '5-hour', sessions: 1, pressure: 'roomy' }), '');
});

test('a single session is not described as sharing', () => {
  const text = pulse.pulseText({
    label: 'weekly', percentUsed: 40, turnsLeft: 10, sessions: 1, pressure: 'tight',
  });
  assert.ok(text.indexOf('sharing') === -1);
});

test('the interval is two minutes unless the environment says otherwise', () => {
  const before = process.env.USAGE_LIMITS_PULSE_SECONDS;
  try {
    delete process.env.USAGE_LIMITS_PULSE_SECONDS;
    assert.strictEqual(pulse.intervalMs(), pulse.DEFAULT_INTERVAL_SECONDS * SECOND);
    process.env.USAGE_LIMITS_PULSE_SECONDS = '30';
    assert.strictEqual(pulse.intervalMs(), 30 * SECOND);
    // Nonsense must not turn into a zero interval, which would fire the scan
    // after every single tool call.
    process.env.USAGE_LIMITS_PULSE_SECONDS = 'soon';
    assert.strictEqual(pulse.intervalMs(), pulse.DEFAULT_INTERVAL_SECONDS * SECOND);
    process.env.USAGE_LIMITS_PULSE_SECONDS = '0';
    assert.strictEqual(pulse.intervalMs(), pulse.DEFAULT_INTERVAL_SECONDS * SECOND);
    process.env.USAGE_LIMITS_PULSE_SECONDS = '-5';
    assert.strictEqual(pulse.intervalMs(), pulse.DEFAULT_INTERVAL_SECONDS * SECOND);
  } finally {
    if (before === undefined) delete process.env.USAGE_LIMITS_PULSE_SECONDS;
    else process.env.USAGE_LIMITS_PULSE_SECONDS = before;
  }
});

test('the ping can be turned off entirely', async () => {
  const before = process.env.USAGE_LIMITS_PULSE;
  try {
    process.env.USAGE_LIMITS_PULSE = 'off';
    assert.strictEqual(await pulse.run(NOW, { session_id: 'a' }), '');
  } finally {
    if (before === undefined) delete process.env.USAGE_LIMITS_PULSE;
    else process.env.USAGE_LIMITS_PULSE = before;
  }
});

test('PreToolUse on a Bash call gets the ordinary throttled pulse, not the fan-out line', async () => {
  // hooks.json now matches PreToolUse on Bash too, so a build or test suite
  // gets a reading before it runs rather than only after. But fanout wording
  // ("Before this fan-out") is reserved for Workflow/Agent/Task, which spawn
  // work that cannot be warned again until it stops - a single Bash call is
  // not that, and must not be treated as never-throttled.
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const usage = require('../skills/usage-limits/scripts/usage.js');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-limits-pulse-bash-'));
  const previousDir = process.env.CLAUDE_CONFIG_DIR;
  const previousPulse = process.env.USAGE_LIMITS_PULSE;
  const realReport = usage.report;
  process.env.CLAUDE_CONFIG_DIR = dir;
  process.env.USAGE_LIMITS_PULSE = 'always';
  try {
    usage.report = async () => ({
      binding: { key: 'five_hour', label: '5-hour', percentUsed: 40, stale: false, turnsLeft: 60 },
      sessions: [],
    });

    const bashText = await pulse.run(NOW, { session_id: 'b1', hook_event_name: 'PreToolUse', tool_name: 'Bash' });
    assert.ok(!/Before this fan-out/.test(bashText), 'a plain Bash call is not a fan-out');

    const workflowText = await pulse.run(NOW, { session_id: 'w1', hook_event_name: 'PreToolUse', tool_name: 'Workflow' });
    assert.match(workflowText, /Before this fan-out/);
  } finally {
    usage.report = realReport;
    if (previousDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = previousDir;
    if (previousPulse === undefined) delete process.env.USAGE_LIMITS_PULSE;
    else process.env.USAGE_LIMITS_PULSE = previousPulse;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a Bash call declared longer than the interval is read before it runs, however recently the last pulse spoke', async () => {
  // The point of matching Bash on PreToolUse: a build or a test suite is the
  // one step of a turn that can run for ten minutes with nothing able to
  // speak. Sharing the spoken pulse's throttle slot defeats it - the tool call
  // that finished five seconds ago already claimed the slot - so the call the
  // agent itself declared long gets its own, and is still throttled to one
  // reading per interval.
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const usage = require('../skills/usage-limits/scripts/usage.js');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-limits-pulse-long-'));
  const previousDir = process.env.CLAUDE_CONFIG_DIR;
  const previousPulse = process.env.USAGE_LIMITS_PULSE;
  const realReport = usage.report;
  process.env.CLAUDE_CONFIG_DIR = dir;
  process.env.USAGE_LIMITS_PULSE = 'always';
  let scans = 0;
  try {
    usage.report = async () => {
      scans += 1;
      return {
        binding: { key: 'five_hour', label: '5-hour', percentUsed: 40, stale: false, turnsLeft: 60 },
        sessions: [],
      };
    };

    // A tool call finishes and pulses, claiming the ordinary slot.
    assert.ok(await pulse.run(NOW, { session_id: 'L', hook_event_name: 'PostToolUse', tool_name: 'Read' }));
    const afterPost = scans;

    // Trivial Bash calls in the same interval stay silent and cost nothing:
    // this is the throttle the matcher change depends on.
    for (let i = 1; i <= 10; i += 1) {
      const text = await pulse.run(NOW + i * 1000, {
        session_id: 'L',
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'ls' },
      });
      assert.strictEqual(text, '', 'a trivial Bash call must not pulse');
    }
    assert.strictEqual(scans, afterPost, 'trivial Bash calls must not pay for a scan');

    // The long one does get read, five seconds after the last pulse.
    const long = await pulse.run(NOW + 11 * 1000, {
      session_id: 'L',
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'npm test', timeout: 10 * 60 * 1000 },
    });
    assert.match(long, /5-hour now 40%/);
    assert.strictEqual(scans, afterPost + 1);

    // And it is throttled in its own right: a run of long calls inside one
    // interval is read once, not once each.
    for (let i = 12; i <= 16; i += 1) {
      const text = await pulse.run(NOW + i * 1000, {
        session_id: 'L',
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'npm test', timeout: 10 * 60 * 1000 },
      });
      assert.strictEqual(text, '', 'the long-call reading is throttled too');
    }
    assert.strictEqual(scans, afterPost + 1);
  } finally {
    usage.report = realReport;
    if (previousDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = previousDir;
    if (previousPulse === undefined) delete process.env.USAGE_LIMITS_PULSE;
    else process.env.USAGE_LIMITS_PULSE = previousPulse;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('matching Bash costs one scan per interval however many Bash calls there are', async () => {
  // The matcher change puts this hook in front of every Bash call, which is
  // the busiest tool there is. The throttle has to bound the work as a rate,
  // not merely inside one window: sixty calls over ten minutes must cost the
  // five scans the interval allows, not sixty.
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const usage = require('../skills/usage-limits/scripts/usage.js');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-limits-pulse-rate-'));
  const previousDir = process.env.CLAUDE_CONFIG_DIR;
  const previousPulse = process.env.USAGE_LIMITS_PULSE;
  const realReport = usage.report;
  process.env.CLAUDE_CONFIG_DIR = dir;
  process.env.USAGE_LIMITS_PULSE = 'always';
  let scans = 0;
  try {
    usage.report = async () => {
      scans += 1;
      return {
        binding: { key: 'five_hour', label: '5-hour', percentUsed: 40, stale: false, turnsLeft: 60 },
        sessions: [],
      };
    };

    const every = pulse.DEFAULT_INTERVAL_SECONDS * 1000;
    const span = 10 * 60 * 1000;
    const calls = 60;
    for (let i = 0; i < calls; i += 1) {
      await pulse.run(NOW + Math.round((i * span) / calls), {
        session_id: 'R',
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'git status --short' },
      });
    }
    assert.strictEqual(scans, Math.ceil(span / every), '60 Bash calls over 10 minutes, 5 scans');
  } finally {
    usage.report = realReport;
    if (previousDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = previousDir;
    if (previousPulse === undefined) delete process.env.USAGE_LIMITS_PULSE;
    else process.env.USAGE_LIMITS_PULSE = previousPulse;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('what counts as a long call is the agent\'s own declaration, not a guess at the command', () => {
  const every = pulse.DEFAULT_INTERVAL_SECONDS * 1000;
  assert.strictEqual(pulse.longCall({ command: 'npm test', timeout: every + 1 }, every), true);
  // No declared timeout means the default, which is the interval: not long.
  assert.strictEqual(pulse.longCall({ command: 'npm run build' }, every), false);
  assert.strictEqual(pulse.longCall({ command: 'x', timeout: every }, every), false);
  // Backgrounded calls return at once, so the turn never goes blind and
  // PostToolUse pulses normally.
  assert.strictEqual(pulse.longCall({ command: 'x', timeout: every * 5, run_in_background: true }, every), false);
  assert.strictEqual(pulse.longCall(null, every), false);
  assert.strictEqual(pulse.longCall({ timeout: 'ages' }, every), false);
});

test('the ping gives a new session its equal share and counts the same sessions as the brief', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const usage = require('../skills/usage-limits/scripts/usage.js');
  const brief = require('../skills/usage-limits/scripts/brief.js');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-limits-pulse-'));
  const previousDir = process.env.CLAUDE_CONFIG_DIR;
  const previousPulse = process.env.USAGE_LIMITS_PULSE;
  const realReport = usage.report;
  process.env.CLAUDE_CONFIG_DIR = dir;
  process.env.USAGE_LIMITS_PULSE = 'always';
  try {
    // Two other windows prompted within the last few minutes.
    fs.writeFileSync(brief.cacheFile(), JSON.stringify({ a: { at: NOW - MINUTE }, b: { at: NOW - 2 * MINUTE } }));
    // ...and between them have spent almost all of the last quarter hour.
    usage.report = async () => ({
      binding: {
        key: 'five_hour', label: '5-hour', percentUsed: 13, stale: false, verdict: 'burning',
        turnsLeft: 208, headroomMs: 3 * 60 * MINUTE, windowStart: NOW - 60 * MINUTE, spanMs: 300 * MINUTE,
      },
      sessions: [
        { sessionId: 'a', turns: 30, cost: 14.76, share: 0.85 },
        { sessionId: 'b', turns: 7, cost: 2.56, share: 0.12 },
        { sessionId: 'fresh', turns: 2, cost: 0.5, share: 0.03 },
      ],
    });
    const text = await pulse.run(NOW, { session_id: 'fresh' });
    assert.match(text, /3 sessions sharing it/);
    assert.match(text, /about 69 turns left/, 'a third of 208, not three per cent of it');
    assert.match(text, /Still room/);
  } finally {
    usage.report = realReport;
    if (previousDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = previousDir;
    if (previousPulse === undefined) delete process.env.USAGE_LIMITS_PULSE;
    else process.env.USAGE_LIMITS_PULSE = previousPulse;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
