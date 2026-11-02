'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const relay = require('../skills/usage-limits/scripts/relay.js');
const wake = require('../skills/usage-limits/scripts/wake.js');
function isolated(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-limits-preflight-'));
  const before = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = dir;
  try { return fn(dir); } finally {
    if (before === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = before;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
test('startup diagnostic never grants trust or bypass permission, including legacy configurations', () => isolated((dir) => {
  const file = path.join(dir, '.claude.json');
  const settings = path.join(dir, 'settings.json');
  const raw = JSON.stringify({ projects: { [dir]: { hasTrustDialogAccepted: false } }, other: 1 });
  fs.writeFileSync(file, raw);
  fs.writeFileSync(settings, '{"permissions":{"defaultMode":"default"}}');
  const beforeSettings = fs.readFileSync(settings, 'utf8');
  for (const dry of [false, true]) {
    const result = relay.preflightPrompts(dir, { permissionMode: 'bypassPermissions' }, { dry });
    assert.equal(result.ok, true);
    assert.deepEqual(result.changes, []);
    assert.equal(result.pending.length, 1);
  }
  assert.equal(fs.readFileSync(file, 'utf8'), raw);
  assert.equal(fs.readFileSync(settings, 'utf8'), beforeSettings);
  assert.equal(fs.existsSync(file + '.bak-usage-limits'), false);
}));
test('missing and malformed account files are left untouched', () => isolated((dir) => {
  const file = path.join(dir, '.claude.json');
  assert.equal(relay.preflightPrompts(dir, {}).pending.length, 1);
  assert.equal(fs.existsSync(file), false);
  for (const raw of ['{broken', '[]', 'null']) {
    fs.writeFileSync(file, raw);
    assert.equal(relay.preflightPrompts(dir, {}).ok, false);
    assert.equal(fs.readFileSync(file, 'utf8'), raw);
  }
}));
test('existing user-granted trust is diagnosed without changing account state', () => isolated((dir) => {
  const file = path.join(dir, '.claude.json');
  const raw = JSON.stringify({ projects: { [dir]: { hasTrustDialogAccepted: true } } });
  fs.writeFileSync(file, raw);
  assert.deepEqual(relay.preflightPrompts(dir, {}).pending, []);
  assert.equal(fs.readFileSync(file, 'utf8'), raw);
}));
test('arming records approval requirements without answering them', () => isolated((dir) => {
  const file = path.join(dir, '.claude.json');
  fs.writeFileSync(file, '{"projects":{}}');
  const now = Date.UTC(2026, 10, 1, 12);
  const result = relay.arm({ now, sessionId: 'pppp-1', cwd: dir, project: 'p', schedule: false,
    resetsAt: now + 3600000, binding: { percentUsed: 85, resetsAt: now + 3600000, key: 'five_hour', label: '5-hour' },
    work: { hasWork: true, pending: 1, source: 'test', todos: [] },
    config: { enabled: true, mode: 'resume', graceMinutes: 5, permissionMode: 'bypassPermissions', armOn: 'threshold', at: 80, attempts: 2, backstopAt: 95 } });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.record.startupQuestions.length, 1);
  assert.equal(fs.readFileSync(file, 'utf8'), '{"projects":{}}');
  assert.match(relay.status(now), /User approval required/);
}));
test('legacy permission modes cannot reach any Claude launch command', () => isolated((dir) => {
  for (const permissionMode of ['bypassPermissions', 'acceptEdits', 'auto', 'dontAsk', '--evil']) {
    assert.equal(relay.settings({ config: { permissionMode } }).permissionMode, null);
    const config = { permissionMode, show: true };
    const record = { id: 'sess-1234', cwd: dir, project: 'p' };
    for (const args of [wake.claudeArgs(record, 'go', config, false), wake.visibleArgs(record, config, '/note.md')]) {
      assert.equal(args.includes('--permission-mode'), false);
      assert.equal(args.includes(permissionMode), false);
      assert.equal(args.includes('--dangerously-skip-permissions'), false);
    }
  }
  relay.configure({ permissionMode: 'bypassPermissions' });
  assert.equal(relay.read().config.permissionMode, undefined);
}));
