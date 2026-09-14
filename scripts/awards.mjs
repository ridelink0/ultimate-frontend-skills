/* ultimate-frontend-skills - the reference corpus.

   A model builds better when it has looked at the thing it is trying to match.
   This reads skills/ultimate-frontend-skills/data/awards.json - award winners
   and reference sites, each with the specific craft move worth taking from it -
   and answers three questions:

     what exists like this        awards <query>
     which three should I study   awards --pick object --n 3
     show me them                 study --awards <query>

   The corpus is data, not instruction. Nothing here copies a site; it picks
   references so the study command can render them and the model can look.

   No dependencies. Node 18+. */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = resolve(HERE, '..', 'skills', 'ultimate-frontend-skills', 'data');
export const CORPUS = join(DATA_DIR, 'awards.json');
const CHUNK_DIR = join(DATA_DIR, 'awards');

/* ------------------------------------------------------------------ load -- */

let cache = null;

export function loadCorpus() {
  if (cache) return cache;
  if (!existsSync(CORPUS)) return (cache = []);
  try {
    const parsed = JSON.parse(readFileSync(CORPUS, 'utf8'));
    cache = Array.isArray(parsed) ? parsed : Array.isArray(parsed.sites) ? parsed.sites : [];
  } catch {
    cache = [];
  }
  return cache;
}

/* The corpus ships merged, but it is harvested in chunks and a chunk may be
   re-run. Rebuilding is deterministic: same chunks in, same file out, so the
   diff is reviewable rather than a reshuffle. */
export function buildCorpus() {
  if (!existsSync(CHUNK_DIR)) throw new Error(`no chunk directory at ${CHUNK_DIR}`);
  const files = readdirSync(CHUNK_DIR).filter((f) => f.endsWith('.json')).sort();
  const byId = new Map();
  const byUrl = new Map();
  const report = { files: files.length, read: 0, entries: 0, duplicates: 0, dropped: [] };

  for (const f of files) {
    let rows;
    try {
      rows = JSON.parse(readFileSync(join(CHUNK_DIR, f), 'utf8'));
    } catch (e) {
      report.dropped.push(`${f}: not valid JSON (${e.message})`);
      continue;
    }
    if (!Array.isArray(rows)) { report.dropped.push(`${f}: not an array`); continue; }
    report.read++;
    for (const row of rows) {
      const clean = normalise(row, f, report);
      if (!clean) continue;
      // Same site found by two harvesters is the normal case, not an error.
      // Keep the richer record: more techniques means more to study.
      const key = clean.url.replace(/\/+$/, '').toLowerCase();
      const prior = byUrl.get(key) || byId.get(clean.id);
      if (prior) {
        report.duplicates++;
        if (score(clean) > score(prior)) Object.assign(prior, clean, { id: prior.id });
        continue;
      }
      byId.set(clean.id, clean);
      byUrl.set(key, clean);
    }
  }

  const all = [...byId.values()].sort((a, b) => (b.year - a.year) || a.id.localeCompare(b.id));
  report.entries = all.length;
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(CORPUS, JSON.stringify(all, null, 1) + '\n');
  cache = all;
  return report;
}

const KINDS = new Set(['3d', 'editorial', 'product', 'portfolio', 'ecommerce', 'brand', 'experiment']);

const NOISE = /^(unverified\b|not individually|listed on|could not|no longer|see also|source:)|not individually fetched|tag feed/i;

/* The vocabulary the corpus can actually be searched by.
   A technique in this dataset is a sentence - "ScrollTrigger-driven camera path
   through a rotating image-atlas cylinder" - which is the right thing to store,
   because the mechanism is the point. It is the wrong thing to list: an index of
   three hundred unique sentences tells a model nothing about what to ask for.
   So the index counts terms, not rows, and these are the terms. Everything here
   is something a page can be built out of; the free text stays searchable
   underneath by the ordinary query path. */
