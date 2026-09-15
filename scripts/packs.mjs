/* ultimate-frontend-skills - the packs this plugin works alongside, and how
   to get them.

   `tools` says what is installed. This is the other half: what is worth
   installing, whether it is here, and - with --install - actually getting it.
   Nothing is bundled into this repo: each pack is the author's, installed at
   the user's scope through the tool the author documents, and updated there.
   A copy in this repo would drift the day after it was made.

     packs                          the list, with installed / absent for each
     packs --install                install every absent recommended pack
     packs --install --only <id>    just one
     packs --dry-run                print the exact commands and run nothing

   Two kinds of pack, two installers:
     skills packs         npx skills add <owner/repo>   -> ./.claude/skills or ~/.claude/skills
     Claude Code plugins  claude plugin ...             -> the plugin cache

   Every command is spawned with an argv array - never a shell string - and
   printed before it runs. No pack is ever reinstalled over one that exists.

   No dependencies. Node 18+. */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';

/* The recommendations. `skills` is the directory name each installs as, which
   is how presence is detected; `owns` is the one line the model reads. */
export const PACKS = [
  {
    id: 'emilkowalski/skills',
    kind: 'skills',
    skills: ['animate', 'review-animations', 'find-animation-opportunities', 'animation-vocabulary', 'apple-design', 'pick-ui-library', 'prototype', 'emil-design-eng'],
    owns: 'UI component motion and the verdict on it. Emil Kowalski, MIT.',
    why: 'The first pack to install. animate owns dropdowns, toasts, modals and button presses; this plugin owns the page. references/skill-packs.md draws the line.',
  },
  {
    id: 'frontend-design@claude-plugins-official',
    kind: 'plugin',
    marketplace: 'claude-plugins-official',
    marketplaceName: 'claude-plugins-official',
    plugin: 'frontend-design',
    owns: 'Aesthetic direction at the start of new UI. Anthropic, official.',
    why: 'When it is present it owns palette, type intent and hero form; this plugin supplies chassis, motion, 3D and verification. The seam is silent either way.',
  },
  {
    id: 'MickeyAlton33/web-designer-plugin',
    kind: 'plugin',
    marketplace: 'MickeyAlton33/web-designer-plugin',
    // The marketplace's own name and the plugin's own name, read from the
    // repo's .claude-plugin/marketplace.json - neither is the repo name, and
    // deriving them from it installed nothing.
    marketplaceName: 'web-designer-marketplace',
    plugin: 'web-designer',
    owns: 'Award-winning site references as a way of teaching a model what good looks like. 48 patterns from 38 sites, March 2026.',
    why: 'The idea this plugin\'s 388-entry corpus grew from. Credited in the README; worth having beside it.',
  },
  {
    id: 'vercel-labs/agent-skills',
    kind: 'skills',
    skills: ['web-design-guidelines'],
    owns: 'A broad web-design review checklist. The most-installed design skill in the ecosystem.',
    why: 'A second reviewer. Where it and references/tells.md disagree on taste, tells.md is the more specific document.',
  },
  {
    id: 'addyosmani/web-quality-skills',
    kind: 'skills',
    skills: ['accessibility'],
    owns: 'Accessibility review from the Chrome team\'s side.',
    why: 'Run it on forms and navigation beside references/craft.md.',
  },
  {
    id: 'ibelick/ui-skills',
    kind: 'skills',
    skills: ['fixing-accessibility'],
    owns: 'Fixing accessibility defects, not just finding them.',
    why: 'Hand off component-pattern fixes; keep landmark and contrast fixes here.',
  },
  {
    id: 'cloudai-x/threejs-skills',
    kind: 'skills',
    skills: ['threejs-fundamentals', 'threejs-geometry', 'threejs-shaders', 'threejs-animation', 'threejs-materials', 'threejs-lighting', 'threejs-loaders', 'threejs-textures', 'threejs-postprocessing', 'threejs-interaction'],
    owns: 'three.js as a general subject.',
    why: 'references/three.md is narrower and deeper on the scroll-driven product page; this covers everything outside that.',
  },
];

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

export function install({ cwd = process.cwd(), only = null, dry = false } = {}) {
  const report = [];
  for (const pack of status(cwd)) {
    if (only && pack.id !== only && pack.plugin !== only) continue;
    if (pack.installed) { report.push({ id: pack.id, action: 'kept', ok: true }); continue; }
    console.log('\n' + pack.id + '  -  ' + pack.owns);
    let ok = true;
    for (const [cmd, args] of commandsFor(pack)) {
      const r = run(cmd, args, dry);
      if (!r.ok) { ok = false; console.log('  failed' + (r.error ? ': ' + r.error : ' (exit ' + r.status + ')')); break; }
    }
    report.push({ id: pack.id, action: dry ? 'would install' : ok ? 'installed' : 'failed', ok });
  }
  return report;
}

/* ---------------------------------------------------------------- format -- */

export function format(rows) {
  const out = ['', 'Packs this plugin works alongside', ''];
  for (const p of rows) {
    const state = p.installed ? 'installed' : p.partial ? 'partial (' + p.have.join(', ') + ')' : 'absent';
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
