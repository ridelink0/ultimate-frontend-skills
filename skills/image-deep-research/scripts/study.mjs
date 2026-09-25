#!/usr/bin/env node
/* image-deep-research/study - render real websites and read them as pictures.

   node study.mjs <url> <url> ...            render these
   node study.mjs --list editorial           a curated set (editorial, object, cinema, product)
     --out <dir>        where the renders go (default: a temp folder, printed)
     --scroll 0,900     scroll positions to capture, in px (default 0,900)
     --width 1440       viewport width (default 1440; 390 for a phone read)
     --wait 3500        ms to let the page settle after load (default 3500)
     --json             print the full report as JSON instead of text

   Each site is loaded in a headless browser, screenshotted at each scroll
   position, and measured: the ground colours by painted area, the text
   colours by amount of text, and the heading and body typefaces as computed.
   Then every screenshot is tiled into contact sheets, eight to a sheet.

   A page that renders almost no text is reported as a wall (a bot challenge,
   a login, or a WebGL preloader) and kept out of the sheets, because it is
   not a reference. Nothing is guessed about what is behind it. */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseArgs, int } from './args.mjs';
import { withBrowser, load, screenshot, sleep } from './browser.mjs';
import { renderSheets } from './sheet.mjs';

/* The four registers Ultimate Frontend Skills ships as study lists. Sites that
   answered a headless browser with a challenge or Access Denied when every list
   was rendered on 2026-09-25 (aesop.com, cartier.com, rolex.com, nytimes.com)
   are left out: a list entry that is always a wall is not a reference. */
export const LISTS = {
  editorial: ['https://www.are.na', 'https://readymag.com', 'https://www.kinfolk.com', 'https://www.hodinkee.com',
    'https://www.anthropic.com/research', 'https://www.itsnicethat.com', 'https://www.monocle.com', 'https://www.apartamentomagazine.com'],
  object: ['https://www.apple.com/airpods-pro/', 'https://www.apple.com/watch/', 'https://www.apple.com/iphone/', 'https://www.teenage.engineering',
    'https://www.leica-camera.com', 'https://www.bang-olufsen.com', 'https://www.dyson.com', 'https://nothing.tech'],
  cinema: ['https://lusion.co', 'https://rauno.me', 'https://www.awwwards.com/websites/parallax/', 'https://tympanus.net/codrops/',
    'https://www.nationalgeographic.com', 'https://www.patagonia.com', 'https://www.rapha.cc', 'https://www.arcteryx.com'],
  product: ['https://linear.app', 'https://stripe.com', 'https://vercel.com', 'https://resend.com',
    'https://www.framer.com', 'https://arc.net', 'https://www.raycast.com', 'https://cursor.com'],
};

/* Is this render a reference, or something standing in front of one?
   A count of text elements alone was wrong both ways when measured on the
   curated lists (2026-09-25): rauno.me, a real and deliberately sparse page,
   has 8, while Aesop's "Just a moment..." challenge has 8 as well. So the
   signatures of a challenge or a block decide first, and only a page with
   next to nothing on it (a preloader, a blank WebGL shell) is judged empty.
   Returns { status: 'ok' | 'wall', reason }. */
