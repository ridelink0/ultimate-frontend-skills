'use strict';

// relay fresh: hand the work to a NEW conversation instead of resuming the old.
//
// Found 2026-09-29: defer.md said the wake "starts a fresh session in the
// original directory and hands it the saved plan", and wake.js ran
// `claude --resume <id>` - the same conversation. A long session is the one
// that runs out, and resuming carries all of it into the next window. With
// fresh on the wake starts `claude` in the project with the hand-off as its
// first prompt, inline, Remote Control on under a name that says so, and the
// relay's permission mode. Off, which is the default, nothing changes.
//
// No test here starts claude or registers a scheduled task: windows go to a
// fake opener, headless runs to a fake spawnSync, the arming under node --test
// is a dry run, and the two things that really run are sh with a fake CLI and
// node itself.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const relay = require('../skills/usage-limits/scripts/relay.js');
const wake = require('../skills/usage-limits/scripts/wake.js');
const defer = require('../skills/usage-limits/scripts/defer.js');
const tempdirs = require('../tools/test-tempdirs.js');

const ID = '5a1d0c2e-1234-4abc-9def-0123456789ab';
const WAKE = path.join(__dirname, '..', 'skills', 'usage-limits', 'scripts', 'wake.js');
const PROMPT = "ultrathink\n\nThe work: it's \"quoted\", $HOME, `ticks`, 100% and a \\ backslash.\n\n- a todo";

