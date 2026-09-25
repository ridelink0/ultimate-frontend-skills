/* What the source cannot tell you about a page you have already built.
 *
 * The audit reads the files. The debug pass takes pictures. Neither answers the
 * three questions that actually decide whether a cinematic page is any good:
 *
 *   Does it move?     A parallax declared in the markup and a parallax that
 *                     happens on screen are different things. Three planes with
 *                     the same measured rate is a flat page with extra markup,
 *                     and it looks exactly like the real thing in a screenshot.
 *   Does it cost?     Sixty frames a second is the whole budget. A hero that
 *                     renders at 24 is not "cinematic", it is broken, and the
 *                     117 KB of animation library the page loaded and never
 *                     called is dead weight in the critical path.
 *   Does it read?     Fifteen distinct type sizes is not a typographic scale.
 *                     A 140-character measure is not a column. These are
 *                     computed values, so they can be counted rather than
 *                     argued about.
 *
 * Everything here runs in the page, against the render, and returns numbers.
 * The numbers are not the judgement - the screenshots are still the judgement -
 * but they catch the failures a screenshot cannot show, because a still frame
 * of a dead animation is indistinguishable from a still frame of a live one.
 */

/* Installed before any document runs. Observers have to exist before the thing
 * they observe, so long tasks and layout shifts are collected from the first
 * frame rather than from whenever the probe happens to arrive. */
export const MEASURE_INIT = `(() => {
  const state = { longTasks: [], shifts: 0, errors: [], loaf: [], loafSupported: false, shiftSources: [], shiftDropped: 0 };
  Object.defineProperty(window, '__measure', { value: state, configurable: true });
  // An element seen inside an observer callback has to be named THERE. The
  // node is a live reference and the thing that shifted is very often the
  // thing that was then replaced, so by the time anything reads this buffer
  // the element can be detached and its identity gone.
  const label = (el) => {
    if (!el || !el.tagName) return null;
    const id = el.id ? '#' + el.id : '';
    const cls = (el.className && typeof el.className === 'string')
      ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : '';
    return el.tagName.toUpperCase() + id + cls;
  };
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) state.longTasks.push(Math.round(entry.duration));
    }).observe({ type: 'longtask', buffered: true });
  } catch (err) { state.errors.push('longtask: ' + err.message); }
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput) state.shifts += entry.value;
        // Sources are kept for EVERY entry, hadRecentInput or not. A shift
        // that moves something out from under the pointer is by definition
        // within 500 ms of a click, which is exactly when hadRecentInput is
        // true - so the recent-input filter that is right for the CLS number
        // is precisely wrong for attribution.
        for (const src of entry.sources || []) {
          const p = src.previousRect, c = src.currentRect;
          const box = (r) => (r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null);
          state.shiftSources.push({
            t: Math.round(entry.startTime), value: Number((entry.value || 0).toFixed(4)),
            recentInput: Boolean(entry.hadRecentInput), node: label(src.node),
            from: box(p), to: box(c),
          });
        }
        // A ceiling that is never released is the same as switching the check
        // off partway through the page's life. Every reader takes an OFFSET
        // into this buffer - SCROLL_PREP and the click sweep both do - so once
        // a hard cap stopped it growing, every later window read empty and
        // reported nothing, which is indistinguishable from "no defect". A
        // parallax or lazy-loading page fills eighty sources during the load
        // and the gesture alone, so that is exactly the page it went blind on.
        // Drop the OLDEST instead and COUNT what was dropped, so an offset
        // taken earlier still resolves to the right place.
        if (state.shiftSources.length > 400) {
          const over = state.shiftSources.length - 400;
          state.shiftSources.splice(0, over);
          state.shiftDropped += over;
        }
      }
    }).observe({ type: 'layout-shift', buffered: true });
  } catch (err) { state.errors.push('layout-shift: ' + err.message); }
  try {
    // long-animation-frame is what longtask attribution was supposed to be:
    // the same "this frame took too long" signal, but carrying the script,
    // the invoker and the forced synchronous layout that caused it. Where it
    // is not supported the buffer simply stays empty and every judgement
    // built on it is skipped - it is never approximated from durations.
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (state.loaf.length >= 150) break;
        state.loaf.push({
          start: Math.round(entry.startTime),
          duration: Math.round(entry.duration || 0),
          blocking: Math.round(entry.blockingDuration || 0),
          // There was a styleAndLayoutMs here. It computed frame-end minus
          // styleAndLayoutStart, which is not the renderStart gap its own
          // comment described, it guarded on a timestamp it never used, and
          // runScroll returns a summary object so the per-frame array never
          // left the function. A mislabelled number nobody reads is a trap for
          // whoever prints it next, so it is gone rather than corrected.
          scripts: (entry.scripts || []).slice(0, 4).map((s) => ({
            source: (String(s.sourceURL || '').split('/').pop() || '').slice(0, 48) || '(inline)',
            fn: s.sourceFunctionName || null,
            invoker: s.invokerType || null,
            duration: Math.round(s.duration || 0),
            forced: Math.round(s.forcedStyleAndLayoutDuration || 0),
          })),
        });
      }
    }).observe({ type: 'long-animation-frame', buffered: true });
    state.loafSupported = true;
  } catch (err) { state.errors.push('long-animation-frame: ' + err.message); }
})()`;

/* Two seconds of frames, and whether anything on the canvas changed across
 * them. Both halves matter: a canvas can repaint sixty times a second and paint
 * the same thing every time, and a page can animate beautifully at nineteen
 * frames a second. */
const MOTION = (ms) => `(async () => {
  const canvases = [...document.querySelectorAll('canvas')];
  // Sixteen, matching the flat-fill check. At eight, one sample cell of a
  // 200x120 canvas was 25 by 15 pixels, so a small shape moving a few pixels
  // a frame changed no sample at all and a perfectly live canvas reported
  // itself dead - most easily on a loaded machine, where fewer frames run
  // inside the window and the total movement is smallest.
  const n = 16;
  const fingerprint = () => canvases.map((canvas) => {
    try {
      const copy = document.createElement('canvas');
      copy.width = copy.height = n;
      const ctx = copy.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(canvas, 0, 0, n, n);
      return Array.from(ctx.getImageData(0, 0, n, n).data).join(',');
    } catch (err) { return null; }
  });
  // Sampled through the window, not just at its ends. Two samples call a
  // pendulum, a blink or any short loop dead whenever it happens to return to
  // where it started - and on a loaded machine, where few frames run, that is
  // exactly when it is most likely to.
  const before = fingerprint();
  const samples = [before];
  const frames = [];
  await new Promise((resolve) => {
    const start = performance.now();
    let last = start;
    let nextSample = start + ${ms} / 4;
    const tick = (now) => {
      frames.push(now - last);
      last = now;
      if (now >= nextSample) { samples.push(fingerprint()); nextSample += ${ms} / 4; }
      if (now - start < ${ms}) requestAnimationFrame(tick);
      else resolve();
    };
    requestAnimationFrame(tick);
  });
  samples.push(fingerprint());
  const after = samples[samples.length - 1];
  const moved = (i) => {
    let seen = null;
    for (const shot of samples) {
      if (shot[i] === null) return null;
      if (seen === null) seen = shot[i];
      else if (shot[i] !== seen) return true;
    }
    return false;
  };
  const timed = frames.slice(1).filter((value) => value > 0);
  const sorted = timed.slice().sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
  return JSON.stringify({
    frames: timed.length,
    fps: median ? Math.round(1000 / median) : null,
    worstFrameMs: sorted.length ? Math.round(sorted[sorted.length - 1]) : null,
    // A frame over 32 ms is a visible stutter at 60 Hz: one dropped, or more.
    dropped: timed.filter((value) => value > 32).length,
    canvases: canvases.map((canvas, i) => ({
      context: canvas.__inspectContext || null,
      animating: moved(i),
      samples: samples.length,
      width: Math.round(canvas.getBoundingClientRect().width),
    })),
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
  });
})()`;

