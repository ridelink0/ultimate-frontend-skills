import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launch, Session, findBrowser, closeBrowser } from '../scripts/inspect.mjs';

const skill = join(import.meta.dirname, '..', 'skills', 'ultimate-frontend-skills');
const coreCss = readFileSync(join(skill, 'assets', 'core.css'), 'utf8');
const ui = readFileSync(join(skill, 'references', 'ui.md'), 'utf8');
const motion = readFileSync(join(skill, 'references', 'motion.md'), 'utf8');

/* The rows of one markdown table that follows `heading`, as arrays of cells. */
function tableAfter(md, heading) {
  const at = md.indexOf(heading);
  assert.ok(at !== -1, 'missing: ' + heading);
  const rows = [];
  for (const line of md.slice(at + heading.length).split('\n').map(l => l.trim())) {
    if (line.startsWith('|')) rows.push(line.split('|').slice(1, -1).map(c => c.trim()));
    else if (rows.length) break;
  }
  return rows.slice(2);
}

test('the sibling-index stagger ships behind its own feature query, capped', () => {
  const m = coreCss.match(/@supports \(order: sibling-index\(\)\) \{\s*\.stagger > \.r \{ --i: min\(sibling-index\(\) - 1, 6\); \}\s*\}/);
  assert.ok(m, 'core.css must derive --i from sibling-index() only inside @supports (order: sibling-index())');
  // The hand-numbered classes are the fallback, so they must still exist.
  assert.match(coreCss, /\.r-2 \{ --i: 1; \} \.r-3 \{ --i: 2; \} \.r-4 \{ --i: 3; \} \.r-5 \{ --i: 4; \}/);
});

test('newly native table lists sibling-index with its real Baseline date and versions', () => {
  const row = tableAfter(ui, '## Newly native in 2026: what you can delete').find(r => r[0].includes('sibling-index()'));
  assert.ok(row, 'sibling-index() row missing');
  assert.equal(row[2], '**newly** (2026-08-18)');
  assert.equal(row[3], '138 / 154 / 26.2');
});

test('the not-yet table carries grid-lanes, corner-shape, if() and scroll-state as limited', () => {
  const rows = tableAfter(ui, 'Not yet, whatever a blog post says:');
  const want = {
    'grid-lanes': 'limited: no / no / 26.4',
    'corner-shape': 'limited: 139 / no / no',
    'CSS `if()`': 'limited: 137 / no / no',
    'scroll-state()': 'limited: 133 / no / no',
  };
  for (const [key, state] of Object.entries(want)) {
    const row = rows.find(r => r[0].includes(key));
    assert.ok(row, key + ' missing from the not-yet table');
    assert.equal(row[1], state, key);
  }
  // Not-yet features must not also be offered as safe to delete a workaround for.
  const native = tableAfter(ui, '## Newly native in 2026: what you can delete').map(r => r[0]).join(' ');
  for (const k of ['grid-lanes', 'corner-shape', 'if()', 'scroll-state']) assert.ok(!native.includes(k), k + ' is in the newly-native table');
  assert.match(ui, /@supports \(display: grid-lanes\) \{\s*\.gallery \{ display: grid-lanes; \}/, 'masonry must be emitted as an enhancement over a plain grid');
  assert.match(motion, /### Nav state: keep the JS, `scroll-state\(\)` is Chromium-only/);
});

test('a .stagger list takes its reveal offsets from its own order in a real browser', { skip: !findBrowser(), timeout: 90000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ufs-stagger-'));
  writeFileSync(join(dir, 'core.css'), coreCss);
  const items = Array.from({ length: 10 }, (_, i) => `<li class="r">${i + 1}</li>`).join('');
  // Items 2 and 3 carry the fallback classes; on a list the automatic index must agree with them.
  writeFileSync(join(dir, 'index.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><link rel="stylesheet" href="core.css"></head><body>
    <section id="s"><h2 class="r">Heading</h2><ul class="stagger" id="list">${items.replace('<li class="r">2<', '<li class="r r-2">2<').replace('<li class="r">3<', '<li class="r r-3">3<')}</ul><p class="r" id="after">After</p></section>
    <ul id="plain"><li class="r">a</li><li class="r r-3">b</li></ul></body></html>`);
  // A launch that throws never reaches the finally below, so the fixture
  // folder is removed here, or it stays in the temp directory for good.
  let browser;
  try { browser = await launch(findBrowser()); } catch (e) { rmSync(dir, { recursive: true, force: true }); throw e; }
  const { proc, udd, port } = browser;
  let s;
  try {
    s = await Session.open(port);
    const ev = async (expression) => (await s.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;
    await s.send('Page.enable');
    // The reveal ranges sit under prefers-reduced-motion: no-preference. The
    // windows-latest runner has animations switched off, so its Edge reports
    // "reduce" and every range reads "normal" (6.5.0's first CI run). This
    // test measures the stagger arithmetic, so it asks for motion explicitly.
    await s.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    await s.send('Page.navigate', { url: pathToFileURL(join(dir, 'index.html')).href });
    await s.waitForEvent('Page.loadEventFired');
    const got = await ev(`JSON.stringify({
      supported: CSS.supports('order', 'sibling-index()'),
      scroll: CSS.supports('animation-timeline', 'view()'),
      list: [...document.querySelectorAll('#list > .r')].map(e => getComputedStyle(e).animationRangeStart),
      heading: getComputedStyle(document.querySelector('#s > h2')).animationRangeStart,
      after: getComputedStyle(document.querySelector('#after')).animationRangeStart,
      plain: [...document.querySelectorAll('#plain > .r')].map(e => getComputedStyle(e).animationRangeStart),
    })`);
    const r = JSON.parse(got);
    if (!r.scroll) return; // no scroll timelines: the ranges are never used, nothing to measure
    // Reveals outside a .stagger list keep their hand-set index.
    assert.equal(r.heading, 'entry 8%');
    assert.equal(r.after, 'entry 8%');
    assert.deepEqual(r.plain, ['entry 8%', 'entry 18%']);
    if (r.supported) {
      // 8% + (index - 1) * 5%, capped at six steps: 38%.
      assert.deepEqual(r.list, ['entry 8%', 'entry 13%', 'entry 18%', 'entry 23%', 'entry 28%', 'entry 33%', 'entry 38%', 'entry 38%', 'entry 38%', 'entry 38%']);
    } else {
      // Without sibling-index() only the fallback classes number the items.
      assert.deepEqual(r.list.slice(0, 4), ['entry 8%', 'entry 13%', 'entry 18%', 'entry 8%']);
    }
  } finally {
    s?.close();
    // Never assert in a finally: it would mask the failure that got us here.
    await closeBrowser({ proc, udd });
    rmSync(dir, { recursive: true, force: true });
  }
});
