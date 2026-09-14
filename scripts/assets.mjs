#!/usr/bin/env node
/* ultimate-frontend-skills - CC0 material sets, environment lighting, and an
   honest answer about generated imagery.

     assets search <query> [--source polyhaven|ambientcg] [--limit N] [--json]
     assets textures <slug> [--res 1k|2k|4k|8k] [--out DIR] [--pick web|all] [--json]
     assets hdri <slug> [--res 1k|2k|4k|8k|16k] [--out DIR] [--pick hdr|exr] [--json]
     assets gen "<prompt>" [--out FILE] [--res 768] [--model pollinations] [--no-probe] [--json]

   Two sources, both genuine CC0 1.0, both key-free. Poly Haven serves one file
   per map with an md5 in the manifest, so downloads are verifiable and the URLs
   are hotlinkable. ambientCG serves zips only, so this unpacks them with zlib.
   Filenames are normalised across both, because the two disagree about every
   map name, and a provenance file lands beside them so the person asking where
   a texture came from in eighteen months has an answer.

   `gen` detects. It never invents a key, and it never posts a prompt to an
   endpoint it has no credential for. The only thing it can send is the one
   route that asks for no credential at all, and only when you name it.

   No dependencies. Node 18+. */

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve, join, dirname, basename, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { parseArgs } from './args.mjs';

const VERSION = '5.0.0';
/* Poly Haven ToS 2.4 requires a Referer or user-agent that names the calling
   software, so every request from this file can be attributed to it. A default
   fetch UA is out of compliance, not merely impolite. */
const UA = `ultimate-frontend-skills/${VERSION} (+https://github.com/ridelink0/ultimate-frontend-skills)`;

const HOME = process.env.HOME || process.env.USERPROFILE || '';
const argv = process.argv.slice(2);
const cmd = argv[0];
const die = (msg, code = 1) => { console.error('assets: ' + msg); process.exit(code); };

let positional = [], flag = () => null;
try { ({ positional, flag } = parseArgs(argv)); } catch (e) { die(e.message); }
const JSON_OUT = !!flag('json');
const out = (obj, text) => { if (JSON_OUT) console.log(JSON.stringify(obj, null, 2)); else console.log(text); };

/* ------------------------------------------------------------------ http -- */

