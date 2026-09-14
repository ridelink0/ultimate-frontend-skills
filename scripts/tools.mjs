#!/usr/bin/env node
/* ultimate-frontend-skills/tools - what else is on this bench?

   Stage 1 of the pipeline. It answers one question: which of the other tools
   on this machine change how this build should go. Run it once per project,
   not once per page.

   Everything here is a report. Nothing is installed, enabled, registered or
   changed, and nothing is a prerequisite: absent is a normal result that moves
   the route, not a failure that stops the build. The one rule the printed
   output keeps repeating is the one that matters most - a missing tool is
   never a reason to interrupt a build and tell the user to go and install
   something.

   node tools.mjs [detect] [--json] [--no-probe] [--port 8188]
   node tools.mjs mcp                 the live MCP picture, via `claude mcp list`

   Secrets: this reads config files that can hold API keys next to the parts it
   wants. It carries out NAMES ONLY - plugin ids, skill ids, marketplace names,
   MCP server names - and never a value from an env, header or token field.
   Node builtins only. Node 18+. */

import { existsSync, readFileSync, readdirSync, lstatSync } from 'node:fs';
import { join, resolve, dirname, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { request } from 'node:http';
import { parseArgs } from './args.mjs';
import { findClaude, runClaude } from './claude-cli.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/* This plugin has shipped under two ids - the repo was renamed - and the older
   one is installed on the machine that develops it. A detector that does not
   know that reports its own copy as a rival website plugin and then defers to
   itself. Match on the plugin id, and treat both spellings as self. */
export const SELF = ['ultimate-frontend-skills', 'ultimate-website-skills'];

/* One line each on what this plugin does DIFFERENTLY because the thing is
   there. Not a description of the other tool - a change to this build. A
   plugin with no entry here gets no line, because most plugins change nothing
   about a website and saying so at length is noise. `absent` rows are printed
   only for the ids that carry one, so the output says what was looked for. */
export const NOTES = {
  'frontend-design': {
    role: 'direction',
    live: 'It owns aesthetic direction on new UI: palette, type faces and scale intent, hero form, copy voice.\n'
      + 'This plugin supplies the chassis, the runtimes, the section library, the imagery and 3D route, and every check.\n'
      + 'Do not open with a house preset, do not restate the house palette, and demote the italic-accent count and any\n'
      + 'cream-ground finding to notes - those two calls belong to the direction layer now.',
    absent: 'The house style stands in, silently. Do not mention it, and do not suggest installing anything.',
  },
  superpowers: {
    role: 'process',
    live: 'brainstorming before a brief that does not pin the subject; writing-plans for a multi-page site;\n'
      + 'verification-before-completion before any "done" - run `webdesign verify` and quote its verdict rather than narrating it.',
  },
  'computer-use': {
    role: 'hands',
    live: 'Only for what a headless browser cannot reach: a desktop app, a login-walled page, a real browser being watched.\n'
      + 'For a page built here, look / debug / quality / parity are cheaper and repeatable. Run it on a separate desktop.',
  },
  ecc: {
    role: 'engineering',
    live: 'Brings a chrome-devtools MCP server. Use it after `quality` says a page is slow and you need to see why -\n'
      + 'live DOM, network waterfall, CPU trace. It is not a design tool and will not help the look.',
  },
  'video-watch': {
    role: 'references',
    live: 'A reference that is a screen recording becomes frames. Use it instead of describing motion from one still.',
  },
  'web-designer': {
    role: 'overlap',
    live: 'A third catalogue of the same AI tells, after this plugin\'s tells.md and frontend-design\'s clusters. Read ONE.\n'
      + 'Its font-pairing formulas name Fontshare faces (Satoshi, Clash Display, General Sans, Cabinet Grotesk) with no\n'
      + '@font-face rule, so a page built from them falls back silently. Take its pre-code brief and its "do not converge"\n'
      + 'rule; leave its type scale, which duplicates core.css at different numbers.',
  },
  'skill-creator': { role: 'other', live: 'For building a skill or an eval, not a site. Nothing changes here.' },
  'claude-md-management': { role: 'other', live: 'Nothing changes for a website build.' },
  'usage-limits': { role: 'other', live: 'Budget only. It does not touch the design; it can tell you whether the build fits before a reset.' },
};

/* Skills that live outside any plugin still change the build, so they get the
   same treatment. Keyed by skill directory name. */
export const SKILL_NOTES = {
  'visual-research': 'When the question is what something looks like in the wild. Pairs with `study` at stage 2.',
  dataviz: 'Read it BEFORE the first line of chart code and before choosing chart colours - any chart, stat tile or KPI row.',
};

const readJson = (file) => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } };
const nameOf = (id) => String(id).split('@')[0];

