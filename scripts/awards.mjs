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
export function buildCorpus(options = {}) {
  // `write: false` builds in memory and returns the rows - how a test asks
  // "is the shipped file what the chunks make" without touching it.
  const write = options.write !== false;
  if (!existsSync(CHUNK_DIR)) throw new Error(`no chunk directory at ${CHUNK_DIR}`);

  // What `awards --check` learned lives in the merged file, not in the chunks -
  // a harvester writes what it believed at harvest time and never hears about a
  // domain that lapsed six months later. Rebuilding from the chunks therefore
  // used to throw the check away silently: twelve dead URLs came back marked
  // verified, and the next `study` run rendered twelve parking pages.
  //
  // So the check's verdict is carried forward across a rebuild. The chunks stay
  // the source of truth for everything a harvester knows; the check stays the
  // source of truth for whether the page is still there.
  const prior = new Map();
  for (const e of Array.isArray(options.prior) ? options.prior : loadCorpus()) if (e.dead || e.checked) prior.set(e.id, e);
  if (write) cache = null;

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
      //
      // The key is the CHUNK's url, never the address a check followed. Keyed
      // on the followed one, two rows for igloo.inc merged or did not depending
      // on the previous build's output, so every rebuild flipped an entry in or
      // out; from the chunks alone the merge is the same every time.
      const key = clean.url.replace(/\/+$/, '').toLowerCase();
      const already = byUrl.get(key) || byId.get(clean.id);
      if (already) {
        report.duplicates++;
        if (score(clean) > score(already)) Object.assign(already, clean, { id: already.id });
        continue;
      }
      byId.set(clean.id, clean);
      byUrl.set(key, clean);
    }
  }

  // Carry the check's verdict over the harvester's optimism, by the id the
  // merge settled on.
  for (const clean of byId.values()) {
    const seen = prior.get(clean.id);
    if (!seen) continue;
    if (seen.checked) clean.checked = seen.checked;
    if (seen.dead) { clean.dead = seen.dead; clean.verified = false; }
    // A redirect the check followed is the live address; the chunk still
    // holds the one that redirected.
    if (seen.checked && seen.url) clean.url = seen.url;
  }

  const all = [...byId.values()].sort((a, b) => (b.year - a.year) || a.id.localeCompare(b.id));
  report.entries = all.length;
  if (!write) return { ...report, rows: all };
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(CORPUS, JSON.stringify(all, null, 1) + '\n');
  cache = all;
  return report;
}

const KINDS = new Set(['3d', 'editorial', 'product', 'portfolio', 'ecommerce', 'brand', 'experiment', 'game', 'app', 'studio']);

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
  const clean = {
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
  // Whether a person or an agent made the site is the axis games.md is built
  // on - Doodle District against Whiteout - and the harvesters record it. The
  // merge used to drop it, so the corpus every query reads could not tell the
  // two apart. Carried only when a harvester actually said so: a missing flag
  // is "not recorded", never "made by a person".
  if (typeof row.aiGenerated === 'boolean') clean.aiGenerated = row.aiGenerated;
  return clean;
}

export { normalise as normaliseRow };

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
  // An agency or studio site IS a service site - the corpus has no 'service'
  // kind, and mapping the register to brand alone returned a watch, an art
  // archive and a headset.
  service: { kind: 'portfolio', q: 'agency' },
  argument: { kind: 'editorial', q: '' },
  portfolio: { kind: 'portfolio', q: '' },
  '3d': { kind: '3d', q: '' },
  editorial: { kind: 'editorial', q: '' },
  game: { kind: 'game', q: '' },
  app: { kind: 'app', q: '' },
  studio: { kind: 'studio,portfolio', q: '' },
};