function isolated(fn) {
  const dir = tempdirs.make(path.join(os.tmpdir(), 'usage-limits-relay-fresh-'));
  const keys = ['CLAUDE_CONFIG_DIR', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_SESSION_ID', 'CODEX_SESSION_ID', 'USAGE_LIMITS_HOST', 'USAGE_LIMITS_RELAY_MODE'];
  const before = {};
  for (const key of keys) before[key] = process.env[key];
  process.env.CLAUDE_CONFIG_DIR = dir;
  for (const key of keys.slice(1)) delete process.env[key];
  const done = () => {
    for (const key of keys) {
      if (before[key] === undefined) delete process.env[key];
      else process.env[key] = before[key];
    }
  };
  let out;
  try {
    out = fn(dir);
  } catch (err) {
    done();
    throw err;
  }
  if (out && typeof out.then === 'function') return out.finally(done);
  done();
  return out;
}

function clockIo(extra) {
  let clock = 0;
  return Object.assign({ sleep: (ms) => { clock += ms; }, now: () => clock }, extra || null);
}

// --- the switch ---------------------------------------------------------------

test('fresh is off by default, and relay fresh on|off says exactly what the wake will do', () =>
  isolated(() => {
    assert.strictEqual(relay.DEFAULTS.fresh, false);
    assert.strictEqual(relay.settings(relay.read()).fresh, false);
    assert.match(relay.main(['fresh', 'maybe']), /^Fresh is OFF now\. Say relay fresh on .* or relay fresh off/);
    assert.strictEqual(relay.settings(relay.read()).fresh, false, 'an unreadable value changes nothing');

    const on = relay.main(['fresh', 'on']);
    assert.strictEqual(relay.settings(relay.read()).fresh, true);
    assert.match(on, /^Fresh ON: the wake starts a new claude session in the project, with the whole hand-off as its first prompt, Remote Control on/);
    assert.match(on, /native user permissions/);
    assert.match(on, /if it is still open and working again, the wake stands down/);
    assert.match(on, /applies once relay mode resume is set/, 'mode notify starts nothing either way, and it says so');

    relay.main(['mode', 'resume']);
    relay.main(['permission', 'acceptEdits']);
    const again = relay.main(['fresh', 'on']);
    assert.match(again, /native user permissions/);
    assert.doesNotMatch(again, /applies once relay mode resume/);
    assert.match(relay.status(Date.now()), /delivery resume into a new session \(fresh on\)\./);

    assert.match(relay.main(['fresh', 'off']), /^Fresh OFF: the wake resumes the same conversation \(claude --resume\)\./);
    assert.match(relay.status(Date.now()), /delivery resume of the same conversation \(fresh off\)\./);
  }));

// --- the prompt ---------------------------------------------------------------

test('the new session is told it has none of the conversation; the resume\'s opening is unchanged', () => {
  const fresh = relay.compose({ fresh: true, continuation: 'Next: the docs.' });
  assert.match(fresh, /^The usage window has reset, and this is the plugin handing an earlier session's work to this new one, not a new request\./);
  assert.match(fresh, /You have none of that conversation: what follows is what it left\./);
  assert.match(fresh, /You are in its project folder, with the files as it left them, uncommitted changes included\./);
  assert.match(fresh, /This is what the session left for itself:\n\nNext: the docs\./);
  const deferred = relay.compose({ fresh: true, deferred: true, continuation: 'x' });
  assert.match(deferred, /^The time this work was deferred to has come, and this is the plugin handing it to a new session/);
  const fromHome = relay.compose({ fresh: true, projectDir: '/home/me', continuation: 'x' });
  assert.match(fromHome, /The project is \/home\/me, added to this session, which was started from a trusted folder on purpose: use absolute paths\./);
  assert.match(relay.compose({ continuation: 'x' }), /^The usage window has reset and this is the plugin picking the work back up, not a new request\. Carry on from where the last turn stopped/);
});

// --- the window ---------------------------------------------------------------

test('fresh on: a new session in a window, the hand-off inline as its first prompt, no transcript needed', () =>
  isolated((dir) => {
    const record = { id: ID, cwd: dir, project: 'proj' };
    const runs = [];
    const opened = [];
    const result = wake.deliverClaude(record, PROMPT, { show: true, fresh: true, permissionMode: 'acceptEdits', model: 'opus' }, '/usr/local/bin/claude', runs,
      clockIo({ platform: 'linux', open: (launcher) => opened.push(launcher) }));
    assert.strictEqual(result.ok, true, 'there is no transcript for ' + ID + ', and a new session needs none');
    assert.strictEqual(result.how, 'a new claude session in a window, Remote Control on');
    assert.deepStrictEqual(opened, [path.join(dir, 'relay-wake-' + ID + '.sh')]);
    const script = fs.readFileSync(opened[0], 'utf8');
    assert.ok(!script.includes('--resume'), 'not the same conversation');
    assert.ok(script.includes(
      "'/usr/local/bin/claude' '--model' 'opus' '--remote-control' 'usage-limits relay proj (new session)' " +
        wake.shQuote(PROMPT)
    ), script);
    assert.ok(script.includes('cd ' + wake.shQuote(dir)), 'in the project directory');
    assert.match(runs[0], /--- claude, a new session \(window\) \(exit 0\) ---/);
    assert.match(runs[0], /Remote Control on as "usage-limits relay proj \(new session\)", the hand-off inline as its first prompt/);
  }));

test('the POSIX launcher hands claude the multi-line hand-off byte for byte', { skip: process.platform === 'win32' && 'sh, checked where sh is' }, () =>
  isolated((dir) => {
    // A stand-in for claude that writes each argument it was given, NUL-separated.
    const fake = path.join(dir, 'fake-claude.sh');
    const out = path.join(dir, 'args.bin');
    fs.writeFileSync(fake, '#!/bin/sh\nfor a in "$@"; do printf \'%s\\0\' "$a"; done > ' + wake.shQuote(out) + '\n');
    fs.chmodSync(fake, 0o755);
    const record = { id: ID, cwd: dir, project: 'proj' };
    const result = wake.deliverClaude(record, PROMPT, { show: true, fresh: true, permissionMode: 'auto' }, fake, [], clockIo({
      platform: 'linux',
      open: (launcher) => {
        const ran = spawnSync('sh', [launcher], { encoding: 'utf8', env: Object.assign({}, process.env, { CLAUDE_CODE_SESSION_ID: 'parent' }) });
        assert.strictEqual(ran.status, 0, ran.stderr);
      },
    }));
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.how, 'a new claude session in a window', 'the fake exited 0 inside the grace period');
    const args = fs.readFileSync(out, 'utf8').split('\0').slice(0, -1);
    assert.deepStrictEqual(args, ['--remote-control', 'usage-limits relay proj (new session)', PROMPT]);
  }));

test('on Windows the inline hand-off goes through node to the native claude.exe, never through cmd', () =>
  isolated((dir) => {
    const record = { id: ID, cwd: 'C:\\work\\proj', project: 'proj' };
    const opened = [];
    const result = wake.deliverClaude(record, PROMPT, { show: true, fresh: true, permissionMode: 'acceptEdits' }, 'C:\\npm\\claude.cmd', [], clockIo({
      platform: 'win32',
      nativeCli: () => 'C:\\Users\\me\\.local\\bin\\claude.exe',
      open: (launcher) => opened.push(launcher),
    }));
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(opened, [path.join(dir, 'relay-wake-' + ID + '.cmd')]);
    const script = fs.readFileSync(opened[0], 'utf8');
    assert.ok(script.includes('call ' + wake.bridgeCommand(wake.specFile(ID)) + '\r\n'), script);
    assert.ok(script.includes('"--exec-spec"'));
    assert.ok(!script.includes('claude.cmd'), 'the shim would cut the hand-off at its first line break');
    assert.ok(!script.includes('it\'s'), 'the hand-off is not in the batch file at all');
    const spec = JSON.parse(fs.readFileSync(wake.specFile(ID), 'utf8'));
    assert.strictEqual(spec.cli, 'C:\\Users\\me\\.local\\bin\\claude.exe');
    assert.deepStrictEqual(spec.args, ['--remote-control', 'usage-limits relay proj (new session)', PROMPT]);
  }));

test('with only a batch shim, or a hand-off too long for one argument, the first prompt points at the file instead', () =>
  isolated((dir) => {
    const record = { id: ID, cwd: 'C:\\work\\proj', project: 'proj' };
    const runs = [];
    const opened = [];
    const result = wake.deliverClaude(record, PROMPT, { show: true, fresh: true }, 'C:\\npm\\claude.cmd', runs, clockIo({
      platform: 'win32',
      nativeCli: () => 'C:\\npm\\claude.cmd',
      open: (launcher) => opened.push(launcher),
    }));
    assert.strictEqual(result.ok, true);
    const script = fs.readFileSync(opened[0], 'utf8');
    const promptFile = wake.wakePromptFile(ID);
    assert.ok(script.includes('call "C:\\npm\\claude.cmd" "--remote-control" "usage-limits relay proj (new session)" "This is a new session taking over work'), script);
    assert.ok(script.includes(promptFile), 'the pointer names the file');
    assert.ok(!script.includes('--resume'));
    assert.strictEqual(fs.readFileSync(promptFile, 'utf8').trim(), PROMPT.trim(), 'the whole hand-off is on disk for it');
    assert.match(runs[0], /the hand-off in .*relay-wake-.*\.md \(C:\\npm\\claude\.cmd is a batch shim and cmd\.exe ends a command at the first line break\)/);
    assert.match(fs.readFileSync(relay.logFile(), 'utf8'), /the hand-off is not inline \(C:\\npm\\claude\.cmd is a batch shim/);

    const long = 'x'.repeat(wake.FRESH_ARG_MAX.win32 + 1);
    const plan = wake.freshLaunch(record, {}, 'C:\\bin\\claude.exe', long, 'C:\\cfg\\p.md', 'win32');
    assert.strictEqual(plan.inline, false);
    assert.match(plan.why, /30001 characters, more than one argument holds here \(30000\)/);
    assert.ok(plan.args[plan.args.length - 1].includes('C:\\cfg\\p.md'));
    assert.strictEqual(wake.freshLaunch(record, {}, '/bin/claude', long, '/p.md', 'linux').inline, true, 'Linux holds 128 KiB in one argument');
    // Quoting for CreateProcess can add one character per quote or backslash.
    const quoted = '"'.repeat(16000);
    assert.strictEqual(wake.freshLaunch(record, {}, 'C:\\bin\\claude.exe', quoted, 'C:\\cfg\\p.md', 'win32').inline, false);
  }));

test('the node bridge passes a multi-line hand-off to the program as one argument, and its exit code back', () =>
  isolated((dir) => {
    const spec = path.join(dir, 'spec.json');
    // node itself stands in for claude.exe: it prints the argument it got and exits 7.
    fs.writeFileSync(spec, JSON.stringify({ cli: process.execPath, args: ['-e', 'process.stdout.write(process.argv[1]); process.exit(7)', PROMPT] }));
    const run = spawnSync(process.execPath, [WAKE, '--exec-spec', spec], { encoding: 'utf8', timeout: 30000, windowsHide: true });
    assert.strictEqual(run.stdout, PROMPT);
    assert.strictEqual(run.status, 7);
    const missing = spawnSync(process.execPath, [WAKE, '--exec-spec', path.join(dir, 'none.json')], { encoding: 'utf8', timeout: 30000, windowsHide: true });
    assert.strictEqual(missing.status, 1);
    assert.match(missing.stderr, /could not read/);
  }));

// --- headless -----------------------------------------------------------------

test('relay show off with fresh on is a new headless run, the hand-off on stdin; fresh off is unchanged', () =>
  isolated((dir) => {
    const config = { show: false, fresh: true, permissionMode: 'acceptEdits' };
    assert.deepStrictEqual(wake.claudeArgs({ id: ID, cwd: dir }, 'x', config, false), ['-p', '--permission-prompts', 'none']);
    const calls = [];
    const runs = [];
    const result = wake.deliverClaude({ id: ID, cwd: dir }, PROMPT, config, '/bin/claude', runs, {
      spawnSync: (cli, args, options) => {
        calls.push({ cli, args, options });
        return { status: 0, stdout: 'done', stderr: '' };
      },
    });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.how, 'claude -p, a new session');
    assert.strictEqual(calls[0].options.input, PROMPT);
    assert.strictEqual(calls[0].options.cwd, dir);
    assert.ok(!calls[0].args.includes('--resume'));
    assert.match(runs[0], /^--- claude -p, a new session \(exit 0\) ---/);
    assert.deepStrictEqual(wake.claudeArgs({ id: ID, cwd: dir }, 'x', { show: false }, false).slice(0, 3), ['--resume', ID, '-p']);
  }));

// --- the wake -----------------------------------------------------------------

const ONLINE = async () => ({ online: true, reason: 'ok', detail: null, results: [] });

function seed(dir, extra) {
  const state = relay.read();
  state.config = Object.assign({}, state.config, { mode: 'resume', enabled: true, fresh: true, voice: false });
  state.armed = Object.assign({
    id: ID, task: null, host: 'claude', cwd: dir, project: 'proj', armedAt: 1, wakeAt: Date.now(),
    windowKey: 'five_hour', mode: 'resume', attempt: 0, continuation: false, work: { pending: 1, todos: [] },
  }, extra || null);
  relay.write(state);
}

function deps(over) {
  const seen = { delivered: [], toasts: [] };
  let clock = 1000000;
  const base = {
    reachable: ONLINE,
    windowReopened: async () => ({ known: true, percent: 2 }),
    deliverClaude: (record, prompt, config) => {
      seen.delivered.push({ record, prompt, config });
      return { ok: true, how: 'test window' };
    },
    deliverCodex: () => ({ ok: false, error: 'not here' }),
    toast: (title, body) => seen.toasts.push(title + ': ' + body),
    userIsPresent: () => ({ known: true, present: false }),
    capabilities: () => ({ claude: 'claude', codex: null, computerUse: null }),
    arm: () => {
      throw new Error('no wake may be booked from this test');
    },
    liveSession: () => null,
    transcriptActiveSince: () => false,
    now: () => clock,
    sleep: (ms) => {
      clock += ms;
    },
  };
  return { deps: Object.assign(base, over || null), seen };
}

test('ONE TERMINAL holds with fresh on: an old session working again means no new one, a quiet one gets exactly one', () =>
  isolated(async (dir) => {
    seed(dir);
    const { deps: d, seen } = deps({ liveSession: () => ({ pid: 4242 }), transcriptActiveSince: () => true });
    const result = await wake.run(Date.now(), [], d);
    assert.strictEqual(result.outcome, 'live');
    assert.deepStrictEqual(seen.delivered, [], 'no new session beside the one that is working');
    assert.match(seen.toasts.join('\n'), /no second window/);

    // Open but quiet for the whole wait: the one new session, and the log says so.
    seed(dir);
    const quiet = deps({ liveSession: () => ({ pid: 4242 }), transcriptActiveSince: () => false });
    const opened = await wake.run(Date.now(), [], quiet.deps);
    assert.strictEqual(opened.outcome, 'resumed');
    assert.strictEqual(quiet.seen.delivered.length, 1);
    assert.match(fs.readFileSync(relay.logFile(), 'utf8'), /open in process 4242 but idle since the reset; starting a new session in a window/);
  }));

test('fresh on: the wake delivers the new session\'s prompt and says it is handing over', () =>
  isolated(async (dir) => {
    seed(dir);
    relay.saveContinuation(ID, 'Next: finish the relay docs.');
    const { deps: d, seen } = deps();
    const result = await wake.run(Date.now(), [], d);
    assert.strictEqual(result.outcome, 'resumed');
    assert.strictEqual(seen.delivered.length, 1);
    assert.strictEqual(seen.delivered[0].config.fresh, true);
    assert.match(seen.delivered[0].prompt, /^ultrathink\n\nThe usage window has reset, and this is the plugin handing an earlier session's work to this new one/);
    assert.match(seen.delivered[0].prompt, /Next: finish the relay docs\./);
    assert.match(seen.toasts.join('\n'), /Usage limits: handing over: Starting a new session for proj with the saved plan\./);
  }));

test('fresh on with mode notify starts nothing, and the note says how to start the new session by hand', () =>
  isolated(async (dir) => {
    seed(dir);
    relay.configure({ mode: 'notify' });
    const { deps: d, seen } = deps();
    const result = await wake.run(Date.now(), [], d);
    assert.strictEqual(result.outcome, 'notified');
    assert.deepStrictEqual(seen.delivered, []);
    assert.match(seen.toasts.join('\n'), /Start claude in .* and give it the hand-off in .*relay-wake-5a1d0c2e[^ ]*\.md$/);
    const handoff = fs.readFileSync(wake.wakePromptFile(ID), 'utf8');
    assert.match(handoff, /handing an earlier session's work to this new one/, 'the whole hand-off, opened for a new session');
    assert.doesNotMatch(seen.toasts.join('\n'), /claude --resume/);
  }));

// --- defer --------------------------------------------------------------------

test('defer says what fires in each mode, and under fresh a deferral with no session id still starts', () =>
  isolated(async (dir) => {
    assert.match(defer.whatFires({ mode: 'notify' }, 'claude', true), /only raises a notification with the plan \(relay mode notify\)/);
    assert.match(defer.whatFires({ mode: 'resume', fresh: false }, 'claude', true), /resumes this same conversation \(relay fresh off\)/);
    assert.match(defer.whatFires({ mode: 'resume', fresh: false }, 'claude', false), /no session id is known here, so it will fail: relay fresh on starts a new session instead/);
    assert.match(defer.whatFires({ mode: 'resume', fresh: true }, 'claude', false), /starts a new claude session in this folder with the saved work as its first prompt \(relay fresh on\)/);

    relay.configure({ mode: 'resume', fresh: true, voice: false });
    const line = defer.main(['in 90m', '--host', 'claude', '--cwd', dir, '--work', 'Write the fresh tests\nBump the version'], Date.now());
    assert.match(line, /Nothing has been started; 2 lines saved; then it starts a new claude session in this folder/);
    const record = relay.read().armed;
    assert.match(record.id, /^defer-/, 'no session id: nothing to resume, which fresh does not need');
    assert.strictEqual(record.deferred, true);

    // The wake for it, through the real window path to a fake opener.
    const opened = [];
    const { deps: d } = deps({
      deliverClaude: (rec, prompt, config, cli, runs) =>
        wake.deliverClaude(rec, prompt, config, '/usr/local/bin/claude', runs, clockIo({ platform: 'linux', open: (launcher) => opened.push(launcher) })),
    });
    const result = await wake.run(Date.now(), ['--id', record.id], d);
    assert.strictEqual(result.outcome, 'resumed', JSON.stringify(result));
    const script = fs.readFileSync(opened[0], 'utf8');
    assert.ok(!script.includes('--resume'));
    assert.ok(script.includes("'--remote-control' 'usage-limits relay " + path.basename(dir) + " (new session)'"));
    assert.match(script, /The time this work was deferred to has come, and this is the plugin handing it to a new session/);
    assert.match(script, /Write the fresh tests\nBump the version/);
  }));

test('defer marks its own record, not whichever relay was armed first', () =>
  isolated((dir) => {
    const state = relay.read();
    state.armed = { id: 'someone-else', task: null, host: 'claude', cwd: dir, wakeAt: Date.now() + 3 * 3600000, continuation: false };
    relay.write(state);
    const line = defer.main(['in 2h', '--host', 'claude', '--session-id', 'sess-defer-own', '--cwd', dir, '--work', 'x'], Date.now());
    assert.match(line, /^Doing this at /);
    const held = relay.read();
    assert.strictEqual(relay.armedFor(held, 'sess-defer-own').deferred, true);
    assert.strictEqual(relay.armedFor(held, 'someone-else').deferred, undefined, 'the other relay is left as it was');
  }));

// --- found in review ----------------------------------------------------------

// Linux's limit on one argument is 128 KiB of BYTES. Counting characters let
// 70,000 two-byte characters (140,000 bytes) through as inline, and the exec
// then failed E2BIG in the window, the same way on every retry.
test('the POSIX inline limit counts bytes, so a hand-off heavy in non-ASCII text goes by file instead of failing E2BIG', () => {
  const record = { id: ID, cwd: '/work/proj', project: 'proj' };
  const wide = '\u00e9'.repeat(70000);
  const plan = wake.freshLaunch(record, {}, '/bin/claude', wide, '/cfg/p.md', 'linux');
  assert.strictEqual(plan.inline, false);
  assert.match(plan.why, /140000 bytes, more than one argument holds here \(120000\)/);
  assert.ok(plan.args[plan.args.length - 1].includes('/cfg/p.md'));
  assert.strictEqual(wake.freshLaunch(record, {}, '/bin/claude', 'x'.repeat(70000), '/cfg/p.md', 'linux').inline, true);
});

// A project in the home folder is launched from the trusted folder the
// preflight answered for, with --add-dir back to it, as on Windows - and as
// the new session's own opening says. The POSIX launcher cd'd into the home
// folder itself, where the trust question waits for nobody.
test('the POSIX window starts a home-folder project from its trusted launch folder, with --add-dir back to it', () =>
  isolated((dir) => {
    const launch = path.join(dir, 'relay-cwd');
    const record = { id: ID, cwd: '/home/me', launchCwd: launch, project: 'me' };
    const opened = [];
    const result = wake.deliverClaude(record, PROMPT, { show: true, fresh: true }, '/usr/local/bin/claude', [], clockIo({ platform: 'linux', open: (launcher) => opened.push(launcher) }));
    assert.strictEqual(result.ok, true);
    const script = fs.readFileSync(opened[0], 'utf8');
    assert.ok(script.includes('cd ' + wake.shQuote(launch) + ' || exit 1'), script);
    assert.ok(script.includes("'--add-dir' '/home/me'"), script);
    const resume = wake.launcherScriptPosix(record, {}, '/usr/local/bin/claude', '/cfg/p.md', '/cfg/p.exit');
    assert.ok(resume.includes('cd ' + wake.shQuote(launch) + ' || exit 1'), 'the resume launches from the same folder');
  }));
