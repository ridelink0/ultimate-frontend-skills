// The slash commands, held to what both hosts actually do with them.
//
// Claude Code: a plugin's commands/<name>.md is /ultimate-frontend-skills:<name>;
// text typed after it is appended as "ARGUMENTS: ..." when the body has no
// placeholder (code.claude.com/docs/en/skills).
//
// Codex: at install it turns each command into a skill named
// source-command-<name> under .codex-plugin/migrated-command-skills/, and
// silently skips a file with no frontmatter description, a body using
// $ARGUMENTS, $<digit>, {{ }}, a shell-run backtick or an @word, a name past
// 64 characters, or a rendered skill past 4,000 bytes. Those rules are copied
// from openai/codex codex-rs/core-plugins/src/command_migration.rs,
// command_migration/render.rs and command_migration/plugin.rs (read
// 2026-09-25); renderCodexSkill below is the same format string.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const dir = join(root, 'commands');
const names = readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)).sort();
const read = (name) => readFileSync(join(dir, name + '.md'), 'utf8');

const ALLOWED_KEYS = new Set(['description', 'argument-hint', 'allowed-tools', 'disable-model-invocation', 'model']);

// A deliberately small YAML reader: one `key: value` per line, a value either
// bare or double-quoted. A command that needs more than that is a command a
// host parser may read differently from this one, so it fails here.
function parse(text) {
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

const slug = (s) => s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'migrated';
const yamlString = (s) => '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
function renderCodexSkill(name, description, body) {
  const skill = slug('source-command-' + name);
  const b = body.trim() || 'No command template body was found.';
  return `---\nname: ${yamlString(skill)}\ndescription: ${yamlString(description)}\n---\n\n# ${skill}\n\nUse this skill when the user asks to run the migrated source command \`${name}\`.\n\n## Command Template\n\n${b}\n`;
}
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

const webdesign = readFileSync(join(root, 'scripts', 'webdesign.mjs'), 'utf8');
const SUBCOMMANDS = new Set([...webdesign.matchAll(/case '([a-z-]+)':/g)].map((m) => m[1]));
const DELEGATED = { blender: 'blender.mjs', assets: 'assets.mjs' };
const SKILLS = readdirSync(join(root, 'skills')).filter((d) => existsSync(join(root, 'skills', d, 'SKILL.md')));

test('there is a command for every capability a user starts directly, and image deep research is the skill of that name', () => {
  for (const n of ['webdesign', 'scaffold-website', 'awards', 'audit-website', 'render-check-website',
    'debug-website', 'verify-website', 'security-check', 'measure-website-performance', 'preview-website', 'inspect-website-styles',
    'design-handoff', 'design-parity-check', 'photo-parallax-layers', 'blender-3d-model', 'pbr-textures-hdri',
    'generate-website-image', 'video-from-references', 'game-start-screen', 'app-screen-design', 'frontend-tools-bench',
    'frontend-skill-packs']) assert.ok(names.includes(n), 'missing command ' + n);
  // /ultimate-frontend-skills:image-deep-research is the bundled skill itself.
  // A command of the same name would be shadowed by it in Claude Code (the
  // skill wins, code.claude.com/docs/en/skills) and duplicated in Codex.
  // test/image-research.test.mjs holds the skill's own description to the
  // search words.
  assert.ok(SKILLS.includes('image-deep-research'), 'the image-deep-research skill is not bundled');
  assert.ok(!names.includes('image-deep-research'), 'a command named image-deep-research would shadow or duplicate the skill');
});

test('every command file parses, with a plain description and an argument hint', () => {
  assert.ok(names.length >= 20, 'found only ' + names.length + ' commands');
  for (const name of names) {
    assert.match(name, /^[a-z0-9]+(-[a-z0-9]+)*$/, 'command file name ' + name);
    const { meta, body } = parse(read(name));
    for (const k of Object.keys(meta)) assert.ok(ALLOWED_KEYS.has(k), name + ': unknown frontmatter key ' + k);
    assert.ok(meta.description && meta.description.length >= 30, name + ': description too thin to search');
    assert.ok(meta.description.length <= 300, name + ': description over 300 characters');
    assert.ok(meta['argument-hint'], name + ': argument-hint missing');
    assert.ok(body.trim().length > 0, name + ': empty body');
    if ('disable-model-invocation' in meta) assert.equal(meta['disable-model-invocation'], 'true', name);
    assert.ok(!SKILLS.includes(name), name + ' collides with a skill of the same name');
    assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(read(name)), name + ': no emoji');
  }
});