/* ------------------------------------------------------- Claude Code ----- */

/* The v2 file keys an ARRAY off each id - one entry per scope - and the last
   entry is the effective one. Two traps live in here and both are real on this
   machine: `version` is sometimes a content hash rather than a semver, and it
   can disagree with the version segment of installPath (the field wins for
   display, the path wins for anything that reads files). Never scan the cache
   directory instead: it keeps orphaned siblings, and a scan reports ten
   plugins that are not installed. */
export function claudePlugins({ home = homedir(), exists = existsSync } = {}) {
  const file = join(home, '.claude', 'plugins', 'installed_plugins.json');
  const data = readJson(file);
  if (!data || !data.plugins) return { file, schema: data ? data.version : null, plugins: [] };
  const plugins = [];
  for (const [id, entries] of Object.entries(data.plugins)) {
    const entry = Array.isArray(entries) ? entries[entries.length - 1] : entries;
    if (!entry) continue;
    plugins.push({
      id,
      name: nameOf(id),
      marketplace: String(id).split('@')[1] || null,
      scope: entry.scope || null,
      version: entry.version || null,
      dir: entry.installPath || null,
      onDisk: Boolean(entry.installPath && exists(entry.installPath)),
    });
  }
  return { file, schema: data.version || null, plugins };
}

/* Four settings files, in precedence order, and only one key is read out of
   any of them. A missing entry means enabled; only an explicit false disables.
   UNVERIFIED: whether `claude plugin disable` writes false or deletes the key -
   nothing is disabled on the machine this was written on, so the rule is read
   off the shape of the file rather than off a disable run. Either way an
   installed-but-disabled plugin must count as ABSENT, or the handshake defers
   to something that is not running. */
export function enabledPlugins({ home = homedir(), cwd = process.cwd() } = {}) {
  const merged = {};
  const files = [
    join(home, '.claude', 'settings.json'),
    join(home, '.claude', 'settings.local.json'),
    join(cwd, '.claude', 'settings.json'),
    join(cwd, '.claude', 'settings.local.json'),
  ];
  const seen = [];
  for (const file of files) {
    const data = readJson(file);
    if (!data) continue;
    seen.push(file);
    if (data.enabledPlugins && typeof data.enabledPlugins === 'object') {
      for (const [id, on] of Object.entries(data.enabledPlugins)) merged[id] = on !== false;
    }
  }
  return { files: seen, map: merged };
}

/* A symlinked skill is a directory that reports isDirectory() === false. One
   is installed on this machine. Detect on the SKILL.md, never on the dirent. */
export function skillsIn(root, { exists = existsSync } = {}) {
  let names = [];
  try { names = readdirSync(root); } catch { return []; }
  const out = [];
  for (const name of names) {
    const dir = join(root, name);
    if (!exists(join(dir, 'SKILL.md'))) continue;       // no SKILL.md, no skill
    let link = false;
    try { link = lstatSync(dir).isSymbolicLink(); } catch { /* unreadable is not fatal */ }
    out.push({ name, dir, link });
  }
  return out;
}

/* ------------------------------------------------------------- Codex ----- */

/* Codex keeps no installed_plugins.json. Enablement is TOML tables in
   config.toml, and the same file holds MCP servers whose tables can carry
   auth. So this scanner is deliberately blunt: it returns TABLE NAMES and the
   single literal marker `enabled = true`, and has no path by which any other
   value leaves the file. Parsed with string methods, not a regex, so it
   survives being pasted through a heredoc. */
