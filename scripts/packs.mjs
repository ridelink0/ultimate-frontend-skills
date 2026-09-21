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
                          on Codex: a [marketplaces.*] + [plugins.*] block in
                          ~/.codex/config.toml, printed for the user

   Every command is spawned with an argv array - never a shell string - and
   printed before it runs. A binary that is not on this machine is never
   spawned: the command (or the Codex TOML) is printed and the report says
   'printed'. No pack is ever reinstalled over one that exists. A plugin-kind
   pack counts as installed when either host has it: Claude Code's
   installed_plugins.json, or an enabled [plugins."<name>@..."] table in the
   Codex config that tools.mjs already reads.

   No dependencies. Node 18+. */

import { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync, cpSync, rmSync, statSync } from 'node:fs';
import { join, dirname, basename, resolve, delimiter } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { codexBench } from './tools.mjs';
import { findClaude } from './claude-cli.mjs';

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

const skillDirs = (cwd, home) => [
  join(home, '.claude', 'skills'),
  join(cwd, '.claude', 'skills'),
  join(home, '.agents', 'skills'),
  join(cwd, '.agents', 'skills'),
];

function skillPresent(name, cwd, home) {
  return skillDirs(cwd, home).some((d) => existsSync(join(d, name, 'SKILL.md')));
}

/* Plugin ids as each host records them: "<name>@<marketplace>". Claude Code
   keeps a JSON registry; Codex keeps enabled = true tables in config.toml,
   which tools.mjs already parses. Read once per status() call. */
function installedPluginIds({ home = homedir() } = {}) {
  const ids = [];
  try {
    const data = JSON.parse(readFileSync(join(home, '.claude', 'plugins', 'installed_plugins.json'), 'utf8'));
    ids.push(...Object.keys(data && data.plugins ? data.plugins : {}));
  } catch { /* no Claude Code registry here */ }
  try { ids.push(...codexBench({ home }).enabled); } catch { /* no Codex config here */ }
  return ids;
}

function pluginPresent(pack, ids) {
  return ids.some((key) => key.split('@')[0] === pack.plugin);
}

/* `home` is injectable so a test can point detection at a directory it built. */
export function status(cwd = process.cwd(), { home = homedir() } = {}) {
  const ids = installedPluginIds({ home });
  return PACKS.map((pack) => {
    if (pack.kind === 'skills') {
      const have = pack.skills.filter((s) => skillPresent(s, cwd, home));
      return { ...pack, installed: have.length === pack.skills.length, partial: have.length > 0 && have.length < pack.skills.length, have };
    }
    return { ...pack, installed: pluginPresent(pack, ids), partial: false, have: [] };
  });
}

/* ------------------------------------------------------------------ host -- */

/* Which installers are actually here. `claude` is found the way tools.mjs
   finds it; `npx` ships beside node, so that directory is searched as well as
   PATH. A Codex host is one with CODEX_HOME set or a ~/.codex/config.toml. */
function onPath(name, { env = process.env, platform = process.platform, exists = existsSync } = {}) {
  const dirs = (env.PATH || env.Path || '').split(platform === 'win32' ? ';' : delimiter).filter(Boolean);
  dirs.push(dirname(process.execPath));
  const names = platform === 'win32' ? [name + '.cmd', name + '.exe', name] : [name];
  return dirs.some((d) => names.some((n) => exists(join(d, n))));
}

export function hostState({ env = process.env, home = homedir(), exists = existsSync } = {}) {
  return {
    claude: !!findClaude({ env, exists }),
    npx: onPath('npx', { env, exists }),
    codex: !!env.CODEX_HOME || exists(join(home, '.codex', 'config.toml')),
  };
}

/* The Codex equivalent of `claude plugin marketplace add` + `claude plugin
   install`: two TOML tables in ~/.codex/config.toml, the same shape the README
   gives for installing this plugin itself. The official marketplace has no
   owner/repo id in the registry; its git source is the repository credits.mjs
   already names for it. */