async function req(url, { json = false, timeout = 120000 } = {}) {
  const res = await fetch(url, {
    headers: { 'user-agent': UA, accept: json ? 'application/json' : '*/*' },
    redirect: 'follow',
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) { const e = new Error(`${res.status} ${res.statusText}`); e.status = res.status; e.url = url; throw e; }
  return json ? res.json() : Buffer.from(await res.arrayBuffer());
}

const bytes = (n) => (n >= 1048576 ? (n / 1048576).toFixed(2) + ' MB' : (n / 1024).toFixed(0) + ' KB');
const md5 = (buf) => createHash('md5').update(buf).digest('hex');

/* ------------------------------------------------------------- poly haven -- */
/* type is an int in this API: 0 hdri, 1 texture, 2 model. */
const PH_TYPE = { 0: 'hdri', 1: 'texture', 2: 'model' };

async function phIndex(types = ['textures', 'hdris', 'models']) {
  const pages = await Promise.all(types.map((t) => req(`https://api.polyhaven.com/assets?type=${t}`, { json: true })));
  const rows = [];
  for (const page of pages) {
    for (const [id, meta] of Object.entries(page)) {
      rows.push({
        source: 'polyhaven', id, name: meta.name || id,
        kind: PH_TYPE[meta.type] ?? 'unknown',
        tags: meta.tags || [], categories: meta.categories || [],
        maxResolution: meta.max_resolution || null,
        dimensionsMm: meta.dimensions || null,
        authors: meta.authors || {},
        description: meta.description || '',
      });
    }
  }
  return rows;
}

async function phInfo(id) {
  try { return await req(`https://api.polyhaven.com/info/${encodeURIComponent(id)}`, { json: true }); }
  catch (e) { if (e.status === 404) return null; throw e; }
}

const phFiles = (id) => req(`https://api.polyhaven.com/files/${encodeURIComponent(id)}`, { json: true });

/* The manifest is the only truth about which maps an asset has - plenty of
   assets are missing one - so nothing here hand-builds a download URL, even
   though the pattern is regular enough to tempt you. */
const PH_SLOTS = [
  { key: 'Diffuse', file: 'color', slots: ['map'], srgb: true, web: true },
  { key: 'nor_gl', file: 'normal', slots: ['normalMap'], web: true },
  { key: 'arm', file: 'arm', slots: ['aoMap', 'roughnessMap', 'metalnessMap'], web: true, packed: true },
  { key: 'Rough', file: 'rough', slots: ['roughnessMap'] },
  { key: 'AO', file: 'ao', slots: ['aoMap'] },
  { key: 'Metal', file: 'metal', slots: ['metalnessMap'] },
  { key: 'Displacement', file: 'disp', slots: ['displacementMap'] },
];

function phPlan(files, res, pick) {
  const have = (s) => files[s.key]?.[res]?.jpg;
  const present = PH_SLOTS.filter(have);
  if (!present.length) return [];
  if (pick === 'all') return present;
  // The web set: colour, a GL-convention normal, and ARM if it exists. ARM packs
  // AO, roughness and metalness into one image's R, G and B, which is three
  // downloads collapsed into one and the reason to prefer it.
  const web = present.filter((s) => s.web);
  if (web.some((s) => s.packed)) return web;
  return present.filter((s) => s.web || ['Rough', 'AO', 'Metal'].includes(s.key));
}

/* -------------------------------------------------------------- ambientcg -- */

const ACG_SLOTS = [
  { key: 'Color', file: 'color', slots: ['map'], srgb: true, web: true },
  { key: 'NormalGL', file: 'normal', slots: ['normalMap'], web: true },
  { key: 'Roughness', file: 'rough', slots: ['roughnessMap'], web: true },
  { key: 'AmbientOcclusion', file: 'ao', slots: ['aoMap'], web: true },
  { key: 'Metalness', file: 'metal', slots: ['metalnessMap'] },
  { key: 'Displacement', file: 'disp', slots: ['displacementMap'] },
];

async function acgSearch(q, limit) {
  const url = `https://ambientcg.com/api/v2/full_json?q=${encodeURIComponent(q)}&type=Material&limit=${limit}&sort=popular`;
  const body = await req(url, { json: true });
  return (body.foundAssets || []).map((a) => ({
    source: 'ambientcg', id: a.assetId, name: a.displayName || a.assetId,
    kind: 'texture',
    tags: a.tags || [], categories: [a.displayCategory].filter(Boolean),
    maxResolution: null,
    // ambientCG reports real-world size in centimetres, and leaves it at 0 on
    // plenty of assets, so it is only reported when it is actually set.
    dimensionsMm: a.dimensionX > 0 ? [a.dimensionX * 10, a.dimensionY * 10] : null,
    authors: {}, description: a.description || '',
    maps: a.maps || [],
  }));
}

async function acgAsset(id) {
  const url = `https://ambientcg.com/api/v2/full_json?id=${encodeURIComponent(id)}&include=downloadData`;
  const body = await req(url, { json: true });
  return (body.foundAssets || []).find((a) => a.assetId.toLowerCase() === id.toLowerCase()) || null;
}

/* A zip reader, because ambientCG has no per-map URL and adding a dependency to
   this repo is not on the table. Central directory only; store and deflate
   only; zip64 is reported rather than guessed at. The 1K and 2K archives are a
   few megabytes, so the whole thing lives in memory. */
function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip archive (no end-of-central-directory record)');
  const count = buf.readUInt16LE(eocd + 10);
  let at = buf.readUInt32LE(eocd + 16);
  if (at === 0xffffffff) throw new Error('zip64 archive - too large for this reader; fetch a smaller resolution');
  const files = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(at) !== 0x02014b50) throw new Error('corrupt central directory');
    const method = buf.readUInt16LE(at + 10);
    const compressed = buf.readUInt32LE(at + 20);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    const localAt = buf.readUInt32LE(at + 42);
    const name = buf.toString('utf8', at + 46, at + 46 + nameLen);
    at += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    if (buf.readUInt32LE(localAt) !== 0x04034b50) throw new Error(`corrupt local header for ${name}`);
    const start = localAt + 30 + buf.readUInt16LE(localAt + 26) + buf.readUInt16LE(localAt + 28);
    const raw = buf.subarray(start, start + compressed);
    if (method === 0) files.push({ name, data: Buffer.from(raw) });
    else if (method === 8) files.push({ name, data: inflateRawSync(raw) });
    else throw new Error(`unsupported compression method ${method} in ${name}`);
  }
  return files;
}

/* ---------------------------------------------------------------- search -- */

function score(row, tokens) {
  let total = 0;
  const id = row.id.toLowerCase(), name = row.name.toLowerCase();
  const tags = row.tags.map((t) => String(t).toLowerCase());
  const cats = row.categories.map((c) => String(c).toLowerCase());
  const desc = row.description.toLowerCase();
  for (const t of tokens) {
    let best = 0;
    if (id === t) best = 100;
    else if (id.startsWith(t)) best = 60;
    else if (id.includes(t)) best = 40;
    if (name.includes(t)) best = Math.max(best, 32);
    if (tags.includes(t)) best = Math.max(best, 26);
    if (cats.includes(t)) best = Math.max(best, 20);
    if (tags.some((x) => x.includes(t)) || cats.some((x) => x.includes(t))) best = Math.max(best, 14);
    if (desc.includes(t)) best = Math.max(best, 5);
    if (!best) return 0;                       // every word has to land somewhere
    total += best;
  }
  return total;
}

