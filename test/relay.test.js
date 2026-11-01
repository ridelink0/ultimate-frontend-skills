'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const relay = require('../skills/usage-limits/scripts/relay.js');
const wake = require('../skills/usage-limits/scripts/wake.js');

const MINUTE = 60 * 1000;
const NOW = Date.parse('2026-09-08T12:00:00.000Z');

function withConfigDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-limits-relay-'));
  const before = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = dir;
  const env = {};
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('USAGE_LIMITS_RELAY')) {
      env[key] = process.env[key];
      delete process.env[key];
    }
  }
  try {
    return fn(dir);
  } finally {
    if (before === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = before;
    Object.assign(process.env, env);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const BINDING = { key: 'five_hour', label: '5-hour', percentUsed: 82, resetsAt: NOW + 40 * MINUTE, stale: false };
const WORK = {
  hasWork: true,
  pending: 2,
  source: 'todos',
  todos: [
    { content: 'fix the canvas probe', status: 'completed' },
    { content: 'wire the relay into the brief', status: 'in_progress' },
    { content: 'release to github', status: 'pending' },
  ],
};

// Arming without touching the operating system. Every test below that is not
// specifically about the scheduler passes schedule:false, because a unit test
// that registers a scheduled task on the machine running it is not a unit test.
function armed(overrides) {
  return relay.arm(
    Object.assign(
      { now: NOW, sessionId: 'sess-1234', cwd: '/work/project', project: 'project', hostName: 'claude',
        resetsAt: BINDING.resetsAt, binding: BINDING, work: WORK, schedule: false },
      overrides
    )
  );
}

test('it is off until somebody turns it on', () =>
  withConfigDir(() => {
    assert.strictEqual(relay.settings().enabled, false);
    assert.strictEqual(relay.settings().mode, 'notify');
    assert.match(relay.status(NOW), /Relay is OFF/);
    assert.strictEqual(relay.configure({ enabled: true }).enabled, true);
    assert.match(relay.status(NOW), /Relay is ON/);
  }));

test('the environment overrides the file, and both are clamped', () =>
  withConfigDir(() => {
    relay.configure({ at: 70, graceMinutes: 9 });
    assert.strictEqual(relay.settings().at, 70);
    process.env.USAGE_LIMITS_RELAY_AT = '95';
    assert.strictEqual(relay.settings().at, 95);
    process.env.USAGE_LIMITS_RELAY_AT = '900';
    assert.strictEqual(relay.settings().at, 99);
    process.env.USAGE_LIMITS_RELAY_AT = '-4';
    assert.strictEqual(relay.settings().at, 10);
    delete process.env.USAGE_LIMITS_RELAY_AT;
    process.env.USAGE_LIMITS_RELAY = 'on';
    assert.strictEqual(relay.settings().enabled, true);
    delete process.env.USAGE_LIMITS_RELAY;
  }));

test('the wake is the reset plus grace, and never in the past', () => {
  assert.strictEqual(relay.wakeAt(NOW + 30 * MINUTE, 5, NOW), NOW + 35 * MINUTE);
  // A reset that has already passed still gets a wake far enough ahead that
  // registering it can succeed.
  assert.strictEqual(relay.wakeAt(NOW - 60 * MINUTE, 5, NOW), NOW + MINUTE);
  assert.strictEqual(relay.wakeAt(null, 5, NOW), null);
  assert.strictEqual(relay.wakeAt('nonsense', 5, NOW), null);
});

test('nothing arms without a plan or an unfinished todo list', () =>
  withConfigDir(() => {
    const config = relay.configure({ enabled: true });
    assert.match(relay.armable({ config, binding: BINDING, sessionId: 'a', work: { hasWork: false } }).why, /no plan or unfinished/);
    assert.match(relay.armable({ config, binding: BINDING, sessionId: null, work: WORK }).why, /no session id/);
    assert.match(relay.armable({ config, binding: Object.assign({}, BINDING, { percentUsed: 40 }), sessionId: 'a', work: WORK }).why, /below 75/);
    assert.match(relay.armable({ config, binding: Object.assign({}, BINDING, { stale: true }), sessionId: 'a', work: WORK }).why, /stale/);
    assert.match(relay.armable({ config, binding: Object.assign({}, BINDING, { resetsAt: null }), sessionId: 'a', work: WORK }).why, /no known reset/);
    assert.match(relay.armable({ config: relay.configure({ enabled: false }), binding: BINDING, sessionId: 'a', work: WORK }).why, /is off/);
    // Everything else satisfied, at a boundary: this is the arming case.
    assert.strictEqual(relay.armable({ config, binding: BINDING, sessionId: 'a', work: WORK, atCompletion: true }).ok, true);
  }));

test('with armOn completion it waits for the end of the reply, and stops waiting at the backstop', () =>
  withConfigDir(() => {
    const config = relay.configure({ enabled: true, armOn: 'completion', at: 75, backstopAt: 95 });
    // Mid-reply, past the mark but below the backstop: hold.
    const midReply = relay.armable({ config, binding: BINDING, sessionId: 'a', work: WORK });
    assert.strictEqual(midReply.ok, false);
    assert.strictEqual(midReply.pending, true, 'holding is not the same as refusing');
    assert.match(midReply.why, /waiting for this reply to finish/);
    // The same call at a boundary arms.
    assert.strictEqual(relay.armable({ config, binding: BINDING, sessionId: 'a', work: WORK, atCompletion: true }).ok, true);
    // Past the backstop it stops waiting, because a completion that never
    // comes - the limit cut the reply off - is a relay that never armed.
    const past = relay.armable({ config, binding: Object.assign({}, BINDING, { percentUsed: 97 }), sessionId: 'a', work: WORK });
    assert.strictEqual(past.ok, true, 'the backstop overrides the wait');
    // And with armOn threshold the old behaviour is exactly as it was.
    const old = relay.configure({ enabled: true, armOn: 'threshold' });
    assert.strictEqual(relay.armable({ config: old, binding: BINDING, sessionId: 'a', work: WORK }).ok, true);
  }));

test('the record carries the outstanding work, not just how much of it there was', () =>
  withConfigDir(() => {
    relay.configure({ enabled: true });
    const result = armed();
    assert.strictEqual(result.ok, true);
    const record = relay.read().armed;
    assert.strictEqual(record.work.todos.length, 2, 'completed items are not outstanding');
    assert.deepStrictEqual(record.work.todos.map((todo) => todo.content), ['wire the relay into the brief', 'release to github']);
    assert.strictEqual(record.wakeAt, BINDING.resetsAt + 5 * MINUTE);
    assert.strictEqual(record.percentAtArming, 82);
  }));

test('a very long todo list cannot make the record unbounded', () =>
  withConfigDir(() => {
    relay.configure({ enabled: true });
    const many = { hasWork: true, pending: 60, source: 'todos', todos: [] };
    for (let i = 0; i < 60; i++) many.todos.push({ content: 'task ' + i, status: 'pending' });
    armed({ work: many });
    assert.strictEqual(relay.read().armed.work.todos.length, 20);
  }));

test('the continuation is stored, marked on the record and deleted with the relay', () =>
  withConfigDir(() => {
    // The runner inherits the real session id; this test speaks for sess-1234.
    const savedId = process.env.CLAUDE_CODE_SESSION_ID;
    process.env.CLAUDE_CODE_SESSION_ID = 'sess-1234';
    try {
    relay.configure({ enabled: true });
    armed();
    assert.strictEqual(relay.read().armed.continuation, false);
    const file = relay.saveContinuation('sess-1234', 'Finish the audit, then push.');
    assert.ok(file && fs.existsSync(file));
    assert.strictEqual(relay.read().armed.continuation, true);
    assert.strictEqual(relay.readContinuation('sess-1234'), 'Finish the audit, then push.');
    relay.disarm('cancelled', NOW);
    assert.strictEqual(fs.existsSync(file), false, 'the continuation must not outlive the relay');
    assert.strictEqual(relay.read().armed, null);
    assert.strictEqual(relay.read().history.length, 1);
    assert.strictEqual(relay.read().history[0].outcome, 'cancelled');
    } finally {
      if (savedId === undefined) delete process.env.CLAUDE_CODE_SESSION_ID;
      else process.env.CLAUDE_CODE_SESSION_ID = savedId;
    }
  }));

test('an empty continuation is refused rather than stored as nothing', () =>
  withConfigDir(() => {
    relay.configure({ enabled: true });
    armed();
    assert.strictEqual(relay.saveContinuation('sess-1234', '   \n  '), null);
    assert.strictEqual(relay.read().armed.continuation, false);
  }));

test('the composed prompt is an instruction, with the work in it', () => {
  const text = relay.compose({
    continuation: 'Half way through the second bug pass.',
    work: WORK,
    thinking: true,
    voice: 'Writes like this: starts lowercase.',
  });
  assert.ok(text.startsWith('ultrathink'), text.slice(0, 40));
  assert.match(text, /has reset and this is the plugin picking the work back up/);
  assert.match(text, /Half way through the second bug pass\./);
  assert.match(text, /wire the relay into the brief \(was mid-change\)/);
  assert.match(text, /release to github/);
  assert.doesNotMatch(text, /fix the canvas probe/, 'a finished item is not outstanding work');
  assert.match(text, /Verify anything that was mid-change/);
  assert.match(text, /starts lowercase/);
});

test('without the thinking setting the word is not there', () => {
  assert.ok(!relay.compose({ work: WORK }).startsWith('ultrathink'));
});

test('an approved plan is carried when no continuation was written', () => {
  const text = relay.compose({ work: { todos: [], plan: 'Step one. Step two.' } });
  assert.match(text, /The plan that was approved:/);
  assert.match(text, /Step one\. Step two\./);
});

test('work is read out of the transcript: todos, plans and neither', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-limits-transcript-'));
  try {
    const file = path.join(dir, 'session.jsonl');
    const todoEvent = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'TodoWrite', input: { todos: [
        { content: 'one', status: 'completed' },
        { content: 'two', status: 'in_progress' },
      ] } }] },
    });
    const planEvent = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'ExitPlanMode', input: { plan: 'Do the thing.' } }] },
    });
    fs.writeFileSync(file, [planEvent, todoEvent, ''].join('\n'));
    const found = relay.detectWork(file, {});
    assert.strictEqual(found.hasWork, true);
    assert.strictEqual(found.pending, 1);
    assert.strictEqual(found.plan, 'Do the thing.');
    assert.strictEqual(found.source, 'todos');

    // Everything finished is not work to carry.
    fs.writeFileSync(file, JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'TodoWrite', input: { todos: [{ content: 'one', status: 'completed' }] } }] },
    }) + '\n');
    assert.strictEqual(relay.detectWork(file, {}).hasWork, false);

    // A chat with no plan in it at all.
    fs.writeFileSync(file, JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'hello' }] } }) + '\n');
    assert.strictEqual(relay.detectWork(file, {}).hasWork, false);
    assert.strictEqual(relay.detectWork(null, {}).hasWork, false);
    assert.strictEqual(relay.detectWork(path.join(dir, 'missing.jsonl'), {}).hasWork, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the newest todo list wins over an older one', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-limits-transcript2-'));
  try {
    const file = path.join(dir, 'session.jsonl');
    const list = (todos) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'TodoWrite', input: { todos } }] } });
    fs.writeFileSync(file, [
      list([{ content: 'old', status: 'pending' }, { content: 'older', status: 'pending' }]),
      list([{ content: 'new', status: 'pending' }]),
      '',
    ].join('\n'));
    const found = relay.detectWork(file, {});
    assert.deepStrictEqual(found.todos.map((todo) => todo.content), ['new']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a malformed transcript line is skipped rather than fatal', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-limits-transcript3-'));
  try {
    const file = path.join(dir, 'session.jsonl');
    fs.writeFileSync(file, '{"TodoWrite" broken json\n' + JSON.stringify({
      message: { content: [{ type: 'tool_use', name: 'TodoWrite', input: { todos: [{ content: 'x', status: 'pending' }] } }] },
    }) + '\n');
    assert.strictEqual(relay.detectWork(file, {}).pending, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('arming a second session keeps the first beside it', () =>
  withConfigDir(() => {
    relay.configure({ enabled: true });
    armed();
    armed({ sessionId: 'sess-9999' });
    const ids = relay.records(relay.read()).map((r) => r.id);
    assert.strictEqual(ids.length, 2, 'two sessions, two records, two wakes');
    assert.ok(ids.includes('sess-9999'));
    assert.notStrictEqual(relay.read().armed.id, 'sess-9999', 'the first stays primary');
  }));

test('task names and PowerShell strings cannot carry anything through', () => {
  // One name per WAKE: the sanitised id, then a base36 stamp of the wake time.
  assert.strictEqual(relay.taskName('a b/c;d', 1789000000000), 'UsageLimitsRelay-abcd-mtuseqkg');
  assert.strictEqual(relay.taskName("x'; Remove-Item C:\\ -Recurse #", 1789000000000), 'UsageLimitsRelay-xRemove-ItemC-Recurse-mtuseqkg');
  // The stamp is the only part that varies, and it cannot carry anything
  // either: it is base36 digits of a number.
  assert.match(relay.taskName('anything', Date.now()), /^UsageLimitsRelay-anything-[0-9a-z]+$/);
  assert.strictEqual(relay.psQuote("it's"), "'it''s'");
  assert.strictEqual(relay.psQuote("'; whoami; '"), "'''; whoami; '''");
});

test('the resumed run preserves native permissions and denies unattended approval requests', () => {
  const record = { id: 'sess-1234', cwd: '/work' };
  const args = wake.claudeArgs(record, 'go on', { permissionMode: 'acceptEdits', model: 'sonnet' }, false);
  // --permission-prompts none: nobody is awake to answer one, so an
  // unanswerable prompt must deny rather than stall the run to its timeout.
  // The prompt is deliberately ABSENT from argv - it travels on stdin.
  assert.deepStrictEqual(args, ['--resume', 'sess-1234', '-p', '--permission-prompts', 'none', '--model', 'sonnet']);
  const fallback = wake.claudeArgs(record, 'go on', { permissionMode: 'acceptEdits' }, true);
  assert.deepStrictEqual(fallback, ['--continue', '-p', '--permission-prompts', 'none']);
  // Even with no config at all, the prompts flag goes on: the reason for it is
  // that nobody is there, which is true regardless of what was configured.
  assert.deepStrictEqual(wake.claudeArgs(record, 'go on', {}, false), ['--resume', 'sess-1234', '-p', '--permission-prompts', 'none']);
});

test('presence is unknown, not absent, when Computer Use is not installed', () => {
  assert.deepStrictEqual(wake.userIsPresent(null), { known: false, present: false });
});

test('the wake carries the config directory, so it reads the right account', () =>
  withConfigDir((dir) => {
    relay.configure({ enabled: true });
    // The scheduler is asked for a command line here; nothing is registered.
    const commands = [];
    const real = relay.schedule;
    try {
      armed();
    } finally {
      void real;
    }
    void commands;
    void dir;
    assert.strictEqual(wake.argOf(['--id', 'x', '--config-dir', 'D:/cfg'], '--config-dir'), 'D:/cfg');
    assert.strictEqual(wake.argOf(['--id', 'x'], '--config-dir'), null);
  }));

test('the command line drives every setting and reports honestly', () =>
  withConfigDir(() => {
    assert.match(relay.main(['on']), /Relay ON/);
    assert.match(relay.main(['at', '70']), /70 per cent/);
    assert.match(relay.main(['grace', '7']), /7 minutes/);
    assert.match(relay.main(['mode', 'resume']), /Native user permissions/);
    assert.match(relay.main(['mode', 'sideways']), /notify or resume/);
    assert.match(relay.main(['permission', 'acceptEdits']), /does not set permission modes/);
    assert.match(relay.main(['thinking', 'resume']), /ultrathink/);
    assert.match(relay.main(['thinking', 'sideways']), /off, resume or always/);
    assert.match(relay.main(['note', 'anything']), /Nothing is armed/);
    assert.match(relay.main(['cancel']), /Nothing was armed/);
    assert.match(relay.main(['log']), /No relay log yet/);
    assert.match(relay.main(['off']), /Relay OFF/);
    assert.match(relay.main(['nonsense']), /usage: relay/);
  }));

test('always-thinking edits settings.json and backs it up first', () =>
  withConfigDir((dir) => {
    const file = path.join(dir, 'settings.json');
    fs.writeFileSync(file, JSON.stringify({ model: 'opus' }, null, 2));
    const applied = relay.applyAlwaysThinking(true);
    assert.strictEqual(applied.ok, true);
    const after = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.strictEqual(after.alwaysThinkingEnabled, true);
    assert.strictEqual(after.model, 'opus', 'nothing else in the file may change');
    assert.strictEqual(JSON.parse(fs.readFileSync(file + '.bak-usage-limits', 'utf8')).model, 'opus');
    relay.applyAlwaysThinking(false);
    assert.strictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).alwaysThinkingEnabled, undefined);
  }));