const BLOCK_TITLE = /just a moment|access denied|attention required|are you a robot|captcha|verify (you are|that you are) human|security check|request blocked|403 forbidden|pardon our interruption/i;
const BLOCK_TEXT = /verify you are human|you have been blocked|suspect that you('|’)?re a robot|enable javascript and cookies to continue|checking (if the site connection is secure|your browser)|access to this page has been denied|press (&|and) hold/i;
const BLOCK_FRAME = /challenges\.cloudflare\.com|captcha-delivery\.com|hcaptcha\.com|google\.com\/recaptcha|perimeterx|px-captcha|geo\.captcha/i;
export const EMPTY_TEXT_ELEMENTS = 3;

export function classify(p) {
  if (BLOCK_TITLE.test(p.title || '')) return { status: 'wall', reason: `blocked: the page title is "${p.title}"` };
  if (BLOCK_TEXT.test(p.text || '')) return { status: 'wall', reason: 'blocked: the page shows a bot or access challenge' };
  const frame = (p.frames || []).find((f) => BLOCK_FRAME.test(f));
  if (frame && p.textElements < 20) return { status: 'wall', reason: 'blocked: a challenge frame from ' + new URL(frame, 'https://x').host };
  if (p.textElements < EMPTY_TEXT_ELEMENTS && !p.images && !p.canvases)
    return { status: 'wall', reason: `almost nothing rendered (${p.textElements} text elements, no images): a preloader or a script-only page that had not started` };
  return { status: 'ok' };
}

/* Runs in the page. Colours go through a 1x1 canvas so oklch(), color-mix()
   and every other CSS Color 4 form come back as plain hex. */
export const PROBE = `(() => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 1;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  const memo = new Map();
  const hex = (str) => {
    if (!str || str === 'transparent') return null;
    if (memo.has(str)) return memo.get(str);
    let out = null;
    try {
      cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = str; cx.fillRect(0, 0, 1, 1);
      const d = cx.getImageData(0, 0, 1, 1).data;
      out = d[3] < 200 ? null : '#' + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('');
    } catch {}
    memo.set(str, out);
    return out;
  };
  const W = innerWidth, H = Math.max(innerHeight, document.documentElement.scrollHeight);
  const grounds = new Map(), inks = new Map();
  const add = (m, k, v) => { if (k) m.set(k, (m.get(k) || 0) + v); };
  let textElements = 0;
  const all = document.querySelectorAll('body, body *');
  for (let i = 0; i < all.length && i < 6000; i++) {
    const el = all[i];
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) continue;
    const r = el.getBoundingClientRect();
    const w = Math.max(0, Math.min(r.right, W) - Math.max(r.left, 0));
    const h = Math.max(0, Math.min(r.bottom + scrollY, H) - Math.max(r.top + scrollY, 0));
    if (!w || !h) continue;
    add(grounds, hex(cs.backgroundColor), w * h);
    let own = 0;
    for (const n of el.childNodes) if (n.nodeType === 3) own += n.textContent.trim().length;
    if (own) { textElements++; add(inks, hex(cs.color), own); }
  }
  const htmlBg = hex(getComputedStyle(document.documentElement).backgroundColor);
  const bodyBg = hex(getComputedStyle(document.body).backgroundColor);
  if (!grounds.size) add(grounds, bodyBg || htmlBg || '#ffffff', W * H);
  const top = (m, n) => { const t = [...m.values()].reduce((a, b) => a + b, 0) || 1;
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([c, v]) => ({ color: c, share: Math.round(v / t * 1000) / 10 })); };
  const face = (sel) => { const el = document.querySelector(sel); if (!el) return null;
    const cs = getComputedStyle(el);
    return { selector: sel, family: cs.fontFamily, size: cs.fontSize, weight: cs.fontWeight, lineHeight: cs.lineHeight, letterSpacing: cs.letterSpacing,
      text: (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 80) }; };
  return JSON.stringify({
    title: document.title, textElements, height: document.documentElement.scrollHeight,
    grounds: top(grounds, 6), inks: top(inks, 4),
    type: { heading: face('h1') || face('h2'), body: face('main p') || face('p') },
    canvases: document.querySelectorAll('canvas').length,
    images: [...document.images].filter((im) => { const r = im.getBoundingClientRect(); return im.naturalWidth > 0 && r.width >= 120 && r.height >= 80; }).length,
    frames: [...document.querySelectorAll('iframe')].map((f) => f.src).filter(Boolean).slice(0, 10),
    text: (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 1500),
  });
})()`;

export const slugFor = (i) => 's' + String(i + 1).padStart(2, '0');

export async function study(urls, { out, scrolls = [0, 900], width = 1440, wait = 3500, log = () => {} } = {}) {
  mkdirSync(out, { recursive: true });
  return withBrowser(async (session) => {
    const sites = [];
    for (const [i, url] of urls.entries()) {
      const dir = join(out, slugFor(i));
      const site = { url, dir, shots: [], status: 'ok' };
      try {
        mkdirSync(dir, { recursive: true });
        const { loaded } = await load(session, url, { width, height: 900, wait });
        if (!loaded) site.note = 'the load event never fired; captured what had rendered after 30 s';
        site.probe = JSON.parse(await session.evaluate(PROBE));
        const verdict = classify(site.probe);
        if (verdict.status === 'wall') {
          site.status = 'wall';
          site.note = `${verdict.reason}; left out of the sheet, see ${join(dir, 'top.png')}`;
        }
        for (const y of scrolls) {
          await session.evaluate(`window.scrollTo({ top: ${y}, behavior: 'instant' }); window.dispatchEvent(new Event('scroll')); 1`);
          await sleep(y ? 800 : 100);
          const actual = await session.evaluate('Math.round(scrollY)');
          const file = join(dir, y ? `y${y}.png` : 'top.png');
          writeFileSync(file, await screenshot(session));
          site.shots.push({ file, scroll: y, reached: actual });
        }
      } catch (e) {
        site.status = 'failed';
        site.note = (e && e.message) || String(e);
      }
      log(site);
      sites.push(site);
    }
    const tiles = sites.filter((s) => s.status === 'ok')
      .flatMap((s) => s.shots.map((sh) => ({ src: sh.file, label: `${slugFor(sites.indexOf(s))} ${sh.scroll ? 'y' + sh.scroll : 'top'}  ${s.url.replace(/^https?:\/\/(www\.)?/, '')}` })));
    const sheets = tiles.length ? await renderSheets(session, tiles, { out, prefix: 'sheet', fit: 'cover' }) : [];
    const report = { out, width, scrolls, sites, sheets };
    writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
    return report;
  });
}

export function formatSite(s) {
  const lines = [`  ${s.status.padEnd(6)} ${s.url}${s.note ? '  (' + s.note + ')' : ''}`];
  const p = s.probe;
  if (p && s.status === 'ok') {
    lines.push(`         grounds  ${p.grounds.map((g) => `${g.color} ${g.share}%`).join('  ')}`);
    lines.push(`         ink      ${p.inks.map((g) => `${g.color} ${g.share}%`).join('  ')}`);
    const f = (t) => t ? `${t.family.split(',')[0].replace(/["']/g, '')} ${t.size}/${t.lineHeight} w${t.weight}` : 'none';
    lines.push(`         type     heading ${f(p.type.heading)}   body ${f(p.type.body)}`);
    if (p.canvases) lines.push(`         canvas   ${p.canvases} (WebGL or 2D; a screenshot may show a preloader frame)`);
  }
  return lines.join('\n');
}

async function main() {
  let a;
  try { a = parseArgs(process.argv.slice(2), { switches: ['json'] }); } catch (e) { console.error('study: ' + e.message); process.exit(2); }
  const { positional, flags } = a;
  let urls = positional.filter((u) => /^https?:\/\//i.test(u));
  const bad = positional.filter((u) => !/^https?:\/\//i.test(u));
  if (bad.length) { console.error('study: not a URL: ' + bad.join(' ') + '  (URLs start with http:// or https://)'); process.exit(2); }
  if (flags.list) {
    const l = LISTS[flags.list];
    if (!l) { console.error(`study: unknown list "${flags.list}". Lists: ${Object.keys(LISTS).join(', ')}`); process.exit(2); }
    urls = urls.concat(l);
  }
  if (!urls.length) {
    console.error('usage: node study.mjs <url> ... | --list ' + Object.keys(LISTS).join('|') + ' [--out dir] [--scroll 0,900] [--width 1440] [--wait 3500] [--json]');
    process.exit(2);
  }
  let scrolls, width, wait;
  try {
    scrolls = String(flags.scroll ?? '0,900').split(',').map((s) => int(s.trim(), 0, { min: 0, max: 100000 }));
    width = int(flags.width, 1440, { min: 320, max: 3840 });
    wait = int(flags.wait, 3500, { min: 0, max: 30000 });
  } catch (e) { console.error('study: ' + e.message); process.exit(2); }
  const out = resolve(flags.out || join(tmpdir(), 'image-deep-research', 'study-' + new Date().toISOString().replace(/[:.]/g, '-')));
  let report;
  try {
    report = await study(urls, { out, scrolls, width, wait, log: flags.json ? () => {} : (s) => console.log(formatSite(s)) });
  } catch (e) {
    console.error('study: ' + ((e && e.message) || e));
    process.exit(e && e.code === 'no-browser' ? 3 : 1);
  }
  if (flags.json) { console.log(JSON.stringify(report, null, 2)); return; }
  const ok = report.sites.filter((s) => s.status === 'ok').length;
  console.log(`\nstudy  ${urls.length} site(s), ${ok} rendered -> ${out}`);
  if (report.sheets.length) {
    console.log('  Open these contact sheets first, left to right, top to bottom:');
    for (const s of report.sheets) console.log('  ' + s.file);
  } else console.log('  nothing rendered cleanly, so there is no sheet: see the notes above');
  console.log('  Full measurements: ' + join(out, 'report.json'));
  if (!ok) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