const VOCABULARY = [
  'scroll-scrubbed 3d', 'scrollytelling', 'pinned horizontal', 'horizontal scroll', 'sticky section',
  'image sequence', 'canvas sequence', 'wireframe', 'exploded view', 'turntable',
  'webgl', 'three.js', 'react-three-fiber', 'shader', 'glsl', 'fragment shader', 'vertex displacement',
  'mesh gradient', 'fluid simulation', 'particle', 'point cloud', 'instancing', 'raymarching',
  'post-processing', 'bloom', 'depth of field', 'chromatic aberration', 'ascii',
  'distortion', 'displacement map', 'render target', 'portal', 'fbo',
  'gsap', 'scrolltrigger', 'scrollsmoother', 'lenis', 'locomotive', 'smooth scroll', 'inertia',
  'motion one', 'framer motion', 'anime.js', 'barba.js', 'view transition', 'page transition',
  'shared element', 'flip', 'morph', 'svg filter', 'clip-path', 'mask reveal', 'text mask',
  'split text', 'per-word reveal', 'per-character', 'kinetic type', 'variable font', 'marquee',
  'custom cursor', 'cursor follow', 'magnetic', 'hover distortion', 'tilt',
  'parallax', 'depth map', 'layered depth', 'aerial perspective',
  'physics', 'matter.js', 'rapier', 'ragdoll', 'soft body',
  'editorial grid', 'breakout grid', 'asymmetric grid', 'dot leader', 'spec table',
  'grain', 'film grain', 'vignette', 'duotone', 'colour grade', 'scrim',
  'video in canvas', 'video scrub', 'webm', 'lottie',
  'glb', 'gltf', 'draco', 'blender', 'baked lighting', 'hdri', 'pbr', 'matcap',
  'audio', 'web audio', 'sound design', 'preloader', 'loading sequence',
  'infinite scroll', 'drag gallery', 'carousel', 'accordion', 'sticky nav',
  'dark mode', 'theme toggle', 'reduced motion', 'accessibility',
];

function normalise(row, file, report) {
  if (!row || typeof row !== 'object') return null;
  const url = typeof row.url === 'string' ? row.url.trim() : '';
  // A fabricated URL would poison every study run that followed, so a row
  // without a plausible one is dropped rather than repaired.
  if (!/^https?:\/\/[^\s/]+\.[^\s/]/.test(url)) {
    report.dropped.push(`${file}: ${(row.name || row.id || 'row')} has no usable url`);
    return null;
  }
  const id = String(row.id || row.name || url).toLowerCase()
    .replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  if (!id) return null;
  // Harvesters sometimes put their own provenance into the technique list -
  // "unverified - listed on the tag feed, not individually fetched". That is a
  // note about the row, not a thing the site does, and left in it pollutes the
  // technique vocabulary that `--techniques` exists to publish.
  const list = (v, drop) => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(/\s*,\s*/) : [])
    .map((s) => String(s).trim())
    .filter((s) => s && !(drop && NOISE.test(s)));
  const year = Number(row.year);
  return {
    id,
    name: String(row.name || id).trim(),
    url,
    studio: row.studio ? String(row.studio).trim() : null,
    year: Number.isFinite(year) && year > 2000 && year < 2100 ? year : 0,
    award: String(row.award || 'reference').toLowerCase(),
    source: String(row.source || 'editorial').toLowerCase(),
    kind: KINDS.has(String(row.kind).toLowerCase()) ? String(row.kind).toLowerCase() : 'editorial',
    stack: list(row.stack, true),
    techniques: list(row.techniques, true),
    palette: str(row.palette),
    type: str(row.type),
    motion: str(row.motion),
    why: str(row.why),
    verified: row.verified === true,
  };
}

const str = (v) => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim());
const score = (e) => e.techniques.length * 2 + e.stack.length + (e.why ? 3 : 0) + (e.verified ? 4 : 0)
  + (e.motion ? 1 : 0) + (e.palette ? 1 : 0) + (e.type ? 1 : 0);

/* ----------------------------------------------------------------- query -- */

export function queryAwards(opts = {}) {
  const all = opts.corpus || loadCorpus();
  const terms = String(opts.q || '').toLowerCase().split(/\s+/).filter(Boolean);
  const wanted = (key, value) => !value || String(value).toLowerCase().split(/\s*,\s*/)
    .some((v) => String(key).toLowerCase() === v);

  let rows = all.filter((e) => {
    if (!wanted(e.kind, opts.kind)) return false;
    if (!wanted(e.source, opts.source)) return false;
    if (!wanted(e.award, opts.award)) return false;
    if (opts.year && e.year !== Number(opts.year)) return false;
    if (opts.since && e.year && e.year < Number(opts.since)) return false;
    if (opts.verified && !e.verified) return false;
    if (opts.stack && !e.stack.some((s) => s.toLowerCase().includes(String(opts.stack).toLowerCase()))) return false;
    if (opts.technique && !e.techniques.some((t) => t.toLowerCase().includes(String(opts.technique).toLowerCase()))) return false;
    return true;
  });

  if (terms.length) {
    rows = rows.map((e) => {
      const hay = [e.name, e.studio, e.kind, e.award, e.source, e.palette, e.type, e.motion, e.why,
        e.stack.join(' '), e.techniques.join(' ')].join(' ').toLowerCase();
      // Every term must appear somewhere, then rank by where. A match in the
      // techniques is worth more than one in the prose around it.
      const hits = terms.filter((t) => hay.includes(t));
      if (hits.length !== terms.length) return null;
      const sharp = terms.filter((t) => (e.techniques.join(' ') + ' ' + e.stack.join(' ')).toLowerCase().includes(t)).length;
      return { e, rank: sharp * 3 + score(e) / 10 };
    }).filter(Boolean).sort((a, b) => b.rank - a.rank).map((r) => r.e);
  } else {
    rows = rows.slice().sort((a, b) => score(b) - score(a));
  }
  return opts.limit ? rows.slice(0, Number(opts.limit)) : rows;
}