/* Parallax, measured rather than declared. Scroll a fixed distance, watch where
 * every plane actually went, and express it as a rate: 1 is page speed, under 1
 * lags behind the page, over 1 leads it. Three planes that all read 1.00 are
 * three planes in name only. */
const DEPTH = (distance) => `(async () => {
  const planes = [...document.querySelectorAll('[data-depth], [data-parallax], .plane, .layer')];
  const named = (el) => (el.dataset.depth || el.dataset.parallax || el.className || el.tagName).toString().slice(0, 40);
  // A page can have two elements called .layer that were never meant to move.
  // Only an element that DECLARES a depth is promising anything, so only those
  // can be accused of not delivering it; the rest are reported and not judged.
  const declared = (el) => el.dataset.depth !== undefined || el.dataset.parallax !== undefined;
  const top = (el) => el.getBoundingClientRect().top;
  const start = window.scrollY;
  window.scrollTo({ top: 0, behavior: 'instant' });
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const before = planes.map(top);
  window.scrollTo({ top: ${distance}, behavior: 'instant' });
  window.dispatchEvent(new Event('scroll'));
  await new Promise((resolve) => setTimeout(resolve, 260));
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const after = planes.map(top);
  window.scrollTo({ top: start, behavior: 'instant' });
  return JSON.stringify({
    distance: ${distance},
    planes: planes.map((el, i) => ({
      name: named(el),
      declared: el.dataset.depth !== undefined ? Number(el.dataset.depth) : null,
      promises: declared(el),
      rate: ${distance} > 0 ? Number(((before[i] - after[i]) / ${distance}).toFixed(3)) : null,
      fixed: getComputedStyle(el).position === 'fixed',
    })),
  });
})()`;

/* ------------------------------------------------------- the driven run --- */
/* Checks 1, 2 and 5 are not three probes. They are ONE gesture, measured three
   ways: per-frame work (is it janky), plane rates (does the parallax happen)
   and named culprits (what cost that). Building them separately would mean
   three scrolls and three chances for the three answers to disagree about the
   same two seconds. */

/* Armed before the gesture. Starts a rAF sampler recording where the page and
   every plane actually are throughout the scroll, and counts the scroll events
   the gesture produces so per-frame work can be expressed per scroll event
   rather than in milliseconds - see runScroll() for why that matters. */
const SCROLL_PREP = `(() => {
  const m = window.__measure;
  if (!m) return JSON.stringify({ error: 'the measurement init script did not run' });
  // The LoAF buffer is cleared HERE, after load: page setup legitimately
  // produces a long frame (a 281 ms boot frame is normal) and charging that
  // to the scroll would call every page janky.
  m.loaf.length = 0;
  // ABSOLUTE index, not an array offset: the source buffer drops its oldest
  // entries once full, so a raw length taken now would point at the wrong
  // element by the time the gesture is read back.
  const shiftFrom = m.shiftSources.length + (m.shiftDropped || 0);
  const planes = [...document.querySelectorAll('[data-depth], [data-parallax], .plane, .layer')];
  const run = { samples: [], scrollEvents: 0, stop: false, planes, shiftFrom };
  window.__scrollRun = run;

  /* Geometry reads, bucketed by the scroll event that was being handled when
     each one happened. This is the signal that tells a handler reading on
     every scroll event from one expensive burst that merely lands inside the
     gesture, and unlike a long-frame count it is a property of the page's own
     code: long-animation-frame only reports frames over 50 ms, so a real
     read-then-write handler on a fast machine produces one long frame or none
     and a frame-count gate passes the defect through silently. A read either
     happened on this event or it did not, on any machine. */
  const reads = { total: 0, before: 0, buckets: [], readers: {} };
  run.reads = reads;
  // Held while OUR OWN probe reads geometry. The rAF sampler below reads every
  // plane's rect on every frame of the gesture, and counting that would charge
  // the page for the cost of being measured.
  let internal = 0;
  // Where a read came from, captured for the FIRST read of each scroll event
  // only: one stack per event is free, one per read (300 rows x 16 events) has
  // its own cost inside the window being measured. Every frame of this prep
  // script is anonymous - it arrives through Runtime.evaluate and has no source
  // URL - so the first frame carrying a real URL is the page's own code, and
  // the wrappers below skip themselves without having to be counted.
  const site = () => {
    const lines = String((new Error()).stack || '').split('\\n');
    for (const line of lines) {
      const at = line.trim();
      const url = at.match(/((?:https?|file|blob):[^\\s)]+?):(\\d+):\\d+/);
      if (!url) continue;
      const fn = (at.match(/^at\\s+([^\\s(]+)\\s+\\(/) || [])[1];
      const file = url[1].split('/').pop() || url[1];
      return file.slice(0, 48) + ':' + url[2] + (fn && fn !== '<anonymous>' ? ' - ' + fn + '()' : '');
    }
    return null;
  };
  const bump = () => {
    if (internal) return;
    reads.total++;
    if (!reads.buckets.length) { reads.before++; return; }
    const i = reads.buckets.length - 1;
    if (reads.buckets[i] === 0) {
      const from = site();
      if (from) reads.readers[from] = (reads.readers[from] || 0) + 1;
    }
    reads.buckets[i]++;
  };
  // Restored in SCROLL_READ before it reads anything itself. The page is put
  // back as it was found, exactly as the scroll position is.
  const undo = [];
  const wrapMethod = (host, name) => {
    const orig = host && host[name];
    if (typeof orig !== 'function') return;
    host[name] = function () { bump(); return orig.apply(this, arguments); };
    undo.push(() => { host[name] = orig; });
  };
  const wrapGetter = (proto, name) => {
    const d = proto && Object.getOwnPropertyDescriptor(proto, name);
    if (!d || typeof d.get !== 'function') return;
    const get = d.get;
    Object.defineProperty(proto, name, {
      configurable: true, enumerable: d.enumerable, set: d.set,
      get() { bump(); return get.call(this); },
    });
    undo.push(() => Object.defineProperty(proto, name, d));
  };
  wrapMethod(Element.prototype, 'getBoundingClientRect');
  wrapMethod(Element.prototype, 'getClientRects');
  wrapMethod(window, 'getComputedStyle');
  for (const name of ['clientTop', 'clientLeft', 'clientWidth', 'clientHeight', 'scrollTop', 'scrollLeft', 'scrollWidth', 'scrollHeight'])
    wrapGetter(Element.prototype, name);
  for (const name of ['offsetTop', 'offsetLeft', 'offsetWidth', 'offsetHeight', 'offsetParent'])
    wrapGetter(HTMLElement.prototype, name);
  run.unwrap = () => { while (undo.length) undo.pop()(); };

  // capture: true so this opens the bucket BEFORE the page's own scroll
  // listeners run. The page registered its at load and ours is added here, so
  // only the capture phase puts ours first; without it every read made by the
  // page's handler would be charged to the previous event.
  run.onScroll = () => { run.scrollEvents++; reads.buckets.push(0); };
  addEventListener('scroll', run.onScroll, { passive: true, capture: true });
  const tick = () => {
    if (run.stop) return;
    if (run.samples.length < 800) {
      internal++;
      try { run.samples.push({ y: window.scrollY, tops: planes.map((el) => el.getBoundingClientRect().top) }); }
      finally { internal--; }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  // Inside the guard as well: scrollHeight below is the probe measuring how far
  // the page can scroll, and a page that reads no geometry of its own must come
  // back reading none.
  internal++;
  try {
    return JSON.stringify({
      ok: true, planes: planes.length,
      width: innerWidth, height: innerHeight, scrollY: window.scrollY,
      maxScroll: Math.max(0, document.documentElement.scrollHeight - innerHeight),
      loafSupported: Boolean(m.loafSupported),
    });
  } finally { internal--; }
})()`;

