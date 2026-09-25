// The image-deep-research skill is developed in its own repository and
// bundled here by scripts/sync-image-research.mjs. These tests hold the
// bundled copy to its lock file, keep the old visual-research name working,
// and keep the skill findable by the words people type.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdtempSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { drift, readLock, hashTree, hashFile, syncFrom, listFiles, BUNDLED, SKILL_NAME } from '../scripts/sync-image-research.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const lock = readLock();

function frontmatter(text) {
  const src = text.replace(/\r\n/g, '\n');
  const end = src.indexOf('\n---\n', 3);
  assert.ok(src.startsWith('---\n') && end > 0, 'no frontmatter');
  const meta = {};
  for (const line of src.slice(4, end).split('\n')) {
    const m = /^([a-z-]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    meta[m[1]] = m[2].startsWith('"') ? JSON.parse(m[2]) : m[2];
  }
  return { meta, body: src.slice(end + 5) };
}

test('the bundled image-deep-research copy matches its lock exactly', () => {
  assert.ok(lock, 'image-deep-research.lock.json is missing: run node scripts/sync-image-research.mjs --tag vX.Y.Z');
  assert.deepEqual(drift(), [], 'the bundled skill drifted from the lock');
  assert.equal(hashTree(BUNDLED).tree, lock.tree);
});

test('the lock names a released upstream: a tag matching the version, a commit, a clean tree', () => {
  assert.equal(lock.upstream, 'https://github.com/ridelink0/image-deep-research.git');
  assert.match(lock.version, /^\d+\.\d+\.\d+$/);
  assert.equal(lock.tag, 'v' + lock.version, 'bundle from a released tag, not a working tree');
  assert.match(lock.commit, /^[0-9a-f]{40}$/);
  assert.equal(lock.dirty, false);
  assert.ok(Object.keys(lock.files).includes('SKILL.md'));
});

test('drift() catches an edited, a missing and an extra file, and ignores CRLF checkouts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ufs-idr-drift-'));
  try {
    const copy = join(dir, SKILL_NAME);
    cpSync(BUNDLED, copy, { recursive: true });
    assert.deepEqual(drift(copy, lock), []);

    // A Windows checkout with CRLF endings is the same file, not drift.
    const skill = join(copy, 'SKILL.md');
    writeFileSync(skill, readFileSync(skill, 'utf8').replace(/\r?\n/g, '\r\n'));
    assert.deepEqual(drift(copy, lock), []);

    writeFileSync(skill, readFileSync(skill, 'utf8') + '\nA hand edit.\n');
    assert.match(drift(copy, lock).join('\n'), /SKILL\.md differs from upstream/);

    rmSync(join(copy, 'scripts', 'images.mjs'));
    assert.match(drift(copy, lock).join('\n'), /scripts\/images\.mjs is in the lock but not in the bundled copy/);

    writeFileSync(join(copy, 'scripts', 'extra.mjs'), '');
    assert.match(drift(copy, lock).join('\n'), /scripts\/extra\.mjs is in the bundled copy but not upstream/);

    assert.deepEqual(drift(join(dir, 'nope'), lock), [`skills/${SKILL_NAME} is missing`]);
    assert.match(drift(copy, null)[0], /no lock file/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('syncFrom copies the skill folder and writes a lock that --check then accepts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ufs-idr-sync-'));
  try {
    // A stand-in upstream checkout, built from the bundled copy, and a
    // stand-in UFS root, so the real tree is never touched.
    const src = join(dir, 'upstream');
    mkdirSync(join(src, '.claude-plugin'), { recursive: true });
    writeFileSync(join(src, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'image-deep-research', version: '9.9.9', repository: 'https://example.invalid/idr' }));
    cpSync(BUNDLED, join(src, 'skills', SKILL_NAME), { recursive: true });
    const ufs = join(dir, 'ufs');
    mkdirSync(join(ufs, 'skills', SKILL_NAME, 'stale'), { recursive: true });
    writeFileSync(join(ufs, 'skills', SKILL_NAME, 'stale', 'old.md'), 'left over');

    const written = syncFrom(src, { root: ufs });
    assert.equal(written.version, '9.9.9');
    assert.equal(written.tag, null);
    assert.equal(written.upstream, 'https://example.invalid/idr');
    assert.ok(!existsSync(join(ufs, 'skills', SKILL_NAME, 'stale')), 'files from the previous copy survived the sync');
    assert.deepEqual(listFiles(join(ufs, 'skills', SKILL_NAME)), listFiles(BUNDLED));
    const onDisk = JSON.parse(readFileSync(join(ufs, 'image-deep-research.lock.json'), 'utf8'));
    assert.deepEqual(onDisk.files, lock.files, 'the same files hash the same');
    assert.deepEqual(drift(join(ufs, 'skills', SKILL_NAME), onDisk), []);

    // Not the upstream plugin: refused before anything is copied.
    writeFileSync(join(src, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'something-else', version: '1.0.0' }));
    assert.throws(() => syncFrom(src, { root: ufs }), /not image-deep-research/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('hashFile treats LF and CRLF copies of a text file as the same', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ufs-idr-hash-'));
  try {
    writeFileSync(join(dir, 'lf.txt'), 'a\nb\n');
    writeFileSync(join(dir, 'crlf.txt'), 'a\r\nb\r\n');
    writeFileSync(join(dir, 'other.txt'), 'a\nc\n');
    assert.equal(hashFile(join(dir, 'lf.txt')), hashFile(join(dir, 'crlf.txt')));
    assert.notEqual(hashFile(join(dir, 'lf.txt')), hashFile(join(dir, 'other.txt')));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the bundled skill is findable by image and deep research, and works from this plugin', () => {
  const { meta, body } = frontmatter(readFileSync(join(BUNDLED, 'SKILL.md'), 'utf8'));
  assert.equal(meta.name, 'image-deep-research');
  const d = meta.description.toLowerCase();
  for (const w of ['image', 'deep research', 'visual research', 'references', 'moodboard']) assert.ok(d.includes(w), 'description lacks "' + w + '"');
  assert.ok(meta.description.length <= 1024, 'Codex refuses a skill description over 1024 characters');
  // Its own scripts are relative to the skill folder, so they exist here too.
  for (const m of body.matchAll(/\$\{CLAUDE_SKILL_DIR\}\/([A-Za-z0-9_.\/-]+)/g)) assert.ok(existsSync(join(BUNDLED, m[1])), m[1]);
  // The UFS extras it mentions are real in this plugin.
  for (const m of body.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([A-Za-z0-9_.\/-]+)/g)) assert.ok(existsSync(join(root, m[1])), m[1]);
  const webdesign = readFileSync(join(root, 'scripts', 'webdesign.mjs'), 'utf8');
  for (const m of body.matchAll(/webdesign\.mjs" ([a-z-]+)/g)) assert.ok(webdesign.includes(`case '${m[1]}':`), 'webdesign.mjs has no ' + m[1]);
});

test('the old name visual-research still works and loads image-deep-research', () => {
  const p = join(root, 'skills', 'visual-research', 'SKILL.md');
  assert.ok(existsSync(p), 'skills/visual-research/SKILL.md is gone: /ultimate-frontend-skills:visual-research would stop working');
  const { meta, body } = frontmatter(readFileSync(p, 'utf8'));
  assert.equal(meta.name, 'visual-research');
  // Typed by people who know the old name; not offered to the model beside
  // the real skill, so Claude Code lists one image research skill, not two.
  assert.equal(meta['disable-model-invocation'], 'true');
  assert.match(meta.description, /image-deep-research/);
  assert.match(body, /\.\.\/image-deep-research\/SKILL\.md/);
  assert.ok(existsSync(join(root, 'skills', 'visual-research', '..', 'image-deep-research', 'SKILL.md')));
});
