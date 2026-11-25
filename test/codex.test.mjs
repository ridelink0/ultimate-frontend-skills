/* Codex: the plugin's own hooks, and the plugin root the skills need there.
   Codex leaves ${CLAUDE_PLUGIN_ROOT} empty in the commands a skill gives, so a
   command copied from a skill ran `node "/scripts/webdesign.mjs"` and failed.
   The SessionStart hook names the folder; these tests pin that it exists, runs
   from Codex's PLUGIN_ROOT, and that every skill and command says what to do
   without it. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const json = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));

test('the Codex manifest names its own hooks file, and every hook in it points at a script that exists', () => {
  const manifest = json('.codex-plugin/plugin.json');
  assert.equal(manifest.hooks, './hooks/codex-hooks.json');
  const hooks = json('hooks/codex-hooks.json').hooks;
  assert.ok(hooks.SessionStart, 'SessionStart is what tells Codex where the plugin is');
  for (const groups of Object.values(hooks)) {
    for (const group of groups) {
      for (const one of group.hooks) {
        const m = /\$\{PLUGIN_ROOT\}\/([^"]+)"/.exec(one.command);
        assert.ok(m, one.command);
        assert.ok(existsSync(join(root, m[1])), m[1]);
      }
    }
  }
});

test('the SessionStart hook names the plugin folder Codex gives it, with a command that works there', () => {
  const run = spawnSync(process.execPath, [join(root, 'hooks', 'codex-root.mjs')], {
    input: JSON.stringify({ hook_event_name: 'SessionStart', source: 'startup' }),
    env: { ...process.env, PLUGIN_ROOT: root, CLAUDE_PLUGIN_ROOT: root },
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr);
  const where = root.replace(/\\/g, '/');
  assert.match(run.stdout, new RegExp('installed at ' + where.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(run.stdout, /scripts\/webdesign\.mjs" tools/);
  // With no PLUGIN_ROOT at all it still finds itself.
  const bare = spawnSync(process.execPath, [join(root, 'hooks', 'codex-root.mjs')], {
    input: '{}', env: { PATH: process.env.PATH }, encoding: 'utf8',
  });
  assert.match(bare.stdout, /installed at /);
});

test('every command that uses the plugin root says what Codex should use instead', () => {
  for (const file of readdirSync(join(root, 'commands'))) {
    const text = readFileSync(join(root, 'commands', file), 'utf8');
    if (!text.includes('${CLAUDE_PLUGIN_ROOT}')) continue;
    assert.match(text, /session note/, file + ' gives Codex no plugin folder');
    assert.doesNotMatch(text, /three levels above this file/, file);
  }
});

test('the bundled usage-limits plugin ships Codex hooks with the cost lines', () => {
  const manifest = json('plugins/usage-limits/.codex-plugin/plugin.json');
  assert.equal(manifest.hooks, './hooks/codex-hooks.json');
  const hooks = json('plugins/usage-limits/hooks/codex-hooks.json').hooks;
  assert.ok(hooks.Stop && hooks.SessionEnd);
});
