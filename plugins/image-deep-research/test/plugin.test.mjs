// The plugin as the hosts read it: the three manifests, the skill's
// frontmatter under Claude Code's and Codex's rules, the commands under the
// Codex command migration, and every path the skill and commands point at.
//
// Codex rules, read from openai/codex on 2026-09-25:
//   codex-rs/skills/src/parser.rs - SKILL.md name at most 64 characters,
//   description at most 1024; unknown frontmatter keys are ignored.
//   codex-rs/core-plugins/src/command_migration*.rs - a commands/*.md becomes
//   the skill source-command-<name>, and is silently skipped when it has no
//   description, uses $ARGUMENTS, $<digit>, {{ }}, a shell-run backtick or an
//   @word, or renders past 4,000 bytes.
// Claude Code (code.claude.com/docs/en/skills): when a skill and a command
// share a name the skill wins, so a same-named command would be dead weight.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(join(root, p), 'utf8');
const json = (p) => JSON.parse(read(p));

function frontmatter(text) {
  const src = text.replace(/\r\n/g, '\n');
  assert.ok(src.startsWith('---\n'), 'frontmatter must open on the first line');
  const end = src.indexOf('\n---\n', 3);
  assert.ok(end > 0, 'frontmatter must close with a --- line');
  const meta = {};
  for (const line of src.slice(4, end).split('\n')) {
    if (!line.trim()) continue;
    const m = /^([a-z-]+):\s*(.*)$/.exec(line);
    assert.ok(m, 'unreadable frontmatter line: ' + line);
    let value = m[2].trim();
    if (value.startsWith('"')) value = JSON.parse(value);
    else assert.ok(!/^['[{>|&*!%@`]/.test(value) && !/: | #/.test(value), 'value needs double quotes: ' + line);
    assert.ok(!(m[1] in meta), 'duplicate key ' + m[1]);
    meta[m[1]] = value;
  }
  return { meta, body: src.slice(end + 5) };
}

const SKILL_DIR = 'skills/image-deep-research';
const skill = frontmatter(read(SKILL_DIR + '/SKILL.md'));
const commands = readdirSync(join(root, 'commands')).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)).sort();

test('the three manifests agree on name, version, author and repository', () => {
  const plugin = json('.claude-plugin/plugin.json');
  const market = json('.claude-plugin/marketplace.json');
  const codex = json('.codex-plugin/plugin.json');
  const pkg = json('package.json');
  assert.equal(plugin.name, 'image-deep-research');
  for (const m of [market.plugins[0], codex, pkg]) assert.equal(m.name, plugin.name);
  assert.equal(market.name, plugin.name);
  assert.match(plugin.version, /^\d+\.\d+\.\d+$/);
  for (const v of [market.plugins[0].version, codex.version, pkg.version]) assert.equal(v, plugin.version);
  assert.equal(plugin.author.name, 'Gev');
  assert.equal(plugin.author.url, 'https://github.com/ridelink0');
  assert.equal(codex.author.name, 'Gev');
  assert.equal(market.owner.name, 'Gev');
  assert.equal(market.plugins[0].source, './');
  assert.equal(plugin.repository, 'https://github.com/ridelink0/image-deep-research');
  assert.equal(codex.skills, './skills/');
  assert.equal(plugin.license, 'MIT');
  assert.ok(existsSync(join(root, 'LICENSE')));
});

test('findable: the words image and deep research are in the names, descriptions and keywords', () => {
  const plugin = json('.claude-plugin/plugin.json');
  const codex = json('.codex-plugin/plugin.json');
  for (const d of [plugin.description, codex.description, skill.meta.description, json('.claude-plugin/marketplace.json').plugins[0].description]) {
    const l = d.toLowerCase();
    for (const w of ['image', 'deep research', 'visual research', 'moodboard', 'references']) assert.ok(l.includes(w), `"${w}" missing from: ${d.slice(0, 60)}...`);
  }
  for (const k of ['image research', 'deep research', 'moodboard', 'reference images']) assert.ok(plugin.keywords.includes(k), 'keyword ' + k);
  assert.deepEqual(codex.keywords, plugin.keywords);
});

test('the skill frontmatter fits both hosts', () => {
  assert.equal(skill.meta.name, 'image-deep-research');
  assert.ok(skill.meta.name.length <= 64);
  assert.ok(skill.meta.description.length <= 1024, 'Codex refuses a description over 1024 characters');
  assert.ok(skill.meta['argument-hint']);
  for (const k of Object.keys(skill.meta)) assert.ok(['name', 'description', 'argument-hint'].includes(k), 'unexpected key ' + k);
});

// 1.1.0 added --compact to step 3 of the loop. The description is what every
// session pays for, so it stays byte for byte as 1.0.1 shipped it, and the
// body grows by at most 600 bytes over 1.0.1's 5,935.
test('skill budget: the 1.0.1 description, and at most 600 more bytes of body', () => {
  const V101 = { description: '949cd63e1543cff193c4d3ae9a766700501f680bc0f88cc6e0d67e0f81e53e55', body: 5935 };
  assert.equal(createHash('sha256').update(skill.meta.description).digest('hex'), V101.description, 'the SKILL.md description changed');
  const body = Buffer.byteLength(skill.body);
  assert.ok(body <= V101.body + 600, `the SKILL.md body is ${body} bytes, ${body - V101.body} over 1.0.1`);
  assert.match(skill.body, /--compact/);
  assert.match(skill.body, /--pick/);
});

