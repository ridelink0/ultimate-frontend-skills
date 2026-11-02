'use strict';

// "ERROR: Value for '/TR' option cannot be more than 261 character(s)."
//
// That is what `relay.js arm` said twice on the night of 2026-09-20, and it
// is schtasks talking: the fallback route. The primary route had already
// failed - PowerShell killed at the fixed eight-second ceiling while the
// ScheduledTasks module was still loading (32 seconds on that machine), a
// timeout with no stderr - and nothing reported it. The task action carried
// node's path, the plugin cache path, the session id and the config
// directory: 326 characters on the 1.36.0 install.
//
// Now the action points at a small launcher under the config directory, so
// its length no longer depends on where the plugin lives, and a failure names
// both routes.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

function isolated(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ul-'));
  const before = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = dir;
  try {
    return fn(dir);
  } finally {
    if (before === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = before;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function fresh() {
  delete require.cache[require.resolve('../skills/usage-limits/scripts/relay.js')];
  return require('../skills/usage-limits/scripts/relay.js');
}

const ID = '0f3b9c1e-1234-4abc-9def-0123456789ab';
// A plugin path of at least a hundred characters, the shape of the real one.
const LONG_PLUGIN =
  'C:\\Users\\somebody-with-a-long-name\\.claude\\plugins\\cache\\usage-limits\\usage-limits\\1.37.0\\skills\\usage-limits\\scripts\\wake.js';

test('the task action stays under 200 characters for a 100-character plugin path', () => {
  const relay = fresh();
  assert.ok(LONG_PLUGIN.length >= 100, 'the fixture path is ' + LONG_PLUGIN.length + ' characters');
  const launcher = 'C:\\Users\\somebody\\.claude\\relay-task-0f3b9c1e.cmd';
  const action = relay.hiddenAction(launcher, 'C:\\Users\\somebody', false);
  const tr = relay.taskAction(action);
  assert.ok(tr.length < 200, tr.length + ' characters: ' + tr);
  assert.ok(tr.startsWith('"' + action.execute + '" -NoProfile -NonInteractive -WindowStyle Hidden -Command "& \''));
  assert.ok(!tr.includes('wake.js') && !tr.includes(process.execPath), 'the plugin path and node are in the launcher, not the action');
  // The launcher is where the long path goes, and it does not change the action.
  const script = relay.wakeLauncherScript([LONG_PLUGIN, '--id', ID, '--config-dir', 'C:\\Users\\somebody\\.claude']);
  assert.ok(script.includes('"' + LONG_PLUGIN + '"'));
  assert.strictEqual(relay.taskAction(relay.hiddenAction(launcher, 'D:\\elsewhere', false)).length, tr.length);
});

test('the launcher holds the whole node command, each argument quoted for cmd', () =>
  isolated((dir) => {
    const relay = fresh();
    const argv = [LONG_PLUGIN, '--id', ID, '--host', 'claude', '--config-dir', dir + '\\100%'];
    const file = relay.writeWakeLauncher(ID, argv);
    assert.strictEqual(file, path.join(dir, 'relay-task-0f3b9c1e.cmd'), 'named for the first eight characters of the id');
    const text = fs.readFileSync(file, 'utf8');
    assert.ok(text.startsWith('@echo off\r\n'));
    assert.ok(
      text.endsWith(
        '"' + process.execPath + '" "' + LONG_PLUGIN + '" "--id" "' + ID + '" "--host" "claude" "--config-dir" "' + dir + '\\100%%"\r\n'
      ),
      text
    );
    // cmd's two rules: a percent sign is doubled, a double quote is dropped.
    assert.strictEqual(relay.batchArg('say "hi" 50%'), '"say hi 50%%"');
    // The name is safe whatever the id holds.
    assert.strictEqual(path.basename(relay.wakeLauncherFile('../..\\x y')), 'relay-task-xy.cmd');
  }));

test('a launcher with no record is swept; an armed record keeps its own until it is disarmed', () =>
  isolated((dir) => {
    const relay = fresh();
    fs.writeFileSync(path.join(dir, '.claude.json'), JSON.stringify({ projects: {} }));
    const NOW = Date.UTC(2026, 8, 21, 20, 0, 0);
    const armed = relay.arm({
      now: NOW, sessionId: 'aaaa-1', cwd: dir, project: 'p', schedule: false,
      resetsAt: NOW + 60 * 60 * 1000,
      binding: { percentUsed: 85, resetsAt: NOW + 60 * 60 * 1000, key: 'five_hour', label: '5-hour' },
      work: { hasWork: true, pending: 1, source: 'test', todos: [] },
      config: { enabled: true, mode: 'notify', graceMinutes: 2, armOn: 'threshold', at: 80, backstopAt: 95 },
    });
    assert.ok(armed.ok, armed.error);
    relay.writeWakeLauncher('aaaa-1', ['w.js', '--id', 'aaaa-1']);
    relay.writeWakeLauncher('zzzz-9', ['w.js', '--id', 'zzzz-9']);
    fs.writeFileSync(path.join(dir, 'relay-wake-aaaa-1.cmd'), 'not a task launcher');
    relay.sweepWakeLaunchers(relay.read());
    assert.ok(fs.existsSync(relay.wakeLauncherFile('aaaa-1')), 'the armed record keeps its launcher');
    assert.ok(!fs.existsSync(relay.wakeLauncherFile('zzzz-9')), 'the stray is gone');
    assert.ok(fs.existsSync(path.join(dir, 'relay-wake-aaaa-1.cmd')), 'other files are not touched');
    relay.disarm('test', NOW, 'aaaa-1');
    assert.ok(!fs.existsSync(relay.wakeLauncherFile('aaaa-1')), 'disarming takes the launcher with the record');
  }));

test('a timed-out primary route is named beside the fallback, not swallowed', () => {
  const relay = fresh();
  assert.strictEqual(
    relay.describeSpawn('ScheduledTasks', { error: { code: 'ETIMEDOUT', message: 'spawnSync powershell.exe ETIMEDOUT' }, status: null, signal: 'SIGTERM', stderr: '', stdout: '' }, 8000),
    'ScheduledTasks: timed out after 8 s'
  );
  assert.strictEqual(
    relay.describeSpawn('schtasks', { status: 2147500037, stderr: "ERROR: Value for '/TR' option cannot be more than 261 character(s).\r\n", stdout: '' }, 8000),
    "schtasks: ERROR: Value for '/TR' option cannot be more than 261 character(s)."
  );
  assert.strictEqual(relay.describeSpawn('schtasks', { status: 2, stderr: '', stdout: '' }, 8000), 'schtasks: exited 2 with no output');
  assert.strictEqual(relay.describeSpawn('schtasks', null, 8000), 'schtasks: not attempted');
  // From the command line nothing bounds the PowerShell route but its own
  // ceiling, which has to be longer than the module takes to load here.
  assert.ok(relay.PS_ROUTE_MS >= 45000);
  assert.strictEqual(relay.remainingMs(undefined, relay.PS_ROUTE_MS), relay.PS_ROUTE_MS);
  assert.strictEqual(relay.remainingMs(Date.now() + 3000, relay.PS_ROUTE_MS) <= 3000, true, 'a hook deadline still bounds it');
});