async function cmdSearch() {
  const q = positional.join(' ').trim();
  if (!q) die('search needs a query, e.g. `assets search brushed metal`');
  const source = String(flag('source', 'both')).toLowerCase();
  const limit = Math.max(1, Number(flag('limit', 14)) || 14);
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);

  const rows = [];
  const errors = [];
  if (source === 'polyhaven' || source === 'both') {
    try {
      const idx = await phIndex();
      for (const row of idx) { const s = score(row, tokens); if (s) rows.push({ ...row, score: s }); }
    } catch (e) { errors.push(`polyhaven: ${e.message}`); }
  }
  if (source === 'ambientcg' || source === 'both') {
    try {
      for (const row of await acgSearch(q, limit * 2)) rows.push({ ...row, score: score(row, tokens) || 18 });
    } catch (e) { errors.push(`ambientcg: ${e.message}`); }
  }
  if (!['polyhaven', 'ambientcg', 'both'].includes(source)) die(`unknown --source "${source}". Try polyhaven, ambientcg, both.`);

  rows.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  /* Poly Haven indexes every tag, so on a one-word query it fills the page and
     ambientCG never appears - which hides half the library from someone who
     asked both. Round-robin instead: best of each, alternating. */
  let hits;
  if (source === 'both') {
    const bySource = { polyhaven: rows.filter((r) => r.source === 'polyhaven'), ambientcg: rows.filter((r) => r.source === 'ambientcg') };
    hits = [];
    for (let i = 0; hits.length < limit && (bySource.polyhaven[i] || bySource.ambientcg[i]); i++) {
      if (bySource.polyhaven[i]) hits.push(bySource.polyhaven[i]);
      if (hits.length < limit && bySource.ambientcg[i]) hits.push(bySource.ambientcg[i]);
    }
  } else {
    hits = rows.slice(0, limit);
  }

  if (JSON_OUT) {
    out({ query: q, source, count: hits.length, errors, results: hits });
    return;
  }
  for (const e of errors) console.error('assets: ' + e);
  if (!hits.length) { console.log(`nothing matched "${q}". Try one word, and a material rather than an object: "walnut", not "desk".`); return; }
  const w = Math.max(...hits.map((h) => h.id.length));
  for (const h of hits) {
    const size = h.maxResolution ? `${h.maxResolution[0]}px` : '';
    const terms = [...h.categories, ...h.tags].slice(0, 5).join(', ');
    console.log(
      `${h.source.padEnd(10)} ${h.id.padEnd(w)}  ${(h.kind === 'hdri' ? 'hdri ' : h.kind === 'model' ? 'model' : 'tex  ')} ${size.padStart(7)}  ${terms}`,
    );
  }
  const first = hits.find((h) => h.kind === 'texture') || hits[0];
  const next = first.kind === 'hdri'
    ? `assets hdri ${first.id} --res 1k --out img/env`
    : `assets textures ${first.id} --res 1k --out img/mat`;
  console.log(`\n${hits.length} of ${rows.length}. Then: ${next}`);
  console.log('Both sources are CC0 1.0. No key, no attribution required on the assets themselves.');
}

/* -------------------------------------------------------------- download -- */

async function fetchInto(dir, filename, url, expect) {
  const buf = await req(url);
  const path = join(dir, filename);
  writeFileSync(path, buf);
  const sum = md5(buf);
  return { file: filename, path, url, bytes: buf.length, md5: sum, md5Verified: expect ? sum === expect : null };
}

