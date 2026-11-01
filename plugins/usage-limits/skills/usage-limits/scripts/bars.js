'use strict';

// How the numbers are drawn: Claude Code's own colours, its spinner, its
// shimmer and its rainbow, so a bar from this plugin sits beside the chat
// without looking like it came from somewhere else.
//
// Everything here is a pure function of its arguments. The status line, the
// side panel and the VS Code view all draw from this one file, which is what
// keeps the three of them agreeing about what 85 percent looks like.
//
// The palette is Claude Code's dark theme, read out of the CLI itself rather
// than approximated. The names are Claude's: rate_limit_fill is what /usage
// paints its bars with, claudeShimmer is the highlight that sweeps across
// "Thinking", and the seven rainbow colours are what "ultrathink" and the
// max effort setting are painted in.

const usage = require('./usage.js');

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

const THEME = {
  claude: [215, 119, 87],
  claudeShimmer: [235, 159, 127],
  fill: [177, 185, 249],
  empty: [80, 83, 112],
  warning: [255, 193, 7],
  warningShimmer: [255, 223, 57],
  error: [255, 107, 128],
  success: [78, 186, 101],
  text: [255, 255, 255],
  inactive: [153, 153, 153],
  subtle: [80, 80, 80],
  permission: [177, 185, 249],
  ultra: [175, 135, 255],
  ultraShimmer: [208, 180, 255],
  // The Codex row's mark, in the green OpenAI's own products have used, chosen
  // because it sits at the same visual weight as Claude's orange rather than
  // shouting over it: relative luminance 0.278 against Claude's 0.283, and a
  // hue about 148 degrees away, so the two marks read as a pair on one line
  // and neither one wins. The shimmer is the same lift the Claude one gets.
  codex: [16, 163, 127],
  codexShimmer: [36, 203, 167],
  rainbow: [
    [235, 95, 87],
    [245, 139, 87],
    [250, 195, 95],
    [145, 200, 130],
    [130, 170, 220],
    [155, 130, 200],
    [200, 130, 180],
  ],
  rainbowShimmer: [
    [250, 155, 147],
    [255, 185, 137],
    [255, 225, 155],
    [185, 230, 180],
    [180, 205, 240],
    [195, 180, 230],
    [230, 180, 210],
  ],
};

// One frame every 150ms is the cadence Claude Code animates at.
const TICK_MS = 150;

// The two thresholds. A bar is its normal colour below 80, yellow from 80,
// red from 90. Each window is judged on its own.
const WARN_AT = 80;
const DANGER_AT = 90;

// Claude Code's spinner, forward then back again.
const SPINNER = ['·', '✢', '✳', '✶', '✻', '✽'];
const SPINNER_ASCII = ['.', '+', '*', 'x', '*', '+'];
const FRAMES = SPINNER.concat(SPINNER.slice().reverse());
const FRAMES_ASCII = SPINNER_ASCII.concat(SPINNER_ASCII.slice().reverse());

const FILL = '█';
const EMPTY = '░';
const FILL_ASCII = '#';
const EMPTY_ASCII = '-';

// Claude Code's own six-pointed asterisk, in the two forms.
const CLAUDE_MARK = '✻';
const CLAUDE_MARK_ASCII = '*';

// Codex is labelled with its name, not a mark.
//
// It has no mark of its own: it uses OpenAI's Blossom, and there is no Blossom
// codepoint in Unicode, so a terminal cannot draw one. The nearest rosette is
// a flower, and a flower standing in for a logo is not the logo - it is a
// different picture in the same slot, which is worse than no picture at all.
// The word is unambiguous, costs five columns, and cannot come out as
// something else in a font that has never heard of it.
const CODEX_LABEL = 'Codex';

// Claude's mark, in the two forms, so the status line, the panel and the VS
// Code view cannot end up drawing different ones.
function mark(options) {
  const opts = options || {};
  return opts.ascii ? CLAUDE_MARK_ASCII : CLAUDE_MARK;
}

function markColour(which) {
  return which === 'codex' ? THEME.codex : THEME.claude;
}

