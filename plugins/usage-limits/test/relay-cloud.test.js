'use strict';

// relay cloud: the same hand-off the wake would deliver, into a cloud session
// now instead of this one after the reset.
//
// A cloud session is not this machine. It clones the repository from GitHub,
// so an uncommitted change or an unpushed commit is not there; and it cannot
// read a file here, so the hand-off rides inline. Both are said, never
// assumed. And it spends a real credit, so - like the scheduler - no test may
// ever start one: every launch below is a dry run or goes to a fake spawner.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const tempdirs = require('../tools/test-tempdirs.js');

const RELAY = path.join(__dirname, '..', 'skills', 'usage-limits', 'scripts', 'relay.js');

// Each test its own config directory and none of this machine's session ids.
function isolated(fn) {
  const dir = tempdirs.make(path.join(os.tmpdir(), 'usage-limits-relay-cloud-'));
  const keys = ['CLAUDE_CONFIG_DIR', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_SESSION_ID', 'USAGE_LIMITS_CLOUD'];
  const before = {};
  for (const key of keys) before[key] = process.env[key];
  process.env.CLAUDE_CONFIG_DIR = dir;
  delete process.env.CLAUDE_CODE_SESSION_ID;
  delete process.env.CLAUDE_SESSION_ID;
  delete process.env.USAGE_LIMITS_CLOUD;
  try {
    return fn(dir);
  } finally {
    for (const key of keys) {
      if (before[key] === undefined) delete process.env[key];
      else process.env[key] = before[key];
    }
  }
}

function relay() {
  return require(RELAY);
}

// A clean, pushed repository as git would describe it.
function cleanGit(args) {
  const key = args.join(' ');
  if (key === 'rev-parse --is-inside-work-tree') return { status: 0, stdout: 'true' };
  if (key === 'status --porcelain') return { status: 0, stdout: '' };
  if (key === 'rev-parse --abbrev-ref HEAD') return { status: 0, stdout: 'feature' };
  if (key === 'rev-parse --abbrev-ref --symbolic-full-name @{u}') return { status: 0, stdout: 'origin/feature' };
  if (key === 'rev-list --count @{u}..HEAD') return { status: 0, stdout: '0' };
  if (key === 'remote') return { status: 0, stdout: 'origin' };
  return { status: 1, stdout: '' };
}

function gitWith(overrides) {
  return (args, cwd) => {
    const key = args.join(' ');
    return Object.prototype.hasOwnProperty.call(overrides, key) ? overrides[key] : cleanGit(args, cwd);
  };
}

const ACCOUNT = {
  cachedGrowthBookFeatures: {
    tengu_swift_lynx: { version: 2, webPath: '/code/claim-credit', limitWall: { noticeLine: 'While you wait, start a new cloud session with a $90 credit' } },
  },
};

test('the hand-off is the wake\'s prompt, opened for a cloud session, with the continuation inline', () =>
  isolated(() => {
    const r = relay();
    r.saveContinuation('sess-1', 'Done: the reader. Next: tests for the report, then the docs. Mid-change: usage.js render().');
    const handoff = r.cloudHandoff({ sessionId: 'sess-1', git: cleanGit, platform: 'linux', cwd: '/work' });
    assert.strictEqual(handoff.ok, true);
    assert.strictEqual(handoff.source, 'the saved continuation');
    assert.match(handoff.prompt, /handing its work to a cloud session rather than waiting for the reset/);
    assert.match(handoff.prompt, /You have none of that conversation/);
    assert.match(handoff.prompt, /fresh clone from GitHub, so only what was pushed is here/);
    assert.match(handoff.prompt, /Next: tests for the report, then the docs/);
    // Everything else the wake says is still said.
    assert.match(handoff.prompt, /Verify anything that was mid-change/);
    assert.ok(handoff.prompt.includes(r.BUGCHECK_LINE));
    // And the wake's own opening is not, because the window has not reset.
    assert.doesNotMatch(handoff.prompt, /The usage window has reset/);
    assert.deepStrictEqual(handoff.warnings, []);
    // The wake's own prompt is unchanged by any of this.
    assert.match(r.compose({ continuation: 'x' }), /^The usage window has reset and this is the plugin picking the work back up/);
  }));

test('text on the command line stands in for the stored continuation, and an armed record\'s todos ride along', () =>
  isolated(() => {
    const r = relay();
    const state = r.read();
    r.putRecord(state, {
      id: 'sess-2',
      cwd: '/proj',
      wakeAt: Date.now() + 3600000,
      work: { hasWork: true, pending: 2, source: 'todos', todos: [
        { content: 'Write the relay test', status: 'in_progress' },
        { content: 'Bump the version', status: 'pending' },
        { content: 'Read the code', status: 'completed' },
      ], plan: null },
    });
    r.write(state);
    const handoff = r.cloudHandoff({ text: 'Push the branch, then open the PR.', env: {}, git: cleanGit, platform: 'linux' });
    assert.strictEqual(handoff.id, 'sess-2', 'the one armed relay, when nothing names a session');
    assert.strictEqual(handoff.cwd, '/proj', 'run from where that session was working');
    assert.strictEqual(handoff.source, 'the text given');
    assert.match(handoff.prompt, /Push the branch, then open the PR\./);
    assert.match(handoff.prompt, /- Write the relay test \(was mid-change\)\n- Bump the version/);
    assert.doesNotMatch(handoff.prompt, /Read the code/);
  }));

test('with nothing to hand over it refuses, because a cloud session has none of this conversation', () =>
  isolated(() => {
    const r = relay();
    const text = r.cloud(['--session', 'sess-empty'], { git: cleanGit, platform: 'linux' });
    assert.match(text, /^Nothing to hand over for session sess-emp/);
    assert.match(text, /relay cloud "<text>"/);
    assert.doesNotMatch(text, /claude --cloud '/);
  }));

test('what the clone will not have is named: uncommitted changes, unpushed commits, a branch with no upstream', () => {
  const r = relay();
  const state = (overrides) => r.gitState('/x', gitWith(overrides));
  const warn = (overrides) => r.cloudWarnings(state(overrides), 'short', 'linux').join('\n');
  assert.strictEqual(warn({}), '');
  assert.match(warn({ 'status --porcelain': { status: 0, stdout: ' M a.js\n?? b.js' } }), /2 uncommitted changes in the working tree\. The cloud session clones from GitHub and will not see them/);
  assert.match(warn({ 'rev-list --count @{u}..HEAD': { status: 0, stdout: '1' } }), /1 commit on feature not pushed to origin\/feature: push first/);
  assert.match(warn({ 'rev-parse --abbrev-ref --symbolic-full-name @{u}': { status: 128, stdout: '' } }), /Branch feature has no upstream.*git push -u origin feature/);
  assert.match(warn({ remote: { status: 0, stdout: '' }, 'rev-parse --abbrev-ref --symbolic-full-name @{u}': { status: 128, stdout: '' } }), /no remote/);
  assert.match(warn({ 'rev-parse --is-inside-work-tree': { status: 128, stdout: '' } }), /not a git repository/);
  // Too long for one argument is said before anyone pastes it.
  assert.match(r.cloudWarnings(state({}), 'x'.repeat(r.CLOUD_ARG_MAX.win32 + 1), 'win32').join('\n'), /more than one command-line argument holds/);
});

test('gitState reads a real repository: one dirty file, one unpushed commit', { skip: spawnSync('git', ['--version']).status !== 0 && 'git is not installed' }, () => {
  const root = tempdirs.make(path.join(os.tmpdir(), 'usage-limits-relay-cloud-git-'));
  const remote = path.join(root, 'remote.git');
  const work = path.join(root, 'work');
  const git = (cwd, ...args) => {
    const run = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });
    assert.strictEqual(run.status, 0, args.join(' ') + ': ' + run.stderr);
    return run.stdout.trim();
  };
  fs.mkdirSync(work);
  git(root, 'init', '-q', '--bare', remote);
  git(work, 'init', '-q');
  git(work, 'remote', 'add', 'origin', remote);
  fs.writeFileSync(path.join(work, 'a.txt'), 'one\n');
  git(work, 'add', 'a.txt');
  git(work, 'commit', '-q', '-m', 'one');
  const branch = git(work, 'rev-parse', '--abbrev-ref', 'HEAD');
  git(work, 'push', '-q', '-u', 'origin', branch);
  const r = relay();
  assert.deepStrictEqual(r.gitState(work), { repo: true, dirty: 0, branch, upstream: 'origin/' + branch, unpushed: 0, remote: true });
  fs.writeFileSync(path.join(work, 'a.txt'), 'two\n');
  git(work, 'commit', '-q', '-am', 'two');
  fs.writeFileSync(path.join(work, 'b.txt'), 'dirty\n');
  const after = r.gitState(work);
  assert.strictEqual(after.dirty, 1);
  assert.strictEqual(after.unpushed, 1);
  assert.strictEqual(r.gitState(root).repo, false, 'the folder above is not a working tree');
});