function snippetTextures({ slug, dir, written, dimensionsMm, source }) {
  const byFile = new Map(written.map((w) => [w.slotFile, w]));
  const rel = (f) => `${dir.replace(/\\/g, '/').replace(/\/$/, '')}/${f}`;
  const L = [];
  /* The manifest carries the real-world size in millimetres, which is the
     difference between a tiling that is right and one that is eyeballed. */
  const round = (n, dp) => Number(n.toFixed(dp));
  const tileM = dimensionsMm ? round(dimensionsMm[0] / 1000, 3) : null;
  L.push(`import * as THREE from 'three';`);
  L.push('');
  L.push(`const loader = new THREE.TextureLoader();`);
  if (tileM) {
    L.push(`const SPAN = 4;          // metres across the surface you are covering`);
    L.push(`const TILE = ${tileM};       // ${slug} is ${round(dimensionsMm[0], 0)} x ${round(dimensionsMm[1], 0)} mm in the real world`);
    L.push(`const REPEAT = SPAN / TILE;`);
  } else {
    L.push(`const REPEAT = 2;        // ${source} publishes no real-world size for this one; set it by eye`);
  }
  L.push('');
  L.push(`const load = (file, srgb = false) => {`);
  L.push(`  const t = loader.load(file);`);
  L.push(`  if (srgb) t.colorSpace = THREE.SRGBColorSpace;   // colour maps only - never the data maps`);
  L.push(`  t.wrapS = t.wrapT = THREE.RepeatWrapping;`);
  L.push(`  t.repeat.set(REPEAT, REPEAT);                    // repeat does not propagate between maps`);
  L.push(`  return t;`);
  L.push(`};`);
  L.push('');
  const arm = byFile.get('arm');
  const taken = new Set();
  if (arm) {
    L.push(`// One image, three slots: AO in .r, roughness in .g, metalness in .b.`);
    L.push(`const arm = load('${rel(arm.file)}');`);
    for (const s of arm.slots) taken.add(s);
  }
  L.push(`const material = new THREE.MeshStandardMaterial({`);
  for (const w of written) {
    if (w.slotFile === 'arm') continue;
    const slots = w.slots.filter((s) => !taken.has(s));
    if (!slots.length) continue;              // ARM already covers it; the loose file is on disk anyway
    const value = `load('${rel(w.file)}'${w.srgb ? ', true' : ''})`;
    for (const slot of slots) { L.push(`  ${slot}: ${value},`); taken.add(slot); }
  }
  if (arm) L.push(`  aoMap: arm, roughnessMap: arm, metalnessMap: arm,`);
  /* The scalars multiply the maps, so 1 is the only value that leaves a map
     alone - and 1 with no metalnessMap present makes a plank of wood a mirror.
     Emit whichever is actually correct for what got downloaded. */
  const rough = taken.has('roughnessMap') ? '1' : '0.7';
  const metal = taken.has('metalnessMap') ? '1' : '0';
  L.push(`  roughness: ${rough}, metalness: ${metal},`);
  L.push(`});`);
  L.push('');
  L.push(`// roughness and metalness MULTIPLY their maps, so 1 is the only value that leaves`);
  L.push(`// a map untouched${taken.has('metalnessMap') ? '' : ` - and there is no metalnessMap here, so metalness stays 0. A 1 would\n// turn this into a mirror`}.`);
  if (byFile.get('disp')) {
    L.push('');
    L.push(`// displacementMap moves vertices that exist. On a PlaneGeometry(w, h) with no`);
    L.push(`// segments it does nothing at all - subdivide, or drop it and let normal + AO carry it.`);
  }
  L.push('');
  L.push(`// aoMap needs no uv2 attribute. The renderer reads material.aoMap.channel,`);
  L.push(`// which is 0 - the ordinary uv - by default. Tutorials that set uv2 predate that.`);
  return L.join('\n');
}

async function cmdTextures() {
  const slug = positional[0] || die('textures needs a slug. Run `assets search <query>` first.');
  const res = String(flag('res', '1k')).toLowerCase();
  const pick = String(flag('pick', 'web')).toLowerCase();
  const dir = resolve(String(flag('out', 'img/mat')));
  const asked = flag('source') ? String(flag('source')).toLowerCase() : null;
  let source = asked;

  /* No --source given: Poly Haven ids are lowercase with underscores and
     ambientCG's are CamelCase with a number, but the ids are not reserved
     against each other, so ask rather than pattern-match. /info is one small
     request and a 404 is the answer. */
  let info = null;
  if (source !== 'ambientcg') {
    info = await phInfo(slug);
    if (info && !source) source = 'polyhaven';
  }
  if (info && info.type === 0) die(`${slug} is an HDRI, not a texture. Run: assets hdri ${slug} --res 1k`);
  if (!info && source === 'polyhaven') die(`polyhaven has no asset called "${slug}". Run \`assets search ${slug}\`.`);
  if (!source) source = 'ambientcg';

  const written = [];
  const record = { command: 'textures', source, id: slug, resolution: res, out: dir, files: [] };

  if (source === 'polyhaven') {
    const files = await phFiles(slug);
    const plan = phPlan(files, res, pick);
    if (!plan.length) {
      const offered = [...new Set(Object.values(files).flatMap((m) => Object.keys(m || {})))].filter((k) => /^\d+k$/.test(k));
      die(`${slug} has no jpg maps at ${res}. It offers: ${offered.sort().join(', ') || 'nothing this tool reads'}`);
    }
    const total = plan.reduce((n, s) => n + files[s.key][res].jpg.size, 0);
    if (!JSON_OUT) console.log(`${slug} - ${plan.length} maps at ${res}, ${bytes(total)} on the wire`);
    mkdirSync(dir, { recursive: true });
    for (const slot of plan) {
      const entry = files[slot.key][res].jpg;
      const filename = `${slug}_${slot.file}.jpg`;
      const got = await fetchInto(dir, filename, entry.url, entry.md5);
      written.push({ ...got, slotFile: slot.file, slots: slot.slots, srgb: !!slot.srgb, map: slot.key });
      if (!JSON_OUT) {
        console.log(`  ${slot.slots.join(' + ').padEnd(38)} ${filename.padEnd(34)} ${bytes(got.bytes).padStart(9)}  md5 ${got.md5Verified ? 'ok' : 'MISMATCH'}`);
      }
    }
    record.name = info?.name || slug;
    record.authors = info?.authors || {};
    record.dimensionsMm = info?.dimensions || null;
    record.licence = 'CC0 1.0 - https://polyhaven.com/license';
    record.attributionRequired = false;
  } else {
    const asset = await acgAsset(slug);
    if (!asset) {
      die(asked
        ? `ambientcg has no asset called "${slug}". Ids are case-sensitive, like Wood095.`
        : `neither polyhaven nor ambientcg has an asset called "${slug}". Run \`assets search ${slug}\`.`);
    }
    const want = `${res.toUpperCase()}-JPG`;
    const zips = asset.downloadFolders?.default?.downloadFiletypeCategories?.zip?.downloads || [];
    const zip = zips.find((d) => d.attribute === want);
    if (!zip) die(`${asset.assetId} has no ${want} archive. It offers: ${zips.map((d) => d.attribute).join(', ')}`);
    if (!JSON_OUT) console.log(`${asset.assetId} - one ${want} archive, ${bytes(zip.size)} on the wire, unpacked here`);
    const buf = await req(zip.fullDownloadPath);
    const entries = unzip(buf);
    mkdirSync(dir, { recursive: true });
    for (const slot of ACG_SLOTS) {
      const hit = entries.find((e) => new RegExp(`_${slot.key}\\.(jpg|jpeg|png)$`, 'i').test(e.name));
      if (!hit) continue;
      if (pick !== 'all' && !slot.web) continue;
      const filename = `${asset.assetId}_${slot.file}${extname(hit.name).toLowerCase()}`;
      writeFileSync(join(dir, filename), hit.data);
      written.push({
        file: filename, path: join(dir, filename), url: zip.fullDownloadPath, bytes: hit.data.length,
        md5: md5(hit.data), md5Verified: null,
        slotFile: slot.file, slots: slot.slots, srgb: !!slot.srgb, map: slot.key,
      });
      if (!JSON_OUT) console.log(`  ${slot.slots.join(' + ').padEnd(38)} ${filename.padEnd(34)} ${bytes(hit.data.length).padStart(9)}`);
    }
    if (!written.length) die(`unpacked ${entries.length} files from ${zip.fileName} but none were maps this tool knows`);
    record.id = asset.assetId;
    record.name = asset.displayName || asset.assetId;
    record.dimensionsMm = asset.dimensionX > 0 ? [asset.dimensionX * 10, asset.dimensionY * 10] : null;
    record.licence = 'CC0 1.0 - https://docs.ambientcg.com/license/';
    record.attributionRequired = false;
    record.note = 'ambientCG ships no packed ARM map, so AO and roughness are separate files.';
  }

  record.fetched = new Date().toISOString();
  record.files = written.map((w) => ({ file: w.file, map: w.map, slots: w.slots, bytes: w.bytes, md5: w.md5, md5Verified: w.md5Verified, url: w.url }));
  const provenance = join(dir, `${record.id}.provenance.json`);
  writeFileSync(provenance, JSON.stringify(record, null, 2) + '\n');

  const snippet = snippetTextures({
    slug: record.id, dir: String(flag('out', 'img/mat')).replace(/\\/g, '/'),
    written, dimensionsMm: record.dimensionsMm, source,
  });
  const totalBytes = written.reduce((n, w) => n + w.bytes, 0);

  if (JSON_OUT) { out({ ...record, totalBytes, provenance, snippet }); return; }
  console.log(`  ${'provenance'.padEnd(38)} ${basename(provenance)}`);
  console.log(`\n${bytes(totalBytes)} written to ${dir}`);
  if (totalBytes > 1_500_000) {
    console.log(`These are archival-quality JPEGs. Re-encode before shipping: at 1k, WebP q82 puts a`);
    console.log(`full material around 250-400 KB, and the normal map survives it - measured under one`);
    console.log(`degree of deviation, which is invisible in a lit render.`);
  }
  console.log(`\n${snippet}`);
}

/* ------------------------------------------------------------------ hdri -- */

async function cmdHdri() {
  const slug = positional[0] || die('hdri needs a slug. Run `assets search <query>` first.');
  const res = String(flag('res', '1k')).toLowerCase();
  const fmt = String(flag('pick', 'hdr')).toLowerCase();
  if (!['hdr', 'exr'].includes(fmt)) die(`--pick takes hdr or exr, not "${fmt}"`);
  const dir = resolve(String(flag('out', 'img/env')));

  const info = await phInfo(slug);
  if (!info) die(`polyhaven has no asset called "${slug}". Run \`assets search ${slug}\`.`);
  if (info.type !== 0) die(`${slug} is a ${PH_TYPE[info.type] || 'non-HDRI'}, not an HDRI. Run: assets textures ${slug} --res ${res}`);

  const files = await phFiles(slug);
  const entry = files.hdri?.[res]?.[fmt];
  if (!entry) {
    const offered = Object.keys(files.hdri || {}).sort();
    die(`${slug} has no ${fmt} at ${res}. It offers: ${offered.join(', ')}`);
  }
  mkdirSync(dir, { recursive: true });
  const filename = `${slug}_${res}.${fmt}`;
  if (!JSON_OUT) console.log(`${info.name} - ${res} ${fmt}, ${bytes(entry.size)} on the wire`);
  const got = await fetchInto(dir, filename, entry.url, entry.md5);

  const record = {
    command: 'hdri', source: 'polyhaven', id: slug, name: info.name,
    authors: info.authors || {}, resolution: res, format: fmt, out: dir,
    licence: 'CC0 1.0 - https://polyhaven.com/license', attributionRequired: false,
    fetched: new Date().toISOString(),
    files: [{ file: got.file, bytes: got.bytes, md5: got.md5, md5Verified: got.md5Verified, url: got.url }],
  };
  const provenance = join(dir, `${slug}.provenance.json`);
  writeFileSync(provenance, JSON.stringify(record, null, 2) + '\n');

  const relDir = String(flag('out', 'img/env')).replace(/\\/g, '/').replace(/\/$/, '');
  const loader = fmt === 'hdr' ? 'HDRLoader' : 'EXRLoader';
  const snippet = [
    `import * as THREE from 'three';`,
    `// RGBELoader has been a deprecation shim since r180. HDRLoader is the real one.`,
    `import { ${loader} } from 'three/addons/loaders/${loader}.js';`,
    ``,
    `const pmrem = new THREE.PMREMGenerator(renderer);`,
    `pmrem.compileEquirectangularShader();          // pays the shader cost before first use`,
    ``,
    `new ${loader}().load('${relDir}/${filename}', (hdr) => {`,
    `  scene.environment = pmrem.fromEquirectangular(hdr).texture;  // prefiltered roughness pyramid`,
    `  // scene.background = scene.environment;     // only if the environment is meant to be SEEN`,
    `  hdr.dispose();`,
    `  pmrem.dispose();`,
    `});`,
    ``,
    `// An equirectangular map cannot be assigned to scene.environment raw - PBR needs the`,
    `// prefiltered mip chain, which is what PMREMGenerator builds. "${res}" here means`,
    `// ${res === '1k' ? '1024 x 512' : 'width x half-width'}, not a square.`,
  ].join('\n');

  if (JSON_OUT) { out({ ...record, provenance, snippet }); return; }
  console.log(`  ${filename.padEnd(40)} ${bytes(got.bytes).padStart(9)}  md5 ${got.md5Verified ? 'ok' : 'MISMATCH'}`);
  console.log(`  ${basename(provenance)}`);
  if (got.bytes > 3_000_000) {
    console.log(`\nThat is a lot of bytes for lighting. 1k is the ceiling for a runtime fetch; if the`);
    console.log(`environment is only there to light things and never to be seen, RoomEnvironment costs`);
    console.log(`nothing at all: new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04)`);
  }
  console.log(`\n${snippet}`);
}

/* ------------------------------------------------------------------- gen -- */
/* This command detects. It cannot see the agent's tool list from inside a child
   process, and pretending otherwise would be the worst kind of wrong - so it
   says that out loud, reports the evidence it CAN gather, and hands the
   decision back. */

const KEY_PROVIDERS = [
  { env: 'REPLICATE_API_TOKEN', name: 'Replicate' },
  { env: 'TOGETHER_API_KEY', name: 'Together' },
  { env: 'FAL_KEY', name: 'fal' },
  { env: 'BFL_API_KEY', name: 'Black Forest Labs' },
  { env: 'STABILITY_API_KEY', name: 'Stability' },
  { env: 'OPENAI_API_KEY', name: 'OpenAI' },
  { env: 'GEMINI_API_KEY', name: 'Google AI Studio' },
  { env: 'GOOGLE_API_KEY', name: 'Google AI Studio' },
  { env: 'HF_TOKEN', name: 'Hugging Face' },
  { env: 'HUGGING_FACE_HUB_TOKEN', name: 'Hugging Face' },
  { env: 'CLOUDFLARE_API_TOKEN', name: 'Cloudflare Workers AI', also: 'CLOUDFLARE_ACCOUNT_ID' },
];

const IMAGE_NAME = /(image|imagen|img|dall|flux|diffus|stab|midjourney|bloom|everart|recraft|ideogram|replicate|fal)/i;

function mcpEvidence() {
  const found = [];
  const seen = new Set();
  const add = (name, where) => {
    const k = name + '@' + where;
    if (seen.has(k)) return;
    seen.add(k);
    found.push({ server: name, config: where, looksLikeImageTool: IMAGE_NAME.test(name) });
  };
  const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };

  const candidates = [
    join(process.cwd(), '.mcp.json'),
    join(HOME, '.claude.json'),
    join(HOME, '.claude', 'settings.json'),
    join(HOME, '.claude', 'settings.local.json'),
  ];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    const j = readJson(p);
    if (!j) continue;
    for (const name of Object.keys(j.mcpServers || {})) add(name, p);
    const project = (j.projects || {})[process.cwd()];
    for (const name of Object.keys(project?.mcpServers || {})) add(name, p);
  }
  const toml = join(HOME, '.codex', 'config.toml');
  if (existsSync(toml)) {
    let text = '';
    try { text = readFileSync(toml, 'utf8'); } catch { text = ''; }
    for (const m of text.matchAll(/^\s*\[mcp_servers\.([^\].]+)\]/gm)) add(m[1], toml);
  }
  return found;
}

