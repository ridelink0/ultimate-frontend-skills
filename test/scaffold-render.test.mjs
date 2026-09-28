/* What the scaffolder writes, rendered the way a visitor meets it, and what
   the render check says about it (judge round 3, 2026-09-27): the 404 at a
   nested missing address, the header on the default bone preset, the words a
   display heading breaks, the contrast wording, verify's one finding per
   defect, and the "Next" command the scaffolder prints. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync, existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { findBrowser, launch, closeBrowser, Session, inspect, formatReport } from '../scripts/inspect.mjs';
import { startServer } from '../scripts/preview-server.mjs';
import { renderFindings } from '../scripts/verify.mjs';
import { judge } from '../scripts/measure.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = join(root, 'scripts', 'webdesign.mjs');
const skip = !findBrowser();

function scaffold(sections, preset = 'bone') {
  const dir = mkdtempSync(join(tmpdir(), 'ufs-render-'));
  const made = spawnSync(process.execPath, [cli, 'new', join(dir, 'site'), '--name', 'Lantern', '--preset', preset, '--sections', sections], { encoding: 'utf8' });
  assert.equal(made.status, 0, made.stderr);
  return { dir, site: join(dir, 'site'), stdout: made.stdout };
}

async function serve(dir) {
  const server = startServer(dir, 0);
  await once(server, 'listening');
  return { base: 'http://127.0.0.1:' + server.address().port, close: () => new Promise((r) => server.close(r)) };
}

// The address a static host keeps in the bar while it serves 404.html.
const NESTED = '/a/b/missing';

async function nested404(dir) {
  const { base, close } = await serve(dir);
  const b = await launch(findBrowser());
  try {
    const s = await Session.open(b.port);
    await s.send('Page.enable');
    await s.send('Network.enable');
    await s.send('Page.navigate', { url: base + NESTED });
    await s.waitForEvent('Page.loadEventFired', 20000);
    const status = s.events.find((e) => e.method === 'Network.responseReceived' && e.params.type === 'Document')?.params.response.status;
    const r = await s.send('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: `(async () => {
      const sheets = [...document.styleSheets].filter((x) => x.href && x.href.startsWith(location.origin));
      const rules = sheets.map((x) => { try { return x.cssRules.length; } catch { return -1; } });
      const local = [...document.querySelectorAll('a[href], link[href], script[src], img[src]')]
        .map((e) => new URL(e.getAttribute('href') || e.getAttribute('src'), location.href))
        .filter((u) => u.origin === location.origin && u.pathname !== location.pathname);
      const codes = await Promise.all(local.map((u) => fetch(u.pathname).then((x) => [u.pathname, x.status])));
      return { sheets: sheets.map((x) => new URL(x.href).pathname), rules, font: getComputedStyle(document.body).fontFamily,
        bg: getComputedStyle(document.body).backgroundColor, codes, title: document.title };
    })()` });
    s.close();
    return { status, ...r.result.value };
  } finally { await closeBrowser(b); await close(); }
}

test('the scaffolded 404 is styled at a nested missing address, and every way out of it is a real file', { skip, timeout: Number(process.env.UFS_TEST_TIMEOUT_MS) || 120000 }, async () => {
  const { dir, site } = scaffold('nav,hero-split,manifesto,services,faq,contact,footer');
  try {
    // the contact section's /privacy link is a stand-in the audit names; a
    // real site has the page, so the fixture does too
    writeFileSync(join(site, 'privacy.html'), '<!doctype html><title>Privacy</title>');
    const r = await nested404(site);
    assert.equal(r.status, 404, 'the preview server answers a missing address with the 404 page and status 404');
    assert.match(r.title, /Page not found/);
    assert.deepEqual(r.sheets.sort(), ['/core.css', '/site.css']);
    assert.ok(r.rules[r.sheets.indexOf('/core.css')] > 20 && r.rules.every((n) => n > 0), 'a stylesheet did not load: ' + JSON.stringify(r));
    assert.doesNotMatch(r.font, /Times/, 'the body fell back to the browser default: ' + r.font);
    assert.notEqual(r.bg, 'rgba(0, 0, 0, 0)');
    const broken = r.codes.filter(([, code]) => code !== 200);
    assert.deepEqual(broken, [], 'links or assets on the 404 that lead nowhere: ' + JSON.stringify(broken));
    assert.ok(r.codes.some(([p]) => p === '/'), 'the 404 has a way back to the start');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('both shipped example 404s are styled at a nested missing address, and every way out of them is a real file', { skip, timeout: Number(process.env.UFS_TEST_TIMEOUT_MS) || 120000 }, async () => {
  for (const ex of ['fable-showcase', 'houston-roofing']) {
    const r = await nested404(join(root, 'examples', ex));
    assert.equal(r.status, 404, ex);
    assert.ok(r.rules[r.sheets.indexOf('/core.css')] > 20 && r.rules.every((n) => n > 0), ex + ': ' + JSON.stringify(r));
    assert.doesNotMatch(r.font, /Times/, ex);
    assert.deepEqual(r.codes.filter(([, code]) => code !== 200), [], ex);
  }
});

const navContrast = (results) => results.flatMap((r) => r.contrast.map((c) => ({ ...c, width: r.width })))
  .filter((c) => /nav__brand|nav__cta|"(Method|Work|Questions|Contact|Detail|Get in touch)"/.test(c.el));

test('on the default bone preset the header reads at 4.5:1 over hero-split, and over hero-photo before its photo exists', { skip, timeout: Number(process.env.UFS_TEST_TIMEOUT_MS) || 180000 }, async () => {
  for (const sections of ['nav,hero-split,manifesto,services,faq,contact,footer', 'nav,hero-photo,manifesto,services,faq,contact,footer']) {
    const { dir, site } = scaffold(sections);
    const { base, close } = await serve(site);
    try {
      const results = await inspect(base + '/', { widths: [1440, 390], wait: 400 });
      assert.deepEqual(navContrast(results), [], sections + ': header text under its contrast need');
      // and the colours themselves, read in the page: dark ink on paper, or
      // light type on the dark field a photo hero is until its photo loads
      const b = await launch(findBrowser());
      try {
        const s = await Session.open(b.port);
        await s.send('Page.enable');
        await s.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
        await s.send('Page.navigate', { url: base + '/' });
        await s.waitForEvent('Page.loadEventFired', 20000);
        const v = await s.send('Runtime.evaluate', { returnByValue: true, expression: `(() => {
          const px = (c) => { const x = document.createElement('canvas').getContext('2d'); x.fillStyle = c; x.fillRect(0,0,1,1); return [...x.getImageData(0,0,1,1).data]; };
          const lum = ([r,g,b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b); };
          const hero = document.querySelector('#top');
          let ground = getComputedStyle(hero).backgroundColor;
          if (px(ground)[3] < 200) ground = getComputedStyle(document.body).backgroundColor;
          const ink = getComputedStyle(document.querySelector('.nav__brand')).color;
          const a = lum(px(ink)), b = lum(px(ground));
          return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        })()` });
        s.close();
        assert.ok(v.result.value >= 4.5, sections + ': the header against the hero ground is ' + v.result.value.toFixed(2) + ':1');
      } finally { await closeBrowser(b); }
    } finally { await close(); rmSync(dir, { recursive: true, force: true }); }
  }
});

test('body-size text under 3:1 is an ERROR, and "photo" is said only when image pixels are behind the text', { skip, timeout: Number(process.env.UFS_TEST_TIMEOUT_MS) || 120000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ufs-ground-'));
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP4//8/AwAI/AL+XJ/PIQAAAABJRU5ErkJggg==';
  writeFileSync(join(dir, 'white.png'), Buffer.from(png, 'base64'));
  writeFileSync(join(dir, 'index.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><title>g</title>
<style>body{margin:0;background:#f2efe7;font:14px system-ui}
.bar{position:fixed;top:0;left:0;right:0;padding:12px;color:#fbfaf6}
.photo{position:relative;height:300px;margin-top:200px}.photo img{position:absolute;inset:0;width:100%;height:100%}
.photo p{position:relative;color:#fbfaf6;padding:40px;margin:0}</style>
<div class="bar"><a href="#x" style="color:inherit">Paper link</a></div>
<div class="photo"><img src="white.png" alt=""><p>Photo words here</p></div><main><h1>Ground</h1></main></html>`);
  const { base, close } = await serve(dir);
  try {
    const results = await inspect(base + '/', { widths: [900], wait: 300 });
    const { text } = formatReport(results);
    const paper = text.split('\n').find((l) => l.includes('Paper link'));
    const photo = text.split('\n').find((l) => l.includes('Photo words'));
    assert.ok(paper && photo, text);
    assert.match(paper, /^\s*ERROR contrast/, paper);
    assert.match(paper, /sampled from the page behind it/, paper);
    assert.doesNotMatch(paper, /photo/, paper);
    assert.match(photo, /^\s*ERROR contrast/, photo);
    assert.match(photo, /sampled from the photo behind it/, photo);
  } finally { await close(); rmSync(dir, { recursive: true, force: true }); }
});

test('a display heading broken inside a word is named, with the word and the width', { skip, timeout: Number(process.env.UFS_TEST_TIMEOUT_MS) || 120000 }, async () => {
  const { dir, site } = scaffold('nav,hero-split,manifesto,footer');
  const index = join(site, 'index.html');
  writeFileSync(index, readFileSync(index, 'utf8').replace(/<h1 class="t-hero">[\s\S]*?<\/h1>/, '<h1 class="t-hero">Unapologetically slow sourdough.</h1>'));
  const { base, close } = await serve(site);
  try {
    const results = await inspect(base + '/', { widths: [1440, 390], wait: 300 });
    const { text } = formatReport(results);
    assert.match(text, /warn {2}"Unapologetically" is broken across \d lines at 1440px, with no hyphen/, text);
    // a heading that fits breaks between words and is not named
    assert.doesNotMatch(text, /"slow" is broken/);
  } finally { await close(); rmSync(dir, { recursive: true, force: true }); }
});

test('verify reports one finding per defect, naming its widths and motion modes', () => {
  const base = { overlaps: [], overflow: [], collapsed: [], tiny: [], offscreen: [], stats: { textElements: 1, scrollHeight: 900 } };
  const miss = { error: 'HTTP 404 http://127.0.0.1:5555/img/hero.jpg', type: 'Image', blockedReason: null };
  const results = [];
  for (const width of [1440, 390]) for (const reducedMotion of [false, true]) for (const scroll of [0, 400, 800]) {
    results.push({ ...base, width, scroll, reducedMotion, network: scroll ? [] : [miss], broken: ['img/hero.jpg'],
      contrast: [{ el: 'a "Method"', ratio: width === 390 ? 1.07 : 1.06, need: 4.5, size: 14, method: 'photo', ground: 'page' }] });
  }
  const found = renderFindings(results);
  const image = found.filter((f) => /hero\.jpg/.test(f.text));
  assert.equal(image.length, 1, JSON.stringify(image, null, 1));
  assert.match(image[0].text, /at 1440px, 390px; normal and reduced motion$/);
  const contrast = found.filter((f) => /contrast/.test(f.text));
  assert.equal(contrast.length, 1, JSON.stringify(contrast, null, 1));
  assert.match(contrast[0].text, /^contrast 1\.06:1 .*page behind it.* - at 1440px, 390px; normal and reduced motion$/);
  assert.equal(contrast[0].severity, 'error');
});

test('the body measure budget is per width and the finding names the width', () => {
  const at = (width, measureChars) => judge({ type: { distinctSizes: 5, largestPx: 64, measureChars, distinctTextColours: 3 } }, { width })
    .filter((f) => /body measure/.test(f.text));
  assert.equal(at(390, 37)[0].level, 'ok', 'a 37-character column is a normal phone measure');
  assert.match(at(390, 37)[0].text, /at 390px/);
  const narrow = at(1440, 37)[0];
  assert.equal(narrow.level, 'warn');
  assert.match(narrow.text, /only 37 characters at 1440px/);
  assert.equal(at(390, 24)[0].level, 'warn');
});

test('the scaffolder lists every file it wrote, and its "Next" command runs as printed from another folder', () => {
  const { dir, site, stdout } = scaffold('nav,hero-fable,manifesto,footer');
  try {
    const listed = ['index.html', ...stdout.split('\n')[2].trim().split(/\s+/)].map((f) => f.replace(/\/$/, ''));
    const written = readdirSync(site);
    assert.deepEqual([...listed].sort(), [...written].sort(), 'printed: ' + listed.join(' '));
    assert.ok(written.includes('sky.js'));
    const next = stdout.split('\n').map((l) => l.trim()).find((l) => l.startsWith('node '));
    assert.ok(next, stdout);
    const ran = spawnSync(next, { shell: true, encoding: 'utf8', cwd: dir });
    assert.doesNotMatch(ran.stderr + ran.stdout, /MODULE_NOT_FOUND|Cannot find module/, ran.stderr);
    assert.match(ran.stdout, /webdesign audit/, ran.stdout + ran.stderr);
    assert.ok(ran.status === 0 || ran.status === 1, 'audit exits 0 or 1, got ' + ran.status);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