/* Read back after the gesture, and put the page back where it was found -
   exactly as the teleporting DEPTH probe already did. */
const SCROLL_READ = (restore) => `(() => {
  const m = window.__measure;
  const run = window.__scrollRun;
  if (!run) return JSON.stringify({ error: 'the scroll run was never armed' });
  run.stop = true;
  // Before this function reads a single rect or computed style of its own -
  // otherwise the probe counts itself as the page thrashing.
  if (run.unwrap) { try { run.unwrap(); } catch (err) {} }
  removeEventListener('scroll', run.onScroll, { capture: true });
  const samples = run.samples;
  const ys = samples.map((s) => s.y);
  const travel = ys.length ? Math.max.apply(null, ys) - Math.min.apply(null, ys) : 0;
  const named = (el) => (el.dataset.depth || el.dataset.parallax || el.className || el.tagName).toString().slice(0, 40);
  // A page can have two elements called .layer that were never meant to move.
  // Only an element that DECLARES a depth is promising anything - kept from
  // the teleport probe, because this distinction is what took the false
  // positives out of it.
  const declared = (el) => el.dataset.depth !== undefined || el.dataset.parallax !== undefined;
  // Least squares of each plane's top against the page's own scroll position,
  // across every frame of the gesture. A gesture is asynchronous, so any two
  // samples can straddle a compositing step and read a correct parallax as
  // flat; a fit over thirty of them cannot.
  const meanY = ys.length ? ys.reduce((a, v) => a + v, 0) / ys.length : 0;
  let varY = 0;
  for (const y of ys) varY += (y - meanY) * (y - meanY);
  const usable = samples.length >= 8 && travel >= 400 && varY > 0;
  const planes = run.planes.map((el, i) => {
    let rate = null;
    if (usable) {
      const tops = samples.map((s) => s.tops[i]);
      const meanT = tops.reduce((a, v) => a + v, 0) / tops.length;
      let cov = 0;
      for (let k = 0; k < tops.length; k++) cov += (ys[k] - meanY) * (tops[k] - meanT);
      // top falls as the page scrolls, so a page-speed plane has slope -1 and
      // a rate of 1. Same convention the teleport probe used.
      const slope = cov / varY;
      rate = Number.isFinite(slope) ? Number((-slope).toFixed(3)) : null;
    }
    return {
      name: named(el),
      declared: el.dataset.depth !== undefined ? Number(el.dataset.depth) : null,
      promises: declared(el),
      rate,
      fixed: getComputedStyle(el).position === 'fixed',
    };
  });
  const sources = m ? m.shiftSources.slice(Math.max(0, run.shiftFrom - (m.shiftDropped || 0))) : [];
  const r = run.reads || { total: 0, before: 0, buckets: [], readers: {} };
  const out = {
    samples: samples.length, travel: Math.round(travel), scrollEvents: run.scrollEvents,
    usable, planes, loaf: m ? m.loaf.slice() : [], shiftSources: sources,
    reads: {
      total: r.total, before: r.before,
      // Scroll events the gesture produced, and how many of them forced at
      // least one geometry read. The denominator is counted here rather than
      // taken from scrollEvents so the two can never disagree.
      events: r.buckets.length,
      withReads: r.buckets.filter((n) => n > 0).length,
      readers: Object.keys(r.readers).map((k) => ({ site: k, events: r.readers[k] })).sort((a, b) => b.events - a.events).slice(0, 4),
    },
  };
  window.scrollTo({ top: ${restore}, behavior: 'instant' });
  delete window.__scrollRun;
  return JSON.stringify(out);
})()`;

/* Running animations, straight from the page. document.getAnimations() gives
   the list, the target and the play state in one evaluate, which is why the
   Animation CDP domain is not used: two mechanisms for one answer is how two
   probes drift apart. */
const ANIMATIONS = `(() => {
  if (!document.getAnimations) return JSON.stringify({ supported: false, animations: [], reduce: matchMedia('(prefers-reduced-motion: reduce)').matches });
  const out = [];
  for (const anim of document.getAnimations()) {
    let timing = null;
    try { timing = anim.effect && anim.effect.getComputedTiming ? anim.effect.getComputedTiming() : null; } catch (err) { timing = null; }
    const target = anim.effect && anim.effect.target ? anim.effect.target : null;
    out.push({
      name: anim.animationName || anim.transitionProperty || anim.id || 'animation',
      // A transition is a one-off response to a state change, not motion
      // design; only keyframe animations are judged.
      transition: Boolean(anim.transitionProperty),
      state: anim.playState,
      // Infinity does not survive Runtime.evaluate's returnByValue - it
      // serialises to null - so "does it loop forever" has to be answered
      // here, in the page, rather than inferred from a number on the far side.
      infinite: Boolean(timing && timing.iterations === Infinity),
      activeMs: timing && Number.isFinite(timing.activeDuration) ? Math.round(timing.activeDuration) : -1,
      // The PER-ITERATION duration, which activeDuration cannot carry: it is
      // Infinity for anything infinite and comes across as -1. The canonical
      // reduced-motion reset collapses animation-duration to 0.01ms and leaves
      // the iteration count alone, so the animation runs for ever while
      // covering a hundredth of a millisecond a pass. -1 means unknown.
      iterationMs: timing && Number.isFinite(timing.duration) ? timing.duration : -1,
      // Whether the author declared this an indeterminate progress indicator.
      // A spinner has to keep moving to mean anything and reasonable people
      // disagree about whether it should stop, so an explicit role is taken at
      // its word rather than argued with.
      indicator: (() => {
        let n = target;
        for (let i = 0; i < 4 && n && n.getAttribute; i++) {
          const role = n.getAttribute('role');
          if (role === 'progressbar' || role === 'status') return true;
          if (n.getAttribute('aria-busy') === 'true') return true;
          n = n.parentElement;
        }
        return false;
      })(),
      target: target && target.tagName ? target.tagName.toUpperCase() + (target.id ? '#' + target.id : '') : null,
    });
    if (out.length >= 40) break;
  }
  return JSON.stringify({ supported: true, animations: out, reduce: matchMedia('(prefers-reduced-motion: reduce)').matches });
})()`;

/* Motion that document.getAnimations() cannot see. A requestAnimationFrame
   loop writing el.style.transform creates no Animation object at all, so the
   reduced-motion check was structurally blind to it - and that is how most
   hand-written motion is driven, this plugin's own motion.js and depth.js
   included. A page that flatly ignored the setting reported clean.

   Measured, not enumerated: sample the computed transform, opacity and box of
   the page across a window and ask what is STILL moving at the end of it. The
   two-interval rule is the guard - an entrance that finishes changes between
   the first pair of samples and not the second, and freezing a page mid-way
   through an animation it already started is not what the setting asks for. */
