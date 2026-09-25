/* ultimate-frontend-skills/audit - static quality + bug check over the source files.
   Split out of webdesign.mjs so `verify` can call it as a library function: the
   CLI command used to end in a bare process.exit(), which is fine for a
   terminal but means nothing calling into the same module can ever get a
   result back instead of having the whole process torn down under it. */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, extname, relative, basename } from 'node:path';

const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE0F}\u{1F1E6}-\u{1F1FF}]/u;
// Copy that shipped from the scaffold and was never replaced. Deliberately
// specific: the bare word "placeholder" is a legitimate thing to write in prose.
const PLACEHOLDERS = [
  'lorem ipsum', 'site name', 'brand name', 'your text here', 'placeholder text',
  'first half of the claim', 'one sentence under the headline', 'two short paragraphs',
  'the line that reframes', 'coming soon', 'foo bar',
  'describe the geometry', 'a sentence someone actually said', 'one last sentence',
  'the question a real person asks', 'say the grade, not the adjective',
  'the single action', 'one or two lines', 'name, role',
];

// Invented specifics. A generated page reaches for these instead of leaving a
// field empty, and they are the fastest way to spot one.
const FAKE_DATA = [
  [/via\.placeholder\.com|placehold\.(it|co)|picsum\.photos|dummyimage\.com/i, 'placeholder image service'],
  [/\b[\w.+-]+@(example|test|domain|yoursite|yourcompany)\.(com|org|net)\b/i, 'example.com email address'],
  [/\b\(?555\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/, 'a 555 phone number'],
  [/\b123 (main|any) (st|street)\b/i, 'a fake street address'],
  [/\b(your ?company|company name|acme|your ?brand|business name)\b/i, 'an unfilled company name'],
  [/\b(john|jane) (doe|smith)\b/i, 'a placeholder person'],
];

// Marketing language that reads as machine-written. The 2023 words (delve,
// tapestry) are not here: models were patched off them and tells.md says not
// to fight the last war. The tell moved to canned emphasis - phrases that
// manufacture importance - which references/copy-tells.md sources.
const SLOP_COPY = [
  "in today's fast-paced", 'fast-paced world', 'unleash the power', 'unlock the power',
  'take it to the next level', 'elevate your', 'seamlessly integrat', 'revolutioniz',
  'cutting-edge solution', 'empower your team', 'game-changer', 'game changing',
  'best-in-class', 'world-class solution', 'transform your business',
  'is a testament to', 'plays a crucial role', 'marks a turning point', 'sets the stage for',
  'ever-evolving', 'look no further', "we've got you covered", 'the future of',
];

// The rest of what copy-tells.md marks as scannable. All warnings: copy is a
// judgement in the end, and a checker that fails a build over a button label
// is a checker people turn off.
const BUTTON_VERBS = /^\s*(get started|learn more|explore|unlock|unleash|discover|elevate your\b.*)\s*$/i;
const NO_NO_JUST = /\bno \w+,\s*no \w+,\s*just\b/gi;
const COPULA_SUBS = /\b(serves as|stands as|functions as|represents|boasts)\b/gi;
const LEAKED_REFUSAL = /as an ai language model|i do not have enough information/i;

/* The marks of a generated page. Weighted the way the public scanners weight
   them: the default font stack and the purple accent score highest, then the
   reflexive cream ground and sub-AA grey text, then the decorative devices. */

// Faces that now read as "nobody chose a typeface". Fraunces and Instrument
// Serif were the 2025 escape route and have since become the new default.
const SLOP_FONTS = [
  'Inter', 'Instrument Serif', 'Space Grotesk', 'Geist', 'Syne', 'Cal Sans',
  'DM Sans', 'Poppins', 'Roboto', 'Playfair Display', 'Montserrat', 'Fraunces',
];
// "VibeCode purple" plus the Tailwind blues.
const SLOP_HEX = /#(6366f1|4f46e5|818cf8|8b5cf6|7c3aed|a855f7|c084fc|2563eb|3b82f6|60a5fa|ec4899|f472b6)\b/gi;

/* The same twelve colours, written the two other ways the generators now write
   them. Tailwind v4 and the current shadcn/ui scaffold emit tokens as oklch()
   and the generation before it emitted bare HSL triples (`--primary: 262 83%
   58%`), so a hex scan sees a violet CTA in 2023 and nothing at all in 2026.
   Matched by COLOUR rather than by a hue band: a band would fail a designer who
   genuinely chose violet, and a check that fails honest work gets switched off.
   Anything within this tolerance of a Tailwind default IS the Tailwind default
   with the notation changed. */
const SLOP_OKLCH = [
  ['#6366f1', 58.5, 0.204, 277.1], ['#4f46e5', 51.1, 0.230, 277.0],
  ['#818cf8', 68.0, 0.158, 276.9], ['#8b5cf6', 60.6, 0.219, 292.7],
  ['#7c3aed', 54.1, 0.247, 293.0], ['#a855f7', 62.7, 0.233, 303.9],
  ['#c084fc', 72.2, 0.177, 305.5], ['#2563eb', 54.6, 0.215, 262.9],
  ['#3b82f6', 62.3, 0.188, 259.8], ['#60a5fa', 71.4, 0.143, 254.6],
  ['#ec4899', 65.6, 0.212, 354.3], ['#f472b6', 72.5, 0.175, 349.8],
];
const toOklch = (r8, g8, b8) => {
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const r = lin(r8), g = lin(g8), b = lin(b8);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  let h = Math.atan2(B, A) * 180 / Math.PI;
  if (h < 0) h += 360;
  return [L * 100, Math.hypot(A, B), h];
};
const hslToOklch = (H, S, L) => {
  // CSS hsl(), by the spec's own algorithm, then through the sRGB conversion
  // above - so one tolerance covers every notation.
  const s = S / 100, l = L / 100;
  const f = (n) => {
    const k = (n + H / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    return (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255;
  };
  return toOklch(f(0), f(8), f(4));
};
// Named because it is the number that decides a build. A hue is only compared
// when the colour is saturated enough for hue to mean anything.
const CLOSE = { l: 2.5, c: 0.03, h: 5 };
const nearSlop = (L, C, h) => SLOP_OKLCH.find(([, sl, sc, sh]) => {
  if (Math.abs(L - sl) > CLOSE.l || Math.abs(C - sc) > CLOSE.c) return false;
  // Circular distance: hue 359 and hue 1 are two degrees apart, not 358.
  return Math.abs(((h - sh + 540) % 360) - 180) <= CLOSE.h;
});
/* Every colour literal in the two notations a hex scan misses, including the
   bare `--token: 262 83% 58%` shadcn form, which is legal nowhere except inside
   an hsl() the framework wraps around it. */
function slopColours(blob) {
  const hits = new Set();
  const add = (name, hex) => hits.add(name + ' (= ' + hex + ')');
  for (const m of blob.matchAll(/oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)/gi)) {
    const L = m[2] === '%' ? Number(m[1]) : Number(m[1]) * 100;
    const near = nearSlop(L, Number(m[3]), Number(m[4]));
    if (near) add(m[0].replace(/\s+/g, ' ') + ')', near[0]);
  }
  for (const m of blob.matchAll(/hsla?\(\s*([\d.]+)(?:deg)?\s*,?\s*([\d.]+)%\s*,?\s*([\d.]+)%/gi)) {
    const near = nearSlop(...hslToOklch(Number(m[1]), Number(m[2]), Number(m[3])));
    if (near) add(m[0].replace(/\s+/g, ' ') + ')', near[0]);
  }
  for (const m of blob.matchAll(/--[\w-]+\s*:\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*[;}]/g)) {
    const near = nearSlop(...hslToOklch(Number(m[1]), Number(m[2]), Number(m[3])));
    if (near) add(m[1] + ' ' + m[2] + '% ' + m[3] + '%', near[0]);
  }
  return [...hits];
}
const DIM_GREY = /#(888888|888|999999|999|9ca3af|a0aec0|aaaaaa|aaa|cccccc|ccc)\b/gi;
const BUILDERS = /(gpteng\.co|lovable-tagger|lovable-uploads|\.lovable\.app|\.bolt\.host|@base44\/sdk|\.base44\.app|Built with v0|\.repl\.co|\.replit\.app)/i;

function slopChecks(hRaw, css, n, E, W) {
  // Comments and data: URIs both carry markup and hex colours that are not the
  // rendered page. Neither should be able to fail a build.
  const h = hRaw
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/(?:href|src|content)="data:[^"]*"/gi, 'href="data:"')
    .replace(/(?:href|src|content)='data:[^']*'/gi, "href='data:'");
  const blob = h + '\n' + css;
  const text = h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ');

  // 1. the display face
  const fontHit = SLOP_FONTS.filter(
    (f) => new RegExp(`font-family[^;{}]*["']?${f.replace(/ /g, '[+ ]')}["']?`, 'i').test(blob) ||
           new RegExp(`family=${f.replace(/ /g, '\\+')}`, 'i').test(h),
  );
  if (fontHit.length)
    W(`${n}: ${fontHit.join(', ')} - currently the most-generated face(s) on the web. See references/typography.md.`);

  // 2. the purple/blue accent, in whichever of the three notations it arrived
  const purple = [...new Set((blob.match(SLOP_HEX) || []).map((s) => s.toLowerCase())), ...slopColours(blob)];
  if (purple.length) E(`${n}: ${purple.join(', ')} - the single most recognisable generated-page colour`);

  // 3. gradient text
  if (/background-clip\s*:\s*text/i.test(blob) && /color\s*:\s*transparent/i.test(blob))
    W(`${n}: gradient text (background-clip:text) - a top-weighted tell`);

  // 4. aurora / blob backdrops. backdrop-filter on a card is not this, so the
  //    blur has to be a plain filter and the blobs have to be numerous.
  if ((blob.match(/radial-gradient/gi) || []).length >= 6 && /(^|[^-])filter\s*:\s*blur\(\s*\d{2,}/im.test(blob))
    W(`${n}: blurred multi-blob backdrop - the "aurora" tell`);

  // 5. transition: all
  if (/transition\s*:\s*all\b/i.test(css))
    W(`${n}: "transition: all" - name the properties you actually animate`);

  // 6. the eyebrow pill above the headline
  if (/border-radius\s*:\s*(999|9999)px[^}]*}[^<]*<[^>]*>[^<]{1,40}<\/[^>]+>\s*<h1/is.test(blob) ||
      /<(span|div|p)[^>]+class=["'][^"']*\b(badge|pill|chip|tag)\b[^"']*["'][^>]*>[\s\S]{0,60}?<\/\1>\s*<h1/i.test(h))
    W(`${n}: pill badge directly above the <h1> - the "Now in beta" reflex`);

  // 7. sub-AA grey body text
  const dim = [...new Set((css.match(DIM_GREY) || []).map((s) => s.toLowerCase()))];
  if (dim.length) W(`${n}: ${dim.join(', ')} - washed-out grey, almost certainly under 4.5:1`);

  // 8. the italic accent word, rationed. Count elements, not attributes: an
  //    <em class="it"> is one phrase, not two.
  const ems = (h.match(/<(?:em|i)\b/gi) || []).length +
    (h.match(/<(?!em\b|i\b)[a-z]+\b[^>]*class=["'][^"']*\bit\b/gi) || []).length;
  if (ems > 1) E(`${n}: ${ems} italic accent phrases - one per page. It is a known tell, so overusing it is the tell.`);

  // 9. centred everything
  const centred = (h.match(/\bcenter\b|text-align\s*:\s*center/g) || []).length;
  const sections = (h.match(/<section\b/g) || []).length || 1;
  if (centred > sections * 2)
    W(`${n}: ${centred} centring declarations across ${sections} sections - establish an alignment axis instead`);

  // 10. builder fingerprints
  const b = h.match(BUILDERS);
  if (b) W(`${n}: "${b[1]}" left in the source`);

  // 11. negative parallelism, both shapes
  const np = (h.match(/not just [^.<]{1,50}?,? (it['’]s|but|it is)\b/gi) || []).length;
  if (np) W(`${n}: "not just X, it's Y" x${np} - now roughly three times its 2023 rate on the open web`);
  const nnj = (text.match(NO_NO_JUST) || []).length;
  if (nnj) W(`${n}: "no X, no Y, just Z" x${nnj} - the other shape of the same reflex`);

  // 11b. buttons named after nothing. Only button-shaped elements: the same
  //      words in prose are words.
  const labels = [...h.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>|<a\b[^>]*class=["'][^"']*\bbtn\b[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map((m) => (m[1] ?? m[2] ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
  const generic = labels.filter((t) => BUTTON_VERBS.test(t));
  if (generic.length)
    W(`${n}: button text "${generic[0]}"${generic.length > 1 ? ` (+${generic.length - 1} more)` : ''} - name the action, not the category`);

  // 11c. "is" and "are" replaced with importance. Three on a page is prose;
  //      more is the pattern.
  const subs = (text.match(COPULA_SUBS) || []).length;
  if (subs > 3) W(`${n}: ${subs} copula substitutes (serves as, stands as, represents, boasts) - write "is"`);

  // 11d. the model's own voice left in the copy. Rare, and certain when it is there.
  if (LEAKED_REFUSAL.test(text)) W(`${n}: leaked model refusal in the copy ("as an AI language model" / "I do not have enough information")`);

  // 12. em dash density
  const words = (h.replace(/<[^>]+>/g, ' ').match(/\S+/g) || []).length || 1;
  const dashes = (h.match(/—/g) || []).length;
  if (words > 200 && (dashes / words) * 1000 > 20)
    W(`${n}: ${((dashes / words) * 1000).toFixed(1)} em dashes per 1000 words (over 20 reads as machine-written)`);

  // 13. semantics
  if (!/<(main|section|article)\b/i.test(h)) E(`${n}: no <main>, <section> or <article> - div soup`);
  if (/<div[^>]+onclick/i.test(h)) E(`${n}: <div onclick> - use a <button> or an <a>`);

  // 14. every <svg> is either decoration (aria-hidden) or content (role +
  //     accessible name). Inheriting from an ancestor works, but saying it on
  //     the element is unambiguous and survives the markup being moved.
  const bare = (h.match(/<svg\b[^>]*>/gi) || [])
    .filter((s) => !/aria-hidden|role=|aria-label/i.test(s)).length;
  if (bare) W(`${n}: ${bare} <svg> with neither aria-hidden nor an accessible name`);

  // 15. one radius for everything
  const radii = [...css.matchAll(/border-radius\s*:\s*([^;}]+)/gi)].map((m) => m[1].trim());
  const tally = radii.reduce((a, r) => ((a[r] = (a[r] || 0) + 1), a), {});
  const top = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
  if (top && top[1] >= 8 && radii.length && top[1] / radii.length > 0.6)
    W(`${n}: border-radius ${top[0]} on ${top[1]} rules - tier the radius by role`);

  // 16. headings that will not balance
  if (/<h1\b/i.test(h) && !/text-wrap\s*:\s*balance/i.test(css))
    W(`${n}: no text-wrap: balance on headings`);
}

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

// Everything below reads a resolved path and returns {text, errors, warns,
// findings}; nothing here prints or exits, so the CLI command and `verify`
// can both call it and decide for themselves what happens next.
export function runAudit(target) {
  if (!existsSync(target)) throw new Error(`no such path: ${target}`);
  const files = statSync(target).isDirectory() ? walk(target) : [target];
  const htmls = files.filter((f) => extname(f) === '.html');
  const csss = files.filter((f) => extname(f) === '.css');
  const jss = files.filter((f) => extname(f) === '.js');
  if (!htmls.length) throw new Error('no .html found');

  let errors = 0, warns = 0;
  const findings = [];
  const lines = [];
  const ok = (s) => lines.push(`  ok    ${s}`);
  const E = (m) => { errors++; findings.push({ level: 'error', text: m }); lines.push(`  ERROR ${m}`); };
  const W = (m) => { warns++; findings.push({ level: 'warn', text: m }); lines.push(`  warn  ${m}`); };

  // Comments first. A block somebody commented out - the old transition: all,
  // the outline: none they removed - is not live CSS, and every regex below
  // was reading it as though it were and failing the build for dead code.
  const allCss = csss.map((f) => readFileSync(f, 'utf8')).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
  const allText = [...htmls, ...csss, ...jss].map((f) => readFileSync(f, 'utf8')).join('\n');

  /* --- project-wide ---------------------------------------------------- */
  lines.push(`\nwebdesign audit  ${relative(process.cwd(), target) || '.'}`);
  lines.push(`  ${htmls.length} html, ${csss.length} css, ${jss.length} js\n`);

  if (EMOJI.test(allText)) {
    for (const f of [...htmls, ...csss, ...jss]) {
      readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
        if (EMOJI.test(l)) E(`emoji at ${basename(f)}:${i + 1} - use an SVG or plain text`);
      });
    }
  } else ok('no emoji');

  if (!/prefers-reduced-motion/.test(allCss)) E('no prefers-reduced-motion block in any stylesheet');
  else ok('prefers-reduced-motion honoured');

  // pure black / pure white as a colour value
  const purist = /(?:^|[^-\w])(?:color|background(?:-color)?|border[a-z-]*color|fill)\s*:\s*(#fff(?:fff)?|#000(?:000)?|white|black)\b/gi;
  const pureHits = [...allCss.matchAll(purist)];
  if (pureHits.length) W(`${pureHits.length} use(s) of pure white/black - warm them (bone-100 / ink-950)`);
  else ok('no pure #fff / #000');

  // undefined custom properties. A var() with a fallback is fine by definition,
  // and JS may define one via setProperty.
  const defined = new Set([
    ...[...allText.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]),
    ...[...allText.matchAll(/setProperty\(\s*['"`](--[\w-]+)/g)].map((m) => m[1]),
  ]);
  const used = new Set(
    [...allText.matchAll(/var\(\s*(--[\w-]+)\s*([,)])/g)]
      .filter((m) => m[2] === ')')
      .map((m) => m[1]),
  );
  const undef = [...used].filter((v) => !defined.has(v));
  if (undef.length) E(`undefined custom propert${undef.length > 1 ? 'ies' : 'y'}: ${undef.join(', ')}`);
  else ok(`${used.size} custom properties all defined`);

  // outline removal without a focus-visible replacement
  if (/outline\s*:\s*(?:none|0)\b/.test(allCss) && !/:focus-visible/.test(allCss))
    E('outline removed with no :focus-visible replacement');

  /* --- per html --------------------------------------------------------- */
  for (const f of htmls) {
    const h = readFileSync(f, 'utf8');
    const n = basename(f);
    const has = (re) => re.test(h);

    if (!has(/<html[^>]*\slang=/i)) E(`${n}: <html> has no lang attribute`);
    if (!has(/<meta[^>]+name=["']viewport["']/i)) E(`${n}: no viewport meta`);
    if (!has(/<meta[^>]+charset/i)) E(`${n}: no charset meta`);

    const title = (h.match(/<title>([\s\S]*?)<\/title>/i) || [, ''])[1].trim();
    if (!title) E(`${n}: empty <title>`);
    else if (title.length > 65) W(`${n}: <title> is ${title.length} chars (aim under 60)`);

    const desc = (h.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)/i) || [, ''])[1];
    if (!desc) E(`${n}: no meta description`);
    else if (desc.length < 60 || desc.length > 165) W(`${n}: meta description is ${desc.length} chars (aim 80-160)`);

    if (!has(/rel=["'][^"']*icon/i)) W(`${n}: no favicon`);
    if (!has(/property=["']og:title["']/i)) W(`${n}: no Open Graph tags`);

    const h1s = (h.match(/<h1[\s>]/gi) || []).length;
    if (h1s === 0) E(`${n}: no <h1>`);
    else if (h1s > 1) E(`${n}: ${h1s} <h1> elements - exactly one per page`);

    // heading order
    const levels = [...h.matchAll(/<h([1-6])[\s>]/gi)].map((m) => +m[1]);
    for (let i = 1; i < levels.length; i++)
      if (levels[i] > levels[i - 1] + 1) { W(`${n}: heading jumps h${levels[i - 1]} -> h${levels[i]}`); break; }

    // images
    const found = [...h.matchAll(/<img\b[^>]*>/gi)];
    const imgs = found.map((m) => m[0]);
    // "Below the fold" was "not the first <img>", which penalised every
    // multi-image hero the scaffolder itself emits: a three-plane hero-depth
    // has three images above the fold. Anything inside the opening header,
    // or inside a parallax scene, is the fold.
    const heroEnd = h.search(/<\/header>/i);
    const aboveFold = (at) => (heroEnd !== -1 && at < heroEnd);
    const inScene = (at) => {
      const open = h.lastIndexOf('data-depth', at);
      return open !== -1 && h.lastIndexOf('</section>', at) < open;
    };
    let noAlt = 0, noDim = 0, noLazy = 0;
    found.forEach((m, i) => {
      const tag = m[0];
      if (!/\salt\s*=/.test(tag)) noAlt++;
      if (!/\swidth\s*=/.test(tag) || !/\sheight\s*=/.test(tag)) noDim++;
      if (i > 0 && !aboveFold(m.index) && !inScene(m.index) && !/loading\s*=\s*["']lazy/.test(tag) && !/fetchpriority/.test(tag)) noLazy++;
    });
    if (noAlt) E(`${n}: ${noAlt} <img> without alt`);
    if (noDim) E(`${n}: ${noDim} <img> without width/height - guaranteed layout shift`);
    if (noLazy) W(`${n}: ${noLazy} below-the-fold <img> without loading="lazy"`);
    if (imgs.length && !/fetchpriority\s*=\s*["']high/.test(h)) W(`${n}: no fetchpriority="high" on the hero image`);

    // duplicate ids
    const ids = [...h.matchAll(/\sid=["']([^"']+)["']/g)].map((m) => m[1]);
    const dupes = ids.filter((v, i) => ids.indexOf(v) !== i);
    if (dupes.length) E(`${n}: duplicate id(s): ${[...new Set(dupes)].join(', ')}`);

    // dead anchors + broken in-page links
    const dead = (h.match(/href=["']#["']/g) || []).length;
    if (dead) E(`${n}: ${dead} dead href="#" link(s)`);
    for (const m of h.matchAll(/href=["']#([\w-]+)["']/g))
      if (!ids.includes(m[1])) E(`${n}: link to #${m[1]} but no element has that id`);

    // form labels
    for (const m of h.matchAll(/<(input|textarea|select)\b[^>]*>/gi)) {
      const tag = m[0];
      if (/type\s*=\s*["'](hidden|submit|button)/i.test(tag)) continue;
      const id = (tag.match(/\sid=["']([^"']+)/) || [])[1];
      const before = h.slice(0, m.index);
      const wrapped = before.lastIndexOf('<label') > before.lastIndexOf('</label>');
      const labelled =
        (id && new RegExp(`for=["']${id}["']`).test(h)) || /aria-label/.test(tag) || wrapped;
      if (!labelled) E(`${n}: ${m[1]} without a label`);
    }

    // copy that was never written
    const low = h.toLowerCase();
    const left = PLACEHOLDERS.filter((p) => low.includes(p));
    if (left.length) E(`${n}: scaffold copy still present: "${left[0]}"${left.length > 1 ? ` (+${left.length - 1} more)` : ''}`);

    for (const [re, what] of FAKE_DATA) if (re.test(h)) E(`${n}: ${what}`);

    const slop = SLOP_COPY.filter((s) => low.includes(s));
    if (slop.length) W(`${n}: marketing filler: "${slop[0]}"${slop.length > 1 ? ` (+${slop.length - 1} more)` : ''} - say the specific thing instead`);

    // a copyright year that has drifted
    const yr = new Date().getFullYear();
    for (const m of h.matchAll(/(?:&copy;|©|copyright)\s*(\d{4})/gi))
      if (+m[1] < yr) W(`${n}: copyright says ${m[1]}, this year is ${yr}`);

    // the three-equal-cards reflex
    if (/grid-template-columns\s*:\s*repeat\(\s*3\s*,\s*1fr\s*\)/.test(h + allCss))
      W('repeat(3, 1fr) - use repeat(auto-fit, minmax(...)) so the row is not locked to three');

    // wiring: an engine's markup with no engine behind it is a dead section
    if (/data-(px|count|magnetic|tilt|split)=/.test(h) && !/motion\.js/.test(h))
      E(`${n}: uses data-px/count/magnetic/tilt but never loads motion.js`);
    if (/data-gradient=/.test(h) && !/gradient\.js/.test(h))
      E(`${n}: has a canvas[data-gradient] but never loads gradient.js`);
    if (/class=["'][^"']*\bdepth\b/.test(h) && !/depth\.js/.test(h))
      E(`${n}: has a .depth scene but never loads depth.js`);
    if (/class=["'][^"']*\bexploded\b/.test(h)) {
      if (!/exploded\.js/.test(h)) E(`${n}: has an .exploded stack but never loads exploded.js`);
      else if (!/type=["']importmap["']/.test(h))
        E(`${n}: exploded.js is a module importing "three" - it needs an importmap`);
    }
    // The sky hero has the same two failure modes as the exploded view and
    // had neither check: markup with no engine, or the engine with no map.
    if (/data-sky/.test(h)) {
      if (!/sky\.js/.test(h)) E(`${n}: has a [data-sky] hero but never loads sky.js`);
      else if (!/type=["']importmap["']/.test(h))
        E(`${n}: sky.js is a module importing "three" - it needs an importmap`);
    }
    // and the reverse: paying for an engine nothing uses. Match the script tag,
    // not the filename anywhere in the file - a comment mentioning gradient.js
    // is not a page that loads it.
    for (const [f, sel] of [['gradient.js', /data-gradient=/], ['depth.js', /class=["'][^"']*\bdepth\b/],
                            ['exploded.js', /class=["'][^"']*\bexploded\b/], ['sky.js', /data-sky/]])
      if (new RegExp(`<script[^>]+src=["'][^"']*${f.replace('.', '\\.')}["']`).test(h) && !sel.test(h))
        W(`${n}: loads ${f} but nothing on the page uses it`);
    if (/class=["'][^"']*\bgrain\b/.test(h) === false) W(`${n}: no .grain overlay - the page will look flat`);
    if (!/fonts\.(googleapis|gstatic|bunny|fontshare)/.test(h) && !/@font-face/.test(allCss))
      W(`${n}: no webfont loaded - the whole system depends on the serif`);
    if (/Instrument\+Serif/.test(h))
      W(`${n}: Instrument Serif is the most-generated display face on the web right now - prefer Newsreader or Fraunces`);
    if (/Playfair\+Display/.test(h))
      W(`${n}: Playfair Display reads as a template default - prefer Newsreader, Fraunces or Bodoni Moda`);

    // inline style volume
    const inline = (h.match(/\sstyle=["'][^"']+["']/g) || []).length;
    if (inline > 60) W(`${n}: ${inline} inline style attributes - move the repeated ones into site.css`);

    slopChecks(h, allCss, n, E, W);
  }

  /* --- css sanity ------------------------------------------------------- */
  if (csss.length) {
    if (!/clamp\(/.test(allCss)) W('no clamp() anywhere - type and spacing are not fluid');
    const lh = [...allCss.matchAll(/line-height\s*:\s*([\d.]+)/g)].map((m) => +m[1]);
    if (lh.length && !lh.some((v) => v < 1)) W('no display line-height below 1.0 - large serif will read as a blog');
    if (!/letter-spacing\s*:\s*-/.test(allCss)) W('no negative letter-spacing - large serif needs it');
    if (!/@media\s*\(\s*max-width|@media\s*\(\s*min-width|@container/.test(allCss))
      W('no responsive breakpoints found');
  }

  lines.push(`\n  ${errors} error(s), ${warns} warning(s)\n`);
  return { text: lines.join('\n'), errors, warns, findings };
}
