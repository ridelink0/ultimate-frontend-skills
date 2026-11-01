// The browser half, against pages served from this process so every number
// is known in advance. Skips only when no Chrome, Edge or Chromium exists;
// CI installs one and fails the job on any skip, so there it always runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { deflateSync } from 'node:zlib';
import { findBrowser, launch, withBrowser, load } from '../skills/image-deep-research/scripts/browser.mjs';
import { study, formatSiteCompact } from '../skills/image-deep-research/scripts/study.mjs';
import { renderSheets, CELL_W } from '../skills/image-deep-research/scripts/sheet.mjs';

const noBrowser = !findBrowser();
const paras = Array.from({ length: 30 }, (_, i) => `<p>Paragraph ${i + 1} of the reference page, long enough to read.</p>`).join('\n');
const PAGES = {
  '/ref': `<!doctype html><meta charset="utf-8"><title>Ref</title>
<style>html,body{margin:0;background:#1d2a3a;color:#f2e8d5;font-family:Arial,sans-serif;font-size:18px}
h1{font-family:Georgia,serif;font-size:64px;font-weight:400;margin:0;padding:40px}
p{margin:0 40px 40px}</style><h1>A reference heading</h1>${paras}`,
  '/wall': '<!doctype html><title>Just a moment</title><p>Checking your browser.</p>',
  '/oklch': `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:oklch(0.3 0.05 250);color:oklch(0.95 0.02 85)}</style>${paras}`,
  '/hidden': `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Visible evidence</title>
    <style>body{margin:0;background:#203040;color:#f0e0d0}h1{font:40px Georgia}p{margin:0;padding:40px;height:150px}
    @media(prefers-reduced-motion:reduce){body{background:#304020}}</style>
    <section style="opacity:0;position:absolute;width:1px;height:1px;overflow:hidden"><h1 style="font-size:200px">Invisible title</h1><p>Verify you are human</p><canvas></canvas></section>
    <main><h1>Visible heading</h1>${paras}</main>`,
};

/* A small RGB PNG, so a sheet has real pictures to tile: a diagonal
   gradient in one hue per tile with a light block and a dark bar on it. */
const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function png(w, h, seed) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  const hue = [(seed * 67) % 256, (seed * 131 + 60) % 256, (seed * 29 + 120) % 256];
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const t = (x + y) / (w + h);
      const block = x > w * 0.2 && x < w * 0.55 && y > h * 0.25 && y < h * 0.7;
      const bar = y > h * 0.8 && y < h * 0.86;
      for (let c = 0; c < 3; c++) raw[y * (w * 3 + 1) + 1 + x * 3 + c] = bar ? 20 : block ? 235 - c * 20 : Math.round(hue[c] * (0.35 + 0.65 * t));
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function jpegSize(buf) {
  assert.equal(buf.readUInt16BE(0), 0xffd8, 'not a JPEG');
  for (let i = 2; i < buf.length - 9;) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    if (marker >= 0xc0 && marker <= 0xc3) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    i += 2 + buf.readUInt16BE(i + 2);
  }
  throw new Error('no SOF marker');
}