const RAF_MOTION = (ms) => `(async () => {
  // Anything getAnimations() already accounts for is excluded, so the two
  // findings never name the same element twice. A finite-but-long CSS
  // animation is NOT in that set and is caught here, which is the second hole
  // the infinite-only filter left open.
  const skip = new Set();
  try { for (const a of document.getAnimations()) { const t = a.effect && a.effect.target; if (t) skip.add(t); } } catch (err) {}
  const nodes = [];
  for (const el of document.querySelectorAll('body *')) {
    if (nodes.length >= 300) break;
    if (skip.has(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    nodes.push(el);
  }
  const snap = () => nodes.map((el) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return cs.transform + '|' + cs.opacity + '|' + Math.round(r.x * 10) + ',' + Math.round(r.y * 10);
  });
  const wait = (t) => new Promise((r) => setTimeout(r, t));
  const a = snap();
  await wait(${Math.round(ms / 2)});
  const b = snap();
  await wait(${Math.round(ms / 2)});
  const c = snap();
  const live = new Set();
  for (let i = 0; i < nodes.length; i++) if (a[i] !== b[i] && b[i] !== c[i]) live.add(nodes[i]);
  const moving = [];
  for (const el of live) {
    // A moving element drags its whole subtree, and naming forty descendants
    // of one drifting section is noise. Only the topmost mover is named.
    let p = el.parentElement, nested = false;
    while (p) { if (live.has(p)) { nested = true; break; } p = p.parentElement; }
    if (nested) continue;
    moving.push(el.tagName.toUpperCase() + (el.id ? '#' + el.id : ''));
    if (moving.length >= 6) break;
  }
  return JSON.stringify({ sampled: nodes.length, moving });
})()`;

/* What the page cost to load, and what it loaded and then did not use. The
 * unused-library check is deliberately narrow: each entry names a global that
 * only exists if the script ran, and a test that is true only if something
 * actually used it. A library present and idle is the most expensive kind of
 * dead code, because it is in the critical path. */
const COST = `(() => {
  const resources = performance.getEntriesByType('resource');
  const bytes = (entry) => entry.transferSize || entry.encodedBodySize || 0;
  const total = resources.reduce((sum, entry) => sum + bytes(entry), 0);
  const nav = performance.getEntriesByType('navigation')[0] || null;
  const idle = [];
  const check = (name, present, used) => {
    let here = false, active = false;
    try { here = Boolean(present()); } catch (err) { here = false; }
    if (!here) return;
    try { active = Boolean(used()); } catch (err) { active = false; }
    if (!active) idle.push(name);
  };
  check('GSAP', () => window.gsap, () => window.gsap.globalTimeline.getChildren(true, true, true).length || (window.ScrollTrigger && window.ScrollTrigger.getAll().length));
  // three is normally an ES module behind an import map, so window.THREE does
  // not exist even when the page is 160 KB heavier for it. Ask the network log
  // whether it was fetched instead of asking the global scope.
  const fetched = (pattern) => resources.some((entry) => pattern.test(entry.name));
  check('three.js', () => window.THREE || fetched(/three(\\.module)?(\\.min)?\\.js|three@/i),
    () => [...document.querySelectorAll('canvas')].some((c) => /webgl/.test(c.__inspectContext || '')));
  check('Lenis', () => window.Lenis, () => window.__lenis || document.documentElement.classList.contains('lenis'));
  check('anime.js', () => window.anime, () => window.anime.running && window.anime.running.length);
  check('Lottie', () => window.lottie, () => window.lottie.getRegisteredAnimations && window.lottie.getRegisteredAnimations().length);
  check('Matter.js', () => window.Matter, () => window.__matterEngine);
  check('PixiJS', () => window.PIXI, () => document.querySelector('canvas'));
  const heavy = resources
    .map((entry) => ({ url: entry.name.split('/').pop().slice(0, 48), kb: Math.round(bytes(entry) / 1024), type: entry.initiatorType }))
    .filter((entry) => entry.kb > 0)
    .sort((a, b) => b.kb - a.kb)
    .slice(0, 6);
  const measure = window.__measure || { longTasks: [], shifts: 0, shiftSources: [] };
  // The elements that actually moved, riding along with the number they
  // explain. Attribution is a detail line on the shift finding, never a
  // finding of its own - see judge().
  const shiftSources = (measure.shiftSources || []).filter((s) => !s.recentInput && s.node).slice(0, 6);
  return JSON.stringify({
    shiftSources,
    requests: resources.length,
    totalKb: Math.round(total / 1024),
    scriptKb: Math.round(resources.filter((entry) => entry.initiatorType === 'script').reduce((sum, entry) => sum + bytes(entry), 0) / 1024),
    imageKb: Math.round(resources.filter((entry) => entry.initiatorType === 'img' || entry.initiatorType === 'css').reduce((sum, entry) => sum + bytes(entry), 0) / 1024),
    heavy,
    idleLibraries: idle,
    domContentLoadedMs: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
    loadMs: nav ? Math.round(nav.loadEventEnd) : null,
    longTasks: measure.longTasks.length,
    longestTaskMs: measure.longTasks.length ? Math.max.apply(null, measure.longTasks) : 0,
    layoutShift: Number((measure.shifts || 0).toFixed(3)),
    nodes: document.getElementsByTagName('*').length,
  });
})()`;

/* One CSS colour, as sRGB, whatever colour space it was authored in.
 *
 * getComputedStyle does NOT normalise colour: a page written in oklch() gets
 * "oklch(0.5586 0.1359 51.4)" back, color-mix() comes back as "oklab(...)",
 * and anything that reads the numbers out of an rgb() string sees none of it.
 * That is not exotic input - this plugin's own core.css defines its whole
 * palette in oklch, so every page built in the house style would be
 * unreadable to a naive parser. Painting the colour into a 1x1 canvas and
 * reading the pixel back is the one conversion that works for every CSS
 * Color 4 value, and it is the same trick inspect.mjs's PROBE uses.
 *
 * getImageData is unpremultiplied, so a translucent colour still yields its
 * own channels; minAlpha lets a caller who is measuring PAINTED AREA reject
 * a colour too faint to count as a ground, while a caller measuring ink
 * takes the colour regardless of its alpha. */
export const COLOUR_JS = `
  const __cv = document.createElement('canvas');
  __cv.width = __cv.height = 1;
  const __cx = __cv.getContext('2d', { willReadFrequently: true });
  const __memo = new Map();
  const toRgb = (str, minAlpha) => {
    const floor = minAlpha || 0;
    if (!str || str === 'transparent') return null;
    const key = str + '|' + floor;
    if (__memo.has(key)) return __memo.get(key);
    let out = null;
    try {
      __cx.clearRect(0, 0, 1, 1);
      // Two assignments: an invalid value leaves fillStyle at the previous
      // one, so seeding a known colour first makes "did not parse" visible
      // instead of silently reporting whatever was set last.
      __cx.fillStyle = '#000';
      __cx.fillStyle = str;
      __cx.fillRect(0, 0, 1, 1);
      const d = __cx.getImageData(0, 0, 1, 1).data;
      out = d[3] < floor ? null : 'rgb(' + d[0] + ', ' + d[1] + ', ' + d[2] + ')';
    } catch (e) { out = null; }
    __memo.set(key, out);
    return out;
  };
`;

/* Typography and ground, as computed values. Not taste - counts. A scale has a
 * handful of steps; a page with twenty distinct sizes has no scale, it has
 * twenty decisions nobody made together. */