export function codexBench({ home = homedir() } = {}) {
  const config = join(home, '.codex', 'config.toml');
  const cacheDir = join(home, '.codex', 'plugins', 'cache');
  const out = {
    config: existsSync(config) ? config : null,
    cache: existsSync(cacheDir) ? cacheDir : null,
    enabled: [],
    marketplaces: [],
    mcpServers: [],
  };
  if (!out.config) return out;
  let text = '';
  try { text = String(readFileSync(config, 'utf8')); } catch { return out; }
  let current = null;
  for (const raw of text.split(String.fromCharCode(10))) {
    const line = raw.trim();
    if (line.startsWith('[plugins."') && line.endsWith('"]')) { current = line.slice('[plugins."'.length, -2); continue; }
    if (line.startsWith('[marketplaces.') && line.endsWith(']')) {
      out.marketplaces.push(line.slice('[marketplaces.'.length, -1).replace(/^["']|["']$/g, ''));
      current = null; continue;
    }
    if (line.startsWith('[mcp_servers.') && line.endsWith(']')) {
      // A server's own sub-tables are where the auth lives: [mcp_servers.x.env]
      // is one real table on this machine. Keep the first segment only, so the
      // list is servers rather than servers plus the name of their env block.
      const rest = line.slice('[mcp_servers.'.length, -1);
      const quoted = rest.startsWith('"') || rest.startsWith("'");
      const name = quoted
        ? rest.slice(1, rest.indexOf(rest[0], 1) > 0 ? rest.indexOf(rest[0], 1) : undefined)
        : rest.split('.')[0];
      if (name && !out.mcpServers.includes(name)) out.mcpServers.push(name);
      current = null; continue;
    }
    if (line.startsWith('[')) { current = null; continue; }
    if (current && line.split(' ').join('') === 'enabled=true') { out.enabled.push(current); current = null; }
  }
  return out;
}

/* --------------------------------------------------------------- MCP ----- */

/* Plugin-provided servers arrive in three shapes and all three are live on
   this machine: a path string in the manifest, an inline object, and an EMPTY
   manifest object beside a root .mcp.json that the host still honours. Reading
   only the manifest misses the third. Names only - an env block under any of
   these can hold a key, and nothing here reads one. */
export function mcpNames({ home = homedir(), cwd = process.cwd(), plugins = [] } = {}) {
  const found = [];
  const add = (name, from) => { if (name && !found.some((s) => s.name === name && s.from === from)) found.push({ name, from }); };

  for (const plugin of plugins) {
    if (!plugin.onDisk || !plugin.dir) continue;
    const manifest = readJson(join(plugin.dir, '.claude-plugin', 'plugin.json')) || {};
    let names = [];
    const declared = manifest.mcpServers;
    if (declared && typeof declared === 'object') names = Object.keys(declared);
    if (typeof declared === 'string') {
      const file = readJson(resolve(plugin.dir, declared));
      if (file && file.mcpServers) names = Object.keys(file.mcpServers);
    }
    if (!names.length) {
      const file = readJson(join(plugin.dir, '.mcp.json'));
      if (file && file.mcpServers) names = Object.keys(file.mcpServers);
    }
    for (const name of names) add(name, plugin.name);
  }
  for (const file of [join(cwd, '.mcp.json'), join(home, '.mcp.json')]) {
    const data = readJson(file);
    if (data && data.mcpServers) for (const name of Object.keys(data.mcpServers)) add(name, file === join(cwd, '.mcp.json') ? 'project' : 'user');
  }
  return found;
}

/* The claude.ai connectors are not in any file - only a stale "ever connected"
   display-name list, which carries no auth state and is not worth reporting as
   if it were the present. `claude mcp list` is the only local route to the
   live picture, and it health-checks every server over the network, so it is
   its own subcommand rather than something `detect` does to you. */
/* `claude mcp list` prints each server's command line and URL, and a command
   line is a place people put a key. Everything else in this file reads names
   only; this is the one path that carries text out of the host, so it is
   masked on the way through. Over-masking a URL is cheap; printing one token
   is not. */
export function scrubSecrets(text) {
  return String(text)
    .replace(/((?:api[-_]?key|access[-_]?token|auth[-_]?token|token|secret|password|passwd|pwd)\s*[=:]\s*)(["']?)([^\s"'&]{6,})/gi, '$1$2<redacted>')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]{8,}=*/gi, 'Bearer <redacted>')
    .replace(/\b(sk-[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/g, '<redacted>');
}

export function liveMcp({ cli = findClaude(), run = runClaude } = {}) {
  if (!cli) return { available: false, reason: 'the Claude Code CLI was not found on PATH' };
  let result;
  try { result = run(cli, ['mcp', 'list'], { timeout: 40000 }); }
  catch (err) { return { available: false, reason: err.message }; }
  if (!result || result.status !== 0) {
    return { available: false, reason: (result && String(result.stderr || '').trim()) || 'claude mcp list failed' };
  }
  return { available: true, text: scrubSecrets(String(result.stdout || '')) };
}

/* --------------------------------------------------- Blender, Python ----- */

function onPath(binary, { env = process.env, platform = process.platform } = {}) {
  const dirs = String(env.PATH || env.Path || '').split(platform === 'win32' ? ';' : delimiter).filter(Boolean);
  const names = platform === 'win32' ? [binary + '.exe', binary + '.bat', binary + '.cmd'] : [binary];
  for (const dir of dirs) for (const name of names) {
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/* Stage 4's modelling route. blender.mjs owns the real probe; if it is in this
   install, ask it rather than keeping two searches that can disagree. Its
   output shape is not fixed yet, so this reads it forgivingly and falls back
   to its own search on anything unexpected - which is also what runs today,
   since blender.mjs is not part of this install. */
export function findBlender({ env = process.env, platform = process.platform, probe = true } = {}) {
  const helper = join(HERE, 'blender.mjs');
  if (probe && existsSync(helper)) {
    const run = spawnSync(process.execPath, [helper, 'probe', '--json'],
      { encoding: 'utf8', shell: false, windowsHide: true, timeout: 20000 });
    if (run.status === 0) {
      let data = null;
      try { data = JSON.parse(String(run.stdout || '')); } catch { data = null; }
      const exe = data && (data.exe || data.path || data.blender || (data.found && data.found.exe));
      if (typeof exe === 'string' && exe) {
        const version = data.version || (data.found && data.found.version) || null;
        return { found: true, exe, version: version ? String(version) : null, via: 'blender.mjs probe' };
      }
      if (data && data.found === false) return { found: false, via: 'blender.mjs probe', searched: [helper] };
    }
  }

  const searched = [];
  const candidates = [];
  if (env.BLENDER) candidates.push(env.BLENDER);
  const path = onPath('blender', { env, platform });
  if (path) candidates.push(path);
  if (platform === 'win32') {
    const programs = env['ProgramFiles'] || 'C:\\Program Files';
    const programsX86 = env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const roots = [
      join(programs, 'Blender Foundation'),
      join(programsX86, 'Blender Foundation'),
      join(programsX86, 'Steam', 'steamapps', 'common'),
      // Store and winget installs land under LOCALAPPDATA; skip when it is
      // unset rather than searching a relative path off the cwd.
      env.LOCALAPPDATA ? join(env.LOCALAPPDATA, 'Programs', 'Blender Foundation') : null,
      env.LOCALAPPDATA ? join(env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Packages') : null,
    ].filter(Boolean);
    for (const root of roots) {
      searched.push(root);
      if (!existsSync(root)) continue;
      let children = [];
      try { children = readdirSync(root); } catch { continue; }
      for (const child of children.filter((c) => /blender/i.test(c))) {
        for (const exe of [join(root, child, 'blender.exe'), join(root, child, 'blender', 'blender.exe')]) {
          if (existsSync(exe)) candidates.push(exe);
        }
      }
    }
  } else if (platform === 'darwin') {
    for (const exe of ['/Applications/Blender.app/Contents/MacOS/Blender',
      join(env.HOME || '', 'Applications', 'Blender.app', 'Contents', 'MacOS', 'Blender')]) {
      searched.push(exe);
      if (existsSync(exe)) candidates.push(exe);
    }
  } else {
    for (const exe of ['/usr/bin/blender', '/usr/local/bin/blender', '/snap/bin/blender']) {
      searched.push(exe);
      if (existsSync(exe)) candidates.push(exe);
    }
  }

  const exe = candidates.find(Boolean);
  if (!exe) return { found: false, via: 'search', searched };
  let version = null;
  if (probe) {
    const run = spawnSync(exe, ['--version'], { encoding: 'utf8', shell: false, windowsHide: true, timeout: 20000 });
    const first = String((run && run.stdout) || '').split(String.fromCharCode(10))[0].trim();
    if (first) version = first;
  }
  return { found: true, exe, version, via: 'search' };
}

/* `cut` shells out to python in this order, so this reports the interpreter
   that command would actually get, not whichever one is nicest. rembg is
   checked with find_spec rather than an import: importing it loads
   onnxruntime and turns a bench check into a several-second wait. */
export function findPython({ probe = true } = {}) {
  const order = ['python', 'python3', 'py'];
  if (!probe) return { found: null, rembg: null, tried: order, probed: false };
  for (const binary of order) {
    const run = spawnSync(binary, ['--version'], { encoding: 'utf8', shell: false, windowsHide: true, timeout: 15000 });
    if (run.error || run.status !== 0) continue;
    const version = (String(run.stdout || '') + String(run.stderr || '')).trim().split(String.fromCharCode(10))[0];
    const check = spawnSync(binary, ['-c', 'import importlib.util as u;print(1 if u.find_spec("rembg") else 0)'],
      { encoding: 'utf8', shell: false, windowsHide: true, timeout: 20000 });
    const rembg = String(check.stdout || '').trim() === '1';
    return { found: binary, version: version || null, rembg, tried: order, probed: true };
  }
  return { found: null, rembg: false, tried: order, probed: true };
}

/* A local generator is a port that answers, nothing more. The response shape
   is NOT asserted here: a field literally named comfyui_version is reported if
   it is there, and its absence is reported as "responding" rather than guessed
   at. Short timeout - this runs at the top of every project. */
export function probeComfy(port = 8188, { host = '127.0.0.1', timeout = 700 } = {}) {
  return new Promise((done) => {
    const req = request({ host, port, path: '/system_stats', method: 'GET', timeout }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { if (body.length < 65536) body += chunk; });
      res.on('end', () => {
        let version = null;
        try {
          const data = JSON.parse(body);
          const system = (data && data.system) || data || {};
          if (system && typeof system.comfyui_version === 'string') version = system.comfyui_version;
        } catch { /* answering with something unparseable is still answering */ }
        done({ found: true, port, version, status: res.statusCode });
      });
    });
    req.on('timeout', () => { req.destroy(); done({ found: false, port }); });
    req.on('error', () => done({ found: false, port }));
    req.end();
  });
}

/* -------------------------------------------------------------- detect --- */

export async function detectBench({ home = homedir(), cwd = process.cwd(), probe = true, port = 8188 } = {}) {
  const installed = claudePlugins({ home });
  const enabled = enabledPlugins({ home, cwd });
  const plugins = installed.plugins.map((plugin) => {
    const self = SELF.includes(plugin.name);
    const on = enabled.map[plugin.id] !== false;
    return {
      ...plugin,
      self,
      enabled: on,
      // Installed but disabled, or installed and gone from disk, both count as
      // absent. Deferring to something that is not running is worse than not
      // deferring at all.
      live: on && plugin.onDisk,
      note: NOTES[plugin.name] || null,
    };
  });

  const direction = plugins.find((plugin) => plugin.name === 'frontend-design') || null;

  const root = resolve(HERE, '..');
  const bench = {
    cwd,
    self: { root, ids: SELF, localSkills: skillsIn(join(root, 'skills')).map((skill) => skill.name) },
    direction: {
      owner: direction && direction.live ? 'frontend-design' : 'this plugin (house style)',
      frontendDesign: direction
        ? { state: direction.live ? 'live' : (direction.enabled ? 'installed, missing on disk' : 'installed, disabled'), version: direction.version }
        : { state: 'absent', version: null },
    },
    plugins,
    skills: {
      personal: skillsIn(join(home, '.claude', 'skills')),
      project: skillsIn(join(cwd, '.claude', 'skills')),
    },
    codex: codexBench({ home }),
    mcp: mcpNames({ home, cwd, plugins }),
    blender: findBlender({ probe }),
    python: findPython({ probe }),
    comfy: probe ? await probeComfy(port) : { found: null, port, probed: false },
    sources: { installed: installed.file, schema: installed.schema, settings: enabled.files },
    probed: probe,
  };
  return bench;
}

/* -------------------------------------------------------------- format --- */

const pad = (text, width) => String(text) + ' '.repeat(Math.max(0, width - String(text).length));
const indent = (text, prefix) => String(text).split(String.fromCharCode(10)).map((line) => prefix + line).join(String.fromCharCode(10));

export function formatBench(bench) {
  const out = [];
  const line = (text = '') => out.push(text);

  line('');
  line('The bench  ' + bench.cwd);
  line('');

  /* Direction first, because it is the only row that changes what gets
     designed rather than what gets used. */
  const fd = bench.direction.frontendDesign;
  line('  direction');
  line('    frontend-design            ' + pad(fd.state, 30) + (fd.version || ''));
  line(indent(fd.state === 'live' ? NOTES['frontend-design'].live : NOTES['frontend-design'].absent, '      '));
  line('');

  const others = bench.plugins.filter((plugin) => plugin.name !== 'frontend-design');
  line('  plugins (Claude Code)  ' + bench.plugins.filter((p) => p.live).length + ' live of ' + bench.plugins.length + ' installed');
  for (const plugin of others) {
    const state = plugin.self ? 'this plugin' : plugin.live ? 'live' : plugin.enabled ? 'missing on disk' : 'disabled';
    line('    ' + pad(plugin.name, 27) + pad(state, 30) + (plugin.version || ''));
    if (plugin.self) line('      Same lineage as this install, under its published id. Not a rival; do not defer to it.');
    else if (plugin.live && plugin.note) line(indent(plugin.note.live, '      '));
  }
  // Named because it overlaps hard enough to matter, and silence about
  // something you looked for reads the same as not having looked.
  for (const name of ['web-designer']) {
    if (!bench.plugins.some((plugin) => plugin.name === name)) {
      line('    ' + pad(name, 27) + pad('absent', 30));
    }
  }
  line('');

  const skillRow = (skill) => {
    const note = SKILL_NOTES[skill.name];
    line('    ' + pad(skill.name, 27) + pad(skill.link ? 'live (symlink)' : 'live', 30));
    if (note) line('      ' + note);
  };
  line('  skills outside plugins');
  if (!bench.skills.personal.length && !bench.skills.project.length) line('    none');
  for (const skill of bench.skills.personal) skillRow(skill);
  for (const skill of bench.skills.project) skillRow(skill);
  if (bench.self.localSkills.length) line('    (this repo ships: ' + bench.self.localSkills.join(', ') + ')');
  line('');

  line('  codex');
  if (!bench.codex.config) line('    absent          no ~/.codex/config.toml. Nothing changes; this plugin ships to both hosts regardless.');
  else {
    line('    config          ' + bench.codex.config);
    line('    plugins         ' + bench.codex.enabled.length + ' enabled'
      + (bench.codex.enabled.some((id) => id.startsWith('frontend-design')) ? ', frontend-design among them' : ''));
    line('    marketplaces    ' + (bench.codex.marketplaces.join(', ') || 'none'));
    if (bench.codex.mcpServers.length) line('    mcp servers     ' + bench.codex.mcpServers.join(', ') + '  (names only)');
  }
  line('');

  line('  mcp servers visible from disk');
  if (!bench.mcp.length) line('    none');
  for (const server of bench.mcp) line('    ' + pad(server.name, 27) + 'from ' + server.from);
  line('    The claude.ai connectors are in no file. `node tools.mjs mcp` asks the host - it health-checks every');
  line('    server over the network and takes fifteen to twenty seconds, so it is not on this path.');
  line('');

  line('  assets and 3D');
  const blender = bench.blender;
  line('    ' + pad('blender', 27) + pad(blender.found ? 'found' : 'absent', 30) + (blender.version || ''));
  line(blender.found
    ? '      ' + blender.exe + '\n      Stage 4 can model, bake and render. Still prefer procedural three.js when the object is simple.'
    : '      No modelling route at stage 4. Author the geometry in three.js instead - which is the right answer for most\n'
      + '      pages anyway - or use a rendered sequence. Do not tell the user to install Blender mid-build.');
  const python = bench.python;
  line('    ' + pad('python', 27) + pad(python.found ? 'found (' + python.found + ')' : python.probed === false ? 'not probed' : 'absent', 30)
    + (python.version || ''));
  line('    ' + pad('rembg', 27) + pad(python.rembg ? 'installed' : python.probed === false ? 'not probed' : 'absent', 30));
  // Not probed is not the same answer as absent, and printing the absent
  // advice for an unknown is how a route gets closed that was never checked.
  line(python.probed === false
    ? '      Not checked (--no-probe). Run without the flag before deciding stage 4 has no cut-out route.'
    : python.rembg
      ? '      `cut` works: one photograph becomes subject, background and mask - the three planes depth.js parallaxes.'
      : '      No local cut-out. Build depth from real layered elements, or a photograph plus type plus a gradient plane.');
  const comfy = bench.comfy;
  line('    ' + pad('comfyui (local)', 27) + pad(comfy.found ? 'responding on :' + comfy.port : comfy.probed === false ? 'not probed' : 'absent', 30)
    + (comfy.version || ''));
  line(comfy.probed === false
    ? '      Not checked (--no-probe).'
    : comfy.found
      ? '      A local generator is available for imagery. Generated photography still needs the imagery.md treatment.'
      : '      No local generator on :' + comfy.port + '. Use real photography, CC0 sources, or an attached image MCP server.');
  line('');

  line('  Nothing here is a prerequisite. Absent is a normal result: it changes the route, not the outcome, and it is');
  line('  never a reason to stop a build and ask the user to install something. Names only were read out of the config');
  line('  files above - no key, token or header value is read or printed by this command.');
  return out.map((text) => String(text).replace(/\s+$/, '')).join(String.fromCharCode(10));
}

/* ----------------------------------------------------------------- CLI --- */

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let parsed;
  try { parsed = parseArgs(process.argv.slice(1)); }
  catch (err) { console.error('ultimate-frontend-skills: ' + err.message); process.exit(1); }

  const command = parsed.positional[0] || 'detect';

  if (command === 'mcp') {
    const result = liveMcp();
    if (parsed.flag('json')) console.log(JSON.stringify(result, null, 2));
    else if (!result.available) {
      console.log('\n  claude mcp list could not run: ' + result.reason);
      console.log('  Everything else is still readable - run `tools` for the file-based picture.');
    } else {
      console.log('\nMCP servers the host reports (connectors included)\n');
      console.log(result.text.trimEnd());
      console.log('\n  Rows marked as needing authentication are not usable until the user authorises them.');
      console.log('  Do not plan a route through one without saying so first.');
    }
    process.exit(0);
  }

  if (command !== 'detect' && command !== 'bench') {
    console.error('ultimate-frontend-skills: unknown command "' + command + '"');
    console.error('Usage: node tools.mjs [detect] [--json] [--no-probe] [--port 8188]\n       node tools.mjs mcp');
    process.exit(1);
  }

  const port = Number(parsed.flag('port', 8188));
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error('ultimate-frontend-skills: --port must be a port number');
    process.exit(1);
  }

  const bench = await detectBench({ probe: !parsed.flag('no-probe'), port });
  if (parsed.flag('json')) console.log(JSON.stringify(bench, null, 2));
  else console.log(formatBench(bench));
  process.exit(0);
}
