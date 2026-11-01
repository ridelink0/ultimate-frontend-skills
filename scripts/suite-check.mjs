#!/usr/bin/env node
// Validate the three independently selectable plugins in Gev's source repository.
import { readFileSync, existsSync, realpathSync, readdirSync } from 'node:fs';
import { resolve, relative, isAbsolute, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = file => JSON.parse(readFileSync(file, 'utf8'));
const within = (root, file) => {
  const path = relative(root, file);
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith('../') && !path.startsWith('..\\'));
};
const hash = file => createHash('sha256').update(readFileSync(file).toString('latin1').replace(/\r\n/g, '\n'), 'latin1').digest('hex');

export function suiteIssues(root = ROOT) {
  const issues = [];
  const fail = message => issues.push(message);
  try {
    root = realpathSync(root);
    const marketplace = read(join(root, '.claude-plugin/marketplace.json'));
    const required = new Map([
      ['ultimate-frontend-skills', './'],
      ['usage-limits', './plugins/usage-limits'],
      ['image-deep-research', './plugins/image-deep-research'],
    ]);
    const seen = new Set();
    for (const plugin of marketplace.plugins || []) {
      if (seen.has(plugin.name)) fail(`duplicate marketplace plugin: ${plugin.name}`);
      seen.add(plugin.name);
      if (!required.has(plugin.name) || plugin.source !== required.get(plugin.name)) {
        fail(`unexpected marketplace source: ${plugin.name}`);
        continue;
      }
      const location = resolve(root, plugin.source);
      if (!existsSync(location) || !within(root, realpathSync(location))) {
        fail(`plugin source is missing or escapes repository: ${plugin.name}`);
        continue;
      }
      let safe = true;
      for (const file of ['.claude-plugin/plugin.json', '.codex-plugin/plugin.json', 'package.json', 'LICENSE']) {
        const target = join(location, file);
        if (!existsSync(target) || !within(root, realpathSync(target))) { fail(`${plugin.name}: missing or external ${file}`); safe = false; }
      }
      if (!safe) continue;
      const claude = read(join(location, '.claude-plugin/plugin.json'));
      const codex = read(join(location, '.codex-plugin/plugin.json'));
      const pkg = read(join(location, 'package.json'));
      if (claude.name !== plugin.name || codex.name !== plugin.name) fail(`${plugin.name}: host manifest identity differs`);
      if (![codex.version, pkg.version, plugin.version].every(version => version === claude.version)) fail(`${plugin.name}: version drift`);
      if (!pkg.engines?.node) fail(`${plugin.name}: missing Node runtime floor`);
    }
    for (const name of required.keys()) if (!seen.has(name)) fail(`missing marketplace plugin: ${name}`);

    const source = join(root, 'plugins/image-deep-research/skills/image-deep-research');
    const bundled = join(root, 'skills/image-deep-research');
    const lock = read(join(root, 'image-deep-research.lock.json'));
    if (!/^[a-f0-9]{40}$/.test(lock.commit || '') || lock.dirty !== false || lock.tag !== `v${lock.version}`) fail('image source must name a clean release commit and version tag');
    // Compare recursively against the lock without following source symlinks.
    const collect = (dir, base = dir) => {
      if (!within(root, realpathSync(dir))) throw new Error('image source escapes repository');
      return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error('image source contains a symbolic link');
      return entry.isDirectory() ? collect(path, base) : [relative(base, path).replaceAll('\\', '/')];
      }).sort();
    };
    const expected = Object.keys(lock.files).sort();
    if (!expected.includes('SKILL.md')) fail('image release lock has no SKILL.md');
    if (read(join(root, 'plugins/image-deep-research/.claude-plugin/plugin.json')).version !== lock.version) fail('image source version differs from bundled release');
    for (const dir of [source, bundled]) {
      if (JSON.stringify(collect(dir)) !== JSON.stringify(expected)) fail('image source file inventory differs from bundled release');
      for (const file of expected) {
        const target = resolve(dir, file);
        if (!within(dir, target) || !existsSync(target) || !within(root, realpathSync(target)) || hash(target) !== lock.files[file]) fail(`image release hash differs: ${file}`);
      }
    }
  } catch (error) { fail(`suite cannot be verified: ${error.message}`); }
  return issues;
}

export function runSuite(root = ROOT) {
  const groups = [
    ['UFS', root, '.test.mjs'],
    ['Usage Limits', join(root, 'plugins/usage-limits'), '.test.js'],
    ['Image research', join(root, 'plugins/image-deep-research'), '.test.mjs'],
  ];
  for (const [label, cwd, suffix] of groups) {
    const files = readdirSync(join(cwd, 'test')).filter(file => file.endsWith(suffix)).sort().map(file => join('test', file));
    if (!files.length) throw new Error(`${label}: no tests found`);
    console.log(`\n${label}: ${files.length} test files`);
    const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...files], { cwd, stdio: 'inherit', windowsHide: true });
    if (result.error || result.status !== 0) return result.status || 1;
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--test')) { console.error('usage: node scripts/suite-check.mjs [--test]'); process.exitCode = 2; }
  else {
    const issues = suiteIssues();
    for (const issue of issues) console.error(issue);
    if (issues.length) process.exitCode = 1;
    else {
      console.log('Suite manifests, independent selections and image release hashes match.');
      if (args.includes('--test')) process.exitCode = runSuite();
    }
  }
}
