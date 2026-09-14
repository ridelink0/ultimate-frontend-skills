/* ultimate-frontend-skills/parity - does the built page still look like the design?

   Neither half of the Claude Design pairing can answer this alone. Claude
   Design holds the intent and never sees the site running; this repo renders
   the site and has never been told what was intended. Parity is the join: the
   SAME browser session, the SAME probes, pointed first at the design and then
   at the implementation, so a difference in the numbers is a difference in the
   pages and not a difference in the instruments.

   Two things about a Claude Design canvas decide how this is written.

   1. A canvas puts every artboard in a sandboxed srcdoc iframe with no
      allow-same-origin, which Chrome runs out-of-process. From the top frame
      contentDocument is null, and a probe evaluated the ordinary way runs
      against the EDITOR CHROME - it comes back with no errors, no overlaps and
      four text elements, which reads as a clean measurement of a page that was
      never looked at. Every probe here is therefore addressed at a frame
      (an auto-attached target, or a subframe execution context) that was
      chosen deliberately and is named in the result.

   2. A bare .dc.html is not a renderable page. It expects a runtime the editor
      injects (support.js, DCLogic), leaves {{handlebars}} unresolved and
      resolves <img src> against base64 canvas state. Pointed at a browser it
      produces a degraded skeleton that measures as a real design. This module
      refuses one rather than measuring it.

   Tolerances are deliberately loose and the wording is deliberately concrete.
   A design is not a pixel specification, and a false "does not match" on a
   good implementation is the worst outcome available here: it would send an
   agent off to damage a page that was right. */

import { existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { once } from 'node:events';
import { Session, launch, findBrowser, PROBE } from './inspect.mjs';
import { TYPE, COLOUR_JS } from './measure.mjs';
import { startServer } from './preview-server.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------ what a reference is -- */

// The seeded-canvas marker, taken from the design skill's own seed-canvas.mjs
// (readState/DOC_RE): the published page carries its whole state as one JSON
// script block. Recognising it is what tells us to go looking for artboard
// frames instead of measuring the page we were handed.
const CANVAS_STATE_RE = /<script type="application\/json" id="appifact-doc"[^>]*>\n([\s\S]*?)\n<\/script>/;

// A .dc.html declares its runtime dependency in the head and its root element
// in the body. Both are present in every artboard the skill's own spec shows.
const DC_MARKER_RE = /<script[^>]+src=["']\.\/support\.js["']|<x-dc[\s>]/i;

export function classifyReference(file) {
  const text = readFileSync(file, 'utf8');
  const state = text.match(CANVAS_STATE_RE);
  if (state) {
    let parsed = null;
    try { parsed = JSON.parse(state[1]); } catch { parsed = null; }
    const files = parsed && parsed.files && typeof parsed.files === 'object' ? Object.keys(parsed.files) : [];
    return {
      kind: 'canvas',
      title: parsed && typeof parsed.title === 'string' ? parsed.title : null,
      artboards: files.filter((n) => n.endsWith('.dc.html')),
    };
  }
  if (DC_MARKER_RE.test(text)) return { kind: 'artboard-source' };
  return { kind: 'page' };
}

/* ------------------------------------------------------------ the probes ---- */

/* Everything the existing probes do not already report, and nothing they do.
   PROBE (inspect.mjs) gives the text-element count used to pick the artboard
   frame; TYPE (measure.mjs) gives the type scale, the families and the text
   colours. This one adds the three remaining comparables: the painted palette
   weighted by the area it actually covers, the vertical spacing rhythm, and
   the geometry of the content band and the leading headline. */
export const PARITY = `(() => {
  const vw = innerWidth, vh = innerHeight;

  // getComputedStyle hands back oklch() and color-mix() verbatim, so reading
  // the numbers out of the string turns a modern palette into nonsense.
  // Painting the colour and reading the pixel is the one conversion that works
  // for every CSS Color 4 value. It lives in measure.mjs so that the TYPE
  // probe's text colours go through the SAME conversion these backgrounds do -
  // when only one of the two was converted, an oklch page could not match its
  // own oklch design.
  ${COLOUR_JS}
  // A ground is painted area: a nearly transparent overlay is not one.
  const rgb = (str) => toRgb(str, 128);

  const visible = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    if (!el.offsetParent && cs.position !== 'fixed' && el !== document.body) return false;
    return true;
  };

  const ground = new Map();
  const rects = [];
  let painted = 0;
  for (const el of document.querySelectorAll('body, body *')) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const cs = getComputedStyle(el);
    // A background with an image over it is not a flat colour any more, and
    // counting the colour underneath as part of the palette would compare a
    // hero photograph against whatever sat behind it.
    if (cs.backgroundImage === 'none') {
      const c = rgb(cs.backgroundColor);
      if (c) {
        const area = Math.min(r.width, vw) * Math.min(r.height, vh * 4);
        ground.set(c, (ground.get(c) || 0) + area);
        painted += area;
      }
    }
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
    if (own) rects.push({ tag: el.tagName.toLowerCase(), left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width });
  }

  // VERTICAL RHYTHM. The gap between consecutive laid-out siblings, bucketed
  // to 2px. Read from siblings rather than from every pair of boxes on the
  // page because that is what a spacing scale actually controls, and because
  // arbitrary pairs produce a cloud of numbers that means nothing.
  const gaps = new Map();
  for (const parent of document.querySelectorAll('body, body *')) {
    const kids = [...parent.children].filter((k) => {
      if (!visible(k)) return false;
      const cs = getComputedStyle(k);
      if (cs.position === 'absolute' || cs.position === 'fixed') return false;
      const r = k.getBoundingClientRect();
      return r.height > 2 && r.width > 2;
    });
    if (kids.length < 2) continue;
    const boxes = kids.map((k) => k.getBoundingClientRect()).sort((a, b) => a.top - b.top);
    for (let i = 1; i < boxes.length; i++) {
      // Side-by-side children (a grid row, a nav) have no vertical gap to read.
      if (boxes[i].top < boxes[i - 1].bottom - 1) continue;
      const gap = Math.round((boxes[i].top - boxes[i - 1].bottom) / 2) * 2;
      if (gap < 2 || gap > 400) continue;
      gaps.set(gap, (gaps.get(gap) || 0) + 1);
    }
  }

  // GEOMETRY, as fractions of the viewport, so an artboard authored at one
  // width and a page rendered at another are still comparable.
  const median = (list) => {
    if (!list.length) return null;
    const s = [...list].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };
  const body = rects.filter((r) => r.width > vw * 0.12);
  const heading = document.querySelector('h1, h2, [role=heading]');
  let head = null;
  if (heading && visible(heading)) {
    const r = heading.getBoundingClientRect();
    if (r.width > 2) head = { x: r.left / vw, w: r.width / vw, tag: heading.tagName.toLowerCase() };
  }

  return JSON.stringify({
    viewport: { w: vw, h: vh },
    ground: [...ground.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
      .map(([colour, area]) => [colour, painted ? Math.round((area / painted) * 1000) / 1000 : 0]),
    rhythm: [...gaps.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10),
    band: body.length
      ? { left: median(body.map((r) => r.left)) / vw, right: median(body.map((r) => r.right)) / vw, n: body.length }
      : null,
    heading: head,
  });
})()`;

/* --------------------------------------------------------- frame plumbing --- */

async function evaluateIn(session, expression, frame) {
  const params = { expression, returnByValue: true };
  if (frame.contextId) params.contextId = frame.contextId;
  const result = await session.send('Runtime.evaluate', params, frame.sessionId || null);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'probe failed');
  const value = result.result && result.result.value;
  if (typeof value !== 'string') throw new Error('probe returned no report');
  return JSON.parse(value);
}

/* Both ways a subframe can show up, because only one of them is guaranteed.
   A sandboxed srcdoc frame is usually out-of-process, which makes it an
   auto-attached TARGET with its own sessionId and no execution context
   visible from here; the same frame run in-process is the exact opposite -
   an execution context in this session and no target at all. Chrome has
   moved frames between those two states before, so both are collected and
   the one with content wins. */
function candidateFrames(session, mainFrameId) {
  const frames = [{ label: 'document' }];
  for (const event of session.events) {
    if (event.method === 'Target.attachedToTarget' && event.params?.targetInfo?.type === 'iframe') {
      frames.push({ label: 'frame ' + (event.params.targetInfo.url || 'about:srcdoc'), sessionId: event.params.sessionId, oop: true });
    }
    if (event.method === 'Runtime.executionContextCreated') {
      const ctx = event.params?.context;
      const aux = ctx?.auxData || {};
      if (aux.isDefault && aux.frameId && aux.frameId !== mainFrameId) {
        frames.push({ label: 'frame ' + (ctx.origin || 'about:srcdoc'), contextId: ctx.id });
      }
    }
  }
  return frames;
}

/* --------------------------------------------------------------- profiling -- */

/* One profile, from one frame, using the shared probes. This is the function
   both sides go through; there is no second implementation of "measure a
   design" anywhere. */
async function profileFrame(session, frame) {
  const shape = await evaluateIn(session, PROBE, frame);
  const type = await evaluateIn(session, TYPE, frame);
  const parity = await evaluateIn(session, PARITY, frame);
  return {
    frame: frame.label,
    textElements: shape.stats?.textElements || 0,
    type, ...parity,
  };
}

async function profilePage(session, url, { width, height, wait, preferSubframe }) {
  // Auto-attach has to be armed BEFORE the navigation that creates the frame,
  // or the artboard target is never announced and the top frame silently
  // becomes the thing measured.
  await session.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }).catch(() => {});
  await session.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 700 });
  session.events.length = 0;
  const navigation = await session.send('Page.navigate', { url });
  if (navigation.errorText) throw new Error('Navigation failed: ' + navigation.errorText);
  await session.waitForEvent('Page.loadEventFired');
  await session.send('Runtime.evaluate', { expression: 'document.fonts ? document.fonts.ready.then(()=>1) : 1', awaitPromise: true }).catch(() => {});
  // The canvas editor mounts asynchronously and its own documentation says a
  // blank first capture means it is still coming up. A short wait here does
  // not error - it measures an empty artboard and calls it clean.
  await sleep(wait);

  const tree = await session.send('Page.getFrameTree').catch(() => null);
  const mainFrameId = tree?.frameTree?.frame?.id || null;
  const frames = candidateFrames(session, mainFrameId);
  const profiles = [];
  for (const frame of frames) {
    if (frame.sessionId) await session.send('Runtime.enable', {}, frame.sessionId).catch(() => {});
    try { profiles.push(await profileFrame(session, frame)); } catch { /* a frame that cannot be probed is not a frame worth reporting */ }
  }
  if (!profiles.length) throw new Error('no frame could be probed at ' + url);
  const top = profiles[0];
  if (!preferSubframe) return { ...top, candidates: profiles.length };
  // The artboard is the frame with the design in it. The editor chrome around
  // it is a handful of toolbar labels, so "most text" separates them cleanly -
  // and when nothing beats the top frame we say so rather than inventing one.
  const best = profiles.reduce((a, b) => (b.textElements > a.textElements ? b : a), top);
  return { ...best, candidates: profiles.length };
}

