// The pure parts of the scripts: flag parsing, the four API parsers against
// real responses recorded on 2026-09-25 (test/fixtures), the licence filter,
// the URL check, and the sheet layout. No network, no browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, int } from '../skills/image-deep-research/scripts/args.mjs';
import { parseOpenverse, parseCommons, parseAic, parseMetObject, commercialOk, verifyImage, searchImages, SEARCH,
  numberResults, formatTable, formatCompact, formatPick } from '../skills/image-deep-research/scripts/images.mjs';
import { planSheets, sheetHtml, PER_SHEET, PATCH, visionTokens, COMPACT, sheetSize, underBytes } from '../skills/image-deep-research/scripts/sheet.mjs';
import { LISTS, slugFor, classify, formatSiteCompact } from '../skills/image-deep-research/scripts/study.mjs';
import { findBrowser, launchArgs } from '../skills/image-deep-research/scripts/browser.mjs';

const fx = (name) => JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/' + name, import.meta.url)), 'utf8'));

test('parseArgs: values, =values, switches, and a value flag with no value is an error', () => {
  const { positional, flags } = parseArgs(['a b', '--n', '3', '--out=x/y', '--sheet', 'more'], { switches: ['sheet'] });
  assert.deepEqual(positional, ['a b', 'more']);
  assert.deepEqual(flags, { n: '3', out: 'x/y', sheet: true });
  assert.throws(() => parseArgs(['--n']), /--n needs a value/);
  assert.throws(() => parseArgs(['--n', '--sheet'], { switches: ['sheet'] }), /--n needs a value/);
  assert.equal(int(undefined, 6), 6);
  assert.equal(int('4', 6, { min: 1, max: 20 }), 4);
  assert.throws(() => int('0', 6, { min: 1, max: 20 }), /between 1 and 20/);
  assert.throws(() => int('2.5', 6), /whole number/);
});