export const TYPE = `(() => {
  ${COLOUR_JS}
  const sizes = new Map();
  const families = new Map();
  const colours = new Map();
  let measured = null;
  let display = null;
  const visible = (el) => {
    const rect = el.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) return false;
    const style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0;
  };
  for (const el of document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,a,span,blockquote,figcaption,dt,dd,button,label')) {
    const text = (el.textContent || '').trim();
    if (!text || !visible(el)) continue;
    const own = [...el.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim());
    if (!own) continue;
    const style = getComputedStyle(el);
    const size = Math.round(parseFloat(style.fontSize));
    sizes.set(size, (sizes.get(size) || 0) + 1);
    const family = style.fontFamily.split(',')[0].replace(/["']/g, '').trim();
    families.set(family, (families.get(family) || 0) + 1);
    // Normalised to sRGB, with the raw computed string kept only if the
    // conversion failed - a colour nothing can read is still worth naming.
    const ink = toRgb(style.color, 0) || style.color;
    colours.set(ink, (colours.get(ink) || 0) + 1);
    // The display line: the largest text on the page. It appears exactly once
    // by definition, which is precisely why parity's "used only once is a
    // stray" filter must not be allowed to drop it - it is the element a
    // design is most about. Recorded here because only the probe knows which
    // colour belongs to which size.
    if (!display || size > display.px) display = { px: size, colour: ink, tag: el.tagName.toLowerCase() };
    if (el.tagName === 'P' && text.length > 120 && measured === null) {
      // Characters per line, from the width the paragraph actually occupies
      // and the width one character actually takes.
      const probe = document.createElement('span');
      probe.textContent = 'abcdefghijklmnopqrstuvwxyz';
      probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;font:' + style.font;
      document.body.appendChild(probe);
      const per = probe.getBoundingClientRect().width / 26;
      probe.remove();
      if (per > 0) measured = Math.round(el.getBoundingClientRect().width / per);
    }
  }
  const body = getComputedStyle(document.body);
  const ordered = [...sizes.entries()].sort((a, b) => b[0] - a[0]);
  return JSON.stringify({
    distinctSizes: sizes.size,
    // Sizes and colours with their usage counts, not just the count of them:
    // design parity has to be able to drop a size used exactly once (a stray
    // inline style is not a type scale) and to name the actual colours, and
    // neither is recoverable from a bare tally.
    sizeCounts: [...sizes.entries()].sort((a, b) => b[0] - a[0]),
    textColours: [...colours.entries()].sort((a, b) => b[1] - a[1]),
    display,
    largestPx: ordered.length ? ordered[0][0] : null,
    smallestPx: ordered.length ? ordered[ordered.length - 1][0] : null,
    scale: ordered.slice(0, 12).map((entry) => entry[0]),
    families: [...families.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map((entry) => entry[0]),
    distinctTextColours: colours.size,
    measureChars: measured,
    // Through the same conversion as everything else above, so that no reader
    // of this report has to know which of its colour fields is normalised.
    background: toRgb(body.backgroundColor, 0) || body.backgroundColor,
    colour: toRgb(body.color, 0) || body.color,
    fontsLoaded: document.fonts ? document.fonts.status : 'unknown',
  });
})()`;

async function evaluate(session, expression, awaitPromise) {
  const result = await session.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: Boolean(awaitPromise) });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'measurement failed');
  const value = result.result && result.result.value;
  if (typeof value !== 'string') throw new Error('measurement returned no report');
  return JSON.parse(value);
}

/* One real scroll, measured throughout. Needs the CDP session because the
   gesture is a CDP command; measure() already takes one.
   Returns { measured:false, why } rather than throwing whenever the page or
   the browser cannot support the measurement - an unmeasured page must not be
   able to fail. */
export async function runScroll(session, options = {}) {
  const { distance = 700 } = options;
  const prep = await evaluate(session, SCROLL_PREP, false);
  if (prep.error) return { measured: false, why: prep.error };
  // A page shorter than the gesture produces a truncated scroll and a rate
  // fitted to noise. Below 400 px of available travel there is nothing here
  // worth measuring, so nothing is reported.
  const room = Math.max(0, prep.maxScroll - prep.scrollY);
  const want = Math.min(distance, room);
  if (want < 400) {
    await evaluate(session, SCROLL_READ(prep.scrollY), false).catch(() => ({}));
    return { measured: false, why: 'the page is too short to scroll (' + Math.round(room) + 'px of travel available)' };
  }

  // Performance.getMetrics deltas are the honest half of the jank measurement:
  // LayoutCount is a property of the CODE (7500 layouts for one gesture is
  // 7500 layouts on any machine), while every millisecond figure is a property
  // of the machine that happened to run it.
  await session.send('Performance.enable').catch(() => {});
  const readMetrics = async () => {
    const r = await session.send('Performance.getMetrics').catch(() => null);
    const map = {};
    for (const m of (r && r.metrics) || []) map[m.name] = m.value;
    return map;
  };
  const before = await readMetrics();

  const x = Math.round(prep.width / 2), y = Math.round(prep.height / 2);
  let how = 'synthesizeScrollGesture';
  try {
    // gestureSourceType is pinned to mouse so a mobile-width run still gets
    // wheel events: a synthesised swipe can be swallowed by touch-action and
    // then the page "did not scroll" for a reason that has nothing to do with
    // the page.
    await session.send('Input.synthesizeScrollGesture', {
      x, y, yDistance: -want, speed: 1200, gestureSourceType: 'mouse', repeatCount: 0,
    });
  } catch (err) {
    // Documented fallback: synthesizeScrollGesture is an experimental command.
    // Six discrete wheel events are coarser (fewer samples, blockier travel)
    // but they are real wheel events, which is what the check needs.
    how = 'dispatchMouseEvent wheel';
    const steps = Math.max(6, Math.round(want / 120));
    for (let i = 0; i < steps; i++) {
      await session.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: Math.round(want / steps) }).catch(() => {});
      await new Promise((r) => setTimeout(r, 16));
    }
  }
  const after = await readMetrics();
  const read = await evaluate(session, SCROLL_READ(prep.scrollY), false);
  if (read.error) return { measured: false, why: read.error };

  const delta = (name) => (Number.isFinite(after[name]) && Number.isFinite(before[name]) ? after[name] - before[name] : null);
  const metrics = {
    layoutCount: delta('LayoutCount'), recalcStyleCount: delta('RecalcStyleCount'),
    layoutMs: Number.isFinite(delta('LayoutDuration')) ? Math.round(delta('LayoutDuration') * 1000) : null,
    recalcStyleMs: Number.isFinite(delta('RecalcStyleDuration')) ? Math.round(delta('RecalcStyleDuration') * 1000) : null,
    scriptMs: Number.isFinite(delta('ScriptDuration')) ? Math.round(delta('ScriptDuration') * 1000) : null,
    taskMs: Number.isFinite(delta('TaskDuration')) ? Math.round(delta('TaskDuration') * 1000) : null,
  };

  const scripts = [];
  for (const frame of read.loaf || []) for (const s of frame.scripts || []) scripts.push(s);
  const grouped = new Map();
  for (const s of scripts) {
    const key = (s.source || '(inline)') + (s.invoker ? ' [' + s.invoker + ']' : '');
    const cur = grouped.get(key) || { key, forced: 0, duration: 0, cost: 0, fns: new Map() };
    cur.forced += s.forced || 0;
    cur.duration += s.duration || 0;
    // forcedStyleAndLayoutDuration is a SUBSET of duration - the forced layout
    // happens inside the script's own execution - so adding the two counted
    // the forced part twice and inflated whichever script forces layout
    // against one that merely runs long. The cost of a script is its duration;
    // the max is only there so a missing duration cannot read as free.
    const cost = Math.max(s.duration || 0, s.forced || 0);
    cur.cost += cost;
    if (s.fn) cur.fns.set(s.fn, (cur.fns.get(s.fn) || 0) + cost);
    grouped.set(key, cur);
  }
  const ranked = [...grouped.values()].sort((a, b) => b.cost - a.cost);
  const totalCost = ranked.reduce((sum, s) => sum + s.cost, 0);
  // Naming the WRONG culprit is worse than naming none: a confident wrong name
  // sends someone to edit correct code. One source has to account for a clear
  // majority of the measured cost before it is named at all.
  const culprit = ranked.length && totalCost > 0 && ranked[0].cost / totalCost >= 0.6 ? ranked[0] : null;
  if (culprit) {
    // LoAF names the FUNCTION, not just the file, and that name was being
    // measured and thrown away - so on any bundled site the finding said
    // "app.js [event-listener]" and sent nobody anywhere. The function is
    // carried through whenever one of them accounts for the majority of that
    // file's own cost; below that the file alone is the honest answer.
    const fns = [...culprit.fns.entries()].sort((a, b) => b[1] - a[1]);
    const top = fns.length && culprit.cost > 0 && fns[0][1] / culprit.cost >= 0.6 ? fns[0][0] : null;
    culprit.fn = top;
    culprit.label = culprit.key + (top ? ' - ' + top + '()' : '');
    delete culprit.fns;
  }
  const loaf = {
    supported: Boolean(prep.loafSupported),
    count: (read.loaf || []).length,
    longestMs: (read.loaf || []).reduce((max, f) => Math.max(max, f.duration || 0), 0),
    blockingMs: (read.loaf || []).reduce((sum, f) => sum + (f.blocking || 0), 0),
    forcedMs: scripts.reduce((sum, s) => sum + (s.forced || 0), 0),
    culprit,
  };
  const events = read.scrollEvents || 0;
  /* Geometry reads, bucketed by the scroll event they happened under - the
     signal that separates a handler reading on EVERY event from one expensive
     burst that merely lands inside the gesture. readRatio is the fraction of
     the gesture's scroll events that forced at least one read, and like the
     layout ratio it is a property of the page's own code: the same handler
     reads on the same events on a fast runner and a slow one. */
  const r = read.reads || null;
  const reads = r ? {
    total: r.total, before: r.before, events: r.events, withReads: r.withReads,
    readRatio: r.events > 0 ? Number((r.withReads / r.events).toFixed(2)) : null,
    readers: r.readers || [],
  } : null;
  return {
    measured: true, how, requested: want, travel: read.travel, samples: read.samples,
    scrollEvents: events, usable: read.usable, planes: read.planes,
    metrics, loaf, reads,
    // Layouts per scroll event, not per second: the ratio is a property of the
    // page's own code and reproduces on any machine, where a duration does not.
    layoutsPerScroll: Number.isFinite(metrics.layoutCount) && events > 0
      ? Number((metrics.layoutCount / events).toFixed(1)) : null,
    shiftSources: (read.shiftSources || []).filter((s) => s.node).slice(0, 8),
  };
}