test('the printed command survives the shell: sh gets the hand-off back byte for byte', { skip: process.platform === 'win32' && 'sh quoting, checked where sh is' }, () => {
  const r = relay();
  const prompt = "It's done.\nNext: \"quotes\", $HOME, `ticks` and a \\ backslash.\n\n- a todo";
  const command = r.cloudCommand(prompt, 'linux');
  assert.ok(command.startsWith("claude --cloud '"));
  // Swap the program for printf and let sh do the unquoting a person's shell would.
  const run = spawnSync('sh', ['-c', command.replace(/^claude --cloud /, "printf '%s' ")], { encoding: 'utf8' });
  assert.strictEqual(run.status, 0, run.stderr);
  assert.strictEqual(run.stdout, prompt);
});

test('on Windows the command is PowerShell, single-quoted with quotes doubled', () => {
  const r = relay();
  assert.strictEqual(r.cloudCommand("it's\nnext", 'win32'), "claude --cloud 'it''s\nnext'");
  const warnings = r.cloudWarnings(r.gitState('/x', cleanGit), 'say "hi"', 'win32').join('\n');
  assert.match(warnings, /PowerShell before 7\.3/);
  // PowerShell ends a single-quoted string at a curly single quote as well, so
  // each is doubled like a straight one.
  const curly = 'it\u2019s \u2018done\u2019, \u201Aand\u201B';
  assert.strictEqual(r.cloudCommand(curly, 'win32'), "claude --cloud 'it\u2019\u2019s \u2018\u2018done\u2019\u2019, \u201A\u201Aand\u201B\u201B'");
});

