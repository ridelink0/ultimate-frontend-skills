// The directory editions under directory/ are generated from the sources and
// must keep to the plugin directory's file rules: Markdown, JSON and images
// only, no hooks or scripts, tools limited to Read, Grep, Glob and LS.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildUfs, buildUsageLimits, problems, inert } from '../tools/directory-edition.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

for (const [name, build] of [['ultimate-frontend-skills', buildUfs], ['usage-limits', buildUsageLimits]]) {
  test(`${name} directory edition keeps to the directory rules`, () => {
    const files = build();
    assert.deepEqual(problems(files), []);
    assert.ok(files.has('.claude-plugin/plugin.json'));
    assert.ok(files.has('icon.png') && files.has('README.md') && files.has('LICENSE') && files.has('PRIVACY.md'));
    const manifest = JSON.parse(files.get('.claude-plugin/plugin.json'));
    assert.equal(manifest.name, name);
    assert.equal(manifest.icon, './icon.png');
    assert.equal(manifest.hooks, undefined);
    assert.equal(manifest.mcpServers, undefined);
  });
}

test('the committed directory editions are up to date', () => {
  const run = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'directory-edition.mjs'), '--check'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
});

test('a script command becomes a full-edition note, a copy-in file stays', () => {
  const md = 'Run it:\n\n```bash\nnode "${CLAUDE_PLUGIN_ROOT}/scripts/webdesign.mjs" new site\n```\n\nCSS:\n\n```css\n.a { color: red }\n```\n\nThen `webdesign.mjs audit <dir>` and see scripts/contents.mjs.\n';
  const out = inert(md);
  assert.match(out, /Full edition only/);
  assert.match(out, /\.a \{ color: red \}/);
  assert.doesNotMatch(out, /CLAUDE_PLUGIN_ROOT/);
  assert.match(out, /`webdesign\.mjs audit` \(full edition only\)/);
  assert.match(out, /the full edition's contents\.mjs/);
});

test('the full plugin does not load the directory editions', () => {
  const ufs = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
  assert.ok(!JSON.stringify(ufs).includes('directory/'));
});

test('claude plugin validate passes the directory profile when it is installed', (t) => {
  const has = spawnSync('claude', ['--version'], { encoding: 'utf8' });
  if (has.status !== 0) return t.skip('claude CLI not installed');
  for (const name of ['ultimate-frontend-skills', 'usage-limits']) {
    execFileSync('claude', ['plugin', 'validate', '--profile', 'directory', '--strict', path.join(ROOT, 'directory', name)], { stdio: 'pipe' });
  }
});
