/* ultimate-frontend-skills - the packs this plugin works alongside, and how
   to get them.

   `tools` says what is installed. This is the other half: what is worth
   installing, whether it is here, and - with --install - actually getting it.
   A pack is the author's, installed at the user's scope through the tool the
   author documents, and updated there - unless it has been vendored: then the
   copy under packs/ is the improved fork, its UFS-NOTES.md lists every change,
   and install copies it in when the pack is absent.

     packs                          the list, with installed / absent for each
     packs --install                install every absent recommended pack
     packs --install --only <id>    just one
     packs --dry-run                print the exact commands and run nothing
     packs add <owner/repo>         register a pack from its repo (reads its skills, licence, sha)
     packs remove <id>              take one out of the registry
     packs vendor <id>              copy a registered pack into packs/ to improve and install offline
     packs --install --upstream     the author's copy even where a vendored one exists

   Two kinds of pack, two installers:
     skills packs         npx skills add <owner/repo>   -> ./.claude/skills or ~/.claude/skills
     Claude Code plugins  claude plugin ...             -> the plugin cache

   Every command is spawned with an argv array - never a shell string - and
   printed before it runs. No pack is ever reinstalled over one that exists.

   No dependencies. Node 18+. */

import { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync, cpSync, rmSync, statSync } from 'node:fs';
import { join, dirname, basename, resolve } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/* The recommendations live in data/packs.json so that adding one is a data
   change, made by `packs add <owner/repo>`, not an edit to this file. `skills`
   is the directory name each installs as, which is how presence is detected;
   `owns` is the one line the model reads; `vendored` names a copy under
   packs/ that `install` uses instead of the network when the pack is absent. */
const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, '..');
export const PACKS_FILE = join(ROOT, 'skills', 'ultimate-frontend-skills', 'data', 'packs.json');
export const VENDOR_DIR = join(ROOT, 'packs');

export function loadPacks() {
  try { return JSON.parse(readFileSync(PACKS_FILE, 'utf8')); } catch { return []; }
}
export function savePacks(list) {
  writeFileSync(PACKS_FILE, JSON.stringify(list, null, 2) + '\n');
}
export const PACKS = loadPacks();

/* ------------------------------------------------------------ detection -- */

const skillDirs = (cwd) => [
  join(homedir(), '.claude', 'skills'),
  join(cwd, '.claude', 'skills'),
  join(homedir(), '.agents', 'skills'),
  join(cwd, '.agents', 'skills'),
];

function skillPresent(name, cwd) {
  return skillDirs(cwd).some((d) => existsSync(join(d, name, 'SKILL.md')));
}

function pluginPresent(pack) {
  const file = join(homedir(), '.claude', 'plugins', 'installed_plugins.json');
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    const plugins = data && data.plugins ? data.plugins : {};
    return Object.keys(plugins).some((key) => key.split('@')[0] === pack.plugin);
  } catch {
    return false;
  }
}

export function status(cwd = process.cwd()) {
  return PACKS.map((pack) => {
    if (pack.kind === 'skills') {
      const have = pack.skills.filter((s) => skillPresent(s, cwd));
      return { ...pack, installed: have.length === pack.skills.length, partial: have.length > 0 && have.length < pack.skills.length, have };
    }
    return { ...pack, installed: pluginPresent(pack), partial: false, have: [] };
  });
}

/* --------------------------------------------------------------- install -- */

function commandsFor(pack) {
  if (pack.kind === 'skills') {
    // --all: every skill in the repo, every detected agent, no prompts. The
    // trailing -y answers the scope prompt: project-level inside a project,
    // global otherwise. Run it from a project to install for that project.
    return [['npx', ['-y', 'skills@latest', 'add', pack.id, '--all', '-y']]];
  }
  const cmds = [];
  if (pack.marketplace && pack.marketplace !== 'claude-plugins-official') {
    cmds.push(['claude', ['plugin', 'marketplace', 'add', pack.marketplace]]);
  }
  cmds.push(['claude', ['plugin', 'install', pack.plugin + '@' + pack.marketplaceName]]);
  return cmds;
}