/* Does the page respond to prefers-reduced-motion.
   Two paths, and the difference between them is the whole guard: emulating the
   media live changes matchMedia and drains getAnimations() with no reload,
   which is fast and is all a single inspect() run can do - but a page that
   reads matchMedia ONCE at boot in JS does not re-evaluate, so a live flip
   alone would falsely accuse a page that honours the setting perfectly.
   A negative from the live flip is therefore never reported on its own; only
   a pass that NAVIGATED under the emulated media can produce a finding, and
   debug.mjs already performs exactly that second navigation. */
export async function measureReducedMotion(session, options = {}) {
  const emulated = options.reducedMotion ? 'reduce' : 'no-preference';
  const setMedia = (value) => session.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value }],
  });
  const settle = () => evaluate(session, `(async () => { await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); return JSON.stringify({ ok: 1 }); })()`, true).catch(() => ({}));
  const read = async () => evaluate(session, ANIMATIONS, false);
  // Guard (b): a page that PAUSES its motion keeps its entries in
  // getAnimations() forever, so raw .length is not a measurement of anything.
  // Only a running keyframe animation that loops forever is counted: a finite
  // one may simply be an entrance still playing, and calling that "ignored the
  // setting" is a coin flip dressed as a check.
  const looping = (list) => (list || []).filter((a) => a.state === 'running' && !a.transition && a.infinite
    // Guard (d): the reset that collapses animation-duration to 0.01ms and
    // leaves iteration-count alone is one of the three ways the canonical
    // snippet is written, and it works - each pass is a hundredth of a
    // millisecond, so nothing perceptible moves. Under one frame at any
    // refresh rate anyone owns is not motion, and condemning it was
    // condemning a page for honouring the setting. Only a POSITIVELY measured
    // sub-frame duration excludes; an unknown one is still judged.
    && !(Number.isFinite(a.iterationMs) && a.iterationMs >= 0 && a.iterationMs < 4)
    // Guard (e): an indeterminate progress indicator the author has labelled
    // as one. The media query asks for motion that triggers discomfort to be
    // removed or replaced, not for every moving pixel to stop, and a checker
    // that opens with an ERROR against any page with a loading state is a
    // checker that gets switched off.
    && !a.indicator);

  const here = await read();
  const atNav = looping(here.animations);
  let underReduce = atNav;
  let liveFlip = false;
  if (emulated !== 'reduce') {
    try {
      await setMedia('reduce');
      await settle();
      underReduce = looping((await read()).animations);
      liveFlip = true;
    } catch (err) { underReduce = atNav; liveFlip = false; }
    finally { await setMedia('no-preference').catch(() => {}); await settle(); }
  }
  // The observation surface getAnimations() cannot reach. Only run on the pass
  // that NAVIGATED under the emulated media, because only that pass can
  // produce a finding, and it costs the better part of a second.
  let rafMoving = [];
  if (emulated === 'reduce') {
    const sampled = await evaluate(session, RAF_MOTION(900), true).catch(() => ({ moving: [] }));
    rafMoving = sampled.moving || [];
  }
  return {
    supported: here.supported !== false,
    emulated,
    // What this pass NAVIGATED with. Only this is authoritative.
    running: atNav.length,
    names: atNav.slice(0, 4).map((a) => a.name + (a.target ? ' on ' + a.target : '')),
    // Script-driven motion, measured rather than enumerated. Kept as its own
    // field so the two findings stay disjoint and neither borrows the other's
    // wording.
    rafMoving,
    // The live flip, kept for the record and for debug.mjs's cross-pass
    // reconciliation. Never judged on its own.
    liveFlip, runningUnderLiveFlip: underReduce.length,
    baseline: options.baseline || null,
  };
}

export async function measure(session, options = {}) {
  const { motionMs = 1600, depthDistance = 700 } = options;
  const out = {};
  out.motion = await evaluate(session, MOTION(motionMs), true).catch((err) => ({ error: err.message }));
  // One gesture, three measurements. Lands under a NEW key: out.cost keeps
  // meaning load-time cost, so nothing that already reads this object changes
  // meaning underneath it.
  out.run = await runScroll(session, { distance: depthDistance }).catch((err) => ({ measured: false, why: err.message }));
  // DEPTH is re-sourced, not deleted: the plane discovery, the
  // declared-vs-merely-.layer distinction and the fixed-position exclusion are
  // the parts that took the false positives out of it and they are unchanged.
  // Only the two-sample before/after is replaced by the fit over the gesture.
  if (out.run.measured && out.run.usable) {
    out.depth = { distance: out.run.travel, planes: out.run.planes, source: 'gesture' };
  } else {
    out.depth = await evaluate(session, DEPTH(depthDistance), true).catch((err) => ({ error: err.message }));
    if (out.depth && !out.depth.error) out.depth.source = 'teleport';
  }
  out.cost = await evaluate(session, COST, false).catch((err) => ({ error: err.message }));
  out.type = await evaluate(session, TYPE, false).catch((err) => ({ error: err.message }));
  // Last, because it emulates a media feature and puts it back: anything
  // measured after it would be measured through the restoration.
  out.reduce = await measureReducedMotion(session, options).catch((err) => ({ error: err.message }));
  return out;
}

