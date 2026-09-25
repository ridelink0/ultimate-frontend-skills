#!/usr/bin/env node
/* image-deep-research/images - search open image collections, check every
   result is really an image, and keep the licence beside it.

   node images.mjs "<query>" [--sources openverse,commons,aic,met] [--n 6]
     --commercial      keep only licences that allow commercial use and changes
                       (drops NC and ND; CC0, public domain, BY and BY-SA stay)
     --out <dir>       where results.json, the moodboard and downloads go
     --sheet           tile the verified images into a moodboard contact sheet
                       (needs Chrome, Edge or Chromium)
     --download        save each verified image into <out>/images
     --json            print the results as JSON instead of a table

   No keys. Openverse (about 800M CC and public-domain images), Wikimedia
   Commons, the Art Institute of Chicago (public-domain works only) and the
   Metropolitan Museum of Art (Open Access works only). Every URL is fetched
   before it is reported: a result whose URL does not answer with an image is
   listed as unverified and never put on the moodboard. */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseArgs, int } from './args.mjs';

/* The Art Institute of Chicago's image server answers 403 to any user agent
   that carries a URL (measured 2026-09-25: "image-deep-research/1.0" gets the
   image, the same string plus "(https://github.com/...)" gets 403), while
   Wikimedia asks for contact details in it. So the contact goes to Wikimedia
   only, and to the AIC in the header its API documents for that purpose. */
export const UA = 'image-deep-research/1.0';
export const UA_CONTACT = 'image-deep-research/1.0 (https://github.com/ridelink0/image-deep-research)';
export const SOURCES = ['openverse', 'commons', 'aic', 'met'];