/* --------------------------------------------------------------- rendering -- */

// A reference or a target may be a file, a directory or a URL. Directories get
// the same local preview server the rest of the tool uses; files are opened
// over file:// unless they sit in a directory we are already serving.
function targetUrl(what, servers) {
  if (/^https?:\/\//i.test(what)) return { url: what };
  const path = resolve(what);
  if (!existsSync(path)) throw new Error('no such path: ' + path);
  if (statSync(path).isDirectory()) {
    const server = startServer(path, 0);
    servers.push(server);
    return { url: null, server, index: 'index.html' };
  }
  return { url: pathToFileURL(path).href };
}

async function resolveUrl(entry) {
  if (entry.url) return entry.url;
  await once(entry.server, 'listening');
  return 'http://127.0.0.1:' + entry.server.address().port + '/';
}

/* --------------------------------------------------------- the comparison -- */

export const TOLERANCE = {
  // A design's 32px landing as 31px on a page is a rounding and font-fallback
  // difference, not a decision anyone made.
  sizePx: 2,
  // Straight RGB distance. rgb(180,83,9) against rgb(200,100,20) is 28 and
  // passes; a different hue is hundreds and does not.
  colour: 40,
  // A size or colour that appears once on a large page is a stray inline
  // style, not part of a type scale. On the design side everything counts:
  // an artboard has few elements and a headline used once IS the design.
  // The one exemption is the display line, which is single-use by definition
  // and is added back on both sides - see sizesOf/inkOf.
  implMinUses: 2,
  // A background has to cover this much of what the page paints to count as a
  // ground at all, and this much to be a warning rather than a note: severity
  // follows area, because one colour under the whole page is not one detail.
  groundShare: 0.03,
  groundWarnShare: 0.5,
  // Fractional drift in the size of the largest text before it is a warning.
  // 48px to 44px is a font fallback; 48px to 28px is a different design.
  displayDrift: 0.15,
  // Fractions of the viewport. A content column within eight points of the
  // design's is the same column.
  band: 0.08,
  heading: 0.12,
  // A spacing scale is a ratio, not a number: 24 against 28 is the same
  // rhythm read through a different font metric, 24 against 64 is not.
  rhythm: 0.4,
};

/* The probes normalise every colour to sRGB before it gets here, so a plain
   rgb() parse is enough. A value that still does not parse is NOT treated as
   "different" - it is treated as unreadable and left out of the verdict, which
   is the difference between reporting an observation and inventing a finding.
   Identical strings short-circuit so that an unreadable value can still match
   itself. */
export const parseRgb = (s) => {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(s || '');
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
};
const colourDistance = (a, b) => {
  if (a && a === b) return 0;
  const x = parseRgb(a), y = parseRgb(b);
  if (!x || !y) return Infinity;
  return Math.sqrt((x[0] - y[0]) ** 2 + (x[1] - y[1]) ** 2 + (x[2] - y[2]) ** 2);
};
const nearestColour = (colour, list) => list.some((other) => colourDistance(colour, other) <= TOLERANCE.colour);
const nearestSize = (size, list) => list.some((other) => Math.abs(size - other) <= TOLERANCE.sizePx);

const displayOf = (profile) => (profile.type && profile.type.display) || null;

/* The stray filter drops a size or colour used once on a big page - but the
   display line is used once BY DEFINITION, and it is the element a design is
   most about. Filtering the headline out of a design-parity check inverts what
   the check is for, so it is added back explicitly on both sides. */
const sizesOf = (profile, minUses) => {
  const kept = (profile.type?.sizeCounts || []).filter(([, count]) => count >= minUses).map(([px]) => px);
  const display = displayOf(profile);
  if (display && typeof display.px === 'number' && !kept.includes(display.px)) kept.push(display.px);
  return kept;
};
const inkOf = (profile, minUses) => {
  const kept = (profile.type?.textColours || []).filter(([, count]) => count >= minUses).map(([colour]) => colour);
  const display = displayOf(profile);
  if (display && display.colour && !kept.includes(display.colour)) kept.push(display.colour);
  return kept;
};
// Backgrounds keep the share of painted area they cover, because severity has
// to know the difference between an inverted page and a tint band.
const groundOf = (profile) => (profile.ground || []).filter(([, share]) => share >= TOLERANCE.groundShare);
const dominantGap = (profile) => (profile.rhythm || []).length ? profile.rhythm[0][0] : null;

const list = (values, limit = 6) => {
  const shown = values.slice(0, limit);
  return shown.join(', ') + (values.length > shown.length ? ` and ${values.length - shown.length} more` : '');
};

/* The findings, in the shape verify.mjs already folds into one verdict.
   Severity is deliberately conservative: one stray size is a note and a handful
   is a warning, but it is not only a tally - an off-palette ground is weighted
   by the area it covers, and the display line gets its own finding because it
   is one element and counting it as one of many buried the loudest change a
   page can make. Only a page whose type scale AND palette are both mostly
   absent from a reference thick enough to judge against is an error - because
   that is not drift, that is a supplied design thrown away and rebuilt.

   Anything that cannot be measured is said, not guessed. A colour that will not
   parse is reported as unread and left out of the verdict; a design too thin to
   compare against is reported as too thin. An observation with no verdict is
   worth something; a verdict with no basis is worth less than nothing, because
   it sends an agent off to rewrite a page that was right. */
export function compareProfiles(design, impl) {
  const findings = [];
  const note = (severity, text) => findings.push({ severity, text });

  const designSizes = sizesOf(design, 1);
  const implSizes = sizesOf(impl, TOLERANCE.implMinUses);
  const offSizes = implSizes.filter((px) => !nearestSize(px, designSizes));
  // Measured against every size the page uses, not the filtered set: "the
  // design uses 64px and the page does not" has to mean genuinely absent. A
  // display size that legitimately appears once - which is what a display size
  // does - is not a missing size.
  const missingSizes = designSizes.filter((px) => !nearestSize(px, sizesOf(impl, 1)));
  if (offSizes.length) {
    note(offSizes.length >= 3 ? 'warning' : 'note',
      `${offSizes.length} type size${offSizes.length === 1 ? ' is' : 's are'} not in the design: ${list(offSizes.map((px) => px + 'px'))}`);
  }
  if (missingSizes.length) {
    note('note', `the design uses ${list(missingSizes.map((px) => px + 'px'))}; the page does not`);
  }

  const designInk = inkOf(design, 1);
  // A colour no conversion could read is reported as unread, never as wrong -
  // on either side. A design whose own colours are unreadable cannot absorb
  // the page's, and every colour on the page would come back "not in the
  // design"; that is a broken instrument, not a finding.
  const designInkReadable = designInk.filter((c) => parseRgb(c));
  const implInkAll = inkOf(impl, TOLERANCE.implMinUses);
  const implInk = implInkAll.filter((c) => parseRgb(c));
  const unreadableInk = implInkAll.filter((c) => !parseRgb(c) && !designInk.includes(c));
  const offInk = designInkReadable.length ? implInk.filter((c) => !nearestColour(c, designInk)) : [];
  if (!designInkReadable.length && implInk.length) {
    note('note', 'the text colours in the design could not be read as colours, so the palette was not compared');
  }
  if (offInk.length) {
    note(offInk.length >= 2 ? 'warning' : 'note',
      `${offInk.length} text colour${offInk.length === 1 ? ' is' : 's are'} not in the design: ${list(offInk)}`);
  }
  if (unreadableInk.length) {
    note('note', `${unreadableInk.length} text colour${unreadableInk.length === 1 ? '' : 's'} could not be read as a colour and ${unreadableInk.length === 1 ? 'was' : 'were'} not compared: ${list(unreadableInk)}`);
  }

  const designGround = groundOf(design);
  const designGroundColours = designGround.map(([colour]) => colour);
  const implGround = groundOf(impl);
  const offGround = implGround.filter(([colour]) => !nearestColour(colour, designGroundColours));
  if (offGround.length) {
    // Severity follows the AREA, not the count. One ground colour covering the
    // whole page is an inverted page; two tint bands covering four points each
    // are a detail. Counting them the same way filed the first as a note.
    const share = offGround.reduce((sum, [, s]) => sum + (s || 0), 0);
    note(share >= TOLERANCE.groundWarnShare || offGround.length >= 2 ? 'warning' : 'note',
      `${offGround.length} background colour${offGround.length === 1 ? ' is' : 's are'} not in the design: ${list(offGround.map(([colour]) => colour))}`
      + ` (covering ${Math.round(share * 100)}% of what the page paints)`);
  }

  /* The display line, called out on its own. Both the size and the colour of
     the largest text can drift while every count-based finding above stays a
     note, because a headline is one element - and a headline that changed size
     and hue is the most visible way a design can be lost. */
  const designDisplay = displayOf(design), implDisplay = displayOf(impl);
  if (designDisplay && implDisplay) {
    if (typeof designDisplay.px === 'number' && typeof implDisplay.px === 'number'
      && !nearestSize(implDisplay.px, [designDisplay.px])) {
      const drift = Math.abs(implDisplay.px - designDisplay.px) / designDisplay.px;
      note(drift > TOLERANCE.displayDrift ? 'warning' : 'note',
        `the largest type on the page is ${implDisplay.px}px; the design's is ${designDisplay.px}px`);
    }
    if (designDisplay.colour && implDisplay.colour && parseRgb(designDisplay.colour) && parseRgb(implDisplay.colour)
      && !nearestColour(implDisplay.colour, [designDisplay.colour])) {
      note('warning', `the largest type on the page is ${implDisplay.colour}; the design's is ${designDisplay.colour}`);
    }
  }

  const designFamilies = design.type?.families || [];
  const implFamilies = impl.type?.families || [];
  const offFamilies = implFamilies.filter((f) => !designFamilies.includes(f));
  if (offFamilies.length && designFamilies.length) {
    // A family difference is reported and never escalated: a canvas artboard
    // can only load fonts.googleapis.com faces, so a self-hosted or Adobe
    // face resolves to something else inside it for reasons that have nothing
    // to do with the implementation being wrong.
    note('note', `typeface${offFamilies.length === 1 ? '' : 's'} on the page not seen in the design: ${list(offFamilies)} (the design renders ${list(designFamilies)})`);
  }

  const designGap = dominantGap(design), implGap = dominantGap(impl);
  if (designGap && implGap) {
    const drift = Math.abs(implGap - designGap) / designGap;
    if (drift > TOLERANCE.rhythm) {
      note('note', `vertical rhythm: the design steps in ${designGap}px, the page in ${implGap}px`);
    }
  }

  // Geometry is only comparable when the two viewports are close enough that
  // the same layout would be chosen. Different widths are a different
  // breakpoint, and comparing across one measures the media query, not the
  // implementation - so it is skipped and said out loud.
  const dw = design.viewport?.w, iw = impl.viewport?.w;
  const comparableWidth = dw && iw && Math.abs(dw - iw) / dw <= 0.25;
  if (!comparableWidth && dw && iw) {
    note('note', `geometry not compared: the design renders at ${dw}px and the page at ${iw}px`);
  } else if (design.band && impl.band) {
    if (Math.abs(design.band.left - impl.band.left) > TOLERANCE.band || Math.abs(design.band.right - impl.band.right) > TOLERANCE.band) {
      const pct = (v) => Math.round(v * 100) + '%';
      note('warning', `the content column sits at ${pct(impl.band.left)}-${pct(impl.band.right)} of the width; the design puts it at ${pct(design.band.left)}-${pct(design.band.right)}`);
    }
    if (design.heading && impl.heading && Math.abs(design.heading.w - impl.heading.w) > TOLERANCE.heading) {
      const pct = (v) => Math.round(v * 100) + '%';
      note('note', `the leading headline spans ${pct(impl.heading.w)} of the width; the design gives it ${pct(design.heading.w)}`);
    }
  }

  // The rule both command files already state - a supplied design is preserved,
  // not rebuilt in the house style - made measurable. Overwriting a design
  // does not produce a subtle delta; it replaces the type scale and the palette
  // at the same time, and that is the only combination escalated to an error.
  const sizeMiss = implSizes.length ? offSizes.length / implSizes.length : 0;
  const inkMiss = implInk.length ? offInk.length / implInk.length : 0;
  const mostlyAbsent = implSizes.length >= 3 && implInk.length >= 2 && sizeMiss > 0.6 && inkMiss > 0.6;
  // The design side has to be substantial enough for "absent from it" to mean
  // anything. A hero-only artboard has two sizes and one colour; a whole page
  // measured against it will always look mostly absent, and calling that a
  // rebuilt design is the false ERROR this check can least afford - it would
  // send an agent to rewrite a page that was right.
  const designComparable = designSizes.length >= 3 && designInkReadable.length >= 2;
  const wholesale = mostlyAbsent && designComparable;
  if (wholesale) {
    findings.unshift({
      severity: 'error',
      text: `this page does not implement the supplied design: ${offSizes.length} of ${implSizes.length} type sizes and ${offInk.length} of ${implInk.length} text colours are absent from it. A supplied design is preserved, not rebuilt in the house style.`,
    });
  } else if (mostlyAbsent) {
    note('warning', `most of this page's type scale and palette are absent from the design, but the design itself only offers ${designSizes.length} type size${designSizes.length === 1 ? '' : 's'} and ${designInkReadable.length} readable text colour${designInkReadable.length === 1 ? '' : 's'} to compare against - too thin a reference to call the page a rebuild. Compare against an artboard that covers this page.`);
  }
  return {
    findings,
    off: { sizes: offSizes, ink: offInk, ground: offGround.map(([colour]) => colour), missingSizes, unreadableInk },
    wholesale,
  };
}

/* -------------------------------------------------------------- the runner -- */

/* frame: 'auto' finds the artboard; 'document' deliberately measures the page
   it was handed. The second exists so the trap can be demonstrated rather than
   just described - on a canvas it returns the editor chrome, which is what a
   probe with no frame handling silently returns every time. */
export async function runParity(target, reference, { width = 1440, height = 900, wait = 2500, frame = 'auto' } = {}) {
  if (!findBrowser()) {
    const err = new Error('no Chrome, Edge or Chromium found; set ATELIER_BROWSER to the executable.');
    err.code = 'no-browser';
    throw err;
  }
  const referencePath = /^https?:\/\//i.test(reference) ? null : resolve(reference);
  let kind = { kind: 'page' };
  if (referencePath) {
    if (!existsSync(referencePath)) throw new Error('no such design reference: ' + referencePath);
    if (statSync(referencePath).isFile()) kind = classifyReference(referencePath);
  }
  if (kind.kind === 'artboard-source') {
    // Proven by rendering one: support.js and DCLogic are missing, {{holes}}
    // stay literal, <sc-for> repeats nothing and <img src> never resolves. The
    // browser shows a skeleton that measures like a design, which is worse
    // than refusing.
    throw new Error(
      'that is a bare .dc.html artboard, which is not a renderable page: it needs the canvas runtime the editor injects.\n' +
      '  Seed it into a canvas first (the built-in design skill\'s seed-canvas.mjs --artboard ...), then pass the seeded .html here.');
  }

  const servers = [];
  let browser = null, session = null;
  try {
    const designEntry = targetUrl(reference, servers);
    const implEntry = targetUrl(target, servers);
    const designUrl = await resolveUrl(designEntry);
    const implUrl = await resolveUrl(implEntry);

    // ONE browser and ONE session for both sides. Two launches would be two
    // font stacks, two device scale factors and two sets of defaults, and any
    // of those would show up as a delta the pages do not have.
    browser = await launch(findBrowser());
    session = await Session.open(browser.port);
    await session.send('Page.enable');
    await session.send('Runtime.enable');
    await session.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });

    const design = await profilePage(session, designUrl, { width, height, wait, preferSubframe: frame !== 'document' && kind.kind === 'canvas' });
    const impl = await profilePage(session, implUrl, { width, height, wait: Math.min(wait, 1800), preferSubframe: false });
    const compared = compareProfiles(design, impl);
    return {
      reference: reference, target,
      referenceKind: kind.kind,
      artboards: kind.artboards || null,
      design, impl,
      findings: compared.findings,
      off: compared.off,
      wholesale: compared.wholesale,
      errors: compared.findings.filter((f) => f.severity === 'error').length,
      warns: compared.findings.filter((f) => f.severity === 'warning').length,
    };
  } finally {
    if (session) session.close();
    if (browser) {
      try { browser.proc.kill(); } catch { /* already gone */ }
      setTimeout(() => { try { rmSync(browser.udd, { recursive: true, force: true }); } catch { /* Windows holds the profile briefly */ } }, 400);
    }
    for (const server of servers) await new Promise((done) => server.close(done));
  }
}

export function formatParity(result) {
  const lines = [];
  lines.push(`\nwebdesign parity  ${result.target}`);
  lines.push(`  design: ${result.reference}${result.referenceKind === 'canvas' ? ' (Claude Design canvas)' : ''}`);
  lines.push(`  read from ${result.design.frame} at ${result.design.viewport.w}px; page read at ${result.impl.viewport.w}px`);
  if (result.referenceKind === 'canvas' && result.design.frame === 'document') {
    // Saying this is not pedantry. If the artboard frame was never found, the
    // numbers below describe the editor around the design, and every one of
    // them is meaningless.
    lines.push('  warn  no artboard frame was found in that canvas - the numbers below are the editor page, not the design');
  }
  if (!result.findings.length) {
    lines.push('\n  ok    the page carries the design\'s type sizes, palette, rhythm and layout');
    return lines.join('\n');
  }
  for (const [severity, tag] of [['error', 'ERROR'], ['warning', 'warn '], ['note', 'note ']]) {
    for (const f of result.findings.filter((x) => x.severity === severity)) lines.push(`  ${tag} ${f.text}`);
  }
  return lines.join('\n');
}