test('the skill works standalone: every script it runs ships in its own folder', () => {
  const text = read(SKILL_DIR + '/SKILL.md');
  const used = [...text.matchAll(/\$\{CLAUDE_SKILL_DIR\}\/([A-Za-z0-9_.\/-]+)/g)].map((m) => m[1]);
  assert.ok(used.includes('scripts/study.mjs') && used.includes('scripts/images.mjs'));
  for (const rel of used) assert.ok(existsSync(join(root, SKILL_DIR, rel)), rel + ' is not in the skill folder');
  // Anything under the plugin root is optional (the Ultimate Frontend Skills
  // corpus) and the skill must say what to do when it is missing.
  const rooted = [...text.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([A-Za-z0-9_.\/-]+)/g)].map((m) => m[1]);
  for (const rel of rooted) assert.equal(rel, 'scripts/webdesign.mjs', 'the skill depends on ' + rel + ' outside its own folder');
  if (rooted.length) assert.match(text, /When that file is not there/);
  assert.match(text, /In Codex/);
});

test('the scripts import only Node built-ins and each other', () => {
  const dir = join(root, SKILL_DIR, 'scripts');
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.mjs'))) {
    const src = readFileSync(join(dir, f), 'utf8');
    for (const m of src.matchAll(/(?:^|\n)\s*import\s[^'"]*['"]([^'"]+)['"]|import\(['"]([^'"]+)['"]\)/g)) {
      const spec = m[1] || m[2];
      assert.ok(spec.startsWith('node:') || (spec.startsWith('./') && existsSync(join(dir, spec))), `${f} imports ${spec}`);
    }
  }
});

function codexSkips(body) {
  const why = [];
  if (body.includes('$ARGUMENTS')) why.push('$ARGUMENTS');
  if (/\$\d/.test(body)) why.push('a $<digit> placeholder');
  if (body.includes('{{') && body.includes('}}')) why.push('{{ }}');
  if (body.includes('!`') || body.includes('! `')) why.push('a shell-run backtick');
  const at = body.split(/\s+/).find((t) => t.startsWith('@') && t.length > 1);
  if (at) why.push('the token ' + at);
  return why;
}
const slug = (s) => s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'migrated';
const yamlString = (s) => '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
const renderCodexSkill = (name, description, body) => {
  const s = slug('source-command-' + name);
  return `---\nname: ${yamlString(s)}\ndescription: ${yamlString(description)}\n---\n\n# ${s}\n\nUse this skill when the user asks to run the migrated source command \`${name}\`.\n\n## Command Template\n\n${body.trim() || 'No command template body was found.'}\n`;
};

test('every command parses, survives the Codex migration, and does not shadow the skill', () => {
  assert.ok(commands.length >= 1);
  for (const name of commands) {
    const text = read('commands/' + name + '.md');
    const { meta, body } = frontmatter(text);
    for (const k of Object.keys(meta)) assert.ok(['description', 'argument-hint', 'disable-model-invocation', 'allowed-tools'].includes(k), name + ': key ' + k);
    assert.ok(meta.description && meta.description.length >= 30 && meta.description.length <= 300, name + ': description');
    assert.ok(meta['argument-hint'], name + ': argument-hint');
    assert.notEqual(name, skill.meta.name, 'a command named like the skill is shadowed by it in Claude Code');
    assert.deepEqual(codexSkips(body), [], name + ': Codex would skip this command');
    const bytes = Buffer.byteLength(renderCodexSkill(name, meta.description, body).replace(/\n/g, '\r\n'));
    assert.ok(bytes <= 4000, name + ': migrated Codex skill is ' + bytes + ' bytes');
    if (body.includes('${CLAUDE_PLUGIN_ROOT}')) assert.match(body, /\.codex-plugin\//, name + ': no note on the empty plugin root in Codex');
    for (const m of text.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([A-Za-z0-9_.\/-]+)/g))
      assert.ok(existsSync(join(root, m[1].replace(/[.]+$/, ''))), name + ': ' + m[1] + ' does not exist');
    assert.match(text, /skills\/image-deep-research\/SKILL\.md/, name + ': does not route through the skill');
  }
  assert.deepEqual(codexSkips('run `$ARGUMENTS`'), ['$ARGUMENTS']);
  assert.deepEqual(codexSkips('see @file.md'), ['the token @file.md']);
});

test('README: install lines for both hosts, every command, and credits', () => {
  const readme = read('README.md');
  assert.match(readme, /\/plugin marketplace add ridelink0\/image-deep-research/);
  assert.match(readme, /\/plugin install image-deep-research@image-deep-research/);
  assert.match(readme, /codex plugin marketplace add ridelink0\/image-deep-research/);
  for (const name of commands) assert.ok(readme.includes('/image-deep-research:' + name), 'README misses ' + name);
  assert.match(readme, /## Credits/);
  assert.match(readme, /Ultimate Frontend Skills/);
});

test('no emoji anywhere in the repository text', () => {
  const skip = new Set(['.git', 'node_modules']);
  const walk = (d) => readdirSync(d).flatMap((f) => {
    if (skip.has(f)) return [];
    const p = join(d, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
  const files = walk(root).filter((p) => /\.(md|mjs|js|json|yml|yaml|txt)$/.test(p) || /LICENSE$/.test(p));
  assert.ok(files.length > 10);
  for (const p of files) assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}]/u.test(readFileSync(p, 'utf8')), relative(root, p) + ' contains an emoji');
});
