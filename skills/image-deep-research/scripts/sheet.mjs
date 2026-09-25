/* image-deep-research/sheet - tile pictures into one contact sheet.

   The browser does the tiling: a small HTML page lays the images out on a
   4 x 2 grid, each cell numbered, and the page is screenshotted. No ffmpeg,
   no image codec, and it works the same for local screenshots and for remote
   image URLs (a moodboard). One sheet costs one image read instead of eight. */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, relative, isAbsolute, dirname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { load, screenshot } from './browser.mjs';

export const PER_SHEET = 8;
export const COLS = 4;
export const CELL_W = 640;
export const CELL_H = 400;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* Splits items into sheets of PER_SHEET, numbering every tile across the run
   so "tile 11" means the same thing in the sheet and in the printed legend. */
export function planSheets(items, per = PER_SHEET) {
  const sheets = [];
  items.forEach((item, i) => {
    const s = Math.floor(i / per);
    (sheets[s] ||= []).push({ ...item, n: i + 1 });
  });
  return sheets;
}

/* The HTML for one sheet. src is a URL, or a local path that is written
   relative to the sheet so the page can load it from disk. */
export function sheetHtml(tiles, { baseDir, fit = 'cover', title = '' } = {}) {
  const src = (s) => {
    if (/^(https?|data):/i.test(s)) return s;
    const p = isAbsolute(s) ? s : resolve(s);
    return relative(baseDir, p).split(sep).map(encodeURIComponent).join('/');
  };
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

/* Renders every sheet with an open browser session. Returns
   [{ file, tiles: [{n, label, src, loaded}] }]. A tile whose image failed to
   load is reported as loaded:false rather than silently left grey. */
export async function renderSheets(session, items, { out, prefix = 'sheet', fit = 'cover', per = PER_SHEET } = {}) {
  mkdirSync(out, { recursive: true });
  const results = [];
  for (const [i, tiles] of planSheets(items, per).entries()) {
    const html = join(out, `_${prefix}${i + 1}.html`);
    writeFileSync(html, sheetHtml(tiles, { baseDir: dirname(html), fit, title: `${prefix} ${i + 1}` }));
    await load(session, pathToFileURL(html).href, { width: COLS * (CELL_W + 6) + 6, height: 900, wait: 200 });
    const state = await session.evaluate(`Promise.all([...document.images].map((im) =>
      im.complete ? 0 : new Promise((r) => { im.onload = im.onerror = r; setTimeout(r, 15000); })))
      .then(() => { const m = document.querySelector('main').getBoundingClientRect();
        return { w: Math.ceil(m.width), h: Math.ceil(m.height), ok: [...document.images].map((im) => im.naturalWidth > 0) }; })`, { awaitPromise: true });
    const file = join(out, `${prefix}${i + 1}.jpg`);
    writeFileSync(file, await screenshot(session, { format: 'jpeg', quality: 84, clip: { x: 0, y: 0, width: state.w, height: state.h } }));
    results.push({ file, tiles: tiles.map((t, k) => ({ n: t.n, label: t.label, src: t.src, loaded: !!state.ok[k] })) });
  }
  return results;
}
