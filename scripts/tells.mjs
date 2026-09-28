/* ultimate-frontend-skills/tells - the mechanical checks for the AI tells in
   skills/ultimate-frontend-skills/data/ai-tells.json.

   Each entry in that file names a pattern that reads as generated, why, what
   to do instead, the source it was taken from, and, when a machine can see it,
   the check. This module runs those checks over a project's HTML, CSS and JS
   and returns one finding per tell, tagged with the check's id, so the audit
   prints them and a test can hold each one. They are warnings: a pattern is a
   tell by frequency, not a defect by itself. The one error is a loop with no
   way to pause it, which WCAG 2.2.2 (Pause, Stop, Hide) fails outright.

   The data file is research, dated (`checked`); the rules here are the code
   that decides. A rule that cannot decide from source says nothing. */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DATA = fileURLToPath(new URL('../skills/ultimate-frontend-skills/data/ai-tells.json', import.meta.url));
let cache;
export function tellData() {
  if (!cache) cache = JSON.parse(readFileSync(DATA, 'utf8'));
  return cache;
}
const byCheck = (id) => tellData().entries.find((e) => e.proposed_check && e.proposed_check.id === id);

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ');
const textOf = (h) => h.replace(/<(script|style|template)\b[\s\S]*?<\/\1\s*>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ')
  .replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ');
const words = (h) => (textOf(h).match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;

/* Top-level page sections: <section>, <header>, <article> and <footer>
   blocks, each with the markup inside it. Nesting is followed, so a section
   inside a section is counted with its parent. */
function sections(h) {
  const out = [];
  const re = /<(section|header|article|footer)\b[^>]*>|<\/(section|header|article|footer)\s*>/gi;
  let depth = 0, start = -1, m;
  while ((m = re.exec(h))) {
    if (m[1]) { if (depth++ === 0) start = m.index; }
    else if (depth > 0 && --depth === 0) out.push(h.slice(start, m.index + m[0].length));
  }
  return out;
}

// The class list of every element, lower-cased.
const classLists = (h) => [...h.matchAll(/\sclass\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)].map((m) => (m[1] ?? m[2]).toLowerCase().split(/\s+/).filter(Boolean));

// CSS rules as [selector, body], with @media and @supports unwrapped.
function rules(css) {
  const out = [];
  const src = stripComments(css);
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(src))) out.push([m[1].replace(/^[\s\S]*@[^{]*$/, '').trim(), m[2]]);
  return out;
}

// The reveal verb an element with .r uses.
const verbOf = (cls) => cls.includes('r--mask') ? 'mask' : cls.includes('r--settle') ? 'settle' : cls.includes('r--none') ? 'none' : 'rise';

const LUCIDE_SET = ['sparkles', 'zap', 'shield', 'bar-chart-3', 'barchart3', 'check'];
const ICON_LIBS = [
  ['lucide', /lucide/i], ['heroicons', /heroicons/i], ['Font Awesome', /font-?awesome|\bfa-(solid|regular|brands)\b|\bfa[srlb]? fa-/i],
  ['Material Icons', /material-icons|material-symbols/i], ['Feather', /feather-icons|data-feather=/i], ['Phosphor', /phosphor-icons|\bph-[a-z]/i],
  ['Bootstrap Icons', /bootstrap-icons|\bbi-[a-z]/i], ['Tabler', /tabler-icons|\bti-[a-z]/i],
];
const WATERFALL = ['hero', 'logos', 'features', 'stats', 'testimonials', 'pricing', 'faq', 'cta'];

/* htmls: [{ name, h }]; css: all stylesheets and inline <style> text; js: all
   scripts. Returns [{ level: 'warn'|'error', id, text }]. */
export function aiTells({ htmls = [], css = '', js = '' } = {}) {
  const found = [];
  const say = (level, id, where, what) => {
    const t = byCheck(id);
    const instead = t && t.instead ? ' Instead: ' + t.instead.replace(/\.$/, '') + '.' : '';
    found.push({ level, id, text: `${where}${what}${instead} [${id}${t ? ', ' + t.id : ''}]` });
  };
  const inlineCss = htmls.map(({ h }) => [...h.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)].map((m) => m[1]).join('\n')).join('\n');
  const inlineJs = htmls.map(({ h }) => [...h.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script\s*>/gi)].map((m) => m[1]).join('\n')).join('\n');
  const allCss = stripComments(css + '\n' + inlineCss);
  const allJs = js + '\n' + inlineJs;
  const allRules = rules(allCss);
  const allClasses = new Set(htmls.flatMap(({ h }) => classLists(h).flat()));

  // Project-wide motion vocabulary (M7): literal durations and easings.
  // Zero and 1 ms are not motion choices: they are how a stylesheet switches
  // motion off (the reduced-motion brake).
  const durations = new Set([...allCss.matchAll(/(?:transition|animation)(?:-duration)?\s*:[^;}]*?(\d*\.?\d+)(m?s)\b/gi)]
    .map((m) => (m[2] === 's' ? Number(m[1]) * 1000 : Number(m[1]))).filter((ms) => ms > 1).map((ms) => ms + 'ms'));
  const easings = new Set([...allCss.matchAll(/cubic-bezier\([^)]*\)|linear\([^)]*\)|steps\([^)]*\)|\b(?:ease-in-out|ease-in|ease-out)\b/gi)].map((m) => m[0].replace(/\s+/g, '').toLowerCase()));
  if (durations.size > 6 || easings.size > 4)
    say('warn', 'motion-token-sprawl', '', `${durations.size} distinct durations and ${easings.size} distinct timing functions: motion without a system reads as assembled.`);

  // M2: a card that lifts on hover.
  const lift = allRules.find(([sel, body]) => /:hover/.test(sel) && /(card|tile|feature|pricing|plan|item)/i.test(sel) && /translateY\(\s*-\s*(?:[2-8](?:\.\d+)?px|0?\.[1-5]rem)\s*\)/.test(body));
  const liftClass = [...allClasses].find((c) => /^hover:-translate-y-(0\.5|1|1\.5|2)$/.test(c));
  if (lift || liftClass) say('warn', 'motion-hover-lift', '', `${lift ? '"' + lift[0].slice(0, 60) + '"' : '"' + liftClass + '"'} lifts a card a few pixels on hover, the library default.`);

  // M5: overshoot on a dialog, modal, popover or card.
  const over = allRules.find(([sel, body]) => /(dialog|modal|popover|card|sheet|drawer|toast)/i.test(sel)
    && ([...body.matchAll(/cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/g)].some((c) => Number(c[2]) > 1 || Number(c[4]) > 1 || Number(c[2]) < 0 || Number(c[4]) < 0)
      || /\b(back|elastic|bounce)(In|Out|InOut)?\b/i.test(body)));
  if (over) say('warn', 'motion-overshoot-dialog', '', `"${over[0].slice(0, 60)}" overshoots: a dialog or card that bounces reads as a demo.`);

  // M6: an entrance from scale(0), or ease-in on an entrance.
  const zero = [...allCss.matchAll(/@keyframes\s+([\w-]+)\s*\{([\s\S]*?\})\s*\}/g)].find((k) => /(?:from|\b0%)\s*\{[^}]*scale\(\s*0\s*\)/.test(k[2]));
  const easeIn = allRules.find(([, body]) => /animation\s*:[^;]*\b[\w-]*(?:in|enter|show|reveal)[\w-]*\b[^;]*\bease-in\b(?!-)/i.test(body));
  if (zero) say('warn', 'motion-scale-zero', '', `@keyframes ${zero[1]} starts from scale(0): nothing real grows out of a point.`);
  if (easeIn) say('warn', 'motion-scale-zero', '', `"${easeIn[0].slice(0, 60)}" eases an entrance in: it starts slow, which reads as lag.`);

  // M8: a glow that follows the cursor.
  const moveVars = /(?:mousemove|pointermove)/.test(allJs) ? [...allJs.matchAll(/setProperty\(\s*['"`](--[\w-]+)/g)].map((m) => m[1]) : [];
  const glowVar = moveVars.find((v) => new RegExp('radial-gradient\\([^;]*var\\(\\s*' + v.replace(/[-]/g, '\\-') + '\\b').test(allCss + htmls.map(({ h }) => h).join('')));
  if (glowVar) say('warn', 'motion-cursor-glow', '', `a pointer handler writes ${glowVar} into a radial-gradient: the cursor spotlight.`);

  // W1: shadcn/ui's variable block, left as it came.
  if (/--radius\s*:\s*0?\.5rem/.test(allCss) && ['--background', '--card', '--popover', '--muted'].every((v) => new RegExp(v + '\\s*:').test(allCss)))
    say('warn', 'web-shadcn-defaults', '', 'the shadcn/ui default variable block (--radius 0.5rem, --background, --card, --popover, --muted) is on the page unchanged.');

  // W4: the emerald success green (the violet and blue defaults are errors
  // in the audit's own palette check).
  if (/#10b981\b/i.test(allCss + htmls.map(({ h }) => h).join('')) || /oklch\(\s*69\.6%\s+0\.17\s+162\.48/.test(allCss))
    say('warn', 'web-slop-gradient-pair', '', 'Tailwind emerald-500 (#10b981) is the default "success" of generated pages.');

  let loops = 0, pauses = 0;
  for (const { name, h } of htmls) {
    const n = name + ': ';
    const secs = sections(h.replace(/<!--[\s\S]*?-->/g, ' '));

    // M1: one reveal on most sections.
    const revealed = secs.map((s) => [...new Set(classLists(s).filter((c) => c.includes('r')).map(verbOf))]);
    const counts = {};
    for (const verbs of revealed) for (const v of verbs) if (v !== 'none') counts[v] = (counts[v] || 0) + 1;
    const aos = secs.map((s) => (s.match(/data-aos\s*=\s*["']([^"']+)/) || [])[1]).filter(Boolean);
    for (const v of aos) counts['aos:' + v] = (counts['aos:' + v] || 0) + 1;
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    if (secs.length >= 4 && top && top[1] / secs.length > 0.6)
      say('warn', 'motion-uniform-reveal', n, `${top[1]} of ${secs.length} sections reveal the same way (${top[0].replace('aos:', 'data-aos=')}).`);

    // M3: a reading-progress bar on a page too short to need one.
    if (/class\s*=\s*["'][^"']*\bprogress\b/.test(h) && words(h) < 1500)
      say('warn', 'motion-progress-short-page', n, `a scroll progress bar on a page of ${words(h)} words.`);

    // M4: counters with no source in their section.
    for (const s of secs) {
      if (!/\sdata-count\s*=/.test(s.replace(/<[^>]*data-shape[^>]*>/g, ''))) continue;
      if (/<cite\b|\sdata-source\s*=|<sup\b|<a\s[^>]*href=/i.test(s)) continue;
      say('warn', 'motion-counter-uncited', n, 'numbers count up with no source beside them: a counter with no citation is a claim dressed as data.');
      break;
    }

    // M9: a loop with no way to pause it.
    const cssLoops = allRules.filter(([sel, body]) => /\binfinite\b/.test(body) && /animation/.test(body))
      .map(([sel]) => (sel.match(/\.([\w-]+)/) || [])[1]).filter((c) => c && allClasses.has(c.toLowerCase()) && new RegExp('\\b' + c + '\\b', 'i').test(h));
    const glLoop = /<canvas\b[^>]*\sdata-gradient\b/i.test(h);
    const videoLoop = /<video\b(?=[^>]*\bautoplay\b)(?=[^>]*\bloop\b)[^>]*>/i.test(h);
    const hasPause = /\sdata-pause\b|<button\b[^>]*\saria-pressed\s*=/i.test(h) || /<video\b[^>]*\scontrols\b/i.test(h);
    if (cssLoops.length || glLoop || videoLoop) {
      loops++;
      if (!hasPause) say('error', 'motion-loop-no-pause', n, `${[...new Set(cssLoops.map((c) => '.' + c)), glLoop && 'an animated gradient', videoLoop && 'a looping video'].filter(Boolean).join(', ')} moves for good with no control to pause it (WCAG 2.2.2).`);
      else pauses++;
    }

    // W2: the lucide feature-icon set.
    const lucide = LUCIDE_SET.filter((i) => new RegExp(`(?:lucide-${i}\\b|data-lucide=["']${i}["']|<${i.replace(/-/g, '')}\\b)`, 'i').test(h + allJs));
    if (lucide.length >= 3) say('warn', 'web-lucide-slop-set', n, `lucide ${lucide.join(', ')} as feature icons.`);

    // W3: scaffold furniture.
    const text = textOf(h).replace(/\s+/g, ' ');
    const furniture = ['Most Popular', 'Built with care'].filter((p) => new RegExp('\\b' + p + '\\b', 'i').test(text));
    const lights = ['#ff5f57', '#febc2e', '#28c840', '#ff5f56', '#ffbd2e', '#27c93f'].filter((c) => (h + allCss).toLowerCase().includes(c)).length >= 2;
    if (furniture.length || lights) say('warn', 'web-scaffold-furniture', n, [...furniture.map((p) => `"${p}"`), lights && 'traffic-light window dots'].filter(Boolean).join(', ') + '.');

    // W5: the section waterfall.
    const order = secs.map((s) => ((s.match(/^<\w+\b[^>]*>/) || [''])[0].toLowerCase().match(/(?:id|class)\s*=\s*["']([^"']*)/g) || []).join(' '))
      .map((attrs) => WATERFALL.find((w) => new RegExp('\\b' + w + '\\b').test(attrs))).filter(Boolean);
    let at = 0, run = 0;
    for (const w of order) { const i = WATERFALL.indexOf(w, at); if (i >= 0) { run++; at = i + 1; } }
    if (run >= 6) say('warn', 'web-section-waterfall', n, `the sections run ${order.join(', ')}: the template order.`);

    // D2: a raster inside a logo or icon SVG.
    const raster = [...h.matchAll(/<svg\b([^>]*)>([\s\S]*?)<\/svg>/gi)].find((m) => /<image\b/i.test(m[2]) && /(logo|icon|brand|mark)/i.test(m[1] + (h.slice(Math.max(0, m.index - 120), m.index))));
    if (raster) say('warn', 'svg-embedded-raster', n, 'a logo or icon SVG wraps a raster <image>: it blurs at every size but one.');

    // D3: mixed icon sets.
    const libs = ICON_LIBS.filter(([, re]) => re.test(h)).map(([l]) => l);
    const iconStrokes = new Set([...h.matchAll(/<svg\b([^>]*)>/gi)].map((m) => m[1])
      .filter((a) => /viewBox\s*=\s*["']0 0 (16|20|24|32) (16|20|24|32)["']/.test(a) || /\bwidth\s*=\s*["']?(1[0-9]|2[0-9]|3[0-2])["'\s]/.test(a))
      .map((a) => (a.match(/stroke-width\s*=\s*["']([\d.]+)/) || [])[1]).filter(Boolean));
    if (libs.length > 1 || iconStrokes.size > 1)
      say('warn', 'icons-mixed', n, libs.length > 1 ? `${libs.join(' and ')} on one page.` : `icons drawn at ${[...iconStrokes].join(', ')} stroke widths.`);

    // G4-G6: game input, audio and the hidden tab.
    if (/\b(?:e|ev|event|evt)\.key\s*={2,3}\s*['"][wasdWASD]['"]/.test(allJs))
      say('warn', 'game-key-not-code', n, 'movement keys are read from event.key: on AZERTY and Dvorak they are not where WASD is. Read event.code.');
    if (/new\s+(?:window\.)?(?:webkit)?AudioContext\s*\(/.test(allJs) && !/\.resume\s*\(/.test(allJs))
      say('warn', 'game-audio-autoplay', n, 'an AudioContext is made and never resumed: browsers start it suspended until a gesture.');
    if (/requestAnimationFrame\s*\(/.test(allJs) && /addEventListener\(\s*['"]key(down|up)['"]/.test(allJs) && /getContext\(\s*['"](?:2d|webgl2?)['"]/.test(allJs) && !/visibilitychange/.test(allJs))
      say('warn', 'game-no-visibility-pause', n, 'the game loop never listens for visibilitychange, so the world runs on in a hidden tab.');
  }
  return found.filter((f, i) => found.findIndex((g) => g.text === f.text) === i);
}
