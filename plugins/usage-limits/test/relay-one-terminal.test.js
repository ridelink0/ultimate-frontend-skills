'use strict';

// One relay, one terminal.
//
// Gev, 2026-09-27: "fix it to where it makes 1 terminal and not 2". Two things
// put a second terminal on the screen, and both were measured that evening:
//
// 1. The wake's own console. The scheduled task ran PowerShell with
//    -WindowStyle Hidden, which Windows Terminal (the Windows 11 default
//    console host) ignores, so a "powershell.exe" Terminal window opened beside
//    the Claude window the wake started. Closing it killed the wake
//    (0xC000013A). Under conhost --headless the same task opened no window.
// 2. The session itself still open. Claude Code carries an open session across
//    the reset on its own (autoContinueAtUsageLimit), and a wake that opened
//    `claude --resume` next to it ran the same conversation twice.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const relay = require('../skills/usage-limits/scripts/relay.js');
const wake = require('../skills/usage-limits/scripts/wake.js');
const tempdirs = require('../tools/test-tempdirs.js');

const ID = '0f3b9c1e-1234-4abc-9def-0123456789ab';
const LAUNCHER = 'C:\\Users\\somebody\\.claude\\relay-task-0f3b9c1e.cmd';

function withConfig(fn) {
  const saved = process.env.CLAUDE_CONFIG_DIR;
  const dir = tempdirs.make(path.join(os.tmpdir(), 'usage-limits-oneterm-'));
  process.env.CLAUDE_CONFIG_DIR = dir;
  const done = () => {
    if (saved === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = saved;
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

function sessionFile(dir, pid, fields) {
  fs.mkdirSync(path.join(dir, 'sessions'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'sessions', pid + '.json'),
    JSON.stringify(Object.assign({ pid, sessionId: ID, cwd: 'C:\\work', procStart: '134350239768728478', kind: 'interactive' }, fields || null))
  );
}

test('the headless task action gives the wake no console window, and stays under 200 characters', () => {
  const action = relay.hiddenAction(LAUNCHER, 'C:\\Users\\somebody', true);
  const tr = relay.taskAction(action);
  assert.strictEqual(action.execute, relay.HEADLESS_HOST);
  assert.match(action.execute, /conhost\.exe$/i);
  assert.ok(action.argument.startsWith('--headless "' + relay.HIDDEN_HOST + '" -NoProfile -NonInteractive -Command "& \''), action.argument);
  assert.ok(!/WindowStyle/.test(action.argument), 'no window to style, and the characters count against schtasks');
  assert.ok(action.argument.endsWith("'" + LAUNCHER + "'\""));
  assert.ok(tr.length < 200, tr.length + ' characters: ' + tr);
  assert.strictEqual(action.cwd, 'C:\\Users\\somebody');
});

test('without conhost --headless the PowerShell route is unchanged', () => {
  const action = relay.hiddenAction(LAUNCHER, 'C:\\work', false);
  assert.strictEqual(action.execute, relay.HIDDEN_HOST);
  assert.ok(action.argument.startsWith('-NoProfile -NonInteractive -WindowStyle Hidden -Command "& \''));
});

test('headless is only chosen on Windows 10 1809 or later with conhost present', () => {
  if (process.platform !== 'win32') {
    assert.strictEqual(relay.headlessAvailable(), false);
    return;
  }
  const build = Number(String(os.release()).split('.')[2]);
  assert.strictEqual(relay.headlessAvailable(), build >= 17763 && fs.existsSync(relay.HEADLESS_HOST));
});

test('an open session is found by its process file, and a recycled or dead pid is not', () =>
  withConfig((dir) => {
    const alive = () => true;
    const same = () => '134350239768728478';
    assert.strictEqual(wake.liveSession(ID, { alive, started: same }), null, 'no sessions folder at all');

    sessionFile(dir, 4242);
    assert.deepStrictEqual(wake.liveSession(ID, { alive, started: same }), { pid: 4242, kind: 'interactive', cwd: 'C:\\work' });
    assert.strictEqual(wake.liveSession(ID, { alive: () => false, started: same }), null, 'the process is gone');
    assert.strictEqual(wake.liveSession(ID, { alive, started: () => '999' }), null, 'the pid now belongs to another process');
    assert.deepStrictEqual(wake.liveSession(ID, { alive, started: () => null }).pid, 4242, 'an unreadable start time leaves the pid as the answer');
    assert.strictEqual(wake.liveSession('another-session', { alive, started: same }), null, 'another conversation');

    fs.writeFileSync(path.join(dir, 'sessions', '77.json'), '{not json');
    fs.writeFileSync(path.join(dir, 'sessions', '4242.5bb8.key'), 'x');
    assert.strictEqual(wake.liveSession(ID, { alive, started: same }).pid, 4242, 'junk beside it is skipped');
  }));

test('the wake process itself never counts as the open session', () =>
  withConfig((dir) => {
    sessionFile(dir, process.pid, { procStart: null });
    assert.strictEqual(wake.liveSession(ID, { alive: () => true, started: () => null }), null);
  }));

test('pidAlive answers for this process and for a pid that cannot exist', () => {
  assert.strictEqual(wake.pidAlive(process.pid), true);
  assert.strictEqual(wake.pidAlive(2147483646), false);
});

test('transcriptActiveSince reads the transcript the session writes', () =>
  withConfig((dir) => {
    assert.strictEqual(wake.transcriptActiveSince(ID, 0), false, 'no transcript');
    const folder = path.join(dir, 'projects', 'C--work');
    fs.mkdirSync(folder, { recursive: true });
    const file = path.join(folder, ID + '.jsonl');
    fs.writeFileSync(file, '{}\n');
    const at = Date.now() - 60 * 60 * 1000;
    fs.utimesSync(file, at / 1000, at / 1000);
    assert.strictEqual(wake.transcriptActiveSince(ID, at - 1000), true);
    assert.strictEqual(wake.transcriptActiveSince(ID, at + 60 * 1000), false);
  }));

// --- run(): the branch itself -------------------------------------------------

const ONLINE = async () => ({ online: true, reason: 'ok', detail: null, results: [] });

function seed(dir) {
  const state = relay.read();
  state.config = Object.assign({}, state.config, { mode: 'resume', enabled: true });
  state.armed = {
    id: ID,
    task: null,
    host: 'claude',
    cwd: dir,
    project: 'proj',
    armedAt: 1,
    wakeAt: Date.now(),
    windowKey: 'five_hour',
    mode: 'resume',
    attempt: 0,
    continuation: false,
    work: { pending: 1, todos: [] },
  };
  relay.write(state);
}

function deps(over) {
  const seen = { delivered: 0, toasts: [], slept: 0 };
  let clock = 1000000;
  const base = {
    reachable: ONLINE,
    windowReopened: async () => ({ known: true, percent: 2 }),
    deliverClaude: () => {
      seen.delivered += 1;
      return { ok: true, how: 'test window' };
    },
    deliverCodex: () => ({ ok: false, error: 'not here' }),
    toast: (title, body) => seen.toasts.push(title + ': ' + body),
    userIsPresent: () => ({ known: true, present: false }),
    capabilities: () => ({ claude: 'claude', codex: null, computerUse: null }),
    arm: () => {
      throw new Error('no wake may be booked from this test');
    },
    now: () => clock,
    sleep: (ms) => {
      seen.slept += ms;
      clock += ms;
    },
  };
  return { deps: Object.assign(base, over || null), seen };
}

test('an open session that is working again gets no second window', () =>
  withConfig(async (dir) => {
    seed(dir);
    const { deps: d, seen } = deps({ liveSession: () => ({ pid: 4242 }), transcriptActiveSince: () => true });
    const result = await wake.run(Date.now(), [], d);
    assert.strictEqual(result.outcome, 'live');
    assert.strictEqual(seen.delivered, 0, 'nothing was launched');
    assert.match(seen.toasts.join('\n'), /no second window/);
    assert.strictEqual(relay.read().armed, null, 'the relay is finished, not left armed');
    assert.strictEqual(relay.read().history.slice(-1)[0].outcome, 'live');
  }));

test('an open session that starts working during the wait also gets no second window', () =>
  withConfig(async (dir) => {
    seed(dir);
    let checks = 0;
    const { deps: d, seen } = deps({ liveSession: () => ({ pid: 4242 }), transcriptActiveSince: () => ++checks >= 3 });
    const result = await wake.run(Date.now(), [], d);
    assert.strictEqual(result.outcome, 'live');
    assert.strictEqual(seen.delivered, 0);
    assert.ok(seen.slept > 0 && seen.slept < wake.LIVE_WAIT_MS, 'it waited, and not the whole budget');
  }));

test('an open session that stays quiet for the whole wait gets the one window', () =>
  withConfig(async (dir) => {
    seed(dir);
    const { deps: d, seen } = deps({ liveSession: () => ({ pid: 4242 }), transcriptActiveSince: () => false });
    const result = await wake.run(Date.now(), [], d);
    assert.strictEqual(result.outcome, 'resumed');
    assert.strictEqual(seen.delivered, 1, 'exactly one launch');
    assert.ok(seen.slept >= wake.LIVE_WAIT_MS, 'it waited the full budget first');
  }));

test('a session closed during the wait gets the one window at once', () =>
  withConfig(async (dir) => {
    seed(dir);
    let looks = 0;
    const { deps: d, seen } = deps({ liveSession: () => (++looks === 1 ? { pid: 4242 } : null), transcriptActiveSince: () => false });
    const result = await wake.run(Date.now(), [], d);
    assert.strictEqual(result.outcome, 'resumed');
    assert.strictEqual(seen.delivered, 1);
    assert.strictEqual(seen.slept, wake.LIVE_POLL_MS, 'one poll, then it went ahead');
  }));

test('no open session: the one window, with no waiting', () =>
  withConfig(async (dir) => {
    seed(dir);
    const { deps: d, seen } = deps({ liveSession: () => null, transcriptActiveSince: () => true });
    const result = await wake.run(Date.now(), [], d);
    assert.strictEqual(result.outcome, 'resumed');
    assert.strictEqual(seen.delivered, 1);
    assert.strictEqual(seen.slept, 0);
  }));

test('a Codex relay is never held back by a Claude session file', () =>
  withConfig(async (dir) => {
    seed(dir);
    const held = relay.read();
    held.armed.host = 'codex';
    relay.write(held);
    let asked = 0;
    const { deps: d } = deps({
      liveSession: () => {
        asked += 1;
        return { pid: 4242 };
      },
      transcriptActiveSince: () => true,
      capabilities: () => ({ claude: null, codex: 'codex', computerUse: null }),
      deliverCodex: () => ({ ok: true, how: 'codex test' }),
    });
    const result = await wake.run(Date.now(), [], d);
    assert.strictEqual(asked, 0);
    assert.strictEqual(result.outcome, 'resumed');
  }));
