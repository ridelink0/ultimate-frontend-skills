/* ultimate-frontend-skills/tells-render - the AI tells only a rendered page
   shows, as a vector.

   node webdesign.mjs tells <dir|file|url> [--json] [--widths 1440,390] [--wait MS]

   The audit (tells.mjs) reads source, and source cannot say what colour the
   ground came out, which face the button asked for, or whether three big
   numerals sit in a row. A fresh bone scaffold scored Mild on slop-detect
   0.5.2 and impeccable 4.1.0 flagged its cream ground, Instrument Sans and
   marquee, while the audit flagged nothing (2026-09-29). This renders the page
   and runs one function in it (pageProbe, below) through the same CDP session
   the render check uses, once per width, and reports each feature as
   {id, fired, value, evidence} under the schema ufs-tells/1.

   It is a vector, not a verdict: nothing here changes an exit code, and the
   thresholds live in data/tells-render.json, each with its why and source, so
   weights fitted to human labels can move them without a code change.

   Only the page's own origin is fetched. Every other request is failed in the
   browser (Fetch domain), so a run is the same on a laptop, in CI and behind a
   proxy that breaks third-party TLS, and a webfont from another origin never
   loads here. The features that care about faces read the family the page
   asks for, and record whether it loaded. */
import { readFileSync, existsSync, statSync, realpathSync } from 'node:fs';
import { resolve, dirname, basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { findBrowser, launch, closeBrowser, Session } from './inspect.mjs';
import { startServer } from './preview-server.mjs';
import { SLOP_FONTS } from './audit.mjs';
import { DEFAULT_SECTIONS, loadSections } from './sections.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = join(ROOT, 'skills', 'ultimate-frontend-skills', 'data', 'tells-render.json');

export const TELLS_SCHEMA = 'ufs-tells/1';
// v1. The ids are stable: fitted weights and stored runs refer to them.
export const FEATURE_IDS = [
  'cream-ground', 'perma-dark', 'cluster-1', 'cluster-2', 'template-chrome', 'overused-face', 'accent-word',
  'decorative-numbering', 'stat-banner', 'uniform-radius', 'marquee', 'centred-share', 'section-waterfall', 'display-tracking',
];

export function tellsConfig() {
  return JSON.parse(readFileSync(CONFIG, 'utf8'));
}

/* What each library section looks like to a page: the tag of each top-level
   element, every class and every id in the block, weighted by how rare the
   token is across the library (a token every section has says nothing). */
export function sectionSignatures(sections = loadSections()) {
  const skip = new Set(['head', 'foot', 'not-found']);
  const sets = new Map();
  for (const [id, { body }] of sections) {
    if (skip.has(id)) continue;
    const html = body.replace(/<!--[\s\S]*?-->/g, ' ');
    const toks = new Set();
    let depth = 0;
    for (const m of html.matchAll(/<(\/?)([a-z][\w-]*)\b([^>]*?)(\/?)>/gi)) {
      const tag = m[2].toLowerCase();
      const voids = /^(img|input|br|hr|meta|link|source|path|circle|rect|line|polyline|polygon|ellipse|use|stop|col|wbr)$/;
      if (m[1]) { depth = Math.max(0, depth - 1); continue; }
      if (depth === 0) toks.add('tag:' + tag);
      for (const c of (m[3].match(/\sclass\s*=\s*["']([^"']*)/i) || [, ''])[1].split(/\s+/)) if (c) toks.add('.' + c);
      const idm = m[3].match(/\sid\s*=\s*["']([^"']+)/i);
      if (idm) toks.add('#' + idm[1]);
      if (!m[4] && !voids.test(tag)) depth++;
    }
    sets.set(id, toks);
  }
  const df = new Map();
  for (const toks of sets.values()) for (const t of toks) df.set(t, (df.get(t) || 0) + 1);
  const n = sets.size;
  const out = {};
  for (const [id, toks] of sets) {
    out[id] = {};
    for (const t of toks) { const w = Math.log(n / df.get(t)); if (w > 0) out[id][t] = +w.toFixed(3); }
  }
  return out;
}

// The commit these scripts are at, or null for an install that is not its own
// checkout (git would otherwise answer for whatever repository encloses it).
export function ufsSha() {
  try {
    const r = spawnSync('git', ['-C', ROOT, 'rev-parse', '--show-toplevel', 'HEAD'], { encoding: 'utf8', timeout: 5000 });
    if (r.status !== 0) return null;
    const [top, sha] = r.stdout.trim().split(/\r?\n/);
    return realpathSync(top) === realpathSync(ROOT) && /^[0-9a-f]{40}$/.test(sha) ? sha : null;
  } catch { return null; }
}

const ufsVersion = () => { try { return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version; } catch { return null; } };

/* ---------------------------------------------------------------- in page -- */
/* Runs in the page. A plain function, stringified, so it is written once and
   can take no closure: everything it needs arrives in `arg`. Returns
   { [id]: { fired, value, evidence } }. */
export function pageProbe(arg) {
  const { cfg, slopFonts, signatures, defaultSections } = arg;
  const T = cfg.features;
  const W = document.documentElement.clientWidth || innerWidth;
  const out = {};
  const cs = (el, p) => getComputedStyle(el, p || null);
  const r3 = (n) => Math.round(n * 1000) / 1000;
  const clip = (s, n = 48) => { s = String(s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

  // Colours: whatever notation the computed value is in (rgb, oklch, color()),
  // the canvas paints it in sRGB and the pixel is read back.
  const cv = document.createElement('canvas'); cv.width = cv.height = 1;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  const memo = new Map();
  function rgba(str) {
    if (!str || str === 'transparent' || str === 'none') return null;
    if (memo.has(str)) return memo.get(str);
    cx.clearRect(0, 0, 1, 1); cx.fillStyle = 'rgba(0,0,0,0)'; cx.fillStyle = str; cx.fillRect(0, 0, 1, 1);
    const d = cx.getImageData(0, 0, 1, 1).data;
    const v = d[3] === 0 ? null : [d[0], d[1], d[2], d[3]];
    memo.set(str, v);
    return v;
  }
  function oklab([r, g, b]) {
    const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    const R = lin(r), G = lin(g), B = lin(b);
    const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
    const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
    const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
    return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
  }
  function oklch(c) {
    const [L, a, b] = oklab(c);
    let H = Math.atan2(b, a) * 180 / Math.PI; if (H < 0) H += 360;
    return [L, Math.hypot(a, b), H];
  }
  const hex = (c) => '#' + c.slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join('');
  const lchText = ([L, C, H]) => `oklch(${r3(L)} ${r3(C)} ${C < 0.002 ? 'none' : Math.round(H)})`;

  const SKIP = new Set(['SCRIPT', 'STYLE', 'TEMPLATE', 'NOSCRIPT', 'LINK', 'META', 'HEAD', 'TITLE', 'BR', 'WBR']);
  const shown = (el) => {
    if (SKIP.has(el.tagName)) return false;
    const s = cs(el);
    if (s.display === 'none' || s.visibility === 'hidden' || s.visibility === 'collapse') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const all = [];
  for (const el of document.body.querySelectorAll('*')) { if (all.length >= 6000) break; if (shown(el)) all.push(el); }
  const ownText = (el) => { let t = ''; for (const n of el.childNodes) if (n.nodeType === 3) t += n.nodeValue; return t.replace(/\s+/g, ' ').trim(); };
  const textEls = all.filter((el) => ownText(el));
  const bodyPx = parseFloat(cs(document.body).fontSize) || 16;

  // Stylesheet rules, nested groups and imports unrolled. A cross-origin sheet
  // cannot be read (and is blocked here anyway).
  const rules = [];
  let lightRule = false;
  const lightRe = /prefers-color-scheme\s*:\s*light/i;
  const walk = (list) => {
    for (const r of list) {
      rules.push(r);
      const media = (r.media && r.media.mediaText) || r.conditionText || '';
      if (lightRe.test(media)) lightRule = true;
      try { if (r.styleSheet) walk(r.styleSheet.cssRules); } catch {}
      try { if (r.cssRules) walk(r.cssRules); } catch {}
    }
  };
  for (const sh of document.styleSheets) {
    try { if (sh.media && lightRe.test(sh.media.mediaText)) lightRule = true; walk(sh.cssRules); } catch {}
  }

  // Faces. The first family the stack names, and whether document.fonts has it.
  const unq = (f) => f.trim().replace(/^["']|["']$/g, '');
  const firstFamily = (stack) => unq(String(stack || '').split(',')[0] || '');
  const norm = (f) => unq(f).toLowerCase().replace(/\s+(variable|vf)$/, '').trim();
  const loaded = (f) => { try { return [...document.fonts].some((ff) => ff.status === 'loaded' && norm(ff.family) === norm(f)); } catch { return false; } };
  const GENERIC = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-serif|ui-sans-serif|ui-monospace|ui-rounded|math|emoji|fangsong|-apple-system|blinkmacsystemfont)$/i;
  const SERIFS = /georgia|times|garamond|baskerville|caslon|newsreader|fraunces|playfair|lora|merriweather|cormorant|spectral|crimson|bodoni|didot|tiempos|freight|recoleta|canela|domaine|charter|iowan|palatino|minion|source serif|pt serif|dm serif|libre|instrument serif|noto serif|ibm plex serif|gt sectra|ogg\b|editorial new/i;
  const kindOf = (stack) => {
    const fams = String(stack || '').split(',').map((f) => unq(f).toLowerCase());
    for (const f of fams) {
      if (f === 'serif' || f === 'ui-serif') return 'serif';
      if (f === 'monospace' || f === 'ui-monospace') return 'mono';
      if (GENERIC.test(f)) return 'sans';
    }
    const f = fams[0] || '';
    if (/mono|code|courier|consolas|menlo|monaco/.test(f)) return 'mono';
    if (/serif/.test(f) && !/sans/.test(f)) return 'serif';
    return SERIFS.test(f) ? 'serif' : 'sans';
  };
  const isMono = (s) => kindOf(s.fontFamily) === 'mono';

  /* --- the ground ------------------------------------------------------- */
  const groundCands = [['html', document.documentElement], ['body', document.body], ['main', document.querySelector('main')], ['first section', document.querySelector('section')]];
  let ground = null;
  for (const [name, el] of groundCands) {
    if (!el) continue;
    const c = rgba(cs(el).backgroundColor);
    if (!c || c[3] < 128) continue;
    const r = el.getBoundingClientRect();
    const area = el === document.documentElement ? el.scrollWidth * el.scrollHeight : r.width * r.height;
    if (!ground || area > ground.area) ground = { name, c, area };
  }
  if (!ground) ground = { name: 'canvas (nothing opaque, so white)', c: [255, 255, 255, 255], area: 0 };
  const g = oklch(ground.c);
  {
    const t = T['cream-ground'];
    const fired = g[0] >= t.L_min && g[1] >= t.C_min && g[1] <= t.C_max && g[2] >= t.H_min && g[2] <= t.H_max;
    out['cream-ground'] = { fired, value: { from: ground.name, colour: hex(ground.c), L: r3(g[0]), C: r3(g[1]), H: Math.round(g[2]) },
      evidence: `${ground.name} ${hex(ground.c)} = ${lchText(g)}` };
  }
  {
    const fired = g[0] <= T['perma-dark'].L_max && !lightRule;
    out['perma-dark'] = { fired, value: { L: r3(g[0]), lightRule },
      evidence: `${ground.name} ${hex(ground.c)} at L ${r3(g[0])}; ${lightRule ? 'a' : 'no'} prefers-color-scheme: light rule` };
  }

  /* --- colours on show -------------------------------------------------- */
  const chroma = [];
  for (const el of all) {
    const s = cs(el);
    const props = [s.color, s.backgroundColor];
    if (parseFloat(s.borderTopWidth) > 0) props.push(s.borderTopColor);
    if (el instanceof SVGElement) props.push(s.fill, s.stroke);
    for (const p of props) {
      const c = rgba(p);
      if (!c || c[3] < 128) continue;
      chroma.push({ c, lch: oklch(c), el });
    }
  }
  const h1 = document.querySelector('h1') && [...document.querySelectorAll('h1')].find(shown);
  {
    const t = T['cluster-1'];
    const serif = h1 ? kindOf(cs(h1).fontFamily) === 'serif' : false;
    const accent = chroma.find(({ lch }) => lch[1] >= t.accent_C_min && lch[2] >= t.accent_H_min && lch[2] <= t.accent_H_max);
    const fired = out['cream-ground'].fired && serif && !!accent;
    out['cluster-1'] = { fired, value: { cream: out['cream-ground'].fired, serifH1: serif, accent: accent ? hex(accent.c) : null },
      evidence: `cream ${out['cream-ground'].fired ? 'yes' : 'no'}; h1 ${h1 ? firstFamily(cs(h1).fontFamily) + ' (' + (serif ? 'serif' : 'not serif') + ')' : 'none'}; clay accent ${accent ? hex(accent.c) + ' ' + lchText(accent.lch) : 'none'}` };
  }
  {
    const t = T['cluster-2'];
    const hues = [...new Set(chroma.filter(({ lch }) => lch[1] >= t.C_min).map(({ lch }) => Math.round(lch[2])))].sort((a, b) => a - b);
    let groups = 0;
    if (hues.length) {
      groups = 1;
      for (let i = 1; i < hues.length; i++) if (hues[i] - hues[i - 1] > t.hue_gap) groups++;
      if (groups > 1 && hues[0] + 360 - hues[hues.length - 1] <= t.hue_gap) groups--;
    }
    const fired = out['perma-dark'].fired && groups === 1;
    out['cluster-2'] = { fired, value: { permaDark: out['perma-dark'].fired, hueGroups: groups, hues: hues.slice(0, 12) },
      evidence: `perma-dark ${out['perma-dark'].fired ? 'yes' : 'no'}; ${groups} hue group(s) at C ${t.C_min}+${hues.length ? ' (' + hues.slice(0, 6).join(', ') + ')' : ''}` };
  }

  /* --- template chrome -------------------------------------------------- */
  {
    const t = T['template-chrome'];
    const counts = { caps: 0, mono: 0, dotMeta: 0, arrow: 0 };
    const samples = [];
    const note = (k, s) => { counts[k]++; if (samples.length < 4) samples.push(k + ' "' + clip(s, 28) + '"'); };
    const inCode = (el) => !!el.closest('pre,code,kbd,samp,tt');
    for (const el of textEls) {
      const s = cs(el), txt = ownText(el), px = parseFloat(s.fontSize) || 16;
      const ls = s.letterSpacing === 'normal' ? 0 : parseFloat(s.letterSpacing) || 0;
      const letters = txt.replace(/[^\p{L}]/gu, '');
      const upper = s.textTransform === 'uppercase' || (letters.length >= 4 && letters === letters.toUpperCase() && letters !== letters.toLowerCase());
      if (px <= t.caps_max_px && upper && ls / px >= t.caps_tracking_em) note('caps', txt);
      else if (isMono(s) && txt.length <= t.mono_max_chars && !inCode(el)) note('mono', txt);
    }
    for (const el of all) {
      for (const p of ['::before', '::after']) {
        const s = cs(el, p), c = s.content;
        if (!c || c === 'none' || c === 'normal' || c === '""') continue;
        if (isMono(s) && !inCode(el)) note('mono', p + ' ' + c);
        if (p === '::after' && /→/.test(c) && el.matches('a,button,[role="button"]')) note('arrow', c);
      }
      if (el.matches('a,button,[role="button"]') && /(→|->)\s*$/.test(el.textContent || '')) note('arrow', el.textContent);
      const tc = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (tc.length <= 120 && /\S\s+·\s+\S/.test(tc) && ![...el.children].some((k) => /\S\s+·\s+\S/.test(k.textContent || ''))) note('dotMeta', tc);
    }
    const total = counts.caps + counts.mono + counts.dotMeta + counts.arrow;
    out['template-chrome'] = { fired: total >= t.min_total, value: { ...counts, total },
      evidence: `${counts.caps} tracked caps, ${counts.mono} mono labels, ${counts.dotMeta} · meta, ${counts.arrow} → links${samples.length ? ': ' + samples.join(', ') : ''}` };
  }

  /* --- the faces -------------------------------------------------------- */
  {
    const listed = slopFonts.map((f) => f.toLowerCase());
    const button = [...document.querySelectorAll('button,.btn,[role="button"],input[type="submit"]')].find(shown);
    const picks = [['h1', h1], ['body', document.body], ['button', button]];
    const value = {};
    const hits = [];
    for (const [k, el] of picks) {
      if (!el) continue;
      const fam = firstFamily(cs(el).fontFamily);
      const on = listed.includes(norm(fam));
      value[k] = { family: fam, listed: on, loaded: loaded(fam) };
      if (on) hits.push(`${k}: ${fam}${value[k].loaded ? '' : ' (asked for, not loaded)'}`);
    }
    out['overused-face'] = { fired: hits.length > 0, value,
      evidence: hits.length ? hits.join('; ') : Object.entries(value).map(([k, v]) => k + ': ' + v.family).join('; ') };
  }

  /* --- one word set apart in the h1 ------------------------------------- */
  {
    const t = T['accent-word'];
    const found = [];
    for (const h of document.querySelectorAll('h1')) {
      if (!shown(h)) continue;
      const hs = cs(h), full = (h.textContent || '').replace(/\s+/g, ' ').trim();
      const hc = rgba(hs.color);
      for (const d of h.querySelectorAll('*')) {
        const txt = (d.textContent || '').replace(/\s+/g, ' ').trim();
        if (!txt || !shown(d)) continue;
        const r = d.getBoundingClientRect();
        if (r.width <= 2 || r.height <= 2) continue;
        if (full.replace(txt, '').replace(/[\s\p{P}]/gu, '').length < 2) continue;
        const ds = cs(d), diffs = [];
        const dc = rgba(ds.color);
        if (hc && dc) { const a = oklab(hc), b = oklab(dc); if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) > t.colour_delta) diffs.push('colour'); }
        if (ds.fontStyle !== hs.fontStyle) diffs.push(ds.fontStyle);
        if (norm(firstFamily(ds.fontFamily)) !== norm(firstFamily(hs.fontFamily))) diffs.push('face');
        if (Math.abs((parseInt(ds.fontWeight, 10) || 400) - (parseInt(hs.fontWeight, 10) || 400)) >= t.weight_delta) diffs.push('weight');
        if ((ds.backgroundClip === 'text' || ds.webkitBackgroundClip === 'text') && ds.backgroundImage !== 'none') diffs.push('gradient');
        if (diffs.length) { found.push(`"${clip(txt, 24)}" in "${clip(full, 40)}" (${diffs.join(', ')})`); break; }
      }
    }
    out['accent-word'] = { fired: found.length > 0, value: found.length, evidence: found.length ? found.join('; ') : 'no h1 sets a word apart' };
  }

  /* --- sibling groups: numbering and stat banners ----------------------- */
  const HEAD = 'h1,h2,h3,h4,h5,h6,[role="heading"]';
  const parents = all.filter((el) => el.children.length >= 3);
  {
    let best = null;
    for (const p of parents) {
      const kids = [...p.children].filter(shown);
      if (kids.length < 3) continue;
      let pos = 0;
      const nums = kids.map((k) => {
        if (!(k.matches(HEAD) || k.querySelector(HEAD))) return null;
        const before = cs(k, '::before').content || '';
        if (/decimal-leading-zero/.test(before) || (k.tagName === 'LI' && cs(k).display === 'list-item' && cs(k).listStyleType === 'decimal-leading-zero')) return { n: ++pos, how: 'counter' };
        const lit = before.match(/^"\s*0(\d)\b/) || (k.textContent || '').trim().match(/^0(\d)(?=$|[\s.:/)|—–-])/);
        return lit ? { n: +lit[1], how: 'text' } : null;
      });
      for (let i = 0; i + 2 < nums.length; i++) {
        if (nums[i] && nums[i + 1] && nums[i + 2] && nums[i].n === 1 && nums[i + 1].n === 2 && nums[i + 2].n === 3) {
          const hd = kids[i].matches(HEAD) ? kids[i] : kids[i].querySelector(HEAD);
          best = best || `01, 02, 03 (${nums[i].how}) on "${clip(hd.textContent, 24)}" and its siblings`;
        }
      }
    }
    out['decorative-numbering'] = { fired: !!best, value: best ? 1 : 0, evidence: best || 'no zero-padded run on sibling headings' };
  }
  {
    const t = T['stat-banner'];
    const NUM = /^[~≈<>+±]?[$€£¥]?\d[\d.,\s]*\s?[\p{L}%+×]{0,3}\+?$/u;
    const mainText = (k) => {
      let top = null;
      const tw = document.createTreeWalker(k, NodeFilter.SHOW_TEXT);
      for (let n = tw.nextNode(); n; n = tw.nextNode()) {
        if (!n.nodeValue.trim() || !n.parentElement || !shown(n.parentElement)) continue;
        const px = parseFloat(cs(n.parentElement).fontSize) || 0;
        if (!top || px > top.px) top = { px, el: n.parentElement };
      }
      return top && { px: top.px, text: (top.el.textContent || '').replace(/\s+/g, ' ').trim() };
    };
    let best = { n: 0, texts: [] };
    for (const p of parents) {
      const kids = [...p.children].filter(shown);
      if (kids.length < t.min_siblings) continue;
      const hits = kids.map(mainText).filter((m) => m && m.text.length <= t.max_chars && NUM.test(m.text) && m.px >= t.size_ratio * bodyPx);
      if (hits.length > best.n) best = { n: hits.length, texts: hits.map((h) => h.text + ' at ' + Math.round(h.px) + 'px') };
    }
    out['stat-banner'] = { fired: best.n >= t.min_siblings, value: best.n,
      evidence: best.n ? `${best.n} sibling numerals (${best.texts.slice(0, 4).join(', ')}) against ${Math.round(bodyPx)}px body` : 'no row of big numerals' };
  }

  /* --- one radius, one shadow ------------------------------------------- */
  {
    const t = T['uniform-radius'];
    const groups = new Map();
    for (const el of all) {
      if (/^(IMG|VIDEO|CANVAS|INPUT|TEXTAREA|SELECT|BUTTON|IFRAME|svg)$/.test(el.tagName)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < t.min_w || r.height < t.min_h) continue;
      const s = cs(el), rad = parseFloat(s.borderTopLeftRadius) || 0;
      if (!rad || s.boxShadow === 'none') continue;
      const key = s.borderTopLeftRadius + ' | ' + s.boxShadow;
      groups.set(key, (groups.get(key) || 0) + 1);
    }
    const [key, n] = [...groups.entries()].sort((a, b) => b[1] - a[1])[0] || ['', 0];
    out['uniform-radius'] = { fired: n >= t.min_boxes, value: n, evidence: n ? `${n} boxes share ${clip(key, 70)}` : 'no rounded, shadowed boxes' };
  }

  /* --- the marquee ------------------------------------------------------ */
  {
    const nonzero = (v) => v != null && parseFloat(v) !== 0 && !isNaN(parseFloat(v));
    const horizontal = (style) => {
      const tr = style.transform || '';
      let m;
      if ((m = tr.match(/translateX\(\s*([-+\d.]+)/)) && nonzero(m[1])) return true;
      if ((m = tr.match(/translate(?:3d)?\(\s*([-+\d.]+)[a-z%]*\s*[,)]/)) && nonzero(m[1])) return true;
      const tl = (style.translate || '').trim().split(/\s+/)[0];
      return !!tl && tl !== 'none' && nonzero(tl);
    };
    const slides = new Set();
    for (const r of rules) if (r.type === 7 /* KEYFRAMES_RULE */ && [...r.cssRules].some((f) => horizontal(f.style))) slides.add(r.name);
    const selectors = [];
    for (const r of rules) {
      if (r.type !== 1 || !r.style || !r.style.animationName) continue;
      const names = r.style.animationName.split(',').map((s) => s.trim());
      const counts = (r.style.animationIterationCount || '').split(',').map((s) => s.trim());
      if (names.some((nm, i) => slides.has(nm) && (counts[i] || counts[counts.length - 1]) === 'infinite')) selectors.push(r.selectorText);
    }
    let running = 0;
    try {
      for (const a of document.getAnimations()) {
        const eff = a.effect;
        if (!eff || eff.getTiming().iterations !== Infinity) continue;
        if (eff.getKeyframes().some((k) => horizontal({ transform: k.transform || '', translate: k.translate || '' }))) running++;
      }
    } catch {}
    const tags = document.querySelectorAll('marquee').length;
    const fired = selectors.length + running + tags > 0;
    out['marquee'] = { fired, value: { rules: selectors.length, running, tags },
      evidence: fired ? [selectors.length && `${[...new Set(selectors)].slice(0, 3).join(', ')} runs an infinite horizontal slide`, running && `${running} running`, tags && `${tags} <marquee>`].filter(Boolean).join('; ') : 'no infinite horizontal animation' };
  }

  /* --- centred text ----------------------------------------------------- */
  {
    const t = T['centred-share'];
    const blocks = new Set();
    const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = tw.nextNode(); n && blocks.size < 800; n = tw.nextNode()) {
      if (n.nodeValue.trim().length < 2) continue;
      let el = n.parentElement;
      while (el && el !== document.body && cs(el).display.startsWith('inline')) el = el.parentElement;
      if (el && el !== document.body && shown(el) && !SKIP.has(el.tagName)) blocks.add(el);
    }
    const axis = W / 2, tol = t.tolerance * W;
    let centred = 0, total = 0;
    const range = document.createRange();
    for (const el of blocks) {
      range.selectNodeContents(el);
      const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
      if (!rects.length) continue;
      total++;
      const lines = new Map();
      for (const r of rects) {
        const key = Math.round((r.top + r.bottom) / 2 / 4);
        const l = lines.get(key);
        lines.set(key, l ? [Math.min(l[0], r.left), Math.max(l[1], r.right)] : [r.left, r.right]);
      }
      const onAxis = [...lines.values()].every(([l, r]) => Math.abs((l + r) / 2 - axis) <= tol);
      const box = el.getBoundingClientRect();
      const union = Math.max(...rects.map((r) => r.right)) - Math.min(...rects.map((r) => r.left));
      const align = cs(el).textAlign;
      if (onAxis && (/center/.test(align) || box.width <= union + 2)) centred++;
    }
    const share = total ? centred / total : 0;
    out['centred-share'] = { fired: total >= t.min_blocks && share >= t.share_min, value: r3(share),
      evidence: `${centred} of ${total} text blocks centred on the axis (${Math.round(share * 100)}%)` };
  }

  /* --- the section order ------------------------------------------------ */
  {
    const t = T['section-waterfall'];
    const blocks = [];
    const collect = (parent) => {
      for (const el of parent.children) {
        if (SKIP.has(el.tagName)) continue;
        if (el.tagName === 'MAIN') { collect(el); continue; }
        blocks.push(el);
      }
    };
    collect(document.body);
    const seq = [];
    for (const el of blocks) {
      const toks = new Set(['tag:' + el.tagName.toLowerCase()]);
      for (const d of [el, ...el.querySelectorAll('[class],[id]')]) {
        for (const c of d.classList) toks.add('.' + c);
        if (d.id) toks.add('#' + d.id);
      }
      let best = null, bs = 0;
      for (const [id, sig] of Object.entries(signatures)) {
        let hit = 0, tot = 0;
        for (const [tk, w] of Object.entries(sig)) { tot += w; if (toks.has(tk)) hit += w; }
        const sc = tot ? hit / tot : 0;
        if (sc > bs) { bs = sc; best = id; }
      }
      if (bs >= t.min_match) { if (seq[seq.length - 1] !== best) seq.push(best); continue; }
      const s = cs(el), r = el.getBoundingClientRect();
      if (s.display === 'none' || !r.width || !r.height || s.position === 'fixed' || s.position === 'absolute' || el.getAttribute('aria-hidden') === 'true') continue;
      seq.push('?');
    }
    const fired = seq.join(',') === defaultSections.join(',');
    out['section-waterfall'] = { fired, value: seq, evidence: (fired ? 'the scaffold default order: ' : 'sections run ') + (seq.join(', ') || 'none recognised') };
  }

  /* --- display tracking ------------------------------------------------- */
  {
    const t = T['display-tracking'];
    let min = 0, negative = 0, crushed = 0, at = '';
    for (const el of textEls) {
      const s = cs(el), px = parseFloat(s.fontSize) || 0;
      if (px < t.min_px) continue;
      const em = (s.letterSpacing === 'normal' ? 0 : parseFloat(s.letterSpacing) || 0) / px;
      if (em < 0) negative++;
      if (em <= t.fire_at_em) crushed++;
      if (em < min) { min = em; at = ownText(el); }
    }
    out['display-tracking'] = { fired: crushed > 0, value: { minEm: r3(min), negative, crushed },
      evidence: negative ? `tightest ${r3(min)}em on "${clip(at, 28)}"; ${negative} display run(s) negative, ${crushed} at ${t.fire_at_em}em or tighter` : 'no negative tracking on display text' };
  }
  return out;
}

/* ------------------------------------------------------------ the runner -- */
async function evaluate(session, fn, arg) {
  const r = await session.send('Runtime.evaluate', {
    expression: '(' + fn.toString() + ')(' + JSON.stringify(arg) + ')', returnByValue: true, awaitPromise: true,
  });
  if (r.exceptionDetails) throw new Error('tells probe failed in the page: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text));
  return r.result.value;
}

/* Fails, in the browser, every request that is not to the page's own origin
   (or data:, blob:, about:). Returns the hosts it turned away. */
function sameOriginOnly(session, origin) {
  const blocked = new Set();
  const onMessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    if (msg.method !== 'Fetch.requestPaused') return;
    const { requestId, request } = msg.params;
    let ok = /^(data|blob|about):/i.test(request.url);
    try { if (!ok) ok = new URL(request.url).origin === origin; } catch {}
    if (ok) session.send('Fetch.continueRequest', { requestId }).catch(() => {});
    else {
      try { blocked.add(new URL(request.url).host); } catch { blocked.add(request.url.slice(0, 60)); }
      session.send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }).catch(() => {});
    }
  };
  session.ws.addEventListener('message', onMessage);
  return blocked;
}

/* One page on an open session, at each width. Returns the per-width raw
   features and the hosts turned away. */
export async function tellsOnSession(session, url, { widths = [1440, 390], wait = 600, cfg = tellsConfig(), signatures = sectionSignatures() } = {}) {
  const arg = { cfg, slopFonts: SLOP_FONTS, signatures, defaultSections: DEFAULT_SECTIONS };
  const byWidth = {};
  for (const width of widths) {
    await session.send('Emulation.setDeviceMetricsOverride', { width, height: width < 700 ? 844 : 900, deviceScaleFactor: 1, mobile: width < 700 });
    session.events.length = 0;
    const nav = await session.send('Page.navigate', { url });
    if (nav.errorText) throw new Error('Navigation failed: ' + nav.errorText);
    if (!await session.waitForEvent('Page.loadEventFired', 20000)) throw new Error('Page load timed out.');
    await new Promise((r) => setTimeout(r, wait));
    byWidth[width] = await evaluate(session, pageProbe, arg);
  }
  return byWidth;
}

// Per width in, one feature list out: fired at any width, the value at each.
export function combine(byWidth, widths) {
  return FEATURE_IDS.map((id) => {
    const at = widths.filter((w) => byWidth[w] && byWidth[w][id]);
    const firedAt = at.filter((w) => byWidth[w][id].fired);
    const shown = firedAt[0] ?? at[0];
    return {
      id,
      fired: firedAt.length > 0,
      value: Object.fromEntries(at.map((w) => [w, byWidth[w][id].value])),
      evidence: shown == null ? '' : `${shown}px: ${byWidth[shown][id].evidence}`,
      firedAt,
    };
  });
}

export async function runTells(target, { widths = [1440, 390], wait = 600 } = {}) {
  if (typeof WebSocket === 'undefined') throw new Error('The rendered tells need Node 22 or newer (a global WebSocket).');
  const bin = findBrowser();
  if (!bin) { const err = new Error('no Chrome, Edge or Chromium found (set ATELIER_BROWSER to the executable).'); err.code = 'no-browser'; throw err; }
  const t0 = Date.now();
  let url = target, server = null;
  if (!/^https?:\/\//i.test(target)) {
    const given = resolve(target);
    if (!existsSync(given)) throw new Error('no such path: ' + given);
    const isFile = statSync(given).isFile();
    server = startServer(isFile ? dirname(given) : given, 0);
    await once(server, 'listening');
    url = `http://127.0.0.1:${server.address().port}/${isFile ? encodeURIComponent(basename(given)) : ''}`;
  }
  const { proc, udd, port } = await launch(bin);
  let session;
  try {
    session = await Session.open(port);
    await session.send('Page.enable');
    await session.send('Runtime.enable');
    const blocked = sameOriginOnly(session, new URL(url).origin);
    await session.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
    const byWidth = await tellsOnSession(session, url, { widths, wait });
    return {
      schema: TELLS_SCHEMA, target, url, widths, ufsSha: ufsSha(), ufsVersion: ufsVersion(),
      blocked: [...blocked].sort(), ms: Date.now() - t0, features: combine(byWidth, widths),
    };
  } finally {
    if (session) session.close();
    await closeBrowser({ proc, udd, port });
    if (server) server.close();
  }
}

export function formatTells(r) {
  const fired = r.features.filter((f) => f.fired);
  const lines = [`\nwebdesign tells  ${r.target}  (${r.widths.join(', ')})`, ''];
  for (const f of r.features) lines.push(`  ${f.fired ? 'FIRED' : '  -  '}  ${f.id.padEnd(21)} ${f.evidence}`);
  lines.push('', `  ${fired.length} of ${r.features.length} fired${r.blocked.length ? '; other origins not fetched: ' + r.blocked.join(', ') : ''}.`);
  lines.push('  A vector, not a verdict: data/tells-render.json has why each threshold sits where it does. references/tells.md says what to do instead.');
  return lines.join('\n');
}