function markShimmer(which) {
  return which === 'codex' ? THEME.codexShimmer : THEME.claudeShimmer;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function level(percent) {
  if (!Number.isFinite(percent)) return 'fill';
  if (percent >= DANGER_AT) return 'error';
  if (percent >= WARN_AT) return 'warning';
  return 'fill';
}

// The same two thresholds, read from the other end.
//
// Codex counts down: it reports what is LEFT, and its own status card says
// "82% left" where Claude Code says "62% used". So the Codex rows are drawn
// draining rather than filling, and the colours have to turn at the same real
// moment: 80 percent used is 20 percent left, and 90 used is 10 left.
function levelLeft(percentLeft) {
  if (!Number.isFinite(percentLeft)) return 'fill';
  if (percentLeft <= 100 - DANGER_AT) return 'error';
  if (percentLeft <= 100 - WARN_AT) return 'warning';
  return 'fill';
}

function levelColour(name) {
  if (name === 'error') return THEME.error;
  if (name === 'warning') return THEME.warning;
  return THEME.fill;
}

// What the terminal can show. The status line is a special case: Claude Code
// captures the script's output, so stdout is never a TTY there, yet ANSI is
// supported. Callers that know that pass isTTY as true.
function colourMode(env, isTTY) {
  const e = env || process.env;
  if (e.NO_COLOR !== undefined && e.NO_COLOR !== '') return 'none';
  const forced = e.FORCE_COLOR;
  if (forced !== undefined && forced !== '' && forced !== '0' && forced !== 'false') return 'truecolor';
  if (isTTY === false) return 'none';
  if (e.USAGE_LIMITS_COLOUR === '256') return '256';
  if (e.USAGE_LIMITS_COLOUR === 'none' || e.USAGE_LIMITS_COLOUR === 'off') return 'none';
  const term = String(e.TERM || '').toLowerCase();
  if (term === 'dumb') return 'none';
  const colorterm = String(e.COLORTERM || '').toLowerCase();
  if (colorterm === 'truecolor' || colorterm === '24bit') return 'truecolor';
  const program = String(e.TERM_PROGRAM || '').toLowerCase();
  if (e.WT_SESSION) return 'truecolor';
  if (['vscode', 'iterm.app', 'wezterm', 'ghostty', 'hyper', 'alacritty', 'kitty'].indexOf(program) !== -1) {
    return 'truecolor';
  }
  return '256';
}

// Nearest entry in the 6x6x6 cube, or the grey ramp for greys.
function to256(rgb) {
  const r = rgb[0];
  const g = rgb[1];
  const b = rgb[2];
  if (r === g && g === b) {
    if (r < 8) return 16;
    if (r > 248) return 231;
    return Math.round(((r - 8) / 247) * 24) + 232;
  }
  const step = (v) => Math.round((v / 255) * 5);
  return 16 + 36 * step(r) + 6 * step(g) + step(b);
}

function colourCode(rgb, mode) {
  if (!rgb || mode === 'none' || !mode) return null;
  if (mode === '256') return '38;5;' + to256(rgb);
  return '38;2;' + rgb[0] + ';' + rgb[1] + ';' + rgb[2];
}

function paint(text, rgb, mode) {
  const code = colourCode(rgb, mode);
  if (!code || text === '') return String(text);
  return '\x1b[' + code + 'm' + text + '\x1b[39m';
}

function dim(text, mode) {
  if (!mode || mode === 'none' || text === '') return String(text);
  return '\x1b[2m' + text + '\x1b[22m';
}

function bold(text, mode) {
  if (!mode || mode === 'none' || text === '') return String(text);
  return '\x1b[1m' + text + '\x1b[22m';
}

function clamp(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

// The bar. Rounded to the nearest cell, with two honesty rules: anything
// spent shows as at least one cell, and anything short of the whole window is
// never drawn as full. The number beside the bar carries the precision; the
// bar carries the shape.
function bar(percent, width, options) {
  const opts = options || {};
  const cells = Math.max(0, Math.floor(width || 0));
  if (!cells) return '';
  const pct = clamp(Number.isFinite(percent) ? percent : 0, 0, 100);
  let filled = Math.round((cells * pct) / 100);
  if (pct > 0 && filled === 0) filled = 1;
  if (pct < 100 && filled === cells) filled = cells - 1;
  const fillGlyph = opts.ascii ? FILL_ASCII : FILL;
  const emptyGlyph = opts.ascii ? EMPTY_ASCII : EMPTY;
  const mode = opts.mode || 'none';
  // The filled cells: one colour for the level, or under ultracode the
  // rainbow sliding along the bar, or under ultrathink the purple with a
  // moving highlight, the way Claude Code paints those two words.
  let fill;
  if (opts.style === 'rainbow' && mode !== 'none') {
    fill = rainbow(fillGlyph.repeat(filled), opts.tick, { mode, reduced: opts.reduced });
  } else if (opts.style === 'ultra' && mode !== 'none') {
    fill = shimmer(fillGlyph.repeat(filled), opts.tick, THEME.ultra, THEME.ultraShimmer, { mode, reduced: opts.reduced });
  } else {
    fill = paint(fillGlyph.repeat(filled), levelColour(opts.level || level(pct)), mode);
  }
  return fill + paint(emptyGlyph.repeat(cells - filled), THEME.empty, mode);
}

function spinner(tick, options) {
  const opts = options || {};
  const frames = opts.ascii ? FRAMES_ASCII : FRAMES;
  if (opts.reduced) return frames[0];
  const count = frames.length;
  const index = (((Number.isFinite(tick) ? Math.floor(tick) : 0) % count) + count) % count;
  return frames[index];
}

// A three-character highlight that walks along the text and starts again, the
// way "Thinking" glows in Claude Code. Reduced motion keeps the base colour
// and drops the walk.
function shimmer(text, tick, base, highlight, options) {
  const opts = options || {};
  const mode = opts.mode || 'none';
  const chars = Array.from(String(text));
  if (mode === 'none') return chars.join('');
  if (opts.reduced || !highlight) return paint(chars.join(''), base, mode);
  const period = chars.length + 4;
  const centre = ((((Number.isFinite(tick) ? Math.floor(tick) : 0) % period) + period) % period) - 1;
  let out = '';
  for (let i = 0; i < chars.length; i += 1) {
    out += paint(chars[i], Math.abs(i - centre) <= 1 ? highlight : base, mode);
  }
  return out;
}

// Seven colours sliding along the text, with the brighter variant at the
// leading edge. This is what Claude Code paints "ultrathink" and the max
// effort tag with.
function rainbow(text, tick, options) {
  const opts = options || {};
  const mode = opts.mode || 'none';
  const chars = Array.from(String(text));
  if (mode === 'none') return chars.join('');
  const step = opts.reduced ? 0 : Number.isFinite(tick) ? Math.floor(tick) : 0;
  const count = THEME.rainbow.length;
  let out = '';
  for (let i = 0; i < chars.length; i += 1) {
    const index = ((((i - step) % count) + count) % count);
    const leading = !opts.reduced && chars.length > 0 && i === (((step % chars.length) + chars.length) % chars.length);
    out += paint(chars[i], leading ? THEME.rainbowShimmer[index] : THEME.rainbow[index], mode);
  }
  return out;
}

// The colours the /effort picker uses for each level. xhigh gets the purple
// shimmer, max and ultracode the rainbow.
function effortColour(name) {
  const key = String(name || '').toLowerCase();
  switch (key) {
    case 'low':
      return { rgb: THEME.warning, shimmer: null, rainbow: false };
    case 'medium':
      return { rgb: THEME.success, shimmer: null, rainbow: false };
    case 'high':
      return { rgb: THEME.permission, shimmer: null, rainbow: false };
    case 'xhigh':
      return { rgb: THEME.ultra, shimmer: THEME.ultraShimmer, rainbow: false };
    // Claude Code's effort picker paints Ultracode in the purple; max is the
    // one it animates in the rainbow.
    case 'ultracode':
      return { rgb: THEME.ultra, shimmer: THEME.ultraShimmer, rainbow: false };
    case 'max':
      return { rgb: THEME.ultra, shimmer: THEME.ultraShimmer, rainbow: true };
    default:
      return { rgb: THEME.inactive, shimmer: null, rainbow: false };
  }
}

const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

function stripAnsi(text) {
  return String(text).replace(ANSI, '');
}

function visibleWidth(text) {
  return Array.from(stripAnsi(text)).length;
}

function clockText(ms, now, options) {
  const opts = options || {};
  const date = new Date(ms);
  const hours = opts.utc ? date.getUTCHours() : date.getHours();
  const minutes = opts.utc ? date.getUTCMinutes() : date.getMinutes();
  const day = opts.utc ? date.getUTCDay() : date.getDay();
  const prefix = ms - now > 24 * HOUR ? DAYS[day] + ' ' : '';
  const mm = String(minutes).padStart(2, '0');
  if (opts.clock === '24h') return prefix + String(hours).padStart(2, '0') + ':' + mm;
  const twelve = hours % 12 || 12;
  return prefix + twelve + ':' + mm + (hours < 12 ? ' AM' : ' PM');
}

// "resets in 4h 12m at 4:12 PM". The duration is what you plan against; the
// clock time is what you tell someone else.
function formatReset(msToReset, resetsAtMs, now, options) {
  if (msToReset === null || msToReset === undefined || !Number.isFinite(msToReset)) return '';
  if (msToReset <= 0) return 'resets now';
  let text = 'resets in ' + usage.formatDuration(msToReset);
  if (Number.isFinite(resetsAtMs)) {
    text += ' at ' + clockText(resetsAtMs, Number.isFinite(now) ? now : Date.now(), options);
  }
  return text;
}

function capitalise(word) {
  return word ? word.charAt(0).toUpperCase() + word.slice(1) : word;
}

// "claude-fable-5-1[1m]" -> "Fable 5.1 1M", the way the model picker says it.
function prettyModel(id) {
  if (id === null || id === undefined) return 'Unknown model';
  let name = String(id).trim();
  if (!name) return 'Unknown model';
  const lower = name.toLowerCase();
  if (lower === 'default') return 'Default model';
  if (lower === 'opusplan') return 'Opus plan';
  let suffix = '';
  const bracket = name.match(/\[([^\]]+)\]$/);
  if (bracket) {
    suffix = ' ' + bracket[1].toUpperCase();
    name = name.slice(0, bracket.index);
  }
  // OpenAI's names, for the Codex side: "gpt-6-astra" is "GPT-6 Astra",
  // "gpt-5.6-sol" is "GPT-5.6 Sol", "o4-mini" is "o4 Mini".
  const gpt = name.match(/^gpt-?(\d+(?:\.\d+)?)(?:-(.+))?$/i);
  if (gpt) {
    const rest = gpt[2] ? ' ' + gpt[2].split('-').filter(Boolean).map(capitalise).join(' ') : '';
    return 'GPT-' + gpt[1] + rest + suffix;
  }
  const oSeries = name.match(/^(o\d+)(?:-(.+))?$/i);
  if (oSeries) {
    const rest = oSeries[2] ? ' ' + oSeries[2].split('-').filter(Boolean).map(capitalise).join(' ') : '';
    return oSeries[1].toLowerCase() + rest + suffix;
  }
  name = name.replace(/^.*?claude-/, '');
  name = name.replace(/-v\d+:\d+$/, '');
  name = name.replace(/-\d{8}$/, '');
  const parts = name.split('-').filter(Boolean);
  const words = parts.filter((part) => !/^\d+$/.test(part)).map(capitalise);
  const numbers = parts.filter((part) => /^\d+$/.test(part));
  const label = words.join(' ') + (numbers.length ? ' ' + numbers.join('.') : '');
  return (label.trim() || capitalise(String(id))) + suffix;
}

module.exports = {
  THEME,
  TICK_MS,
  WARN_AT,
  DANGER_AT,
  SPINNER,
  FRAMES,
  level,
  levelLeft,
  levelColour,
  CLAUDE_MARK,
  CLAUDE_MARK_ASCII,
  CODEX_LABEL,
  mark,
  markColour,
  markShimmer,
  colourMode,
  to256,
  paint,
  dim,
  bold,
  bar,
  spinner,
  shimmer,
  rainbow,
  effortColour,
  stripAnsi,
  visibleWidth,
  formatReset,
  prettyModel,
};
