'use strict';

// The display model: what the status line, the side panel and the VS Code
// view all draw. Given whatever readings exist - the usage endpoint's answer,
// Claude Code's own cache, the per-response rate-limit headers the status line
// receives - plus which model is running, it decides the rows, their colours,
// which per-model week to show, and what the footer should admit about the
// freshness of it all.
//
// Everything here is a pure function of its input so the three surfaces
// cannot drift apart.

const usage = require('./usage.js');
const bars = require('./bars.js');

const MINUTE = 60 * 1000;

// Claude Code's own titles from /usage.
const TITLES = { five_hour: 'Current session', seven_day: 'Current week (all models)' };
const SPEND_TITLE = 'Spend limit';

// A reading older than this is "cached" in the footer, however it was taken.
const LIVE_AGE_MS = 5 * MINUTE;

function scopedTitle(name) {
  return 'Current week (' + name + ')';
}

function epochMs(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    // The status line hands over epoch seconds; the endpoint hands over ISO
    // strings. A number small enough to be seconds is seconds.
    return value < 1e12 ? value * 1000 : value;
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function fromHeaders(key, headers, headersAt) {
  if (!headers || typeof headers !== 'object') return null;
  const bucket = headers[key];
  if (!bucket || typeof bucket !== 'object' || typeof bucket.used_percentage !== 'number') return null;
  return {
    percent: bucket.used_percentage,
    resetsAtMs: epochMs(bucket.resets_at),
    at: Number.isFinite(headersAt) ? headersAt : 0,
    source: 'headers',
  };
}

function fromSnapshot(key, utilization, fetchedAtMs, source) {
  if (!utilization || typeof utilization !== 'object') return null;
  const bucket = utilization[key];
  if (!bucket || typeof bucket !== 'object' || typeof bucket.utilization !== 'number') return null;
  return {
    percent: bucket.utilization,
    resetsAtMs: epochMs(bucket.resets_at),
    at: Number.isFinite(fetchedAtMs) ? fetchedAtMs : 0,
    source: source === 'api' || source === 'live' ? 'api' : 'cache',
  };
}

function newer(a, b) {
  if (!a) return b;
  if (!b) return a;
  return a.at >= b.at ? a : b;
}

function percentText(percent, stale, unreported) {
  if (stale) return 'rolling';
  if (unreported) return '?';
  if (!Number.isFinite(percent)) return 'no reading';
  return Math.floor(percent) + '%';
}

function row(key, title, family, picked, now) {
  const percent = picked && Number.isFinite(picked.percent) ? picked.percent : null;
  const resetsAtMs = picked && Number.isFinite(picked.resetsAtMs) ? picked.resetsAtMs : null;
  const msToReset = resetsAtMs === null ? null : resetsAtMs - now;
  const stale = msToReset !== null && msToReset <= 0;
  // Zero with no reset time is a window with nothing in it. From a reading
  // taken just now that is simply true. From an old cache it may equally be a
  // bucket that never reported, and the status line has no way to tell.
  const idle = percent === 0 && resetsAtMs === null;
  const unreported = idle && Boolean(picked) && picked.source === 'cache';
  return {
    key,
    title,
    family: family || null,
    percent,
    percentText: percentText(percent, stale, unreported),
    resetsAtMs,
    msToReset,
    level: bars.level(percent),
    source: picked ? picked.source : null,
    at: picked ? picked.at : null,
    stale,
    idle,
    unreported,
  };
}

// ---------------------------------------------------------------------------
// The Codex block
// ---------------------------------------------------------------------------
//
// The other agent's meter, drawn under Claude's in the same visual language and
// counting the other way.
//
// Codex reports what it has SPENT on the wire - every rollout carries
// `used_percent`, rising - but it shows the user what is LEFT: its own status
// card computes `100 - used_percent` and prints "82% left". Claude Code does
// the opposite and says "62% used". Both are right about their own product, and
// a plugin that reported one product in the other's direction would be
// misreading a number every time it was checked against the real thing.
//
// So the Codex rows carry both figures and every display draws `percentLeft`:
// the bar drains rather than fills, and the colours turn at the same real
// moment as Claude's because levelLeft() mirrors level() exactly.
//
// The titles are Codex's own, from its status card.
const CODEX_TITLES = { five_hour: '5h limit', seven_day: 'Weekly limit' };
const CODEX_TITLE = 'Codex usage';

function codexRow(key, title, picked, now) {
  const used = picked && Number.isFinite(picked.percent) ? picked.percent : null;
  const resetsAtMs = picked && Number.isFinite(picked.resetsAtMs) ? picked.resetsAtMs : null;
  const msToReset = resetsAtMs === null ? null : resetsAtMs - now;
  const stale = msToReset !== null && msToReset <= 0;
  // A window past its reset has turned over, so the figure describes an
  // allowance that no longer exists. Drawing "6% left" in red from it would
  // claim Codex is nearly out when it has just been given a fresh window, so
  // the remaining figure is dropped and the row draws as unknown.
  const left = used === null || stale ? null : Math.min(100, Math.max(0, 100 - used));
  return {
    key,
    title,
    family: null,
    // The spent figure is kept because it is what came off the wire and what
    // the arithmetic elsewhere is written in; percentLeft is what is drawn.
    percent: used,
    percentLeft: left,
    remaining: true,
    percentText: stale ? 'rolling' : left === null ? 'no reading' : Math.floor(left) + '% left',
    resetsAtMs,
    msToReset,
    level: bars.levelLeft(left),
    source: picked ? picked.source : null,
    at: picked ? picked.at : null,
    stale,
    idle: false,
    unreported: false,
  };
}

// Built from whatever codex.collect() returned, which is the newest meter Codex
// has written to disk. Nothing here spawns Codex or touches the network.
function buildCodex(input) {
  const opts = input || {};
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const utilization = opts.utilization && typeof opts.utilization === 'object' ? opts.utilization : null;
  const fetchedAtMs = Number.isFinite(opts.fetchedAtMs) ? opts.fetchedAtMs : null;
  const source = opts.source === 'api' || opts.source === 'live' ? 'api' : 'cache';

  const rows = [];
  const specs = Array.isArray(opts.windowSpecs) && opts.windowSpecs.length
    ? opts.windowSpecs
    : [{ key: 'five_hour', label: '5-hour' }, { key: 'seven_day', label: 'weekly' }];
  for (const spec of specs) {
    if (!spec || !spec.key) continue;
    const picked = fromSnapshot(spec.key, utilization, fetchedAtMs, source);
    if (!picked) continue;
    const title = CODEX_TITLES[spec.key] || 'Current ' + (spec.label || spec.key) + ' window';
    rows.push(codexRow(spec.key, title, picked, now));
  }

  const ageMs = fetchedAtMs === null ? null : Math.max(0, now - fetchedAtMs);
  const hasData = rows.some((item) => item.percentLeft !== null);
  const state = !hasData ? 'none' : ageMs !== null && ageMs < LIVE_AGE_MS ? 'live' : 'cached';

  let note = null;
  if (opts.windowless) {
    note = 'this plan meters no rolling window';
  } else if (!hasData) {
    // Codex only writes its meter when it makes a request, so a machine that
    // has Codex installed but has not run it has nothing to report, and that
    // is not an error.
    note = 'no reading yet, run Codex once';
  } else if (rows.every((item) => item.stale)) {
    note = 'every window has rolled over since Codex last ran';
  }

  return {
    host: 'codex',
    title: CODEX_TITLE,
    rows,
    plan: opts.plan || null,
    windowless: Boolean(opts.windowless),
    // What every surface checks before drawing anything at all.
    present: rows.length > 0 || Boolean(opts.windowless),
    state,
    ageMs,
    note,
    now,
  };
}

// Which effort a display should report.
//
// Two sources say what a session is running at, and they fail in different
// ways. The status line is told by Claude Code itself and is exact, but only
// for a session that HAS a status line, and a VS Code window has none. The
// transcript is stamped with `effort` on every assistant line, so it is always
// current and it exists for every session, but only once the model has
// answered once. Whichever was written later is the truer one.
//
// The setting is the last resort, and only a resort: it says what the NEXT
// session will start at, not what this one is doing, it does not move when
// /effort does, and it is not even allowed to hold "max". Showing it as though
// it were the live value is what made the panel report xhigh through a whole
// session running at max.
function pickEffort(fromLine, fromTranscript, setting) {
  let best = null;
  for (const item of [fromLine, fromTranscript]) {
    if (!item || typeof item.effort !== 'string' || !item.effort) continue;
    const at = Number.isFinite(item.at) ? item.at : 0;
    if (!best || at >= best.at) best = { effort: item.effort, at };
  }
  if (best) return best.effort;
  const named = typeof setting === 'string' ? setting.trim() : '';
  return named && named !== 'default' ? named : null;
}

function ageText(ageMs) {
  return Number.isFinite(ageMs) ? 'showing the reading from ' + usage.formatDuration(ageMs) + ' ago' : 'no reading yet';
}

function noteFor(outcome, ageMs) {
  if (!outcome || outcome.ok) return null;
  const suffix = ', ' + ageText(ageMs);
  switch (outcome.kind) {
    case 'offline':
      return 'offline' + suffix;
    case 'disabled':
      return 'network off' + suffix;
    case 'unauthorized':
      return 'sign in to Claude Code again' + suffix;
    case 'expired':
      return 'the login has expired, Claude Code renews it on its next call' + suffix;
    case 'forbidden':
      return 'usage is not available for this login' + suffix;
    case 'no_credentials':
      return 'no Claude login found' + suffix;
    case 'rate_limited':
      return 'the usage endpoint is busy, retrying' + suffix;
    default:
      return 'the usage endpoint answered with an error' + suffix;
  }
}

function build(input) {
  const opts = input || {};
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const env = opts.env || process.env;
  const utilization = opts.utilization && typeof opts.utilization === 'object' ? opts.utilization : null;
  const fetchedAtMs = Number.isFinite(opts.fetchedAtMs) ? opts.fetchedAtMs : null;
  const source = opts.source || (utilization ? 'cache' : null);
  const headers = opts.headers && typeof opts.headers === 'object' ? opts.headers : null;
  const headersAt = Number.isFinite(opts.headersAt) ? opts.headersAt : null;

  // The model in use decides which per-model week is shown. The status line
  // knows for certain; the setting is the fallback; nothing is hidden when
  // neither says.
  const model = opts.model || opts.settingsModel || env.ANTHROPIC_MODEL || null;
  // When Claude Code has said which model is running, that is the whole
  // answer: adding the setting on top would keep a Fable week on screen after
  // /model moved the session to Opus. The setting is only the fallback.
  const families = usage.familiesInUse(null, null, opts.model ? [opts.model] : [opts.settingsModel, env.ANTHROPIC_MODEL]);

  const rows = [];
  for (const key of ['five_hour', 'seven_day']) {
    const picked = newer(fromHeaders(key, headers, headersAt), fromSnapshot(key, utilization, fetchedAtMs, source));
    rows.push(row(key, TITLES[key], null, picked, now));
  }

  const spend = fromHeaders('spend_limit', headers, headersAt);
  if (spend) rows.push(row('spend_limit', SPEND_TITLE, null, spend, now));

  // A host that meters windows of other lengths (Codex names its own) gets a
  // row per window it reports, after the two everyone has.
  for (const spec of Array.isArray(opts.windowSpecs) ? opts.windowSpecs : []) {
    if (!spec || !spec.key || spec.key === 'five_hour' || spec.key === 'seven_day') continue;
    const picked = fromSnapshot(spec.key, utilization, fetchedAtMs, source);
    if (picked) rows.push(row(spec.key, 'Current ' + (spec.label || spec.key) + ' window', null, picked, now));
  }

  let fable = null;
  const hidden = [];
  for (const limit of usage.limitWindows(utilization)) {
    if (!limit.family) continue;
    const name = limit.label && limit.label.indexOf('weekly (') === 0 ? limit.label.slice(8, -1) : limit.family;
    const picked = {
      percent: limit.percent,
      resetsAtMs: limit.resetsAt,
      at: Number.isFinite(fetchedAtMs) ? fetchedAtMs : 0,
      source: source === 'api' || source === 'live' ? 'api' : 'cache',
    };
    const built = row(limit.key, scopedTitle(name), limit.family, picked, now);
    if (usage.appliesTo(limit, families)) {
      rows.push(built);
      if (limit.family === 'fable') fable = built;
    } else {
      hidden.push(built);
    }
  }

  // Freshness is judged on the newest thing shown.
  let newestAt = null;
  for (const item of rows) {
    if (Number.isFinite(item.at) && item.at > 0 && (newestAt === null || item.at > newestAt)) newestAt = item.at;
  }
  const ageMs = newestAt === null ? null : Math.max(0, now - newestAt);
  const hasData = rows.some((item) => item.percent !== null);
  const state = !hasData ? 'none' : ageMs !== null && ageMs < LIVE_AGE_MS ? 'live' : 'cached';

  const effort = opts.effort ? String(opts.effort).toLowerCase() : null;
  // Ultracode is a level in Claude Code's own effort picker, painted purple
  // there, so it comes from the level the agent reports and NEVER from a word
  // in the prompt. Reading it from the text was wrong twice over: "ultracode"
  // appears in ordinary requests, and the marks are machine-wide, so one
  // session mentioning it turned every panel purple while the effort was
  // xhigh.
  // Ultracode is a session mode, not a level: Claude Code reports its effort
  // as "xhigh" while it is on, so the level alone can never say. It comes
  // from the `ultracode` setting (a real settings.json key) or from the
  // session's own mark, written when the prompt used the keyword - which is
  // Claude Code's own trigger for it. The level is kept for any build that
  // does report it that way.
  const ultracode = effort === 'ultracode' || Boolean(opts.ultracode);
  // Ultrathink is a word in the prompt. Claude Code paints THE WORD in the
  // rainbow and nothing else, so the display shows the word that way and the
  // bars stay their own colour.
  const ultrathink = Boolean(opts.ultrathink);
  // What the bars do: the purple shimmer of the effort picker under ultracode,
  // the rainbow for max effort, their own level colour otherwise. The title is
  // never painted in either.
  const style = ultracode ? 'ultra' : effort === 'max' ? 'rainbow' : null;

  return {
    rows,
    fable,
    hidden,
    // Which budget mode the hooks are in, when it is not the one they have
    // always been in. Passed in rather than read here: this module builds a
    // display out of what it is given and touches no files.
    budget: opts.budget && opts.budget.name ? { name: opts.budget.name, label: opts.budget.label || opts.budget.name } : null,
    // The agents underneath this session. They spend the same window and had
    // no voice on any display until now.
    agents: opts.agents && Number.isFinite(opts.agents.running) ? opts.agents : { running: 0, runs: 0 },
    model,
    modelLabel: opts.modelName || bars.prettyModel(model),
    effort,
    ultracode,
    ultrathink,
    style,
    working: Boolean(opts.working),
    state,
    ageMs,
    note: noteFor(opts.outcome, ageMs),
  };
}

module.exports = {
  TITLES,
  LIVE_AGE_MS,
  scopedTitle,
  CODEX_TITLES,
  CODEX_TITLE,
  codexRow,
  buildCodex,
  pickEffort,
  epochMs,
  build,
  noteFor,
};