export function pickReferences(register, n = 3, extra = {}) {
  const base = REGISTERS[String(register || '').toLowerCase()] || { kind: '', q: String(register || '') };
  // A caller passing { kind: null } because no --kind flag was given must not
  // erase the register's own kind. It did: every --pick since the corpus
  // landed ran with no kind filter, which is how a service brief got a watch,
  // an art archive and a headset.
  const merged = { ...base };
  for (const [k, v] of Object.entries(extra || {})) if (v !== null && v !== undefined && v !== '') merged[k] = v;
  let pool = queryAwards({ ...merged, verified: true });
  if (pool.length < n) pool = queryAwards(merged);
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
    const tags = [e.year || null, e.award !== 'reference' ? e.award : null, e.kind, e.source,
      e.aiGenerated === true ? 'agent-built' : null]
      .filter(Boolean).join(' / ');
    out.push(`${e.name}${e.studio ? '  -  ' + e.studio : ''}`);
    // "Unverified" and "gone" are not the same thing and must not print the
    // same words: the first is a site nobody has checked, the second is one
    // that was checked and answered with an error. Telling a model to go and
    // look at the second wastes a render and invites it to describe a page it
    // never saw.
    const state = e.dead
      ? `   (offline when last checked${e.dead.status ? ', ' + e.dead.status : ''} - do not render it)`
      : e.verified ? '' : '   (url unverified)';
    out.push(`  ${e.url}${state}`);
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

/* What one HTTP status says about a reference page.
   401, 403 and 429 are a server that answered and refused a script - a bot wall,
   a login, a rate limit. fortnite.com answers a Chrome user-agent with 403, and
   marking it dead told the next model not to look at a site that is plainly
   there. So they are their own verdict: not dead, not proven alive. */
const BLOCKED = new Set([401, 403, 429]);
// A gateway that timed out or a service briefly down is weather, not a verdict.
const TRANSIENT = new Set([502, 503, 504]);
export function statusVerdict(status) {
  if (status >= 200 && status < 400) return 'ok';
  if (BLOCKED.has(status)) return 'blocked';
  if (TRANSIENT.has(status)) return 'unsure';
  return 'dead';
}

/* And what a request that never got a status says. A name that no longer
   resolves, or a certificate a browser would refuse, is the site gone or broken
   for anyone who visits. A connect timeout or a redirect loop is this machine's
   view of it: overwatch.blizzard.com loops for a client without cookies and
   opens in any browser. */
const GONE_CODES = new Set([
  'ENOTFOUND', 'ERR_TLS_CERT_ALTNAME_INVALID', 'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
]);
export function errorVerdict(err) {
  const code = err && err.cause && err.cause.code;
  return code && GONE_CODES.has(code) ? 'dead' : 'unsure';
}

/* Does the corpus still point at real pages?

   A reference site is the one thing in this plugin with a shelf life. Studios
   redesign, domains lapse, award pages move, and a `study` run against a dead
   URL renders a parking page and teaches the model nothing - worse, it teaches
   it something wrong, because a 404 with a bit of styling still tiles into the
   contact sheet. Harvesters set `verified` at harvest time; this is how that
   claim stays true afterwards.

   HEAD first, because most of these pages are heavy, and a GET on four hundred
   award-winning sites is a lot of bandwidth to prove a thing a header already
   said. Falling back to a ranged GET matters: plenty of sites answer HEAD with
   405 and are perfectly alive. */
export async function checkCorpus(options = {}) {
  const rows = (options.corpus || loadCorpus()).slice(0, options.limit ? Number(options.limit) : undefined);
  const concurrency = Math.max(1, Math.min(16, Number(options.concurrency) || 8));
  const timeoutMs = Number(options.timeoutMs) || 15000;
  const results = [];
  let cursor = 0;

  async function probe(entry) {
    const attempt = async (method, headers, url = entry.url) => {
      const control = new AbortController();
      const timer = setTimeout(() => control.abort(), timeoutMs);
      try {
        const res = await fetch(url, {
          method,
          redirect: 'follow',
          signal: control.signal,
          headers: Object.assign({
            // A default Node user-agent is blocked by a good share of these
            // sites, and reporting that as "dead" would be a lie about them.
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
            accept: 'text/html,application/xhtml+xml',
          }, headers || {}),
        });
        return { status: res.status, url: res.url };
      } finally {
        clearTimeout(timer);
      }
    };
    const once = async () => {
      let r = await attempt('HEAD');
      // 400 joins the list: several large sites answer a HEAD with it and a GET
      // with the page.
      if (r.status === 400 || r.status === 405 || r.status === 403 || r.status === 501) {
        r = await attempt('GET', { range: 'bytes=0-2047' });
      }
      return r;
    };
    let r;
    try {
      r = await once();
    } catch (first) {
      // A network error is as often this machine or a busy moment as the site -
      // animejs.com and overwatch.blizzard.com both "failed" in one full run and
      // answered 200 and 302 a minute later. One retry before it counts.
      try {
        await new Promise((res) => setTimeout(res, 1500));
        r = await once();
      } catch (err) {
        const why = (err && err.cause && err.cause.code) || String(err && err.message || err);
        return { id: entry.id, url: entry.url, status: 0, ok: false, verdict: errorVerdict(err), error: String(why).slice(0, 80) };
      }
    }
    const moved = r.url && r.url.replace(/\/+$/, '') !== entry.url.replace(/\/+$/, '');
    let verdict = statusVerdict(r.status);
    // Some walls answer 400 rather than 403: meta.com gives its own home page a
    // 400 for any client that is not a browser. A page's 400 only says the page
    // is gone when the site's root answers differently.
    if (r.status === 400) {
      try {
        const root = await attempt('GET', { range: 'bytes=0-2047' }, new URL('/', entry.url).href);
        if (root.status === 400) verdict = 'blocked';
      } catch {}
    }
    return {
      id: entry.id, url: entry.url, status: r.status,
      ok: verdict === 'ok',
      verdict,
      movedTo: verdict === 'ok' && moved ? r.url : null,
    };
  }

  async function worker() {
    while (cursor < rows.length) {
      const entry = rows[cursor++];
      const result = await probe(entry);
      results.push(result);
      if (options.onResult) options.onResult(result, results.length, rows.length);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  const dead = results.filter((r) => r.verdict === 'dead');
  // Offline, every name fails to resolve and ENOTFOUND reads as "gone" -
  // one run would mark the whole corpus dead. When a quarter of a run failed
  // before any server answered, the run is about this machine's network.
  const noAnswer = results.filter((r) => r.status === 0).length;
  const offline = results.length >= 10 && noAnswer / results.length > 0.25;
  return {
    offline,
    checked: results.length,
    alive: results.filter((r) => r.ok).length,
    dead,
    // Answered, but refused a script; or could not be reached from here for a
    // reason that says nothing about the site. Neither is evidence of death,
    // so these are reported and left as they were.
    blocked: results.filter((r) => r.verdict === 'blocked'),
    unsure: results.filter((r) => r.verdict === 'unsure'),
    moved: results.filter((r) => r.ok && r.movedTo),
    // Every id that answered, so a site marked dead by an earlier check can be
    // brought back when it answers again.
    reachable: results.filter((r) => r.ok).map((r) => r.id),
  };
}

/* Write the check back into the corpus, so a dead entry stops being offered.
   It is marked rather than deleted: a studio's site being down for a day is not
   the same as the reference being worthless, and a human should decide which.

   The same reasoning runs the other way. A mark that only ever goes on kept a
   site that was down for one check dead for good - the rebuild carries `dead`
   forward on purpose - so an entry that answers again is un-marked here, and
   gets back the verified flag it had before the check took it away.

   `options.rows` works on an in-memory corpus and writes nothing, which is how
   the tests run it: a check stamp that reached the shipped file from a test
   run is how one entry came to say it died "at test". */
export function applyCheck(report, options = {}) {
  const inMemory = Array.isArray(options.rows);
  const all = inMemory ? options.rows : loadCorpus();
  const byId = new Map(all.map((e) => [e.id, e]));
  let changed = 0;
  for (const row of report.dead || []) {
    const entry = byId.get(row.id);
    if (!entry) continue;
    const wasVerified = entry.dead ? entry.dead.wasVerified : entry.verified;
    entry.verified = false;
    entry.dead = { status: row.status, at: report.stampedAt || null };
    if (typeof wasVerified === 'boolean') entry.dead.wasVerified = wasVerified;
    entry.checked = report.stampedAt || null;
    changed++;
  }
  for (const id of report.reachable || []) {
    const entry = byId.get(id);
    if (!entry || !entry.dead) continue;
    // A mark made before `wasVerified` was recorded does not know what the
    // harvester claimed, so it stays unverified here; the next `--build`
    // re-reads the chunk's own claim now that nothing forces it false.
    entry.verified = entry.dead.wasVerified === true;
    delete entry.dead;
    entry.checked = report.stampedAt || null;
    changed++;
  }
  // A mark whose own evidence the rules no longer count as death - a 403 from a
  // bot wall, recorded before blocked was its own verdict - is withdrawn when
  // this check found nothing worse. So is a mark made on the very status a wall
  // answered with again today (meta.com's site-wide 400): same evidence, now
  // judged for what it is. An old network failure stays - nothing recorded why
  // it failed, and some reasons (a certificate a browser refuses) are death.
  const withdraw = (row, sameWall) => {
    const entry = byId.get(row.id);
    if (!entry || !entry.dead) return;
    if (statusVerdict(entry.dead.status) === 'dead' && !(sameWall && entry.dead.status === row.status)) return;
    entry.verified = entry.dead.wasVerified === true;
    delete entry.dead;
    entry.checked = report.stampedAt || null;
    changed++;
  };
  for (const row of report.blocked || []) withdraw(row, true);
  for (const row of report.unsure || []) withdraw(row, false);
  for (const row of report.moved || []) {
    const entry = byId.get(row.id);
    if (!entry || !row.movedTo) continue;
    entry.url = row.movedTo;
    entry.checked = report.stampedAt || null;
    changed++;
  }
  if (changed && !inMemory) writeFileSync(CORPUS, JSON.stringify(all, null, 1) + '\n');
  return changed;
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