function run(cmd, args, dry) {
  console.log('  $ ' + cmd + ' ' + args.join(' '));
  if (dry) return { ok: true, dry: true };
  // npx and claude are .cmd shims on Windows and need a shell to launch; the
  // arguments stay an array, so nothing the user typed is ever interpolated.
  const shim = process.platform === 'win32' && (cmd === 'npx' || cmd === 'claude');
  const res = spawnSync(shim ? cmd + '.cmd' : cmd, args, {
    stdio: 'inherit',
    windowsHide: true,
    shell: shim,
    timeout: 5 * 60 * 1000,
  });
  return { ok: res.status === 0, status: res.status, error: res.error && res.error.message };
}

export function install({ cwd = process.cwd(), only = null, dry = false, upstream = false, project = false } = {}) {
  const report = [];
  for (const pack of status(cwd)) {
    if (only && pack.id !== only && pack.plugin !== only) continue;
    if (pack.installed) { report.push({ id: pack.id, action: 'kept', ok: true }); continue; }
    console.log('\n' + pack.id + '  -  ' + pack.owns);
    let ok = true;
    if (pack.vendored && !upstream && pack.kind === 'skills') {
      // The copy in packs/ is the improved fork; the upstream is one flag away.
      const from = join(ROOT, pack.vendored);
      const dest = project ? join(cwd, '.claude', 'skills') : join(homedir(), '.claude', 'skills');
      for (const skill of pack.skills) {
        const srcDir = join(from, skill);
        console.log('  copy ' + srcDir + ' -> ' + join(dest, skill));
        if (dry) continue;
        if (!existsSync(srcDir)) { ok = false; console.log('  missing vendored skill ' + skill); break; }
        mkdirSync(dest, { recursive: true });
        cpSync(srcDir, join(dest, skill), { recursive: true });
      }
      report.push({ id: pack.id, action: dry ? 'would copy vendored' : ok ? 'installed (vendored)' : 'failed', ok });
      continue;
    }
    for (const [cmd, args] of commandsFor(pack)) {
      const r = run(cmd, args, dry);
      if (!r.ok) { ok = false; console.log('  failed' + (r.error ? ': ' + r.error : ' (exit ' + r.status + ')')); break; }
    }
    report.push({ id: pack.id, action: dry ? 'would install' : ok ? 'installed' : 'failed', ok });
  }
  return report;
}


/* ------------------------------------------------------------- add / vendor -- */

