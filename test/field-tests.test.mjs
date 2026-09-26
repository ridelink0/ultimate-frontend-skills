/* Field tests: every project built with UFS feeds back as a dated record in
   docs/field-tests/, and every lesson there that can be tested is held here
   or names the test that holds it. This file checks both halves:

   - the records themselves: each lesson carries the five parts the method in
     docs/field-tests/README.md asks for, and each "Regression check" names a
     test that exists (file and exact title), or says plainly why none can;
   - the browser regressions from Doodle Voyager and HQ that had no home in
     another test file. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { findBrowser, inspect, formatReport, CANVAS_INIT, launchRendering, SOFTWARE_WEBGL, closeBrowser, removeProfile, sweepProfiles, PROFILE_PREFIX } from '../scripts/inspect.mjs';
import { startServer } from '../scripts/preview-server.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIELD = join(ROOT, 'docs', 'field-tests');
const PARTS = ['What happened', 'What UFS said or did', 'What it should have said or done', 'The UFS fix', 'Regression check'];

// A record is a list of "### <ID>. <title>" lessons, each with the five parts
// as bold labels at the start of a paragraph.
function lessons(file) {
  const text = readFileSync(join(FIELD, file), 'utf8');
  return text.split(/^### /m).slice(1).map((chunk) => {
    const title = chunk.split('\n')[0].trim();
    const parts = {};
    for (const label of PARTS) {
      const m = new RegExp('\\*\\*' + label + '[.:]\\*\\*\\s*([\\s\\S]*?)(?=\\n\\*\\*(?:' + PARTS.join('|') + ')[.:]\\*\\*|$)').exec(chunk);
      parts[label] = m ? m[1].trim() : null;
    }
    return { file, title, parts };
  });
}

const records = readdirSync(FIELD).filter((f) => f.endsWith('.md') && f !== 'README.md');

test('every field-test record has lessons, and every lesson has all five parts', () => {
  assert.ok(records.includes('doodle-voyager.md') && records.includes('gev-hq.md'), records.join(', '));
  for (const file of records) {
    const list = lessons(file);
    assert.ok(list.length >= 5, file + ' has ' + list.length + ' lessons');
    const ids = new Set();
    for (const l of list) {
      const id = l.title.split('.')[0];
      assert.match(id, /^[A-Z]{2,4}-\d+$/, file + ': lesson id "' + id + '"');
      assert.ok(!ids.has(id), file + ': duplicate id ' + id);
      ids.add(id);
      for (const label of PARTS) assert.ok(l.parts[label] && l.parts[label].length > 20, file + ' ' + l.title + ': missing or empty "' + label + '"');
    }
  }
});

test('every regression check names a test that exists, or says why it cannot be tested', () => {
  const titles = new Map();
  for (const f of readdirSync(join(ROOT, 'test')).filter((n) => n.endsWith('.test.mjs'))) {
    const src = readFileSync(join(ROOT, 'test', f), 'utf8');
    const found = new Set();
    for (const m of src.matchAll(/\btest\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g)) found.add(m[2].replace(/\\(['"`\\])/g, '$1'));
    titles.set(f, found);
  }
  let named = 0;
  for (const file of records) {
    for (const l of lessons(file)) {
      const check = l.parts['Regression check'];
      const refs = [...check.matchAll(/`test\/([\w.-]+\.test\.mjs)`\s*,\s*"([^"]+)"/g)];
      if (!refs.length) {
        assert.match(check, /^Not testable( automatically)?:/, file + ' ' + l.title + ': a regression check must name `test/<file>`, "<title>" or start with "Not testable:"');
        continue;
      }
      for (const [, testFile, title] of refs) {
        assert.ok(titles.has(testFile), file + ' ' + l.title + ': no test file ' + testFile);
        assert.ok(titles.get(testFile).has(title), file + ' ' + l.title + ': no test titled "' + title + '" in ' + testFile);
        named++;
      }
    }
  }
  assert.ok(named >= 10, 'only ' + named + ' lessons are held by a named test');
});

test('the references carry every fix the records say they carry', () => {
  // A record's fix that names a reference section must find it there.
  for (const file of records) {
    for (const l of lessons(file)) {
      // A line wrapped in the record is a space in the heading.
      for (const [, ref, raw] of l.parts['The UFS fix'].matchAll(/`references\/([\w-]+\.md)`\s*,\s*section "([^"]+)"/g)) {
        const heading = raw.replace(/\s+/g, ' ');
        const text = readFileSync(join(ROOT, 'skills', 'ultimate-frontend-skills', 'references', ref), 'utf8');
        assert.ok(text.split('\n').some((line) => /^#{2,4} /.test(line) && line.includes(heading)), file + ' ' + l.title + ': ' + ref + ' has no heading containing "' + heading + '"');
      }
    }
  }
});

const skip = !findBrowser();

async function serve(html) {
  const dir = mkdtempSync(join(tmpdir(), 'ufs-field-'));
  writeFileSync(join(dir, 'index.html'), html);
  const server = startServer(dir, 0);
  await once(server, 'listening');
  return { url: 'http://127.0.0.1:' + server.address().port + '/', close: () => new Promise((r) => server.close(() => { rmSync(dir, { recursive: true, force: true }); r(); })) };
}

// Doodle Voyager's title screen, reduced to its layout: a full-screen WebGL
// canvas, a fixed pointer-events:none layer holding a fixed, scrolling
// overlay with all the text, and the map overlay closed with its canvas in it.
const GAME = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Game</title>
<style>
  [hidden]{display:none!important}
  html,body{margin:0;background:#0b0f18;color:#e8ecf5;font:16px system-ui,sans-serif}
  #gl{position:fixed;inset:0;width:100vw;height:100vh;display:block}
  #main{position:fixed;inset:0;pointer-events:none;z-index:5}
  .overlay{position:fixed;inset:0;display:grid;place-items:start center;padding:16px;overflow:auto;pointer-events:auto;background:rgba(11,15,24,.25)}
  .card{background:#131a2a;padding:24px;border-radius:12px;max-width:560px}
  .clash{position:relative;height:40px}
  .clash p{position:absolute;margin:0;left:0}
  #m-canvas{width:100%;height:auto;display:block}
</style></head><body>
<canvas id="gl"></canvas>
<div id="main">
  <section class="overlay" id="title"><div class="card">
    <h1>Doodle Voyager</h1>
    <p>W and S set the throttle, the mouse steers, Space fires.</p>
    <p>E leaves the seat; M opens the map.</p>
    <div class="clash"><p style="top:0">Launch into the red margin</p><p style="top:6px;left:10px">Settings and the callsign</p></div>
  </div></section>
  <section class="overlay" id="map" hidden><canvas id="m-canvas" width="640" height="400"></canvas></section>
</div>
<script>
  const gl = document.getElementById('gl').getContext('webgl');
  const c = document.getElementById('gl');
  c.width = innerWidth; c.height = innerHeight;
  gl.viewport(0, 0, c.width, c.height);
  gl.enable(gl.SCISSOR_TEST);
  gl.clearColor(0.05, 0.07, 0.12, 1); gl.clear(gl.COLOR_BUFFER_BIT);
  gl.scissor(0, 0, c.width >> 1, c.height >> 1); gl.clearColor(0.9, 0.3, 0.2, 1); gl.clear(gl.COLOR_BUFFER_BIT);
</script></body></html>`;

test('a game title screen: text in fixed layers is measured, a closed map canvas is a note, a real clash is still an overlap', { skip, timeout: 90000 }, async () => {
  const site = await serve(GAME);
  try {
    const [r] = await inspect(site.url, { widths: [1366], wait: 300, scrolls: [0] });
    // Before 2026-09-25 every one of these was skipped as "pinned": 0 text elements.
    assert.ok(r.stats.textElements >= 5, 'text elements: ' + r.stats.textElements);
    assert.equal(r.stats.pinnedText, r.stats.textElements);
    const text = formatReport([r]).text;
    assert.doesNotMatch(text, /zero visible size/, text);
    assert.match(text, /note {2}canvas #m-canvas is not rendered/, text);
    const map = r.visual.canvases.find((c) => c.id === '#m-canvas');
    assert.equal(map.rendered, false);
    const world = r.visual.canvases.find((c) => c.id === '#gl');
    assert.equal(world.rendered, true);
    assert.equal(world.uniform, false, 'the world canvas drew two colours: ' + JSON.stringify(r.visual.canvases));
    // Two lines inside the same fixed card that collide are still a defect.
    assert.ok(r.overlaps.some((o) => /Launch into|Settings and/.test(o.a + o.b)), JSON.stringify(r.overlaps));
    assert.ok(!r.overlaps.some((o) => /Doodle Voyager|W and S|E leaves/.test(o.a + o.b)), JSON.stringify(r.overlaps));
  } finally { await site.close(); }
});

test('a pinned header over scrolled content is still not an overlap, and its text is sampled against what is behind it', { skip, timeout: 90000 }, async () => {
  const rows = Array.from({ length: 30 }, (_, i) => '<p style="margin:0 0 8px">Body line ' + (i + 1) + ' of the long article</p>').join('');
  const site = await serve('<!doctype html><html lang="en"><meta charset="utf-8"><title>x</title><body style="margin:0;font:16px Georgia,serif;background:#f4efe6;color:#1b1914">' +
    '<header style="position:fixed;top:0;left:0;right:0;padding:10px 16px;color:#fff">Site name and navigation</header><main style="padding:0 16px">' + rows + '</main></body></html>');
  try {
    const [r] = await inspect(site.url, { widths: [1280], wait: 200, scrolls: [0] });
    assert.equal(r.overlaps.length, 0, JSON.stringify(r.overlaps));
    // The header paints no ground of its own, so its white text is judged by
    // the pixels under it, not against the page colour as if it were solid.
    assert.ok(!r.contrast.some((c) => /Site name/.test(c.el) && c.method === 'solid'), JSON.stringify(r.contrast));
  } finally { await site.close(); }
});

test('a native date field squeezed below its own width is reported; one at its width is not (HQ)', { skip, timeout: 90000 }, async () => {
  const site = await serve('<!doctype html><html lang="en"><meta charset="utf-8"><title>x</title><body style="font:16px system-ui;padding:16px">' +
    '<form style="display:flex;gap:8px"><input aria-label="Task" style="flex:1"><input id="due" type="date" aria-label="Due" style="width:70px">' +
    '<input id="ok" type="date" aria-label="Start"><select id="tag" aria-label="Tag" style="width:44px"><option>Everything else</option></select>' +
    '<select id="fits" aria-label="Who"><option>Gev</option><option>A much longer option nobody picked</option></select>' +
    '<select id="sr" aria-label="Native twin" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)"><option>Visually hidden behind a custom dropdown</option></select></form></body></html>');
  try {
    const [r] = await inspect(site.url, { widths: [1280], wait: 200, scrolls: [0] });
    const cut = r.clipped.map((c) => c.el).join(' | ');
    assert.match(cut, /input#due/, cut);
    assert.match(cut, /select#tag/, cut);
    assert.doesNotMatch(cut, /input#ok|select#fits|select#sr/, cut);
    assert.match(formatReport([r]).text, /warn {2}control cut short, 7\dpx of the \d+px it needs: input#due/);
  } finally { await site.close(); }
});

// windows-latest has no GPU, and there Chrome's WebGL context was lost the
// moment it was made (measured 2026-09-26): every WebGL page read as a flat fill.
test('the game world reads as two colours in a browser with the GPU switched off', { skip, timeout: 90000 }, async () => {
  const site = await serve(GAME);
  try {
    const [r] = await inspect(site.url, { widths: [1366], wait: 300, scrolls: [0], browserArgs: ['--disable-gpu'] });
    const world = r.visual.canvases.find((c) => c.id === '#gl');
    assert.equal(r.webgl.ok, true, JSON.stringify(r.webgl));
    assert.equal(world.lost, false, JSON.stringify(world));
    assert.equal(world.uniform, false, JSON.stringify(r.visual.canvases));
    assert.doesNotMatch(formatReport([r]).text, /flat fill/);
  } finally { await site.close(); }
});

test('a browser whose WebGL is dead is relaunched on the software renderer, and says so', { skip, timeout: 90000 }, async () => {
  // --disable-software-rasterizer on top of --disable-gpu leaves no WebGL at
  // all, the state the runner was in; the fallback launch does not carry them.
  const b = await launchRendering(findBrowser(), [], { firstAttempt: ['--disable-gpu', '--disable-software-rasterizer'] });
  try {
    assert.equal(b.webgl.ok, true, JSON.stringify(b.webgl));
    assert.equal(b.webgl.software, true, JSON.stringify(b.webgl));
    assert.match(b.webgl.reason, /no WebGL context|lost|instead of red/, JSON.stringify(b.webgl));
    assert.match(b.webgl.renderer, /SwiftShader/i, JSON.stringify(b.webgl));
    assert.deepEqual(SOFTWARE_WEBGL, ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']);
  } finally { await closeBrowser(b); }
});

test('a page that loses its own WebGL context is told so, not told it drew a flat fill', { skip, timeout: 90000 }, async () => {
  const site = await serve('<!doctype html><html lang="en"><meta charset="utf-8"><title>x</title><body style="margin:0">' +
    '<canvas id="w" style="width:600px;height:400px;display:block"></canvas><script>' +
    'const gl = document.getElementById("w").getContext("webgl"); gl.clearColor(1,0,0,1); gl.clear(gl.COLOR_BUFFER_BIT);' +
    'gl.getExtension("WEBGL_lose_context").loseContext();</script></body></html>');
  try {
    const [r] = await inspect(site.url, { widths: [1280], wait: 300, scrolls: [0] });
    const w = r.visual.canvases.find((c) => c.id === '#w');
    assert.equal(w.lost, true, JSON.stringify(w));
    const text = formatReport([r]).text;
    assert.match(text, /warn {2}webgl canvas #w lost its WebGL context/, text);
    assert.doesNotMatch(text, /flat fill/, text);
  } finally { await site.close(); }
});

test('with no WebGL anywhere, a lost canvas is a note naming the browser, never a warning against the page', () => {
  const base = { width: 1366, scroll: 0, overlaps: [], overflow: [], contrast: [], collapsed: [], broken: [], tiny: [], offscreen: [], stats: {} };
  const canvas = { id: '#gl', rendered: true, width: 1366, height: 1000, uniform: true, readable: true, spread: 0, lost: true, context: 'webgl' };
  const none = formatReport([{ ...base, visual: { canvases: [canvas] }, webgl: { ok: false, software: false, reason: 'no WebGL context; the software renderer failed too: no WebGL context' } }]).text;
  assert.match(none, /note {2}webgl canvas #gl not checked: this browser has no working WebGL \(no WebGL context/, none);
  assert.doesNotMatch(none, /flat fill|warn {2}webgl canvas/, none);
  const soft = formatReport([{ ...base, visual: { canvases: [{ ...canvas, lost: false, uniform: false, spread: 200 }] }, webgl: { ok: true, software: true, renderer: 'SwiftShader', reason: 'the WebGL context was lost' } }]).text;
  assert.match(soft, /note {2}WebGL ran on the software renderer \(the WebGL context was lost on the GPU path\)/, soft);
});

test('CANVAS_INIT is exported, so a project suite can read WebGL pixels the way inspect does (HQ)', () => {
  // HQ's Lab tests had to copy it by hand because it was private (2026-09-24).
  assert.match(CANVAS_INIT, /preserveDrawingBuffer: true/);
  assert.doesNotThrow(() => new Function(CANVAS_INIT));
});

test('a key screen can be typed through, and the key never reaches the report (HQ)', { skip, timeout: 90000 }, async () => {
  const site = await serve('<!doctype html><html lang="en"><meta charset="utf-8"><title>x</title><body style="font:16px system-ui;padding:16px">' +
    '<form id="gate"><label for="k">Room key</label> <input id="k" autocomplete="off"></form>' +
    '<main id="board" hidden><h1>To do</h1><p>Ship the field tests</p></main>' +
    '<script>document.getElementById("gate").addEventListener("submit", (e) => { e.preventDefault(); if (document.getElementById("k").value === "open-sesame-42") { setTimeout(() => { document.getElementById("gate").hidden = true; document.getElementById("board").hidden = false; }, 700); } });</script></body></html>');
  process.env.UFS_FIELD_TEST_KEY = 'open-sesame-42';
  try {
    // The board opens 700 ms after Enter, as a real backend check would; a
    // step's "wait" is what lets the probe see it.
    const results = await inspect(site.url, { widths: [1280], wait: 150, scrolls: [0], actions: [
      { type: 'type', selector: '#k', textFromEnv: 'UFS_FIELD_TEST_KEY', key: 'Enter', wait: 1200 },
      { type: 'expect-visible', selector: '#board' },
    ] });
    const steps = results.filter((r) => r.step);
    assert.equal(steps.length, 2);
    assert.deepEqual(steps.flatMap((r) => r.actionErrors), []);
    assert.ok(!JSON.stringify(results).includes('open-sesame-42'), 'the key must not be in the results');
    // A wrong key leaves the board shut, and expect-visible says so.
    process.env.UFS_FIELD_TEST_KEY = 'wrong';
    const shut = await inspect(site.url, { widths: [1280], wait: 150, scrolls: [0], actions: [
      { type: 'type', selector: '#k', textFromEnv: 'UFS_FIELD_TEST_KEY', key: 'Enter' },
      { type: 'expect-visible', selector: '#board' },
    ] });
    assert.match(shut.filter((r) => r.step)[1].actionErrors.join(' '), /not visible/);
  } finally { delete process.env.UFS_FIELD_TEST_KEY; await site.close(); }
});
