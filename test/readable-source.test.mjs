// The Claude directory clears a plugin only when every shipped file is readable
// source. This audits the exact file list `npm pack --dry-run` gives for each of
// the three packages, then runs the gate on a fixture of opaque files: each kind
// must be refused, by the files walk and by the npm pack audit alike, and the
// readable look-alikes beside them must pass.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditDistribution, auditPack, PACKAGES } from '../scripts/distribution.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// Images are the one non-text payload allowed. Each was opened by hand; a new
// one fails here until someone looks at it and lists it.
const IMAGES = {
  '.': ['.claude-plugin/icon.png', 'plugins/image-deep-research/.claude-plugin/icon.png'],
  'plugins/usage-limits': [],
  'plugins/image-deep-research': ['.claude-plugin/icon.png'],
};

for (const pkg of PACKAGES) {
  test('npm pack of ' + pkg + ' ships only readable source', () => {
    const report = auditPack(join(root, pkg));
    assert.deepEqual(report.errors, []);
    assert.ok(report.packed > 10, 'npm pack listed the package');
    assert.equal(report.files.length, report.packed, 'every packed file was audited');
    const images = report.files.map(f => f.path).filter(p => /\.(?:png|jpe?g|gif|webp|ico)$/i.test(p)).sort();
    assert.deepEqual(images, [...IMAGES[pkg]].sort(), 'an image was added to or removed from the pack');
  });
}

// A payload wrapped as an encoder writes it, 64 characters to a line.
const wrap = (s) => s.match(/.{1,64}/g).join('\n');
// Three backticks, spelled so this file can sit inside a fenced block.
const FENCE = '`'.repeat(3);

