'use strict';

// No test, and no sandboxed run, may register a real scheduled task.
//
// Task Scheduler is machine-wide. On 2026-09-25 at 23:55 an adversarial run of
// the relay hook with HOME and USERPROFILE pointed at sandbox folders
// registered 8 real UsageLimitsRelay tasks, two of them for the live session's
// id - a second copy of the running conversation booked to resume on its own.
// The records went to the sandbox; the wakes went to the real machine.
//
// relay.schedulerMode() is the one switch. These tests pin its answers, and
// the last one re-creates the incident in a child process that is NOT under
// the test runner (NODE_TEST_CONTEXT removed), with a sandbox home, and then
// asks Windows whether a task with that id exists.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const tempdirs = require('../tools/test-tempdirs.js');

const RELAY = path.join(__dirname, '..', 'skills', 'usage-limits', 'scripts', 'relay.js');

// The environment of a process that is not a test: the runner's marker and any
// switch the caller set are removed, so only what the test passes decides.
function plainEnv(extra) {
  const env = Object.assign({}, process.env);
  delete env.NODE_TEST_CONTEXT;
  delete env.USAGE_LIMITS_SCHEDULER;
  return Object.assign(env, extra || null);
}

function modeIn(env) {
  const run = spawnSync(process.execPath, ['-e', 'process.stdout.write(JSON.stringify(require(' + JSON.stringify(RELAY) + ').schedulerMode()))'], {
    encoding: 'utf8',
    env,
    timeout: 30000,
    windowsHide: true,
  });
  assert.strictEqual(run.status, 0, run.stderr);
  return JSON.parse(run.stdout);
}

function sandboxHome() {
  const home = tempdirs.make(path.join(os.tmpdir(), 'usage-limits-guard-home-'));
  return { HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: path.join(home, '.claude') };
}

test('inside node --test the scheduler is a dry run', () => {
  const relay = require(RELAY);
  assert.ok(process.env.NODE_TEST_CONTEXT, 'node --test sets NODE_TEST_CONTEXT');
  const mode = relay.schedulerMode();
  assert.strictEqual(mode.dry, true);
  assert.match(mode.why, /node --test/);
});

test('what a test spawns inherits the dry run', () => {
  const mode = modeIn(Object.assign({}, process.env));
  assert.strictEqual(mode.dry, true);
});

test('a plain process with the real home is real', () => {
  assert.deepStrictEqual(modeIn(plainEnv()), { dry: false, why: null });
});

test('a redirected home is a dry run, and says which home', () => {
  const extra = sandboxHome();
  const mode = modeIn(plainEnv(extra));
  assert.strictEqual(mode.dry, true);
  assert.ok(mode.why.includes(extra.USERPROFILE) || mode.why.includes(extra.HOME), mode.why);
});

test('USAGE_LIMITS_SCHEDULER=dry-run is a dry run, and =real overrides everything', () => {
  assert.strictEqual(modeIn(plainEnv({ USAGE_LIMITS_SCHEDULER: 'dry-run' })).dry, true);
  assert.strictEqual(modeIn(Object.assign({}, process.env, { USAGE_LIMITS_SCHEDULER: 'real' })).dry, false);
  assert.strictEqual(modeIn(plainEnv(Object.assign(sandboxHome(), { USAGE_LIMITS_SCHEDULER: 'REAL' }))).dry, false);
});

test('schedule and cancelSchedule touch nothing in a dry run', () => {
  const relay = require(RELAY);
  const answer = relay.schedule(Date.now() + 60 * 60 * 1000, ['wake.js', '--id', 'guard'], 'UsageLimitsRelay-guard-never', process.cwd());
  assert.strictEqual(answer.ok, true);
  assert.strictEqual(answer.how, 'dry-run');
  assert.match(answer.warning, /no wake was registered/);
  assert.strictEqual(relay.cancelSchedule('UsageLimitsRelay-guard-never'), true);
});

test('the 2026-09-25 incident, re-created outside the test runner, registers no task', { skip: process.platform !== 'win32' && 'Task Scheduler is Windows only' }, () => {
  const id = 'guard-' + process.pid + '-' + Date.now().toString(36);
  const extra = sandboxHome();
  fs.mkdirSync(extra.CLAUDE_CONFIG_DIR, { recursive: true });
  const script =
    'const relay = require(' + JSON.stringify(RELAY) + ');' +
    'const now = Date.now();' +
    'const resetsAt = now + 2 * 60 * 60 * 1000;' +
    'const r = relay.arm({ now, sessionId: ' + JSON.stringify(id) + ', cwd: process.cwd(), hostName: "claude", resetsAt,' +
    ' binding: { percentUsed: 95, resetsAt }, work: { hasWork: true, pending: 1, todos: [] } });' +
    'const held = relay.armedFor(relay.read(), ' + JSON.stringify(id) + ');' +
    'process.stdout.write(JSON.stringify({ ok: r.ok, error: r.error || null, how: held ? held.how : null }));';
  const run = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', env: plainEnv(extra), timeout: 120000, windowsHide: true });
  assert.strictEqual(run.status, 0, run.stderr);
  const said = JSON.parse(run.stdout);
  // The arming has to get as far as the scheduler, or this proves nothing:
  // an arm refused earlier (no reset time, no work) never asks Windows at all.
  assert.strictEqual(said.ok, true, 'the arm must reach the scheduler: ' + JSON.stringify(said));
  assert.strictEqual(said.how, 'dry-run', JSON.stringify(said));
  const listing = spawnSync('schtasks.exe', ['/Query', '/FO', 'CSV', '/NH'], { encoding: 'utf8', timeout: 60000, windowsHide: true });
  assert.strictEqual(listing.status, 0, 'schtasks could not list tasks: ' + listing.stderr);
  assert.ok(!listing.stdout.includes(id), 'a real task was registered for ' + id);
});
