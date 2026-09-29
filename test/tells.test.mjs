/* The AI tells in skills/ultimate-frontend-skills/data/ai-tells.json, checked
   by scripts/tells.mjs through the audit. One fixture pair per check: a page
   with the tell raises exactly that finding, the same page without it raises
   none. Then the negative controls (patterns that are not tells), the
   chassis itself (every scaffold raises exactly the source tells its preset
   is expected to, in test/tells-expected.mjs), and the pause control in a
   real browser. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { runAudit } from '../scripts/audit.mjs';
import { tellData } from '../scripts/tells.mjs';
import { findBrowser, launch, closeBrowser, Session } from '../scripts/inspect.mjs';
import { browserSkip } from './need-browser.mjs';
import { EXPECTED_TELLS } from './tells-expected.mjs';
import { startServer } from '../scripts/preview-server.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = join(root, 'scripts', 'webdesign.mjs');

function page(body, { css = '', head = '' } = {}) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Tells fixture</title><meta name="description" content="A fixture page for the audit's tell checks, long enough to pass the length check.">
<style>@media (prefers-reduced-motion: reduce) { * { animation: none } } ${css}</style>${head}</head>
<body><main>${body}</main></body></html>`;
}

function tellsOf(html, js = '') {
  const dir = mkdtempSync(join(tmpdir(), 'ufs-tells-'));
  try {
    writeFileSync(join(dir, 'index.html'), html);
    if (js) writeFileSync(join(dir, 'app.js'), js);
    return runAudit(dir).findings.filter((f) => /\[[a-z]+-[a-z-]+, [A-Z]\d+\]$/.test(f.text));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
const ids = (found) => [...new Set(found.map((f) => f.text.match(/\[([a-z]+-[a-z-]+),/)[1]))];

const sec = (inner, attrs = '') => `<section${attrs}><h2>Part</h2>${inner}</section>`;
const CASES = [
  ['motion-uniform-reveal',
    page([1, 2, 3, 4, 5].map(() => sec('<div class="r"><p>Copy.</p></div>')).join('')),
    page([1, 2, 3, 4, 5].map((i) => sec(i % 2 ? '<div class="r r--mask"><p>Copy.</p></div>' : '<p>Copy.</p>')).join(''))],
  ['motion-hover-lift',
    page(sec('<div class="card">c</div>'), { css: '.card:hover{transform:translateY(-4px)}' }),
    page(sec('<div class="card">c</div>'), { css: '.card:hover{border-color:#333}' })],
  ['motion-progress-short-page',
    page(sec('<div class="progress"></div><p>A short page.</p>')),
    page(sec('<p>A short page.</p>'))],
  ['motion-counter-uncited',
    page(sec('<span data-count="40">40</span>')),
    page(sec('<span data-count="40">40</span><p>Source: <cite>The 2025 annual report</cite></p>'))],
  ['motion-overshoot-dialog',
    page(sec('<dialog>d</dialog>'), { css: 'dialog{transition:transform .3s cubic-bezier(.34,1.56,.64,1)}' }),
    page(sec('<dialog>d</dialog>'), { css: 'dialog{transition:transform .3s cubic-bezier(.22,1,.36,1)}' })],
  ['motion-scale-zero',
    page(sec('<p class="pop">x</p>'), { css: '@keyframes pop{from{transform:scale(0)}to{transform:scale(1)}}.pop{animation:pop .3s ease-out}' }),
    page(sec('<p class="pop">x</p>'), { css: '@keyframes pop{from{transform:scale(.96)}to{transform:scale(1)}}.pop{animation:pop .3s ease-out}' })],
  ['motion-token-sprawl',
    page(sec('<p>x</p>'), { css: 'a{transition:color 100ms}b{transition:color 150ms}i{transition:color 200ms}u{transition:color 250ms}s{transition:color 300ms}q{transition:color 350ms}em{transition:color 400ms}' }),
    page(sec('<p>x</p>'), { css: 'a{transition:color 200ms}b{transition:color 200ms}i{transition:color 400ms}' })],
  ['motion-cursor-glow',
    page(sec('<div class="glow">g</div><script src="app.js"></script>'), { css: '.glow{background:radial-gradient(circle at var(--mx) var(--my),#fff,transparent)}' }),
    page(sec('<div class="glow">g</div><script src="app.js"></script>'), { css: '.glow{background:radial-gradient(circle at 50% 50%,#fff,transparent)}' }),
    "addEventListener('pointermove',(e)=>{document.body.style.setProperty('--mx',e.clientX+'px');document.body.style.setProperty('--my',e.clientY+'px')})"],
  ['motion-loop-no-pause',
    page(sec('<div class="marquee"><span>News</span></div>'), { css: '.marquee>*{animation:slide 20s linear infinite}' }),
    page(sec('<div class="marquee"><span>News</span></div><button type="button" data-pause aria-pressed="false">Pause motion</button>'), { css: '.marquee>*{animation:slide 20s linear infinite}' })],
  ['web-shadcn-defaults',
    page(sec('<p>x</p>'), { css: ':root{--radius:0.5rem;--background:0 0% 100%;--card:0 0% 100%;--popover:0 0% 100%;--muted:210 40% 96%}' }),
    page(sec('<p>x</p>'), { css: ':root{--radius:2px;--background:0 0% 100%;--card:0 0% 100%;--popover:0 0% 100%;--muted:210 40% 96%}' })],
  ['web-lucide-slop-set',
    page(sec('<i data-lucide="sparkles"></i><i data-lucide="zap"></i><i data-lucide="shield"></i>')),
    page(sec('<i data-lucide="sparkles"></i><i data-lucide="anchor"></i>'))],
  ['web-scaffold-furniture',
    page(sec('<p>Most Popular</p><p>Built with care in Austin</p>')),
    page(sec('<p>The one most people pick</p>'))],
  ['web-slop-gradient-pair',
    page(sec('<p>x</p>'), { css: '.ok{color:#10b981}' }),
    page(sec('<p>x</p>'), { css: '.ok{color:#2f6b4f}' })],
  ['web-section-waterfall',
    page(['hero', 'logos', 'features', 'stats', 'testimonials', 'pricing', 'faq'].map((id) => sec('<p>x</p>', ` id="${id}"`)).join('')),
    page(['hero', 'story', 'features', 'visit'].map((id) => sec('<p>x</p>', ` id="${id}"`)).join(''))],
  ['svg-embedded-raster',
    page(sec('<svg class="logo" viewBox="0 0 10 10" role="img" aria-label="Mark"><image href="mark.png" width="10" height="10"/></svg>')),
    page(sec('<svg class="logo" viewBox="0 0 10 10" role="img" aria-label="Mark"><path d="M0 0h10v10z"/></svg>'))],
  ['icons-mixed',
    page(sec('<svg viewBox="0 0 24 24" stroke-width="1.5" aria-hidden="true"></svg><svg viewBox="0 0 24 24" stroke-width="2" aria-hidden="true"></svg>')),
    page(sec('<svg viewBox="0 0 24 24" stroke-width="1.5" aria-hidden="true"></svg><svg viewBox="0 0 24 24" stroke-width="1.5" aria-hidden="true"></svg>'))],
  ['game-key-not-code',
    page(sec('<canvas></canvas><script src="app.js"></script>')), page(sec('<canvas></canvas><script src="app.js"></script>')),
    "addEventListener('keydown',(e)=>{if(e.key==='w')up()})", "addEventListener('keydown',(e)=>{if(e.code==='KeyW')up()})"],
  ['game-audio-autoplay',
    page(sec('<script src="app.js"></script>')), page(sec('<script src="app.js"></script>')),
    'const ac = new AudioContext();', "const ac = new AudioContext(); addEventListener('pointerdown', () => ac.resume());"],
  ['game-no-visibility-pause',
    page(sec('<canvas></canvas><script src="app.js"></script>')), page(sec('<canvas></canvas><script src="app.js"></script>')),
    "const g=document.querySelector('canvas').getContext('2d');addEventListener('keydown',()=>{});function f(){requestAnimationFrame(f)}f()",
    "const g=document.querySelector('canvas').getContext('2d');addEventListener('keydown',()=>{});document.addEventListener('visibilitychange',()=>{});function f(){requestAnimationFrame(f)}f()"],
];

test('every proposed audit check in ai-tells.json has a rule and a fixture pair here', () => {
  const audit = tellData().entries.filter((e) => e.proposed_check && e.proposed_check.scope === 'audit').map((e) => e.proposed_check.id);
  const covered = new Set([...CASES.map((c) => c[0]), 'copy-emdash-density']);
  assert.deepEqual(audit.filter((id) => !covered.has(id)), [], 'audit checks in the data with no rule and fixture');
  assert.ok(audit.length >= 20, audit.length + ' audit checks');
});

for (const [id, bad, good, badJs = '', goodJs = badJs] of CASES) {
  test(`${id}: the tell is named, and the same page without it is not`, () => {
    const hit = tellsOf(bad, badJs);
    assert.deepEqual(ids(hit), [id], JSON.stringify(hit.map((f) => f.text), null, 1));
    const level = id === 'motion-loop-no-pause' ? 'error' : 'warn';
    assert.ok(hit.every((f) => f.level === level), id + ' should be ' + level);
    assert.deepEqual(ids(tellsOf(good, goodJs)), [], id + ': the clean page still raised it');
  });
}

test('the patterns that are not tells raise nothing: a bento grid, a mesh background, one reveal kind among still sections', () => {
  const found = tellsOf(page(
    sec('<div class="bento" style="display:grid;grid-template-columns:2fr 1fr;grid-template-rows:auto auto"><div>a</div><div>b</div><div>c</div></div>')
    + sec('<div class="mesh"><p>x</p></div>') + sec('<div class="r r--settle"><p>x</p></div>') + sec('<p>still</p>'),
    { css: '.mesh{background:radial-gradient(at 20% 30%,#c9b7a2,transparent 60%),radial-gradient(at 80% 70%,#6b7f6a,transparent 55%),#f2efe7}' }));
  assert.deepEqual(found.map((f) => f.text), []);
});

/* This used to assert that every scaffold passes every tell check, "the
   chassis ships none of them". The source checks still find nothing, but the
   rendered tells (tells-render.mjs) show the chassis does ship some, so the
   expectation is now a list per preset: this test holds the audit's half of
   it, test/tells-render.test.mjs the rendered half. */
