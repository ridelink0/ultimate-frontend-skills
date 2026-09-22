/* The fixture corpus: small pages, each broken in exactly one way (or, for the
   "clean" set, deliberately not), driven through the real checkers. This is
   the test that would have caught the false positives and false negatives -
   every other test in this repo either exercises the judging logic on
   synthetic numbers or exercises the browser plumbing on unrelated pages;
   none of them assert that a KNOWN bug in a KNOWN fixture produces the ONE
   finding it is named for, and nothing else. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findBrowser, inspect } from '../scripts/inspect.mjs';
import { judge, BUDGETS } from '../scripts/measure.mjs';
import { startServer } from '../scripts/preview-server.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, 'fixtures');
const skip = !findBrowser();

// Every fixture is served from one directory so a relative <script src>
// (fake-lib.js) resolves, and so the whole file shares one server.
let server, base;
test.before(async () => {
  if (skip) return;
  server = startServer(FIXTURES, 0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = 'http://127.0.0.1:' + server.address().port + '/';
});
test.after(async () => { if (server) await new Promise((resolve) => server.close(resolve)); });

const measured = async (name, opts = {}) => {
  const [r] = await inspect(base + name, { widths: [800], wait: 200, scrolls: [0], measured: true, ...opts });
  return r;
};

/* Everything a fixture raised, flattened into one sorted list. Asserting on
   this rather than on a single count is the difference between a corpus and a
   pile of pages: a fixture that is meant to be broken in exactly one way but
   quietly also trips contrast and overlap teaches a checker nothing, and a
   "clean" fixture that raises two findings is itself a false positive nobody
   would notice. Both of those were true of this corpus when it was written. */
const findings = (r) => [
  ...r.overlaps.map(() => 'layout: text over text'),
  ...r.offscreen.map((o) => 'layout: wider than the viewport - ' + o.el),
  ...r.overflow.map((o) => 'layout: past the viewport - ' + o.what),
  ...r.contrast.map((c) => `contrast: ${c.ratio}:1 needs ${c.need} - ${c.el}`),
  ...r.collapsed.map((c) => 'layout: collapsed - ' + c.el),
  ...r.broken.map((b) => 'asset: broken - ' + b.el),
  ...r.tiny.map((t) => 'layout: tap target - ' + t.el),
  // The event half of the corpus. It was missing entirely, which is how a
  // fixture could 404 an asset and still read as clean here.
  ...(r.network || []).map((n) => 'network: ' + n.error + (n.blockedReason ? ' [' + n.blockedReason + ']' : '')),
  ...(r.console || []).map((c) => 'console: ' + c.text),
  ...(r.hung || []).map((h) => 'asset: never resolved - ' + h.url),
  ...(r.interact || []).map((c) => 'interaction: threw - ' + c.el),
  ...(r.shifted || []).map((s) => 'interaction: shifted under the pointer - ' + s.el),
  ...(r.focus || []).map((f) => 'a11y: no focus ring - ' + f.el),
  ...judge(r.measured).filter((f) => f.level !== 'ok').map((f) => f.level + ': ' + f.text),
].sort();

// Asserts the COMPLETE finding set, in sorted order: nothing named is missing
// and nothing else is there.
const raises = (r, ...expected) => {
  const got = findings(r);
  assert.equal(got.length, expected.length, 'fixture raised ' + JSON.stringify(got, null, 1));
  expected.forEach((re, i) => assert.match(got[i], re, 'fixture raised ' + JSON.stringify(got, null, 1)));
};

// Findings whose trigger is a duration rather than a count. These fire or do
// not fire depending on what else the machine is doing, so a fixture that
// deliberately does something expensive cannot assert a complete finding set:
// on an idle laptop the long task lands under the threshold and on a busy one
// it does not, and neither outcome says anything about the code under test.
const TIMING_DERIVED = /^warn: longest main-thread task \d+ ms$/;

