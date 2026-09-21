import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { request } from 'node:http';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../scripts/preview-server.mjs';
import { runClaude, findClaude, removeTables } from '../scripts/claude-cli.mjs';

test('preview confines files and symlinks, survives malformed URLs, and listens only on loopback', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'design-preview-'));
  const site = join(temp, 'site'), outside = join(temp, 'site-private');
  mkdirSync(site); mkdirSync(outside);
  writeFileSync(join(site, 'index.html'), 'public');
  writeFileSync(join(outside, 'marker.txt'), 'private');
  symlinkSync(outside, join(site, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  const server = startServer(site, 0);
  try {
    await once(server, 'listening');
    assert.equal(server.address().address, '127.0.0.1');
    const get = (path, method = 'GET') => new Promise((resolve, reject) => {
      request({ hostname: '127.0.0.1', port: server.address().port, path, method }, res => {
        let text = ''; res.on('data', c => text += c); res.on('end', () => resolve({ status: res.statusCode, text }));
      }).on('error', reject).end();
    });
    assert.deepEqual(await get('/'), { status: 200, text: 'public' });
    for (const url of ['/..%2fsite-private%2fmarker.txt', '/..%5csite-private%5cmarker.txt', '/linked/marker.txt'])
      assert.equal((await get(url)).status, 404, url);
    for (const url of ['/%ZZ', '/%00']) assert.equal((await get(url)).status, 400, url);
    assert.deepEqual(await get('/', 'HEAD'), { status: 200, text: '' });
    assert.equal((await get('/', 'POST')).status, 405);
    assert.equal((await get('/')).text, 'public');
  } finally { await new Promise(resolve => server.close(resolve)); rmSync(temp, { recursive: true, force: true }); }
});
test('installer sends paths with spaces and shell characters as a single literal argument', () => {
  const temp = mkdtempSync(join(tmpdir(), 'design argv & '));
  try {
    const script = join(temp, 'echo args.cjs');
    writeFileSync(script, 'process.stdout.write(JSON.stringify(process.argv.slice(2)))');
    const args = ['plugin', 'marketplace', 'add', join(temp, '[site] & quoted "path"')];
    const result = runClaude({ file: process.execPath, prefix: [script] }, args);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), args);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
test('Windows npm native executable is found without invoking a command shell', () => {
  const bin = join('fake', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
  assert.deepEqual(findClaude({ env: { PATH: 'fake' }, platform: 'win32', exists: p => p === bin }), { file: bin, prefix: [] });
});
test('uninstall does not stop at brackets inside a marketplace source string', () => {
  const text = 'model = "example"\n[marketplaces.test]\nsource = "C:/[sites]/a"\n[plugins."test@test"]\nenabled = true\n[other]\narray = ["x"]\n';
  assert.equal(removeTables(text, ['[marketplaces.test]', '[plugins."test@test"]']), 'model = "example"\n[other]\narray = ["x"]\n');
});

import { parseArgs } from '../scripts/args.mjs';
test('flag values do not become paths or study URLs', () => {
  const a = parseArgs(['new', '--name', 'Example name', 'output', '--preset=ink']);
  assert.deepEqual(a.positional, ['output']); assert.equal(a.flag('preset'), 'ink');
  assert.throws(() => parseArgs(['new', '--name']), /Missing value/);
});

/* Every flag the packs command documents in --help has to get past the
   whitelist. Five did not: --owns and --why were rejected before add() ran,
   so the packs registered on 2026-09-20 fell through to the repo's own
   description, and --force, --upstream and --project were rejected before
   vendor() and install() could read them. */
test('the packs flags in --help are accepted by the whitelist', () => {
  const a = parseArgs(['packs', 'add', 'o/r', '--owns', 'x', '--why', 'y']);
  assert.deepEqual(a.positional, ['add', 'o/r']);
  assert.equal(a.flag('owns'), 'x');
  assert.equal(a.flag('why'), 'y');
  const b = parseArgs(['packs', '--install', '--upstream', '--project']);
  assert.equal(b.flag('upstream'), true);
  assert.equal(b.flag('project'), true);
  assert.doesNotThrow(() => parseArgs(['packs', 'vendor', 'o/r', '--force']));
  assert.equal(parseArgs(['packs', 'vendor', 'o/r', '--force']).flag('force'), true);
});

/* The browser half of this suite guards itself with { skip: !findBrowser() },
   which means a runner with no browser reports every one of those tests as a
   pass and exits 0. CI is the only thing standing between that and a green
   badge that proves nothing, and the two halves of the arrangement live in
   different files: findBrowser() reads one env var, the workflow sets another.
   Renaming either without the other is silent, so assert the coupling. */
test('CI installs a browser, points findBrowser() at it, and fails when tests skip', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const yml = readFileSync(join(here, '..', '.github', 'workflows', 'regression.yml'), 'utf8');
  const src = readFileSync(join(here, '..', 'scripts', 'inspect.mjs'), 'utf8');

  // The one env var findBrowser() honours, read out of the function itself
  // rather than written down twice.
  const fn = src.slice(src.indexOf('export function findBrowser'), src.indexOf('const sleep ='));
  const envVar = (fn.match(/process\.env\.([A-Z_]+)/) || [])[1];
  assert.ok(envVar, 'findBrowser() must resolve a browser from an env var');
  assert.match(yml, new RegExp('^ +' + envVar + ': +[$][{][{]', 'm'),
    `the workflow must set ${envVar} - findBrowser() reads no other name`);

  assert.match(yml, /uses:\s*browser-actions\/setup-chrome/, 'a browser has to be installed on the runner');
  assert.match(yml, /sysctl -w kernel\.apparmor_restrict_unprivileged_userns=0/,
    'ubuntu 24.04 denies the user namespaces the Chrome sandbox needs');
  // The guard itself: node exits 0 on a skipped or cancelled test, so the
  // job has to read the counts back out of the TAP summary.
  assert.match(yml, /grep -qE '\^# \(skipped\|cancelled\) \[1-9\]'/,
    'the job must fail when a test was reported but never actually ran');
  assert.match(yml, /--test-reporter=tap/, 'the skip guard reads TAP, so TAP has to be what is produced');
  assert.match(yml, /node --test .*test\/\*\.test\.mjs/, 'the whole glob runs: files in it depend on each other');

  // No YAML parser here (zero dependencies), so check the two things that
  // actually break a workflow file by hand: a tab, or an odd indent.
  yml.split('\n').forEach((line, i) => {
    assert.ok(!/^\s*\t/.test(line), `tab indent at regression.yml:${i + 1} - YAML forbids it`);
    const indent = (line.match(/^ */) || [''])[0].length;
    assert.equal(indent % 2, 0, `odd indent (${indent}) at regression.yml:${i + 1}`);
  });
});

/* ---------------------------------------------------- Claude Design routes -- */
/* The detector has to be right about a machine it is not running on, so every
   input it reads is injectable. These run without a browser, without the
   Claude CLI and without touching the real home or temp directories. */

test('design detection reports the canvas skill, never enrols anything, and is honest about what it cannot see', async () => {
  const { detectDesignRoutes, findCanvasHelper, findCodexDesignServer, MCP_COMMAND } = await import('../scripts/design.mjs');

  // The helper unpacks per version into the host temp dir; the newest version
  // wins so a stale extraction from an older build is not reported as "the" one.
  const tree = {
    'T/claude/bundled-skills': ['2.1.100', '2.1.265'],
    'T/claude/bundled-skills/2.1.100': ['aaa'],
    'T/claude/bundled-skills/2.1.265': ['bbb'],
  };
  const files = new Set([
    'T/claude/bundled-skills',
    'T/claude/bundled-skills/2.1.100/aaa/design/seed-canvas.mjs',
    'T/claude/bundled-skills/2.1.100/aaa/design/payload.template.html',
    'T/claude/bundled-skills/2.1.265/bbb/design/seed-canvas.mjs',
    'T/claude/bundled-skills/2.1.265/bbb/design/payload.template.html',
  ]);
  const norm = (p) => String(p).split(String.fromCharCode(92)).join('/'); // a Windows path, normalised for the fake filesystem below
  const deps = {
    tmp: 'T', home: 'H',
    exists: (p) => files.has(norm(p)),
    readdir: (p) => tree[norm(p)] || [],
    read: () => { throw new Error('no codex config'); },
    probeMcp: false,
  };
  assert.equal(findCanvasHelper(deps).version, '2.1.265');

  const routes = detectDesignRoutes(deps);
  const byId = Object.fromEntries(routes.map((r) => [r.id, r]));
  assert.equal(byId['canvas-skill'].state, 'present');
  // The native tool is invisible from outside a session. Claiming it is
  // connected would be exactly the unverified capability claim this file is
  // meant to prevent.
  assert.equal(byId['design-sync'].state, 'only visible inside a session');
  assert.match(byId['design-sync'].evidence, /not an MCP server/);
  assert.match(byId['mcp'].use, /this script will not/);
  assert.match(byId['mcp'].use, /claude mcp add/);
  assert.equal(MCP_COMMAND.includes('api.anthropic.com/v1/design/mcp'), true);

  // Absent helper is "not seen from here", not "not installed": the skill
  // unpacks on first use, so nothing on disk proves it is missing.
  const empty = detectDesignRoutes({ ...deps, exists: () => false, readdir: () => [] });
  assert.equal(empty.find((r) => r.id === 'canvas-skill').state, 'not seen from here');
  assert.match(empty.find((r) => r.id === 'canvas-skill').evidence, /unpacks on first use/);

  // A Codex host has no `claude mcp list`; its config file is the only place
  // the same question can be answered.
  const codex = findCodexDesignServer({
    home: 'H',
    exists: (p) => norm(p) === 'H/.codex/config.toml',
    read: () => '[mcp_servers.claude-design]\nurl = "https://api.anthropic.com/v1/design/mcp"\n',
  });
  assert.equal(codex.configured, true);
  assert.equal(codex.name, 'claude-design');

  /* And the state has to SAY so. Reading only `claude mcp list` told a Codex
     user who was already registered "not registered", one line above evidence
     that said their Codex config names a design server - and the reference
     page makes that state the gate on registering, so a correctly set-up user
     was steered into registering a duplicate in the wrong host. */
  const onCodex = detectDesignRoutes({
    ...deps,
    exists: (p) => norm(p) === 'H/.codex/config.toml',
    readdir: () => [],
    read: () => '[mcp_servers.claude-design]\nurl = "https://api.anthropic.com/v1/design/mcp"\n',
    cli: 'claude',
    probeMcp: true,
    run: () => ({ status: 0, stdout: 'supabase: https://mcp.supabase.com/mcp (HTTP) - connected\n' }),
  }).find((r) => r.id === 'mcp');
  assert.equal(onCodex.state, 'registered in Codex');
  // Two hosts ship this plugin, so both get an instruction they can run. The
  // claude CLI is the one command that cannot help a Codex user.
  assert.match(onCodex.use, /\.codex\/config\.toml/);
  assert.match(onCodex.use, /\[mcp_servers\.claude-design\]/);
  // Sentences, not a run-on: the two halves of the evidence are separate facts.
  assert.match(onCodex.evidence, /servers\. Codex config names/);

  const neither = detectDesignRoutes({
    ...deps, exists: () => false, readdir: () => [], read: () => '',
    cli: 'claude', probeMcp: true, run: () => ({ status: 0, stdout: 'supabase: ...\n' }),
  }).find((r) => r.id === 'mcp');
  assert.equal(neither.state, 'not registered');
});

test('a design reference is classified before it is rendered, and a bare .dc.html is refused', async () => {
  const { classifyReference, compareProfiles } = await import('../scripts/parity.mjs');
  const here = dirname(fileURLToPath(import.meta.url));
  const design = join(here, 'fixtures', 'design');

  assert.equal(classifyReference(join(design, 'artboard-canvas.html')).kind, 'canvas');
  assert.deepEqual(classifyReference(join(design, 'artboard-canvas.html')).artboards, ['Main.dc.html']);
  assert.equal(classifyReference(join(design, 'Main.dc.html')).kind, 'artboard-source');
  assert.equal(classifyReference(join(design, 'match', 'index.html')).kind, 'page');

  // The comparison itself, on profiles rather than on pages: two identical
  // readings must produce nothing at all. Everything else in this file guards
  // against missing a real difference; this guards against inventing one.
  const profile = {
    viewport: { w: 1440, h: 900 },
    type: { sizeCounts: [[48, 1], [16, 4]], textColours: [['rgb(74, 74, 68)', 4]], families: ['Georgia'] },
    ground: [['rgb(250, 247, 242)', 1]],
    rhythm: [[24, 4]],
    band: { left: 0.02, right: 0.98, n: 5 },
    heading: { x: 0.02, w: 0.95, tag: 'h1' },
  };
  assert.deepEqual(compareProfiles(profile, structuredClone(profile)).findings, []);

  // Within tolerance is still the same design: a 47px heading, a colour two
  // shades off and a content band a couple of points narrower are rounding,
  // font fallback and a scrollbar - not decisions anyone made.
  const near = structuredClone(profile);
  near.type.sizeCounts = [[47, 1], [17, 4]];
  near.type.textColours = [['rgb(78, 76, 70)', 4]];
  near.band = { left: 0.04, right: 0.96, n: 5 };
  assert.deepEqual(compareProfiles(profile, near).findings, []);
});