test('every scaffold the library can make raises exactly its preset\'s expected source tells', () => {
  const library = readFileSync(join(root, 'skills/ultimate-frontend-skills/assets/sections.html'), 'utf8');
  const all = [...library.matchAll(/@section\s+([\w-]+)\s*\|/g)].map((m) => m[1]);
  const heroes = all.filter((s) => s.startsWith('hero-'));
  const middle = all.filter((s) => !s.startsWith('hero-') && !['head', 'foot', 'not-found', 'nav', 'footer'].includes(s));
  const dir = mkdtempSync(join(tmpdir(), 'ufs-tells-chassis-'));
  try {
    assert.deepEqual(Object.keys(EXPECTED_TELLS).sort(), ['bone', 'cinema', 'fable', 'ink']);
    for (const preset of Object.keys(EXPECTED_TELLS)) for (const hero of heroes) for (const [k, sections] of [['all', ['nav', hero, ...middle, 'footer']], ['default', ['nav', hero, 'manifesto', 'services', 'stats', 'faq', 'contact', 'footer']]]) {
      const out = join(dir, preset + '-' + hero + '-' + k);
      const made = spawnSync(process.execPath, [cli, 'new', out, '--preset', preset, '--sections', sections.join(',')], { encoding: 'utf8' });
      assert.equal(made.status, 0, made.stderr);
      const tells = runAudit(out).findings.filter((f) => /\[[a-z]+-[a-z-]+, [A-Z]\d+\]$/.test(f.text)).map((f) => f.text);
      assert.deepEqual(ids(tells.map((text) => ({ text }))), EXPECTED_TELLS[preset].audit, preset + ' ' + hero + ' ' + k + ': ' + JSON.stringify(tells));
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the pause button holds a marquee where it is, and a second press lets it go', { skip: browserSkip(), timeout: Number(process.env.UFS_TEST_TIMEOUT_MS) || 90000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ufs-pause-'));
  for (const f of ['core.css', 'motion.js']) writeFileSync(join(dir, f), readFileSync(join(root, 'skills/ultimate-frontend-skills/assets', f)));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><html lang="en"><meta charset="utf-8"><title>p</title><link rel="stylesheet" href="core.css">'
    + '<main><div class="marquee"><span id="m">News from the yard</span></div><button class="pause" type="button" data-pause aria-pressed="false">Pause motion</button></main>'
    + '<script src="motion.js" defer></script></html>');
  const server = startServer(dir, 0);
  await once(server, 'listening');
  const b = await launch(findBrowser());
  try {
    const s = await Session.open(b.port);
    await s.send('Page.enable');
    await s.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    await s.send('Page.navigate', { url: 'http://127.0.0.1:' + server.address().port + '/' });
    await s.waitForEvent('Page.loadEventFired', 20000);
    const read = async (expr) => (await s.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value;
    const state = "[getComputedStyle(document.getElementById('m')).animationPlayState, document.querySelector('[data-pause]').getAttribute('aria-pressed')]";
    assert.deepEqual(await read(state), ['running', 'false']);
    await read("document.querySelector('[data-pause]').click()");
    assert.deepEqual(await read(state), ['paused', 'true']);
    await read("document.querySelector('[data-pause]').click()");
    assert.deepEqual(await read(state), ['running', 'false']);
    s.close();
  } finally { await closeBrowser(b); await new Promise((r) => server.close(r)); rmSync(dir, { recursive: true, force: true }); }
});

