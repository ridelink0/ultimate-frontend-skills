import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { judge, BUDGETS } from '../scripts/measure.mjs';
import { findBrowser } from '../scripts/inspect.mjs';
import { debugSite } from '../scripts/debug.mjs';

const clean = { motion: { frames: 100, fps: 60, worstFrameMs: 20, dropped: 2, canvases: [], reducedMotion: false },
  depth: { planes: [] }, cost: { requests: 8, totalKb: 60, scriptKb: 20, heavy: [], idleLibraries: [], longTasks: 0, longestTaskMs: 10, layoutShift: 0.01 },
  type: { distinctSizes: 6, largestPx: 96, scale: [96, 48, 24, 18, 16, 14], measureChars: 68, distinctTextColours: 3 } };
const levels = (found) => found.filter((f) => f.level === 'error').map((f) => f.text);

test('a page inside every budget raises nothing', () => {
  assert.equal(levels(judge(clean)).length, 0);
});

test('a slow page is an error, and the budget is named in it', () => {
  const found = judge({ ...clean, motion: { ...clean.motion, fps: 38 } });
  assert.match(levels(found)[0], new RegExp('38 fps.*' + BUDGETS.fps));
});

// The one duration-triggered finding, judged on fixed numbers. The fixture
// corpus cannot assert it: a real browser on a busy or cold machine takes a
// long task on any page (701 ms on the plain overlap fixture, on a CI runner).
test('a main-thread task past its budget is a warning, and one at the budget is not', () => {
  const warns = (found) => found.filter((f) => f.level === 'warn').map((f) => f.text);
  const over = judge({ ...clean, cost: { ...clean.cost, longTasks: 1, longestTaskMs: BUDGETS.longestTaskMs + 1 } });
  assert.deepEqual(warns(over).filter((t) => /main-thread task/.test(t)), ['longest main-thread task ' + (BUDGETS.longestTaskMs + 1) + ' ms']);
  const at = judge({ ...clean, cost: { ...clean.cost, longTasks: 1, longestTaskMs: BUDGETS.longestTaskMs } });
  assert.equal(warns(at).filter((t) => /main-thread task/.test(t)).length, 0);
});

test('a library loaded and never called is the most expensive kind of dead code', () => {
  const found = judge({ ...clean, cost: { ...clean.cost, idleLibraries: ['GSAP', 'three.js'] } });
  assert.match(levels(found)[0], /loaded and never used: GSAP, three\.js/);
});

// Declared planes that all move together are a promise the page does not keep.
test('planes that declare a depth and all move together fail; unlabelled ones do not', () => {
  const same = [{ name: 'a', declared: 0.4, promises: true, rate: 1, fixed: false },
                { name: 'b', declared: 0.8, promises: true, rate: 1.01, fixed: false }];
  assert.match(levels(judge({ ...clean, depth: { planes: same } }))[0], /same rate/);
  const guessed = same.map((p) => ({ ...p, promises: false, declared: null }));
  assert.equal(levels(judge({ ...clean, depth: { planes: guessed } })).length, 0,
    'a class called .layer is not a promise');
});

test('under reduced motion, a canvas still animating is the defect', () => {
  const moving = { ...clean, motion: { ...clean.motion, reducedMotion: true, canvases: [{ animating: true }] } };
  assert.match(levels(judge(moving))[0], /still animating under prefers-reduced-motion/);
  const still = { ...clean, motion: { ...clean.motion, reducedMotion: true, canvases: [{ animating: false }] } };
  assert.equal(levels(judge(still)).length, 0);
});

test('a measurement that failed is reported as unmeasured, never as a pass', () => {
  const found = judge({ motion: { error: 'timed out' }, depth: { error: 'no' }, cost: {}, type: {} });
  assert.ok(found.some((f) => f.level === 'note' && /could not be measured/.test(f.text)));
  assert.equal(levels(found).length, 0);
});