export function codexToml(pack) {
  const source = pack.marketplace === 'claude-plugins-official'
    ? 'https://github.com/anthropics/claude-plugins-official.git'
    : 'https://github.com/' + pack.marketplace + '.git';
  const key = /^[A-Za-z0-9_-]+$/.test(pack.marketplaceName) ? pack.marketplaceName : JSON.stringify(pack.marketplaceName);
  return ['[marketplaces.' + key + ']', 'source_type = "git"', 'source = "' + source + '"', '',
    '[plugins."' + pack.plugin + '@' + pack.marketplaceName + '"]', 'enabled = true'].join('\n');
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

function run(cmd, args, dry, log = console.log) {
  log('  $ ' + cmd + ' ' + args.join(' '));
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

/* `rows`, `host` and `log` are injectable so a test can drive this against a
   machine it is not running on; the defaults read the real one. */
export function install({ cwd = process.cwd(), only = null, dry = false, upstream = false, project = false, rows = null, host = null, log = console.log } = {}) {
  const report = [];
  const here = host || hostState();
  for (const pack of rows || status(cwd)) {
    if (only && pack.id !== only && pack.plugin !== only) continue;
    if (pack.installed) { report.push({ id: pack.id, action: 'kept', ok: true }); continue; }
    log('\n' + pack.id + '  -  ' + pack.owns);
    let ok = true;
    if (pack.vendored && !upstream && pack.kind === 'skills') {
      // The copy in packs/ is the improved fork; the upstream is one flag away.
      const from = join(ROOT, pack.vendored);
      const dest = project ? join(cwd, '.claude', 'skills') : join(homedir(), '.claude', 'skills');
      for (const skill of pack.skills) {
        const srcDir = join(from, skill);
        log('  copy ' + srcDir + ' -> ' + join(dest, skill));
        if (dry) continue;
        if (!existsSync(srcDir)) { ok = false; log('  missing vendored skill ' + skill); break; }
        mkdirSync(dest, { recursive: true });
        cpSync(srcDir, join(dest, skill), { recursive: true });
      }
      report.push({ id: pack.id, action: dry ? 'would copy vendored' : ok ? 'installed (vendored)' : 'failed', ok });
      continue;
    }
    // A binary that is not here is never spawned. On a Codex host with no
    // claude CLI the plugin installs through config.toml, so that block is
    // what gets printed; otherwise the exact commands, for the user to run.
    const cmds = commandsFor(pack);
    const missing = pack.kind === 'plugin' ? (here.claude ? null : 'claude') : (here.npx ? null : 'npx');
    if (missing) {
      if (missing === 'claude' && here.codex) {
        log('  no claude CLI here. Add this to ~/.codex/config.toml; Codex reads it on its next start:');
        log(codexToml(pack).split('\n').map((l) => (l ? '    ' + l : l)).join('\n'));
      } else {
        log('  ' + missing + ' is not on this machine. ' + (missing === 'claude' ? 'Install Claude Code, then run:' : 'Install Node with npm, then run:'));
        for (const [cmd, args] of cmds) log('  $ ' + cmd + ' ' + args.join(' '));
      }
      report.push({ id: pack.id, action: 'printed', ok: true });
      continue;
    }
    for (const [cmd, args] of cmds) {
      const r = run(cmd, args, dry, log);
      if (!r.ok) { ok = false; log('  failed' + (r.error ? ': ' + r.error : ' (exit ' + r.status + ')')); break; }
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
    const entry = { id: spec.id, kind: 'skills', skills: [...new Set(skills.map((s) => s.name))], owns: '', why: '', licence: detectLicence(dir), added: new Date().toISOString().slice(0, 10) };
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
  if (pack.kind !== 'skills') throw new Error('only skills packs are vendored; a plugin installs through claude plugin, or through ~/.codex/config.toml on Codex');
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
    ? absent + ' absent. `packs --install` gets them; `packs --dry-run` shows the exact commands first. On Codex a plugin is a config.toml block, printed rather than run.'
    : 'Everything recommended is installed.');
  return out.join('\n');
}
