#!/usr/bin/env node
// three.js source mistakes: the ones an agent writes from old tutorials and
// from training data older than the installed three, each with why it gets
// written and what to write instead. Static and per file. A clean result is
// not a render check: scene-budget.mjs and `webdesign.mjs quality` measure the
// running page, and a scene split across files is judged one file at a time.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, join, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RULES = {
  'dpr-uncapped': { level: 'error',
    why: 'Copied from the three.js starter, which passes devicePixelRatio straight through. On a 3x phone that shades nine pixels per CSS pixel, the first cause of a dropped frame on mobile, and a desktop check never shows it.',
    avoid: 'renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2)), or 1.5 for a full-bleed shader, and compare readability before going lower.' },
  'stale-api': { level: 'error',
    why: 'Written from tutorials or training data older than the installed three. outputEncoding, sRGBEncoding, LinearEncoding, texture.encoding, physicallyCorrectLights and THREE.Geometry are gone, and assigning a removed property fails silently: no error, only wrong colour or lighting.',
    avoid: 'renderer.outputColorSpace = THREE.SRGBColorSpace, texture.colorSpace, BufferGeometry; check references/three.md "Migration notes" against the version in the import map.' },
  'aspect-without-projection': { level: 'error',
    why: 'camera.aspect is a number the renderer never reads; the projection matrix is cached and only updateProjectionMatrix() rebuilds it, so the scene stays stretched after a resize.',
    avoid: 'Call camera.updateProjectionMatrix() right after any change to aspect, fov, near, far or zoom.' },
  'resize-ignores-aspect': { level: 'error',
    why: 'setSize changes the drawing buffer but not the camera, so after a width change the scene is squashed. It looks right at the one width it was written and screenshotted at.',
    avoid: 'Set camera.aspect = width / height and call updateProjectionMatrix() in the same handler as setSize.' },
  'no-resize': { level: 'warn',
    why: 'The renderer is sized once at load. Rotating a phone, resizing the window or a late layout shift leaves a stretched or blurry canvas.',
    avoid: 'Observe the canvas container with ResizeObserver (fall back to the resize event), then setSize(w, h, false), aspect and updateProjectionMatrix() together.' },
  'several-render-loops': { level: 'error',
    why: 'Each effect was added with its own animate() loop. Two loops that render run the GPU twice per frame and make timing depend on which one runs last.',
    avoid: 'One loop per renderer: a single requestAnimationFrame (or setAnimationLoop) that updates every part and calls render once.' },
  'loop-never-pauses': { level: 'warn',
    why: 'The tutorial loop reschedules itself every frame forever. Off screen and in a hidden tab it keeps the GPU busy, drains batteries and competes with the rest of the page.',
    avoid: 'Render on demand when the scene moves only with input or scroll; otherwise stop when an IntersectionObserver reports the canvas off screen and on visibilitychange, and restart on return.' },
  'gpu-alloc-per-frame': { level: 'error',
    why: 'A geometry, material, texture, mesh or render target created inside the loop uploads a new GPU resource every frame and is never freed; memory climbs until the context is lost.',
    avoid: 'Create GPU resources once, outside the loop; change uniforms, attributes or transforms per frame, and dispose() whatever you replace.' },
  'per-frame-allocation': { level: 'warn',
    why: 'new Vector3, Color or Matrix4 every frame is garbage for the collector; its pauses are hitches a frame-rate average hides.',
    avoid: 'Allocate scratch objects once (const _v = new THREE.Vector3()) and .set() or .copy() into them per frame.' },
  'teardown-without-dispose': { level: 'warn',
    why: 'Removing the canvas or clearing the scene does not free GPU memory; three keeps geometries, materials, textures and the context until dispose(). After a few route changes the browser drops the WebGL context.',
    avoid: 'On teardown dispose() geometries, materials and their textures, render targets and the renderer, then remove the canvas.' },
  'texture-colorspace': { level: 'warn',
    why: 'Since r152 colour textures must be tagged sRGB. An untagged photo or albedo map is read as linear and renders washed out, which then gets "fixed" by turning the lights up.',
    avoid: 'texture.colorSpace = THREE.SRGBColorSpace for colour maps (map, emissiveMap); leave normal, roughness and data maps linear.' },
  'no-webgl-fallback': { level: 'warn',
    why: 'new WebGLRenderer() throws when WebGL is blocked, unavailable or past the context limit, and the page is left with an empty box where the content was.',
    avoid: 'Construct it in try/catch, keep the content readable in HTML first, and mark the scene live only after the first successful render.' },
};

