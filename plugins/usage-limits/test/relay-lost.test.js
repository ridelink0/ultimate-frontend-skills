'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const relay = require('../skills/usage-limits/scripts/relay.js');
const wake = require('../skills/usage-limits/scripts/wake.js');
const brief = require('../skills/usage-limits/scripts/brief.js');

const MINUTE = 60 * 1000;
function withConfigDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ul-lost-'));
  const saved = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = dir;
  try {
    return fn(dir);
  } finally {
    if (saved === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = saved;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('a saved continuation is work to carry, so a session with a note but no todo list arms', () =>
  withConfigDir(() => {
    const config = relay.configure({ enabled: true });
    const binding = { percentUsed: 92, resetsAt: Date.now() + 60 * MINUTE };
    const refused = relay.armable({ config, binding, sessionId: 'sess-note', work: { hasWork: false }, atCompletion: true });
    assert.strictEqual(refused.ok, false);
    assert.match(refused.why, /no plan or unfinished/);
    assert.match(refused.why, /no saved continuation/);
    relay.saveContinuation('sess-note', 'finish the audit, then push');
    const allowed = relay.armable({ config, binding, sessionId: 'sess-note', work: { hasWork: false }, atCompletion: true });
    assert.strictEqual(allowed.ok, true, 'the note is the plan');
    const work = relay.workWithContinuation({ hasWork: false, pending: 0, todos: [] }, 'sess-note');
    assert.strictEqual(work.source, 'continuation');
    assert.strictEqual(work.pending, 1);
    assert.strictEqual(relay.workWithContinuation({ hasWork: true, source: 'todos' }, 'sess-note').source, 'todos', 'real work is left alone');
  }));

test('a wake that never reported back is reaped as lost, and only then', () =>
  withConfigDir(() => {
    const now = Date.now();
    const fresh = relay.empty();
    fresh.armed = { id: 'dead-0000', cwd: '/w', wakeAt: now - 10 * MINUTE, task: null, continuation: false };
    relay.write(fresh);
    assert.strictEqual(relay.reapLost(now), false, 'ten minutes past its wake, it may still be starting');
    fresh.armed.wakeAt = now - 6 * 60 * MINUTE;
    relay.write(fresh);
    assert.strictEqual(relay.reapLost(now), false, 'six hours past: a sleeping machine runs it on resume, inside the 12-hour expiry');
    fresh.armed.wakeAt = now - 13 * 60 * MINUTE;
    relay.write(fresh);
    assert.strictEqual(relay.reapLost(now), true, 'never started in 13 hours: lost');
    assert.strictEqual(relay.read().armed, null);
    assert.strictEqual(relay.read().history[0].outcome, 'lost');
    assert.match(relay.read().history[0].detail, /never started/);
    const running = relay.empty();
    running.armed = { id: 'run-0000', cwd: '/w', wakeAt: now - 2 * 60 * MINUTE, wokeAt: now - 2 * 60 * MINUTE + MINUTE, task: null };
    relay.write(running);
    assert.strictEqual(relay.reapLost(now), false, 'a headless run may take three hours');
    running.armed.wokeAt = now - 4 * 60 * MINUTE;
    relay.write(running);
    assert.strictEqual(relay.reapLost(now), true);
    assert.match(relay.read().history[0].detail, /never reported back/);
  }));

test('the scheduled task runs the launcher under a hidden PowerShell, its path quoted', () => {
  const action = relay.hiddenAction("C:\\Users\\o'b\\.claude\\relay-task-sess1234.cmd", 'C:\\work', false);
  assert.match(action.execute, /powershell\.exe$/i);
  assert.ok(action.argument.startsWith('-NoProfile -NonInteractive -WindowStyle Hidden -Command "& '));
  assert.ok(action.argument.endsWith("'C:\\Users\\o''b\\.claude\\relay-task-sess1234.cmd'\""), 'the apostrophe is doubled for PowerShell');
  assert.ok(!action.argument.includes(process.execPath), 'node and the plugin path live in the launcher, not the action');
  assert.strictEqual(action.cwd, 'C:\\work');
});

test('the POSIX launcher is the same window: cd, clear the markers, run, keep a failure open', () => {
  const script = wake.launcherScriptPosix({ id: 'sess-1234', cwd: "/Users/me/it's here", project: 'proj' }, { model: 'opus' }, '/usr/local/bin/claude', '/cfg/p.md', '/cfg/p.exit');
  assert.ok(script.startsWith('#!/bin/sh\n'));
  assert.ok(script.includes("cd '/Users/me/it'\\''s here' || exit 1"), 'POSIX quoting of the apostrophe');
  assert.ok(script.includes('unset CLAUDE_CODE_CHILD_SESSION CLAUDE_CODE_SESSION_ID'));
  assert.ok(script.includes("'/usr/local/bin/claude' '--resume' 'sess-1234' '--model' 'opus' '--remote-control' 'usage-limits relay proj'"));
  assert.ok(script.includes('echo "$code" > \'/cfg/p.exit\''));
  assert.ok(script.includes('read -r _'));
  assert.strictEqual(wake.shQuote('plain'), "'plain'");
});

test('bugcheck always puts the two passes on every prompt; on keeps them to the hand-off', () =>
  withConfigDir(() => {
    relay.configure({ bugcheck: 'always' });
    assert.ok(brief.withBugcheck('the brief').endsWith(relay.BUGCHECK_LINE));
    assert.ok(brief.withBugcheck('the brief').startsWith('the brief '));
    relay.configure({ bugcheck: 'on' });
    assert.strictEqual(brief.withBugcheck('the brief'), 'the brief');
    assert.strictEqual(relay.settings(relay.read()).bugcheck, 'on');
    relay.configure({ bugcheck: 'always' });
    assert.strictEqual(relay.settings(relay.read()).bugcheck, 'always', 'always is a real value again');
  }));