let server, base, out;
test.before(async () => {
  if (noBrowser) return;
  server = createServer((req, res) => {
    const body = PAGES[req.url.split('?')[0]];
    res.writeHead(body ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' });
    res.end(body || 'not found');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  out = mkdtempSync(join(tmpdir(), 'idr-test-'));
});
test.after(() => {
  if (server) server.close();
  if (out) rmSync(out, { recursive: true, force: true });
});

test('study measures grounds, ink and type, captures both scroll positions, and keeps a wall off the sheet', { skip: noBrowser && 'no browser' }, async () => {
  const report = await study([`${base}/ref`, `${base}/wall`, `${base}/oklch`], { out, wait: 300 });
  const [ref, wall, ok] = report.sites;

  assert.equal(ref.status, 'ok', ref.note);
  assert.equal(ref.probe.grounds[0].color, '#1d2a3a');
  assert.equal(ref.probe.inks[0].color, '#f2e8d5');
  assert.match(ref.probe.type.heading.family, /Georgia/);
  assert.equal(ref.probe.type.heading.size, '64px');
  assert.match(ref.probe.type.body.family, /Arial/);
  assert.equal(ref.probe.textElements, 31);
  assert.deepEqual(ref.shots.map((s) => [s.scroll, s.reached]), [[0, 0], [900, 900]]);
  for (const s of ref.shots) assert.equal(readFileSync(s.file).readUInt32BE(0), 0x89504e47, 'screenshot is not a PNG');

  assert.equal(wall.status, 'wall');
  assert.match(wall.note, /blocked: the page title is "Just a moment"/);

  // A CSS Color 4 value comes back as plain hex, not as rgb(0, 0, 250).
  assert.equal(ok.status, 'ok');
  assert.match(ok.probe.grounds[0].color, /^#[0-9a-f]{6}$/);
  assert.notEqual(ok.probe.grounds[0].color, '#0000fa');

  // Two sites rendered, two shots each: one sheet, four tiles, one row of four.
  assert.equal(report.sheets.length, 1);
  const tiles = report.sheets[0].tiles;
  assert.equal(tiles.length, 4);
  assert.ok(tiles.every((t) => t.loaded), 'a tile did not load');
  assert.ok(tiles.every((t) => !t.label.includes('/wall')), 'the wall reached the sheet');
  const size = jpegSize(readFileSync(report.sheets[0].file));
  assert.equal(size.w, 4 * CELL_W + 5 * 6);
  assert.ok(size.h > 400 && size.h < 460, 'sheet height ' + size.h);
  assert.ok(existsSync(join(out, 'report.json')));
});

test('renderSheets reports a tile that failed to load instead of leaving it grey', { skip: noBrowser && 'no browser' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'idr-sheet-'));
  try {
    // A 1x1 PNG, valid, and a path that does not exist.
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    writeFileSync(join(dir, 'one.png'), png);
    const sheets = await withBrowser((s) => renderSheets(s, [{ src: join(dir, 'one.png'), label: 'real' }, { src: join(dir, 'missing.png'), label: 'gone' }], { out: dir }));
    assert.deepEqual(sheets[0].tiles.map((t) => t.loaded), [true, false]);
    assert.equal(jpegSize(readFileSync(sheets[0].file)).w, 2 * CELL_W + 3 * 6);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('study excludes hidden ancestors and records responsive reduced-motion evidence for every shot', { skip: noBrowser && 'no browser' }, async () => {
  const report = await study([`${base}/hidden`], { out: join(out, 'evidence'), width: 390, wait: 100, reducedMotion: true });
  const site = report.sites[0];
  assert.equal(site.status, 'ok', site.note);
  assert.equal(site.probe.type.heading.text, 'Visible heading');
  assert.equal(site.probe.type.heading.size, '40px');
  assert.equal(site.probe.canvases, 0);
  assert.doesNotMatch(site.probe.text, /Verify you are human|Invisible title/);
  assert.equal(report.reducedMotion, true);
  assert.match(report.evidence, /still captures only/);
  for (const shot of site.shots) {
    assert.equal(shot.probe.viewport.width, 390);
    assert.equal(shot.probe.viewport.scroll, shot.reached);
    assert.equal(shot.probe.reducedMotion, true);
    assert.equal(shot.probe.grounds[0].color, '#304020');
    assert.ok(Number.isFinite(Date.parse(shot.capturedAt)));
    assert.match(shot.probe.measurementMethod, /not pixel sampling/);
  }
});

// Every name the browser leaves in the temp directory is a leak, whoever named
// it: Edge wrote Importer_0_4, cv_debug.log and msedge_url_fetcher_* there on
// v1.0.0. The run gets a temp directory of its own and must leave it empty.
test('a browser run that loads a page leaves nothing at all in its temp directory', { skip: noBrowser && 'no browser' }, async () => {
  const own = mkdtempSync(join(tmpdir(), 'idr-leak-'));
  const saved = { TEMP: process.env.TEMP, TMP: process.env.TMP, TMPDIR: process.env.TMPDIR };
  process.env.TEMP = process.env.TMP = process.env.TMPDIR = own;
  try {
    await withBrowser(async (s) => {
      await load(s, base + '/ref', { wait: 1500 });
    });
    await new Promise((r) => setTimeout(r, 1000));
    assert.deepEqual(readdirSync(own), [], 'left in the temp directory');
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    rmSync(own, { recursive: true, force: true });
  }
});

test('close() ends the browser it started', { skip: noBrowser && 'no browser' }, async () => {
  const b = await launch();
  const alive = await fetch(`http://127.0.0.1:${b.port}/json/version`).then((r) => r.ok, () => false);
  assert.equal(alive, true);
  await b.close();
  const after = await fetch(`http://127.0.0.1:${b.port}/json/version`, { signal: AbortSignal.timeout(1000) }).then((r) => r.ok, () => false);
  assert.equal(after, false, 'the browser still answers after close()');
  assert.equal(existsSync(b.udd), false, 'the temporary profile was left behind');
});

// --compact: sixteen tiles, one 1288 x 812 sheet (46 x 29 patches, 1,334 image
// tokens) and no more than 150,000 bytes, so a Read never downscales it.
test('a compact moodboard of 16 local tiles is one 1288x812 JPEG of at most 150,000 bytes', { skip: noBrowser && 'no browser' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'idr-compact-'));
  try {
    const items = Array.from({ length: 16 }, (_, i) => {
      const file = join(dir, `tile${i + 1}.png`);
      writeFileSync(file, png(i % 3 ? 640 : 400, i % 3 ? 400 : 600, i + 1));
      return { n: i + 1, src: file, label: 'tile ' + (i + 1) };
    });
    const sheets = await withBrowser((s) => renderSheets(s, items, { out: dir, prefix: 'moodboard', fit: 'contain', compact: true }));
    assert.equal(sheets.length, 1);
    const [sheet] = sheets;
    const buf = readFileSync(sheet.file);
    assert.deepEqual(jpegSize(buf), { w: 1288, h: 812 });
    assert.ok(buf.length <= 150000, buf.length + ' bytes');
    assert.deepEqual([sheet.w, sheet.h, sheet.tokens, sheet.bytes], [1288, 812, 1334, buf.length]);
    assert.ok([80, 70, 60].includes(sheet.quality));
    assert.deepEqual(sheet.tiles.map((t) => t.n), items.map((t) => t.n));
    assert.ok(sheet.tiles.every((t) => t.loaded), 'a tile did not load');
    assert.doesNotMatch(readFileSync(join(dir, '_moodboard1.html'), 'utf8'), /figcaption/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a compact study of 8 pages at 2 scrolls is one sheet, and one line per site', { skip: noBrowser && 'no browser' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'idr-cstudy-'));
  try {
    const urls = Array.from({ length: 8 }, (_, i) => `${base}/ref?site=${i + 1}`);
    const lines = [];
    const report = await study(urls, { out: dir, wait: 100, compact: true, log: (site, i) => lines.push(formatSiteCompact(site, i)) });
    assert.ok(report.sites.every((s) => s.status === 'ok'));
    assert.equal(report.sheets.length, 1);
    const [sheet] = report.sheets;
    assert.equal(sheet.tiles.length, 16);
    assert.deepEqual(jpegSize(readFileSync(sheet.file)), { w: 1288, h: 812 });
    assert.equal(sheet.tokens, 1334);
    assert.ok(sheet.bytes <= 150000, sheet.bytes + ' bytes');
    const html = readFileSync(join(dir, '_sheet1.html'), 'utf8');
    assert.match(html, /<span>s01<\/span>/);
    assert.match(html, /<span>s08 y900<\/span>/);
    assert.equal(lines.length, 8);
    for (const l of lines) assert.ok(l.length <= 160, l);
    assert.match(lines[0], /^s01 ok 127\.0\.0\.1:\d+ \| ground #1d2a3a [\d.]+% \| ink #f2e8d5 [\d.]+% \| heading Georgia 64\/[\w.]+ w400 \| body Arial 18\/[\w.]+ w400$/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
