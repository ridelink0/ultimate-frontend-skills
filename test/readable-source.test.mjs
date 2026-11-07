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
  };
  const readable = {
    'icon.png': Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'),
    'src/ok.mjs': "export const note = '" + 'a long sentence of plain words '.repeat(16) + "';\nexport function add(a, b) {\n  return a + b;\n}\n",
    'data/rows.json': JSON.stringify({ rows: Array.from({ length: 300 }, (_, i) => 'row ' + i) }),
    'docs/install.md': 'Run `npx skills add owner/repo`, or `curl -fsSL https://example.com/i.sh | sh` if you trust it.\n',
    'scripts/check.mjs': "lines.push('curl -sI https://site/ | grep -i content-security');\nconst res = await fetch(url);\nconst local = await import('./local.mjs');\n",
    'example/package.json': JSON.stringify({ name: 'example', private: true, scripts: { test: 'node --test' }, dependencies: { remotion: '4.0.539', react: '19.2.0' } }),
    'plugin.json': JSON.stringify({ name: 'p', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/stop.mjs"' }] }] } }),
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