test('a settings file that is not readable JSON is left alone', () =>
  withConfigDir((dir) => {
    const file = path.join(dir, 'settings.json');
    fs.writeFileSync(file, '{ this is not json');
    const applied = relay.applyAlwaysThinking(true);
    assert.strictEqual(applied.ok, false);
    assert.strictEqual(fs.readFileSync(file, 'utf8'), '{ this is not json');
  }));

test('status names what is actually available on this machine', () =>
  withConfigDir(() => {
    relay.configure({ enabled: true });
    armed();
    const text = relay.status(NOW);
    assert.match(text, /Armed: session sess-123/);
    assert.match(text, /Continuation written: not yet/);
    assert.match(text, /Available here:/);
  }));

test('a corrupt relay file reads as empty rather than throwing', () =>
  withConfigDir((dir) => {
    fs.writeFileSync(path.join(dir, 'usage-limits-relay.json'), 'not json at all');
    assert.deepStrictEqual(relay.read(), { version: 1, config: {}, armed: null, history: [] });
    fs.writeFileSync(path.join(dir, 'usage-limits-relay.json'), '[1,2,3]');
    assert.strictEqual(relay.read().armed, null);
  }));

test('history is bounded', () =>
  withConfigDir(() => {
    relay.configure({ enabled: true });
    for (let i = 0; i < 15; i++) {
      armed({ sessionId: 'sess-' + i });
      relay.disarm('cancelled', NOW + i);
    }
    assert.ok(relay.read().history.length <= 10);
  }));

