import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { suiteIssues } from '../scripts/suite-check.mjs';

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'ufs-suite-'));
  const put = (path, value) => { const target = join(root, path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, value); };
  const json = (path, value) => put(path, JSON.stringify(value));
  const entries = [['ultimate-frontend-skills', './'], ['usage-limits', './plugins/usage-limits'], ['image-deep-research', './plugins/image-deep-research']].map(([name, source]) => ({ name, source, version: '1.0.0' }));
  const market = () => json('.claude-plugin/marketplace.json', { plugins: entries });
  for (const entry of entries) {
    for (const file of ['.claude-plugin/plugin.json', '.codex-plugin/plugin.json', 'package.json']) json(join(entry.source, file), { name: entry.name, version: entry.version, engines: { node: '>=22' } });
    put(join(entry.source, 'LICENSE'), 'MIT');
  }
  market();
  const text = '---\nname: image-deep-research\n---\nEvidence\n';
  const lock = { version: '1.0.0', tag: 'v1.0.0', commit: 'a'.repeat(40), dirty: false, files: { 'SKILL.md': createHash('sha256').update(text).digest('hex') } };
  json('image-deep-research.lock.json', lock);
  put('skills/image-deep-research/SKILL.md', text);
  put('plugins/image-deep-research/skills/image-deep-research/SKILL.md', text);
  try { return run({ root, put, json, entries, market, lock }); }
  finally {
    assert.ok(root.startsWith(join(tmpdir(), 'ufs-suite-')));
    rmSync(root, { recursive: true, force: true });
  }
}

test('consolidated plugins remain independently selectable with identical image evidence', () => fixture(({ root, put }) => {
  assert.deepEqual(suiteIssues(root), []);
  put('skills/image-deep-research/SKILL.md', 'different');
  assert.match(suiteIssues(root).join('\n'), /release hash differs/);
}));

test('suite rejects missing and duplicated selections and version drift', () => fixture(({ root, json, entries, market }) => {
  entries.push({ ...entries[1] }); market();
  assert.match(suiteIssues(root).join('\n'), /duplicate marketplace plugin/);
  entries.pop(); entries.splice(1, 1); market();
  assert.match(suiteIssues(root).join('\n'), /missing marketplace plugin: usage-limits/);
  json('plugins/image-deep-research/package.json', { version: '2.0.0', engines: { node: '>=22' } });
  assert.match(suiteIssues(root).join('\n'), /version drift/);
}));

test('suite refuses traversal sources, extra image files and unreleased provenance', () => fixture(({ root, put, json, entries, market, lock }) => {
  entries[1].source = '../outside'; market();
  assert.match(suiteIssues(root).join('\n'), /unexpected marketplace source/);
  put('plugins/image-deep-research/skills/image-deep-research/unreviewed.mjs', 'process.exit()');
  assert.match(suiteIssues(root).join('\n'), /inventory differs/);
  json('image-deep-research.lock.json', { ...lock, dirty: true, tag: null });
  assert.match(suiteIssues(root).join('\n'), /clean release commit/);
}));

test('suite refuses image directory junctions outside its repository', () => fixture(({ root }) => {
  const outside = mkdtempSync(join(tmpdir(), 'ufs-suite-'));
  try {
    cpSync(join(root, 'plugins/image-deep-research/skills'), outside, { recursive: true });
    rmSync(join(root, 'plugins/image-deep-research/skills'), { recursive: true });
    symlinkSync(outside, join(root, 'plugins/image-deep-research/skills'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.match(suiteIssues(root).join('\n'), /escapes repository/);
  } finally { assert.ok(outside.startsWith(join(tmpdir(), 'ufs-suite-'))); rmSync(outside, { recursive: true, force: true }); }
}));