/* PLAN item 10: every tell in the data sits in the shipped reference for its
   domain, and every tell a reference lists is in the data. */
test('every tell in ai-tells.json is a row in its reference, and every row is in the data', () => {
  const FILES = { 'web-motion': 'motion.md', web: 'tells.md', copy: 'tells.md', 'motion-graphics': 'video-tells.md', editing: 'video-tells.md', games: 'games.md', 'graphic-design': 'image-tells.md' };
  const data = tellData().entries;
  const listed = new Map();
  for (const f of new Set(Object.values(FILES))) {
    const text = readFileSync(join(root, 'skills/ultimate-frontend-skills/references', f), 'utf8').replace(/\r/g, '');
    const at = text.indexOf('## From the 2026-09-28 research');
    assert.ok(at >= 0, f + ' has no research section');
    const end = text.indexOf('\n## ', at + 5);
    for (const m of text.slice(at, end < 0 ? undefined : end).matchAll(/^\| ([A-Z]\d+) \|/gm)) listed.set(m[1], f);
  }
  for (const e of data) assert.equal(listed.get(e.id), FILES[e.domain], e.id + ' is not listed in ' + FILES[e.domain]);
  for (const id of listed.keys()) assert.ok(data.some((e) => e.id === id), id + ' is listed but not in the data');
  for (const e of data) assert.ok(/^https?:\/\//.test(e.source), e.id + ' has no source URL');
});
