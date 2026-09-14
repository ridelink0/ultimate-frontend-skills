#!/usr/bin/env node
/* ultimate-frontend-skills - Blender, headless, for website assets.
   node blender.mjs probe [--json] [--exe <path>]
   node blender.mjs run <script.py> [--blend <file>] [-- args...]
   node blender.mjs glb <script.py> --out <file.glb> [--no-draco] [-- args...]
   node blender.mjs bake <blend> --out <dir> [--res 1024] [--samples 64] [--passes diffuse,normal,ao]
   node blender.mjs frames <blend> --out <dir> --count 90 [--res 900] [--samples 16] [--format PNG]

   Every command runs "-b --factory-startup -noaudio --python-exit-code 1".
   Without --python-exit-code, Blender exits 0 on a script that raised, and a
   caller checking the exit code sees success on a run that did nothing.
   No dependencies. Node 18+. */

import { existsSync, statSync, readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve, isAbsolute, extname, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATES = join(HERE, 'blender');

const die = (msg, code = 1) => { console.error('blender: ' + msg); process.exit(code); };

/* --------------------------------------------------------------- argv ---- */
/* Its own parser rather than args.mjs, because "--" here is a boundary and not
   a hint: everything after it belongs to the Python script, including Cycles
   flags like "-- --cycles-device OPTIX" that Blender itself reads back out. */
const argv = process.argv.slice(2);
const cmd = argv[0];
const boundary = argv.indexOf('--');
const own = boundary === -1 ? argv.slice(1) : argv.slice(1, boundary);
const passthrough = boundary === -1 ? [] : argv.slice(boundary + 1);

const VALUES = new Set(['out', 'count', 'res', 'samples', 'format', 'blend', 'exe', 'engine', 'device', 'passes', 'script']);
const BOOLS = new Set(['json', 'no-draco', 'quiet']);

const positional = [];
const options = {};
for (let i = 0; i < own.length; i++) {
  const arg = own[i];
  if (!arg.startsWith('--')) { positional.push(arg); continue; }
  const [key, ...rest] = arg.slice(2).split('=');
  if (VALUES.has(key)) {
    const value = rest.length ? rest.join('=') : own[++i];
    if (value === undefined || value.startsWith('--')) die(`missing value for --${key}`);
    options[key] = value;
  } else if (BOOLS.has(key) && !rest.length) options[key] = true;
  else die(`unknown option: ${arg}`);
}
const flag = (name, fallback = null) => (options[name] ?? fallback);
const num = (name, fallback) => {
  const v = flag(name);
  if (v === null) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) die(`--${name} must be a number, got "${v}"`);
  return n;
};

/* -------------------------------------------------------------- locate ---- */
/* Order: --exe, $BLENDER, PATH, then the install locations each platform
   actually uses. Every candidate is proved by running --version; a path that
   exists but does not answer is not Blender. Nothing here is ever handed to a
   later command unproved - a guessed path turns into a silent no-op three
   stages downstream. */
