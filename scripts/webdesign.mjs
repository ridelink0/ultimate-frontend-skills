#!/usr/bin/env node
/* ultimate-frontend-skills - scaffold and audit editorial websites.
   node webdesign.mjs new <dir> [--preset fable|bone|ink|cinema] [--name "X"] [--sections a,b,c]
   node webdesign.mjs sections                     list section ids
   node webdesign.mjs add <id> [--to <file>]       print a section, or append it to a file
   node webdesign.mjs audit <dir|file>             quality + bug check, exits 1 on error
   node webdesign.mjs serve <dir> [--port 4321]    local preview
   No dependencies. Node 18+. */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, watch } from 'node:fs';
import { join, dirname, resolve, extname, basename, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './preview-server.mjs';
import { parseArgs } from './args.mjs';
import { runAudit } from './audit.mjs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSETS = resolve(HERE, '..', 'skills', 'ultimate-frontend-skills', 'assets');

const argv = process.argv.slice(2);
const cmd = argv[0];

const die = (msg, code = 1) => { console.error('ultimate-frontend-skills: ' + msg); process.exit(code); };

// A mistyped flag is a usage error, and a usage error is one line. Letting
// parseArgs throw put a raw Node stack trace in front of anyone who typed
// `study --awards` with no query, which reads as a crash in the tool rather
// than a mistake in the command.
let positional, flag;
try {
  ({ positional, flag } = parseArgs(argv));
} catch (err) {
  die(err.message + '\nRun with no arguments for the usage.');
}

/* ------------------------------------------------------------- sections -- */
function loadSections() {
  const src = readFileSync(join(ASSETS, 'sections.html'), 'utf8');
  const out = new Map();
  const re = /<!--\s*@section\s+([\w-]+)\s*\|\s*([\s\S]*?)\s*-->\s*([\s\S]*?)\s*<!--\s*@end\s*-->/g;
  let m;
  while ((m = re.exec(src))) out.set(m[1], { note: m[2].trim(), body: m[3] });
  return out;
}

/* -------------------------------------------------------------- presets -- */
// Each preset is only a token override. The chassis never changes.
const PRESETS = {
  fable: {
    label: 'fable - the launch-page look: one photograph under a solid cream header, staggered serif title, dot-leader contents.',
    css: `:root{--accent-h:44;--nav-h:68px}
/* the photograph sits UNDER a solid bar, not behind a transparent one */
body{--bg:oklch(96.4% .008 88);--fg:oklch(22% .018 62);--fg-muted:oklch(44% .022 66)}
.nav{position:sticky;background:oklch(96.4% .008 88);color:oklch(22% .018 62);min-height:68px}
.nav .btn--ghost{background:oklch(22% .018 62);color:oklch(96.4% .008 88);border-color:transparent}
.hero{min-height:87svh}`,
    tone: '',
    themeColor: '#f7f5ef',
  },
  bone: {
    label: 'bone - warm paper ground, near-black type. The default.',
    css: `:root{--accent-h:62;--bg:var(--bone-100);--fg:var(--ink-800)}`,
    tone: '',
    themeColor: '#f2efe7',
  },
  ink: {
    label: 'ink - near-black ground throughout, bone type. For objects and night subjects.',
    css: `:root{--accent-h:48}\nbody{--bg:var(--ink-950);--fg:var(--bone-300);--fg-muted:var(--sand-400);\n  --bg-raised:var(--ink-900);--rule:color-mix(in oklab,var(--bone-300) 16%,transparent);\n  --rule-soft:color-mix(in oklab,var(--bone-300) 9%,transparent);color-scheme:dark}`,
    tone: ' data-tone="dark"',
    themeColor: '#0f0b09',
  },
  cinema: {
    label: 'cinema - photography carries the page; type sits on the image.',
    css: `:root{--accent-h:196;--section-y:clamp(6rem,3.5rem+10vw,13rem)}`,
    tone: '',
    themeColor: '#0f0b09',
  },
};

const DEFAULT_SECTIONS = ['nav', 'hero-photo', 'manifesto', 'services', 'stats', 'faq', 'contact', 'footer'];

/* ------------------------------------------------------------------ new -- */
function cmdNew() {
  const dir = resolve(positional[0] || die('new needs a target directory'));
  const presetName = String(flag('preset', 'bone'));
  const preset = PRESETS[presetName] || die(`unknown preset "${presetName}". Try: ${Object.keys(PRESETS).join(', ')}`);
  const name = String(flag('name', basename(dir).replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())));
  const wanted = String(flag('sections', DEFAULT_SECTIONS.join(',')))
    .split(',').map((s) => s.trim()).filter(Boolean);

  const sections = loadSections();
  const missing = wanted.filter((s) => !sections.has(s));
  if (missing.length) die(`unknown section(s): ${missing.join(', ')}\nRun "webdesign.mjs sections" for the list.`);
  const heroes = wanted.filter((s) => s.startsWith('hero-'));
  if (heroes.length > 1)
    die(`pick one hero, not ${heroes.length} (${heroes.join(', ')}). A page has one opening statement.`);

  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, 'img'), { recursive: true });

  for (const f of ['core.css', 'motion.js', 'gradient.js', 'depth.js', 'exploded.js', 'sky.js']) writeFileSync(join(dir, f), readFileSync(join(ASSETS, f)));

  const head = sections.get('head').body
    .replace(/SITE NAME/g, name)
    .replace('#f2efe7', preset.themeColor);

  let body = wanted
    .filter((s) => s !== 'head' && s !== 'foot')
    .map((s) => sections.get(s).body.replace(/Brand Name/g, name))
    .join('\n\n');

  // Two sections can legitimately carry the same id (every hero is #top).
  // Whichever comes first keeps it; the rest lose the attribute so the page is
  // never scaffolded with a duplicate.
  const seen = new Set();
  body = body.replace(/\sid=(["'])([\w-]+)\1/g, (m, q, id) => {
    if (seen.has(id)) return '';
    seen.add(id);
    return m;
  });

  // Point the nav at the sections that actually exist, so the scaffold never
  // ships a link to an anchor that is not there.
  // Only landmark ids belong in the nav. Matching every id in the document
  // put a form field's "f-name" in there as "F Name".
  const anchors = [...new Set(
    [...body.matchAll(/<(?:section|header|article|aside|footer)[^>]*?\sid=["']([\w-]+)["']/g)].map((m) => m[1]),
  )].filter((id) => id !== 'top' && id !== 'main');
  const label = (id) => id.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  body = body.replace(
    /<ul class="nav__links">[\s\S]*?<\/ul>/,
    anchors.length
      ? `<ul class="nav__links">\n` +
        anchors.slice(0, 4).map((id) => `    <li><a href="#${id}">${label(id)}</a></li>`).join('\n') +
        `\n  </ul>`
      : '',
  );
  const cta = anchors.includes('contact') ? 'contact' : anchors[anchors.length - 1];
  body = cta
    ? body.replace(/(<a class="btn btn--ghost" href=")#contact(")/, `$1#${cta}$2`)
    : body.replace(/<a class="btn btn--ghost"[\s\S]*?<\/a>/, '');
  // any remaining link to a section that was not included
  body = body.replace(/href="#([\w-]+)"/g, (m, id) =>
    anchors.includes(id) || id === 'top' || id === 'main' ? m : `href="#${cta || 'top'}"`);

  // Load only the engines this page actually uses. three.js alone is ~160 KB,
  // and shipping it to a page with no 3D on it is the kind of thing nobody
  // notices until the Lighthouse run.
  const needs = {
    gradient: /data-gradient|class="[^"]*\bgradient\b/.test(body),
    depth: /class="[^"]*\bdepth\b|data-depth=/.test(body),
    exploded: /class="[^"]*\bexploded\b/.test(body),
    sky: /data-sky/.test(body),
  };
  const engines = [];
  if (needs.gradient) engines.push('<script src="gradient.js" defer></script>');
  if (needs.depth) engines.push('<script src="depth.js" defer></script>');
  // An import map must come BEFORE any module script that relies on it, or the
  // browser refuses it outright. Emit it first.
  if (needs.exploded || needs.sky) {
    engines.push(
      '<script type="importmap">\n{"imports":{\n' +
      '  "three": "https://cdn.jsdelivr.net/npm/three@0.186.0/build/three.module.js",\n' +
      '  "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.186.0/examples/jsm/"\n' +
      '}}</script>',
    );
    if (needs.sky) engines.push('<script type="module" src="sky.js"></script>');
    if (needs.exploded) engines.push('<script type="module" src="exploded.js"></script>');
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
${head}
</head>
<body${preset.tone}>
<main id="main">
${body}
</main>
${sections.get('foot').body}${engines.length ? '\n' + engines.join('\n') : ''}
</body>
</html>
`;

  writeFileSync(join(dir, 'index.html'), html, 'utf8');

  // The 404. Netlify serves /404.html from the publish root as the custom
  // not-found page with no configuration, and every other static host has an
  // equivalent. A site without one hands a lost visitor the host's default
  // page, which is the one screen on the whole site nobody designed. Same
  // head, same nav, same footer; anchors point back at the index because this
  // is a different document, and only motion.js loads - there is nothing here
  // for an engine to draw.
  const navBlock = wanted.includes('nav') ? sections.get('nav').body.replace(/Brand Name/g, name) : '';
  const notFound = `<!DOCTYPE html>
<html lang="en">
<head>
${head.replace(/<title>[^<]*<\/title>/, `<title>Page not found - ${name}</title>`)}
</head>
<body${preset.tone}>
${navBlock}
<main id="main">
${sections.get('not-found').body}
</main>
${sections.get('footer').body.replace(/Brand Name/g, name)}
${sections.get('foot').body}
</body>
</html>
`.replace(/href="#/g, 'href="./#');
  writeFileSync(join(dir, '404.html'), notFound, 'utf8');
  writeFileSync(join(dir, 'site.css'),
`/* ${name} - project layer. core.css is the chassis; every choice specific to
   this subject belongs here. Do not edit core.css. */
${preset.css}

/* Derive --accent-h from the hero photograph: take the hue of the subject's
   own material, keep the L and C above. */
`, 'utf8');
  writeFileSync(join(dir, 'netlify.toml'),
`[build]
  publish = "."

[[headers]]
  for = "/*"
  [headers.values]
    X-Content-Type-Options = "nosniff"
    Referrer-Policy = "strict-origin-when-cross-origin"
    Strict-Transport-Security = "max-age=63072000; includeSubDomains; preload"
    Permissions-Policy = "camera=(), microphone=(), geolocation=(), payment=()"
    # Enforced on its own: frame-ancestors touches nothing but embedding, so
    # it cannot break the page, and it closes the clickjacking gap outright.
    Content-Security-Policy = "frame-ancestors 'none'"
    # The full policy, reporting only. The import map is an inline script to a
    # CSP, so enforcing this as written would silence three.js; add a nonce or
    # move to 'strict-dynamic' before promoting it. Check it with Google's CSP
    # Evaluator, then rename the header to Content-Security-Policy.
    Content-Security-Policy-Report-Only = "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"

[[headers]]
  for = "/*.css"
  [headers.values]
    Cache-Control = "public, max-age=0, must-revalidate"

[[headers]]
  for = "/*.js"
  [headers.values]
    Cache-Control = "public, max-age=0, must-revalidate"
`, 'utf8');

  console.log(`ultimate-frontend-skills: ${relative(process.cwd(), dir) || '.'} (${presetName})`);
  console.log(`  index.html  ${wanted.join(', ')}`);
  console.log(`  core.css motion.js gradient.js depth.js exploded.js site.css netlify.toml`);
  console.log(`\nNext: replace every word of placeholder copy, then "node webdesign.mjs audit ${dir}".`);
}

/* ----------------------------------------------------------------- list -- */
function cmdSections() {
  const s = loadSections();
  const w = Math.max(...[...s.keys()].map((k) => k.length));
  for (const [id, { note }] of s) console.log(`  ${id.padEnd(w)}  ${note}`);
  console.log(`\n  presets:`);
  for (const [id, p] of Object.entries(PRESETS)) console.log(`  ${id.padEnd(w)}  ${p.label}`);
}

function cmdAdd() {
  const id = positional[0] || die('add needs a section id');
  const s = loadSections();
  if (!s.has(id)) die(`unknown section "${id}"`);
  const block = s.get(id).body;
  const to = flag('to');
  if (!to || to === true) { console.log(block); return; }
  const p = resolve(String(to));
  const cur = existsSync(p) ? readFileSync(p, 'utf8') : '';
  // insert before </main> when there is one, else append
  const out = cur.includes('</main>')
    ? cur.replace('</main>', `\n${block}\n</main>`)
    : cur + '\n' + block + '\n';
  writeFileSync(p, out, 'utf8');
  console.log(`ultimate-frontend-skills: added "${id}" to ${relative(process.cwd(), p)}`);
}

/* ---------------------------------------------------------------- audit -- */
function cmdAudit() {
  const target = resolve(positional[0] || '.');
  let result;
  try { result = runAudit(target); } catch (e) { die(e.message); }
  console.log(result.text);
  process.exit(result.errors ? 1 : 0);
}

/* ---------------------------------------------------------------- serve -- */
function cmdServe() {
  const dir = resolve(positional[0] || '.');
  const port = parseInt(String(flag('port', '4321')), 10) || 4321;
  const srv = startServer(dir, port);
  srv.ref();
  console.log(`ultimate-frontend-skills: http://localhost:${port}  (${dir})`);
}

/* ----------------------------------------------------------------- look -- */
/* Renders the page in a real browser and reports what only a rendered page can
   show: text overlapping text, content past the viewport, unreadable contrast,
   collapsed elements, broken images. Static analysis cannot see any of it. */
async function cmdLook() {
  const target = positional[0] || '.';
  const out = String(flag('out', join(process.env.CLAUDE_SCRATCHPAD || tmpdir(), 'webdesign-shots')));
  const widths = String(flag('widths', '1440,390')).split(',').map((s) => parseInt(s, 10)).filter(Boolean);
  // Default probes the top AND one screen down: that is where parallax layers
  // drift into the headline, and where a top-only check said everything was fine.
  const scrolls = String(flag('scroll', '0,600')).split(',').map((s) => parseInt(s, 10)).filter((n) => !isNaN(n));
  const noShot = argv.includes('--no-shot');

  let url = target;
  let server = null;
  if (!/^https?:\/\//.test(target)) {
    // A single page is a legitimate target - a 404.html, a one-off landing
    // page - and rooting the server at the FILE served nothing at all. Root it
    // at the directory and open the file by name.
    const given = resolve(target);
    const isFile = existsSync(given) && statSync(given).isFile();
    const dir = isFile ? dirname(given) : given;
    const page = isFile ? basename(given) : '';
    if (!existsSync(dir)) die(`no such path: ${dir}`);
    const port = 4400 + Math.floor(Math.random() * 900);
    server = startServer(dir, port);
    url = `http://127.0.0.1:${port}/${page}`;
  }

  try {
    const { inspect, formatReport } = await import('./inspect.mjs');
    const results = await inspect(url, { widths, out: noShot ? null : out, scrolls });
    const { text, errors, warns } = formatReport(results);
    console.log(`\nwebdesign look  ${target}`);
    console.log(text);
    console.log(`\n  ${errors} error(s), ${warns} warning(s)`);
    if (!noShot) console.log(`\n  Read the PNGs. The report cannot tell you whether it looks good.`);
    process.exitCode = errors ? 1 : 0;
  } catch (e) {
    if (e && e.code === 'no-browser') {
      console.error('webdesign look: ' + e.message);
      process.exitCode = 2;
    } else throw e;
  } finally {
    if (server) server.close();
  }
}

/* ---------------------------------------------------------------- study -- */
/* Visual research as images. Renders a batch of sites at the top and one
   screen down, then tiles them into contact sheets so a dozen references are
   one picture to read. Curated lists cover the registers the skill builds in;
   pass your own URLs to study anything else. */
const STUDY_LISTS = {
  editorial: [
    'https://www.anthropic.com/claude-fable-and-mythos-5-1', 'https://www.anthropic.com/research',
    'https://www.are.na', 'https://readymag.com', 'https://www.kinfolk.com', 'https://www.aesop.com',
    'https://www.hodinkee.com', 'https://www.cartier.com',
  ],
  object: [
    'https://www.apple.com/airpods-pro/', 'https://www.apple.com/watch/', 'https://www.apple.com/iphone/',
    'https://www.teenage.engineering', 'https://www.leica-camera.com', 'https://www.bang-olufsen.com',
    'https://www.rolex.com', 'https://www.dyson.com',
  ],
  cinema: [
    'https://lusion.co', 'https://igloo.inc', 'https://www.igloo.inc', 'https://rauno.me',
    'https://www.awwwards.com/websites/parallax/', 'https://tympanus.net/codrops/',
    'https://www.nationalgeographic.com', 'https://www.patagonia.com',
  ],
  product: [
    'https://linear.app', 'https://stripe.com', 'https://vercel.com', 'https://resend.com',
    'https://www.framer.com', 'https://arc.net', 'https://www.raycast.com', 'https://cursor.com',
  ],
};

async function cmdStudy() {
  const listName = String(flag('list', ''));
  let urls = positional.filter((u) => /^https?:\/\//.test(u));
  if (listName) {
    const l = STUDY_LISTS[listName] || die(`unknown list "${listName}". Try: ${Object.keys(STUDY_LISTS).join(', ')}`);
    urls = urls.concat(l);
  }
  // A corpus query is the same thing as a list, chosen by the brief rather than
  // picked off a shelf: `study --awards "scroll-scrubbed 3D"` renders what the
  // corpus says solved that problem.
  const awardsQuery = flag('awards');
  if (awardsQuery) {
    const { queryAwards, pickReferences } = await import('./awards.mjs');
    const n = Number(flag('n', 3));
    // A query that matches nothing falls back to the register picker, so
    // `--awards object` works as well as `--awards "wireframe dissolve"`.
    const opts = { q: String(awardsQuery), kind: flag('kind'), technique: flag('technique'), limit: n };
    const matched = queryAwards(opts);
    const picked = matched.length ? matched : pickReferences(String(awardsQuery), n);
    if (!picked.length) die(`no corpus entries match "${awardsQuery}". Try: awards --techniques`);
    for (const e of picked) console.log(`  ref   ${e.name} - ${e.why || e.techniques.join(', ')}`);
    urls = urls.concat(picked.map((e) => e.url));
  }
  if (!urls.length) die('study needs URLs, --list editorial|object|cinema|product, or --awards <query>');
  const out = resolve(String(flag('out', join(process.env.CLAUDE_SCRATCHPAD || tmpdir(), 'webdesign-study', listName || 'custom'))));
  const scrolls = String(flag('scroll', '0,900')).split(',').map((s) => parseInt(s, 10)).filter((n) => !isNaN(n));
  mkdirSync(out, { recursive: true });
  const { inspect } = await import('./inspect.mjs');

  const tiles = [];
  for (const [i, url] of urls.entries()) {
    const dir = join(out, `s${String(i + 1).padStart(2, '0')}`);
    try {
      const r = await inspect(url, { widths: [1440], out: dir, scrolls, wait: 4200 });
      // A bot wall or an access-denied page is not a reference. Say so and
      // leave it out of the sheet rather than tiling a Cloudflare screen.
      const wall = r.some((s) => s.stats && s.stats.textElements < 12);
      if (wall) { console.log(`  wall  ${url}  (almost no text rendered - blocked, or a JS-only page)`); continue; }
      for (const shot of r) if (shot.file) tiles.push(shot.file);
      console.log(`  ok    ${url}`);
    } catch (e) {
      console.log(`  skip  ${url}  (${(e && e.message) || e})`);
    }
  }
  if (!tiles.length) die('nothing rendered');

  // Tile with ffmpeg when it is around; otherwise the PNGs are the result.
  const ff = ['ffmpeg', join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages')]
    .flatMap((p) => p === 'ffmpeg' ? [p] : (existsSync(p) ? readdirSync(p).filter((d) => /ffmpeg/i.test(d))
      .flatMap((d) => readdirSync(join(p, d)).filter((s) => /ffmpeg/i.test(s)).map((s) => join(p, d, s, 'bin', 'ffmpeg.exe'))) : []))
    .find((c) => c === 'ffmpeg' ? spawnSync('ffmpeg', ['-version'], { shell: false, windowsHide: true }).status === 0 : existsSync(c));

  const sheets = [];
  if (ff) {
    const per = 8; // 4 x 2 per sheet, each tile 640px wide - readable in one look
    for (let s = 0; s * per < tiles.length; s++) {
      const chunk = tiles.slice(s * per, s * per + per);
      const seq = join(out, `_seq${s}`);
      mkdirSync(seq, { recursive: true });
      chunk.forEach((f, k) => writeFileSync(join(seq, `t${String(k + 1).padStart(2, '0')}.png`), readFileSync(f)));
      const sheet = join(out, `sheet${s + 1}.jpg`);
      const r = spawnSync(ff, ['-hide_banner', '-loglevel', 'error', '-i', join(seq, 't%02d.png'),
        '-vf', 'scale=640:-2,tile=4x2:margin=4:padding=4:color=0x111111', '-frames:v', '1', '-q:v', '3', '-y', sheet]);
      if (r.status === 0) sheets.push({ sheet, urls: chunk.map((f) => basename(dirname(f)) + '/' + basename(f)) });
    }
  }
  console.log(`\nwebdesign study  ${urls.length} site(s), ${tiles.length} render(s) -> ${out}`);
  if (sheets.length) {
    console.log('  Read these, left to right, top to bottom:');
    for (const s of sheets) console.log(`  ${s.sheet}\n    ${s.urls.join('  ')}`);
  } else console.log('  no ffmpeg: read the PNGs under ' + out);
  console.log('\n  Each site: top of page, then one screen down. Write down what is specific, not what is generic.');
}

/* ------------------------------------------------------------------ cut -- */
/* A photograph into parallax planes: subject cut out, background with the
   hole dissolved, and the mask. This is how the reference sites get a bridge
   in front of a valley - one picture, several depths. Shells out to cut.py,
   which uses rembg (local AI background removal, no service, no key). */
function cmdCut() {
  const photo = positional[0] || die('cut needs a photo');
  const args = [join(HERE, 'cut.py'), resolve(photo)];
  for (const f of ['out', 'name', 'model']) { const v = flag(f); if (v && v !== true) args.push('--' + f, String(v)); }
  if (argv.includes('--alpha-matting')) args.push('--alpha-matting');
  for (const py of ['python', 'python3', 'py']) {
    const r = spawnSync(py, args, { stdio: 'inherit', shell: false, windowsHide: true });
    if (r.status !== null && r.status !== 9009 && !(r.error && r.error.code === 'ENOENT')) {
      process.exit(r.status || 0);
    }
  }
  die('python not found. Install Python 3.10+ then: python -m pip install "rembg[cpu]"');
}

/* ------------------------------------------------------------------ dev -- */
/* Serve, watch, and re-check on every save: source audit plus a real render
   with console errors, and a fresh PNG to look at. The whole debug loop in one
   command, so testing a page is never a reason not to. */
async function cmdDev() {
  const dir = resolve(positional[0] || '.');
  if (!existsSync(dir)) die(`no such path: ${dir}`);
  const port = parseInt(String(flag('port', '4321')), 10) || 4321;
  const widths = String(flag('widths', '1440')).split(',').map(Number).filter(Boolean);
  const scrolls = String(flag('scroll', '0,900')).split(',').map(Number).filter((n) => !isNaN(n));
  const shots = resolve(String(flag('out', join(dir, '.shots'))));

  const srv = startServer(dir, port);
  srv.ref();
  const url = `http://127.0.0.1:${port}/`;
  console.log(`ultimate-frontend-skills dev\n  ${url}\n  watching ${dir}\n  shots -> ${shots}\n`);

  const { inspect, formatReport } = await import('./inspect.mjs');
  let busy = false, again = false;
  const check = async (why) => {
    if (busy) { again = true; return; }
    busy = true;
    console.log(`\n─── ${why} ───`);
    try {
      // source first: it is instant, and half the bugs never need a browser
      const a = spawnSync(process.execPath, [fileURLToPath(import.meta.url), 'audit', dir], { encoding: 'utf8' });
      const src = (a.stdout || '').split('\n').filter((l) => /ERROR|warn/.test(l));
      console.log(src.length ? src.join('\n') : '  source ok');
      const res = await inspect(url, { widths, out: shots, scrolls });
      const { text, errors, warns } = formatReport(res);
      console.log(text);
      console.log(`  ${errors} error(s), ${warns} warning(s)`);
    } catch (e) {
      console.error('  ' + ((e && e.message) || e));
    }
    busy = false;
    if (again) { again = false; check('queued change'); }
  };

  let timer = null;
  const watchers = [];
  for (const d of [dir, join(dir, 'img')]) {
    if (!existsSync(d)) continue;
    try {
      watchers.push(watch(d, { persistent: true }, (_e, f) => {
        if (!f || /^\.|\.shots|~$/.test(f)) return;
        clearTimeout(timer);
        timer = setTimeout(() => check(`changed: ${f}`), 220);   // debounce the editor's two writes
      }));
    } catch {}
  }
  process.on('SIGINT', () => { watchers.forEach((w) => w.close()); srv.close(); process.exit(0); });
  await check('first run');
  console.log('\n  Save a file to re-check. Ctrl+C to stop.');
}

async function cmdDebug() {
  const { debugSite, readActions } = await import('./debug.mjs');
  const scroll = flag('scroll', 'auto');
  const result = await debugSite(positional[0] || '.', {
    out: flag('out'), widths: String(flag('widths', '1440,390')).split(',').map(Number),
    wait: Number(flag('wait', 1800)), motion: flag('motion', 'both'), actions: readActions(flag('actions')),
    scrolls: scroll === 'auto' ? 'auto' : String(scroll).split(',').map(Number),
    measured: Boolean(flag('measure')),
  });
  console.log(result.text);
  console.log('\nOpen the visual review: ' + result.file);
  console.log('Read the screenshots before declaring the website checked.');
  process.exitCode = result.errors ? 1 : 0;
}

// The other half of "does it look right": does it move right, cost right and
// read right. A still frame of a dead animation and a still frame of a live one
// are the same picture, so this measures the running page instead of looking at
// it - frame rate, whether each plane really travels at its own speed, what was
// loaded and never called, and whether the type is a scale or a pile.
async function cmdQuality() {
  const { debugSite } = await import('./debug.mjs');
  const { judge, formatQuality, BUDGETS } = await import('./measure.mjs');
  // Validated here, where the flags are parsed, the way inspect validates
  // widths and wait. A zero travel divided every plane rate into NaN, which
  // JSON laundered into null on the way back from the page and judge() then
  // tried to format - one bad flag killed the whole run after a full browser
  // pass.
  const record = Number(flag('record', 1600)), travel = Number(flag('travel', 700));
  if (!Number.isFinite(record) || record < 200 || record > 30000) die('--record must be milliseconds between 200 and 30000');
  if (!Number.isFinite(travel) || travel < 50 || travel > 20000) die('--travel must be pixels between 50 and 20000');
  const result = await debugSite(positional[0] || '.', {
    out: flag('out'), widths: String(flag('widths', '1440')).split(',').map(Number),
    wait: Number(flag('wait', 2200)),
    // Both, because reduced motion is a requirement and not a variant: a page
    // that keeps animating when the user asked it not to is a defect, and it
    // is invisible unless the same page is measured twice.
    motion: flag('motion', 'both'),
    scrolls: [0],
    measured: { motionMs: record, depthDistance: travel },
  });
  let errors = 0, warns = 0;
  for (const frame of result.results) {
    if (!frame.measured) continue;
    const found = judge(frame.measured, { expectDepth: Boolean(flag('expect-depth')) });
    const shown = formatQuality(frame.measured, found);
    errors += shown.errors;
    warns += shown.warns;
    console.log('\n  ' + frame.width + 'px, ' + (frame.reducedMotion ? 'reduced motion' : 'normal motion'));
    console.log(shown.lines || '  nothing measurable');
    if (Boolean(flag('json'))) console.log('  ' + JSON.stringify(frame.measured));
  }
  console.log('\n  ' + errors + ' over budget, ' + warns + ' worth looking at. Budgets: ' +
    BUDGETS.fps + ' fps, ' + BUDGETS.scriptKb + ' KB of script, ' + BUDGETS.distinctSizes + ' type sizes.');
  console.log('  Numbers are not the judgement. Open ' + result.file + ' and look at the page.');
  process.exitCode = errors ? 1 : 0;
}
// What the audit reads for taste, this reads for harm. Offline, over the files
// that would be deployed; the reference lists the three checks only a served
// site can answer. Exits 1 on high only - a checker that fails a build over a
// console.log is a checker people turn off.
async function cmdSecurity() {
  const { securityAudit, formatSecurity } = await import('./security.mjs');
  const target = resolve(positional[0] || '.');
  if (!existsSync(target)) die(`no such path: ${target}`);
  const result = securityAudit(target);
  const shown = formatSecurity(result, relative(process.cwd(), target) || '.');
  console.log(shown.text);
  if (flag('json')) console.log(JSON.stringify(result.findings, null, 2));
  process.exitCode = shown.high ? 1 : 0;
}
// One verdict instead of four separate ones to reconcile by hand.
async function cmdVerify() {
  const { runVerify, formatVerify } = await import('./verify.mjs');
  const target = positional[0] || '.';
  let result;
  try {
    result = await runVerify(/^https?:\/\//i.test(target) ? target : resolve(target), {
      widths: String(flag('widths', '1440,390')).split(',').map(Number),
      wait: Number(flag('wait', 1800)),
      design: flag('design'),
    });
  } catch (e) { die(e.message); }
  if (flag('json')) console.log(JSON.stringify(result, null, 2));
  else console.log(formatVerify(result));
  process.exitCode = result.exitCode;
}
/* Parity on its own, for when the question is only "is this still the design"
   and the rest of the verdict is not wanted yet. verify --design runs the same
   code and folds the result into the one verdict. */
async function cmdParity() {
  const { runParity, formatParity } = await import('./parity.mjs');
  const target = positional[0];
  const reference = flag('design') || positional[1];
  if (!target || !reference) die('parity needs a built page and a design: parity <dir|file|url> --design <canvas.html|page>');
  let result;
  try {
    result = await runParity(target, reference, {
      width: Number(String(flag('widths', '1440')).split(',')[0]),
      wait: Number(flag('wait', 2500)),
      frame: String(flag('frame', 'auto')),
    });
  } catch (e) { die(e.message); }
  if (flag('json')) console.log(JSON.stringify(result, null, 2));
  else console.log(formatParity(result));
  process.exitCode = result.errors ? 1 : 0;
}
async function cmdVideo() {
  const { studyVideo } = await import('./video.mjs');
  if (!positional[0]) die('video needs a local video file');
  const frames = studyVideo(positional[0], { out: flag('out'), frames: Number(flag('frames', 8)) });
  console.log(JSON.stringify(frames, null, 2));
  console.log('Open these frames in timestamp order; do not infer motion from one still.');
}

/* The reference corpus. Looking at three sites that solved the same problem
   differently is worth more than any amount of description of what good looks
   like, so this exists to pick them, and `study` exists to render them. */
async function cmdAwards() {
  const A = await import('./awards.mjs');
  if (flag('build')) {
    let report;
    try { report = A.buildCorpus(); } catch (e) { die(e.message); }
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  if (flag('stats')) { console.log(JSON.stringify(A.corpusStats(), null, 2)); return; }
  if (flag('check')) {
    const limit = flag('limit');
    const report = await A.checkCorpus({
      limit,
      concurrency: Number(flag('concurrency', 8)),
      onResult: (r, done, total) => {
        if (!flag('json') && !r.ok) console.log(`  dead  ${String(r.status).padStart(3)}  ${r.url}${r.error ? '  (' + r.error + ')' : ''}`);
        if (!flag('json') && done % 50 === 0) console.log(`  ...   ${done}/${total}`);
      },
    });
    report.stampedAt = new Date().toISOString();
    if (flag('fix')) {
      const changed = A.applyCheck(report);
      report.corpusUpdated = changed;
    }
    if (flag('json')) { console.log(JSON.stringify(report, null, 2)); return; }
    console.log(`\n${report.alive}/${report.checked} reachable, ${report.dead.length} dead, ${report.moved.length} moved.`);
    if (report.moved.length) for (const m of report.moved.slice(0, 10)) console.log(`  moved  ${m.url}\n      -> ${m.movedTo}`);
    if (!flag('fix') && (report.dead.length || report.moved.length)) console.log('Re-run with --fix to mark the dead ones unverified and follow the redirects.');
    return;
  }
  if (flag('techniques')) {
    const idx = A.techniqueIndex();
    if (flag('json')) { console.log(JSON.stringify(idx, null, 2)); return; }
    for (const { technique, count } of idx) console.log(`${String(count).padStart(4)}  ${technique}`);
    return;
  }
  const pick = flag('pick');
  const rows = pick
    ? A.pickReferences(pick, Number(flag('n', 3)), { kind: flag('kind'), technique: flag('technique'), since: flag('since') })
    : A.queryAwards({
      q: positional.join(' '),
      kind: flag('kind'), source: flag('source'), award: flag('award'),
      year: flag('year'), since: flag('since'), stack: flag('stack'),
      technique: flag('technique'), verified: !!flag('verified'),
      limit: flag('limit', pick ? 3 : 12),
    });
  if (flag('json')) { console.log(JSON.stringify(rows, null, 2)); return; }
  if (flag('urls')) { for (const e of rows) console.log(e.url); return; }
  if (!A.loadCorpus().length) die('the corpus is empty - run `awards --build` to merge data/awards/*.json');
  console.log(A.formatAwards(rows, { verbose: !!flag('verbose') }));
}

/* The three scripts that reach outside the page: Blender for geometry, the
   asset fetchers for CC0 textures and lighting, the bench check for what is
   installed. They live in their own files and run from here so there is one
   command surface to learn. */
async function delegate(script, rest) {
  const target = join(HERE, script);
  if (!existsSync(target)) die(`${script} is missing from this install`);
  const { spawn } = await import('node:child_process');
  await new Promise((done) => {
    const child = spawn(process.execPath, [target, ...rest], { stdio: 'inherit', windowsHide: true });
    child.on('error', (e) => { console.error(e.message); process.exitCode = 1; done(); });
    child.on('close', (code) => { process.exitCode = code === null ? 1 : code; done(); });
  });
}

/* ------------------------------------------------------------------ main -- */
switch (cmd) {
  case 'new': cmdNew(); break;
  case 'sections': case 'list': cmdSections(); break;
  case 'add': cmdAdd(); break;
  case 'audit': case 'check': cmdAudit(); break;
  case 'look': case 'shot': await cmdLook(); break;
  case 'cut': cmdCut(); break;
  case 'study': await cmdStudy(); break;
  case 'dev': await cmdDev(); break;
  case 'serve': cmdServe(); break;
  case 'debug': await cmdDebug(); break;
  case 'quality': case 'measure': await cmdQuality(); break;
  case 'security': case 'secure': await cmdSecurity(); break;
  case 'verify': await cmdVerify(); break;
  case 'parity': await cmdParity(); break;
  case 'video': await cmdVideo(); break;
  case 'awards': case 'refs': await cmdAwards(); break;
  case 'blender': await delegate('blender.mjs', argv.slice(1)); break;
  case 'assets': case 'texture': case 'textures': await delegate('assets.mjs', argv.slice(1)); break;
  case 'tools': case 'bench': await delegate('tools.mjs', argv.slice(1)); break;
  default:
    console.log(`ultimate-frontend-skills

  new <dir> [--preset fable|bone|ink|cinema] [--name "X"] [--sections a,b,c]
  sections                        list section ids and presets
  add <id> [--to <file>]          print a section, or insert it before </main>
  audit <dir|file>                source check: copy, semantics, the tells
  look <dir|file|url> [--widths 1440,390] [--scroll 0,600] [--out DIR] [--no-shot]
                                  RENDER it: overlap, overflow, contrast, PNGs
  cut <photo> [--out DIR] [--name base] [--model isnet-general-use|u2net] [--alpha-matting]
                                  one photograph into parallax planes (rembg, local)
  study <url...> | --list editorial|object|cinema|product | --awards <query> [--n 3]
        [--scroll 0,900] [--out DIR]
                                  render a batch of reference sites into contact sheets
  awards [query] [--kind 3d|editorial|product|portfolio|ecommerce|brand|experiment]
         [--source awwwards|fwa|threejs|codrops|...] [--award sotd|sotm|soty|honourable]
         [--technique X] [--stack X] [--since YEAR] [--limit N] [--verbose] [--json|--urls]
  awards --pick object|product|place|service|argument|portfolio|3d|editorial [--n 3]
                                  three references that disagree with each other
  awards --techniques | --stats | --build
                                  what the corpus knows, how big it is, rebuild it from chunks
  blender <probe|run|glb|bake|frames> ...   author geometry, bake, render (Blender headless)
  assets <search|textures|hdri|gen> ...     CC0 PBR materials, HDRI lighting, generated imagery
  tools                           what else is installed on this bench and what changes because of it
  dev <dir> [--port 4321] [--widths 1440] [--scroll 0,900]
                                  serve + watch: re-audits and re-renders on every save
  serve <dir> [--port 4321]       local preview
  debug <dir|url> [--actions FILE] [--motion both|normal|reduce] [--wait MS] [--out DIR]
                                  screenshots, scroll, interaction and 3D evidence in an HTML review
  quality <dir|url> [--widths 1440] [--record MS] [--travel PX] [--expect-depth] [--json]
                                  measure the running page: frame rate, real parallax rates, idle libraries, type scale
  security <dir> [--json]         secrets, forms, CDN pins, headers config, disclosures - exits 1 on high
  parity <dir|file|url> --design <canvas.html|page> [--widths 1440] [--json]
                                  compare a built page against its Claude Design artboard: type sizes,
                                  palette, vertical rhythm, content geometry
  verify <dir|url> [--widths 1440,390] [--wait MS] [--design REF] [--json]
                                  one verdict: audit + render/quality + security (+ design parity), by severity
  video <file> [--frames 8] [--out DIR]   inspect timestamped local video frames
`);
    process.exit(cmd ? 1 : 0);
}