// For those fixtures: every named finding must be present, and nothing may
// appear beyond them EXCEPT a timing-derived warning. The control page in the
// same test still uses the strict `raises`, which is what actually guards
// against a check that measures the machine rather than the page.
const raisesAllowingTiming = (r, ...expected) => {
  const got = findings(r);
  const solid = got.filter((f) => !TIMING_DERIVED.test(f));
  assert.equal(solid.length, expected.length, 'fixture raised ' + JSON.stringify(got, null, 1));
  expected.forEach((re, i) => assert.match(solid[i], re, 'fixture raised ' + JSON.stringify(got, null, 1)));
};

test('text overlapping text is caught, and only on the page that has it', { skip, timeout: 90000 }, async () => {
  raises(await measured('overlap.html'), /^layout: text over text$/);
  raises(await measured('clean-basic.html'));
});

test('content past the viewport is caught at 390px, and is gone at a width that fits it', { skip, timeout: 90000 }, async () => {
  raises(await measured('overflow-390.html', { widths: [390] }), /^layout: past the viewport - div/);
  // The same 600px-wide box fits inside 1440, so the finding has to disappear
  // entirely rather than change wording: an overflow check that fires at every
  // width is not measuring overflow.
  raises(await measured('overflow-390.html', { widths: [1440] }));
});

test('a canvas painted once reads as not animating', { skip, timeout: 90000 }, async () => {
  const r = await measured('canvas-once.html');
  assert.equal(r.measured.motion.canvases[0].animating, false);
  raises(r, /^warn: 1 canvas painted once/);
});

// The bug the multi-sample fingerprint fix exists for: two samples, spaced far
// enough apart, can both land on the same phase of a short loop and read a
// genuinely animating canvas as dead. Sampling five times through the window
// is what tells a blink from a still image.
test('a two-state blink is recognised as animating, not mistaken for a still image', { skip, timeout: 90000 }, async () => {
  const r = await measured('canvas-blink.html', { wait: 200 });
  assert.equal(r.measured.motion.canvases[0].animating, true);
  raises(r);
});

test('three data-depth planes with no engine behind them all move at the page rate, and it is flagged', { skip, timeout: 90000 }, async () => {
  const r = await measured('planes-same-rate.html');
  const rates = r.measured.depth.planes.map((p) => p.rate);
  assert.ok(rates.every((rate) => Math.abs(rate - 1) < 0.05), 'undriven planes should all read page rate: ' + JSON.stringify(rates));
  // The one defect, said once for the scene and once per plane, and nothing
  // else: the page is otherwise a legible, well-sized, non-overlapping layout.
  raises(r,
    /^error: 3 declared planes all move at the same rate/,
    /^warn: plane "0\.2" declares depth/,
    /^warn: plane "0\.5" declares depth/,
    /^warn: plane "0\.8" declares depth/);
});

test('three data-depth planes that really move at different rates are not flagged', { skip, timeout: 90000 }, async () => {
  const r = await measured('clean-depth.html');
  assert.equal(r.measured.depth.planes.length, 3, 'the fixture must actually declare three planes');
  raises(r);
});

test('a library loaded and never called is reported idle, and the same library actually running is not', { skip, timeout: 90000 }, async () => {
  const idle = await measured('idle-library.html');
  assert.ok(idle.measured.cost.idleLibraries.includes('GSAP'));
  raises(idle, /^error: loaded and never used: GSAP$/);
  const used = await measured('clean-library-used.html');
  assert.ok(!used.measured.cost.idleLibraries.includes('GSAP'));
  raises(used);
});

test('twenty distinct type sizes is over budget and named as such', { skip, timeout: 90000 }, async () => {
  const r = await measured('type-sizes-20.html');
  assert.equal(r.measured.type.distinctSizes, 20);
  assert.ok(r.measured.type.distinctSizes > BUDGETS.distinctSizes);
  // Twenty sizes topping out at 31px has a second, honest consequence: there
  // is no display size on the page at all. Both are named, and nothing else.
  raises(r, /^warn: 20 distinct type sizes$/, /^warn: largest type on the page is 31px$/);
});