function onPath(binary) {
  const dirs = String(process.env.PATH || process.env.Path || '').split(process.platform === 'win32' ? ';' : delimiter);
  const names = process.platform === 'win32' ? [binary + '.exe', binary + '.bat', binary + '.cmd'] : [binary];
  for (const dir of dirs.filter(Boolean)) for (const name of names) {
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function childrenOf(root) {
  try { return readdirSync(root); } catch { return []; }
}

function candidates() {
  const searched = [];
  const found = [];
  const consider = (p, why) => { if (p) { searched.push(p); if (existsSync(p)) found.push({ exe: p, via: why }); } };

  if (flag('exe')) {
    const p = resolve(String(flag('exe')));
    if (!existsSync(p)) die(`--exe ${p} does not exist`);
    return { found: [{ exe: p, via: '--exe' }], searched: [p] };
  }
  if (process.env.BLENDER) consider(resolve(process.env.BLENDER), '$BLENDER');
  const onp = onPath('blender');
  if (onp) consider(onp, 'PATH');

  const env = process.env;
  if (process.platform === 'win32') {
    const roots = [
      join(env['ProgramFiles'] || 'C:\\Program Files', 'Blender Foundation'),
      join(env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Blender Foundation'),
      join(env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Steam', 'steamapps', 'common'),
      env.LOCALAPPDATA ? join(env.LOCALAPPDATA, 'Programs', 'Blender Foundation') : null,
      env.LOCALAPPDATA ? join(env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Packages') : null,
    ].filter(Boolean);
    for (const root of roots) {
      searched.push(root + '\\*');
      for (const child of childrenOf(root).filter((c) => /blender/i.test(c))) {
        consider(join(root, child, 'blender.exe'), 'install');
        consider(join(root, child, 'blender', 'blender.exe'), 'install');
      }
    }
  } else if (process.platform === 'darwin') {
    consider('/Applications/Blender.app/Contents/MacOS/Blender', 'install');
    if (env.HOME) consider(join(env.HOME, 'Applications', 'Blender.app', 'Contents', 'MacOS', 'Blender'), 'install');
    for (const child of childrenOf('/Applications').filter((c) => /^Blender/i.test(c))) {
      consider(join('/Applications', child, 'Contents', 'MacOS', 'Blender'), 'install');
    }
  } else {
    for (const p of ['/usr/bin/blender', '/usr/local/bin/blender', '/snap/bin/blender', '/var/lib/flatpak/exports/bin/org.blender.Blender']) consider(p, 'install');
    for (const child of childrenOf('/opt').filter((c) => /blender/i.test(c))) consider(join('/opt', child, 'blender'), 'install');
  }
  return { found, searched };
}

function versionOf(exe) {
  const run = spawnSync(exe, ['--version'], { encoding: 'utf8', shell: false, windowsHide: true, timeout: 30000 });
  if (run.error || run.status !== 0) return null;
  const first = String(run.stdout || '').split(/\r?\n/).find((l) => l.trim());
  if (!first || !/^Blender\s/i.test(first.trim())) return null;
  return first.trim();
}

function probe() {
  const { found, searched } = candidates();
  for (const c of found) {
    const version = versionOf(c.exe);
    if (!version) continue;
    const m = version.match(/(\d+)\.(\d+)(?:\.(\d+))?/);
    return {
      found: true, exe: c.exe, via: c.via, version,
      major: m ? Number(m[1]) : null, minor: m ? Number(m[2]) : null, patch: m && m[3] ? Number(m[3]) : 0,
      searched,
    };
  }
  return { found: false, exe: null, version: null, searched };
}

const NOT_FOUND = [
  'no Blender found.',
  '  Looked at: $BLENDER, PATH, and the standard install locations.',
  '  Point at one explicitly:  --exe "C:\\Program Files\\Blender Foundation\\Blender 4.3\\blender.exe"',
  '  or set BLENDER in the environment. Download: https://www.blender.org/download/',
  '  Stage 4 has no modelling route without it - author the geometry in three.js instead.',
].join('\n');

/* Every command that runs Blender goes through this, so no command can be
   handed a path that was never proved. */
function requireBlender() {
  const p = probe();
  if (!p.found) die(NOT_FOUND, 3);
  if (p.major !== null && p.major < 4) {
    console.error(`blender: warning - ${p.version}. The templates here are written against 4.3 and use 4.x-only names`);
    console.error('  (BLENDER_EEVEE_NEXT, "Specular IOR Level", shade_smooth_by_angle). Expect them to fail on 3.x.');
  }
  return p;
}

/* ---------------------------------------------------------------- run ---- */
function invocation({ blend = null, script, args = [], engine = null }) {
  // Order is load-bearing: Blender executes arguments left to right, so every
  // setting must precede the thing it configures.
  const a = ['-b', '--factory-startup', '-noaudio', '--python-exit-code', '1'];
  if (blend) a.push(blend);
  if (engine) a.push('-E', engine);
  a.push('-P', script);
  if (args.length) a.push('--', ...args);
  return a;
}

function runBlender(exe, args, { quiet = false } = {}) {
  if (!quiet) console.log('  ' + [exe, ...args].map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ') + '\n');
  return new Promise((done) => {
    const child = spawn(exe, args, { stdio: 'inherit', shell: false, windowsHide: true });
    child.on('error', (e) => { console.error('blender: ' + e.message); done(1); });
    child.on('close', (code) => done(code === null ? 1 : code));
  });
}

function scriptPath(given, what) {
  if (!given) die(`${what} needs a Python script`);
  const direct = resolve(String(given));
  if (existsSync(direct)) return direct;
  const shipped = join(TEMPLATES, String(given).endsWith('.py') ? String(given) : String(given) + '.py');
  if (existsSync(shipped)) return shipped;
  die(`no such script: ${direct}\n  Shipped templates: ${readdirSync(TEMPLATES).filter((f) => f.endsWith('.py')).join(', ')}`);
}

function blendPath(given, what) {
  if (!given) die(`${what} needs a .blend file`);
  const p = resolve(String(given));
  if (!existsSync(p)) die(`no such .blend: ${p}`);
  return p;
}

function outPath(what, { dir = false } = {}) {
  const given = flag('out');
  if (!given) die(`${what} needs --out`);
  const p = isAbsolute(String(given)) ? String(given) : resolve(String(given));
  mkdirSync(dir ? p : dirname(p), { recursive: true });
  return p;
}

const kb = (n) => (n < 1024 ? n + ' B' : (n / 1024).toFixed(1) + ' KB');

/* ---------------------------------------------------------------- glb ---- */
/* A GLB is a 12-byte header then length-prefixed chunks; the first is JSON.
   Reading the node names back is the only proof that the parts are addressable
   from a web runtime, which is the whole reason to model in Blender rather
   than in three.js. */
function readGlb(file) {
  const buf = readFileSync(file);
  if (buf.length < 20) return { ok: false, why: 'shorter than a GLB header' };
  if (buf.readUInt32LE(0) !== 0x46546c67) return { ok: false, why: 'not a GLB (bad magic)' };
  const version = buf.readUInt32LE(4);
  const total = buf.readUInt32LE(8);
  let at = 12, json = null, binBytes = 0;
  while (at + 8 <= buf.length) {
    const len = buf.readUInt32LE(at), type = buf.readUInt32LE(at + 4);
    const body = buf.subarray(at + 8, at + 8 + len);
    if (type === 0x4e4f534a) { try { json = JSON.parse(body.toString('utf8')); } catch { return { ok: false, why: 'JSON chunk did not parse' }; } }
    if (type === 0x004e4942) binBytes = len;
    at += 8 + len + ((4 - (len % 4)) % 4);
  }
  if (!json) return { ok: false, why: 'no JSON chunk' };
  return {
    ok: true, version, total, binBytes, json,
    nodes: (json.nodes || []).map((n) => n.name).filter(Boolean),
    meshes: (json.meshes || []).map((m) => m.name).filter(Boolean),
    materials: (json.materials || []).map((m) => m.name).filter(Boolean),
    used: json.extensionsUsed || [],
    required: json.extensionsRequired || [],
    generator: (json.asset && json.asset.generator) || null,
  };
}

async function cmdGlb() {
  const b = requireBlender();
  const script = scriptPath(positional[0], 'glb');
  const out = outPath('glb');
  if (extname(out).toLowerCase() !== '.glb') die(`--out must end in .glb, got ${out}`);
  const args = ['--out', out];
  if (flag('no-draco')) args.push('--no-draco');
  const code = await runBlender(b.exe, invocation({ blend: flag('blend') ? blendPath(flag('blend'), 'glb') : null, script, args: args.concat(passthrough) }), { quiet: flag('quiet') });
  if (code !== 0) die(`the authoring script failed (exit ${code}). The GLB was not written.`, code);

  // Blender returns {'FINISHED'} and exits 0 for an export that wrote nothing,
  // so the only proof is the file.
  if (!existsSync(out)) {
    die([`${out} was not written, although Blender exited 0.`,
      '  Almost always a relative path inside the script: bpy.ops.export_scene.gltf(filepath=...)',
      '  needs an ABSOLUTE path, and reports FINISHED either way.'].join('\n'));
  }
  const size = statSync(out).size;
  if (size === 0) die(`${out} is zero bytes.`);

  const g = readGlb(out);
  if (!g.ok) die(`${out} exists (${kb(size)}) but is not a readable GLB: ${g.why}`);
  console.log(`\n  ${out}`);
  console.log(`  ${size} bytes (${kb(size)})  glTF ${g.version}  ${g.binBytes ? kb(g.binBytes) + ' of buffer' : 'no BIN chunk'}`);
  if (g.generator) console.log(`  generator   ${g.generator}`);
  console.log(`  nodes       ${g.nodes.join(', ') || '(unnamed)'}`);
  console.log(`  meshes      ${g.meshes.join(', ') || '(unnamed)'}`);
  console.log(`  materials   ${g.materials.join(', ') || '(none)'}`);
  if (g.used.length) console.log(`  extensions  ${g.used.join(', ')}`);
  const unnamed = g.meshes.filter((n) => /^(Cube|Cylinder|Sphere|Circle|Plane|Torus|Cone|Grid|Icosphere)(\.\d+)?$/.test(n));
  if (unnamed.length) console.log(`  warning     ${unnamed.length} mesh(es) still carry primitive names: ${unnamed.join(', ')}\n              set ob.data.name = ob.name before export or devtools shows Cube.003`);
  if (g.required.includes('KHR_draco_mesh_compression')) {
    console.log('\n  Draco is in extensionsRequired: this file will not load at all without DRACOLoader.');
    console.log('  Wire it up, and serve the decoder from your own origin - a CSP with connect-src \'self\'');
    console.log('  blocks a CDN decoder path and the failure looks like a broken model, not a blocked fetch.');
  }
  if (!g.nodes.length) console.log('\n  warning: no named nodes. scene.getObjectByName() has nothing to find.');
}

/* --------------------------------------------------------------- bake ---- */
async function cmdBake() {
  const b = requireBlender();
  const blend = blendPath(positional[0], 'bake');
  const out = outPath('bake', { dir: true });
  const script = scriptPath(flag('script') || join(TEMPLATES, 'bake.py'), 'bake');
  const before = new Set(readdirSync(out));
  const args = ['--out', out, '--res', String(num('res', 1024)), '--samples', String(num('samples', 64)), '--passes', String(flag('passes', 'diffuse,normal,ao'))];
  const code = await runBlender(b.exe, invocation({ blend, script, args: args.concat(passthrough) }), { quiet: flag('quiet') });
  if (code !== 0) die(`bake failed (exit ${code})`, code);
  const written = readdirSync(out).filter((f) => !before.has(f));
  if (!written.length) die(`${out} gained no files, although Blender exited 0.\n  Baking needs CYCLES, an ACTIVE image texture node per material, and img.save() to an absolute path.`);
  console.log('');
  for (const f of written.sort()) console.log(`  ${f.padEnd(34)} ${kb(statSync(join(out, f)).size)}`);
  console.log(`\n  ${written.length} map(s) -> ${out}`);
}

/* ------------------------------------------------------------- frames ---- */
async function cmdFrames() {
  const b = requireBlender();
  const blend = blendPath(positional[0], 'frames');
  const out = outPath('frames', { dir: true });
  const count = num('count', 0);
  if (!count || count < 1) die('frames needs --count N (how many frames the turn is cut into)');
  if (count > 600) die(`--count ${count} is a video, not a scroll sequence. Encode one instead.`);
  const script = scriptPath(flag('script') || join(TEMPLATES, 'turntable.py'), 'frames');
  const args = ['--out', out, '--count', String(count), '--res', String(num('res', 900)),
    '--samples', String(num('samples', 16)), '--format', String(flag('format', 'PNG')).toUpperCase()];
  const started = Date.now();
  const code = await runBlender(b.exe, invocation({ blend, script, args: args.concat(passthrough), engine: flag('engine') }), { quiet: flag('quiet') });
  if (code !== 0) die(`render failed (exit ${code})`, code);

  const ext = String(flag('format', 'PNG')).toLowerCase() === 'webp' ? '.webp' : '.png';
  const files = readdirSync(out).filter((f) => f.toLowerCase().endsWith(ext)).sort();
  if (files.length !== count) {
    die([`asked for ${count} frames, found ${files.length} ${ext} file(s) in ${out}.`,
      '  A relative scene.render.filepath renders to completion, returns FINISHED, and writes nothing.'].join('\n'));
  }
  const bytes = files.reduce((n, f) => n + statSync(join(out, f)).size, 0);
  const secs = (Date.now() - started) / 1000;
  console.log(`\n  ${files.length} frames  ${files[0]} .. ${files[files.length - 1]}`);
  console.log(`  ${kb(bytes)} total, ${kb(Math.round(bytes / files.length))} per frame, ${secs.toFixed(1)}s wall`);
  console.log(`  ${out}`);
  if (bytes > 2_000_000) console.log('\n  Over 2 MB of sequence. That is the heaviest thing on the page - cut frames or cut resolution,');
  console.log('  Preload and decode every frame before the scrub starts, or it hitches where the choreography peaks.');
}

/* ---------------------------------------------------------------- main ---- */
switch (cmd) {
  case 'probe': {
    const p = probe();
    if (flag('json')) {
      console.log(JSON.stringify(p, null, 2));
      process.exit(p.found ? 0 : 3);
    }
    if (!p.found) {
      console.error(NOT_FOUND);
      console.error('  Searched:\n' + p.searched.map((s) => '    ' + s).join('\n'));
      process.exit(3);
    }
    console.log(`  ${p.version}`);
    console.log(`  ${p.exe}`);
    console.log(`  found via ${p.via}`);
    if (p.major < 4) console.log('  warning: the templates here target 4.3. On 3.x the engine id, the Principled socket names and shade_smooth_by_angle are all different.');
    break;
  }
  case 'run': {
    const b = requireBlender();
    const script = scriptPath(positional[0], 'run');
    const blend = flag('blend') ? blendPath(flag('blend'), 'run') : null;
    const code = await runBlender(b.exe, invocation({ blend, script, args: passthrough, engine: flag('engine') }), { quiet: flag('quiet') });
    process.exit(code);
  }
  case 'glb': await cmdGlb(); break;
  case 'bake': await cmdBake(); break;
  case 'frames': await cmdFrames(); break;
  default:
    console.log(`blender - headless Blender for website assets

  probe [--json] [--exe <path>]
                                  find it, prove it answers, print the version. Exit 3 when absent.
  run <script.py> [--blend <file>] [--engine E] [-- args...]
                                  -b --factory-startup -noaudio --python-exit-code 1 -P <script>
                                  args after -- reach the script as sys.argv past the "--"
  glb <script.py> --out <file.glb> [--blend <file>] [--no-draco] [-- args...]
                                  author, export, then prove the GLB: bytes, node names, extensions
  bake <blend> --out <dir> [--res 1024] [--samples 64] [--passes diffuse,normal,ao]
                                  Cycles bake to PNG maps, then prove the files landed
  frames <blend> --out <dir> --count N [--res 900] [--samples 16] [--format PNG|WEBP]
                                  turntable sequence, transparent film, then count the frames

  Templates it drives: ${existsSync(TEMPLATES) ? readdirSync(TEMPLATES).filter((f) => f.endsWith('.py')).join(' ') : '(none installed)'}
  Most pages should not use any of this. references/blender.md opens with when not to.
`);
    process.exit(cmd ? 1 : 0);
}