/* The three-reference workflow: not the three best, which would all be the same
   site three times, but three that disagree with each other - different source,
   different studio, different technique. Studying three variations of one look
   teaches the look; studying three different answers teaches the decision. */
const REGISTERS = {
  object: { kind: '3d,product', q: '' },
  product: { kind: 'product,3d', q: '' },
  place: { kind: 'brand,editorial', q: '' },
  service: { kind: 'brand,editorial', q: '' },
  argument: { kind: 'editorial', q: '' },
  portfolio: { kind: 'portfolio', q: '' },
  '3d': { kind: '3d', q: '' },
  editorial: { kind: 'editorial', q: '' },
};

export function pickReferences(register, n = 3, extra = {}) {
  const base = REGISTERS[String(register || '').toLowerCase()] || { kind: '', q: String(register || '') };
  let pool = queryAwards({ ...base, ...extra, verified: true });
  if (pool.length < n) pool = queryAwards({ ...base, ...extra });
  const picked = [];
  const seenStudio = new Set();
  const seenSource = new Set();
  const seenTech = new Set();
  for (const pass of [0, 1]) {
    for (const e of pool) {
      if (picked.length >= n) break;
      if (picked.includes(e)) continue;
      if (pass === 0) {
        if (e.studio && seenStudio.has(e.studio.toLowerCase())) continue;
        if (seenSource.has(e.source)) continue;
        if (e.techniques.some((t) => seenTech.has(t.toLowerCase()))) continue;
      }
      picked.push(e);
      if (e.studio) seenStudio.add(e.studio.toLowerCase());
      seenSource.add(e.source);
      for (const t of e.techniques) seenTech.add(t.toLowerCase());
    }
  }
  return picked.slice(0, n);
}

/* --------------------------------------------------------------- format -- */

export function formatAwards(rows, opts = {}) {
  if (!rows.length) return 'no matching reference sites. Try a broader query, or `awards --techniques` to see what is in the corpus.';
  const out = [];
  for (const e of rows) {
    const tags = [e.year || null, e.award !== 'reference' ? e.award : null, e.kind, e.source]
      .filter(Boolean).join(' / ');
    out.push(`${e.name}${e.studio ? '  -  ' + e.studio : ''}`);
    out.push(`  ${e.url}${e.verified ? '' : '   (url unverified)'}`);
    out.push(`  ${tags}`);
    if (e.techniques.length) out.push(`  technique  ${e.techniques.join(', ')}`);
    if (e.stack.length) out.push(`  stack      ${e.stack.join(', ')}`);
    if (opts.verbose) {
      if (e.type) out.push(`  type       ${e.type}`);
      if (e.palette) out.push(`  palette    ${e.palette}`);
      if (e.motion) out.push(`  motion     ${e.motion}`);
    }
    if (e.why) out.push(`  take       ${e.why}`);
    out.push('');
  }
  out.push(`${rows.length} site${rows.length === 1 ? '' : 's'}. Render them before you build: study ${rows.slice(0, 3).map((e) => e.url).join(' ')}`);
  return out.join('\n');
}

/* What the corpus knows how to do, which is the useful index into it - a model
   that cannot name a technique cannot search for one. */
export function techniqueIndex(corpus) {
  const all = corpus || loadCorpus();
  const counts = new Map();
  for (const e of all) {
    // One site counts once per term however many times it says it.
    const hay = (e.techniques.join(' ; ') + ' ; ' + e.stack.join(' ; ') + ' ; ' + e.motion).toLowerCase();
    for (const term of VOCABULARY) {
      if (hay.includes(term)) counts.set(term, (counts.get(term) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([technique, count]) => ({ technique, count }));
}

export function corpusStats() {
  const all = loadCorpus();
  const tally = (key) => all.reduce((m, e) => (m[e[key]] = (m[e[key]] || 0) + 1, m), {});
  return {
    entries: all.length,
    verified: all.filter((e) => e.verified).length,
    bySource: tally('source'),
    byKind: tally('kind'),
    byAward: tally('award'),
    techniques: techniqueIndex(all).length,
    years: [...new Set(all.map((e) => e.year).filter(Boolean))].sort(),
  };
}