test('the real page is measured, not the source', { skip: !findBrowser(), timeout: 60000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'measure-'));
  try {
    writeFileSync(join(dir, 'index.html'),
      '<!doctype html><html lang="en"><meta charset="utf-8"><title>M</title><style>body{margin:0;height:3000px;font:16px system-ui}h1{font-size:64px}</style>' +
      '<h1>Measured</h1><p>' + 'word '.repeat(60) + '</p>' +
      '<canvas id="c" width="200" height="120"></canvas>' +
      // Every frame repaints the WHOLE canvas in a different colour. The
      // earlier fixture moved a 20px square a few pixels a frame, which on a
      // loaded machine could move less than one sample cell in the whole
      // record window - so the test failed for want of CPU rather than
      // because the mechanism was broken. This asserts the mechanism.
      '<script>const x=document.getElementById("c").getContext("2d");let t=0;' +
      // Every frame a different colour, not two alternating: an even number
      // of frames returned an alternating canvas to its starting state, which
      // is what a loaded machine produces and is exactly the false negative
      // the probe now samples through the window to avoid.
      '(function f(){t++;x.fillStyle="rgb("+(t%256)+","+(t*7%256)+","+(t*13%256)+")";x.fillRect(0,0,200,120);requestAnimationFrame(f)})();<\/script></html>');
    const result = await debugSite(dir, { out: join(dir, 'out'), widths: [900], wait: 60, motion: 'normal', scrolls: [0], measured: { motionMs: 500, depthDistance: 400 } });
    const measured = result.results[0].measured;
    assert.ok(measured.motion.frames > 5, 'frames were counted');
    assert.equal(measured.motion.canvases[0].animating, true, 'a canvas that repaints reads as alive');
    assert.ok(measured.cost.requests >= 0 && measured.type.largestPx >= 60, JSON.stringify(measured.type));
    assert.ok(measured.type.measureChars > 0, 'the body measure is counted in characters');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// JSON turns NaN into null on the way back from the page, and null.toFixed()
// killed a whole quality run after a full browser pass. An unmeasured plane
// cannot fail a promise.
test('a plane whose rate came back null is unmeasured, not a crash and not a failure', () => {
  const planes = [{ name: 'a', declared: 0.4, promises: true, rate: null, fixed: false },
                  { name: 'b', declared: 0.8, promises: true, rate: null, fixed: false }];
  const found = judge({ ...clean, depth: { planes } });
  assert.equal(found.filter((f) => f.level === 'error').length, 0);
});

/* The Windows and ubuntu CI job missed a real scroll thrash and the suite could
   not reproduce it locally, because the missing half was a machine property.
   The per-event layout finding used to need BUDGETS.thrashFrames long frames
   alongside the ratio, and long-animation-frame only reports frames over 50 ms:
   the read-then-write fixture produced 9 long frames on a laptop and exactly 1
   on the CI runner, so the error was simply never raised there. These two cases
   are the fast runner, on fixed numbers, on any machine. */
const fastRunner = (reads) => ({
  ...clean,
  run: {
    measured: true, scrollEvents: reads.events, layoutsPerScroll: 300,
    metrics: { layoutCount: 1500, layoutMs: 120 },
    // One long frame is all a fast machine reports, which is what used to
    // silence this finding.
    loaf: { supported: true, count: 1, longestMs: 55, blockingMs: 0, forcedMs: 37, culprit: null },
    reads,
  },
});
const thrashText = (found) => levels(found).filter((t) => /layouts per scroll event/.test(t));

test('a scroll thrash is caught on a runner too fast to produce long frames', () => {
  // Reads on every scroll event the gesture produced: the real fixture measures
  // 5 of 5, and that ratio is the same on any machine.
  const found = judge(fastRunner({ total: 1500, before: 0, events: 5, withReads: 5, readRatio: 1,
    readers: [{ site: 'thrash-on-scroll.html:15', events: 5 }] }));
  assert.deepEqual(thrashText(found), ['scrolling forces 300 layouts per scroll event (budget 4)']);
  // The evidence that triggered it is named in the detail, machine-independent
  // part first, and it points at the line that read.
  const error = found.find((f) => /layouts per scroll event/.test(f.text));
  assert.match(error.detail, /^geometry read on 5 of 5 scroll events at thrash-on-scroll\.html:15;/);
});

test('one expensive burst inside the gesture is still not per-scroll-event thrash', () => {
  // The lazy IntersectionObserver fixture: the ratio IS over budget and the
  // cost is one frame, so there is no per-event thrash to describe. Reading on
  // 1 of 21 events is what says so.
  const found = judge(fastRunner({ total: 800, before: 0, events: 21, withReads: 1, readRatio: 0.05,
    readers: [{ site: 'lazy-measure-once.html:23', events: 1 }] }));
  assert.deepEqual(thrashText(found), []);
  // Nor can a burst reach the ratio by collapsing the denominator to two
  // events, which is the trap a ratio alone would still fall into.
  const collapsed = judge(fastRunner({ total: 800, before: 0, events: 2, withReads: 1, readRatio: 0.5,
    readers: [{ site: 'lazy-measure-once.html:23', events: 1 }] }));
  assert.deepEqual(thrashText(collapsed), []);
});

test('an over-budget layout ratio with no geometry read at all says nothing', () => {
  // A page that relaid out for its own reasons and read nothing is not a
  // read-then-write handler, and naming it would send someone to edit correct
  // code.
  const found = judge(fastRunner({ total: 0, before: 0, events: 40, withReads: 0, readRatio: 0, readers: [] }));
  assert.deepEqual(thrashText(found), []);
});