/* owner/repo, a GitHub URL, or a local directory. */
export function parseSpec(spec) {
  const s = String(spec || '').trim().replace(/\/+$/, '');
  if (!s) throw new Error('packs add needs <owner/repo>, a GitHub URL or a local path');
  if (existsSync(s) && statSync(s).isDirectory()) return { local: resolve(s), id: basename(resolve(s)) };
  const m = s.match(/^(?:https?:\/\/github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
  if (!m) throw new Error('could not read an owner/repo out of ' + JSON.stringify(spec));
  return { owner: m[1], repo: m[2], id: m[1] + '/' + m[2], url: 'https://github.com/' + m[1] + '/' + m[2] + '.git' };
}

function clone(spec, log = console.log) {
  if (spec.local) return { dir: spec.local, cleanup: () => {} };
  const dir = join(tmpdir(), 'ufs-pack-' + spec.repo + '-' + process.pid);
  rmSync(dir, { recursive: true, force: true });
  log('  $ git clone --depth 1 ' + spec.url);
  const r = spawnSync('git', ['-c', 'core.longpaths=true', 'clone', '--depth', '1', '--quiet', spec.url, dir], { stdio: 'pipe', windowsHide: true, timeout: 120000 });
  if (r.status !== 0) throw new Error('git clone failed: ' + String(r.stderr || r.error || '').trim());
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function gitSha(dir) {
  const r = spawnSync('git', ['-C', dir, 'rev-parse', '--short', 'HEAD'], { stdio: 'pipe', windowsHide: true });
  return r.status === 0 ? String(r.stdout).trim() : null;
}

/* Every SKILL.md up to three levels down, skipping dependencies and history. */
export function findSkills(dir) {
  const found = [];
  const walk = (d, depth) => {
    let entries = [];
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = join(d, e.name);
      let isDir = e.isDirectory();
      if (!isDir && e.isSymbolicLink()) { try { isDir = statSync(p).isDirectory(); } catch { isDir = false; } }
      if (!isDir) continue;
      if (existsSync(join(p, 'SKILL.md'))) found.push({ name: e.name, dir: p, description: skillDescription(join(p, 'SKILL.md')) });
      else if (depth < 3) walk(p, depth + 1);
    }
  };
  walk(dir, 0);
  return found;
}

function skillDescription(file) {
  try {
    const head = readFileSync(file, 'utf8').slice(0, 4000);
    const m = head.match(/^description:\s*(.+)$/m);
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
  } catch { return ''; }
}

/* An SPDX id guessed from the licence file's own words; 'none' when there is no file. */
export function detectLicence(dir) {
  let names = [];
  try { names = readdirSync(dir).filter((n) => /^(licen[cs]e|copying)/i.test(n)); } catch { return 'none'; }
  if (!names.length) return 'none';
  const text = readFileSync(join(dir, names[0]), 'utf8').slice(0, 3000);
  if (/MIT License/i.test(text) || /Permission is hereby granted, free of charge/i.test(text)) return 'MIT';
  if (/Apache License/i.test(text)) return 'Apache-2.0';
  if (/CC0/i.test(text)) return 'CC0-1.0';
  if (/This is free and unencumbered software/i.test(text)) return 'Unlicense';
  if (/Redistribution and use in source and binary forms/i.test(text)) return /neither the name/i.test(text) ? 'BSD-3-Clause' : 'BSD-2-Clause';
  if (/Mozilla Public License/i.test(text)) return 'MPL-2.0';
  if (/GNU GENERAL PUBLIC LICENSE/i.test(text)) return /Version 3/i.test(text) ? 'GPL-3.0' : 'GPL-2.0';
  if (/Creative Commons/i.test(text)) return 'CC-BY';
  return 'other';
}
export const VENDORABLE = new Set(['MIT', 'Apache-2.0', 'CC0-1.0', 'Unlicense', 'BSD-2-Clause', 'BSD-3-Clause', 'MPL-2.0']);

/* Add a pack to the registry from its repo. Reads what it ships; never installs it. */
export function add(specText, { owns = null, why = null, dry = false, log = console.log } = {}) {
  const spec = parseSpec(specText);
  const list = loadPacks();
  if (list.some((p) => p.id === spec.id)) throw new Error(spec.id + ' is already in the registry (packs remove ' + spec.id + ' first)');
  const { dir, cleanup } = clone(spec, log);
  try {
    const skills = findSkills(dir);
    const manifest = join(dir, '.claude-plugin', 'plugin.json');
    const entry = { id: spec.id, kind: 'skills', skills: skills.map((s) => s.name), owns: '', why: '', licence: detectLicence(dir), added: new Date().toISOString().slice(0, 10) };
    if (existsSync(manifest)) {
      const pj = JSON.parse(readFileSync(manifest, 'utf8'));
      entry.kind = 'plugin';
      entry.plugin = pj.name;
      entry.marketplace = spec.id;
      const mp = join(dir, '.claude-plugin', 'marketplace.json');
      entry.marketplaceName = existsSync(mp) ? (JSON.parse(readFileSync(mp, 'utf8')).name || spec.id) : spec.id;
      entry.owns = owns || pj.description || '';
    } else {
      if (!skills.length) throw new Error('no SKILL.md and no .claude-plugin/plugin.json found in ' + spec.id);
      entry.owns = owns || skills[0].description || '';
    }
    entry.why = why || ('Added with packs add on ' + entry.added + '. ' + (entry.kind === 'skills' ? skills.length + ' skill(s): ' + skills.map((s) => s.name).join(', ') : 'plugin ' + entry.plugin) + '.');
    entry.sha = gitSha(dir);
    if (!dry) { list.push(entry); savePacks(list); }
    return { entry, skills, row: '| `' + spec.id + '` | ' + (entry.owns || '') + ' | ' + entry.licence + ' |' };
  } finally { cleanup(); }
}

export function remove(id) {
  const list = loadPacks();
  const keep = list.filter((p) => p.id !== id);
  if (keep.length === list.length) throw new Error(id + ' is not in the registry');
  savePacks(keep);
  return list.find((p) => p.id === id);
}

/* Copy a registered pack's skills, licence and README into packs/<name>/, so
   the copy can be improved here and installed offline. Refuses licences that
   do not permit redistribution unless forced, and always keeps the licence
   file beside the copy. */
export function vendor(id, { force = false, log = console.log } = {}) {
  const list = loadPacks();
  const pack = list.find((p) => p.id === id);
  if (!pack) throw new Error(id + ' is not in the registry; packs add it first');
  if (pack.kind !== 'skills') throw new Error('only skills packs are vendored; a plugin installs through claude plugin');
  const spec = parseSpec(id);
  const { dir, cleanup } = clone(spec, log);
  try {
    const licence = detectLicence(dir);
    if (!VENDORABLE.has(licence) && !force) throw new Error(id + ' is ' + licence + ', which does not clearly permit a redistributed copy; keep the handshake, or --force if you have checked');
    const name = id.replace(/[^\w.-]+/g, '-');
    const dest = join(VENDOR_DIR, name);
    rmSync(dest, { recursive: true, force: true });
    mkdirSync(dest, { recursive: true });
    const skills = findSkills(dir).filter((s) => pack.skills.includes(s.name));
    for (const s of skills) cpSync(s.dir, join(dest, s.name), { recursive: true });
    for (const n of readdirSync(dir)) if (/^(licen[cs]e|copying|readme)/i.test(n)) cpSync(join(dir, n), join(dest, n));
    const sha = gitSha(dir);
    const notes = ['# ' + id + ' - vendored copy', '',
      'Upstream: https://github.com/' + id + (sha ? ' at ' + sha : ''), 'Licence: ' + licence + ' (file kept beside this note)',
      'Copied: ' + new Date().toISOString().slice(0, 10), 'Skills: ' + skills.map((s) => s.name).join(', '), '',
      'This is the copy packs --install uses when the pack is absent; --upstream installs the original instead.',
      'Everything changed from upstream is listed below so the author can take it back or ask for it out.', '', '## Improvements', '', '- (none yet)', ''].join('\n');
    writeFileSync(join(dest, 'UFS-NOTES.md'), notes);
    pack.vendored = 'packs/' + name;
    pack.licence = licence;
    pack.sha = sha;
    savePacks(list);
    return { dest, skills: skills.map((s) => s.name), licence, sha };
  } finally { cleanup(); }
}

/* ---------------------------------------------------------------- format -- */

export function format(rows) {
  const out = ['', 'Packs this plugin works alongside', ''];
  for (const p of rows) {
    const state = (p.installed ? 'installed' : p.partial ? 'partial (' + p.have.join(', ') + ')' : 'absent') + (p.vendored ? ' (vendored)' : '');
    out.push('  ' + p.id.padEnd(40) + state);
    out.push('      ' + p.owns);
    out.push('      ' + p.why);
  }
  const absent = rows.filter((p) => !p.installed).length;
  out.push('');
  out.push(absent
    ? absent + ' absent. `packs --install` gets them; `packs --dry-run` shows the exact commands first.'
    : 'Everything recommended is installed.');
  return out.join('\n');
}