/* The thresholds, in one place, with the reason next to each. They are stated
 * as numbers so they can be argued with, which is the point: a report that says
 * "feels slow" cannot be checked and a report that says "38 fps, budget 55"
 * can. */
export const BUDGETS = {
  fps: 55,
  droppedRatio: 0.1,
  longestTaskMs: 200,
  layoutShift: 0.1,
  scriptKb: 500,
  totalKb: 2500,
  distinctSizes: 8,
  measureChars: [45, 80],
  depthSpread: 0.08,
  // Layouts forced per scroll event. A read-then-write scroll handler over 300
  // rows measured ~69; a passive handler writing one custom property measured
  // 0. Four leaves room for a page that legitimately measures a couple of
  // things per event without leaving room for a thrash.
  layoutsPerScroll: 4,
  // Long animation frames during the gesture. On its own this is only ever a
  // warning - a loaded machine can produce one on any page - and it takes five
  // of them plus real blocking time before even that is said.
  loafFrames: 5,
  loafBlockingMs: 200,
  /* What the layout ratio needs alongside it before it is called per-event.
     A single expensive burst - one IntersectionObserver measuring 800 words
     and disconnecting - suppresses the very scroll events it is divided by, so
     its whole one-frame cost came out looking like per-event thrash and had to
     be told apart from the real thing.
     This used to be a long-frame count, and that was wrong in the one
     direction a checker must never be wrong in: long-animation-frame only
     reports frames over 50 ms, so the same read-then-write handler produced 9
     long frames on a laptop and exactly 1 on a fast CI runner, and requiring 3
     let the real defect through in silence there. A geometry read either
     happened while a scroll event was being handled or it did not, on every
     machine - so the recurrence is counted in reads per scroll event instead.
     Measured on the three fixtures: the read-then-write handler read on 5 of 5
     scroll events (ratio 1.00), the one-off burst on 1 of 21 (0.05), and the
     control that reads no geometry on 0 of 64 (0.00). */
  // Scroll events that must have forced at least one read. "One burst" is
  // exactly one by construction, so two is the smallest number that means
  // recurrence - and unlike a ratio it cannot be reached by a gesture that
  // produced only two scroll events.
  readEvents: 2,
  // And the share of the gesture's events that read. Half sits far outside
  // both measured clusters in either direction.
  readEventRatio: 0.5,
};

