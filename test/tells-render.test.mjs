/* The rendered tells (scripts/tells-render.mjs, `webdesign.mjs tells`).

   Without a browser: the thresholds file, the data rows and the reference
   agree with the feature ids, every feature has its fixture pair, the font
   list carries the faces impeccable 4.1.0 added, and tells.md stops promising
   "no reflexive cream". With one: every fixture fires exactly what it is
   written to fire, a restrained page fires nothing, each preset's fresh
   scaffold fires exactly its list in test/tells-expected.mjs within the
   budget, and nothing is fetched from another origin. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { runAudit, SLOP_FONTS } from '../scripts/audit.mjs';
import { tellData } from '../scripts/tells.mjs';
import { FEATURE_IDS, TELLS_SCHEMA, tellsConfig, sectionSignatures, tellsOnSession, combine } from '../scripts/tells-render.mjs';
import { DEFAULT_SECTIONS } from '../scripts/sections.mjs';
import { findBrowser, launch, closeBrowser, Session } from '../scripts/inspect.mjs';
import { startServer } from '../scripts/preview-server.mjs';
import { browserSkip } from './need-browser.mjs';
import { EXPECTED_TELLS } from './tells-expected.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = join(root, 'scripts', 'webdesign.mjs');
const FIXTURES = join(root, 'test', 'fixtures', 'tells-render');
const inOrder = (ids) => FEATURE_IDS.filter((id) => ids.includes(id));

/* What each fixture fires, at both widths. A fire fixture fires its own
   feature and nothing else, except where the feature is built on another
   (cluster-1 needs cream-ground, cluster-2 needs perma-dark). */
const EXPECT = { restrained: [] };
for (const id of FEATURE_IDS) { EXPECT[id + '.fire'] = [id]; EXPECT[id + '.nofire'] = []; }
EXPECT['cluster-1.fire'] = ['cream-ground', 'cluster-1'];
EXPECT['cluster-1.nofire'] = ['cream-ground'];
EXPECT['cluster-2.fire'] = ['perma-dark', 'cluster-2'];
EXPECT['cluster-2.nofire'] = ['perma-dark'];