test('a measure past the readable width is over budget and named as such', { skip, timeout: 90000 }, async () => {
  const r = await measured('measure-140.html');
  assert.ok(r.measured.type.measureChars > BUDGETS.measureChars[1],
    'fixture should measure well past the ' + BUDGETS.measureChars[1] + '-character budget, got ' + r.measured.type.measureChars);
  raises(r, /^warn: body measure is 1\d\d characters/);
});

test('a page with nothing wrong raises nothing', { skip, timeout: 90000 }, async () => {
  const r = await measured('clean-basic.html');
  assert.equal(r.measured.type.distinctSizes <= BUDGETS.distinctSizes, true);
  raises(r);
});

/* ------------------------------------------------------- the driven run --- */
/* Checks 1, 2 and 5 share one gesture, so they share their fixtures too. */

test('a read-then-write scroll handler is caught, and the identical page without the read is not', { skip, timeout: 60000 }, async () => {
  const bad = await measured('thrash-on-scroll.html');
  // Judged on the layout COUNT, which is a property of the code and reproduces
  // on any machine. Every millisecond figure is detail, never the trigger.
  // A page that forces 300 layouts per scroll event also blocks the main
  // thread; that warning is a true positive and its threshold is a duration,
  // so it is tolerated rather than asserted. The layout COUNT is the trigger.
  raisesAllowingTiming(bad, /^error: scrolling forces \d+(\.\d+)? layouts per scroll event \(budget 4\)$/);
  const error = judge(bad.measured).find((f) => f.level === 'error');
  // Check 5: attribution is a detail line on this finding, not a finding of
  // its own. It must name the file and the invoker LoAF actually reported.
  assert.match(error.detail, /thrash-on-scroll\.html \[event-listener\]/);
  assert.ok(bad.measured.run.loaf.forcedMs > 0, 'forced synchronous layout should be measured: ' + JSON.stringify(bad.measured.run.loaf));
  assert.ok(bad.measured.run.layoutsPerScroll > BUDGETS.layoutsPerScroll * 5);
  // The control is the same 300 rows and the same gesture with a passive
  // listener that reads no geometry. If this ever speaks, the check is
  // measuring the machine rather than the page.
  const good = await measured('clean-scroll.html');
  raises(good);
  assert.equal(good.measured.run.loaf.count, 0);
  assert.ok(good.measured.run.layoutsPerScroll <= BUDGETS.layoutsPerScroll);
});

// The most valuable fixture in the set, because it proves the probe by
// REMOVING a false failure: three planes moved by a wheel listener never move
// under window.scrollTo, so the teleporting probe read them as three planes at
// one rate and raised "the parallax is in the markup but not on the screen"
// against a page whose parallax is fine.
test('planes driven by the wheel read three distinct rates under a real gesture', { skip, timeout: 60000 }, async () => {
  const r = await measured('planes-wheel-only.html');
  assert.equal(r.measured.depth.source, 'gesture', 'the rates must come from the driven scroll, not the teleport');
  const rates = r.measured.depth.planes.map((p) => p.rate);
  assert.equal(rates.length, 3);
  assert.ok(Math.max(...rates) - Math.min(...rates) > 0.4, 'a real gesture should separate the planes: ' + JSON.stringify(rates));
  raises(r);
  assert.ok(r.measured.run.samples >= 8 && r.measured.run.travel >= 400, JSON.stringify(r.measured.run));
});

