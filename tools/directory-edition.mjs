#!/usr/bin/env node
// Builds the plugin-directory editions of Ultimate Frontend Skills and Usage
// Limits under directory/<name>/. Each edition is Markdown, JSON and PNG only:
// no hooks, no scripts, no package.json, no credential reads. Website files
// that Claude copies into a site (CSS, browser JS, HTML) are carried as
// Markdown, one fenced block per file, and the README says so.
//
//   node tools/directory-edition.mjs            build both
//   node tools/directory-edition.mjs --check    fail if directory/ is stale
//
// Edit the sources (skills/, plugins/usage-limits/, tools/directory-edition/),
// never the generated folders.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HAND = path.join(ROOT, 'tools', 'directory-edition');
const OUT = path.join(ROOT, 'directory');

export const ALLOWED_EXT = new Set(['.md', '.txt', '.json', '.yaml', '.yml', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico']);
const ALLOWED_BARE = new Set(['LICENSE']);
export const MAX_TEXT_BYTES = 256 * 1024;
export const MAX_FILES = 512;

const FULL_ONLY = '> Full edition only: this step runs a script that the directory edition does not ship. Do it by hand from the references, or tell the user it needs the full edition.';
const SCRIPT_CALL = /\$\{?CLAUDE_PLUGIN_ROOT\}?|\bscripts\/[\w.-]+\.(?:mjs|js|sh|py)\b|\b[\w-]+\.mjs\b/;

const readText = (file) => fs.readFileSync(file, 'utf8');

// Turn every fenced block that runs a plugin script into a "full edition only"
// note, and every inline command span into a named, inert reference.
export function inert(md) {
  const lines = md.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const open = lines[i].match(/^(\s*)(`{3,}|~{3,})/);
    if (!open) { out.push(lines[i]); continue; }
    let j = i + 1;
    while (j < lines.length && !lines[j].trimStart().startsWith(open[2])) j++;
    const block = lines.slice(i, j + 1);
    if (SCRIPT_CALL.test(block.slice(1, -1).join('\n'))) out.push(open[1] + FULL_ONLY);
    else out.push(...block);
    i = j;
  }
  // Indented command lines (a four-space code block) that run a script.
  const kept = [];
  for (const line of out) {
    if (/^ {4,}node\s/.test(line) && SCRIPT_CALL.test(line)) {
      if (kept[kept.length - 1] !== FULL_ONLY) kept.push(FULL_ONLY);
      continue;
    }
    if (/^<!--.*\.mjs.*-->$/.test(line.trim())) continue;
    kept.push(line);
  }
  return kept.join('\n')
    .replace(/`([^`\n]*)`/g, (whole, inner) => {
      if (!SCRIPT_CALL.test(inner)) return whole;
      const name = inner
        .replace(/^node\s+/, '')
        .replace(/["']?\$\{?CLAUDE_PLUGIN_ROOT\}?\/?/g, '')
        .replace(/^(?:skills\/[\w-]+\/)?scripts\//, '')
        .replace(/["']/g, '')
        .split(/\s+/).slice(0, 2).join(' ');
      return `\`${name}\` (full edition only)`;
    })
    .replace(/\$\{?CLAUDE_PLUGIN_ROOT\}?/g, 'the plugin folder')
    // Bare mentions outside code spans: name the script as full-edition only.
    .split(/(`[^`\n]*`)/).map((part, i) => i % 2 ? part
      : part.replace(/\b(?:scripts\/)?([\w-]+\.(?:mjs|sh|py))\b/g, 'the full edition\'s $1')).join('');
}

// assets/core.css -> assets/core-css.md (and the same for every converted file).
const assetMd = (rel) => rel.replace(/\.([a-z0-9]+)$/i, '-$1.md');
const FENCE_LANG = { '.css': 'css', '.js': 'js', '.mjs': 'js', '.html': 'html' };

function assetToMarkdown(file, rel) {
  const ext = path.extname(file);
  const body = readText(file);
  const fence = body.includes('```') ? '~~~~' : '```';
  return `# ${path.basename(file)}\n\n` +
    `Copy-in file for the site, not code that runs in Claude. Write the block\n` +
    `below, unchanged, into the site as \`${path.basename(file)}\`.\n\n` +
    `${fence}${FENCE_LANG[ext] || ''}\n${body.replace(/\n$/, '')}\n${fence}\n`;
}

function rewriteAssetPaths(md, converted) {
  let text = md;
  for (const rel of converted) {
    text = text.split(rel).join(assetMd(rel));
  }
  return text;
}

function replaceSection(md, heading, replacement) {
  const start = md.indexOf(`\n## ${heading}\n`);
  if (start < 0) throw new Error(`section "${heading}" not found`);
  const next = md.indexOf('\n## ', start + 4);
  return md.slice(0, start + 1) + replacement.trim() + '\n' + (next < 0 ? '' : md.slice(next));
}

function write(files, rel, content) { files.set(rel, content); }

function copyTree(files, from, to, { skip = () => false, transform } = {}) {
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const rel = path.posix.join(to, entry.name);
    if (skip(entry.name, src)) continue;
    if (entry.isDirectory()) copyTree(files, src, rel, { skip, transform });
    else write(files, rel, transform ? transform(src, rel) : fs.readFileSync(src));
  }
}

function manifest(source, overrides) {
  const full = JSON.parse(readText(source));
  const keep = ['name', 'version', 'author', 'homepage', 'repository', 'license', 'keywords'];
  const out = { $schema: full.$schema };
  for (const key of keep) if (full[key] !== undefined) out[key] = full[key];
  return JSON.stringify({ ...out, ...overrides }, null, 2) + '\n';
}

const SIMPLE_SKILLS = ['claude-dashboards', 'claude-motion', 'deep-research', 'ui-pro-max', 'terminal-ui', 'link-preview', 'remotion-video', 'sound-design'];
const LOCAL_EDITS = {
  'terminal-ui': [[/From the full UFS plugin, run `[^`]+`( \(full edition only\))? for a portable\noutput reference\./, 'The full UFS edition has a portable output reference script; it is not in\nthis edition.']],
  'link-preview': [[/`image-deep-research`/, '`image-deep-research` (full edition)']],
  'remotion-video': [[/An original, rendered reference ships in \[assets\/example\/README\.md\]\(assets\/example\/README\.md\)\.\nCopy the example outside the plugin before installing its optional dependencies\.\n?/, 'The rendered reference example ships with the full edition only.\n']],
};

export function buildUfs() {
  const files = new Map();
  const skillSrc = path.join(ROOT, 'skills', 'ultimate-frontend-skills');
  const converted = fs.readdirSync(path.join(skillSrc, 'assets')).map((n) => `assets/${n}`);

  let entry = readText(path.join(skillSrc, 'SKILL.md'));
  entry = entry.replace(/, a section library, a scaffolder, an audit, a video renderer and editing tools\./, ' and a section library, as Markdown and JSON (directory edition: no scripts).');
  if (!entry.includes('(directory edition: no scripts)')) throw new Error('entry description not rewritten');
  entry = replaceSection(entry, 'Where the scripts are', readText(path.join(HAND, 'ufs', 'this-edition.md')));
  entry = replaceSection(entry, 'Build', readText(path.join(HAND, 'ufs', 'build.md')));
  entry = replaceSection(entry, 'Before you call it done', readText(path.join(HAND, 'ufs', 'checks.md')));
  entry = inert(rewriteAssetPaths(entry, converted));
  write(files, 'skills/ultimate-frontend-skills/SKILL.md', entry);

  for (const rel of converted) {
    write(files, `skills/ultimate-frontend-skills/${assetMd(rel)}`, assetToMarkdown(path.join(skillSrc, rel), rel));
  }
  copyTree(files, path.join(skillSrc, 'references'), 'skills/ultimate-frontend-skills/references', {
    // Anthropic Software Directory Policy 4B: no AI image generation guidance in this edition.
    skip: (name) => name === 'image-gen.md',
    transform: (src) => src.endsWith('.md') ? inert(rewriteAssetPaths(readText(src), converted)) : fs.readFileSync(src),
  });
  copyTree(files, path.join(skillSrc, 'data'), 'skills/ultimate-frontend-skills/data');

  for (const name of SIMPLE_SKILLS) {
    const dir = path.join(ROOT, 'skills', name);
    const assets = fs.existsSync(path.join(dir, 'assets'))
      ? fs.readdirSync(path.join(dir, 'assets'), { withFileTypes: true }).filter((e) => e.isFile()).map((e) => `assets/${e.name}`)
      : [];
    const md = (src) => {
      let text = inert(rewriteAssetPaths(readText(src), assets));
      for (const [from, to] of LOCAL_EDITS[name] || []) text = text.replace(from, to);
      return text;
    };
    write(files, `skills/${name}/SKILL.md`, md(path.join(dir, 'SKILL.md')));
    if (fs.existsSync(path.join(dir, 'references'))) {
      copyTree(files, path.join(dir, 'references'), `skills/${name}/references`, { transform: (src) => md(src) });
    }
    for (const rel of assets) write(files, `skills/${name}/${assetMd(rel)}`, assetToMarkdown(path.join(dir, rel), rel));
  }

  copyTree(files, path.join(HAND, 'ufs', 'commands'), 'commands');
  write(files, 'README.md', readText(path.join(HAND, 'ufs', 'README.md')));
  write(files, 'PRIVACY.md', readText(path.join(HAND, 'ufs', 'PRIVACY.md')));
  for (const [rel, body] of files) {
    if (rel.endsWith('.md') && typeof body === 'string' && body.includes('image-gen.md')) {
      files.set(rel, body.replace(/`?(?:references\/)?image-gen\.md`?/g, "the full edition's image-generation reference (not in this edition)"));
    }
  }
  write(files, 'LICENSE', readText(path.join(ROOT, 'LICENSE')));
  write(files, 'icon.png', fs.readFileSync(path.join(ROOT, '.claude-plugin', 'icon.png')));
  write(files, '.claude-plugin/plugin.json', manifest(path.join(ROOT, '.claude-plugin', 'plugin.json'), {
    description: 'Ultimate Frontend Skills, directory edition. Build cinematic, editorial websites, app screens and game start screens the way an award-winning studio does: a pinned art direction, a corpus of award-winning reference sites to decide against, and a copy-in CSS chassis, motion runtime and section library that Claude writes into the site. Markdown and JSON only: no hooks, no scripts. The full edition, with the scaffolder, audit, render check and verify, is on GitHub.',
    homepage: 'https://github.com/ridelink0/ultimate-frontend-skills/tree/master/directory/ultimate-frontend-skills',
    keywords: JSON.parse(readText(path.join(ROOT, '.claude-plugin', 'plugin.json'))).keywords.filter((k) => k !== 'image generation'),
    icon: './icon.png',
  }));
  return files;
}

export function buildUsageLimits() {
  const files = new Map();
  const src = path.join(ROOT, 'plugins', 'usage-limits');
  const hand = path.join(HAND, 'usage-limits');
  write(files, 'skills/usage-limits/SKILL.md', readText(path.join(hand, 'SKILL.md')));
  for (const ref of ['tactics.md', 'token-efficient.md']) {
    let text = readText(path.join(src, 'skills', 'usage-limits', 'references', ref));
    text = inert(text)
      .replace(/seven rules in `thrift\.js` \(full edition only\) to that prompt/, 'seven rules to that prompt')
      .replace(/`usage\.js --recommend` \(full edition only\) prices/, 'The full edition prices');
    write(files, `skills/usage-limits/references/${ref}`, text);
  }
  copyTree(files, path.join(hand, 'commands'), 'commands');
  write(files, 'README.md', readText(path.join(hand, 'README.md')));
  write(files, 'PRIVACY.md', readText(path.join(hand, 'PRIVACY.md')));
  write(files, 'LICENSE', readText(path.join(src, 'LICENSE')));
  write(files, 'icon.png', fs.readFileSync(path.join(src, '.claude-plugin', 'icon.png')));
  write(files, '.claude-plugin/plugin.json', manifest(path.join(src, '.claude-plugin', 'plugin.json'), {
    description: 'Usage Limits, directory edition. Plan Claude Code work to fit inside the 5-hour and weekly usage limits: size a job in turns, say whether it fits before starting, order the work so a cutoff costs little, and work cheaply when the budget is tight. Markdown only: no hooks, no scripts, no credential reads. The full edition, with live readings and the cost of each reply, is on GitHub.',
    homepage: 'https://github.com/ridelink0/claude-code-usage-limits',
    icon: './icon.png',
  }));
  return files;
}

// The directory's file rules, as far as they can be checked here.
export function problems(files) {
  const found = [];
  if (files.size > MAX_FILES) found.push(`${files.size} files (limit ${MAX_FILES})`);
  for (const [rel, content] of files) {
    const base = path.posix.basename(rel);
    const ext = path.posix.extname(rel).toLowerCase();
    if (!ALLOWED_EXT.has(ext) && !ALLOWED_BARE.has(base)) found.push(`${rel}: file type not allowed`);
    if (/^(AGENTS|CLAUDE)\.md$/i.test(base)) found.push(`${rel}: not allowed in a directory edition`);
    if (/(^|\/)(hooks|scripts|\.codex-plugin|\.mcp\.json|package(-lock)?\.json)/.test(rel)) found.push(`${rel}: not allowed in a directory edition`);
    if (rel.includes('.claude-plugin/') && rel !== '.claude-plugin/plugin.json') found.push(`${rel}: extra .claude-plugin file`);
    const buf = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const binary = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico'].includes(ext);
    if (!binary) {
      if (buf.length > MAX_TEXT_BYTES) found.push(`${rel}: ${buf.length} bytes (limit ${MAX_TEXT_BYTES})`);
      const text = buf.toString('utf8');
      if (Buffer.from(text, 'utf8').compare(buf) !== 0) found.push(`${rel}: not UTF-8`);
      if (text.startsWith('#!')) found.push(`${rel}: starts with #!`);
      if (ext === '.md') {
        const front = text.match(/^---\n([\s\S]*?)\n---/);
        const tools = front && front[1].match(/^allowed-tools:\s*(.*)$/m);
        if (tools) {
          const extra = tools[1].split(/[,\s]+/).filter(Boolean).filter((t) => !['Read', 'Grep', 'Glob', 'LS'].includes(t));
          if (extra.length) found.push(`${rel}: allowed-tools ${extra.join(', ')}`);
        }
        const body = text.replace(/^(\s*)(`{3,}|~{3,})[\s\S]*?^\1\2/gm, '');
        if (!rel.includes('/assets/') && SCRIPT_CALL.test(body.replace(/`[^`\n]*` \(full edition only\)/g, '').replace(/the full edition's [\w.-]+/g, ''))) {
          found.push(`${rel}: still points at a plugin script`);
        }
      }
    }
  }
  return found;
}

function emit(name, files, check) {
  const dir = path.join(OUT, name);
  if (check) {
    const stale = [];
    for (const [rel, content] of files) {
      const p = path.join(dir, rel);
      if (!fs.existsSync(p) || Buffer.compare(fs.readFileSync(p), Buffer.isBuffer(content) ? content : Buffer.from(content))) stale.push(rel);
    }
    return stale;
  }
  fs.rmSync(dir, { recursive: true, force: true });
  for (const [rel, content] of files) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
  return [];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  let failed = false;
  for (const [name, build] of [['ultimate-frontend-skills', buildUfs], ['usage-limits', buildUsageLimits]]) {
    const files = build();
    const bad = problems(files);
    for (const p of bad) console.error(`${name}: ${p}`);
    const stale = emit(name, files, check);
    for (const s of stale) console.error(`${name}: ${s} is stale; run node tools/directory-edition.mjs`);
    if (bad.length || stale.length) failed = true;
    else console.log(`${name}: ${files.size} files ${check ? 'up to date' : `written to directory/${name}`}`);
  }
  process.exit(failed ? 1 : 0);
}