// Commons wraps QuickStatements hints in hidden spans (title QS:P1476,...); they are not the title.
const strip = (html) => String(html || '').replace(/<(span|div)[^>]*display:\s*none[^>]*>[\s\S]*?<\/\1>/gi, '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/\s+/g, ' ').trim();

/* True when a licence allows commercial use and modification. */
export function commercialOk(licence) {
  const l = String(licence || '').toLowerCase();
  if (!l) return false;
  if (/\b(nc|nd)\b|noncommercial|non-commercial|noderiv|no-deriv/.test(l)) return false;
  return /cc0|public domain|pdm|^pd\b|cc[ -]by|^by\b|^by-sa\b/.test(l);
}

export function parseOpenverse(json) {
  return (json.results || []).map((r) => ({
    source: 'openverse',
    title: r.title || '',
    creator: r.creator || '',
    licence: r.license ? (['cc0', 'pdm'].includes(r.license) ? r.license.toUpperCase() : `CC ${r.license.toUpperCase()} ${r.license_version || ''}`.trim()) : '',
    licenceUrl: r.license_url || '',
    url: r.url,
    page: r.foreign_landing_url || '',
    width: r.width || null,
    height: r.height || null,
    via: r.provider || r.source || '',
  })).filter((r) => r.url);
}

export function parseCommons(json) {
  const pages = Object.values((json.query && json.query.pages) || {}).sort((a, b) => (a.index || 0) - (b.index || 0));
  return pages.map((p) => {
    const ii = (p.imageinfo || [])[0] || {};
    const md = ii.extmetadata || {};
    return {
      source: 'commons',
      title: strip(md.ObjectName && md.ObjectName.value) || String(p.title || '').replace(/^File:/, ''),
      creator: strip(md.Artist && md.Artist.value),
      licence: strip(md.LicenseShortName && md.LicenseShortName.value),
      licenceUrl: (md.LicenseUrl && md.LicenseUrl.value) || '',
      url: ii.thumburl || ii.url,
      original: ii.url || '',
      page: ii.descriptionurl || '',
      width: ii.width || null,
      height: ii.height || null,
      mime: ii.mime || '',
    };
  }).filter((r) => r.url && /^image\/(jpeg|png|webp|gif)/.test(r.mime || 'image/jpeg'));
}

export function parseAic(json) {
  const base = (json.config && json.config.iiif_url) || 'https://www.artic.edu/iiif/2';
  return (json.data || []).filter((d) => d.image_id && d.is_public_domain).map((d) => ({
    source: 'aic',
    title: d.title || '',
    creator: String(d.artist_display || '').split('\n')[0],
    licence: 'CC0 (public domain)',
    licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    url: `${base}/${d.image_id}/full/843,/0/default.jpg`,
    page: `https://www.artic.edu/artworks/${d.id}`,
    width: (d.thumbnail && d.thumbnail.width) || null,
    height: (d.thumbnail && d.thumbnail.height) || null,
  }));
}

export function parseMetObject(o) {
  if (!o || !o.isPublicDomain || !o.primaryImageSmall) return null;
  return {
    source: 'met',
    title: o.title || '',
    creator: o.artistDisplayName || '',
    licence: 'CC0 (Met Open Access)',
    licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    url: o.primaryImageSmall,
    original: o.primaryImage || '',
    page: o.objectURL || `https://www.metmuseum.org/art/collection/search/${o.objectID}`,
    width: null,
    height: null,
  };
}

async function getJson(url, headers = {}, ms = 20000) {
  const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json', ...headers }, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`${new URL(url).host} answered ${r.status}`);
  return r.json();
}

export const SEARCH = {
  async openverse(q, n) {
    return parseOpenverse(await getJson(`https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}&page_size=${Math.min(n * 2, 40)}&mature=false`));
  },
  async commons(q, n) {
    const u = 'https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6'
      + `&gsrsearch=${encodeURIComponent(q + ' filetype:bitmap')}&gsrlimit=${Math.min(n * 2, 40)}`
      + '&prop=imageinfo&iiprop=url|size|mime|extmetadata&iiurlwidth=1280'
      + '&iiextmetadatafilter=LicenseShortName|LicenseUrl|Artist|ObjectName';
    return parseCommons(await getJson(u, { 'user-agent': UA_CONTACT }));
  },
  async aic(q, n) {
    const u = `https://api.artic.edu/api/v1/artworks/search?q=${encodeURIComponent(q)}&limit=${Math.min(n * 3, 60)}`
      + '&fields=id,title,image_id,artist_display,is_public_domain,thumbnail';
    return parseAic(await getJson(u, { 'AIC-User-Agent': UA_CONTACT }));
  },
  async met(q, n) {
    const s = await getJson(`https://collectionapi.metmuseum.org/public/collection/v1/search?hasImages=true&q=${encodeURIComponent(q)}`);
    const out = [];
    for (const id of (s.objectIDs || []).slice(0, n * 4)) {
      if (out.length >= n * 2) break;
      try {
        const r = parseMetObject(await getJson(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`));
        if (r) out.push(r);
      } catch {}
    }
    return out;
  },
};

/* Fetches the URL the way a page would load it. HEAD first; a server that
   refuses HEAD (405, 403, 416 and friends) gets a one-byte ranged GET. The
   result counts only if the answer is 2xx and says it is an image. */
export async function verifyImage(url, { fetchImpl = fetch, ms = 15000 } = {}) {
  const tryOnce = async (method) => {
    const headers = { 'user-agent': UA };
    if (method === 'GET') headers.range = 'bytes=0-0';
    const r = await fetchImpl(url, { method, headers, redirect: 'follow', signal: AbortSignal.timeout(ms) });
    try { if (r.body && r.body.cancel) await r.body.cancel(); } catch {}
    return { status: r.status, type: (r.headers.get('content-type') || '').split(';')[0].trim() };
  };
  let res;
  try {
    res = await tryOnce('HEAD');
    if (!(res.status >= 200 && res.status < 300 && res.type.startsWith('image/'))) res = await tryOnce('GET');
  } catch (e) {
    try { res = await tryOnce('GET'); } catch (e2) { return { ok: false, status: 0, type: '', error: (e2 && e2.message) || String(e2) }; }
  }
  return { ok: res.status >= 200 && res.status < 300 && res.type.startsWith('image/'), ...res };
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

export async function searchImages(q, { sources = SOURCES, n = 6, commercial = false, verify = verifyImage } = {}) {
  const errors = [];
  const per = await Promise.all(sources.map(async (s) => {
    try {
      let rows = await SEARCH[s](q, n);
      if (commercial) rows = rows.filter((r) => commercialOk(r.licence));
      return rows.slice(0, n);
    } catch (e) { errors.push({ source: s, error: (e && e.message) || String(e) }); return []; }
  }));
  const results = per.flat();
  await mapLimit(results, 6, async (r) => { r.verified = await verify(r.url); });
  return { query: q, sources, commercial, results, errors };
}

function table(res) {
  const lines = [];
  lines.push(`images  "${res.query}"  ${res.results.filter((r) => r.verified.ok).length} verified of ${res.results.length}`);
  for (const e of res.errors) lines.push(`  source ${e.source} failed: ${e.error}`);
  res.results.forEach((r, i) => {
    const mark = r.verified.ok ? 'ok  ' : `FAIL ${r.verified.status || ''}`.padEnd(8);
    lines.push(`  ${String(i + 1).padStart(2, '0')} ${mark} [${r.source}] ${r.title.slice(0, 70)}${r.creator ? ' - ' + r.creator.slice(0, 40) : ''}`);
    lines.push(`       ${r.licence || 'licence not stated'}  ${r.url}`);
    if (r.page) lines.push(`       page ${r.page}`);
  });
  return lines.join('\n');
}

async function main() {
  let a;
  try { a = parseArgs(process.argv.slice(2), { switches: ['commercial', 'sheet', 'download', 'json'] }); }
  catch (e) { console.error('images: ' + e.message); process.exit(2); }
  const { positional, flags } = a;
  const q = positional.join(' ').trim();
  if (!q) { console.error('usage: node images.mjs "<query>" [--sources ' + SOURCES.join(',') + '] [--n 6] [--commercial] [--sheet] [--download] [--out dir] [--json]'); process.exit(2); }
  const sources = String(flags.sources || SOURCES.join(',')).split(',').map((s) => s.trim()).filter(Boolean);
  const unknown = sources.filter((s) => !SOURCES.includes(s));
  if (unknown.length) { console.error(`images: unknown source ${unknown.join(', ')}. Sources: ${SOURCES.join(', ')}`); process.exit(2); }
  let n;
  try { n = int(flags.n, 6, { min: 1, max: 20 }); } catch (e) { console.error('images: --n ' + e.message); process.exit(2); }
  const out = resolve(flags.out || join(tmpdir(), 'image-deep-research', 'images-' + new Date().toISOString().replace(/[:.]/g, '-')));
  mkdirSync(out, { recursive: true });

  const res = await searchImages(q, { sources, n, commercial: !!flags.commercial });
  const good = res.results.filter((r) => r.verified.ok);

  if (flags.download && good.length) {
    const dir = join(out, 'images');
    mkdirSync(dir, { recursive: true });
    await mapLimit(good, 4, async (r, i) => {
      try {
        const resp = await fetch(r.url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(30000) });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const ext = (resp.headers.get('content-type') || '').includes('png') ? 'png' : (resp.headers.get('content-type') || '').includes('webp') ? 'webp' : 'jpg';
        r.file = join(dir, `${String(i + 1).padStart(2, '0')}-${r.source}.${ext}`);
        writeFileSync(r.file, Buffer.from(await resp.arrayBuffer()));
      } catch (e) { r.downloadError = (e && e.message) || String(e); }
    });
  }

  if (flags.sheet && good.length) {
    try {
      const { withBrowser } = await import('./browser.mjs');
      const { renderSheets } = await import('./sheet.mjs');
      res.sheets = await withBrowser((session) => renderSheets(session,
        good.map((r) => ({ src: r.file || r.url, label: `[${r.source}] ${r.licence} ${r.title}` })), { out, prefix: 'moodboard', fit: 'contain' }));
    } catch (e) { res.sheetError = (e && e.message) || String(e); }
  }

  writeFileSync(join(out, 'results.json'), JSON.stringify(res, null, 2));
  if (flags.json) { console.log(JSON.stringify(res, null, 2)); }
  else {
    console.log(table(res));
    if (res.sheets) for (const s of res.sheets) {
      const missing = s.tiles.filter((t) => !t.loaded).map((t) => t.n);
      console.log(`  moodboard ${s.file}${missing.length ? '  (tiles ' + missing.join(', ') + ' did not load in the browser)' : ''}`);
    }
    if (res.sheetError) console.log('  no moodboard: ' + res.sheetError.split('\n')[0]);
    console.log('  results: ' + join(out, 'results.json'));
  }
  if (!good.length) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
