#!/usr/bin/env node
/* ultimate-frontend-skills/sync-image-research - bring the image-deep-research
   skill in from its own repository and record exactly what came in.

   The skill is developed at github.com/ridelink0/image-deep-research and
   released there. UFS ships a copy at skills/image-deep-research/ so anyone
   with UFS has it without a second install (two installs would list the skill
   twice). This script is the only way that copy should change.

   node scripts/sync-image-research.mjs --tag v1.0.0           clone that tag and copy it in
   node scripts/sync-image-research.mjs --from <local checkout> copy from a working tree
   node scripts/sync-image-research.mjs --check                 exit 1 if the copy drifted from the lock
     --repo <git url>   another source repository (default the GitHub one)

   The lock file, image-deep-research.lock.json at the plugin root, records the
   upstream repository, version, tag, commit, and a sha256 of every file in the
   skill. test/image-research.test.mjs fails when the bundled copy and the lock
   disagree, so a hand edit to the copy cannot ship unnoticed. Hashes are taken
   over the file with CRLF turned into LF, so a Windows checkout and a Linux one
   hash the same. */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, rmSync, mkdirSync, cpSync, mkdtempSync } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, '..');
export const SKILL_NAME = 'image-deep-research';
export const BUNDLED = join(ROOT, 'skills', SKILL_NAME);
export const LOCK = join(ROOT, 'image-deep-research.lock.json');
export const DEFAULT_REPO = 'https://github.com/ridelink0/image-deep-research.git';

export function listFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(relative(dir, p).split(sep).join('/'));
    }
  };
  walk(dir);
  return out.sort();
}

export const hashFile = (path) => createHash('sha256').update(readFileSync(path).toString('latin1').replace(/\r\n/g, '\n'), 'latin1').digest('hex');

export function hashTree(dir) {
  const files = {};
  for (const f of listFiles(dir)) files[f] = hashFile(join(dir, f));
  const tree = createHash('sha256').update(Object.entries(files).map(([f, h]) => `${h}  ${f}\n`).join('')).digest('hex');
  return { files, tree };
}

/* Compares a skill folder with a lock. Returns a list of plain-words
   problems; empty means the copy is exactly what the lock says. */
export function drift(dir = BUNDLED, lock = readLock()) {
  if (!lock) return ['no lock file: run scripts/sync-image-research.mjs'];
  if (!existsSync(dir)) return [`skills/${SKILL_NAME} is missing`];
  const now = hashTree(dir).files;
  const problems = [];
  for (const [f, h] of Object.entries(lock.files)) {
    if (!(f in now)) problems.push(`${f} is in the lock but not in the bundled copy`);
    else if (now[f] !== h) problems.push(`${f} differs from upstream ${lock.version} (edit it upstream and sync, do not edit the copy)`);
  }
  for (const f of Object.keys(now)) if (!(f in lock.files)) problems.push(`${f} is in the bundled copy but not upstream ${lock.version}`);
  return problems;
}

export function readLock(path = LOCK) {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
}

const git = (args, cwd) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${(r.stderr || r.stdout || '').trim()}`);
  return r.stdout.trim();
};

/* Copies <source>/skills/image-deep-research into UFS and writes the lock.
   source is a checkout of the upstream repository. */
export function syncFrom(source, { tag = null, repo = null, root = ROOT } = {}) {
  const from = join(source, 'skills', SKILL_NAME);
  if (!existsSync(join(from, 'SKILL.md'))) throw new Error(`${from} has no SKILL.md - is ${source} an image-deep-research checkout?`);
  const manifest = JSON.parse(readFileSync(join(source, '.claude-plugin', 'plugin.json'), 'utf8'));
  if (manifest.name !== SKILL_NAME) throw new Error(`${source} is the plugin "${manifest.name}", not ${SKILL_NAME}`);
  let commit = null, dirty = false;
  try {
    commit = git(['rev-parse', 'HEAD'], source);
    dirty = git(['status', '--porcelain', '--', 'skills'], source) !== '';
  } catch { /* not a git checkout: recorded as such */ }
  const dest = join(root, 'skills', SKILL_NAME);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(from, dest, { recursive: true });
  const { files, tree } = hashTree(dest);
  const lock = {
    note: 'Written by scripts/sync-image-research.mjs. Do not edit by hand, and do not edit skills/image-deep-research/ by hand: change it upstream, release, then sync.',
    upstream: repo || manifest.repository || DEFAULT_REPO,
    version: manifest.version,
    tag,
    commit,
    dirty,
    tree,
    files,
  };
  writeFileSync(join(root, 'image-deep-research.lock.json'), JSON.stringify(lock, null, 2) + '\n');
  return lock;
}

export function syncTag(tag, { repo = DEFAULT_REPO, root = ROOT } = {}) {
  const work = mkdtempSync(join(tmpdir(), 'ufs-idr-'));
  try {
    git(['clone', '--quiet', '--depth', '1', '--branch', tag, repo, work]);
    // Checked before anything is copied, so a mislabelled tag changes nothing.
    const { version } = JSON.parse(readFileSync(join(work, '.claude-plugin', 'plugin.json'), 'utf8'));
    if (tag.replace(/^v/, '') !== version) throw new Error(`tag ${tag} carries plugin.json version ${version}; refusing to sync it`);
    return syncFrom(work, { tag, repo, root });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function main() {
  const argv = process.argv.slice(2);
  const val = (name) => { const i = argv.indexOf('--' + name); return i === -1 ? undefined : argv[i + 1]; };
  try {
    if (argv.includes('--check')) {
      const problems = drift();
      const lock = readLock();
      if (problems.length) {
        console.error('image-deep-research: the bundled copy does not match the lock');
        for (const p of problems) console.error('  ' + p);
        process.exit(1);
      }
      console.log(`image-deep-research ${lock.version}${lock.tag ? ' (' + lock.tag + ')' : ''} ${lock.commit ? lock.commit.slice(0, 7) : ''}: bundled copy matches the lock, ${Object.keys(lock.files).length} files`);
      return;
    }
    const tag = val('tag'), from = val('from'), repo = val('repo');
    if (!tag === !from) {
      console.error('usage: node scripts/sync-image-research.mjs --tag vX.Y.Z [--repo <git url>] | --from <checkout> | --check');
      process.exit(2);
    }
    const lock = tag ? syncTag(tag, { repo: repo || DEFAULT_REPO }) : syncFrom(resolve(from), { repo });
    console.log(`synced image-deep-research ${lock.version}${lock.tag ? ' (' + lock.tag + ')' : ''} ${lock.commit ? lock.commit.slice(0, 7) : '(not a git checkout)'}${lock.dirty ? ' WITH UNCOMMITTED CHANGES' : ''}`);
    console.log(`  ${Object.keys(lock.files).length} files -> skills/${SKILL_NAME}/, lock -> image-deep-research.lock.json`);
    if (!lock.tag) console.log('  synced from a working tree, not a tag: sync from a released tag before a UFS release');
  } catch (e) {
    console.error('sync-image-research: ' + ((e && e.message) || e));
    process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