test('the hand-off names the branch the work was pushed to, since the clone may start on another', () =>
  isolated(() => {
    const r = relay();
    const named = r.cloudHandoff({ sessionId: 'sess-b', text: 'x', git: cleanGit, platform: 'linux', cwd: '/w' });
    assert.match(named.prompt, /The work is on branch feature: check it out first if the clone is on another\./);
    const detached = r.cloudHandoff({ sessionId: 'sess-b', text: 'x', git: gitWith({ 'rev-parse --abbrev-ref HEAD': { status: 0, stdout: 'HEAD' } }), platform: 'linux', cwd: '/w' });
    assert.doesNotMatch(detached.prompt, /The work is on branch/);
    assert.doesNotMatch(r.compose({ continuation: 'x', branch: 'feature' }), /The work is on branch/, 'the wake resumes in place and names no branch');
  }));

test('the printed answer: session, source, the credit, the warnings, where to run it, and no launch without --go', () =>
  isolated(() => {
    const r = relay();
    let spawned = 0;
    const text = r.cloud(['--session', 'sess-3', 'Carry on with the docs.'], {
      git: gitWith({ 'status --porcelain': { status: 0, stdout: ' M README.md' } }),
      platform: 'linux',
      cwd: '/repo',
      account: ACCOUNT,
      spawn: () => {
        spawned += 1;
        return { pid: 1, unref() {}, on() {} };
      },
    });
    assert.strictEqual(spawned, 0);
    assert.match(text, /^Cloud hand-off for session sess-3, from the text given: \d+ characters, inline, because a cloud session cannot read a file on this machine\./);
    assert.match(text, /It runs on the \$90 cloud-session credit/);
    assert.match(text, /Warning: 1 uncommitted change in the working tree/);
    assert.match(text, /Run this from \/repo:\n\nclaude --cloud 'ultrathink\n\nA local session reached its usage limit/);
    assert.match(text, /relay cloud --go starts it from here\.$/);
  }));

test('--go under node --test is a dry run: nothing is spawned, and it says why', () =>
  isolated(() => {
    const r = relay();
    assert.ok(process.env.NODE_TEST_CONTEXT, 'node --test sets NODE_TEST_CONTEXT');
    assert.deepStrictEqual(r.cloudLaunchMode(), { dry: true, why: 'running under node --test' });
    const text = r.cloud(['--go', '--session', 'sess-4', 'x'], {
      git: cleanGit,
      platform: 'linux',
      cli: '/bin/claude-fake',
      spawn: () => {
        throw new Error('a test launched a cloud session');
      },
    });
    assert.match(text, /Dry run: nothing was launched \(running under node --test\)\.$/);
    assert.match(fs.readFileSync(r.logFile(), 'utf8'), /cloud: dry run for session sess-4, nothing launched/);
  }));

test('--go, when it is real, starts claude --cloud detached in the project, as nobody\'s child, and logs it', () =>
  isolated(() => {
    const r = relay();
    process.env.CLAUDE_CODE_SESSION_ID = 'sess-5';
    const calls = [];
    let unrefs = 0;
    const text = r.cloud(['--go', 'Finish the tests.'], {
      mode: { dry: false, why: null },
      git: cleanGit,
      platform: 'linux',
      cwd: '/repo',
      cli: '/opt/bin/claude',
      env: { PATH: '/usr/bin', CLAUDE_CODE_SESSION_ID: 'sess-5', CLAUDE_CODE_CHILD_SESSION: '1' },
      spawn: (cli, args, options) => {
        calls.push({ cli, args, options });
        return { pid: 4242, unref() { unrefs += 1; }, on() {} };
      },
    });
    assert.strictEqual(calls.length, 1);
    const call = calls[0];
    assert.strictEqual(call.cli, '/opt/bin/claude');
    assert.strictEqual(call.args[0], '--cloud');
    assert.match(call.args[1], /Finish the tests\./);
    assert.strictEqual(call.args.length, 2, 'the hand-off is one argument, not split');
    assert.strictEqual(call.options.cwd, '/repo');
    assert.strictEqual(call.options.detached, true);
    assert.strictEqual(call.options.env.CLAUDE_CODE_SESSION_ID, undefined);
    assert.strictEqual(call.options.env.CLAUDE_CODE_CHILD_SESSION, undefined);
    assert.strictEqual(call.options.env.PATH, '/usr/bin');
    assert.strictEqual(unrefs, 1);
    assert.match(text, /Started claude --cloud \(pid 4242\)\. What it prints goes to .*cloud-.*\.log\. The session appears on claude\.ai\/code\.$/);
    assert.match(fs.readFileSync(r.logFile(), 'utf8'), /cloud: launched claude --cloud for session sess-5 from \/repo \(pid 4242\)/);
    assert.match(r.latestRunLog().text, /--- claude --cloud from \/repo for session sess-5/);
  }));

test('--go will not push a multi-line hand-off through a Windows batch shim, or launch with no repository', () =>
  isolated(() => {
    const r = relay();
    const never = () => {
      throw new Error('should not have launched');
    };
    const shim = r.cloud(['--go', '--session', 's6', 'x'], { mode: { dry: false }, git: cleanGit, platform: 'win32', cli: 'C:\\npm\\claude.cmd', spawn: never });
    assert.match(shim, /Not launched: claude here is C:\\npm\\claude\.cmd, a batch shim/);
    // PowerShell hands a .cmd to cmd.exe as well, so it is no way round the shim.
    assert.doesNotMatch(shim, /into PowerShell instead/);
    assert.match(shim, /native claude\.exe/);
    const bare = r.cloud(['--go', '--session', 's7', 'x'], {
      mode: { dry: false },
      git: () => ({ status: 128, stdout: '' }),
      platform: 'linux',
      cli: '/bin/claude',
      spawn: never,
    });
    assert.match(bare, /Not launched: there is no repository here/);
  }));

// The switch itself, outside the test runner, the way scheduler-guard checks
// the scheduler's: it computes the mode and launches nothing.
test('outside the test runner the switch reads USAGE_LIMITS_CLOUD, and a redirected home is a dry run', () => {
  const env = Object.assign({}, process.env);
  delete env.NODE_TEST_CONTEXT;
  delete env.USAGE_LIMITS_CLOUD;
  const modeIn = (extra) => {
    const run = spawnSync(process.execPath, ['-e', 'process.stdout.write(JSON.stringify(require(' + JSON.stringify(RELAY) + ').cloudLaunchMode()))'], {
      encoding: 'utf8',
      env: Object.assign({}, env, extra),
      timeout: 30000,
      windowsHide: true,
    });
    assert.strictEqual(run.status, 0, run.stderr);
    return JSON.parse(run.stdout);
  };
  assert.deepStrictEqual(modeIn({ USAGE_LIMITS_CLOUD: 'dry-run' }), { dry: true, why: 'USAGE_LIMITS_CLOUD=dry-run' });
  assert.deepStrictEqual(modeIn({ USAGE_LIMITS_CLOUD: 'real', NODE_TEST_CONTEXT: 'child-v8' }), { dry: false, why: null });
  const home = tempdirs.make(path.join(os.tmpdir(), 'usage-limits-relay-cloud-home-'));
  const sandboxed = modeIn({ HOME: home, USERPROFILE: home });
  assert.strictEqual(sandboxed.dry, true);
  assert.match(sandboxed.why, /home folder is redirected/);
});

test('the plugin\'s own flags stay out of the hand-off text', () =>
  isolated(() => {
    const r = relay();
    const text = r.cloud(['--host', 'claude', '--session', 'sess-8', 'Ship', 'the', 'docs.'], { git: cleanGit, platform: 'linux', cwd: '/repo', account: {} });
    assert.match(text, /This is what the session left for itself:\n\nShip the docs\.\n/);
    assert.doesNotMatch(text, /--host|sess-8\n|claude Ship/);
  }));

// The printed command on Windows meets whatever claude is on PATH, and a batch
// shim runs through cmd.exe even from PowerShell: cmd.exe ends the command at
// the first line break, so the cloud session would get one line of the
// hand-off. Said before anyone pastes it, not only when --go refuses.
test('a Windows command meant for a batch shim warns that cmd.exe cuts the hand-off at its first line break', () =>
  isolated(() => {
    const r = relay();
    const shim = r.cloud(['--session', 'sess-9', 'First line.\nSecond line.'], { git: cleanGit, platform: 'win32', cwd: 'C:\\repo', account: {}, cli: 'C:\\Users\\me\\AppData\\Roaming\\npm\\claude.cmd', nativeCli: null });
    assert.match(shim, /Warning: claude here is C:\\Users\\me\\AppData\\Roaming\\npm\\claude\.cmd, a batch shim\. PowerShell runs it through cmd\.exe, and cmd\.exe cuts the hand-off at its first line break/);
    assert.match(shim, /native claude\.exe \(claude install puts one in ~\/\.local\/bin\)/);
    // A native claude.exe elsewhere on the machine is named, and --go uses it.
    const both = r.cloud(['--session', 'sess-9', 'x'], { git: cleanGit, platform: 'win32', cwd: 'C:\\repo', account: {}, cli: 'C:\\npm\\claude.cmd', nativeCli: 'C:\\Users\\me\\.local\\bin\\claude.exe' });
    assert.match(both, /run it with the native claude\.exe instead \(& 'C:\\Users\\me\\\.local\\bin\\claude\.exe' in place of claude\), or use --go, which does\./);
    assert.match(r.cloud(['--session', 'sess-9', 'x'], { git: cleanGit, platform: 'win32', cwd: 'C:\\repo', account: {}, cli: 'C:\\tools\\CLAUDE.BAT', nativeCli: null }), /Warning: claude here is C:\\tools\\CLAUDE\.BAT, a batch shim/);
    const native = r.cloud(['--session', 'sess-9', 'x'], { git: cleanGit, platform: 'win32', cwd: 'C:\\repo', account: {}, cli: 'C:\\Users\\me\\.local\\bin\\claude.exe' });
    assert.doesNotMatch(native, /batch shim/);
    // Only Windows has the problem; elsewhere the name is not asked about.
    assert.doesNotMatch(r.cloud(['--session', 'sess-9', 'x'], { git: cleanGit, platform: 'linux', cwd: '/repo', account: {}, cli: '/x/claude.cmd' }), /batch shim/);
    assert.deepStrictEqual(r.cloudWarnings(r.gitState('/x', cleanGit), 'short', 'win32', 'C:\\bin\\claude.exe'), []);
  }));

// `where claude` on an npm install lists the extensionless sh script before
// claude.cmd. Neither shell runs a file with no extension, and taking the
// first line meant the shim warning above never fired for the install it is
// about.
test('the claude a Windows shell runs is the first match with an extension, not the sh script npm writes beside the shim', () => {
  const r = relay();
  const calls = [];
  const where = (cmd, args) => {
    calls.push([cmd].concat(args));
    return { status: 0, stdout: 'C:\\Users\\me\\AppData\\Roaming\\npm\\claude\r\nC:\\Users\\me\\AppData\\Roaming\\npm\\claude.cmd\r\nC:\\Users\\me\\.local\\bin\\claude.exe\r\n' };
  };
  assert.strictEqual(r.shellClaude({}, where), 'C:\\Users\\me\\AppData\\Roaming\\npm\\claude.cmd');
  assert.deepStrictEqual(calls, [['where', 'claude']]);
  const native = () => ({ status: 0, stdout: 'C:\\Users\\me\\.local\\bin\\claude.exe\r\nC:\\Users\\me\\AppData\\Roaming\\npm\\claude\r\n' });
  assert.strictEqual(r.shellClaude({}, native), 'C:\\Users\\me\\.local\\bin\\claude.exe');
});
