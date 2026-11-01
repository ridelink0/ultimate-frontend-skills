'use strict';

// 2026-09-14: the 8:05 PM relay fired, resumed the session and worked - in a
// console window that showed only its title, because `claude -p` prints at
// the end, the wake was capturing its streams, and a headless run is not on
// Remote Control. The visible resume is now an interactive session in its
// own window, Remote Control on, told where the hand-off is.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const wake = require('../skills/usage-limits/scripts/wake.js');

function withConfigDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ul-wake-window-'));
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

function transcriptFor(dir, id) {
  const project = path.join(dir, 'projects', 'C--work-proj');
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(path.join(project, id + '.jsonl'), '{}\n');
}

test('the visible run is an interactive session: no -p, Remote Control on, the prompt a pointer at the hand-off', () => {
  const record = { id: 'sess-1234', cwd: 'C:\\work\\proj', project: 'proj' };
  const args = wake.visibleArgs(record, { permissionMode: 'bypassPermissions', model: 'claude-opus-5' }, 'C:\\cfg\\relay-wake-sess-1234.md');
  assert.ok(!args.includes('-p'), 'an interactive session, not a print run');
  assert.ok(!args.includes('--permission-prompts'), 'that flag belongs to the headless run');
  assert.deepStrictEqual(args.slice(0, 4), ['--resume', 'sess-1234', '--model', 'claude-opus-5']);
  assert.strictEqual(args[4], '--remote-control');
  assert.strictEqual(args[5], 'usage-limits relay proj', 'named, so the optional value cannot swallow the prompt');
  const prompt = args[6];
  assert.ok(prompt.includes('C:\\cfg\\relay-wake-sess-1234.md'), 'the prompt names the file');
  assert.ok(prompt.length < 600, 'far under the 8,191-character argv limit');
  assert.ok(!/"/.test(prompt), 'no quotes: it goes through cmd and then argv');
  // Even with no config at all the session is still resumed and reachable.
  const bare = wake.visibleArgs(record, {}, 'p.md');
  assert.deepStrictEqual(bare.slice(0, 4), ['--resume', 'sess-1234', '--remote-control', 'usage-limits relay proj']);
});

test('the launcher calls claude.cmd, doubles percent signs and keeps a failed window open', () => {
  const record = { id: 'sess-1234', cwd: 'C:\\work\\proj', project: 'proj' };
  const script = wake.launcherScript(record, { model: 'opus' }, 'C:\\Users\\Me 100%\\claude.cmd', 'C:\\cfg\\p.md', 'C:\\cfg\\p.exit');
  assert.match(script, /^@echo off\r\n/);
  assert.ok(script.includes('call "C:\\Users\\Me 100%%\\claude.cmd"'), 'call, or a batch file never returns; %% or cmd expands it');
  assert.ok(script.includes('cd /d "C:\\work\\proj"'));
  assert.ok(script.includes('"--remote-control" "usage-limits relay proj"'));
  assert.ok(script.includes('> "C:\\cfg\\p.exit" echo %CODE%'), 'the exit code is written for the wake to read');
  assert.ok(script.includes('pause >nul'), 'a failed window stays open to be read');
  assert.ok(script.includes('title Claude relay - proj'));
  // Launched from inside a session, the window inherited its markers and
  // ran with transcript saving off; the launcher clears them first.
  assert.ok(script.includes('\r\nset CLAUDE_CODE_CHILD_SESSION=\r\n'), 'nobody\'s child');
  assert.ok(script.includes('\r\nset CLAUDE_CODE_SESSION_ID=\r\n'), 'its own id for the hooks');
});

test('a visible resume of a session with no transcript is permanent and opens nothing', () =>
  withConfigDir((dir) => {
    const calls = [];
    const result = wake.deliverClaude({ id: 'gone-0000', cwd: dir }, 'plan', { show: true }, 'claude.cmd', [], {
      open: () => calls.push('open'),
      sleep: () => {},
      now: () => 0,
    });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.permanent, true);
    assert.match(result.error, /no longer exists/);
    assert.deepStrictEqual(calls, [], 'no window for an error');
    assert.ok(!fs.existsSync(path.join(dir, 'relay-wake-gone-0000.cmd')));
  }));

test('a window that dies at once reports the exit code; one that keeps running is the resume', () =>
  withConfigDir((dir) => {
    transcriptFor(dir, 'sess-1234');
    const record = { id: 'sess-1234', cwd: dir, project: 'proj' };
    const runs = [];
    let clock = 0;
    const io = { sleep: (ms) => { clock += ms; }, now: () => clock };
    const dead = wake.deliverClaude(record, 'the plan', { show: true, model: 'opus' }, 'claude.cmd', runs, Object.assign({
      open: (launcher, exitPath) => { fs.writeFileSync(exitPath, '3\r\n'); },
    }, io));
    assert.strictEqual(dead.ok, false);
    assert.match(dead.error, /exited 3/);
    assert.strictEqual(fs.readFileSync(path.join(dir, 'relay-wake-sess-1234.md'), 'utf8').trim(), 'the plan', 'the hand-off is on disk for the pointer');
    // Each platform writes its own launcher: a .cmd on Windows, a .sh elsewhere,
    // with that shell's own quoting.
    const win = process.platform === 'win32';
    const launcher = fs.readFileSync(path.join(dir, 'relay-wake-sess-1234' + (win ? '.cmd' : '.sh')), 'utf8');
    assert.ok(launcher.includes('--remote-control'));
    assert.ok(launcher.includes(win ? '"--model" "opus"' : "'--model' 'opus'"));
    assert.strictEqual(runs.length, 1);
    assert.match(runs[0], /exit 3/);

    clock = 0;
    const alive = wake.deliverClaude(record, 'the plan', { show: true }, 'claude.cmd', runs, Object.assign({ open: () => {} }, io));
    assert.strictEqual(alive.ok, true, 'a stale exit file from the last run must not count');
    assert.match(alive.how, /window/);
    assert.match(alive.how, /Remote Control/);
    assert.strictEqual(runs.length, 2);
    assert.match(runs[1], /still running after 20s/);
    assert.ok(clock >= wake.LAUNCH_GRACE_MS, 'waited the whole grace period before calling it running');
  }));

test('relay show off keeps the headless run exactly as it was', () => {
  const args = wake.claudeArgs({ id: 'sess-1234', cwd: '/w' }, 'x', { show: false, permissionMode: 'acceptEdits' }, false);
  assert.deepStrictEqual(args, ['--resume', 'sess-1234', '-p', '--permission-prompts', 'none']);
});