test('data/tells-render.json has a threshold entry, a why and a source URL for exactly the v1 feature ids', () => {
  const cfg = tellsConfig();
  assert.deepEqual(Object.keys(cfg.features).sort(), [...FEATURE_IDS].sort());
  for (const [id, f] of Object.entries(cfg.features)) {
    assert.ok(typeof f.why === 'string' && f.why.length > 40, id + ' has no why');
    assert.match(f.source, /^https:\/\//, id + ' has no source URL');
  }
  assert.equal(FEATURE_IDS.length, 14);
});

test('every rendered tell is a dated, sourced row in ai-tells.json, and the rows that say the chassis ships it are the expected fires', () => {
  const rows = tellData().entries.filter((e) => e.proposed_check && e.proposed_check.scope === 'tells');
  assert.deepEqual(rows.map((e) => e.proposed_check.id).sort(), [...FEATURE_IDS].sort());
  const shipped = new Set(Object.values(EXPECTED_TELLS).flatMap((p) => p.rendered));
  for (const e of rows) {
    const id = e.proposed_check.id;
    assert.match(e.source, /^https:\/\//, e.id + ' source');
    assert.match(e.first_seen, /^2\d{3}-\d{2}(-\d{2})?$/, e.id + ' first_seen');
    assert.equal(e.last_confirmed, '2026-09-29', e.id + ' last_confirmed');
    assert.ok(['verifier-confirmed', 'source-read'].includes(e.source_verified), e.id + ' source_verified');
    assert.ok(Array.isArray(e.detectors) && e.detectors.length, e.id + ' names no detector');
    assert.equal(e.ufs_chassis_ships_it, shipped.has(id), `${e.id} (${id}) says ufs_chassis_ships_it ${e.ufs_chassis_ships_it}`);
  }
  // The five the detectors flagged on bone are among them.
  for (const id of ['cream-ground', 'overused-face', 'template-chrome', 'stat-banner', 'marquee']) assert.ok(shipped.has(id), id);
});

test('each feature has a fire and a no-fire fixture, and the restrained page is there', () => {
  const files = new Set(readdirSync(FIXTURES));
  for (const name of Object.keys(EXPECT)) assert.ok(files.has(name + '.html'), name + '.html is missing');
  assert.equal(files.size, Object.keys(EXPECT).length, 'a fixture with no expectation');
});

test('SLOP_FONTS carries the five faces from impeccable 4.1.0, and the audit names Instrument Sans on a bone scaffold', () => {
  for (const f of ['Instrument Sans', 'Plus Jakarta Sans', 'Mona Sans', 'Open Sans', 'Geist Mono']) assert.ok(SLOP_FONTS.includes(f), f);
  const dir = mkdtempSync(join(tmpdir(), 'ufs-tells-font-'));
  try {
    const made = spawnSync(process.execPath, [cli, 'new', join(dir, 'b'), '--preset', 'bone'], { encoding: 'utf8' });
    assert.equal(made.status, 0, made.stderr);
    const hit = runAudit(join(dir, 'b')).findings.filter((f) => /index\.html: .*Instrument Sans - currently the most-generated/.test(f.text));
    assert.equal(hit.length, 1, 'the audit does not name Instrument Sans');
    assert.equal(hit[0].level, 'warn');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('tells.md no longer promises "no reflexive cream" while bone ships cream, and says why bone is cream', () => {
  const md = readFileSync(join(root, 'skills/ultimate-frontend-skills/references/tells.md'), 'utf8').replace(/\r/g, '');
  const at = md.indexOf('## The one-line version');
  const oneLine = md.slice(at, md.indexOf('\n## ', at + 5));
  assert.ok(!/no reflexive cream/i.test(oneLine), oneLine);
  assert.match(oneLine.replace(/\s+/g, ' '), /Bone is cream because/);
  assert.match(md, /webdesign\.mjs tells/);
});

test('the section library has a signature for every default section, and the usage lists the command', () => {
  const sig = sectionSignatures();
  for (const id of DEFAULT_SECTIONS) assert.ok(sig[id] && Object.keys(sig[id]).length, id);
  const usage = spawnSync(process.execPath, [cli], { encoding: 'utf8' }).stdout;
  assert.match(usage, /\btells <dir\|file\|url> \[--widths 1440,390\]/);
});

test('a --widths with no usable width is refused, not reported as a vector where nothing fired', () => {
  for (const bad of ['abc', '1440,-3', '0']) {
    const run = spawnSync(process.execPath, [cli, 'tells', join(FIXTURES, 'restrained.html'), '--json', '--widths', bad], { encoding: 'utf8', timeout: 60000 });
    assert.equal(run.status, 1, bad + ': ' + run.stdout.slice(0, 200));
    assert.equal(run.stdout, '', bad);
    assert.match(run.stderr, /--widths takes whole CSS pixel widths/, bad);
  }
});

test('every fixture fires exactly what it is written to fire, at 1440 and 390', { skip: browserSkip(), timeout: Number(process.env.UFS_TEST_TIMEOUT_MS) || 180000 }, async () => {
  const server = startServer(FIXTURES, 0);
  await once(server, 'listening');
  const b = await launch(findBrowser());
  try {
    const s = await Session.open(b.port);
    await s.send('Page.enable');
    await s.send('Runtime.enable');
    const wrong = [];
    for (const [name, want] of Object.entries(EXPECT)) {
      const widths = [1440, 390];
      const features = combine(await tellsOnSession(s, `http://127.0.0.1:${server.address().port}/${name}.html`, { widths, wait: 300 }), widths);
      const fired = features.filter((f) => f.fired);
      const got = fired.map((f) => f.id);
      if (JSON.stringify(got) !== JSON.stringify(inOrder(want))) wrong.push(`${name}: fired [${got}] expected [${inOrder(want)}] ${fired.map((f) => f.evidence).join(' | ')}`);
      // A fire fixture fires at both widths, not by luck at one.
      for (const f of fired) if (f.firedAt.length !== 2) wrong.push(`${name}: ${f.id} fired only at ${f.firedAt}`);
      if (name === 'perma-dark.nofire') assert.equal(features.find((f) => f.id === 'perma-dark').value[1440].lightRule, true);
    }
    s.close();
    assert.deepEqual(wrong, []);
  } finally { await closeBrowser(b); await new Promise((r) => server.close(r)); }
});

test('each preset\'s fresh scaffold fires exactly its expected list, in ufs-tells/1, inside 15 s at two widths', { skip: browserSkip(), timeout: Number(process.env.UFS_TEST_TIMEOUT_MS) || 180000 }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'ufs-tells-presets-'));
  try {
    for (const [preset, { rendered }] of Object.entries(EXPECTED_TELLS)) {
      const out = join(dir, preset);
      const made = spawnSync(process.execPath, [cli, 'new', out, '--preset', preset], { encoding: 'utf8' });
      assert.equal(made.status, 0, made.stderr);
      const t0 = Date.now();
      const run = spawnSync(process.execPath, [cli, 'tells', out, '--json'], { encoding: 'utf8', timeout: 60000 });
      const ms = Date.now() - t0;
      assert.equal(run.status, 0, run.stderr);
      assert.ok(ms <= 15000, `${preset}: ${ms} ms`);
      const r = JSON.parse(run.stdout);
      assert.equal(r.schema, TELLS_SCHEMA);
      assert.equal(r.target, out);
      assert.deepEqual(r.widths, [1440, 390]);
      assert.ok(r.ufsSha === null || /^[0-9a-f]{40}$/.test(r.ufsSha), 'ufsSha ' + r.ufsSha);
      assert.deepEqual(r.features.map((f) => f.id), FEATURE_IDS);
      for (const f of r.features) {
        assert.deepEqual(Object.keys(f).slice(0, 4), ['id', 'fired', 'value', 'evidence']);
        assert.equal(typeof f.fired, 'boolean');
        assert.ok(f.evidence, f.id + ' has no evidence');
      }
      const fired = r.features.filter((f) => f.fired).map((f) => f.id);
      assert.deepEqual(fired, inOrder(rendered), preset + ': ' + r.features.filter((f) => f.fired !== rendered.includes(f.id)).map((f) => f.evidence).join(' | '));
      // The Google Fonts stylesheet is asked for and turned away, never fetched.
      assert.deepEqual(r.blocked, ['fonts.googleapis.com'], preset);
      if (preset === 'bone') {
        const face = r.features.find((f) => f.id === 'overused-face').value[1440];
        assert.equal(face.button.family, 'Instrument Sans');
        assert.equal(face.button.loaded, false);
      }
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('nothing is fetched from another origin: a stylesheet on a second local server is never requested', { skip: browserSkip(), timeout: Number(process.env.UFS_TEST_TIMEOUT_MS) || 180000 }, async () => {
  let hits = 0;
  const other = createServer((req, res) => { hits++; res.writeHead(200, { 'Content-Type': 'text/css' }); res.end('body{background:#111}'); }).listen(0, '127.0.0.1');
  await once(other, 'listening');
  const dir = mkdtempSync(join(tmpdir(), 'ufs-tells-origin-'));
  try {
    const port = other.address().port;
    writeFileSync(join(dir, 'index.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><title>o</title>
<link rel="stylesheet" href="http://127.0.0.1:${port}/dark.css"><link rel="stylesheet" href="local.css">
<main><h1>Harbour ferry times</h1><p>The 7:40 leaves from pier two.</p></main></html>`);
    writeFileSync(join(dir, 'local.css'), 'h1{letter-spacing:-0.06em}');
    // Asynchronously, so this process can answer the other server if asked.
    const run = await promisify(execFile)(process.execPath, [cli, 'tells', dir, '--json', '--widths', '1440'], { encoding: 'utf8', timeout: 60000 });
    const r = JSON.parse(run.stdout);
    assert.equal(hits, 0, 'the other origin was fetched');
    assert.deepEqual(r.blocked, ['127.0.0.1:' + port]);
    const fired = r.features.filter((f) => f.fired).map((f) => f.id);
    // Its own origin still loads (local.css crushes the tracking), and the
    // other's dark ground never arrives.
    assert.deepEqual(fired, ['display-tracking']);
  } finally { other.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('a URL that redirects to another origin is followed, and a #fragment is measured at every width', { skip: browserSkip(), timeout: Number(process.env.UFS_TEST_TIMEOUT_MS) || 180000 }, async () => {
  // The page and its stylesheet are on one origin; the URL given redirects
  // there from another, as https://example.com does to https://www.example.com.
  const page = createServer((req, res) => {
    if (req.url === '/dark.css') { res.writeHead(200, { 'Content-Type': 'text/css' }); return res.end('html{background:#101010;color:#e8e8e8}'); }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<!doctype html><html lang="en"><meta charset="utf-8"><title>r</title><link rel="stylesheet" href="/dark.css"><main><h1 id="top">Harbour ferry times</h1><p>The 7:40 leaves from pier two.</p></main></html>');
  }).listen(0, '127.0.0.1');
  await once(page, 'listening');
  const hop = createServer((req, res) => { res.writeHead(301, { Location: `http://localhost:${page.address().port}${req.url}` }); res.end(); }).listen(0, '127.0.0.1');
  await once(hop, 'listening');
  try {
    // Through the redirect, and straight at the page: the second width asks
    // for the very URL the page is already at, #fragment and all.
    for (const url of [`http://127.0.0.1:${hop.address().port}/#top`, `http://localhost:${page.address().port}/#top`]) {
      const run = await promisify(execFile)(process.execPath, [cli, 'tells', url, '--json'], { encoding: 'utf8', timeout: 90000 });
      const r = JSON.parse(run.stdout);
      assert.deepEqual(r.blocked, [], url);
      // Its own stylesheet arrived, at both widths.
      assert.deepEqual(r.features.find((f) => f.id === 'perma-dark').firedAt, [1440, 390], url);
    }
  } finally { page.close(); hop.close(); }
});

test('a target that is not an HTML page says so', { skip: browserSkip(), timeout: Number(process.env.UFS_TEST_TIMEOUT_MS) || 180000 }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'ufs-tells-svg-'));
  try {
    writeFileSync(join(dir, 'mark.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');
    const run = spawnSync(process.execPath, [cli, 'tells', join(dir, 'mark.svg'), '--widths', '1440'], { encoding: 'utf8', timeout: 60000 });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /not an HTML page \(image\/svg\+xml\)/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