async function probeLocal(port, path) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(1200) });
    return { port, path, status: res.status, reachable: true };
  } catch (e) {
    return { port, path, reachable: false, error: e.name === 'TimeoutError' ? 'timeout' : e.message };
  }
}

async function cmdGen() {
  const prompt = positional.join(' ').trim();
  const model = flag('model') ? String(flag('model')).toLowerCase() : null;
  const target = flag('out') ? resolve(String(flag('out'))) : null;

  const keys = KEY_PROVIDERS
    .filter((p) => process.env[p.env] && String(process.env[p.env]).trim())
    .map((p) => ({ provider: p.name, variable: p.env, companion: p.also && !process.env[p.also] ? `${p.also} is not set` : null }));
  const mcp = mcpEvidence();
  const local = flag('no-probe') ? [] : await Promise.all([probeLocal(8188, '/system_stats'), probeLocal(7860, '/sdapi/v1/sd-models')]);
  const listening = local.filter((l) => l.reachable);

  const report = {
    command: 'gen', prompt: prompt || null, out: target,
    toolListCheck: 'Only the agent can see its own tools. Look for a tool matching *generate_image*, *image_generation* or *text_to_image* before using any route below.',
    mcpServersInLocalConfig: mcp,
    envKeys: keys,
    localGenerators: local,
    keyFreeRoute: {
      provider: 'pollinations.ai',
      run: `assets gen "<prompt>" --out <file.jpg> --model pollinations`,
      verified: {
        returns: 'image/jpeg regardless of the requested extension',
        maxSide: 768,
        models: ['sana'],
        modelParamHonoured: false,
        measured: 'a 768px image came back in 2.9s once and 44s another time - budget for the slow case',
      },
      unverified: 'its output licence - no legal page was read, so do not put it on a paying client site',
    },
    relighting: 'A generated image has its lighting baked in and cannot be relit. Use it as a plate, a texture or a cut-out, never as an object in a lit 3D scene.',
  };

  if (model === 'pollinations') {
    if (!prompt) die('gen --model pollinations needs a prompt');
    if (!target) die('gen --model pollinations needs --out <file.jpg>');
    const size = Math.min(768, Math.max(64, Number(String(flag('res', '768')).replace(/\D+/g, '')) || 768));
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${size}&height=${size}&nologo=true`;
    if (!JSON_OUT) console.log(`pollinations.ai, no key, ${size}x${size}, one model (sana). Seconds to tens of seconds; it varies a lot.`);
    let buf;
    try { buf = await req(url, { timeout: 180000 }); }
    catch (e) { die(`pollinations: ${e.message}`); }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, buf);
    const jpeg = buf[0] === 0xff && buf[1] === 0xd8;
    const result = { ...report, wrote: target, bytes: buf.length, jpeg, requested: size };
    if (JSON_OUT) { out(result); return; }
    console.log(`wrote ${target} - ${bytes(buf.length)}${jpeg ? ', JPEG' : ', not a JPEG - check it'}`);
    console.log(`No alpha. To use it as a cut-out plane, run: webdesign.mjs cut ${basename(target)}`);
    console.log(report.relighting);
    return;
  }
  if (model) die(`--model takes pollinations, which is the only route here that needs no credential. "${model}" would need one this tool does not have.`);

  if (JSON_OUT) { out(report); return; }

  console.log(`Image generation, in the order worth trying. Nothing below was called.\n`);
  console.log(`1  YOUR OWN TOOL LIST. A CLI cannot see it; you can. If a tool matching`);
  console.log(`   *generate_image*, *image_generation* or *text_to_image* is attached, CALL IT`);
  console.log(`   DIRECTLY and stop reading. The user configured and is paying for that provider,`);
  console.log(`   and it will beat everything below. Resolve any required argument it asks for`);
  console.log(`   through its own sibling tools rather than guessing, and expect submit-then-poll.`);
  if (mcp.length) {
    console.log(`   Local config names ${mcp.length} MCP server${mcp.length > 1 ? 's' : ''} (configured is not attached):`);
    for (const m of mcp.slice(0, 12)) console.log(`     ${m.server}${m.looksLikeImageTool ? '   <- name suggests images' : ''}`);
  } else {
    console.log(`   No MCP server is named in any local config file. That is weak evidence only -`);
    console.log(`   hosted connectors are configured server-side and never appear on disk.`);
  }
  console.log('');
  console.log(`2  A KEY YOU ALREADY HAVE.`);
  if (keys.length) {
    for (const k of keys) console.log(`   ${k.variable} is set -> ${k.provider}${k.companion ? ` (but ${k.companion})` : ''}`);
    console.log(`   This tool will not spend it for you: it has never run a request against that API`);
    console.log(`   from here, and a hand-written request shape it could not verify is worse than none.`);
    console.log(`   Use that provider's own SDK or MCP server.`);
  } else {
    console.log(`   None of ${KEY_PROVIDERS.map((p) => p.env).join(', ')} is set.`);
    console.log(`   Do not ask the user for one mid-build unless the page genuinely needs a generated image.`);
  }
  console.log('');
  console.log(`3  A LOCAL GENERATOR.`);
  if (listening.length) {
    for (const l of listening) console.log(`   127.0.0.1:${l.port}${l.path} answered ${l.status} - a local generator is running. Drive it directly.`);
  } else if (flag('no-probe')) {
    console.log(`   Not probed (--no-probe).`);
  } else {
    console.log(`   Nothing listening on 127.0.0.1:8188 (ComfyUI) or :7860 (A1111-style).`);
    console.log(`   Weights are 6-22 GB and licences differ per model - do not install one mid-build.`);
  }
  console.log('');
  console.log(`4  KEY-FREE HTTP: pollinations.ai.`);
  console.log(`   assets gen "${prompt || '<prompt>'}" --out img/plate.jpg --model pollinations`);
  console.log(`   Measured, not assumed: returns JPEG whatever extension you ask for, silently`);
  console.log(`   downscales anything over 768px (ask for 1024, get 768), and ignores the model`);
  console.log(`   parameter - /models offers exactly ["sana"] unauthenticated. Its output licence`);
  console.log(`   is UNVERIFIED, so keep it off paying client work.`);
  console.log('');
  console.log(`5  NO IMAGE. Often the right answer. A CC0 photograph, a real PBR material, or a`);
  console.log(`   gradient-mesh hero is specific to the subject and weighs less - references/imagery.md.`);
  console.log('');
  console.log(report.relighting);
}