test('formatWait reads like a person wrote it', () => {
  assert.strictEqual(relay.formatWait(5 * MINUTE), '5 min');
  assert.strictEqual(relay.formatWait(95 * MINUTE), '1h 35m');
  assert.strictEqual(relay.formatWait(-1), 'now');
  assert.strictEqual(relay.formatWait(null), 'now');
});

// The guard that stops the relay spending the first minute of a fresh window on
// a refusal. It read a flattened "five_hour_utilization" that the endpoint has
// never returned, so it answered "cannot tell" every time and did nothing.
test('the armed window key travels with the record, because the meter is indexed by it', () =>
  withConfigDir(() => {
    relay.configure({ enabled: true });
    armed();
    const record = relay.read().armed;
    assert.strictEqual(record.windowKey, 'five_hour');
    assert.strictEqual(record.window, '5-hour');
  }));

test('a relay that never registered a task has no task to unregister', () =>
  withConfigDir(() => {
    relay.configure({ enabled: true });
    armed();
    assert.strictEqual(relay.read().armed.task, null, 'schedule:false must not claim a task name');
  }));

test('the continuation never rides on argv, however long it is', () => {
  // 2026-09-14: a relay booked for 09:55 fired three times and died three times
  // with "The command line is too long." The 7.5 KB note was the -p argument.
  // Windows caps a command line at 8,191 characters; stdin caps at 10 MB.
  const huge = 'x'.repeat(50000);
  const record = { id: 'sess-1234', cwd: process.cwd() };
  const args = wake.claudeArgs(record, huge, { permissionMode: 'bypassPermissions', model: 'opus' }, false);
  assert.ok(!args.some((a) => a.length > 200), 'no argument may carry the prompt');
  assert.ok(!args.includes(huge), 'the prompt must not be an argument');
  assert.ok(args.join(' ').length < 500, 'argv stays far under the Windows limit');
});

