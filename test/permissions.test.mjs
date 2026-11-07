// Guard for Gev's directory resubmission: none of UFS, usage-limits or
// image-deep-research may approve its own actions or weaken the user's
// permission prompts. scripts/distribution.mjs refuses the text patterns in
// shipped source; this file checks the behaviour, so a writer that comes back
// under a different spelling still fails here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const root = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const scripts = join(root, 'plugins/usage-limits/skills/usage-limits/scripts');
const relay = require(join(scripts, 'relay.js'));
const wake = require(join(scripts, 'wake.js'));

function inConfigDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'ufs-permissions-'));
  const keys = ['CLAUDE_CONFIG_DIR', 'USAGE_LIMITS_RELAY_MODE'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  process.env.CLAUDE_CONFIG_DIR = dir;
  delete process.env.USAGE_LIMITS_RELAY_MODE;
  try { return fn(dir); } finally {
    for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    rmSync(dir, { recursive: true, force: true });
  }
}

test('relay preflight reads folder trust and never writes .claude.json', () => inConfigDir((dir) => {
  const project = join(dir, 'project');
  mkdirSync(project);
  const file = join(dir, '.claude.json');
  const raw = JSON.stringify({ projects: { [project]: { hasTrustDialogAccepted: false } } });
  writeFileSync(file, raw);
  const before = readdirSync(dir).sort();
  const result = relay.preflightPrompts(project, relay.settings());
  assert.equal(result.ok, true);
  assert.deepEqual(result.changes, []);
  assert.equal(result.pending.length, 1, 'untrusted folder is reported for the user to answer');
  assert.equal(readFileSync(file, 'utf8'), raw, '.claude.json is left byte for byte');
  assert.deepEqual(readdirSync(dir).sort(), before, 'no backup or settings file appears');
  rmSync(file);
  relay.preflightPrompts(project, relay.settings());
  assert.equal(existsSync(file), false, 'a missing .claude.json is not created');
}));

test('relay never stores or applies a permission mode', () => inConfigDir((dir) => {
  relay.configure({ mode: 'resume', permissionMode: 'bypassPermissions' });
  assert.equal(relay.settings().permissionMode, null);
  assert.match(relay.main(['permission', 'bypassPermissions']), /does not set permission modes/);
  const stored = JSON.parse(readFileSync(relay.relayFile(), 'utf8'));
  assert.equal('permissionMode' in (stored.config || {}), false);
  assert.equal(existsSync(join(dir, 'settings.json')), false, 'settings.json is not touched');
}));

test('only the relay mode command can turn on unattended resume', () => inConfigDir(() => {
  process.env.USAGE_LIMITS_RELAY_MODE = 'resume';
  assert.equal(relay.settings({ config: {} }).mode, 'notify', 'an env var cannot arm resume');
  process.env.USAGE_LIMITS_RELAY_MODE = 'notify';
  assert.equal(relay.settings({ config: { mode: 'resume' } }).mode, 'notify', 'an env var can still turn it off');
  delete process.env.USAGE_LIMITS_RELAY_MODE;
  assert.equal(relay.settings().mode, 'notify', 'default is notify');
  relay.main(['mode', 'resume']);
  assert.equal(relay.settings().mode, 'resume', 'the explicit user command still works');
}));

test('no exported function grants trust or pre-accepts bypass', () => {
  const names = [...Object.keys(relay), ...Object.keys(wake)];
  assert.deepEqual(names.filter((n) => /bypass|trust|approv|accept|applySetting|settingIs/i.test(n)), []);
});

test('resumed and fresh launches never weaken permission prompts', () => {
  const record = { id: 'sess-1234', cwd: '/w', project: 'w' };
  const config = { permissionMode: 'bypassPermissions', model: null, fresh: false };
  const launches = [
    wake.claudeArgs(record, 'go on', config, false),
    wake.claudeArgs(record, 'go on', config, true),
    wake.claudeArgs(record, 'go on', { ...config, fresh: true }, false),
    wake.visibleArgs(record, config, 'prompt.md'),
    wake.freshArgs(record, config, 'first prompt'),
  ];
  for (const args of launches) {
    assert.doesNotMatch(args.join(' '), /bypassPermissions|--permission-mode|--dangerously|--allowed-?tools|acceptEdits/i);
  }
  for (const args of launches.slice(0, 3)) {
    const at = args.indexOf('--permission-prompts');
    assert.ok(at !== -1 && args[at + 1] === 'none', 'an unattended request for approval is denied, not approved');
  }
});

test('no plugin hook answers a permission prompt', () => {
  const files = ['hooks/hooks.json', 'plugins/usage-limits/hooks/hooks.json', 'plugins/image-deep-research/hooks/hooks.json'];
  for (const rel of files) {
    const file = join(root, rel);
    if (!existsSync(file)) continue;
    const hooks = JSON.parse(readFileSync(file, 'utf8')).hooks || {};
    assert.equal('PermissionRequest' in hooks, false, rel);
  }
});