/* --------------------------------------------------------------- runtime -- */

const run = async () => {
  switch (cmd) {
    case 'search': case 'find': await cmdSearch(); break;
    case 'textures': case 'texture': case 'material': await cmdTextures(); break;
    case 'hdri': case 'env': case 'environment': await cmdHdri(); break;
    case 'gen': case 'image': await cmdGen(); break;
    default:
      console.log(`ultimate-frontend-skills assets - CC0 materials, environment lighting, generated imagery

  search <query> [--source polyhaven|ambientcg] [--limit N] [--json]
                          what CC0 material sets and HDRIs exist for a surface
  textures <slug> [--res 1k|2k|4k|8k] [--out DIR] [--pick web|all] [--source X] [--json]
                          download a PBR set, normalise the filenames, verify the md5,
                          write provenance, print the three.js material that wires it up
  hdri <slug> [--res 1k|2k|4k|8k|16k] [--pick hdr|exr] [--out DIR] [--json]
                          the same for an environment map, with the PMREM wiring
  gen "<prompt>" [--out FILE] [--res 768] [--model pollinations] [--no-probe] [--json]
                          detect what this machine can actually do, and say what to do next

Poly Haven and ambientCG are both CC0 1.0: commercial use, no attribution, no key.
Crediting Poly Haven belongs in this tool's output, not in the site you build.
`);
      process.exit(cmd ? 1 : 0);
  }
};

run().catch((e) => die(e.status ? `${e.status} from ${e.url}` : e.message));