test('a shift after load is attributed to the elements that actually moved', { skip, timeout: 60000 }, async () => {
  const r = await measured('shift-on-load.html', { wait: 900 });
  // Same rule as the thrash fixture: a page built to shift under load also
  // takes a long main-thread task on a busy machine, and that finding is
  // triggered by a duration. The SHIFT is the trigger here; the milliseconds
  // beside it are weather.
  raisesAllowingTiming(r, /^warn: layout shift 0\.\d+ \(budget 0\.1\)$/);
  const warn = judge(r.measured).find((f) => /layout shift/.test(f.text));
  assert.match(warn.detail, /H1#f/, 'the shift finding must name what moved: ' + JSON.stringify(warn));
  // The control attributes nothing because there is nothing to attribute.
  const clean = await measured('clean-basic.html');
  raises(clean);
  assert.deepEqual(clean.measured.cost.shiftSources, []);
});

/* ------------------------------------------------------ prefers-reduced --- */

test('a looping animation with no reduced-motion query is caught; the same animation behind the query is not', { skip, timeout: 60000 }, async () => {
  raises(await measured('motion-ignores-reduce.html', { reducedMotion: true }),
    /^error: 1 looping animation still running under prefers-reduced-motion$/);
  raises(await measured('motion-honours-reduce.html', { reducedMotion: true }));
  // Guard (a): a page with no motion at all must not read as "ignored the
  // setting". There has to be something to stop before anything is said.
  raises(await measured('clean-basic.html', { reducedMotion: true }));
});

// Guard (c), the one the live flip cannot see. This page honours the setting
// perfectly by reading matchMedia once at boot - and because it never
// re-evaluates, flipping the media mid-life leaves it animating. A checker
// that reported that negative would condemn correct code.
test('a page that reads matchMedia once at boot is never condemned by the live flip', { skip, timeout: 60000 }, async () => {
  const normal = await measured('motion-honours-reduce-via-js.html');
  assert.equal(normal.measured.reduce.liveFlip, true);
  assert.equal(normal.measured.reduce.runningUnderLiveFlip, 1, 'the live flip must genuinely still see it animating');
  raises(normal);
  raises(await measured('motion-honours-reduce-via-js.html', { reducedMotion: true }));
  // And the honest converse: the page that really does ignore the setting is
  // also silent on the no-preference pass. Only a pass that NAVIGATED under
  // the emulated media can produce the finding.
  raises(await measured('motion-ignores-reduce.html'));
});

/* ------------------------------------------------------------ page errors --- */

test('a page that screenshots perfectly while failing underneath reports exactly what failed, once each', { skip, timeout: 60000 }, async () => {
  const r = await measured('broken-underneath.html');
  // A page this broken can also take a long task on a busy machine; that one
  // finding is triggered by a duration. The three below are still exact.
  raisesAllowingTiming(r,
    /^console: TypeError: Cannot read properties of null/,
    /^network: HTTP 404 .*missing-face\.woff2$/,
    /^network: HTTP 404 .*missing-module\.js$/);
  // The specific defect this fixture exists for: one missing asset used to be
  // reported twice - once as a network entry and once as the console echo of
  // the same 404 - so a page with two broken assets and one thrown error read
  // as five problems. Two assets, two network findings, and the thrown error.
  // (Chromium also emits a loadingFailed net::ERR_ABORTED per 404, but marks
  // it canceled, so the network list was already free of that second copy.)
  assert.equal(r.network.length, 2, 'two missing assets, two findings: ' + JSON.stringify(r.network));
  raises(await measured('clean-basic.html'));
});

test('a same-origin request that never resolves is reported; the same request answered is not', { skip, timeout: 90000 }, async () => {
  const { createServer } = await import('node:http');
  const sockets = new Set();
  const stall = createServer((req, res) => {
    // /hang.js is answered by never answering. This is the one asset failure
    // that produces no 404 and no loadingFailed, so nothing else can see it.
    if (req.url.startsWith('/hang.js')) return;
    try {
      const body = readFileSync(join(FIXTURES, req.url.replace(/^\//, '').split('?')[0]));
      res.writeHead(200, { 'content-type': req.url.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' });
      res.end(body);
    } catch { res.writeHead(404); res.end('missing'); }
  });
  stall.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  stall.listen(0, '127.0.0.1');
  await new Promise((resolve) => stall.once('listening', resolve));
  const root = 'http://127.0.0.1:' + stall.address().port + '/';
  try {
    // Longer than the 3 s the check waits before calling a request hung: the
    // cost of that threshold is exactly this, and calling a merely slow asset
    // hung would be worse than not checking at all.
    const opts = { widths: [800], wait: 3400, scrolls: [0], measured: true };
    const [bad] = await inspect(root + 'hung-script.html', opts);
    raises(bad, /^asset: never resolved - .*hang\.js$/);
    const [good] = await inspect(root + 'clean-script.html', opts);
    raises(good);
  } finally {
    for (const s of sockets) s.destroy();
    await new Promise((resolve) => stall.close(resolve));
  }
});

/* ---------------------------------------------------------- interactions --- */

test('three buttons with one defect each raise one finding each; the correct three raise none', { skip, timeout: 60000 }, async () => {
  const r = await measured('click-defects.html', { interact: true });
  raises(r,
    /^a11y: no focus ring - button#noring/,
    /^interaction: shifted under the pointer - BUTTON#jumps$/,
    /^interaction: threw - button#throws/);
  // The clean control is the guard list in one page: a handler that returns,
  // a focus ring drawn with a box-shadow rather than an outline, and a button
  // that grows DOWNWARD so the layout changes without moving under the pointer.
  raises(await measured('clean-buttons.html', { interact: true }));
});

/* ------------------------------------------------ design parity fixtures --- */
/* Same discipline as the corpus above: one artboard, two implementations, and
   an assertion on the COMPLETE finding set. The match fixture is the important
   half - a parity check that cries wolf on a correct page is worse than no
   check at all, because it would send an agent off to damage work that was
   right. The drift fixture is named for exactly two things, and must report
   those two and nothing else. */

const DESIGN = join(FIXTURES, 'design');
const CANVAS = join(DESIGN, 'artboard-canvas.html');
const parity = async (impl, opts = {}) => {
  const { runParity } = await import('../scripts/parity.mjs');
  return runParity(join(DESIGN, impl), CANVAS, { wait: 1200, ...opts });
};
const texts = (result) => result.findings.map((f) => f.severity + ': ' + f.text).sort();

test('an implementation that kept the design reports no delta at all', { skip, timeout: 90000 }, async () => {
  const r = await parity('match');
  // Proof the artboard was what got measured. The canvas top document has four
  // toolbar labels; the design inside the frame has five text elements.
  assert.match(r.design.frame, /srcdoc/, 'parity must read the artboard frame, not the editor page');
  assert.equal(r.design.textElements, 5);
  assert.deepEqual(texts(r), []);
  assert.equal(r.errors, 0);
});

test('an implementation rebuilt in the house style reports exactly its type-scale and palette delta', { skip, timeout: 90000 }, async () => {
  const r = await parity('drift');
  assert.deepEqual(texts(r), [
    'error: this page does not implement the supplied design: 3 of 3 type sizes and 2 of 2 text colours are absent from it. A supplied design is preserved, not rebuilt in the house style.',
    'note: the design uses 48px, 20px, 16px; the page does not',
    // The ground is a warning, not a note, because it covers the whole page:
    // severity follows the area an off-palette colour actually paints.
    'warning: 1 background colour is not in the design: rgb(12, 10, 3) (covering 100% of what the page paints)',
    'warning: 2 text colours are not in the design: rgb(154, 154, 154), rgb(232, 196, 106)',
    'warning: 3 type sizes are not in the design: 30px, 13px, 11px',
    "warning: the largest type on the page is 30px; the design's is 48px",
    "warning: the largest type on the page is rgb(232, 196, 106); the design's is rgb(180, 83, 9)",
  ]);
  assert.equal(r.errors, 1);
});

test('a page whose palette is written in oklch matches a design written in hex', { skip, timeout: 90000 }, async () => {
  // The false positive this check can least afford. getComputedStyle returns
  // oklch() verbatim, so before the probes converted colours to sRGB, a page
  // carrying the design's exact colours was told three of them were "not in
  // the design" - and the plugin's own core.css is written in oklch, so every
  // page built in the house style hit it.
  const r = await parity('oklch');
  assert.deepEqual(texts(r), []);
  assert.equal(r.errors, 0);
});

test('a drifted display line is named even though a headline is used exactly once', { skip, timeout: 90000 }, async () => {
  // Only the h1 changed: 48px amber to 28px teal. The stray filter used to
  // drop both values before the comparison, which exempted the single element
  // a design is most about from the entire check.
  const r = await parity('hero-drift');
  assert.deepEqual(texts(r), [
    'note: 1 text colour is not in the design: rgb(63, 208, 201)',
    'note: 1 type size is not in the design: 28px',
    'note: the design uses 48px; the page does not',
    "warning: the largest type on the page is 28px; the design's is 48px",
    "warning: the largest type on the page is rgb(63, 208, 201); the design's is rgb(180, 83, 9)",
  ]);
  assert.equal(r.errors, 0);
});

test('measuring a canvas without frame awareness reads the editor chrome, not the design', { skip, timeout: 90000 }, async () => {
  // The failure this whole design exists to prevent, demonstrated rather than
  // described: aimed at the top document, the same correct implementation that
  // matches perfectly above now "fails" against a toolbar.
  const r = await parity('match', { frame: 'document' });
  assert.equal(r.design.frame, 'document');
  assert.equal(r.design.textElements, 4, 'the canvas top document is the toolbar');
  assert.ok(r.findings.length > 0, 'measuring the wrong frame must not look like a pass');
});

test('a bare .dc.html is refused rather than measured', { skip, timeout: 90000 }, async () => {
  const { runParity } = await import('../scripts/parity.mjs');
  await assert.rejects(
    () => runParity(join(DESIGN, 'match'), join(DESIGN, 'Main.dc.html'), { wait: 200 }),
    /not a renderable page/);
});

/* ------------------------------------------- the deepened-debugger round --- */
/* Each of these pairs a page broken in exactly the way one check targets with
   a control that must NOT trip it. Several of the controls are the whole
   point: they are the correct, common patterns the checks were accusing. */

test('a control that resizes itself under the pointer is not "moved out from under the pointer"', { skip, timeout: 60000 }, async () => {
  // Two toggles in a centred flex row. Changing the label moves each button's
  // own start point, so the layout-shift API reports it as an unstable element
  // whose PREVIOUS rect contained the click - which is all the check used to
  // ask. The pointer never left either one.
  raises(await measured('clean-toggle-center.html', { interact: true }));
  // The true positive is unchanged: this button grows a spacer ABOVE itself,
  // so the click point really is outside its new rect.
  const bad = await measured('click-defects.html', { interact: true });
  assert.deepEqual((bad.shifted || []).map((s) => s.el), ['BUTTON#jumps']);
});

test('a focus ring drawn on a pseudo element, an inner span or a :focus-within wrapper is seen', { skip, timeout: 60000 }, async () => {
  // getComputedStyle(el) with no second argument sees none of these three, so
  // all three read as "no visible focus indicator" - an accusation against
  // what most design systems actually ship.
  raises(await measured('focus-pseudo.html', { interact: true }));
  // And the element that genuinely has no indicator is still named.
  const bad = await measured('click-defects.html', { interact: true });
  assert.deepEqual((bad.focus || []).map((f) => f.el), ['button#noring "No focus ring at all"']);
});

test('a one-off lazy measurement is not reported as per-scroll-event thrash', { skip, timeout: 60000 }, async () => {
  const r = await measured('lazy-measure-once.html');
  const run = r.measured.run;
  // Non-vacuous, and this is the whole discrimination: the ratio IS over
  // budget - the old rule would have fired - and the cost is one frame, so
  // there is no per-event thrash to describe.
  assert.ok(run.layoutsPerScroll > BUDGETS.layoutsPerScroll,
    'the fixture must still exceed the ratio budget or it proves nothing: ' + JSON.stringify(run.layoutsPerScroll));
  assert.ok(run.loaf.count < BUDGETS.thrashFrames,
    'the fixture is a single burst by construction: ' + JSON.stringify(run.loaf));
  assert.equal(judge(r.measured).filter((f) => /layouts per scroll event/.test(f.text)).length, 0);
  // The real thrash still recurs across the gesture, which is the signal that
  // separates them.
  const bad = await measured('thrash-on-scroll.html');
  assert.ok(bad.measured.run.loaf.count >= BUDGETS.thrashFrames,
    'a real scroll thrash produces a long frame per handled event: ' + JSON.stringify(bad.measured.run.loaf));
  // Same fixture, same assertion as the thrash test above: a page built to be
  // expensive also takes a long task on a busy machine, and that finding is
  // triggered by a duration. The layout error is still asserted exactly.
  raisesAllowingTiming(bad, /^error: scrolling forces \d+(\.\d+)? layouts per scroll event \(budget 4\)$/);
});

test('collapsing animation-duration under reduced motion is honouring it, not ignoring it', { skip, timeout: 60000 }, async () => {
  // The framework reset, written the third of the three canonical ways. The
  // animation is still infinite and still "running"; each pass covers a
  // hundredth of a millisecond.
  raises(await measured('reduce-duration-only.html', { reducedMotion: true }));
  // The page that really does ignore the setting is unaffected.
  raises(await measured('motion-ignores-reduce.html', { reducedMotion: true }),
    /^error: 1 looping animation still running under prefers-reduced-motion$/);
});

test('a declared progress indicator is not condemned for spinning under reduced motion', { skip, timeout: 60000 }, async () => {
  raises(await measured('spinner.html', { reducedMotion: true }));
  // Same infinite rotation with no role on it is still judged, so the
  // exemption is the declaration and not the shape.
  raises(await measured('motion-ignores-reduce.html', { reducedMotion: true }),
    /^error: 1 looping animation still running under prefers-reduced-motion$/);
});

test('requestAnimationFrame motion that ignores reduced motion is caught, and the same loop asked first is not', { skip, timeout: 90000 }, async () => {
  // The hole this closes: a rAF loop creates no Animation object, so
  // getAnimations() was empty and a page that flatly ignores the setting
  // reported clean. Every animation in this plugin's own house style is one.
  const bad = await measured('raf-ignores-reduce.html', { reducedMotion: true });
  assert.deepEqual(bad.measured.reduce.rafMoving, ['DIV#mark']);
  raises(bad, /^error: 1 element still moving under prefers-reduced-motion$/);
  raises(await measured('raf-honours-reduce.html', { reducedMotion: true }));
  // And it says nothing on the pass that did not navigate under the media, on
  // the same terms as the getAnimations half.
  raises(await measured('raf-ignores-reduce.html'));
  // A CSS animation is already accounted for by getAnimations(), so it is
  // never named twice.
  const css = await measured('motion-ignores-reduce.html', { reducedMotion: true });
  assert.deepEqual(css.measured.reduce.rafMoving, []);
});

test('the shift-source buffer still answers on a page that shifts a thousand times', { skip, timeout: 90000 }, async () => {
  // The buffer had a hard 80-entry ceiling that was never released, and every
  // reader takes an offset into it - so on a page that shifts a lot the click
  // check went permanently empty and reported nothing, which reads as "no
  // defect". This page pushes well over a thousand sources during the scroll
  // gesture before the sweep ever clicks anything.
  const r = await measured('shift-noisy-click.html', { interact: true });
  assert.ok(r.measured.run.shiftSources.length > 0, 'the gesture must produce shift sources: ' + JSON.stringify(r.measured.run.shiftSources.length));
  // Asserted on the sweep rather than through raises(): this page trips the
  // layout-shift budget too, on purpose, and that is not what is under test.
  assert.deepEqual((r.shifted || []).map((s) => s.el), ['BUTTON#jumps']);
  // The quiet control carrying the identical defect, which is what proves the
  // difference is the noise and not the button.
  const quiet = await measured('click-defects.html', { interact: true });
  assert.deepEqual((quiet.shifted || []).map((s) => s.el), ['BUTTON#jumps']);
});