export function judge(measured, context = {}) {
  const findings = [];
  const note = (level, text, detail) => findings.push({ level, text, detail: detail || null });
  const motion = measured.motion || {};
  const depth = measured.depth || {};
  const cost = measured.cost || {};
  const type = measured.type || {};

  if (motion.error) note('note', 'motion could not be measured: ' + motion.error);
  else {
    const animated = (motion.canvases || []).filter((canvas) => canvas.animating === true).length;
    const still = (motion.canvases || []).filter((canvas) => canvas.animating === false).length;
    if (motion.reducedMotion) {
      // Under reduced motion the right answer is the opposite one.
      if (animated) note('error', animated + ' canvas still animating under prefers-reduced-motion', 'draw one frame and stop');
      else if (still) note('ok', still + ' canvas correctly still under reduced motion');
    } else {
      if (still) note('warn', still + ' canvas painted once and never changed', 'if it is meant to be alive, it is not');
      if (animated) note('ok', animated + ' canvas is animating');
      if (Number.isFinite(motion.fps) && motion.fps < BUDGETS.fps) {
        note('error', 'median ' + motion.fps + ' fps, under the ' + BUDGETS.fps + ' budget', 'worst frame ' + motion.worstFrameMs + ' ms');
      } else if (Number.isFinite(motion.fps) && motion.fps > 120) {
        // Headless Chrome does not lock rAF to a display, so a number like this
        // is the ceiling the work leaves room for, not the rate anyone sees.
        // The frame that took longest is the honest half of this measurement.
        note('ok', 'frames cost ' + Math.round(1000 / motion.fps) + ' ms each (no vsync headless, so read the worst frame: ' + motion.worstFrameMs + ' ms)');
      } else if (Number.isFinite(motion.fps)) {
        note('ok', motion.fps + ' fps median');
      }
      if (motion.frames && motion.dropped / motion.frames > BUDGETS.droppedRatio) {
        note('warn', Math.round((motion.dropped / motion.frames) * 100) + '% of frames took over 32 ms');
      }
    }
  }

  /* prefers-reduced-motion, judged ONLY on a pass that navigated with the
     media emulated from before the first document ran. The live flip inside
     measure() is a pre-filter and cannot condemn anything: a page that reads
     matchMedia once at boot honours the setting perfectly and still keeps
     animating when the media is flipped mid-life, and accusing it would be
     the exact false positive that gets a checker switched off. */
  const reduce = measured.reduce || {};
  if (reduce.emulated === 'reduce' && Number.isFinite(reduce.running) && reduce.running > 0) {
    const was = reduce.baseline && Number.isFinite(reduce.baseline.running)
      ? '; the no-preference pass ran ' + reduce.baseline.running : '';
    note('error', reduce.running + ' looping animation' + (reduce.running === 1 ? '' : 's') + ' still running under prefers-reduced-motion',
      (reduce.names || []).join(', ') + was);
  }
  /* The other half of the same question, and the one getAnimations() cannot
     answer: motion driven by a requestAnimationFrame loop, which creates no
     Animation object and so reported zero on a page that ignores the setting
     outright. Sampled under the same navigated-with-the-media rule. */
  const rafMoving = (reduce.rafMoving || []);
  if (reduce.emulated === 'reduce' && rafMoving.length > 0) {
    note('error', rafMoving.length + ' element' + (rafMoving.length === 1 ? '' : 's') + ' still moving under prefers-reduced-motion',
      rafMoving.join(', ') + ' - driven by script, so there is no animation to stop, only a loop to not start');
  }

  /* Motion over time: what one real scroll cost, judged on work counts rather
     than on wall-clock. Every millisecond figure below is supporting detail,
     never the trigger - a loaded CI box makes any duration cross any
     threshold, while 7500 layouts for one gesture is 7500 layouts anywhere. */
  const run = measured.run || {};
  if (run.measured) {
    const loaf = run.loaf || {};
    const cost = [];
    if (Number.isFinite(run.metrics?.layoutCount)) cost.push(run.metrics.layoutCount + ' layouts');
    if (Number.isFinite(run.metrics?.layoutMs)) cost.push(run.metrics.layoutMs + ' ms in layout');
    if (loaf.forcedMs) cost.push(loaf.forcedMs + ' ms of forced synchronous layout');
    // Attribution rides here as a detail line rather than as a finding of its
    // own: fixtures assert the COMPLETE finding set, so a probe that appends
    // a finding to every measured page would break every one of them.
    const named = loaf.culprit ? ' - ' + (loaf.culprit.label || loaf.culprit.key) + ', ' + loaf.culprit.forced + ' ms forced' : '';
    const frames = loaf.count + ' long frame' + (loaf.count === 1 ? '' : 's');
    /* Did the reading RECUR across the gesture. The denominator of the layout
       ratio is scroll events and heavy work SUPPRESSES scroll events, so one
       expensive burst divides its whole one-frame cost by a denominator it
       collapsed itself and comes out naming a per-event thrash that does not
       exist. A handler that really thrashes reads geometry on every event it
       handles; a burst reads on one. That distinction is a property of the
       page's own code, which is why it replaced the long-frame count that used
       to sit here - see BUDGETS.readEvents. */
    const reads = run.reads || null;
    const recurs = Boolean(reads) && reads.withReads >= BUDGETS.readEvents
      && Number.isFinite(reads.readRatio) && reads.readRatio >= BUDGETS.readEventRatio;
    // The machine-independent evidence first, because it is the trigger; every
    // millisecond figure after it is supporting detail.
    const where = reads && reads.readers.length ? ' at ' + reads.readers[0].site : '';
    const recurrence = reads
      ? 'geometry read on ' + reads.withReads + ' of ' + reads.events + ' scroll event' + (reads.events === 1 ? '' : 's') + where
      : null;
    if (Number.isFinite(run.layoutsPerScroll) && run.layoutsPerScroll > BUDGETS.layoutsPerScroll && recurs) {
      // Two signals, never one: reads alone can be a page that measures one
      // thing cheaply per event, a layout count alone can be a page that
      // legitimately relaid out once.
      note('error', 'scrolling forces ' + run.layoutsPerScroll + ' layouts per scroll event (budget ' + BUDGETS.layoutsPerScroll + ')',
        [recurrence, cost.join(', ') || null].filter(Boolean).join('; ') + named);
    } else if (loaf.count >= BUDGETS.loafFrames && loaf.blockingMs > BUDGETS.loafBlockingMs) {
      note('warn', frames + ' during the scroll, ' + loaf.blockingMs + ' ms blocking',
        cost.length ? cost.join(', ') + named : null);
    }
  }

  if (depth.error) note('note', 'parallax could not be measured: ' + depth.error);
  else if ((depth.planes || []).length) {
    // A plane whose rate did not come back as a number was not measured, and
    // an unmeasured plane cannot fail: JSON turns NaN into null across the
    // page boundary, and null.toFixed() was a crash after a full browser run.
    const moving = depth.planes.filter((plane) => !plane.fixed && Number.isFinite(plane.rate));
    const rates = moving.map((plane) => plane.rate);
    const spread = rates.length ? Math.max.apply(null, rates) - Math.min.apply(null, rates) : 0;
    // Only planes that declared a depth are failing a promise. A page with two
    // elements happening to be called .layer is not making one, and an ERROR
    // there is the kind of false positive that gets a checker ignored.
    //
    // And the verdict on the promised planes is measured on the promised
    // planes: judging them by a spread that included the unlabelled ones let
    // a decorative .layer that happened to move hide two declared planes that
    // did not, and the reverse.
    const promised = moving.filter((plane) => plane.promises !== false);
    const promisedRates = promised.map((plane) => plane.rate);
    const promisedSpread = promisedRates.length ? Math.max.apply(null, promisedRates) - Math.min.apply(null, promisedRates) : 0;
    if (promised.length >= 2 && promisedSpread < BUDGETS.depthSpread) {
      note(
        'error',
        promised.length + ' declared planes all move at the same rate (' + promisedRates[0].toFixed(2) + ')',
        'the parallax is in the markup but not on the screen'
      );
    } else if (moving.length >= 2 && spread < BUDGETS.depthSpread) {
      note('note', moving.length + ' layer-like elements move together; none of them declares a depth');
    } else if (moving.length >= 2) {
      note('ok', moving.length + ' planes at ' + rates.map((rate) => rate.toFixed(2)).join(' / ') + ' (1.00 is page speed)');
    }
    for (const plane of depth.planes) {
      if (plane.declared !== null && plane.declared !== 0 && !plane.fixed && Math.abs(plane.rate - 1) < 0.02) {
        note('warn', 'plane "' + plane.name + '" declares depth ' + plane.declared + ' but moves at page speed');
      }
    }
  } else if (context.expectDepth) {
    note('warn', 'no parallax planes found', 'the house style layers foreground, middle and background');
  }

  // A probe that came back without a field is not a probe that measured zero.
  // Reading `.length` off a missing idleLibraries threw right here, which turned
  // an incomplete measurement into a crash instead of a quiet omission.
  if (!cost.error && Number.isFinite(cost.requests)) {
    const idle = cost.idleLibraries || [];
    if (idle.length) {
      note('error', 'loaded and never used: ' + idle.join(', '), 'this is bytes in the critical path buying nothing');
    }
    if (cost.scriptKb > BUDGETS.scriptKb) note('warn', cost.scriptKb + ' KB of script (budget ' + BUDGETS.scriptKb + ' KB)');
    if (cost.totalKb > BUDGETS.totalKb) note('warn', cost.totalKb + ' KB transferred over ' + cost.requests + ' requests');
    if (cost.longestTaskMs > BUDGETS.longestTaskMs) note('warn', 'longest main-thread task ' + cost.longestTaskMs + ' ms', 'the page cannot respond during it');
    if (cost.layoutShift > BUDGETS.layoutShift) {
      // What actually moved, named from the layout-shift sources rather than
      // guessed. Only ever a detail on the finding that already exists.
      const moved = (cost.shiftSources || []).filter((s) => s.node)
        .map((s) => s.node + (s.from && s.to ? ' moved ' + Math.round(Math.abs(s.to.y - s.from.y)) + 'px' : ''));
      note('warn', 'layout shift ' + cost.layoutShift + ' (budget ' + BUDGETS.layoutShift + ')',
        moved.length ? 'moved: ' + [...new Set(moved)].slice(0, 4).join(', ') : null);
    }
    if (!idle.length && cost.scriptKb <= BUDGETS.scriptKb && cost.layoutShift <= BUDGETS.layoutShift) {
      note('ok', cost.totalKb + ' KB over ' + cost.requests + ' requests, no idle libraries, no shift');
    }
  }

  if (!type.error) {
    if (type.distinctSizes > BUDGETS.distinctSizes) {
      note('warn', type.distinctSizes + ' distinct type sizes', 'a scale has a handful of steps: ' + (type.scale || []).join(', '));
    } else if (type.distinctSizes) {
      note('ok', type.distinctSizes + ' type sizes, largest ' + type.largestPx + 'px');
    }
    if (Number.isFinite(type.measureChars)) {
      const [low, high] = BUDGETS.measureChars;
      if (type.measureChars > high) note('warn', 'body measure is ' + type.measureChars + ' characters (over ' + high + ' is hard to track)');
      else if (type.measureChars < low) note('warn', 'body measure is only ' + type.measureChars + ' characters');
      else note('ok', 'body measure ' + type.measureChars + ' characters');
    }
    if (Number.isFinite(type.largestPx) && type.largestPx < 40) {
      note('warn', 'largest type on the page is ' + type.largestPx + 'px', 'the house style opens at display scale');
    }
    if (type.distinctTextColours > 6) note('warn', type.distinctTextColours + ' distinct text colours');
  }

  return findings;
}

export function formatQuality(measured, findings) {
  const lines = [];
  const errors = findings.filter((finding) => finding.level === 'error').length;
  const warns = findings.filter((finding) => finding.level === 'warn').length;
  for (const finding of findings) {
    const tag = finding.level === 'error' ? 'ERROR' : finding.level === 'warn' ? 'warn ' : finding.level === 'ok' ? 'ok   ' : 'note ';
    lines.push('  ' + tag + ' ' + finding.text + (finding.detail ? '\n           ' + finding.detail : ''));
  }
  return { lines: lines.join('\n'), errors, warns };
}