// Comments become spaces (newlines kept, so line numbers hold); strings and
// regex literals are copied whole so a // inside a URL is not a comment.
// blankStrings: string and template contents become spaces too, for rules
// that must not fire on a name mentioned in a message.
export function stripComments(src, { blankStrings = false } = {}) {
  let out = '', i = 0, prev = '';
  const n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') { out += ' '; i++; } continue; }
    if (c === '/' && d === '*') {
      out += '  '; i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { out += src[i] === '\n' ? '\n' : ' '; i++; }
      if (i < n) { out += '  '; i += 2; }
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      out += c; i++;
      while (i < n && src[i] !== c) {
        if (src[i] === '\\') { const esc = src.slice(i, i + 2); out += blankStrings ? esc.replace(/[^\n]/g, ' ') : esc; i += 2; continue; }
        if (c !== '`' && src[i] === '\n') break;
        out += blankStrings && src[i] !== '\n' ? ' ' : src[i]; i++;
      }
      if (i < n && src[i] === c) { out += c; i++; }
      prev = c; continue;
    }
    if (c === '/' && (prev === '' || '(,=:[!&|?{};+-*%<>~^'.includes(prev))) {
      let inClass = false;
      out += c; i++;
      while (i < n && src[i] !== '\n') {
        const r = src[i];
        if (r === '\\') { out += r + (src[i + 1] ?? ''); i += 2; continue; }
        out += r; i++;
        if (r === '[') inClass = true; else if (r === ']') inClass = false;
        else if (r === '/' && !inClass) break;
      }
      prev = '/'; continue;
    }
    out += c; i++;
    if (!/\s/.test(c)) prev = c;
  }
  return out;
}

// Everything outside <script> becomes spaces, so HTML line numbers are kept.
function scriptsOnly(html) {
  const out = html.replace(/[^\n]/g, ' ').split('');
  for (const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    const start = m.index + m[0].indexOf('>') + 1;
    for (let k = 0; k < m[1].length; k++) out[start + k] = m[1][k];
  }
  return out.join('');
}

