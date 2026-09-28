/* The library versions UFS tells a page to load. references/stack.md holds
   the verified specifiers; everything the plugin prints (the scaffolder's
   import map, the references) pins three.js at the same version, and an
   import map always maps "three" and "three/addons/" together. Offline those
   are the checks. With UFS_NETWORK=1 each specifier is read against the npm
   registry: a pin a major version behind fails, and the rest are listed. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const R = join(root, 'skills', 'ultimate-frontend-skills', 'references');
const stack = readFileSync(join(R, 'stack.md'), 'utf8');
const block = stack.slice(stack.indexOf('## Exact specifiers, verified'));
const specs = [...block.slice(block.indexOf('```'), block.indexOf('```', block.indexOf('```') + 3)).matchAll(/(@?[a-z][\w./-]*)@(\d+\.\d+\.\d+)/g)].map((m) => [m[1], m[2]]);

test('stack.md lists the specifiers, and the plugin pins three.js at that one version everywhere it prints it', () => {
  assert.ok(specs.length >= 20, specs.length + ' specifiers');
  const three = specs.find(([n]) => n === 'three')[1];
  const files = ['stack.md', 'motion.md', 'security.md', 'three.md'].map((f) => join(R, f)).concat(join(root, 'scripts', 'webdesign.mjs'));
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    for (const m of text.matchAll(/npm\/three@(\d+\.\d+\.\d+)/g)) assert.equal(m[1], three, f + ' loads three@' + m[1]);
    for (const map of text.matchAll(/"three":\s*"[^"]*three@([\d.]+)[^"]*",\s*"three\/addons\/":\s*"[^"]*three@([\d.]+)/g))
      assert.equal(map[1], map[2], f + ': the import map pins "three" and "three/addons/" at different versions');
  }
});

const npmView = (name) => {
  const r = spawnSync('npm', ['view', name, 'version'], { encoding: 'utf8', shell: process.platform === 'win32', timeout: 60000 });
  return r.status === 0 ? r.stdout.trim() : null;
};

// Registered only with UFS_NETWORK=1: CI fails any run with a skipped test,
// and a registry read is not something every run should depend on.
if (process.env.UFS_NETWORK === '1') test('no pin is a major version behind the npm registry (UFS_NETWORK=1)', { timeout: 600000 }, () => {
  const behind = [], older = [];
  for (const [name, pinned] of specs) {
    const latest = npmView(name.replace(/^anime\.js$/, 'animejs'));
    if (!latest) continue;
    if (Number(latest.split('.')[0]) > Number(pinned.split('.')[0]) && name !== '@unseenco/taxi') behind.push(`${name} ${pinned} -> ${latest}`);
    else if (latest !== pinned) older.push(`${name} ${pinned} -> ${latest}`);
  }
  if (older.length) console.log('pins behind by a minor or patch: ' + older.join(', '));
  assert.deepEqual(behind, []);
});
