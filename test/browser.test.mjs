import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, readdirSync, existsSync, mkdirSync, utimesSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { deflateSync } from 'node:zlib';
import { once } from 'node:events';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { debugSite } from '../scripts/debug.mjs';
import { Session, findBrowser, inspect, decodePNG, sampleImageContrast, readPortFile } from '../scripts/inspect.mjs';
import { launch, closeBrowser, removeProfile, sweepProfiles, flushProfiles, PROFILE_PREFIX, LAUNCH_FLAGS } from '../scripts/inspect.mjs';
import { writeReview } from '../scripts/review.mjs';
import { runVerify, formatVerify } from '../scripts/verify.mjs';
import { startServer } from '../scripts/preview-server.mjs';
const ROOT_DIR = join(fileURLToPath(new URL('.', import.meta.url)), '..');
import { inspectStyles, formatInspect } from '../scripts/inspect.mjs';

test('CDP synchronous send failure removes pending requests', async () => {
  const s = new Session({ send() { throw new Error('socket unavailable'); }, close() {} });
  await assert.rejects(s.send('Page.enable'), /socket unavailable/);
  assert.equal(s.waiting.size, 0);
});
test('closing CDP rejects pending operations immediately', async () => {
  const s = new Session({ send() {}, close() {} });
  const result = s.send('Page.enable');
  s.close();
  await assert.rejects(result, /session closed/); assert.equal(s.waiting.size, 0);
});
test('empty viewport lists fail instead of producing a false clean report', async () => {
  await assert.rejects(inspect('http://localhost', { widths: [] }), /Widths/);
});
test('HTML review escapes untrusted target text', () => {
  const dir = mkdtempSync(join(tmpdir(), 'review-escape-'));
  try {
    const result = writeReview([], dir, '<script>alert(1)</script>');
    assert.ok(readFileSync(result.file, 'utf8').includes('&lt;script&gt;'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('real browser captures scroll, interaction, reduced motion and canvas evidence', { skip: !findBrowser(), timeout: 60000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'visual-debug-'));
  try {
    const html = '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:24px;background:#eeeeee;color:#222222;font:18px system-ui}main{height:2400px}button{padding:14px}canvas{display:block;width:200px;height:120px;margin-top:24px}#panel[hidden]{display:none}@media(prefers-reduced-motion:reduce){body{scroll-behavior:auto}}</style><main><h1>Visual fixture</h1><button id="toggle" onclick="document.querySelector(\'#panel\').hidden=false">Open details</button><p id="panel" hidden>Interaction passed</p><canvas width="200" height="120"></canvas><canvas id="gl" width="200" height="120"></canvas></main><script>const ctx=document.querySelector("canvas").getContext("2d");ctx.fillStyle="#305d89";ctx.fillRect(0,0,200,120);ctx.fillStyle="#e8be64";ctx.fillRect(30,20,100,60);const gl=document.querySelector("#gl").getContext("webgl",{preserveDrawingBuffer:true});gl.clearColor(0.2,0.4,0.6,1);gl.clear(gl.COLOR_BUFFER_BIT);gl.enable(gl.SCISSOR_TEST);gl.scissor(30,20,100,60);gl.clearColor(0.9,0.6,0.2,1);gl.clear(gl.COLOR_BUFFER_BIT);</script></html>';
    writeFileSync(join(dir, 'index.html'), html);
    const result = await debugSite(dir, { out: join(dir, 'review'), widths: [800], wait: 20, motion: 'both', actions: [{ type: 'click', selector: '#toggle' }, { type: 'expect-visible', selector: '#panel' }, { type: 'expect-text', selector: '#panel', text: 'Interaction passed' }] });
    assert.equal(result.results.length, 12);
    assert.ok(result.results.some(r => r.scroll > 1000));
    assert.ok(result.results.some(r => r.visual?.reducedMotion === true));
    assert.ok(result.results.some(r => r.visual?.canvases?.filter(c => c.uniform === false).length === 2));
    assert.equal(result.results.flatMap(r => r.actionErrors || []).length, 0);
    assert.ok(result.results.every(r => readFileSync(r.file).length > 100));
    assert.ok(readFileSync(result.file, 'utf8').includes('Website visual review'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('a browser network error never becomes a passing inspection', { skip: !findBrowser(), timeout: 90000 }, async () => {
  await assert.rejects(inspect('http://127.0.0.1:1/', { widths: [800], wait: 0 }), /Navigation failed/);
});

test('post-click exceptions, HTTP errors and visually hidden assertions fail the review', { skip: !findBrowser(), timeout: 90000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'visual-negative-'));
  try {
    writeFileSync(join(dir, 'index.html'), '<!doctype html><html><meta name="viewport" content="width=device-width"><button style="padding:20px" id="fail">Run</button><div style="opacity:0"><p id="secret">Hidden text</p></div><script>document.querySelector("#fail").onclick=()=>{fetch("/missing-data.json");throw new Error("click regression");};</script></html>');
    const result = await debugSite(dir, { out: join(dir, 'review'), widths: [800], wait: 20, motion: 'normal', scrolls: [0], actions: [{ type: 'click', selector: '#fail' }, { type: 'expect-visible', selector: '#secret' }] });
    assert.ok(result.results.some(r => r.console?.some(c => c.text.includes('click regression'))));
    assert.ok(result.results.some(r => r.network?.some(n => n.error.includes('HTTP 404'))));
    assert.ok(result.results.some(r => r.actionErrors?.some(e => e.includes('not visible'))));
    assert.ok(result.errors >= 3);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// bgOf() correctly gives up the moment it meets a background-image - a flat
// linear-gradient counts, same as a photo - so this is exactly the case the
// solid-colour contrast path could never see. Two boxes with the same "image"
// background: one text colour illegible against it, one legible. Only the
// illegible one should be reported, and it must say it came from the sample.
test('contrast against an image background is measured from the actual pixels', { skip: !findBrowser(), timeout: 90000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'visual-photo-contrast-'));
  try {
    const html = '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<div style="background:linear-gradient(#141414,#141414);padding:32px"><h2 style="color:#262626;font-size:16px;margin:0">Barely there</h2></div>' +
      '<div style="background:linear-gradient(#141414,#141414);padding:32px"><h2 style="color:#f5f5f5;font-size:16px;margin:0">Perfectly legible</h2></div>' +
      '</html>';
    writeFileSync(join(dir, 'index.html'), html);
    const result = await debugSite(dir, { out: join(dir, 'review'), widths: [800], wait: 60, motion: 'normal', scrolls: [0] });
    const found = result.results[0].contrast;
    const bad = found.find(c => c.el.includes('Barely there'));
    const good = found.find(c => c.el.includes('Perfectly legible'));
    assert.ok(bad, 'the illegible heading on the image background must be reported: ' + JSON.stringify(found));
    assert.equal(bad.method, 'photo');
    assert.ok(bad.ratio < bad.need);
    assert.equal(good, undefined, 'the legible heading must not be flagged');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('text clipped inside a scrolling panel is not an overlap; text painted over text still is', { skip: !findBrowser(), timeout: 90000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'visual-clipped-overlap-'));
  try {
    const rows = Array.from({ length: 12 }, (_, i) => '<p style="margin:0 0 6px">Scrolled list row number ' + (i + 1) + '</p>').join('');
    const html = '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<body style="margin:0;font:16px Georgia,serif;background:#111;color:#eee">' +
      '<div style="height:90px;overflow:auto;padding:8px">' + rows + '</div>' +
      '<p style="margin:0;padding:8px">Panel underneath the scrolling list</p>' +
      '<div style="position:relative;height:40px;margin-top:40px"><p style="position:absolute;top:0;left:8px;margin:0">First line that collides here</p>' +
      '<p style="position:absolute;top:4px;left:12px;margin:0">Second line painted on top</p></div></body></html>';
    writeFileSync(join(dir, 'index.html'), html);
    const result = await debugSite(dir, { out: join(dir, 'review'), widths: [800], wait: 60, motion: 'normal', scrolls: [0] });
    const overlaps = result.results[0].overlaps;
    assert.equal(overlaps.filter((o) => /Scrolled list row|Panel underneath/.test(o.a + o.b)).length, 0, 'clipped rows must not count: ' + JSON.stringify(overlaps));
    assert.ok(overlaps.some((o) => /First line|Second line/.test(o.a + o.b)), 'the real collision must still be reported: ' + JSON.stringify(overlaps));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// verify's whole point is reconciling audit + render/quality + security into
// one verdict. A page with a source-only defect (audit), a render defect
// (contrast) and nothing wrong with security should end up with an error in
// both of the first two sections, a clean third, and one exit code covering
// all of it.
test('verify merges audit, render and security into one verdict with one exit code', { skip: !findBrowser(), timeout: 90000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'verify-merge-'));
  try {
    // no <main>/<section>/<article> -> an audit ERROR; #222 on #141414 -> a
    // render/contrast warning; nothing here trips a high-severity security rule.
    writeFileSync(join(dir, 'index.html'),
      '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">' +
      '<title>Verify fixture</title><meta name="description" content="A fixture page long enough to pass the meta-description length check comfortably.">' +
      '<h1>Verify fixture</h1><div style="background:#141414;padding:24px"><p style="color:#222222">low contrast</p></div></html>');
    const result = await runVerify(dir, { out: join(dir, 'review'), widths: [800], wait: 60 });
    assert.equal(result.exitCode, 1);
    assert.ok(result.sections.audit.errors >= 1, 'audit should flag the missing <main>/<section>/<article>');
    assert.ok(result.sections.render.warns >= 1, 'render should flag the low-contrast text on the dark box');
    assert.ok(!result.sections.security.skipped);
    assert.equal(result.totals.error, result.sections.audit.errors + result.sections.render.errors + (result.sections.security.errors || 0));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('verify skips the source-only sections for a URL target instead of guessing', { skip: !findBrowser(), timeout: 90000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'verify-url-'));
  try {
    writeFileSync(join(dir, 'index.html'), '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>t</title><meta name="description" content="A fixture page long enough to pass the meta-description length check comfortably."><main><h1>t</h1></main></html>');
    const server = startServer(dir, 0);
    await once(server, 'listening');
    try {
      const url = 'http://127.0.0.1:' + server.address().port + '/';
      const result = await runVerify(url, { out: join(dir, 'review'), widths: [800], wait: 60 });
      assert.ok(result.sections.audit.skipped);
      assert.ok(result.sections.security.skipped);
      assert.ok(!result.sections.render.skipped);
    } finally { await new Promise((r) => server.close(r)); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// The fixture above asks for preserveDrawingBuffer itself, which is why the
// check passed while every real three.js hero read as blank: no library sets
// that flag, and a composited drawing buffer reads back as transparent black.
test('a WebGL canvas that never asked for a preserved buffer still reads as rendered', { skip: !findBrowser(), timeout: 90000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'visual-webgl-'));
  try {
    writeFileSync(join(dir, 'index.html'), '<!doctype html><html lang="en"><meta charset="utf-8"><style>canvas{display:block;width:300px;height:200px}</style><h1>WebGL</h1><canvas id="live" width="300" height="200"></canvas><canvas id="dead" width="300" height="200"></canvas><script>const gl=document.querySelector("#live").getContext("webgl");gl.clearColor(0.1,0.2,0.4,1);gl.clear(gl.COLOR_BUFFER_BIT);gl.enable(gl.SCISSOR_TEST);gl.scissor(40,30,120,90);gl.clearColor(0.9,0.7,0.3,1);gl.clear(gl.COLOR_BUFFER_BIT);</script></html>');
    const result = await debugSite(dir, { out: join(dir, 'review'), widths: [800], wait: 60, motion: 'normal', scrolls: [0] });
    const canvases = result.results[0].visual.canvases;
    const live = canvases.find(c => c.context === 'webgl' && c.uniform === false);
    assert.ok(live, 'a painted WebGL canvas must not read as a flat fill: ' + JSON.stringify(canvases));
    assert.ok(live.spread > 20, 'spread should measure the real range, got ' + live.spread);
    assert.equal(canvases.filter(c => c.uniform === true).length, 1, 'the untouched canvas must still be reported flat');
    assert.ok(canvases.every(c => c.readable === true));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

/* ------------------------------------------------------------------------
   The pixel sampler, on its own, with no browser. The bug this guards is a
   quiet one: the box handed to the sampler contains the GLYPHS as well as the
   ground, so a naive mean-and-spread over the whole patch reads white display
   type on a dark photograph as "too mixed to judge" and silently reports
   nothing - the exact case the sampler was added for. These build the pixels
   directly so the arithmetic is checked without a page in the way. */

// A minimal PNG encoder: only what decodePNG accepts (8-bit truecolour, no
// interlacing), so the test feeds the real decoder rather than a stub of it.
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
// paint(x, y) -> [r, g, b]
function makePNG(width, height, paint) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let p = 0;
  for (let y = 0; y < height; y++) {
    raw[p++] = 0; // filter: none, so the decoder's filter reversal is exercised too
    for (let x = 0; x < width; x++) { const [r, g, b] = paint(x, y); raw[p++] = r; raw[p++] = g; raw[p++] = b; }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}
// Ink on every fifth row, the way a line of type covers part of its box.
const withGlyphs = (ground, ink, every = 5) => (x, y) => (y % every === 0 ? ink : ground(x, y));

test('white type on a light scrim is measured through its own glyphs, not thrown away', () => {
  // A #9a9a9a ground with white ink over it. Measuring the whole patch, ink
  // included, puts its spread far past the "this is not one surface" cutoff
  // and the candidate is dropped in silence - so the check that exists to
  // find white type on a photograph finds nothing on the one page shaped
  // like the thing it was written for. The ground alone is 2.8:1.
  const png = decodePNG(makePNG(120, 40, withGlyphs(() => [0x9a, 0x9a, 0x9a], [255, 255, 255])));
  assert.ok(png, 'the encoder must produce something decodePNG accepts');
  const [hit] = sampleImageContrast(png, [{
    el: 'p "scrim"', fg: { r: 255, g: 255, b: 255 }, need: 4.5, size: 16,
    rect: { left: 0, top: 0, width: 120, height: 40 },
  }]);
  assert.ok(hit, 'white body copy on a mid-grey ground must be reported');
  assert.equal(hit.method, 'photo');
  assert.ok(hit.ratio > 2.6 && hit.ratio < 3.0, 'the ground, not the ink, sets the ratio: ' + hit.ratio);
});

test('white type on a dark photograph is left alone', () => {
  const png = decodePNG(makePNG(120, 40, withGlyphs(() => [0x12, 0x12, 0x12], [255, 255, 255])));
  assert.equal(sampleImageContrast(png, [{
    el: 'h1 "legible"', fg: { r: 255, g: 255, b: 255 }, need: 3, size: 56,
    rect: { left: 0, top: 0, width: 120, height: 40 },
  }]).length, 0);
});

test('a box spanning a hard edge in the photo is reported as nothing at all', () => {
  // Mid-grey display type with half its box on black and half on white.
  // Contrast is not monotonic in background luminance - it bottoms out where
  // the ground matches the text - so averaging the two halves produces 1:1,
  // a catastrophic failure that exists nowhere on the page: the dark half is
  // 5.3:1 and the light half 3.9:1, and both clear the 3:1 a 56px face needs.
  // This is the false failure the ambiguity guard is for.
  const png = decodePNG(makePNG(120, 40, (x) => (x < 60 ? [0, 0, 0] : [255, 255, 255])));
  assert.equal(sampleImageContrast(png, [{
    el: 'h1 "edge"', fg: { r: 128, g: 128, b: 128 }, need: 3, size: 56,
    rect: { left: 0, top: 0, width: 120, height: 40 },
  }]).length, 0);
});

test('the worst region is the one with the least contrast, not the darkest one', () => {
  // A vertical ease from near-black to light grey under white type. The
  // darkest tenth is the SAFEST tenth here; reporting it as "at its worst"
  // is the reassuring wrong answer.
  const png = decodePNG(makePNG(120, 60, withGlyphs((x, y) => { const v = 120 + Math.round((y / 59) * 60); return [v, v, v]; }, [255, 255, 255])));
  const [hit] = sampleImageContrast(png, [{
    el: 'h1 "ease"', fg: { r: 255, g: 255, b: 255 }, need: 4.5, size: 16,
    rect: { left: 0, top: 0, width: 120, height: 60 },
  }]);
  assert.ok(hit, 'white 16px type on a mid-grey ease must be reported');
  assert.ok(hit.worstRatio < hit.ratio, `worst (${hit.worstRatio}) must be below the average (${hit.ratio}) for light type on a lightening ground`);
});

// The sampler only ever sees a candidate because bgOf() refused to guess. The
// end-to-end shape of that: white display type over a real eased scrim, which
// is the house style's single most likely legibility failure.
test('white display type on an eased scrim is caught end to end', { skip: !findBrowser(), timeout: 90000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'visual-scrim-'));
  try {
    writeFileSync(join(dir, 'index.html'),
      '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<style>body{margin:0}.hero{background:linear-gradient(180deg,#0a0a0a 0%,#dedede 100%);height:400px;display:flex;align-items:flex-end;padding:24px}' +
      'h1{color:#fff;font-size:56px;margin:0}</style><div class="hero"><h1>Light end of the ease</h1></div></html>');
    const [r] = await inspect('file:///' + join(dir, 'index.html').split(sep).join('/'), { widths: [900], wait: 120, scrolls: [0] });
    const hit = r.contrast.find((c) => c.el.includes('Light end of the ease'));
    assert.ok(hit, 'white type over the light end of a scrim must be reported: ' + JSON.stringify(r.contrast));
    assert.equal(hit.method, 'photo');
    assert.ok(hit.ratio < hit.need);
    assert.equal(r.imageCandidates, undefined, 'the candidate list is internal and must not leak into the report');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// One verdict means the reader sees the worst thing first without knowing
// which checker produced it. Grouping the output by section instead - which
// is how each of these already prints on its own - is the thing verify exists
// to stop, so assert the order is severity's and not the sections'.
test('verify prints one verdict ordered by severity, each finding naming its section', () => {
  const text = formatVerify({
    target: 'site',
    sections: {
      audit: { errors: 1, warns: 0, findings: [{ severity: 'error', text: 'no <main>' }] },
      security: { errors: 0, warns: 1, findings: [{ severity: 'note', text: 'check headers after deploy' }, { severity: 'warning', text: 'unpinned CDN script' }] },
      render: { errors: 0, warns: 1, findings: [{ severity: 'warning', text: 'contrast 2.1:1' }] },
    },
    totals: { error: 1, warning: 2, low: 0, note: 1 },
    exitCode: 1,
  });
  const at = (needle) => text.indexOf(needle);
  assert.ok(at('no <main>') > -1 && at('unpinned CDN script') > -1 && at('check headers after deploy') > -1);
  assert.ok(at('no <main>') < at('unpinned CDN script'), 'errors come before warnings');
  assert.ok(at('unpinned CDN script') < at('check headers after deploy'), 'warnings come before notes');
  assert.ok(at('contrast 2.1:1') < at('check headers after deploy'), 'a render warning outranks a security note');
  assert.match(text, /ERROR \[audit\] no <main>/);
  assert.match(text, /warn {2}\[render\] contrast 2\.1:1/);
  assert.match(text, /1 error\(s\), 2 warning\(s\), 0 low, 1 note\(s\)/);
});

test('verify says which sections it could not run, and says so even when nothing was found', () => {
  const text = formatVerify({
    target: 'https://example.com/',
    sections: {
      audit: { skipped: 'a URL target has no source files to audit' },
      security: { skipped: 'a URL target has no source files to scan' },
      render: { errors: 0, warns: 0, findings: [] },
    },
    totals: { error: 0, warning: 0, low: 0, note: 0 },
    exitCode: 0,
  });
  assert.match(text, /skipped audit: a URL target has no source files to audit/);
  assert.match(text, /skipped security:/);
  assert.match(text, /ok {4}nothing found in render/,
    'a clean run has to say what it actually checked, or "nothing found" reads as "nothing ran"');
});

/* The browser is discovered by polling for DevToolsActivePort, and Chrome
   creates that file before it writes the port into it. Reading it once and
   letting the error out is a launch that fails at random - EBUSY on Windows
   while Chrome still holds the handle - and it is the reason a run with
   several browser tests in flight would kill one of them for no reason. Every
   "not readable yet" shape has to come back as "keep waiting". */
test('a half-written or unreadable DevToolsActivePort means keep waiting, not crash', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cdp-port-'));
  try {
    assert.equal(readPortFile(join(dir, 'DevToolsActivePort')), null, 'absent');
    writeFileSync(join(dir, 'empty'), '');
    assert.equal(readPortFile(join(dir, 'empty')), null, 'created but not yet written');
    writeFileSync(join(dir, 'partial'), '\n/devtools/browser/abc');
    assert.equal(readPortFile(join(dir, 'partial')), null, 'first line not there yet');
    writeFileSync(join(dir, 'junk'), 'not-a-port\n');
    assert.equal(readPortFile(join(dir, 'junk')), null, 'not a number');
    // A directory read throws EISDIR; that is the same class as EBUSY - the
    // point is that no read error escapes.
    assert.equal(readPortFile(dir), null, 'an unreadable path must not throw');
    writeFileSync(join(dir, 'good'), '54321\n/devtools/browser/abc\n');
    assert.equal(readPortFile(join(dir, 'good')), 54321);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('inspect reads computed type, loaded fonts, the type scale and resources from a live page', { skip: !findBrowser(), timeout: 45000 }, async () => {
  // The Elements panel on demand: this is reference data, so every field a
  // teardown would copy by hand has to come back populated and typed.
  const server = startServer(new URL('./fixtures', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), 0);
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const url = 'http://127.0.0.1:' + server.address().port + '/clean-basic.html';
    const r = await inspectStyles(url, { selector: 'h1,p', width: 1200, wait: 300 });
    assert.equal(r.url, url);
    assert.equal(r.width, 1200);
    assert.ok(r.elements.length >= 1, 'the selector matched nothing: ' + JSON.stringify(r.elements));
    for (const el of r.elements) {
      assert.match(el.style.fontSize, /px$/, 'computed size is in px');
      assert.match(el.style.fontFamily, /./, 'a family is reported');
      assert.ok(el.rect.w > 0 && el.rect.h > 0, 'a painted box');
    }
    assert.ok(Array.isArray(r.fonts), 'fonts is a list');
    assert.ok(r.typeScale.length >= 1 && r.typeScale.every((t) => t.px > 0 && t.count > 0), 'the scale is sizes with counts');
    assert.ok(r.palette.length >= 1, 'colours were counted');
    assert.ok(r.resources.some((x) => x.url.endsWith('/clean-basic.html')), 'the page itself is in the resource list');
    const text = formatInspect(r);
    assert.match(text, /type scale/);
    assert.match(text, /resources/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

/* Temporary browser profiles. Every launch makes one under %TEMP% and until
   2026-09-26 almost none of them were ever deleted on Windows: the cleanup
   was `setTimeout(() => rmSync(udd), 400)` after a kill, which threw EBUSY
   into an empty catch while the browser still had the files open, and never
   ran at all in a CLI that exited first. Gev's %TEMP% gave up 1,647 stray
   webdesign-cdp-* folders in one sweep and 572 more the next evening. */
const tempProfiles = (dir = tmpdir()) => new Set(readdirSync(dir).filter((n) => n.startsWith(PROFILE_PREFIX)));

test('a finished run of the render check leaves no temporary browser profile behind', { skip: !findBrowser(), timeout: 180000 }, async () => {
  // The contract is about a finished run, so this drives the real CLI in a
  // child process and waits for it to exit: a browser can recreate its own
  // profile folder AFTER the delete that reported success (Ubuntu CI,
  // 2026-09-26), and what closeBrowser cannot catch in time it takes away at
  // exit. Asserting inside this process would measure the wrong promise.
  //
  // The CLI gets a temp directory of its own. CI runs the test files in
  // parallel, and counting the shared one blamed this run for the live
  // profiles of browsers other files had open: the holder it named was a
  // running Chrome whose parent was still alive (CI, 2026-09-26, on 5480e0d
  // and every commit after it, on both runners).
  const dir = mkdtempSync(join(tmpdir(), 'ufs-profile-leak-'));
  const privateTmp = join(dir, 'tmp');
  mkdirSync(privateTmp);
  writeFileSync(join(dir, 'index.html'), '<!doctype html><html lang="en"><meta charset="utf-8"><title>Leak</title>' +
    '<body style="font:16px system-ui;padding:16px"><h1>Leak check</h1><p>One paragraph, one heading.</p></body></html>');
  try {
    const cli = spawn(process.execPath, [join(ROOT_DIR, 'scripts', 'webdesign.mjs'), 'look', dir, '--widths', '900', '--out', join(dir, 'shots')],
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, TMPDIR: privateTmp, TEMP: privateTmp, TMP: privateTmp } });
    let out = '';
    cli.stdout.on('data', (d) => { out += d; });
    cli.stderr.on('data', (d) => { out += d; });
    // 'close', not 'exit': exit fires before the pipes have drained, so the
    // tail of the report is not there yet.
    const [code] = await once(cli, 'close');
    assert.equal(code, 0, 'look failed: ' + out.slice(-400));
    assert.match(out, /\d+ error\(s\), \d+ warning\(s\)/, 'look printed a report: ' + out.slice(-300));
    // A child given this environment really does make its temp folders in the
    // private directory, or an empty result below would prove nothing.
    const seen = spawnSync(process.execPath, ['-e', 'process.stdout.write(require("os").tmpdir())'],
      { encoding: 'utf8', env: { ...process.env, TMPDIR: privateTmp, TEMP: privateTmp, TMP: privateTmp } }).stdout;
    assert.equal(seen, privateTmp, 'the child would not use the private temp directory');
    const added = [...tempProfiles(privateTmp)];
    const why = added.map((n) => {
      const path = join(privateTmp, n);
      // Who still holds it, where the question can be asked cheaply.
      const ps = process.platform === 'win32' ? '' : (spawnSync('ps', ['-ww', '-ax', '-o', 'pid=,ppid=,command='], { encoding: 'utf8' }).stdout || '')
        .split('\n').filter((l) => l.includes(n)).map((l) => l.trim().slice(0, 160)).join(' | ');
      try { return n + ' (last written ' + Math.round((Date.now() - statSync(path).mtimeMs) / 100) / 10 + 's ago, ' + readdirSync(path).length + ' entries' + (ps ? '; held by: ' + ps : '') + ')'; }
      catch { return n + ' (it went away while we looked)'; }
    }).join('; ');
    assert.deepEqual(added, [], 'the run left ' + added.length + ' profile(s) in its temp directory: ' + why);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('closeBrowser ends the browser, deletes its profile, and reports that it is gone', { skip: !findBrowser(), timeout: 120000 }, async () => {
  const b = await launch(findBrowser());
  assert.equal(existsSync(b.udd), true, 'the profile is made at launch');
  assert.equal(await closeBrowser(b), true, 'the profile was still there after closeBrowser: ' + b.udd);
  assert.equal(existsSync(b.udd), false, b.udd);
  // Closing twice is not an error: every caller runs it from a finally block.
  assert.equal(await closeBrowser(b), true);
  assert.equal(await closeBrowser(null), true);
});

test('removeProfile deletes a profile folder and treats an absent one as done', async () => {
  const dir = mkdtempSync(join(tmpdir(), PROFILE_PREFIX));
  writeFileSync(join(dir, 'Local State'), '{}');
  mkdirSync(join(dir, 'Default'));
  writeFileSync(join(dir, 'Default', 'Preferences'), '{}');
  assert.equal(await removeProfile(dir, 2000), true);
  assert.equal(existsSync(dir), false);
  assert.equal(await removeProfile(dir, 2000), true, 'an absent folder is not a failure');
  assert.equal(await removeProfile(null), true, 'nothing to remove is not a failure');
});

test('the launch sweep clears stale profiles only: fresh ones, other folders and the cap are respected', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ufs-sweep-'));
  try {
    const make = (name, ageMs) => {
      const path = join(dir, name);
      mkdirSync(path);
      writeFileSync(join(path, 'Local State'), '{}');
      const when = new Date(Date.now() - ageMs);
      utimesSync(path, when, when);
      return path;
    };
    const stale = [make(PROFILE_PREFIX + 'aaaaaa', 7200000), make(PROFILE_PREFIX + 'bbbbbb', 7200000)];
    const fresh = make(PROFILE_PREFIX + 'cccccc', 0);
    const other = make('webdesign-review-dddddd', 7200000);
    const removed = await sweepProfiles({ dir });
    assert.deepEqual(removed.sort(), [...stale].sort());
    assert.equal(existsSync(fresh), true, 'a profile a running check could still own must survive');
    assert.equal(existsSync(other), true, 'only temporary profiles are swept, never other temp folders');
    // The cap is what keeps a backlog of hundreds from stalling a launch.
    const many = Array.from({ length: 5 }, (_, i) => make(PROFILE_PREFIX + 'e' + i + 'aaaa', 7200000));
    assert.equal((await sweepProfiles({ dir, limit: 2 })).length, 2);
    assert.equal(many.filter((path) => existsSync(path)).length, 3);
    // A folder that cannot be read is not a crash: there is nothing to sweep.
    assert.deepEqual(await sweepProfiles({ dir: join(dir, 'does-not-exist') }), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

/* One profile in a full suite survived every wait (a virus scanner reading a
   brand-new folder is the usual cause on Windows) and deleted in 88 ms once
   the run was over. closeBrowser remembers that folder and deletes it as the
   process exits; this is that last pass, called directly. */
test('a profile that outlasted every wait is deleted as the run ends', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ufs-flush-'));
  try {
    const left = [PROFILE_PREFIX + 'aaaaaa', PROFILE_PREFIX + 'bbbbbb'].map((name) => {
      const path = join(dir, name);
      mkdirSync(path);
      writeFileSync(join(path, 'Local State'), '{}');
      return path;
    });
    assert.deepEqual(flushProfiles(left), [], 'nothing should be left');
    assert.equal(left.filter((path) => existsSync(path)).length, 0);
    // A folder already gone is not a failure, and the list is never the excuse.
    assert.deepEqual(flushProfiles(left), []);
    assert.deepEqual(flushProfiles([]), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

/* The same lesson one folder along: debugSite() with no `out` mkdtemps a
   webdesign-review-* folder in the temp dir for its screenshots, which is
   right for a user (they are told to read the PNGs) and wrong for a test that
   never deletes it. runVerify() goes through debugSite() too, so it takes the
   same `out`. Four such folders per suite run (two debugSite tests, two verify
   tests): 74 of them were on Gev's machine on 2026-09-25, every one a test
   fixture. Every test names its own output folder inside the fixture
   directory it already removes. The call is read to its closing `);` so a
   call split over several lines is still checked. */
test('no test asks for a review folder in the temp directory it never deletes', () => {
  let calls = 0;
  for (const file of readdirSync(join(ROOT_DIR, 'test')).filter((n) => n.endsWith('.test.mjs'))) {
    const text = readFileSync(join(ROOT_DIR, 'test', file), 'utf8');
    for (const m of text.matchAll(/await (debugSite|runVerify)\(([^;]*?)\);/g)) {
      calls++;
      const line = text.slice(0, m.index).split('\n').length;
      assert.match(m[2], /\bout:/, file + ':' + line + ': ' + m[1] + ' with no out: leaves a folder in ' + tmpdir() + ' that nothing removes');
    }
  }
  assert.ok(calls >= 8, 'the scan found only ' + calls + ' calls; the pattern no longer matches how the tests call these');
});

/* One folder further out: Edge's component updater writes msedge_url_fetcher_*
   and msedge_chrome_Unpacker_* folders straight into the temp directory, not
   into the profile, so no profile delete reaches them. Four launches left 3
   and 2 of them without --disable-component-update and none with it
   (2026-09-26); 1,526 were on the machine. Counting them inside a test would
   also count every other browser on a shared machine, so this holds the flag
   and the measurement stays in the comment above LAUNCH_FLAGS. */
test('every launch turns off the component updater that leaves msedge_* folders in the temp directory', () => {
  assert.ok(LAUNCH_FLAGS.includes('--disable-component-update'), JSON.stringify(LAUNCH_FLAGS));
  assert.ok(LAUNCH_FLAGS.includes('--headless=new'), 'LAUNCH_FLAGS is the list launch() spawns with');
});