function bodies(code) {
  const out = [];
  const re = /\bfunction\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{|\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*\{/g;
  for (const m of code.matchAll(re)) {
    const open = m.index + m[0].length - 1;
    let depth = 0, k = open;
    for (; k < code.length; k++) { if (code[k] === '{') depth++; else if (code[k] === '}' && --depth === 0) break; }
    out.push({ name: m[1] || m[2], at: m.index, start: open + 1, end: k });
  }
  return out;
}

// A self-scheduling call at the top level of its own body, not behind an
// if, else, ternary or &&: the loop runs every frame no matter what.
function unconditional(code, body, index) {
  let depth = 0;
  for (let k = body.start; k < index; k++) { if (code[k] === '{') depth++; else if (code[k] === '}') depth--; }
  if (depth !== 0) return false;
  const before = code.slice(body.start, index).trimEnd().replace(/[\w$.\]]+\s*=$/, '').trimEnd();
  if (before === '' || ';{}'.includes(before[before.length - 1])) return true;
  if (!before.endsWith(')')) return false;
  // A call that ended without a semicolon is a finished statement; parentheses
  // that are an if, while, for or with head make the call conditional.
  let d = 0, k = before.length - 1;
  for (; k >= 0; k--) { if (before[k] === ')') d++; else if (before[k] === '(' && --d === 0) break; }
  if (k < 0) return false;
  return !/(?:^|[^\w$])(?:if|while|for|with)$/.test(before.slice(0, k).trimEnd());
}

export function checkSource(source, { html = false } = {}) {
  const js = html ? scriptsOnly(source) : source;
  const code = stripComments(js), bare = stripComments(js, { blankStrings: true });
  if (!/\bTHREE\b|from\s*['"]three|\bWebGLRenderer\b/.test(code)) return null;
  const starts = [0];
  for (let k = 0; k < code.length; k++) if (code[k] === '\n') starts.push(k + 1);
  const lineOf = (index) => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= index) lo = mid; else hi = mid - 1; } return lo + 1; };
  const found = [], seen = new Set();
  const add = (rule, index) => { const line = lineOf(index), key = rule + ':' + line; if (!seen.has(key)) { seen.add(key); found.push({ rule, level: RULES[rule].level, line }); } };
  const has = (re) => re.test(code);
  const first = (re) => { const m = re.exec(code); return m ? m.index : 0; };

  // Any namespace: import * as T from 'three' gives new T.WebGLRenderer().
  const makesRenderer = /\bnew\s+(?:[A-Za-z_$][\w$]*\.)?WebGLRenderer\s*\(/;
  const rendererAt = first(makesRenderer);
  const ownsRenderer = has(makesRenderer);

  for (const m of bare.matchAll(/\.setPixelRatio\s*\(([^;\n]*)/g)) {
    if (/devicePixelRatio/.test(m[1]) && !/Math\.min|clamp/.test(m[1])) add('dpr-uncapped', m.index);
  }
  for (const m of bare.matchAll(/\b(?:outputEncoding|sRGBEncoding|LinearEncoding|physicallyCorrectLights)\b|\bTHREE\.Geometry\b|\.encoding\s*=(?!=)/g)) add('stale-api', m.index);

  const resizes = has(/ResizeObserver|['"]resize['"]|\bonresize\b/);
  if (/\.aspect\s*=(?!=)/.test(code) && !has(/updateProjectionMatrix\s*\(/)) add('aspect-without-projection', first(/\.aspect\s*=(?!=)/));
  if (ownsRenderer && has(/\bPerspectiveCamera\b/) && resizes && has(/\.setSize\s*\(/) && !has(/\.aspect\s*=(?!=)/)) add('resize-ignores-aspect', first(/\.setSize\s*\(/));
  if (ownsRenderer && !resizes) add('no-resize', rendererAt);

  // Bodies and loop calls are read with strings blanked, so a brace or a
  // function name inside a message cannot shift a body or start a loop.
  const fns = bodies(bare), byName = new Map(fns.map((b) => [b.name, b]));
  const always = [], loopBodies = [], loopKeys = new Set();
  for (const b of fns) {
    let self = false;
    for (const m of bare.slice(b.start, b.end).matchAll(new RegExp('requestAnimationFrame\\s*\\(\\s*' + b.name.replace(/\$/g, '\\$') + '\\s*\\)', 'g'))) {
      self = true;
      if (unconditional(bare, b, b.start + m.index)) { if (!loopKeys.has(b.name)) { loopKeys.add(b.name); always.push({ at: b.start + m.index, renders: /\.render\s*\(/.test(bare.slice(b.start, b.end)) }); } break; }
    }
    if (self) loopBodies.push(b);
  }
  // setAnimationLoop(animate) called again after setAnimationLoop(null) is the
  // same loop resumed, not a second one: loops are counted once per name.
  // The argument is read whole: in setAnimationLoop(hidden ? null : animate)
  // the loop is animate, not the first name in the expression.
  for (const m of bare.matchAll(/\.setAnimationLoop\s*\(([^;\n]*)/g)) {
    const arg = m[1], bareName = /^\s*(null|[A-Za-z_$][\w$]*)\s*\)/.exec(arg)?.[1];
    if (bareName === 'null') continue;
    const named = bareName || [...arg.matchAll(/[A-Za-z_$][\w$]*/g)].map((x) => x[0]).find((x) => byName.has(x));
    const key = named || 'inline@' + m.index;
    if (loopKeys.has(key)) continue;
    loopKeys.add(key);
    const b = named && byName.get(named);
    if (b) loopBodies.push(b);
    always.push({ at: m.index, renders: b ? /\.render\s*\(/.test(bare.slice(b.start, b.end)) : true });
  }
  const rendering = always.filter((l) => l.renders);
  if (rendering.length > 1) add('several-render-loops', rendering[1].at);
  if (always.length && !has(/visibilitychange|document\.hidden|IntersectionObserver|setAnimationLoop\s*\(\s*null|cancelAnimationFrame/)) add('loop-never-pauses', always[0].at);
  for (const b of loopBodies) {
    const text = bare.slice(b.start, b.end);
    for (const m of text.matchAll(/\bnew\s+(?:[A-Za-z_$][\w$]*\.)?(\w+)\s*\(/g)) {
      if (/(?:Geometry|Material|Texture|RenderTarget)$|^Mesh$|^WebGLRenderer$/.test(m[1])) add('gpu-alloc-per-frame', b.start + m.index);
      else if (/^(?:Vector[234]|Color|Matrix[34]|Quaternion|Euler|Box3|Sphere|Ray|Raycaster|Plane)$/.test(m[1])) add('per-frame-allocation', b.start + m.index);
    }
  }

  const teardown = /\.domElement\.remove\s*\(|removeChild\s*\(\s*[\w$.]*domElement|\.forceContextLoss\s*\(|\bscene\.clear\s*\(/;
  if (has(teardown) && !has(/\.dispose\s*\(/)) add('teardown-without-dispose', first(teardown));
  if (has(/\bTextureLoader\b/) && !has(/SRGBColorSpace|\.colorSpace\s*=/)) add('texture-colorspace', first(/\bTextureLoader\b/));
  // A try block, not any .catch( - a promise catch on fetch is no fallback.
  if (ownsRenderer && !/\btry\s*\{|isWebGL2?Available/.test(bare)) add('no-webgl-fallback', rendererAt);
  return found.sort((a, b) => a.line - b.line || a.rule.localeCompare(b.rule));
}

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.isSymbolicLink() || e.name === 'node_modules' || e.name === '.git') continue;
    const path = join(dir, e.name);
    if (e.isDirectory()) walk(path, out);
    else if (['.js', '.mjs', '.html', '.htm'].includes(extname(e.name).toLowerCase())) out.push(path);
  }
  return out;
}

export function checkThree(target) {
  const root = resolve(target);
  if (!existsSync(root)) throw new Error('no such file or folder: ' + target);
  const isDir = statSync(root).isDirectory();
  const files = isDir ? walk(root) : [root];
  const checked = [], findings = [], skipped = [];
  const nameOf = (file) => (isDir ? relative(root, file) : relative(process.cwd(), file) || file).replaceAll('\\', '/');
  for (const file of files) {
    // Skips are reported, so "nothing was checked" always says why.
    if (statSync(file).size > 2 * 1024 * 1024) { skipped.push({ file: nameOf(file), reason: 'over 2 MB, read as a bundle' }); continue; }
    const source = readFileSync(file, 'utf8');
    // The library itself, readable or minified: three sets its REVISION string.
    if (/\bclass\s+WebGLRenderer\b|\bREVISION\s*=\s*['"]\d{3}/.test(source)) { skipped.push({ file: nameOf(file), reason: 'the three.js library itself' }); continue; }
    const rows = checkSource(source, { html: /\.html?$/i.test(file) });
    if (!rows) continue;
    const name = nameOf(file);
    checked.push(name);
    for (const r of rows) findings.push({ ...r, file: name, why: RULES[r.rule].why, avoid: RULES[r.rule].avoid });
  }
  return { ok: checked.length > 0 && !findings.some((f) => f.level === 'error'), checked, skipped, findings,
    note: 'Source patterns only. Measure the running page (webdesign.mjs quality, scene-budget.mjs) before calling a scene fast.' };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const usage = 'usage: three-mistakes.mjs <dir|file> [--json]';
    const args = process.argv.slice(2), json = args.includes('--json');
    // A mistyped flag or a second target is a usage error, not something to ignore.
    const unknown = args.find((a) => a.startsWith('-') && a !== '--json');
    if (unknown) throw new Error('unknown flag ' + unknown + '\n' + usage);
    const targets = args.filter((a) => !a.startsWith('-'));
    if (targets.length !== 1) throw new Error((targets.length ? 'one target at a time\n' : '') + usage);
    const target = targets[0];
    const result = checkThree(target);
    const skips = result.skipped.map((s) => s.file + ' (' + s.reason + ')').join(', ');
    if (json) { console.log(JSON.stringify(result, null, 2)); process.exitCode = !result.checked.length ? 2 : result.ok ? 0 : 1; }
    else if (!result.checked.length) { console.error('three-mistakes: no three.js code found in ' + target + '; nothing was checked.' + (skips ? ' Skipped: ' + skips + '.' : '')); process.exitCode = 2; }
    else {
      const errors = result.findings.filter((f) => f.level === 'error').length;
      console.log(`three-mistakes: ${result.checked.length} file(s) with three.js code, ${result.findings.length} finding(s), ${errors} error(s)`);
      if (skips) console.log('  skipped: ' + skips);
      for (const f of result.findings) console.log(`\n  ${f.level} ${f.rule}  ${f.file}:${f.line}\n    why: ${f.why}\n    instead: ${f.avoid}`);
      console.log('\n' + result.note);
      process.exitCode = result.ok ? 0 : 1;
    }
  } catch (err) { console.error('three-mistakes: ' + err.message); process.exitCode = 2; }
}
