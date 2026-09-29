/* image-deep-research/sheet - tile pictures into one contact sheet.

   The browser does the tiling: a small HTML page lays the images out on a
   4 x 2 grid, each cell numbered, and the page is screenshotted. No ffmpeg,
   no image codec, and it works the same for local screenshots and for remote
   image URLs (a moodboard). One sheet costs one image read instead of eight.

   --compact draws a denser sheet, sized for what a Claude model pays: 16
   tiles with a number badge and no caption row, 1288 x 812 px, which is
   46 x 29 patches of 28 px, 1,334 image tokens, under every model's cap. */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, relative, isAbsolute, dirname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { load, screenshot } from './browser.mjs';

export const PER_SHEET = 8;
export const COLS = 4;
export const CELL_W = 640;
export const CELL_H = 400;

/* The compact geometry: 4 x 4 cells of 317 x 198 with a 4 px gap and pad. */
export const COMPACT = { cols: 4, perSheet: 16, cellW: 317, cellH: 198, gap: 4, pad: 4 };
export const COMPACT_MAX_BYTES = 150000;
export const COMPACT_QUALITIES = [80, 70, 60];

/* What an image costs a Claude model, as Anthropic's vision docs price it
   (platform.claude.com/docs/en/build-with-claude/vision, read 2026-09-29):
   ceil(w/28) x ceil(h/28) tokens, after the image is scaled down, keeping its
   aspect ratio, to the largest size that fits both the tier's long edge and
   its token cap. The high tier (Claude 4.7 and later) allows a 2576 px long
   edge and 4,784 tokens; the standard tier 1568 px and 1,568 tokens. */
export const PATCH = 28;
export const TIERS = { high: { edge: 2576, cap: 4784 }, standard: { edge: 1568, cap: 1568 } };

export function visionTokens(w, h, { tier = 'high' } = {}) {
  const t = TIERS[tier];
  if (!t) throw new Error(`unknown tier "${tier}"`);
  const cost = (W, H) => Math.ceil(W / PATCH) * Math.ceil(H / PATCH);
  const long = Math.max(w, h);
  const at = (edge) => {
    const s = edge / long;
    return [Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))];
  };
  let edge = Math.min(long, t.edge);
  if (cost(...at(edge)) > t.cap) {
    // The cost only grows with the long edge, so the largest edge that fits
    // the cap is found by halving the interval.
    let lo = 1, hi = edge;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (cost(...at(mid)) <= t.cap) lo = mid; else hi = mid - 1;
    }
    edge = lo;
  }
  return cost(...at(edge));
}

