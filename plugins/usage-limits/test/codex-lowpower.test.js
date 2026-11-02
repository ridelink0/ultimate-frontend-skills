'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { plan } = require('../skills/usage-limits/scripts/codex-lowpower.js');
const { decide } = require('../skills/usage-limits/scripts/recommend.js');
const cli = path.resolve(__dirname, '../bin/cli.js');
test('Codex on, repeated on and off preserve quoted keys, comments, CRLF and tables', () => {
  const original = '# user defaults\r\n"model" = "gpt-example" # keep\r\nmodel_reasoning_effort = \'xhigh\'\r\n[profiles.fast]\r\nmodel = "profile-model"\r\n';
  const a = plan(original, { command: 'on', effort: 'low' }, null);
  const b = plan(a.text, { command: 'on', effort: 'medium', model: 'gpt-other' }, a.state);
  assert.match(b.text, /model = "gpt-other"/);
  assert.match(b.text, /\[profiles.fast\]\r\nmodel = "profile-model"/);
  assert.equal(plan(b.text, { command: 'off' }, b.state).text, original);
});
test('unset keys restore and unrelated edits survive', () => {
  const a = plan('[other]\nvalue = 1\n', { command: 'on' }, null);
  assert.equal(plan(a.text.replace('value = 1', 'value = 2'), { command: 'off' }, a.state).text, '[other]\nvalue = 2\n');
});
test('manual managed edits, malformed TOML and corrupt restore data refuse writes', () => {
  const a = plan('', { command: 'on' }, null);
  assert.throws(() => plan(a.text.replace('"low"', '"high"'), { command: 'off' }, a.state), /outside lowpower/);
  assert.throws(() => plan('model = 5\n', { command: 'on' }, null), /Unsupported/);
  assert.throws(() => plan('model = "a"\nmodel = "b"\n', { command: 'on' }, null), /Duplicate/);
  assert.throws(() => plan('', { command: 'on' }, { version: 9 }), /Unrecognized/);
});
test('actual CLI routes hosts, dry runs, restores and rejects malformed options without touching Claude', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-control-'));
  try {
    const codex = path.join(dir, 'codex'), claude = path.join(dir, 'claude');
    fs.mkdirSync(codex); fs.mkdirSync(claude);
    const original = 'model = "gpt-example"\nmodel_reasoning_effort = "xhigh"\n[features]\nx = true\n';
    fs.writeFileSync(path.join(codex, 'config.toml'), original);
    fs.writeFileSync(path.join(claude, 'settings.json'), '{"model":"opus","effortLevel":"high"}\n');
    const env = { ...process.env, CODEX_HOME: codex, CLAUDE_CONFIG_DIR: claude, USAGE_LIMITS_HOST: 'claude' };
    const run = args => spawnSync(process.execPath, [cli, 'lowpower', ...args], { env, encoding: 'utf8' });
    assert.equal(run(['on', '--host=codex', '--effort', 'medium', '--model', 'gpt-other', '--dry-run']).status, 0);
    assert.equal(fs.readFileSync(path.join(codex, 'config.toml'), 'utf8'), original);
    assert.equal(fs.existsSync(path.join(codex, 'usage-limits-lowpower.json')), false);
    const applied = run(['on', '--host', 'codex', '--effort', 'medium', '--model', 'gpt-other']);
    assert.equal(applied.status, 0, applied.stderr);
    assert.match(applied.stdout, /new sessions/);
    assert.match(fs.readFileSync(path.join(codex, 'config.toml'), 'utf8'), /"gpt-other"/);
    assert.equal(run(['on', '--host', 'codex', '--effort', 'low']).status, 0);
    assert.equal(run(['off', '--host', 'codex']).status, 0);
    assert.equal(fs.readFileSync(path.join(codex, 'config.toml'), 'utf8'), original);
    for (const args of [['on', '--host', 'wrong'], ['on', '--effort'], ['on', '--host='], ['on', '--unknown'], ['on', '--host', 'codex', '--effort', 'turbo']])
      assert.notEqual(run(args).status, 0);
    assert.equal(fs.readFileSync(path.join(claude, 'settings.json'), 'utf8'), '{"model":"opus","effortLevel":"high"}\n');
    assert.equal(run(['on', '--host', 'claude', '--effort', 'low']).status, 0);
    assert.equal(run(['off', '--host', 'claude']).status, 0);
    assert.equal(fs.readFileSync(path.join(codex, 'config.toml'), 'utf8'), original);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('Codex recommendations never suggest Claude families or raise minimal effort', () => {
  const common = { codex: true, binding: { percentLeft: 1, usdPerPercent: 1 }, rates: { median: 1, high: 1 }, settings: { model: 'gpt-example', effortLevel: 'ultra' } };
  const d = decide(common);
  assert.equal(d.effort.target, 'low');
  assert.doesNotMatch(JSON.stringify(d), /sonnet|haiku|opus|\/effort\s/);
  assert.equal(decide({ ...common, settings: { effortLevel: 'minimal' } }).effort.changes, false);
});
