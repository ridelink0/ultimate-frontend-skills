'use strict';
// The three relay bugs seen 2026-11-09 with 1.44.1:
// 1. a hand-run relay.js from a Claude Code shell was detected as Codex;
// 2. arm --session ID recorded the shell's folder, not that session's;
// 3. cancel --session ID took down more relays than the one named.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RELAY = '../skills/usage-limits/scripts/relay.js';
const NOW = Date.UTC(2026, 10, 9, 20, 0, 0);

function isolated(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-limits-relay-r8-'));
  const before = { dir: process.env.CLAUDE_CONFIG_DIR, sid: process.env.CLAUDE_CODE_SESSION_ID, old: process.env.CLAUDE_SESSION_ID };
  process.env.CLAUDE_CONFIG_DIR = dir;
  delete process.env.CLAUDE_CODE_SESSION_ID;
  delete process.env.CLAUDE_SESSION_ID;
  fs.writeFileSync(path.join(dir, '.claude.json'), JSON.stringify({ projects: {} }));
  try {
    delete require.cache[require.resolve(RELAY)];
    return fn(require(RELAY), dir);
  } finally {
    if (before.dir === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = before.dir;
    if (before.sid === undefined) delete process.env.CLAUDE_CODE_SESSION_ID; else process.env.CLAUDE_CODE_SESSION_ID = before.sid;
    if (before.old === undefined) delete process.env.CLAUDE_SESSION_ID; else process.env.CLAUDE_SESSION_ID = before.old;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function armIt(relay, id, cwd) {
  const result = relay.arm({
    now: NOW, sessionId: id, cwd, project: 'p-' + id, schedule: false,
    resetsAt: NOW + 60 * 60 * 1000,
    binding: { percentUsed: 85, resetsAt: NOW + 60 * 60 * 1000, key: 'five_hour', label: '5-hour' },
    work: { hasWork: true, pending: 1, source: 'test', todos: [] },
    config: { enabled: true, mode: 'notify', graceMinutes: 2, armOn: 'threshold', at: 80, attempts: 2, backstopAt: 95 },
  });
  assert.ok(result.ok, 'armed ' + id);
}

const ids = (relay) => relay.records(relay.read()).map((r) => r.id);

test('cancel --session cancels exactly the named relay', () =>
  isolated((relay, dir) => {
    armIt(relay, 'aaaa-1', dir);
    armIt(relay, 'bbbb-2', dir);
    armIt(relay, 'cccc-3', dir);
    assert.match(relay.main(['cancel', '--session', 'bbbb-2']), /^Relay cancelled/);
    assert.deepStrictEqual(ids(relay), ['aaaa-1', 'cccc-3']);
  }));

test('cancel --session with an id that is not armed cancels nothing', () =>
  isolated((relay, dir) => {
    armIt(relay, 'aaaa-1', dir);
    armIt(relay, 'bbbb-2', dir);
    assert.match(relay.main(['cancel', '--session', 'zzzz-9']), /No relay is armed for zzzz-9.*Nothing was cancelled/);
    assert.match(relay.main(['cancel', '--session']), /No session id after --session/);
    assert.deepStrictEqual(ids(relay), ['aaaa-1', 'bbbb-2']);
  }));

test('cancel with several armed and none this session\'s needs --session or --all', () =>
  isolated((relay, dir) => {
    armIt(relay, 'aaaa-1', dir);
    armIt(relay, 'bbbb-2', dir);
    assert.match(relay.main(['cancel']), /2 relays are armed.*Nothing was cancelled/);
    process.env.CLAUDE_CODE_SESSION_ID = 'some-other-session';
    assert.match(relay.main(['cancel']), /Nothing was cancelled/);
    assert.deepStrictEqual(ids(relay), ['aaaa-1', 'bbbb-2']);
    process.env.CLAUDE_CODE_SESSION_ID = 'aaaa-1';
    assert.match(relay.main(['cancel']), /^Relay cancelled/);
    assert.deepStrictEqual(ids(relay), ['bbbb-2']);
  }));

test('cancel with one armed takes that one; --all takes every one', () =>
  isolated((relay, dir) => {
    armIt(relay, 'aaaa-1', dir);
    assert.match(relay.main(['cancel']), /^Relay cancelled/);
    assert.deepStrictEqual(ids(relay), []);
    armIt(relay, 'aaaa-1', dir);
    armIt(relay, 'bbbb-2', dir);
    assert.match(relay.main(['cancel', '--all']), /^2 relays cancelled/);
    assert.deepStrictEqual(ids(relay), []);
    assert.match(relay.main(['cancel']), /Nothing was armed/);
  }));

test('sessionCwd reads the folder a session ran in from its own transcript', () =>
  isolated((relay, dir) => {
    const project = path.join(dir, 'projects', 'D--work-other');
    fs.mkdirSync(project, { recursive: true });
    const own = path.join(dir, 'work', 'other project');
    fs.writeFileSync(path.join(project, 'sess-own.jsonl'), [
      JSON.stringify({ type: 'summary', summary: 'no cwd here' }),
      '{ not json "cwd"',
      JSON.stringify({ type: 'user', cwd: own, sessionId: 'sess-own' }),
      JSON.stringify({ type: 'user', cwd: path.join(dir, 'later'), sessionId: 'sess-own' }),
    ].join('\n') + '\n');
    fs.writeFileSync(path.join(project, 'sess-none.jsonl'), JSON.stringify({ type: 'summary' }) + '\n');
    assert.strictEqual(relay.sessionCwd('sess-own'), own, 'the first recorded cwd, not process.cwd()');
    assert.notStrictEqual(relay.sessionCwd('sess-own'), process.cwd());
    assert.strictEqual(relay.sessionCwd('sess-none'), null);
    assert.strictEqual(relay.sessionCwd('sess-missing'), null);
    assert.strictEqual(relay.sessionCwd(null), null);
  }));

test('a Claude Code shell (CLAUDECODE) is detected as Claude, not by the disk fallback', () => {
  const host = require('../skills/usage-limits/scripts/host.js');
  assert.strictEqual(host.detect([], { CLAUDECODE: '1' }), host.CLAUDE);
  assert.strictEqual(host.detect(['--host', 'codex'], { CLAUDECODE: '1' }), host.CODEX, '--host still wins');
  assert.strictEqual(host.detect([], { CLAUDECODE: '1', USAGE_LIMITS_HOST: 'codex' }), host.CODEX, 'the env override still wins');
  assert.strictEqual(host.detect([], { CLAUDECODE: '1', CODEX_HOME: 'x' }), host.CODEX, 'a Codex child that inherited it is still Codex');
  assert.ok(require('../tools/test-host-env.js').INHERITED.includes('CLAUDECODE'), 'the test preload strips it');
});