/* The pixel size of a sheet of count tiles in a badge-only geometry. */
export function sheetSize(count, geom = COMPACT) {
  const cols = Math.max(1, Math.min(geom.cols, count));
  const rows = Math.max(1, Math.ceil(count / geom.cols));
  const w = 2 * geom.pad + cols * geom.cellW + (cols - 1) * geom.gap;
  const h = 2 * geom.pad + rows * geom.cellH + (rows - 1) * geom.gap;
  return { w, h, tokens: visionTokens(w, h) };
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* Splits items into sheets of PER_SHEET, numbering every tile across the run
   so "tile 11" means the same thing in the sheet and in the printed legend.
   An item that already carries its number keeps it: images.mjs numbers the
   verified results, and a failed one before them must not shift the tiles. */
export function planSheets(items, per = PER_SHEET) {
  const sheets = [];
  items.forEach((item, i) => {
    const s = Math.floor(i / per);
    (sheets[s] ||= []).push({ ...item, n: item.n ?? i + 1 });
  });
  return sheets;
}

/* The HTML for one sheet. src is a URL, or a local path that is written
   relative to the sheet so the page can load it from disk. */
export function sheetHtml(tiles, { baseDir, fit = 'cover', title = '', compact = false } = {}) {
  const src = (s) => {
    if (/^(https?|data):/i.test(s)) return s;
    const p = isAbsolute(s) ? s : resolve(s);
    return relative(baseDir, p).split(sep).map(encodeURIComponent).join('/');
  };
  if (compact) return compactHtml(tiles, { src, fit, title });
  const cells = tiles.map((t) => `<figure><img src="${esc(src(t.src))}" alt="" referrerpolicy="no-referrer"><figcaption>${String(t.n).padStart(2, '0')}  ${esc(t.label || '')}</figcaption></figure>`).join('\n');
  return `<!doctype html><meta charset="utf-8"><title>${esc(title)}</title>
<style>
html,body{margin:0;background:#111}
main{display:grid;grid-template-columns:repeat(${Math.max(1, Math.min(COLS, tiles.length))},${CELL_W}px);gap:6px;padding:6px;width:max-content}
figure{margin:0;background:#1b1b1b}
img{display:block;width:${CELL_W}px;height:${CELL_H}px;object-fit:${fit === 'contain' ? 'contain' : 'cover'};object-position:${fit === 'contain' ? 'center' : 'top center'}}
figcaption{font:13px/1.2 ui-monospace,Consolas,monospace;color:#ddd;padding:4px 6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;width:${CELL_W - 12}px}
</style>
<main>
${cells}
</main>`;
}

/* The compact sheet: no caption row, only the tile's number on a dark badge
   in its top-left corner (or the tile's own badge text, such as s03 for a
   site). Every other fact about a tile goes out as text. */
function compactHtml(tiles, { src, fit, title }) {
  const g = COMPACT;
  const cells = tiles.map((t) => `<figure><img src="${esc(src(t.src))}" alt="" referrerpolicy="no-referrer"><span>${esc(t.badge ?? String(t.n).padStart(2, '0'))}</span></figure>`).join('\n');
  return `<!doctype html><meta charset="utf-8"><title>${esc(title)}</title>
<style>
html,body{margin:0;background:#111}
main{display:grid;grid-template-columns:repeat(${Math.max(1, Math.min(g.cols, tiles.length))},${g.cellW}px);gap:${g.gap}px;padding:${g.pad}px;width:max-content}
figure{margin:0;position:relative;background:#1b1b1b;width:${g.cellW}px;height:${g.cellH}px}
img{display:block;width:${g.cellW}px;height:${g.cellH}px;object-fit:${fit === 'contain' ? 'contain' : 'cover'};object-position:${fit === 'contain' ? 'center' : 'top center'}}
span{position:absolute;top:0;left:0;font:12px/1 ui-monospace,Consolas,monospace;color:#fff;background:rgba(0,0,0,.7);padding:2px 4px}
</style>
<main>
${cells}
</main>`;
}

/* Takes a picture at each quality in turn until one is at most maxBytes, so a
   busy sheet still fits a Read without a silent downscale. shoot(quality)
   returns the JPEG bytes. The last quality is kept even when it is over. */
export async function underBytes(shoot, { maxBytes = COMPACT_MAX_BYTES, qualities = COMPACT_QUALITIES } = {}) {
  let buf, quality;
  for (quality of qualities) {
    buf = await shoot(quality);
    if (buf.length <= maxBytes) break;
  }
  return { buf, quality };
}

/* Renders every sheet with an open browser session. Returns
   [{ file, tiles: [{n, label, src, loaded}] }]. A tile whose image failed to
   load is reported as loaded:false rather than silently left grey. With
   compact, sixteen to a sheet in the compact geometry, and each sheet also
   reports { w, h, bytes, quality, tokens }. */
export async function renderSheets(session, items, { out, prefix = 'sheet', fit = 'cover', per, compact = false } = {}) {
  mkdirSync(out, { recursive: true });
  per ??= compact ? COMPACT.perSheet : PER_SHEET;
  const results = [];
  for (const [i, tiles] of planSheets(items, per).entries()) {
    const html = join(out, `_${prefix}${i + 1}.html`);
    writeFileSync(html, sheetHtml(tiles, { baseDir: dirname(html), fit, title: `${prefix} ${i + 1}`, compact }));
    const width = compact ? sheetSize(COMPACT.cols, COMPACT).w : COLS * (CELL_W + 6) + 6;
    await load(session, pathToFileURL(html).href, { width, height: 900, wait: 200 });
    const state = await session.evaluate(`Promise.all([...document.images].map((im) =>
      im.complete ? 0 : new Promise((r) => { im.onload = im.onerror = r; setTimeout(r, 15000); })))
      .then(() => { const m = document.querySelector('main').getBoundingClientRect();
        return { w: Math.ceil(m.width), h: Math.ceil(m.height), ok: [...document.images].map((im) => im.naturalWidth > 0) }; })`, { awaitPromise: true });
    const file = join(out, `${prefix}${i + 1}.jpg`);
    const clip = { x: 0, y: 0, width: state.w, height: state.h };
    const shown = tiles.map((t, k) => ({ n: t.n, label: t.label, src: t.src, loaded: !!state.ok[k] }));
    if (!compact) {
      writeFileSync(file, await screenshot(session, { format: 'jpeg', quality: 84, clip }));
      results.push({ file, tiles: shown });
      continue;
    }
    const { buf, quality } = await underBytes((q) => screenshot(session, { format: 'jpeg', quality: q, clip }));
    writeFileSync(file, buf);
    results.push({ file, w: state.w, h: state.h, bytes: buf.length, quality, tokens: visionTokens(state.w, state.h), tiles: shown });
  }
  return results;
}
