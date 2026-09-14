/* ultimate-frontend-skills/inspect - render a page in a real headless browser, screenshot it,
   and report what is actually wrong with the LAYOUT rather than the source.

   Static analysis cannot see an overlap. This can: it walks the rendered box
   tree and reports text colliding with text, content past the viewport,
   unreadable contrast, collapsed elements and broken images - the class of bug
   you only find by looking.

   Zero dependencies. Drives the browser over CDP using Node 18+'s built-in
   fetch and Node 22's built-in WebSocket. */

import { spawn } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { inflateSync } from 'node:zlib';
import { MEASURE_INIT, measure, judge, formatQuality } from './measure.mjs';

/* ------------------------------------------------------------- browser ---- */

const CANDIDATES = process.platform === 'win32'
  ? [
      `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env['PROGRAMFILES(X86)']}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env['PROGRAMFILES(X86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
      `${process.env.PROGRAMFILES}\\Microsoft\\Edge\\Application\\msedge.exe`,
    ]
  : process.platform === 'darwin'
    ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
       '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
       '/Applications/Chromium.app/Contents/MacOS/Chromium']
    : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
       '/usr/bin/microsoft-edge', '/snap/bin/chromium'];

export function findBrowser() {
  if (process.env.ATELIER_BROWSER && existsSync(process.env.ATELIER_BROWSER))
    return process.env.ATELIER_BROWSER;
  return CANDIDATES.find((p) => p && existsSync(p)) || null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Chrome creates DevToolsActivePort and only then writes the port into it, so
   between those two moments the file exists and is unreadable: on Windows the
   read throws EBUSY because Chrome still holds the handle, and on any platform
   it can come back empty or half-written. All three mean "not yet", not
   "failed" - reading it once and letting the error out is why a browser test
   would die at random whenever several ran at the same time, which is exactly
   what CI now does on every push. Returns the port, or null to keep waiting. */
export function readPortFile(path) {
  let first;
  try { first = readFileSync(path, 'utf8').split('\n')[0].trim(); } catch { return null; }
  const port = Number(first);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : null;
}

export async function launch(bin) {
  const udd = mkdtempSync(join(tmpdir(), 'webdesign-cdp-'));
  const proc = spawn(bin, [
    '--headless=new', '--hide-scrollbars', '--mute-audio',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--disable-background-networking', '--disable-sync', '--disable-features=Translate',
    `--user-data-dir=${udd}`, '--remote-debugging-port=0', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'ignore'], windowsHide: true });
  let launchError;
  proc.once('error', err => { launchError = err; });

  const portFile = join(udd, 'DevToolsActivePort');
  for (let i = 0; i < 150; i++) {
    if (launchError || proc.exitCode !== null) break;
    const port = readPortFile(portFile);
    if (port) return { proc, udd, port };
    await sleep(100);
  }
  try { proc.kill(); } catch {}
  try { rmSync(udd, { recursive: true, force: true }); } catch {}
  throw new Error(launchError ? 'Browser launch failed: ' + launchError.message : 'browser did not expose a debugging port');
}

/* ----------------------------------------------------------------- CDP ---- */

export class Session {
  constructor(ws) { this.ws = ws; this.id = 0; this.waiting = new Map(); this.events = []; }
  static async open(port) {
    let target;
    for (let i = 0; i < 60; i++) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
        if (target) break;
      } catch {}
      await sleep(100);
    }
    if (!target) throw new Error('no page target');
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', () => rej(new Error('cdp socket failed')), { once: true });
    });
    const s = new Session(ws);
    ws.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id && s.waiting.has(msg.id)) {
        const { res, rej, timer } = s.waiting.get(msg.id);
        clearTimeout(timer);
        s.waiting.delete(msg.id);
        msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
      } else if (msg.method) { s.events.push(msg); if (s.events.length > 4000) s.events.shift(); }
    });
    ws.addEventListener('close', () => s.failPending(new Error('CDP connection closed')));
    ws.addEventListener('error', () => s.failPending(new Error('CDP connection failed')));
    return s;
  }
  failPending(error) {
    for (const { rej, timer } of this.waiting.values()) { clearTimeout(timer); rej(error); }
    this.waiting.clear();
  }
  /* sessionId addresses a command at an auto-attached child target instead of
     the page. An out-of-process iframe - which is what a Claude Design canvas
     puts each artboard in - has no reachable document from the top frame
     (contentDocument is null, no allow-same-origin), so without this the only
     way to "measure the artboard" is to measure the editor chrome around it
     and get a clean, confident, entirely wrong answer. */
  send(method, params = {}, sessionId = null) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      const timer = setTimeout(() => {
        if (this.waiting.has(id)) { this.waiting.delete(id); rej(new Error(method + ' timed out')); }
      }, 45000);
      this.waiting.set(id, { res, rej, timer });
      const envelope = sessionId ? { id, method, params, sessionId } : { id, method, params };
      try { this.ws.send(JSON.stringify(envelope)); }
      catch (err) { clearTimeout(timer); this.waiting.delete(id); rej(err); }
    });
  }
  async waitForEvent(method, ms = 25000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const i = this.events.findIndex((e) => e.method === method);
      if (i !== -1) return this.events.splice(i, 1)[0];
      await sleep(50);
    }
    return null;
  }
  close() { this.failPending(new Error('CDP session closed')); try { this.ws.close(); } catch {} }
}

/* Installed before any document runs. Two jobs: keep WebGL drawing buffers
   readable so the blank-canvas check is measuring the render and not the
   compositor, and remember which context type each canvas took. */
const CANVAS_INIT = `(() => {
  const proto = HTMLCanvasElement.prototype;
  const original = proto.getContext;
  if (!original || proto.__inspectPatched) return;
  Object.defineProperty(proto, '__inspectPatched', { value: true });
  proto.getContext = function (type, attributes) {
    const isGL = typeof type === 'string' && /^(webgl2?|experimental-webgl)$/i.test(type);
    const context = original.call(this, type, isGL ? Object.assign({}, attributes, { preserveDrawingBuffer: true }) : attributes);
    if (context) { try { this.__inspectContext = String(type).toLowerCase(); } catch (err) {} }
    return context;
  };
})()`;

/* ------------------------------------------------- the in-page analysis ---- */
/* Runs inside the page. Everything it needs must be self-contained. */
export const PROBE = `(() => {
  const out = { overlaps: [], overflow: [], contrast: [], collapsed: [], broken: [],
                tiny: [], offscreen: [], imageCandidates: [], stats: {} };
  const vw = innerWidth, vh = innerHeight;

  const vis = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) return false;
    // [hidden], display:none on an ancestor, and the slot of a closed <details>
    // all leave a rect behind; offsetParent is how you tell they are not painted.
    if (!el.offsetParent && cs.position !== 'fixed' && el !== document.body) return false;
    if (el.closest('details:not([open])') && !el.closest('summary')) return false;
    if (el.closest('[hidden]')) return false;
    // Opacity and visibility are inherited visually but NOT in computed style:
    // a span inside an opacity:0 parent computes to opacity 1 and paints
    // nothing. Without walking up, every hidden label reads as an overlap.
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const acs = getComputedStyle(a);
      if (+acs.opacity === 0 || acs.visibility === 'hidden' || acs.display === 'none') return false;
    }
    return true;
  };
  const label = (el) => {
    const id = el.id ? '#' + el.id : '';
    const cls = (el.className && typeof el.className === 'string')
      ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : '';
    const txt = (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 34);
    return el.tagName.toLowerCase() + id + cls + (txt ? ' "' + txt + '"' : '');
  };
  // getComputedStyle hands back oklch() and color-mix() verbatim now, so naive
  // number-grabbing reads "oklch(0.5 0.018 75)" as rgb(0, 0, 75) and every
  // colour in a modern palette fails contrast. Let the canvas normalise any
  // CSS Color 4 value into something parseable.
  // Reading the string is not enough: a computed oklch() or color-mix() comes
  // back verbatim, and canvas fillStyle hands it straight back too. Painting
  // the colour and reading the pixel is the only conversion that always works,
  // for every CSS Color 4 value the browser can render.
  const _cv = document.createElement('canvas');
  _cv.width = _cv.height = 1;
  const _cx = _cv.getContext('2d', { willReadFrequently: true });
  const _memo = new Map();
  const parseRGB = (str) => {
    if (!str || str === 'transparent') return null;
    if (_memo.has(str)) return _memo.get(str);
    let out = null;
    try {
      _cx.clearRect(0, 0, 1, 1);
      _cx.fillStyle = '#000';
      _cx.fillStyle = str;
      _cx.fillRect(0, 0, 1, 1);
      const d = _cx.getImageData(0, 0, 1, 1).data;
      out = { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
    } catch { out = null; }
    _memo.set(str, out);
    return out;
  };
  const lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const ratio = (a, b) => {
    const l1 = lum(a), l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  // Returns the solid colour actually behind the element, or null when we
  // genuinely cannot tell - a background image, or a positioned sibling layer
  // painting underneath (a hero photo, a gradient plate). Guessing there
  // produces a page full of false 1:1 failures, which is worse than silence.
  const bgOf = (el) => {
    let n = el;
    while (n && n !== document.documentElement) {
      const cs = getComputedStyle(n);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return null;
      for (const sib of n.children) {
        if (sib === el || sib.contains(el)) continue;
        const scs = getComputedStyle(sib);
        if (scs.position === 'absolute' || scs.position === 'fixed') return null;
      }
      const c = parseRGB(cs.backgroundColor);
      if (c && c.a > 0.85) return c;
      n = n.parentElement;
    }
    const c = parseRGB(getComputedStyle(document.body).backgroundColor);
    return c && c.a > 0.85 ? c : null;
  };

  // The union of the line boxes an element's OWN text nodes occupy, in
  // viewport coordinates. A Range is the only way to ask the browser where the
  // glyphs went; the element box includes padding and whatever whitespace the
  // line-breaking left over, and both of those are ground the reader never
  // has to read text against.
  const _range = document.createRange();
  const textRect = (el) => {
    let l = Infinity, t = Infinity, rr = -Infinity, b = -Infinity;
    for (const n of el.childNodes) {
      if (n.nodeType !== 3 || !n.textContent.trim()) continue;
      _range.selectNodeContents(n);
      for (const box of _range.getClientRects()) {
        if (box.width < 1 || box.height < 1) continue;
        l = Math.min(l, box.left); t = Math.min(t, box.top);
        rr = Math.max(rr, box.right); b = Math.max(b, box.bottom);
      }
    }
    return l < rr && t < b ? { left: l, top: t, width: rr - l, height: b - t } : null;
  };

  // Elements whose own text is painted (not just inherited from a child).
  const textEls = [];
  for (const el of document.querySelectorAll('body *')) {
    if (!vis(el)) continue;
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
    if (!own) continue;
    // A fixed or sticky header sits over whatever scrolls under it by design.
    // That is not the overlap this check exists to find.
    let pinned = false;
    for (let a = el; a && a !== document.body; a = a.parentElement) {
      const pos = getComputedStyle(a).position;
      if (pos === 'fixed' || pos === 'sticky') { pinned = true; break; }
    }
    if (pinned) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    textEls.push({ el, r, cs: getComputedStyle(el) });
  }
  out.stats.textElements = textEls.length;

  const related = (a, b) => a.contains(b) || b.contains(a);
  const area = (r) => r.width * r.height;

  // TEXT OVER TEXT. Two painted text boxes intersecting, neither containing the
  // other, is almost always a bug - and it is the one class static analysis and
  // a source read can never see.
  for (let i = 0; i < textEls.length; i++) {
    for (let j = i + 1; j < textEls.length; j++) {
      const A = textEls[i], B = textEls[j];
      if (related(A.el, B.el)) continue;
      const x = Math.max(0, Math.min(A.r.right, B.r.right) - Math.max(A.r.left, B.r.left));
      const y = Math.max(0, Math.min(A.r.bottom, B.r.bottom) - Math.max(A.r.top, B.r.top));
      const ov = x * y;
      if (ov < 240) continue;
      const frac = ov / Math.min(area(A.r), area(B.r));
      if (frac < 0.12) continue;
      out.overlaps.push({
        a: label(A.el), b: label(B.el),
        pct: Math.round(frac * 100),
        px: Math.round(ov),
        at: Math.round(A.r.top + scrollY),
      });
    }
  }
  out.overlaps.sort((p, q) => q.pct - p.pct);
  out.overlaps = out.overlaps.slice(0, 12);

  // Anything wider than the viewport, and the page itself scrolling sideways.
  if (document.documentElement.scrollWidth > vw + 1)
    out.overflow.push({ what: 'document', by: document.documentElement.scrollWidth - vw });
  for (const el of document.querySelectorAll('body *')) {
    if (!vis(el)) continue;
    // An element only overflows the page if nothing between it and the root
    // clips it. An svg clips its own geometry; so does any overflow:hidden or
    // clip ancestor. Reporting the raw box there is a false alarm.
    const svg = el.ownerSVGElement;
    if (svg && getComputedStyle(svg).overflow !== 'visible') continue;
    let clipped = false;
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const o = getComputedStyle(a).overflowX;
      if (o === 'hidden' || o === 'clip' || o === 'auto' || o === 'scroll') { clipped = true; break; }
    }
    if (clipped) continue;
    const r = el.getBoundingClientRect();
    if (r.width > vw + 2 && getComputedStyle(el).position !== 'fixed')
      out.offscreen.push({ el: label(el), width: Math.round(r.width), vw });
    if (r.right > vw + 2 && r.left >= 0 && r.width < vw)
      out.overflow.push({ what: label(el), by: Math.round(r.right - vw) });
  }
  out.offscreen = out.offscreen.slice(0, 8);
  out.overflow = out.overflow.slice(0, 8);

  // Contrast. Where the background resolves to a solid colour we can check it
  // here, in the page, cheaply. Where it does not - a background image, or a
  // positioned layer painting underneath - bgOf() correctly refuses to guess,
  // but the house style puts display type on photographs behind scrims, so
  // that "cannot tell" case is exactly where the worst legibility failures
  // live. Hand those to Node as candidates: it already has the screenshot, so
  // it can sample the pixels actually behind the box instead of guessing.
  for (const { el, cs, r } of textEls) {
    const fg = parseRGB(cs.color);
    if (!fg || fg.a < 0.9) continue;
    const size = parseFloat(cs.fontSize);
    const bold = +cs.fontWeight >= 700;
    const large = size >= 24 || (size >= 18.66 && bold);
    const need = large ? 3 : 4.5;
    const bg = bgOf(el);
    if (bg) {
      const cr = ratio(fg, bg);
      if (cr < need)
        out.contrast.push({ el: label(el), ratio: +cr.toFixed(2), need, size: Math.round(size), method: 'solid' });
      continue;
    }
    // Only a box at least partly on screen is worth a pixel sample, and only
    // one of a sane size - a full-bleed section "is text" by the own-text-node
    // test above but sampling its whole rect is not a legibility check of
    // anything in particular.
    if (r.right <= 0 || r.bottom <= 0 || r.left >= vw || r.top >= vh) continue;
    if (r.width < 2 || r.height < 2 || r.width * r.height > 400000) continue;
    // The ELEMENT box is not the text box: a block <h1> in a flex row is as
    // wide as the row, and sampling the empty two thirds measures a ground the
    // words never sit on. Ranging over the element's own text nodes gives the
    // line boxes the glyphs actually occupy, which is what legibility is
    // about. Falls back to the element box if the range yields nothing.
    const tr = textRect(el) || r;
    const left = Math.max(0, tr.left), top = Math.max(0, tr.top);
    const width = Math.min(vw, tr.left + tr.width) - left;
    const height = Math.min(vh, tr.top + tr.height) - top;
    if (width < 2 || height < 2) continue;
    out.imageCandidates.push({
      el: label(el), fg, need, size: Math.round(size),
      rect: { left, top, width, height },
    });
  }
  out.contrast.sort((a, b) => a.ratio - b.ratio);
  out.contrast = out.contrast.slice(0, 10);
  out.imageCandidates = out.imageCandidates.slice(0, 20);

  // Content that is present but has collapsed to nothing.
  for (const el of document.querySelectorAll('body *')) {
    if (!vis(el)) continue;
    const r = el.getBoundingClientRect();
    if ((el.textContent || '').trim().length > 8 && (r.height < 1 || r.width < 1))
      out.collapsed.push(label(el));
  }
  out.collapsed = out.collapsed.slice(0, 8);

  // Images that did not load, and tap targets under 24px.
  for (const img of document.images) {
    if (img.complete && img.naturalWidth > 0) continue;
    // A lazy image still below the viewport has not failed; it has not been
    // asked for yet. Only an image the browser should have fetched counts.
    const r = img.getBoundingClientRect();
    if (img.loading === 'lazy' && r.top > vh * 1.5) continue;
    out.broken.push(img.getAttribute('src') || '(no src)');
  }
  for (const el of document.querySelectorAll('a, button, input, select, textarea, [role=button]')) {
    if (!vis(el)) continue;
    // WCAG 2.5.8 exempts targets in a sentence or block of text. An inline link
    // in a paragraph is not a 24px failure.
    if (getComputedStyle(el).display === 'inline' && el.closest('p, li, .prose')) continue;
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && (r.width < 24 || r.height < 24))
      out.tiny.push({ el: label(el), w: Math.round(r.width), h: Math.round(r.height) });
  }
  out.tiny = out.tiny.slice(0, 8);

  out.stats.scrollHeight = document.documentElement.scrollHeight;
  out.stats.viewport = vw + 'x' + vh;
  return JSON.stringify(out);
})()`;

/* ------------------------------------------------ image-backed contrast --- */
/* A minimal PNG decoder. Chrome's Page.captureScreenshot always emits 8-bit,
   non-interlaced PNG (colour type 2 or 6), so that is the only shape handled;
   anything else - a palette, 16-bit depth, interlacing - returns null and the
   candidate is silently skipped rather than sampled wrong. zlib is a Node
   builtin, so this stays a zero-dependency file the way the rest of the tool
   is; only the chunk framing and filter reversal are hand-rolled. */
export function decodePNG(buf) {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  let pos = 8, width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9]; interlace = data[12];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (!width || !height || bitDepth !== 8 || interlace !== 0) return null;
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : null;
  if (!channels) return null; // grayscale / palette / alpha-gray: not what a screenshot produces
  let raw;
  try { raw = inflateSync(Buffer.concat(idat)); } catch { return null; }
  const stride = width * channels;
  const out = Buffer.alloc(stride * height);
  const paeth = (a, b, c) => {
    const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  let src = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[src++];
    const rowStart = y * stride, prevStart = (y - 1) * stride;
    for (let x = 0; x < stride; x++) {
      const val = raw[src++];
      const a = x >= channels ? out[rowStart + x - channels] : 0;
      const b = y > 0 ? out[prevStart + x] : 0;
      const c = y > 0 && x >= channels ? out[prevStart + x - channels] : 0;
      let v;
      if (filter === 0) v = val;
      else if (filter === 1) v = val + a;
      else if (filter === 2) v = val + b;
      else if (filter === 3) v = val + ((a + b) >> 1);
      else if (filter === 4) v = val + paeth(a, b, c);
      else return null; // unrecognised filter byte - corrupt or unsupported stream
      out[rowStart + x] = v & 0xff;
    }
  }
  return {
    width, height,
    at(x, y) {
      x = Math.min(width - 1, Math.max(0, x)); y = Math.min(height - 1, Math.max(0, y));
      const i = y * stride + x * channels;
      return { r: out[i], g: out[i + 1], b: out[i + 2] };
    },
  };
}

const relLum = (c) => {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
};
const contrastRatio = (a, b) => {
  const l1 = relLum(a), l2 = relLum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};

// A text box contains the glyphs as well as the ground behind them, so the
// plain mean of the patch is the mean of "ground plus ink" and its spread is
// dominated by the ink: white display type on a dark photograph reads as a
// wildly mixed patch and gets thrown away, which is exactly the case this
// exists for. Ink is always a minority of a line box and always at one end of
// the luminance order, so discarding the brightest and darkest quarter leaves
// the ground - which is the thing whose contrast against the text colour we
// actually want.
const TRIM = 0.25;
// Spread across the remaining ground, on a 0-1 luminance scale. Above this the
// patch is not one surface - a hard edge in the photo runs through the words -
// and any single "the background is X" answer would be a guess dressed as
// data, so the candidate is dropped and nothing is reported.
const MIXED_SD = 0.16;

const meanColor = (list) => ({
  r: Math.round(list.reduce((a, p) => a + p.r, 0) / list.length),
  g: Math.round(list.reduce((a, p) => a + p.g, 0) / list.length),
  b: Math.round(list.reduce((a, p) => a + p.b, 0) / list.length),
});

export function sampleImageContrast(png, candidates) {
  const found = [];
  for (const cand of candidates) {
    const { left, top, width, height } = cand.rect;
    if (width < 2 || height < 2) continue;
    // Dense enough that a quarter can be trimmed off each end and still leave
    // a meaningful sample of the ground, capped so a full-width headline does
    // not turn into thousands of reads.
    const cols = Math.min(24, Math.max(4, Math.round(width / 4)));
    const rows = Math.min(24, Math.max(4, Math.round(height / 4)));
    const samples = [];
    for (let iy = 0; iy < rows; iy++) {
      for (let ix = 0; ix < cols; ix++) {
        const x = Math.round(left + ((ix + 0.5) / cols) * width);
        const y = Math.round(top + ((iy + 0.5) / rows) * height);
        samples.push(png.at(x, y));
      }
    }
    if (samples.length < 16) continue;
    const lums = samples.map(relLum);
    const cut = Math.floor(samples.length * TRIM);
    const core = samples.map((p, i) => i).sort((i, j) => lums[i] - lums[j]).slice(cut, samples.length - cut);
    if (core.length < 4) continue;
    const coreLums = core.map((i) => lums[i]);
    const mean = coreLums.reduce((a, v) => a + v, 0) / coreLums.length;
    const variance = coreLums.reduce((a, v) => a + (v - mean) ** 2, 0) / coreLums.length;
    if (Math.sqrt(variance) > MIXED_SD) continue;
    const ground = core.map((i) => samples[i]);
    const avgRatio = contrastRatio(cand.fg, meanColor(ground));
    // The worst tenth of the ground, not the DARKEST tenth: white type on a
    // scrim fails where the scrim is thinnest and dark type fails where it is
    // deepest, so "worst" only means anything when it is measured against the
    // text colour rather than assumed to be one end of the scale.
    const byRisk = ground.slice().sort((a, b) => contrastRatio(cand.fg, a) - contrastRatio(cand.fg, b));
    const worstRatio = contrastRatio(cand.fg, meanColor(byRisk.slice(0, Math.max(1, Math.round(ground.length * 0.1)))));
    if (avgRatio < cand.need)
      found.push({ el: cand.el, ratio: +avgRatio.toFixed(2), worstRatio: +worstRatio.toFixed(2), need: cand.need, size: cand.size, method: 'photo' });
  }
  return found;
}

/* ------------------------------------------------------------- the API ---- */

export async function inspect(url, { widths = [1440, 390], out = null, full = false, wait = 1800, scrolls = [0], reducedMotion = false, actions = [], measured = false, interact = false, baseline = null } = {}) {
  if (typeof WebSocket === 'undefined') throw new Error('Browser inspection requires Node 22 or newer.');
  if (!Array.isArray(widths) || !widths.length || widths.some(w => !Number.isInteger(w) || w < 240 || w > 3840)) throw new Error('Widths must be integers between 240 and 3840.');
  if (!Number.isFinite(wait) || wait < 0 || wait > 30000) throw new Error('Wait must be between 0 and 30000 ms.');
  if (scrolls !== 'auto' && (!Array.isArray(scrolls) || !scrolls.length || scrolls.some(y => !Number.isFinite(y) || y < 0))) throw new Error('Invalid scroll positions.');
  if (!Array.isArray(actions) || actions.length > 40) throw new Error('At most 40 interaction steps are supported.');
  const bin = findBrowser();
  if (!bin) {
    const err = new Error(
      'no Chrome, Edge or Chromium found.\n' +
      '  Windows: winget install --id Microsoft.Edge (usually already present)\n' +
      '  macOS:   brew install --cask google-chrome\n' +
      '  Linux:   apt-get install chromium\n' +
      'Or set ATELIER_BROWSER to the executable.');
    err.code = 'no-browser';
    throw err;
  }

  const { proc, udd, port } = await launch(bin);
  // Same-origin test for the hung-request check. A URL that will not parse is
  // not a reason to fail the run; it just means the check cannot narrow.
  let origin = null;
  try { origin = new URL(url).origin; } catch { origin = null; }
  const results = [];
  let session;
  try {
    session = await Session.open(port);
    await session.send('Page.enable');
    await session.send('Runtime.enable');
    await session.send('Network.enable');
    // A WebGL drawing buffer is cleared the moment it is composited, so
    // drawImage() from one reads back transparent black and every three.js
    // hero looked "blank". Ask for the buffer to be preserved before any
    // document runs, and record which kind of context each canvas took so a
    // reading that still comes back flat means something.
    await session.send('Page.addScriptToEvaluateOnNewDocument', { source: CANVAS_INIT }).catch(() => {});
    // Long tasks and layout shifts have to be observed from the first frame,
    // not from whenever the probe arrives.
    await session.send('Page.addScriptToEvaluateOnNewDocument', { source: MEASURE_INIT }).catch(() => {});
    await session.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: reducedMotion ? 'reduce' : 'no-preference' }] });

    for (const w of widths) {
      const height = 1000;
      await session.send('Emulation.setDeviceMetricsOverride', {
        width: w, height, deviceScaleFactor: 1, mobile: w < 700,
      });
      session.events.length = 0;
      await session.send('Log.enable').catch(() => {});
      const navigation = await session.send('Page.navigate', { url });
      if (navigation.errorText) throw new Error('Navigation failed: ' + navigation.errorText);
      if (!await session.waitForEvent('Page.loadEventFired')) throw new Error('Page load timed out; inspection is incomplete.');
      // let fonts settle and any entrance animation finish
      await session.send('Runtime.evaluate', {
        expression: 'document.fonts ? document.fonts.ready.then(()=>1) : 1', awaitPromise: true,
      }).catch(() => {});
      await sleep(wait);

      // A parallax layer that is fine at the top of the page can be sitting on
      // the headline 400px later. Probe at every requested scroll position.
      const metrics = await session.send('Runtime.evaluate', { expression: 'Math.max(0,document.documentElement.scrollHeight-innerHeight)', returnByValue: true });
      const maximum = Number(metrics.result.value) || 0;
      const positions = scrolls === 'auto' ? [...new Set([0, Math.round(maximum / 2), maximum])] : scrolls;
      for (const sy of positions) {
        await session.send('Runtime.evaluate', {
          expression: `window.scrollTo({top:${sy},behavior:'instant'}); window.dispatchEvent(new Event('scroll'));`,
        });
        await sleep(sy ? 700 : 0);
        const probe = await session.send('Runtime.evaluate', { expression: PROBE, returnByValue: true });
        if (probe.exceptionDetails || typeof probe.result?.value !== 'string') throw new Error('Page inspection failed to return a report.');
        const report = JSON.parse(probe.result.value);
        report.reducedMotion = reducedMotion;
        const state = await session.send('Runtime.evaluate', { returnByValue: true, expression: '(' + canvasProbe.toString() + ')()' });
        report.visual = state.result?.value || {};
        report.actionErrors = [];

        // report.network used to be assigned here from a loadingFailed filter
        // and then immediately overwritten by collectEvents' own, better one.
        // Dead code that duplicated the 404 logic; removed.
        Object.assign(report, collectEvents(session, { origin }));

        let file = null;
        // A screenshot is captured for the imageCandidates the probe found
        // even when `out` was never given: sampling their pixels is the only
        // way to answer "is this legible", and the buffer is thrown away
        // (not written) when nobody asked for the PNGs on disk. Skipped for
        // `full` captures - that image extends beyond the viewport its rects
        // were measured against, so viewport coordinates would land on the
        // wrong pixels.
        const wantsShot = out || (!full && report.imageCandidates?.length);
        if (wantsShot) {
          const shot = await session.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: full });
          const buf = Buffer.from(shot.data, 'base64');
          if (out) {
            mkdirSync(out, { recursive: true });
            file = join(out, `w${w}${sy ? '-y' + sy : ''}.png`);
            writeFileSync(file, buf);
          }
          if (!full && report.imageCandidates?.length) {
            const png = decodePNG(buf);
            if (png) {
              report.contrast.push(...sampleImageContrast(png, report.imageCandidates));
              report.contrast.sort((a, b) => a.ratio - b.ratio);
              report.contrast = report.contrast.slice(0, 10);
            }
          }
        }
        delete report.imageCandidates;
        // Once per width, at the top of the page, because the frame rate and
        // the load cost are properties of the page rather than of a scroll
        // position, and measuring them three times says the same thing three
        // times at three times the cost.
        if (measured && sy === positions[0]) {
          // reducedMotion tells measure() which media this pass NAVIGATED
          // with, which is the only authoritative answer to "does the page
          // honour it"; baseline carries what the no-preference pass saw so
          // the reduce pass can say what changed rather than only what is.
          const opts = { ...(measured === true ? {} : measured), reducedMotion, baseline: baseline?.[w] || null };
          results.push({ width: w, scroll: sy, file, ...report, measured: await measure(session, opts) });
        } else {
          results.push({ width: w, scroll: sy, file, ...report });
        }
      }
      // Every interactive element on the page, exercised. Runs after the
      // scroll probes so nothing it clicks can change what they measured, and
      // before the scripted actions so a hand-written flow still starts from
      // the page as authored.
      if (interact) {
        const sweep = await sweepInteractive(session, { origin }).catch((err) => ({ error: err.message, clicks: [], focus: [], shifted: [] }));
        const last = results[results.length - 1];
        if (last) {
          last.interact = sweep.clicks || [];
          last.focus = sweep.focus || [];
          last.shifted = sweep.shifted || [];
          if (sweep.error) last.actionErrors = [...(last.actionErrors || []), 'interaction sweep: ' + sweep.error];
        }
      }
      for (let index = 0; index < actions.length; index++) {
        const step = actions[index];
        const actionErrors = [];
        try { await performAction(session, step); } catch (err) { actionErrors.push(err.message); }
        await sleep(200);
        const probe = await session.send('Runtime.evaluate', { expression: PROBE, returnByValue: true });
        if (probe.exceptionDetails || typeof probe.result?.value !== 'string') throw new Error('Interaction inspection returned no report.');
        const report = JSON.parse(probe.result.value);
        Object.assign(report, collectEvents(session, { origin }));
        const state = await session.send('Runtime.evaluate', { expression: '(' + canvasProbe.toString() + ')()', returnByValue: true });
        let file = null;
        if (out || report.imageCandidates?.length) {
          const shot = await session.send('Page.captureScreenshot', { format: 'png' });
          const buf = Buffer.from(shot.data, 'base64');
          if (out) {
            mkdirSync(out, { recursive: true });
            file = join(out, 'w' + w + '-step' + (index + 1) + '.png');
            writeFileSync(file, buf);
          }
          if (report.imageCandidates?.length) {
            const png = decodePNG(buf);
            if (png) {
              report.contrast.push(...sampleImageContrast(png, report.imageCandidates));
              report.contrast.sort((a, b) => a.ratio - b.ratio);
              report.contrast = report.contrast.slice(0, 10);
            }
          }
        }
        delete report.imageCandidates;
        results.push({ width: w, scroll: null, step: index + 1, action: step, file, ...report, visual: state.result?.value || {}, actionErrors, reducedMotion });
      }
    }
  } finally {
    if (session) session.close();
    try { proc.kill(); } catch {}
    setTimeout(() => { try { rmSync(udd, { recursive: true, force: true }); } catch {} }, 400);
  }
  return results;
}

export function formatReport(results) {
  const lines = [];
  let errors = 0, warns = 0;
  for (const r of results) {
    lines.push(`\n  ${r.width}px${r.scroll ? ' scrolled ' + r.scroll + 'px' : ''}  (${r.stats.textElements} text elements, page ${r.stats.scrollHeight}px tall)`);
    for (const error of r.actionErrors || []) { errors++; lines.push('  ERROR interaction: ' + error); }
    for (const failure of r.network || []) {
      errors++;
      lines.push('  ERROR network: ' + failure.error + ' (' + failure.type + ')' + (failure.blockedReason ? ' blocked: ' + failure.blockedReason : ''));
    }
    for (const h of r.hung || []) { errors++; lines.push(`  ERROR request never resolved after ${h.ms}ms: ${h.url} (${h.type})`); }
    for (const c of r.interact || []) { errors++; lines.push(`  ERROR clicking ${c.el} threw: ${c.error}`); }
    for (const s of r.shifted || []) { warns++; lines.push(`  warn  ${s.el} moved out from under the pointer when ${s.clicked} was clicked`); }
    for (const f of r.focus || []) { warns++; lines.push(`  warn  no visible focus indicator on ${f.el}`); }
    for (const canvas of r.visual?.canvases || []) {
      const kind = canvas.context ? canvas.context.replace('experimental-', '') + ' canvas' : 'canvas';
      if (canvas.width === 0 || canvas.height === 0) { errors++; lines.push(`  ERROR ${kind} has zero visible size`); }
      else if (canvas.readable === false) lines.push(`  note  ${kind} pixels could not be read (offscreen or cross-origin); judge it from the screenshot`);
      else if (canvas.uniform) { warns++; lines.push(`  warn  ${kind} rendered a flat fill; inspect its screenshot and loading state`); }
    }
    if (r.measured) {
      const found = judge(r.measured, { expectDepth: false });
      const shown = formatQuality(r.measured, found);
      errors += shown.errors;
      warns += shown.warns;
      if (shown.lines) lines.push(shown.lines);
    }
    if (r.file) lines.push(`  shot: ${r.file}`);

    if (r.overlaps.length) {
      for (const o of r.overlaps) {
        errors++;
        lines.push(`  ERROR overlap ${o.pct}% at y=${o.at}: ${o.a}`);
        lines.push(`                          over: ${o.b}`);
      }
    } else lines.push('  ok    no text overlapping other text');

    for (const o of r.offscreen) { errors++; lines.push(`  ERROR ${o.el} is ${o.width}px in a ${o.vw}px viewport`); }
    for (const o of r.overflow) { errors++; lines.push(`  ERROR ${o.what} runs ${o.by}px past the right edge`); }
    for (const c of r.collapsed) { errors++; lines.push(`  ERROR collapsed to zero size but has text: ${c}`); }
    for (const b of r.broken) { errors++; lines.push(`  ERROR image failed to load: ${b}`); }
    for (const c of (r.console || [])) {
      if (c.level === 'error') { errors++; lines.push(`  ERROR console: ${c.text}`); }
      else { warns++; lines.push(`  warn  console: ${c.text}`); }
    }
    for (const c of r.contrast) {
      warns++;
      const via = c.method === 'photo' ? ' [sampled from the photo behind it' + (c.worstRatio != null ? `, ${c.worstRatio}:1 at its worst` : '') + ']' : ' [solid background]';
      lines.push(`  warn  contrast ${c.ratio}:1 (needs ${c.need}) at ${c.size}px: ${c.el}${via}`);
    }
    for (const t of r.tiny) { warns++; lines.push(`  warn  tap target ${t.w}x${t.h}px (needs 24): ${t.el}`); }
  }
  return { text: lines.join('\n'), errors, warns };
}

/* A request that is still outstanding this long after it was sent has not
   failed and has not 404'd - it has simply never resolved, which is the one
   asset failure that produces no event at all today. Deliberately generous:
   the cost of calling a merely slow asset "hung" is a false positive, and a
   false positive is worse than no check. */
const HUNG_MS = 3000;
const HUNG_TYPES = new Set(['Script', 'Stylesheet', 'Font', 'Image']);

function collectEvents(session, options = {}) {
  const report = {};
  // ONE request, ONE finding. A missing script emits BOTH
  // Network.responseReceived status 404 AND Network.loadingFailed
  // net::ERR_ABORTED for the same requestId; MEASURED on Chromium 152, that
  // follow-up failure carries canceled:true, so the !canceled filter already
  // hid it and keying by requestId is belt-and-braces rather than the fix.
  // The duplicate that was really being printed is the Log.entryAdded
  // "Failed to load resource" echo further down, which is now dropped in
  // favour of the network entry - that one is the report the fixture proves.
  // requestId is kept as the key regardless: it is the only identity that is
  // genuinely one per request, so a browser that does not mark the abort
  // canceled cannot reintroduce the double.
  const byRequest = new Map();
  for (const e of session.events) {
    const id = e.params?.requestId;
    if (!id) continue;
    if (e.method === 'Network.responseReceived' && e.params.response?.status >= 400) {
      if (/favicon\.ico(?:$|\?)/.test(e.params.response.url)) continue;
      byRequest.set(id, { error: 'HTTP ' + e.params.response.status + ' ' + e.params.response.url, type: e.params.type, blockedReason: null });
    } else if (e.method === 'Network.loadingFailed' && !e.params.canceled) {
      // blockedReason (csp, mixed-content, inspector) was being discarded
      // while the console filter below suppresses the net::ERR_BLOCKED text
      // it produces - between the two, a script blocked by policy was
      // reported nowhere at all.
      const blockedReason = e.params.blockedReason || null;
      if (byRequest.has(id) && !blockedReason) continue; // the 404 above already said it
      byRequest.set(id, { error: e.params.errorText || 'request failed', type: e.params.type, blockedReason });
    }
  }
  const network = [...byRequest.values()].slice(0, 20);

  // Requests that never resolved either way. Tracked across calls because
  // session.events is drained at the end of this function.
  if (!session.pending) session.pending = new Map();
  for (const e of session.events) {
    const id = e.params?.requestId;
    if (!id) continue;
    if (e.method === 'Network.requestWillBeSent') {
      // wallTime, not Date.now(): these events are read in a batch long after
      // they happened, so stamping them on arrival made every request look
      // brand new and nothing could ever be old enough to count as hung.
      const at = Number.isFinite(e.params.wallTime) ? e.params.wallTime * 1000 : Date.now();
      session.pending.set(id, { url: String(e.params.request?.url || ''), type: e.params.type || null, at });
    } else if (e.method === 'Network.loadingFinished' || e.method === 'Network.loadingFailed') {
      session.pending.delete(id);
    }
  }
  const now = Date.now();
  const origin = options.origin || null;
  report.hung = [];
  for (const [id, req] of session.pending) {
    if (now - req.at < HUNG_MS) continue;
    // Only same-origin, and only a type the page needs in order to render: an
    // analytics beacon left open forever is not this page's bug.
    if (!HUNG_TYPES.has(req.type)) continue;
    if (origin && !req.url.startsWith(origin)) continue;
    report.hung.push({ url: req.url.slice(0, 120), type: req.type, ms: now - req.at });
    session.pending.delete(id); // reported once, not at every later scroll position
    if (report.hung.length >= 8) break;
  }
  // A thrown exception, a failed shader compile, a 404 on a module - none
  // of it shows in the DOM. The page just quietly does less than it should.
  const seen = new Set();
  report.console = [];
  for (const e of session.events) {
    let text = null;
    if (e.method === 'Runtime.exceptionThrown') {
      const d = e.params?.exceptionDetails;
      text = d?.exception?.description || d?.text || 'uncaught exception';
    } else if (e.method === 'Runtime.consoleAPICalled' && /error|warning|assert/.test(e.params?.type)) {
      text = (e.params.args || []).map((a) => a.value ?? a.description ?? a.unserializableValue ?? '').join(' ').trim();
    } else if (e.method === 'Log.entryAdded' && /error|warning/.test(e.params?.entry?.level)) {
      const en = e.params.entry;
      // A 404 emits a network Log entry AS WELL AS the responseReceived the
      // network list above is built from, so one missing asset was being
      // reported twice in two different vocabularies. The network list is the
      // better of the two - it carries the status and the full URL - so the
      // echo is dropped rather than the entry.
      if (en.source === 'network' && /^Failed to load resource/.test(en.text || '')) continue;
      text = `${en.text}${en.url ? ' <- ' + en.url.split('/').pop() : ''}`;
    }
    if (!text) continue;
    text = String(text).split('\n')[0].slice(0, 180);
    // favicon 404s and third-party noise are not the page's bugs
    // favicon 404s, aborted third-party requests, and the ANGLE precision
    // note three.js emits on every Windows machine are not page bugs
    if (/favicon|net::ERR_(BLOCKED|ABORTED)|cannot be represented accurately in double precision/i.test(text)) continue;
    const key = text.slice(0, 90);
    if (seen.has(key)) continue;
    seen.add(key);
    report.console.push({
      level: e.method === 'Runtime.exceptionThrown' ? 'error'
        : (e.params?.type || e.params?.entry?.level || 'warning'),
      text,
    });
  }
  // consume them, or every later scroll position re-reports the same
  // load-time errors
  session.events.length = 0;

  report.network = network;
  return report;
}

function canvasProbe() {
  const canvases = [...document.querySelectorAll('canvas')].map(canvas => {
    const rect = canvas.getBoundingClientRect();
    let uniform = null, readable = false, spread = null;
    try {
      const n = 16;
      const copy = document.createElement('canvas'); copy.width = copy.height = n;
      const ctx = copy.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(canvas, 0, 0, n, n);
      const pixels = ctx.getImageData(0, 0, n, n).data;
      readable = true;
      // Widest spread on any channel across the sampled grid. Exact equality
      // called a dithered gradient "varied" and a 1-bit difference "alive";
      // a spread of a couple of levels is a flat fill either way.
      const lo = [255, 255, 255, 255], hi = [0, 0, 0, 0];
      for (let i = 0; i < pixels.length; i++) {
        const c = i % 4;
        if (pixels[i] < lo[c]) lo[c] = pixels[i];
        if (pixels[i] > hi[c]) hi[c] = pixels[i];
      }
      spread = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2], hi[3] - lo[3]);
      uniform = spread <= 2;
    } catch (err) { uniform = null; }
    return {
      width: Math.round(rect.width), height: Math.round(rect.height),
      uniform, readable, spread,
      context: canvas.__inspectContext || null,
    };
  });
  return { canvases, reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    webglSections: [...document.querySelectorAll('.exploded')].map(el => ({ live: el.classList.contains('is-live'), model: Boolean(el.dataset.model) })) };
}

/* ------------------------------------------------- the interaction sweep --- */
/* Check 6 extends performAction rather than sitting beside it: the same
   selector-resolve / elementFromPoint hit-test / Input.dispatchMouseEvent
   sequence, fed by an auto-enumerated element list instead of a hand-written
   JSON file. Three defects are looked for, and each has a guard that cost a
   real false positive to learn. */

const SWEEP_CAP = 16;

/* Marks the elements to exercise and hands back their labels. Every skip here
   is guard (d): one stray <a href> turns a debug pass into a site crawl. */
const SWEEP_LIST = `(() => {
  const here = location.href.split('#')[0];
  const out = [];
  for (const el of document.querySelectorAll('a, button, input, select, textarea, [role=button]')) {
    if (out.length >= ${SWEEP_CAP}) break;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) continue;
    if (el.disabled) continue;
    if (el.tagName === 'A' && el.href && el.href.split('#')[0] !== here) continue;
    if (el.tagName === 'INPUT' && /^(file|submit|reset|image)$/i.test(el.type)) continue;
    const id = el.id ? '#' + el.id : '';
    const txt = (el.textContent || el.value || '').trim().replace(/\\s+/g, ' ').slice(0, 28);
    el.setAttribute('data-uws-probe', String(out.length));
    out.push({ i: out.length, el: el.tagName.toLowerCase() + id + (txt ? ' "' + txt + '"' : '') });
  }
  return JSON.stringify(out);
})()`;

const SWEEP_CLEANUP = `(() => {
  for (const el of document.querySelectorAll('[data-uws-probe]')) el.removeAttribute('data-uws-probe');
  return JSON.stringify({ href: location.href });
})()`;

/* Focus, driven by real Tab keys. MEASURED GOTCHA: a programmatic el.focus()
   inherits the previous input modality, so :focus-visible came back true on an
   element focused by script straight after a mouse click. Judging focus from
   el.focus() is therefore unsound - the only honest way to ask "would a
   keyboard user see where they are" is to press Tab. */
/* One fingerprint function, shared verbatim by the snapshot and the read-back
   so the two can never drift. It reads the element, its ::before and ::after,
   its PARENT (a :focus-within wrapper is where a whole class of design systems
   draws the ring) and its first few descendants (an inner span is the other).
   getComputedStyle(el) with no second argument sees none of those, so a ring
   drawn on ::after produced an identical string focused and unfocused and a
   correct, extremely common pattern was accused of having no focus indicator
   on every button on every page. */
const FOCUS_FINGERPRINT = `((el) => {
  const props = (cs) => [cs.outlineWidth, cs.outlineStyle, cs.outlineColor, cs.outlineOffset, cs.boxShadow,
    cs.borderColor, cs.borderWidth, cs.borderStyle, cs.backgroundColor, cs.backgroundImage, cs.color,
    cs.filter, cs.transform, cs.opacity, cs.textDecorationLine, cs.textDecorationColor].join(',');
  const pseudo = (node, which) => {
    try { const cs = getComputedStyle(node, which); return cs.content + ',' + cs.width + ',' + cs.height + ',' + props(cs); }
    catch (err) { return ''; }
  };
  const nodes = [el];
  if (el.parentElement) nodes.push(el.parentElement);
  for (const d of el.querySelectorAll('*')) { if (nodes.length >= 8) break; nodes.push(d); }
  const parts = [];
  for (const n of nodes) parts.push(props(getComputedStyle(n)) + '|' + pseudo(n, '::before') + '|' + pseudo(n, '::after'));
  return parts.join('||');
})`;

const FOCUS_SNAP = `(() => {
  const fingerprint = ${FOCUS_FINGERPRINT};
  const el = document.activeElement;
  const f = window.__uwsFocus;
  // Landing on the body is "the tab order wrapped round", not "there is
  // nothing here". Sequential focus navigation starts from whatever was last
  // focused - and the click sweep above focused the LAST button on the page -
  // so the very first Tab legitimately falls off the end. Treating that as the
  // end of the sweep is why this check silently found nothing on every page.
  if (!el || el === document.body || el === document.documentElement) return JSON.stringify({ wrapped: true });
  if (f.els.indexOf(el) !== -1) return JSON.stringify({ done: true });
  const id = el.id ? '#' + el.id : '';
  const txt = (el.textContent || el.value || '').trim().replace(/\\s+/g, ' ').slice(0, 28);
  f.els.push(el);
  f.seen.push({
    el: el.tagName.toLowerCase() + id + (txt ? ' "' + txt + '"' : ''),
    // Guard (b): outline:none with a box-shadow ring is a correct and common
    // style, so no single property can decide this. Everything a focus ring is
    // ever drawn with, ON EVERY BOX IT CAN BE DRAWN ON, is compared - and only
    // an element where ALL of it is identical focused and unfocused has no
    // indicator at all.
    style: fingerprint(el),
  });
  return JSON.stringify({ done: false });
})()`;

const FOCUS_READ = `(() => {
  const fingerprint = ${FOCUS_FINGERPRINT};
  const f = window.__uwsFocus;
  if (!f) return JSON.stringify([]);
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  const out = [];
  for (let i = 0; i < f.els.length; i++) {
    if (fingerprint(f.els[i]) === f.seen[i].style) out.push({ el: f.seen[i].el });
  }
  delete window.__uwsFocus;
  return JSON.stringify(out);
})()`;

async function evalJson(session, expression) {
  const r = await session.send('Runtime.evaluate', { expression, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || 'sweep evaluation failed');
  return JSON.parse(r.result?.value ?? 'null');
}

export async function sweepInteractive(session, { origin = null } = {}) {
  const clicks = [], shifted = [];
  const list = await evalJson(session, SWEEP_LIST) || [];
  const startHref = (await evalJson(session, `JSON.stringify(location.href)`)) || '';
  for (const item of list) {
    const from = session.events.length;
    // ABSOLUTE index into the shift-source buffer, not an array offset: the
    // buffer drops its oldest entries once it is full, so a raw length taken
    // now would point at the wrong element by the time the click is read back.
    const shiftsBefore = await evalJson(session, `JSON.stringify((() => { const m = window.__measure || {}; return (m.shiftSources || []).length + (m.shiftDropped || 0); })())`);
    let point = null;
    try {
      point = await performAction(session, { type: 'click', selector: '[data-uws-probe="' + item.i + '"]' });
    } catch (err) {
      // "hidden or covered" is not a defect of the element, it is the sweep
      // failing to reach it. Silently skipped: an unreachable element cannot
      // be judged, and guessing is how a checker earns its reputation.
      continue;
    }
    await sleep(160);
    for (const e of session.events.slice(from)) {
      if (e.method !== 'Runtime.exceptionThrown') continue;
      const d = e.params?.exceptionDetails;
      const text = String(d?.exception?.description || d?.text || 'uncaught exception').split('\n')[0].slice(0, 140);
      clicks.push({ el: item.el, error: text });
      break;
    }
    // Guard (c): a layout shift after a click is usually intentional - an
    // accordion opening, a panel growing below. Only a shift whose SOURCE rect
    // contained the click point is reported, because "the thing moved out from
    // under the pointer" is the defect and "the page grew underneath" is not.
    if (point && Number.isFinite(point.x)) {
      const moved = await evalJson(session, `(() => {
        const m = window.__measure || {};
        const all = m.shiftSources || [];
        const fresh = all.slice(Math.max(0, ${shiftsBefore || 0} - (m.shiftDropped || 0)));
        const x = ${point.x}, y = ${point.y};
        const inside = (r) => Boolean(r) && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
        // Both halves, or this is not the defect it claims to be. "The click
        // point was inside the OLD rect" alone names any control that resizes
        // itself: every Play/Pause, Show/Hide and Copy/Copied toggle in a
        // centred or right-aligned row moves its own start point while the
        // pointer never leaves it, and each one was a standing warning. The
        // pointer has to have started on it AND no longer be on it. Where the
        // new rect is unknown nothing is said - an unmeasurable shift cannot
        // be judged.
        const hit = fresh.filter((s) => s.node && inside(s.from) && s.to && !inside(s.to));
        return JSON.stringify([...new Set(hit.map((s) => s.node))].slice(0, 2));
      })()`);
      for (const el of moved || []) shifted.push({ el, clicked: item.el });
    }
    const href = await evalJson(session, `JSON.stringify(location.href)`);
    // Guard (d) again, this time after the fact: if a click navigated anyway,
    // everything measured after it would describe a different page.
    if (href !== startHref) break;
  }
  await evalJson(session, SWEEP_CLEANUP).catch(() => null);

  // Focus is swept separately and last: it needs keyboard modality, which the
  // clicks above destroy, and real Tab keys are what re-establish it.
  // A headless page is not the focused window, so sequential focus navigation
  // goes nowhere until focus is emulated - without this the Tab sweep silently
  // finds no elements and every page reports a perfect focus story.
  await session.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
  await evalJson(session, `(() => { window.__uwsFocus = { els: [], seen: [] }; if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); window.scrollTo({ top: 0, behavior: 'instant' }); return JSON.stringify(1); })()`);
  let wrapped = 0;
  for (let i = 0; i < SWEEP_CAP + 2; i++) {
    await session.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9, key: 'Tab', code: 'Tab' });
    await session.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9, key: 'Tab', code: 'Tab' });
    const step = await evalJson(session, FOCUS_SNAP);
    if (!step || step.done) break;
    if (step.wrapped) { wrapped++; if (wrapped > 1) break; }
  }
  const focus = await evalJson(session, FOCUS_READ) || [];
  return { clicks, focus, shifted };
}

async function performAction(session, step) {
  if (!step || !['click', 'hover', 'focus', 'expect-visible', 'expect-text'].includes(step.type) || typeof step.selector !== 'string')
    throw new Error('Each step needs a supported type and CSS selector.');
  if (step.type === 'expect-text' && typeof step.text !== 'string') throw new Error('expect-text needs a text string.');
  const encoded = JSON.stringify(step);
  const response = await session.send('Runtime.evaluate', { returnByValue: true, expression: '(() => { const step = ' + encoded + '; const el = document.querySelector(step.selector); if (!el) return {error:"Element not found: "+step.selector}; el.scrollIntoView({block:"center",behavior:"instant"}); const r=el.getBoundingClientRect(); const style=getComputedStyle(el); const visible=r.width>0 && r.height>0 && style.visibility!=="hidden" && style.display!=="none" && (!el.checkVisibility || el.checkVisibility({opacityProperty:true,visibilityProperty:true})); if(step.type==="expect-visible") return visible ? {} : {error:"Element is not visible: "+step.selector}; if(step.type==="expect-text") return visible && el.textContent.includes(step.text) ? {} : {error:"Expected text missing: "+step.selector}; if(step.type==="focus"){ el.focus(); return document.activeElement===el ? {} : {error:"Element could not receive focus"}; } const x=r.left+r.width/2,y=r.top+r.height/2; const hit=document.elementFromPoint(x,y); if(!visible || !(hit===el || el.contains(hit))) return {error:"Element is hidden or covered: "+step.selector}; return {x,y}; })()' });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text || 'Interaction evaluation failed');
  const result = response.result?.value;
  if (!result || result.error) throw new Error(result?.error || 'Interaction returned no result');
  if (!['click', 'hover'].includes(step.type)) return result;
  await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: result.x, y: result.y });
  if (step.type === 'click') {
    await session.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: result.x, y: result.y, button: 'left', clickCount: 1 });
    await session.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: result.x, y: result.y, button: 'left', clickCount: 1 });
  }
  // The click point, so a caller can ask what moved under it.
  return result;
}