test('every command survives the Codex install: migrated, not silently skipped', () => {
  const skillNames = new Set();
  for (const name of names) {
    const { meta, body } = parse(read(name));
    assert.deepEqual(codexSkips(body), [], name + ': Codex would skip this command');
    const skill = slug('source-command-' + name);
    assert.ok(skill.length <= 64, name + ': Codex skill name over 64 characters');
    assert.ok(!skillNames.has(skill), name + ': two commands would migrate to ' + skill);
    skillNames.add(skill);
    // Counted as if checked out with CRLF endings, which Codex keeps byte for
    // byte: a file that fits only with LF would vanish on a Windows clone.
    const bytes = Buffer.byteLength(renderCodexSkill(name, meta.description, body).replace(/\n/g, '\r\n'));
    assert.ok(bytes <= 4000, name + ': the migrated Codex skill is ' + bytes + ' bytes, over 4000');
    if (body.includes('${CLAUDE_PLUGIN_ROOT}')) assert.match(body, /\.codex-plugin\//, name + ': says nothing about the empty plugin root in Codex');
  }
});

test('the Codex skip rules match what Codex skipped on this machine for 6.2.0', () => {
  // 6.2.0's awards, atelier, design-handoff and webdesign used $ARGUMENTS and
  // were missing from ~/.codex/plugins/cache/.../migrated-command-skills.
  assert.deepEqual(codexSkips('Arguments: `$ARGUMENTS`'), ['$ARGUMENTS']);
  assert.deepEqual(codexSkips('run $1 now'), ['a $<digit> placeholder']);
  assert.deepEqual(codexSkips('see @file.md'), ['the token @file.md']);
  assert.deepEqual(codexSkips('node "${CLAUDE_PLUGIN_ROOT}/scripts/webdesign.mjs" audit <dir>'), []);
});

test('every command names a skill or script that exists, and every path and subcommand it runs is real', () => {
  for (const name of names) {
    const text = read(name);
    const namesSkill = SKILLS.some((s) => text.includes('skills/' + s + '/') || text.includes('`' + s + '` skill'));
    const namesScript = /scripts\/[a-z-]+\.mjs/.test(text);
    assert.ok(namesSkill || namesScript, name + ': routes to no skill and no script');
    for (const m of text.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([A-Za-z0-9_.\/-]+)/g)) {
      const rel = m[1].replace(/[.]+$/, '');
      assert.ok(existsSync(join(root, rel)), name + ': ' + rel + ' does not exist');
    }
    for (const m of text.matchAll(/(?:^|[\s`(])(skills\/[A-Za-z0-9_.\/-]+\.md)/g))
      assert.ok(existsSync(join(root, m[1])), name + ': ' + m[1] + ' does not exist');
    for (const m of text.matchAll(/references\/([a-z0-9-]+\.md)/g))
      assert.ok(existsSync(join(root, 'skills', 'ultimate-frontend-skills', 'references', m[1])), name + ': references/' + m[1] + ' does not exist');
    for (const m of text.matchAll(/scripts\/([a-z-]+\.mjs)/g))
      assert.ok(existsSync(join(root, 'scripts', m[1])), name + ': scripts/' + m[1] + ' does not exist');
    for (const m of text.matchAll(/webdesign\.mjs"? ([a-z-]+)(?: ([a-z]+))?/g)) {
      assert.ok(SUBCOMMANDS.has(m[1]), name + ': webdesign.mjs has no subcommand ' + m[1]);
      if (DELEGATED[m[1]] && m[2]) {
        const src = readFileSync(join(root, 'scripts', DELEGATED[m[1]]), 'utf8');
        assert.ok(new RegExp("['\"]" + m[2] + "['\"]").test(src), name + ': ' + m[1] + ' has no subcommand ' + m[2]);
      }
    }
  }
});

test('README lists every command, and AGENTS.md names every command file', () => {
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const agents = readFileSync(join(root, 'AGENTS.md'), 'utf8');
  for (const name of names) {
    assert.ok(readme.includes('`/ultimate-frontend-skills:' + name + '`'), 'README does not list /ultimate-frontend-skills:' + name);
    assert.match(agents, new RegExp('^\\s+' + name + '\\r?$', 'm'), 'AGENTS.md does not list ' + name);
  }
  const listed = [...readme.matchAll(/`\/ultimate-frontend-skills:([a-z0-9-]+)`/g)].map((m) => m[1]);
  for (const n of listed) assert.ok(names.includes(n) || SKILLS.includes(n), 'README lists /ultimate-frontend-skills:' + n + ' but there is no command or skill of that name');
});