test('another session cannot overwrite an armed continuation by accident', () =>
  withConfigDir(() => {
    // 2026-09-14: a session wrote its plan to whatever record was armed, which
    // was a peer's, minutes before it was due. One machine has one relay, so
    // displacement is normal - but overwriting a different session's plan is
    // only ever allowed on purpose.
    relay.configure({ enabled: true });
    armed(); // arms sess-1234
    const savedId = process.env.CLAUDE_CODE_SESSION_ID;
    process.env.CLAUDE_CODE_SESSION_ID = 'some-other-session';
    try {
      assert.strictEqual(relay.saveContinuation('sess-1234', 'not mine to write'), null, 'refused by default');
      assert.ok(!relay.readContinuation('sess-1234'), 'and nothing was written');
      assert.ok(relay.saveContinuation('sess-1234', 'on purpose', { force: true }), 'force writes it');
      assert.strictEqual(relay.readContinuation('sess-1234'), 'on purpose');
      // Writing under your OWN id is never guarded, armed or not.
      assert.ok(relay.saveContinuation('some-other-session', 'my own plan'));
    } finally {
      if (savedId === undefined) delete process.env.CLAUDE_CODE_SESSION_ID;
      else process.env.CLAUDE_CODE_SESSION_ID = savedId;
    }
  }));

test('the continuation cap is far above the old argv limit', () =>
  withConfigDir(() => {
    // 8,000 was the argv era. The note is on stdin now, and a plan that ran
    // long was losing its tail silently.
    const long = 'x'.repeat(20000);
    relay.saveContinuation('sess-long', long);
    assert.strictEqual(relay.readContinuation('sess-long').length, 20000);
  }));