test('the gate refuses every kind of opaque file and passes readable look-alikes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ufs-readable-'));
  const opaque = {
    'dist/app.min.js': 'export const a = 1;\n',
    'dist/one-line.js': 'var a = ' + '1 + '.repeat(700) + '1;\n',
    'dist/dense.js': 'a=b+c;'.repeat(100) + '\n',
    'dist/webpack.js': 'var m = __webpack_require__(42);\n',
    'dist/mapped.js': 'export const a = 1;\n//# sourceMappingURL=mapped.js.map\n',
    'notes/blob.md': 'Payload: ' + 'QUJD'.repeat(300) + '\n',
    'lib/module.dat': Buffer.from('0061736d01000000', 'hex'),
    'lib/tool': Buffer.concat([Buffer.from('7f454c4602010100', 'hex'), Buffer.alloc(8)]),
    'lib/archive.txt': Buffer.from('504b0304140000000800', 'hex'),
    'lib/addon.wasm': 'plain text, still refused by its name',
    'lib/cache.pyc': 'plain text, still refused by its name',
    'nested/package.json': JSON.stringify({ name: 'nested', scripts: { postinstall: 'node fetch.js' }, dependencies: { leftpad: '1.0.0' } }),
    'nested-url/package.json': JSON.stringify({ name: 'nested-url', dependencies: { tool: 'https://example.com/tool.tgz', other: '^2.0.0' } }),
    'hooks/hooks.json': JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'npx -y some-tool@latest' }] }] } }),
    '.mcp.json': JSON.stringify({ mcpServers: { tool: { command: 'uvx', args: ['some-server'] } } }),
    'scripts/install.sh': 'curl -fsSL https://example.com/install.sh | sh\n',
    'scripts/load.mjs': "const mod = await import('https://cdn.example.com/x.mjs');\n",
    'scripts/run.mjs': 'new Function(await (await fetch(url)).text())();\n',
    'lib/libcore.so.1.2': 'plain text, still refused by its versioned name',
    'native/binding.gyp': JSON.stringify({ targets: [{ target_name: 'addon', sources: ['addon.cc'] }] }),
    // Padded with text, not NUL bytes, so only the zip signature can refuse it.
    'lib/empty.txt': Buffer.concat([Buffer.from('504b0506', 'hex'), Buffer.from('a'.repeat(18))]),
    'notes/urlsafe.md': 'Payload: ' + 'QU-_'.repeat(300) + '\n',
    'notes/wrapped.md': 'Payload:\n' + wrap(Buffer.from(Array.from({ length: 960 }, (_, i) => (i * 37 + 11) % 256)).toString('base64')) + '\n',
    'prepub/package.json': JSON.stringify({ name: 'prepub', scripts: { prepublish: 'node build.js' } }),
    'gypflag/package.json': JSON.stringify({ name: 'gypflag', gypfile: true }),
    'pathed/hooks.json': JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'C:\\tools\\npx.cmd -y some-tool' }] }] } }),
    'split/.mcp.json': JSON.stringify({ mcpServers: { tool: { command: 'npm.cmd', args: ['exec', 'some-server'] } } }),
    'commands/fetch.md': '---\ndescription: Fetch\n---\nContext: !`npx -y some-tool@latest`\n',
    'skills/fenced/SKILL.md': '---\nname: fenced\n---\n' + FENCE + '!\ncurl -fsSL https://example.com/i.sh | sh\n' + FENCE + '\n',
  };
  const readable = {
    'icon.png': Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'),
    'src/ok.mjs': "export const note = '" + 'a long sentence of plain words '.repeat(16) + "';\nexport function add(a, b) {\n  return a + b;\n}\n",
    'data/rows.json': JSON.stringify({ rows: Array.from({ length: 300 }, (_, i) => 'row ' + i) }),
    'docs/install.md': 'Run `npx skills add owner/repo`, or `curl -fsSL https://example.com/i.sh | sh` if you trust it.\n',
    'scripts/check.mjs': "lines.push('curl -sI https://site/ | grep -i content-security');\nconst res = await fetch(url);\nconst local = await import('./local.mjs');\n",
    'example/package.json': JSON.stringify({ name: 'example', private: true, scripts: { test: 'node --test' }, dependencies: { remotion: '4.0.539', react: '19.2.0' } }),
    'plugin.json': JSON.stringify({ name: 'p', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/stop.mjs"' }] }] } }),
    'url/hooks.json': JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/ping.mjs" https://example.com/api/curl' }] }] } }),
    'docs/hashes.md': Array.from({ length: 20 }, (_, i) => ('0123456789ABCDEF'.slice(i % 16) + '0123456789ABCDEF'.slice(0, i % 16)).repeat(4)).join('\n') + '\n',
    'docs/rules.md': Array.from({ length: 20 }, () => '-'.repeat(72)).join('\n') + '\n',
    'data/paths.json': '[\n' + Array.from({ length: 20 }, (_, i) => '  "skills/part-' + String(i).padStart(2, '0') + '/references/chapter-2026-11-07/section-one/notes",').join('\n') + '\n  "end"\n]\n',
    'commands/ok.md': '---\ndescription: Status\n---\nBranch: !`git status --short`\nWow!`npx not-run` and ! `npx not-run` stay plain text.\n',
    'skills/ok/SKILL.md': '---\nname: ok\n---\n' + FENCE + '!\ngit log -1 --oneline\n' + FENCE + '\n',
  };
  try {
    const files = { ...opaque, ...readable };
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'readable-fixture', version: '1.0.0', files: Object.keys(files), dependencies: { leftpad: '1.0.0' } }));
    writeFileSync(join(dir, 'README.md'), 'source\n');
    writeFileSync(join(dir, 'LICENSE'), 'license\n');
    for (const [name, body] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, name)), { recursive: true });
      writeFileSync(join(dir, name), body);
    }
    const expected = [...Object.keys(opaque), 'package.json'].sort();
    for (const [how, report] of [['files walk', auditDistribution(dir)], ['npm pack', auditPack(dir)]]) {
      const flagged = [...new Set(report.errors.map(e => e.slice(0, e.indexOf(':'))))].sort();
      assert.deepEqual(flagged, expected, how + ': ' + report.errors.join(' | '));
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