test('parseOpenverse keeps url, creator, licence and landing page for every result', () => {
  const rows = parseOpenverse(fx('openverse.json'));
  assert.ok(rows.length >= 1);
  for (const r of rows) {
    assert.equal(r.source, 'openverse');
    assert.match(r.url, /^https?:\/\//);
    assert.ok(r.licence, 'licence missing for ' + r.url);
    assert.match(r.licenceUrl, /creativecommons\.org/);
    assert.match(r.page, /^https?:\/\//);
  }
  const one = parseOpenverse({ results: [{ url: 'https://x/1.jpg', license: 'by-nc-sa', license_version: '2.0' }, { url: 'https://x/2.jpg', license: 'cc0' }, { license: 'by' }] });
  assert.deepEqual(one.map((r) => r.licence), ['CC BY-NC-SA 2.0', 'CC0']);
});

test('parseCommons reads extmetadata, strips markup and the hidden QuickStatements spans, keeps search order', () => {
  const rows = parseCommons(fx('commons.json'));
  assert.ok(rows.length >= 1);
  for (const r of rows) {
    assert.equal(r.source, 'commons');
    assert.match(r.url, /^https:\/\/(upload|thumb)\.wikimedia\.org\//);
    assert.ok(r.licence);
    assert.doesNotMatch(r.title + r.creator, /<|QS:P\d/);
    assert.match(r.page, /commons\.wikimedia\.org\/wiki\/File:/);
  }
  const made = parseCommons({ query: { pages: {
    b: { index: 2, title: 'File:Second.png', imageinfo: [{ url: 'https://upload.wikimedia.org/2.png', mime: 'image/png', extmetadata: {} }] },
    a: { index: 1, title: 'File:First.jpg', imageinfo: [{ url: 'https://upload.wikimedia.org/1.jpg', mime: 'image/jpeg', extmetadata: {
      ObjectName: { value: 'Cypress Trees<span style="display: none;">title QS:P1476,en:"Cypress Trees"</span>' },
      Artist: { value: '<a href="//commons.wikimedia.org/wiki/User:X">Someone &amp; Co</a>' }, LicenseShortName: { value: 'CC BY-SA 4.0' } } }] },
    c: { index: 3, title: 'File:Doc.pdf', imageinfo: [{ url: 'https://upload.wikimedia.org/3.pdf', mime: 'application/pdf' }] },
  } } });
  assert.deepEqual(made.map((r) => r.title), ['Cypress Trees', 'Second.png']);
  assert.equal(made[0].creator, 'Someone & Co');
});

test('parseAic keeps only public-domain works and builds the IIIF URL from the response config', () => {
  const raw = fx('aic.json');
  const rows = parseAic(raw);
  assert.equal(rows.length, raw.data.filter((d) => d.is_public_domain && d.image_id).length);
  for (const r of rows) {
    assert.match(r.url, /^https:\/\/www\.artic\.edu\/iiif\/2\/[0-9a-f-]+\/full\/843,\/0\/default\.jpg$/);
    assert.match(r.licence, /CC0/);
    assert.match(r.page, /^https:\/\/www\.artic\.edu\/artworks\/\d+$/);
  }
});

test('parseMetObject keeps Open Access objects with an image and nothing else', () => {
  for (const f of ['met-object.json', 'met-object-2.json']) {
    const r = parseMetObject(fx(f));
    assert.ok(r, f);
    assert.match(r.url, /^https:\/\/images\.metmuseum\.org\//);
    assert.match(r.licence, /CC0/);
  }
  assert.equal(parseMetObject({ isPublicDomain: false, primaryImageSmall: 'https://x/1.jpg' }), null);
  assert.equal(parseMetObject({ isPublicDomain: true, primaryImageSmall: '' }), null);
  assert.equal(parseMetObject(null), null);
});

test('commercialOk allows CC0, public domain, BY and BY-SA and refuses NC, ND and unknown', () => {
  for (const ok of ['CC0', 'CC0 (public domain)', 'PDM', 'Public domain', 'CC BY 2.0', 'CC BY-SA 4.0', 'CC0 (Met Open Access)']) assert.equal(commercialOk(ok), true, ok);
  for (const no of ['CC BY-NC-SA 2.0', 'CC BY-ND 4.0', 'CC BY-NC 3.0', '', 'All rights reserved', 'GFDL']) assert.equal(commercialOk(no), false, no);
});

const fake = (answers) => {
  const calls = [];
  const impl = async (url, init) => {
    calls.push(init.method + (init.headers.range ? ' ranged' : ''));
    const a = answers[calls.length - 1];
    if (a instanceof Error) throw a;
    return { status: a[0], headers: new Headers({ 'content-type': a[1] }), body: null };
  };
  return { impl, calls };
};

test('verifyImage: HEAD first, a ranged GET when HEAD is refused, and only an image counts', async () => {
  let f = fake([[200, 'image/jpeg']]);
  assert.equal((await verifyImage('https://x/a.jpg', { fetchImpl: f.impl })).ok, true);
  assert.deepEqual(f.calls, ['HEAD']);

  f = fake([[405, 'text/html'], [206, 'image/png; charset=binary']]);
  const r = await verifyImage('https://x/a.png', { fetchImpl: f.impl });
  assert.deepEqual([r.ok, r.status, r.type], [true, 206, 'image/png']);
  assert.deepEqual(f.calls, ['HEAD', 'GET ranged']);

  f = fake([[200, 'text/html'], [200, 'text/html']]);
  assert.equal((await verifyImage('https://x/page', { fetchImpl: f.impl })).ok, false, 'an HTML page is not an image');

  f = fake([[404, 'text/html'], [404, 'text/html']]);
  assert.equal((await verifyImage('https://x/gone.jpg', { fetchImpl: f.impl })).ok, false);

  f = fake([new Error('ECONNRESET'), new Error('ECONNRESET')]);
  const dead = await verifyImage('https://x/dead.jpg', { fetchImpl: f.impl });
  assert.deepEqual([dead.ok, dead.status], [false, 0]);
  assert.match(dead.error, /ECONNRESET/);
});

test('searchImages: one failing source is reported, not fatal; --commercial filters before the cap', async (t) => {
  const saved = { ...SEARCH };
  t.after(() => Object.assign(SEARCH, saved));
  SEARCH.openverse = async () => [
    { source: 'openverse', title: 'a', licence: 'CC BY-NC 2.0', url: 'https://x/1.jpg' },
    { source: 'openverse', title: 'b', licence: 'CC BY 2.0', url: 'https://x/2.jpg' },
    { source: 'openverse', title: 'c', licence: 'CC0', url: 'https://x/3.jpg' },
  ];
  SEARCH.commons = async () => { throw new Error('commons.wikimedia.org answered 503'); };
  const res = await searchImages('q', { sources: ['openverse', 'commons'], n: 2, commercial: true, verify: async (u) => ({ ok: !u.endsWith('3.jpg'), status: 200 }) });
  assert.deepEqual(res.results.map((r) => r.title), ['b', 'c']);
  assert.deepEqual(res.results.map((r) => r.verified.ok), [true, false]);
  assert.deepEqual(res.results.map((r) => r.n), [1, undefined], 'results.json records n for verified results only');
  assert.deepEqual(res.errors, [{ source: 'commons', error: 'commons.wikimedia.org answered 503' }]);
});

test('planSheets numbers tiles across sheets, eight to a sheet', () => {
  const items = Array.from({ length: 19 }, (_, i) => ({ src: 'f' + i }));
  const sheets = planSheets(items);
  assert.equal(PER_SHEET, 8);
  assert.deepEqual(sheets.map((s) => s.length), [8, 8, 3]);
  assert.deepEqual(sheets[2].map((t) => t.n), [17, 18, 19]);
  assert.deepEqual(planSheets([]), []);
});

test('sheetHtml writes local files relative to the sheet, keeps URLs, and escapes labels', () => {
  const base = resolve('/tmp/run');
  const html = sheetHtml([
    { n: 1, src: join(base, 's01', 'top.png'), label: 'a <b> "c"' },
    { n: 12, src: 'https://images.example.org/x.jpg?a=1&b=2', label: '' },
    { n: 3, src: join(base, 'with space', 'y 900.png'), label: '' },
  ], { baseDir: base });
  assert.match(html, /src="s01\/top\.png"/);
  assert.match(html, /src="https:\/\/images\.example\.org\/x\.jpg\?a=1&amp;b=2"/);
  assert.match(html, /src="with%20space\/y%20900\.png"/);
  assert.match(html, /01 {2}a &lt;b&gt; &quot;c&quot;/);
  assert.match(html, /<figcaption>12 /);
  assert.doesNotMatch(html, /<b>/);
  assert.match(html, /grid-template-columns:repeat\(3,/);
});

test('curated lists: four registers, https URLs, no duplicates', () => {
  assert.deepEqual(Object.keys(LISTS).sort(), ['cinema', 'editorial', 'object', 'product']);
  const all = Object.values(LISTS).flat();
  for (const u of all) assert.match(u, /^https:\/\//);
  const hosts = all.map((u) => new URL(u).host.replace(/^www\./, '') + new URL(u).pathname);
  assert.equal(new Set(hosts).size, hosts.length, 'a site appears twice');
  assert.equal(slugFor(0), 's01');
  assert.equal(slugFor(11), 's12');
});

test('classify: challenge signatures decide, sparse real pages pass, an empty shell is a wall', () => {
  // The first six are the probes measured on the curated lists on 2026-09-25.
  const wall = (p) => classify({ textElements: 20, images: 0, canvases: 0, frames: [], text: '', title: '', ...p }).status;
  assert.equal(wall({ title: 'Just a moment...', textElements: 8 }), 'wall');
  assert.equal(wall({ title: 'Access Denied', textElements: 4 }), 'wall');
  assert.equal(wall({ title: 'nytimes.com', textElements: 0, frames: ['https://geo.captcha-delivery.com/captcha/?initialCid=x'] }), 'wall');
  assert.equal(wall({ title: 'Igloo Inc.', textElements: 0 }), 'wall');
  assert.equal(wall({ title: 'Rauno Freiberg', textElements: 8 }), 'ok');
  assert.equal(wall({ title: 'Leica Camera', textElements: 10 }), 'ok');
  assert.equal(wall({ title: 'Shop', text: 'Please verify you are human by completing the action below.' }), 'wall');
  assert.equal(wall({ title: 'Gallery', textElements: 1, images: 6 }), 'ok', 'a photo-only page is still a reference');
  assert.equal(wall({ title: 'Game', textElements: 0, canvases: 1 }), 'ok', 'a canvas page is flagged, not dropped');
  assert.equal(wall({ title: 'Docs', textElements: 400, frames: ['https://www.google.com/recaptcha/api2/anchor'] }), 'ok', 'a full page with a form captcha is not a wall');
  assert.match(classify({ title: 'Access Denied', textElements: 4 }).reason, /Access Denied/);
});

test('findBrowser: after the env and the system paths, the newest Playwright Chromium on Linux', () => {
  const files = new Set(['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium-1100/chrome-linux/chrome']);
  const dirs = { '/opt/pw-browsers': ['chromium', 'chromium-1100', 'chromium_headless_shell-1194', 'chromium-1194', 'ffmpeg-1011'] };
  const fs = {
    exists: (p) => files.has(p),
    readdir: (d) => { if (!dirs[d]) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); return dirs[d]; },
  };
  const linux = { platform: 'linux', home: '/root', ...fs };
  assert.equal(findBrowser({ env: {}, ...linux }), '/opt/pw-browsers/chromium-1194/chrome-linux/chrome');
  // $PLAYWRIGHT_BROWSERS_PATH and the per-user cache come before /opt.
  files.add('/pw/chromium-900/chrome-linux/chrome');
  dirs['/pw'] = ['chromium-900'];
  assert.equal(findBrowser({ env: { PLAYWRIGHT_BROWSERS_PATH: '/pw' }, ...linux }), '/pw/chromium-900/chrome-linux/chrome');
  files.add('/root/.cache/ms-playwright/chromium-1200/chrome-linux/chrome');
  dirs['/root/.cache/ms-playwright'] = ['chromium-1200'];
  assert.equal(findBrowser({ env: {}, ...linux }), '/root/.cache/ms-playwright/chromium-1200/chrome-linux/chrome');
  // A system Chrome and IDR_BROWSER still win, and other platforms never look.
  files.add('/usr/bin/chromium');
  assert.equal(findBrowser({ env: {}, ...linux }), '/usr/bin/chromium');
  files.add('/x/chrome');
  assert.equal(findBrowser({ env: { IDR_BROWSER: '/x/chrome' }, ...linux }), '/x/chrome');
  assert.equal(findBrowser({ env: {}, ...fs, platform: 'darwin', home: '/root' }), null);
  assert.equal(findBrowser({ env: {}, platform: 'linux', home: '/nobody', exists: () => false, readdir: () => [] }), null);
});

// Playwright 1.57 and later install Chrome for Testing: chrome-linux64/ on
// x64 and chrome-linux-arm64/ on arm64, no longer chrome-linux/.
test('findBrowser: the Chrome for Testing layouts of newer Playwright releases', () => {
  const tree = (files) => ({ platform: 'linux', home: '/home/u', env: { PLAYWRIGHT_BROWSERS_PATH: '/pw' },
    exists: (p) => files.includes(p), readdir: (d) => { if (d !== '/pw') throw new Error('ENOENT'); return ['chromium-1208', 'chromium_headless_shell-1208', 'ffmpeg-1011']; } });
  assert.equal(findBrowser(tree(['/pw/chromium-1208/chrome-linux64/chrome'])), '/pw/chromium-1208/chrome-linux64/chrome');
  assert.equal(findBrowser(tree(['/pw/chromium-1208/chrome-linux-arm64/chrome'])), '/pw/chromium-1208/chrome-linux-arm64/chrome');
});

test('launchArgs: --no-sandbox for root or IDR_NO_SANDBOX=1, never otherwise', () => {
  const has = (o) => launchArgs('/tmp/p', 9222, o).includes('--no-sandbox');
  assert.equal(has({ uid: 0, env: {} }), true);
  assert.equal(has({ uid: 1000, env: {} }), false);
  assert.equal(has({ uid: null, env: {} }), false, 'no uid (Windows)');
  assert.equal(has({ uid: 1000, env: { IDR_NO_SANDBOX: '1' } }), true);
  assert.equal(has({ uid: 1000, env: { IDR_NO_SANDBOX: '0' } }), false);
  const args = launchArgs('/tmp/p', 9222, { uid: 1000, env: {} });
  assert.ok(args.includes('--headless=new') && args.includes('--user-data-dir=/tmp/p') && args.includes('--remote-debugging-port=9222'));
  assert.equal(args.at(-1), 'about:blank');
});

// Anthropic's vision docs (platform.claude.com/docs/en/build-with-claude/vision,
// read 2026-09-29): ceil(w/28) x ceil(h/28) after scaling into the tier's long
// edge and token cap. The rows are the docs' own table.
test('visionTokens matches the vision docs on both tiers', () => {
  assert.equal(PATCH, 28);
  const high = [[200, 200, 64], [1000, 1000, 1296], [1092, 1092, 1521], [1920, 1080, 2691], [2000, 1500, 3888], [3840, 2160, 4784]];
  for (const [w, h, t] of high) assert.equal(visionTokens(w, h), t, `${w}x${h} high`);
  assert.equal(visionTokens(2590, 866), 2852, 'the 1.0 moodboard sheet');
  for (const tier of ['high', 'standard']) assert.equal(visionTokens(1288, 812, { tier }), 1334, 'compact sheet, ' + tier);
  assert.equal(visionTokens(1000, 1000, { tier: 'standard' }), 1296);
  assert.equal(visionTokens(1092, 1092, { tier: 'standard' }), 1521);
  const docs = { '1920x1080': 1560, '2000x1500': 1564, '3840x2160': 1560 };
  for (const [size, t] of Object.entries(docs)) {
    const [w, h] = size.split('x').map(Number);
    const got = visionTokens(w, h, { tier: 'standard' });
    assert.ok(got <= 1568, `${size} standard: ${got} is over the cap`);
    assert.equal(got, t, `${size} standard`);
  }
  assert.throws(() => visionTokens(10, 10, { tier: 'huge' }), /unknown tier/);
});

test('compact geometry: 16 tiles make a 1288x812 sheet, 46 x 29 patches', () => {
  assert.deepEqual(COMPACT, { cols: 4, perSheet: 16, cellW: 317, cellH: 198, gap: 4, pad: 4 });
  assert.deepEqual(sheetSize(16, COMPACT), { w: 1288, h: 812, tokens: 1334 });
  assert.deepEqual(sheetSize(5), { w: 1288, h: 408, tokens: 690 });
  assert.deepEqual([sheetSize(3).w, sheetSize(3).h], [967, 206]);
  assert.ok(sheetSize(16).w <= 2000 && sheetSize(16).h <= 2000, 'over the 2,000 px limit for requests with many images');
});

test('compact sheetHtml: a number badge on each tile and no caption row', () => {
  const base = resolve('/tmp/run');
  const html = sheetHtml([{ n: 7, src: join(base, 'a.png'), label: 'never shown' }, { n: 8, src: join(base, 'b.png'), badge: 's02 y900' }], { baseDir: base, compact: true });
  assert.doesNotMatch(html, /figcaption|never shown/);
  assert.match(html, /<span>07<\/span>/);
  assert.match(html, /<span>s02 y900<\/span>/);
  assert.match(html, /span\{position:absolute;top:0;left:0;font:12px\/1 ui-monospace,Consolas,monospace;color:#fff;background:rgba\(0,0,0,\.7\)/);
  assert.match(html, /grid-template-columns:repeat\(2,317px\);gap:4px;padding:4px/);
  assert.match(html, /img\{display:block;width:317px;height:198px/);
});

test('underBytes re-shoots at 70 and then 60 while the sheet is over 150,000 bytes', async () => {
  const sizes = { 80: 210000, 70: 160000, 60: 120000 };
  const asked = [];
  const shoot = async (q) => { asked.push(q); return Buffer.alloc(sizes[q]); };
  const r = await underBytes(shoot);
  assert.deepEqual(asked, [80, 70, 60]);
  assert.deepEqual([r.quality, r.buf.length], [60, 120000]);
  asked.length = 0;
  assert.equal((await underBytes(async (q) => { asked.push(q); return Buffer.alloc(90000); })).quality, 80);
  assert.deepEqual(asked, [80]);
  assert.equal((await underBytes(async () => Buffer.alloc(200000))).quality, 60, 'the last quality is kept when nothing fits');
});

test('planSheets keeps a number an item already carries', () => {
  const sheets = planSheets([{ n: 1 }, { n: 2 }, { n: 4 }, {}], 2);
  assert.deepEqual(sheets.map((s) => s.map((t) => t.n)), [[1, 2], [4, 4]]);
});

// Ten results with the third one failing: before 1.1.0 the table said 04 for
// the fourth result and the sheet put that image on tile 03.
function tenWithThirdFailing() {
  const results = Array.from({ length: 10 }, (_, i) => ({
    source: 'openverse', title: 'Result ' + (i + 1), creator: 'C' + (i + 1), licence: 'CC BY 2.0',
    licenceUrl: 'https://creativecommons.org/licenses/by/2.0/', url: `https://img.example.org/${i + 1}.jpg`, page: `https://example.org/${i + 1}`,
    verified: { ok: i !== 2, status: i !== 2 ? 200 : 404 },
  }));
  return { query: 'q', sources: ['openverse'], commercial: false, results: numberResults(results), errors: [] };
}

test('one number per verified result: the table, the compact lines and the sheet agree', () => {
  const res = tenWithThirdFailing();
  const good = res.results.filter((r) => r.verified.ok);
  assert.deepEqual(good.map((r) => r.n), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(res.results[2].n, undefined);
  const byTitle = (lines, re) => Object.fromEntries(lines.map((l) => re.exec(l)).filter(Boolean).map((m) => [m[2], Number(m[1])]));
  const tiles = planSheets(good.map((r) => ({ n: r.n, src: r.url, label: r.title })), COMPACT.perSheet).flat();
  const onSheet = Object.fromEntries(tiles.map((t) => [t.label, t.n]));
  const compact = byTitle(formatCompact(res, { out: '/tmp/o' }).split('\n'), /^(\d\d) \S+ .*? \| (Result \d+) \|/);
  const table = byTitle(formatTable(res).split('\n'), /^ {2}(\d\d) ok +\[\w+\] (Result \d+) /);
  assert.equal(Object.keys(onSheet).length, 9);
  assert.deepEqual(compact, onSheet);
  assert.deepEqual(table, onSheet, 'full-mode table and sheet');
  // The full-mode sheet numbers too, eight to a sheet.
  assert.deepEqual(Object.fromEntries(planSheets(good.map((r) => ({ n: r.n, label: r.title }))).flat().map((t) => [t.label, t.n])), onSheet);
  assert.match(formatTable(res), /\n {2}-- FAIL 404 +\[openverse\] Result 3 /);
});

test('compact text: 16 results in at most 1,800 characters, one line each, no URL', () => {
  const pool = [...parseOpenverse(fx('openverse.json')), ...parseCommons(fx('commons.json')), ...parseAic(fx('aic.json')),
    parseMetObject(fx('met-object.json')), parseMetObject(fx('met-object-2.json'))];
  const results = numberResults(Array.from({ length: 17 }, (_, i) => ({ ...pool[i % pool.length], verified: { ok: i !== 16, status: i !== 16 ? 200 : 403 } })));
  const out = join(resolve('/tmp'), 'image-deep-research', 'images-2026-09-29T01-02-03-456Z');
  const res = { query: 'cypress trees', results, errors: [],
    sheets: [{ file: join(out, 'moodboard1.jpg'), w: 1288, h: 812, bytes: 99000, quality: 80, tokens: 1334, tiles: results.slice(0, 16).map((r) => ({ n: r.n, loaded: r.n !== 5 })) }] };
  const text = formatCompact(res, { out });
  const lines = text.split('\n');
  assert.ok(text.length <= 1800, text.length + ' characters');
  assert.doesNotMatch(text, /http/i);
  assert.equal(lines[0], `images "cypress trees" 16/17 verified -> ${out}`);
  const rows = lines.filter((l) => /^\d\d /.test(l));
  assert.deepEqual(rows.map((l) => Number(l.slice(0, 2))), Array.from({ length: 16 }, (_, i) => i + 1));
  for (const l of rows) {
    const [head, title, creator] = l.split(' | ');
    assert.ok(title.length <= 48 && (!creator || creator.length <= 24), l);
    assert.match(head, /^\d\d (openverse|commons|aic|met) \S/);
  }
  assert.ok(lines.includes(`sheet ${join(out, 'moodboard1.jpg')} 1288x812 1334 tok (05 did not load)`), text);
  assert.ok(lines.includes('failed 1 (see results.json)'));
  assert.match(lines.at(-1), /^details: node images\.mjs --pick 1,2 --results .*results\.json$/);
  assert.match(text, /^09 met CC0 \| Wheat Field with Cypresses \| Vincent van Gogh$/m, 'the licence loses its parenthesis');
  // No failure, no failed line; a failed sheet says so in one line.
  const clean = formatCompact({ ...res, results: results.slice(0, 16), sheets: undefined, sheetError: 'no Chrome, Edge or Chromium found.\n  Windows: ...' }, { out });
  assert.doesNotMatch(clean, /^failed /m);
  assert.match(clean, /^sheet none: no Chrome, Edge or Chromium found\.$/m);
  // A Windows temp path runs as printed in Git Bash: forward slashes, and quotes around a space.
  const win = formatCompact(res, { out: 'C:\\Users\\Jane Doe\\AppData\\Local\\Temp\\idr', resultsPath: 'C:\\Users\\Jane Doe\\AppData\\Local\\Temp\\idr\\results.json' });
  assert.equal(win.split('\n').at(-1), 'details: node images.mjs --pick 1,2 --results "C:/Users/Jane Doe/AppData/Local/Temp/idr/results.json"');
});

test('formatPick prints three lines per picked result and refuses an unknown number', () => {
  const res = tenWithThirdFailing();
  const text = formatPick(JSON.parse(JSON.stringify(res)), [2, 5]);
  assert.deepEqual(text.split('\n'), [
    '02 Result 2 | C2 | CC BY 2.0 https://creativecommons.org/licenses/by/2.0/',
    '   image https://img.example.org/2.jpg',
    '   page https://example.org/2',
    '05 Result 6 | C6 | CC BY 2.0 https://creativecommons.org/licenses/by/2.0/',
    '   image https://img.example.org/6.jpg',
    '   page https://example.org/6',
  ]);
  assert.throws(() => formatPick(res, [99]), /no verified result 99 in this run \(1-9\)/);
});

test('formatSiteCompact: one line of at most 160 characters, or the wall and its reason', () => {
  const probe = { title: 'Ref', textElements: 31, frames: [], images: 0, canvases: 0,
    grounds: [{ color: '#1d2a3a', share: 97.3 }, { color: '#ffffff', share: 2.7 }], inks: [{ color: '#f2e8d5', share: 100 }],
    type: { heading: { family: '"Playfair Display SC Extra Condensed", Georgia, serif', size: '112.5px', lineHeight: '134.99px', weight: '400' },
      body: { family: 'Inter Variable, Arial, sans-serif', size: '18px', lineHeight: 'normal', weight: '400' } } };
  const line = formatSiteCompact({ url: 'https://www.a-very-long-hostname-for-a-studio.example.com/work', status: 'ok', probe }, 2);
  assert.ok(line.length <= 160, line.length + ': ' + line);
  assert.equal(line, 's03 ok a-very-long-hostname-for-a-~ | ground #1d2a3a 97.3% | ink #f2e8d5 100% | heading Playfair Displa~ 112.5/134.9 w400 | body Inter Variable 18/normal w400');
  const short = formatSiteCompact({ url: 'https://www.are.na', status: 'ok', probe: { ...probe, type: { heading: null, body: probe.type.body } } }, 0);
  assert.match(short, /^s01 ok are\.na \| .* \| heading none \| body Inter/);
  const wall = formatSiteCompact({ url: 'https://www.aesop.com', status: 'wall', probe: { title: 'Just a moment...', textElements: 8 },
    note: 'blocked: the page title is "Just a moment..."; left out of the sheet, see /tmp/s01/top.png' }, 0);
  assert.equal(wall, 's01 wall aesop.com (blocked: the page title is "Just a moment...")');
  assert.equal(formatSiteCompact({ url: 'https://nope.invalid', status: 'failed', note: 'navigation failed: net::ERR_NAME_NOT_RESOLVED' }, 4),
    's05 failed nope.invalid (navigation failed: net::ERR_NAME_NOT_RESOLVED)');
});
