import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

export function parseArgs(argv) {
  const values = new Set(['preset', 'name', 'sections', 'to', 'port', 'widths', 'scroll', 'out', 'list', 'model', 'actions', 'wait', 'motion', 'frames', 'record', 'travel', 'design', 'frame', 'kind', 'source', 'award', 'year', 'since', 'stack', 'technique', 'limit', 'n', 'pick', 'awards', 'res', 'count', 'prompt', 'concurrency', 'exe', 'only', 'selector', 'width', 'owns', 'why', 'refs', 'seconds', 'size', 'fps', 'title', 'audio', 'threshold', 'bin', 'margin', 'for']);
  const flags = new Set(['no-shot', 'draft', 'alpha-matting', 'measure', 'expect-depth', 'json', 'no-probe', 'build', 'stats', 'techniques', 'verbose', 'urls', 'verified', 'check', 'fix', 'no-draco', 'install', 'dry-run', 'force', 'upstream', 'project', 'game', 'silence']);
  const options = {}, positional = [];
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') { positional.push(...argv.slice(i + 1)); break; }
    if (!arg.startsWith('--')) { positional.push(arg); continue; }
    const [key, ...rest] = arg.slice(2).split('=');
    if (values.has(key)) {
      const value = rest.length ? rest.join('=') : argv[++i];
      if (!value || value.startsWith('--')) throw new Error('Missing value for --' + key);
      options[key] = value;
    } else if (flags.has(key) && !rest.length) options[key] = true;
    else throw new Error('Unknown option: ' + arg);
  }
  return { positional, flag: (name, fallback = null) => options[name] ?? fallback };
}

// A keyboard-and-mouse game is checked at the laptop and desktop sizes it is
// played at, not at a phone width it has no controls for (Doodle Voyager,
// 2026-09-24). --game picks those; an explicit --widths still wins.
export const PAGE_WIDTHS = '1440,390';
export const GAME_WIDTHS = '1366,1280,1920';
export function defaultWidths(flag, page = PAGE_WIDTHS) {
  return String(flag('widths', flag('game') ? GAME_WIDTHS : page));
}

// Without --game, a page that is a game still got 1440 and 390: the flag has
// to be remembered, and a canvas game has nothing to check at a phone width
// unless it ships touch controls. A canvas plus keyboard controls (WASD, the
// arrows, pointer lock) reads as a keyboard-and-mouse game; touch handlers add
// the phone width back. A three.js landing page has the canvas but not the keys.
export function gameWidths(text) {
  if (!/<canvas\b|createElement\(\s*['"]canvas['"]/i.test(text)) return null;
  const keys = /\b(?:keydown|keyup)\b/.test(text) &&
    /['"](?:Key[WASD]|Arrow(?:Up|Down|Left|Right)|Space)['"]|requestPointerLock/.test(text);
  if (!keys) return null;
  return /\btouchstart\b/.test(text) ? GAME_WIDTHS + ',390' : GAME_WIDTHS;
}

// The widths for a local target: its page, the local scripts it names and the
// relative modules those import (a game's keys usually sit a few imports below
// main.js). Vendored libraries are skipped (three's OrbitControls listens for arrows).
const IMPORTS = /(?:\bfrom|\bimport\s*\(?)\s*["'](\.{0,2}\/[^"'#?]+)/g;
export function targetWidths(target) {
  if (/^https?:\/\//i.test(target)) return PAGE_WIDTHS;
  try {
    const given = resolve(target);
    const file = existsSync(given) && statSync(given).isDirectory() ? join(given, 'index.html') : given;
    if (!existsSync(file)) return PAGE_WIDTHS;
    const root = dirname(file);
    let text = readFileSync(file, 'utf8');
    const seen = new Set([file]), queue = [];
    const add = (from, spec) => {
      if (/^(?:[a-z]+:)?\/\//i.test(spec) || /three|vendor|node_modules|\.min\./i.test(spec)) return;
      const path = spec.startsWith('/') ? join(root, spec) : resolve(from, spec);
      if (!seen.has(path)) { seen.add(path); queue.push(path); }
    };
    for (const [, src] of text.matchAll(/<script\b[^>]*\bsrc=["']([^"'#?]+)/gi)) add(root, src);
    for (const [, spec] of text.matchAll(IMPORTS)) add(root, spec);
    for (let read = 0; queue.length && read < 64; read++) {
      const path = queue.shift();
      if (!existsSync(path) || !statSync(path).isFile() || statSync(path).size >= 2e6) continue;
      const js = readFileSync(path, 'utf8');
      text += '\n' + js;
      for (const [, spec] of js.matchAll(IMPORTS)) add(dirname(path), spec);
    }
    return gameWidths(text) || PAGE_WIDTHS;
  } catch { return PAGE_WIDTHS; }
}
