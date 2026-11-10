#!/usr/bin/env node
'use strict';

// The hook entry point. Runs before each prompt is handled and puts one line
// into Claude's context saying where the budget stands, what this session has
// cost so far, and to open the reply with it.
//
// It runs on every prompt, so two things matter more than features: it has to
// be one line, and it has to be fast. The expensive half is cached for a
// minute, and the numbers that change every turn are the cheap ones.

const fs = require('fs');
const os = require('os');
const path = require('path');

const atomic = require('./atomic.js');
const usage = require('./usage.js');
const host = require('./host.js');
const tally = require('./tally.js');
const activity = require('./activity.js');
const live = require('./live.js');
const relay = require('./relay.js');
const reading = require('./reading.js');
const voice = require('./voice.js');
const mode = require('./mode.js');
const feed = require('./feed.js');
const lowpri = require('./lowpri.js');

const SECOND = 1000;
const DAY = 24 * 60 * 60 * 1000;

// There is one threshold that changes behaviour, and it is the wall.
//
// Everything below it is reported and nothing below it is discouraged. That is
// the whole design, and it is a correction: an earlier version escalated from
// 40 per cent used, or whenever the runway dropped under three quarters of an
// hour, and so spent its time telling a session with a third of its budget left
// to stop starting things. Budget left unspent at the reset is not saved, it is
// destroyed, so winding down early is not caution. It is waste with a
// respectable name.
//
// Above the wall the instruction is not "hurry" either. It is: write the plan
// for what is left, save the work, and stop.
const DEFAULTS = {
  // The wall. Below this, work normally at full quality.
  near: 90,
  // Kept for `aheadOfPace`, which is still reported. It no longer decides
  // anything: spending a week's budget faster than the clock is information,
  // not a reason to slow down.
  floor: 40,
  ahead: 15,
  // How long the measured part stays good for. Prompts often arrive in
  // bursts, and a transcript scan per prompt would be wasteful.
  cacheSeconds: 60,
  // Few enough turns that the count itself is the wall.
  fewTurns: 10,
  // Minutes of runway left at the current pace, below which there is no longer
  // time to land the work and write the handoff. Not "too little time to start
  // something ambitious" - that judgement belongs to whoever is doing the work,
  // and it needs the number, not an instruction.
  runwayMinutes: 10,
  // How old the reading may be before the hook takes a fresh one.
  refreshSeconds: 180,
};

// A hook has ten seconds; the reading gets four of them at most.
const REFRESH_TIMEOUT_MS = 4000;

// What the hook is actually given before it is killed. Claude Code and Codex
// both use ten seconds (hooks/hooks.json, install-codex-hook.js).
const HOOK_BUDGET_MS = 10000;

// The hook is given ten seconds, and a live reading may take four of them, so
// the transcript scan gets five and the last second is slack. A warm scan
// takes about a quarter of a second; this is the guard for the first run on a
// machine with months of transcripts, where the alternative is the hook being
// killed and Claude being told nothing at all.
const SCAN_BUDGET_MS = 5000;

// How long the live reading may actually wait, given how much of the hook's ten
// seconds is already gone.
//
// Four seconds for the reading plus five for the scan plus a second of slack
// only adds up if the hook starts at zero, and it never does: node's own
// start-up, the requires, and reading the hook payload all come out of the same
// budget, and on a loaded machine that is most of a second before this line is
// reached. `process.uptime()` is the honest elapsed figure. Past the point
// where the scan would no longer fit, the reading on disk is used as it is
// rather than the hook being killed with nothing to say.
function refreshBudgetMs(options) {
  const opts = options || {};
  const configured = Number(
    opts.hookBudgetMs !== undefined ? opts.hookBudgetMs : process.env.USAGE_LIMITS_HOOK_BUDGET_MS
  );
  const total = Number.isFinite(configured) && configured > 0 ? configured : HOOK_BUDGET_MS;
  const elapsed = Number.isFinite(opts.elapsedMs) ? opts.elapsedMs : process.uptime() * 1000;
  const reserve = Number.isFinite(opts.reserveMs) ? opts.reserveMs : SCAN_BUDGET_MS + 1000;
  const most = Number.isFinite(opts.maxMs) ? opts.maxMs : REFRESH_TIMEOUT_MS;
  return Math.max(0, Math.min(most, Math.round(total - elapsed - reserve)));
}

// How far into the hook arming may still start. See relayState: the task
// registration is about a second and the hook is allowed ten.
const ARM_DEADLINE_MS = 5000;

// How old the account snapshot may be before the figure built on it is called
// a floor rather than a reading. The refresh cadence is three minutes, so a
// snapshot this old means several refreshes in a row failed or were throttled,
// and by then the correction is carrying the number rather than adjusting it.
const SNAPSHOT_TRUST_MS = 15 * 60 * 1000;

// Past this much of a per-model week, say how to free it. Below it the advice
// is noise: there is room, and the model in use is the right one.
const HALF_SPENT = 50;

// "fable" -> "Fable", the way the account names the window.
function familyLabel(family) {
  const name = String(family || '');
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : name;
}

// The runway is worth saying long before it is worth acting on, because it is
// the figure that stops a turn count from flattering. Two hundred turns sounds
// like plenty and can be twenty minutes when three sessions are spending.
const RUNWAY_MENTION_MS = 2 * 60 * 60 * 1000;

function configDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

// One cache per host. The slots double as the count of open sessions, so mixing
// two agents' sessions into one file would have each of them reporting the
// other's windows as competition for a budget they do not share.
function cacheFile() {
  const dir = usage.isCodex() ? require('./codex.js').homeDir() : configDir();
  return path.join(dir, 'usage-limits-brief.json');
}

// The same brief seconds apart is what a burst of task notifications makes:
// each one arrives as a prompt and each one got the whole line - ten copies in
// a row on 2026-09-20. Nothing has moved in ninety seconds, so the second copy
// carries nothing and is not said. Only the hook path uses this; run() still
// returns the text. USAGE_LIMITS_BRIEF_REPEAT=1 turns it off.
const REPEAT_MS = 90 * 1000;
function saidFile() {
  return path.join(path.dirname(cacheFile()), 'usage-limits-brief-said.json');
}
function shapeOf(text) {
  return String(text || '').replace(/\d+/g, '#');
}
// The said file holds three kinds of memo, told apart by key: the plain
// session key is the ninety-second shape, and the two suffixed keys below
// are per-session facts that have to outlive an hour's silence.
function readSaid() {
  try {
    const parsed = JSON.parse(fs.readFileSync(saidFile(), 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (err) {
    return {};
  }
}
function keepSaidFor(key) {
  return /#(standing|cachemiss|stale|relaylast|newer|cloud)$/.test(key) ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000;
}

// A plugin update takes effect when Claude Code restarts, so a session that
// began before one keeps running the old code for as long as it lives. On
// 2026-09-20 that put a session on 1.34.1 beside one on 1.36.0: the older one
// saw the single relay slot its version still had, judged it taken, wrote its
// own scheduled task by hand, and that task failed the way 1.34.1's always
// did, while the newer session's relay worked. Nothing in the plugin can
// upgrade a running session, but it can say so, once, with the two numbers.
function installedVersion(configDir) {
  try {
    const file = path.join(configDir, 'plugins', 'installed_plugins.json');
    const rows = JSON.parse(fs.readFileSync(file, 'utf8')).plugins['usage-limits@usage-limits'];
    if (!Array.isArray(rows) || !rows.length) return null;
    const user = rows.find((r) => r && r.scope === 'user') || rows[rows.length - 1];
    return user && typeof user.version === 'string' ? user.version : null;
  } catch (err) {
    return null;
  }
}
function runningVersion() {
  try {
    return require('../../../package.json').version;
  } catch (err) {
    return null;
  }
}
function staleVersionFor(sessionId, now, dir) {
  const installed = installedVersion(dir || configDir());
  const running = runningVersion();
  if (!installed || !running || installed === running) return null;
  const at = Number.isFinite(now) ? now : Date.now();
  const key = String(sessionId || '_') + '#stale';
  const all = readSaid();
  const entry = all[key];
  if (entry && Number.isFinite(entry.at) && at - entry.at < keepSaidFor(key) && entry.seen === installed) return null;
  all[key] = { at, seen: installed };
  writeSaid(all, at);
  return 'usage-limits ' + installed + ' is installed but this session still runs ' + running +
    ', because a plugin update applies at the next start; a relay or cap set here follows the older rules until then.';
}
// A newer model of the same family at a lower price, said once a session.
// Once is the rule every recommendation here keeps: the fact does not change
// from prompt to prompt, and repeating it would be the plugin charging for its
// own presence. Keyed on the pair, so a session that moves to a different model
// with its own newer sibling hears about that one.
function newerModelFor(sessionId, advice, now) {
  if (!advice || !advice.text) return null;
  const at = Number.isFinite(now) ? now : Date.now();
  const key = String(sessionId || '_') + '#newer';
  const all = readSaid();
  const entry = all[key];
  if (entry && entry.seen === advice.id && Number.isFinite(entry.at) && at - entry.at < keepSaidFor(key)) return null;
  all[key] = { at, seen: advice.id };
  writeSaid(all, at);
  return advice.text;
}
// The cloud-session credit, said once a session near the wall, by the same
// rule: the offer does not change from prompt to prompt. Keyed on the amount,
// so a different offer is news.
function cloudCreditFor(sessionId, credit, now) {
  const amount = lowpri.creditText(credit);
  if (!amount) return null;
  const at = Number.isFinite(now) ? now : Date.now();
  const key = String(sessionId || '_') + '#cloud';
  const all = readSaid();
  const entry = all[key];
  if (entry && entry.seen === amount && Number.isFinite(entry.at) && at - entry.at < keepSaidFor(key)) return null;
  all[key] = { at, seen: amount };
  writeSaid(all, at);
  return amount;
}
// The model the relay resumes with, when one is set: wake.js passes it as --model.
function relayModelNow() {
  try {
    return relay.settings(relay.read()).model || null;
  } catch (err) {
    return null;
  }
}
// How the last relay ended is news once. It used to ride along for six hours
// after any relay ended, on every prompt of every session: on 2026-09-22 a wake
// lost at 5:53 AM was repeated in two sessions' briefs all afternoon, about
// work neither of them was doing. Each session now hears about a given ended
// relay once, keyed on when it ended and how.
function relayNewsFor(sessionId, last, now) {
  if (!last) return null;
  const at = Number.isFinite(now) ? now : Date.now();
  const key = String(sessionId || '_') + '#relaylast';
  const seen = String(last.endedAt) + ':' + String(last.outcome);
  const all = readSaid();
  const entry = all[key];
  if (entry && entry.seen === seen && Number.isFinite(entry.at) && at - entry.at < keepSaidFor(key)) return null;
  all[key] = { at, seen };
  writeSaid(all, at);
  return last;
}
function writeSaid(all, at) {
  const next = {};
  for (const [k, v] of Object.entries(all)) if (v && Number.isFinite(v.at) && at - v.at < keepSaidFor(k)) next[k] = v;
  try {
    usage.writeJsonAtomic(saidFile(), next);
  } catch (err) {
  }
}
function sayOnce(sessionId, text, now) {
  if (!text || process.env.USAGE_LIMITS_BRIEF_REPEAT === '1') return text;
  const at = Number.isFinite(now) ? now : Date.now();
  const key = String(sessionId || '_');
  const shape = shapeOf(text);
  const all = readSaid();
  const last = all[key];
  if (last && Number.isFinite(last.at) && at - last.at < REPEAT_MS && last.shape === shape) return '';
  all[key] = { at, shape };
  writeSaid(all, at);
  return text;
}

// The standing instruction - open with the fit line, quote the binding
// window, close finished work with the total - reads the same on every prompt,
// and at 93 words it was the largest fixed cost in the line. It is said in
// full once per session and as twelve words after that. A session that has
// heard it has heard it; USAGE_LIMITS_BRIEF_FULL=1 says the full form every
// time for anyone who wants that.
const STANDING_SHORT = 'Assess fit; say "fits" with evidence, otherwise "it may not fit"; get on with the work.';
function standingSaid(sessionId, now) {
  const entry = readSaid()[String(sessionId || '_') + '#standing'];
  return Boolean(entry && Number.isFinite(entry.at) && (Number.isFinite(now) ? now : Date.now()) - entry.at < keepSaidFor('#standing'));
}
function markStanding(sessionId, now) {
  const at = Number.isFinite(now) ? now : Date.now();
  const all = readSaid();
  all[String(sessionId || '_') + '#standing'] = { at };
  writeSaid(all, at);
}
function standingShortFor(sessionId, now, env) {
  if ((env || process.env).USAGE_LIMITS_BRIEF_FULL === '1') return false;
  return standingSaid(sessionId, now);
}

// The prompt right after a cache miss the user can do something about.
//
// The status line JSON carries prompt_cache.last_miss_at (epoch seconds) and
// last_miss_cause.causes (Claude Code 2.1.260 and later; documented values
// tools_changed, system_prompt_changed, ttl_expired_5m, likely_server_side),
// and feed.js keeps the last one in this session's feed slot. Only the two
// causes a person can act on are named: a TTL expiry is time passing and a
// server-side miss is nobody's. It is said on the first brief after the miss
// and not again for that miss, and never for a miss older than half an hour,
// because "right after" is the whole point.
const MISS_RECENT_MS = 30 * 60 * 1000;
function missReason(causes) {
  const set = new Set(Array.isArray(causes) ? causes : []);
  if (set.has('system_prompt_changed')) return 'the system prompt changed';
  if (set.has('tools_changed')) return 'the tool list changed';
  return null;
}
function cacheMissWhyFor(sessionId, now) {
  if (!sessionId) return null;
  const at = Number.isFinite(now) ? now : Date.now();
  let miss = null;
  try {
    const slot = feed.readFeed()[sessionId];
    miss = slot && slot.cacheMiss;
  } catch (err) {
    return null;
  }
  if (!miss || !Number.isFinite(miss.at) || at - miss.at > MISS_RECENT_MS) return null;
  const why = missReason(miss.causes);
  if (!why) return null;
  const all = readSaid();
  const key = String(sessionId) + '#cachemiss';
  if (all[key] && all[key].at === miss.at) return null;
  all[key] = { at: miss.at };
  writeSaid(all, at);
  return why;
}
// One slot per session. A single shared slot meant that alternating between
// two Claude Code windows invalidated the cache on every prompt, so neither
// ever got a hit and both paid for a full scan each time.
const KEEP_SESSIONS = 5;

// A cache written before slots were keyed by session keeps its fields at the
// top level, so upgrading would carry "at", "turnsLeft", "session" and
// "sessionId" forward as if each were a session, crowding out real slots and
// quietly undoing the per-session caching. Anything that is not a slot goes.
function keepSlots(parsed) {
  if (!parsed || typeof parsed !== 'object') return {};
  const slots = {};
  for (const key of Object.keys(parsed)) {
    const value = parsed[key];
    if (value && typeof value === 'object' && Number.isFinite(value.at)) {
      slots[key] = value;
    }
  }
  return slots;
}

function readCache() {
  try {
    return keepSlots(JSON.parse(fs.readFileSync(cacheFile(), 'utf8')));
  } catch (err) {
    return {};
  }
}

function pickCached(all, sessionId, now, ttlMs) {
  const entry = all ? all[sessionId || '_'] : null;
  if (!entry || !Number.isFinite(entry.at)) return null;
  return now - entry.at < ttlMs ? entry : null;
}

// How many sessions are actually open right now.
//
// The count derived from spend is the accurate one, but it is always late: a
// session only appears in it once it has finished a turn and written the cost
// to its transcript. Three windows that all submit a prompt at the same moment
// each see a count of one, which is exactly when knowing about the other two
// would have mattered most.
//
// This cache is the earlier signal. Every session writes its own slot when the
// hook runs, so a slot touched in the last few minutes is a session that was
// being used, whether or not its spend has landed yet. It costs nothing: the
// file has already been read.
const LIVE_WINDOW_MS = 15 * 60 * 1000;

// Counts the other sessions, not this one. This session's own slot may not be
// written yet on its first prompt, so counting slots directly would report two
// when three windows are open.
function liveSessions(all, now, windowMs, exceptId) {
  const within = Number.isFinite(windowMs) ? windowMs : LIVE_WINDOW_MS;
  const mine = exceptId || '_';
  let count = 0;
  for (const key of Object.keys(all || {})) {
    if (key === mine) continue;
    const entry = all[key];
    if (!entry || !Number.isFinite(entry.at)) continue;
    if (now - entry.at <= within) count += 1;
  }
  return count;
}

// How many sessions are sharing the budget, and how much of it is this one's.
// One place for both hooks. The pulse once counted only sessions that had
// spent while the brief also counted those that had merely prompted, and the
// two lines disagreed about how many sessions there were minutes apart. The
// spend-derived count is the accurate one when it has caught up; the
// open-session count is the one that is right immediately. Take whichever is
// higher, because under-counting is what makes the headroom read as more
// yours than it is.
function activeShare(sessions, slots, now, sessionId) {
  const spent = sessions || [];
  const active = Math.max(spent.length, liveSessions(slots, now, LIVE_WINDOW_MS, sessionId) + 1);
  return { active, share: active > 1 ? usage.shareOf(spent, sessionId, active) : 1 };
}

// Keep the newest few so a machine with many sessions does not grow the file
// without bound.
function mergeCache(all, sessionId, entry, keep) {
  const next = Object.assign({}, all || {});
  next[sessionId || '_'] = entry;
  const ordered = Object.keys(next).sort((a, b) => (next[b].at || 0) - (next[a].at || 0));
  const trimmed = {};
  for (const key of ordered.slice(0, keep || KEEP_SESSIONS)) trimmed[key] = next[key];
  return trimmed;
}

function writeCache(all) {
  // Never throws: a cache miss costs a scan, a crash costs the prompt. Atomic
  // because every open window's prompt hook writes this same file, and a torn
  // read by one of them wiped the others' slots on the way back.
  usage.writeJsonAtomic(cacheFile(), all);
}

function settings() {
  const env = process.env;
  const number = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  return {
    near: number(env.USAGE_LIMITS_NEAR, DEFAULTS.near),
    floor: number(env.USAGE_LIMITS_FLOOR, DEFAULTS.floor),
    ahead: number(env.USAGE_LIMITS_AHEAD, DEFAULTS.ahead),
    cacheSeconds: number(env.USAGE_LIMITS_CACHE, DEFAULTS.cacheSeconds),
    fewTurns: number(env.USAGE_LIMITS_FEW_TURNS, DEFAULTS.fewTurns),
    runwayMinutes: number(env.USAGE_LIMITS_RUNWAY, DEFAULTS.runwayMinutes),
    refreshSeconds: number(env.USAGE_LIMITS_REFRESH, DEFAULTS.refreshSeconds),
  };
}

// How far ahead of the clock the spending is. A weekly window two days in
// should be near 29 percent spent; 60 percent means it will not last.
function aheadOfPace(window, now) {
  if (!window || !window.spanMs || !Number.isFinite(window.windowStart)) return null;
  if (window.percentUsed === null) return null;
  const elapsed = ((now - window.windowStart) / window.spanMs) * 100;
  return window.percentUsed - Math.min(100, Math.max(0, elapsed));
}

// Spending faster than the clock only means something for a window you have to
// make last. A window that comes back in hours is meant to be spent in a burst:
// nothing carries over, so holding budget back buys nothing at all, and the
// only thing an even pace achieves is getting less done for the same money.
const PACE_MIN_SPAN_MS = 24 * 60 * 60 * 1000;
const PACE_MIN_ELAPSED = 0.25;

function pacingMatters(window, now) {
  if (!window || !window.spanMs || !Number.isFinite(window.windowStart)) return false;
  if (window.spanMs < PACE_MIN_SPAN_MS) return false;
  // Early on, the comparison is dominated by how little of the window has gone
  // rather than by how much has been spent. Twenty minutes into a five hour
  // window every working session is far "ahead of pace", which is exactly how
  // 44 per cent used came to be reported as tight.
  return (now - window.windowStart) / window.spanMs >= PACE_MIN_ELAPSED;
}

// Not whether to speak, which is always, but how hard to lean on it.
function pressure(window, now, config, turnsLeft) {
  if (!window || window.percentUsed === null || window.stale) return 'unknown';
  if (window.verdict === 'exhausted' || window.percentUsed >= 100) return 'gone';
  if (window.verdict === 'runs-out') return 'tight';

  // How long the budget lasts at the pace it is actually being spent at. This
  // is the only figure here that answers "am I about to be cut off", and it was
  // being computed and then ignored.
  //
  // When a reset time is known, a short runway already shows up as the
  // 'runs-out' verdict above. When it is not - and a 5-hour window whose
  // resets_at comes back null is exactly that case - the verdict is only
  // 'burning', which fell through every branch below to 'roomy'. Three sessions
  // were told the budget fitted easily while this number said forty-three
  // minutes; nine minutes later all three were rejected.
  //
  // It is also the right figure when several agents share one budget: the pace
  // it is measured from is the whole account's, not this session's, so the
  // runway already shortens as others spend.
  const runwayMs = Math.max(0, config.runwayMinutes) * 60 * 1000;
  if (Number.isFinite(window.headroomMs) && window.headroomMs <= runwayMs) {
    return 'tight';
  }

  if (window.percentUsed >= config.near) return 'tight';

  // Turns are the number the work is planned in, so a count this short is the
  // wall whatever the percentage says.
  if (Number.isFinite(turnsLeft) && turnsLeft <= config.fewTurns) {
    return 'tight';
  }

  // Being ahead of the clock is reported and is deliberately not escalated. A
  // five hour window is meant to be spent in a burst, and even a weekly one
  // being spent quickly is a fact about how the week is going rather than a
  // reason to do less today. The figures are in the line; the judgement is the
  // reader's.
  return 'roomy';
}

// Everything about the binding window that has to survive the cache, because
// the cached copy is what every later prompt in the minute is judged against.
//
// This is a list rather than the window itself so the cache stays small, and it
// is a named function so it can be checked: leaving `headroomMs` off it once
// meant the escalation that depends on the runway was dead in production while
// passing every unit test, which is the quietest way for a warning to fail.
const CACHED_BINDING_FIELDS = [
  'key',
  'label',
  // The model family a per-model weekly is scoped to. Read by the line that
  // says a model switch is the only thing that frees such a window, so it has
  // to survive the cache like every other field the wording depends on.
  'family',
  'applies',
  'percentUsed',
  'stale',
  'estimated',
  'adjusted',
  'pointsSinceSnapshot',
  'correctionUnreliable',
  'pointsBeyondSnapshot',
  // Both account readings, when there are two, so the line can name them.
  'sources',
  'resetsAt',
  'verdict',
  'windowStart',
  'spanMs',
  'headroomMs',
  'msToReset',
  'refusedAt',
  'refusedResetsAt',
  // What the room that is left buys, per window. Needed because the binding
  // window can be swapped for the weekly once low-priority is acknowledged, and
  // a swapped window with the old window's turn count would be the brief
  // quoting two different budgets in one sentence.
  'turnsLeft',
];

function cacheableBinding(binding) {
  if (!binding) return null;
  const copy = {};
  for (const field of CACHED_BINDING_FIELDS) {
    copy[field] = binding[field] === undefined ? null : binding[field];
  }
  return copy;
}

// Every field `pressure` reads has to be one the cache keeps, or the decision
// it makes on a cache hit is made from missing data.
function pressureInputs() {
  return ['percentUsed', 'stale', 'verdict', 'headroomMs', 'windowStart', 'spanMs', 'estimated'];
}

// The hook is handed JSON on stdin. The session id in it is what lets this
// report what the current session has cost rather than the whole window.
function readHookInput() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve(null);

    let raw = '';
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      try {
        resolve(raw ? JSON.parse(raw) : null);
      } catch (err) {
        resolve(null);
      }
    };

    // A hook must never hang the prompt waiting for input that is not coming.
    const timer = setTimeout(done, 500);
    if (timer.unref) timer.unref();

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      raw += chunk;
    });
    process.stdin.on('end', done);
    process.stdin.on('error', done);
  });
}

// Kept as a re-export so there is exactly one implementation.
const sessionSpend = usage.sessionSpend;

// One is not a plural. The line is read by an agent that then repeats it to
// the user, so "about 1 points" is a small error that gets copied out loud.
function count(value, word) {
  return value + ' ' + word + (Math.abs(value) === 1 ? '' : 's');
}

// The other agent's meter, in one clause.
//
// Codex reports what is LEFT where Claude reports what is USED, so every
// figure here carries the word "left" - a bare percentage next to Claude's
// would be read as the same kind of number and mean the opposite thing.
//
// Read from Codex's rollouts on disk. Nothing spawns Codex, nothing waits on
// it, and a machine without it pays one stat call.
function codexSummary(now) {
  try {
    if (usage.isCodex() || !host.codexHasSessions()) return null;
    const display = require('./view.js');
    const codex = require('./codex.js');
    const other = codex.collect(now);
    const block = display.buildCodex({
      now,
      utilization: other.utilization,
      fetchedAtMs: other.snapshotFetchedAt,
      windowSpecs: other.windowSpecs,
      plan: other.plan,
      windowless: other.windowless,
    });
    if (!block.present) return null;
    const names = { five_hour: '5-hour', seven_day: 'weekly' };
    const bits = block.rows
      .filter((row) => row.percentLeft !== null)
      .map((row) => (names[row.key] || row.title) + ' ' + Math.floor(row.percentLeft) + '% left');
    if (!bits.length) return null;
    return { plan: block.plan, bits, stale: block.state !== 'live' };
  } catch (err) {
    // An unreadable Codex is simply no Codex clause.
    return null;
  }
}

function describeWindow(window) {
  if (!window) return null;
  if (window.stale) return window.label + ' rolling over';
  const about = window.estimated || window.adjusted ? ' about ' : ' ';
  // A per-model weekly for a model this session is not running is listed, but
  // never bare: 88% beside the other percentages is read as 88% of the budget
  // in hand, and the reply that follows sizes the work down for a limit not one
  // turn here can move.
  const idle = window.applies === false ? " (not this session's model)" : '';
  // Two account readings that disagree are named, not averaged and not
  // silently picked between. On 2026-09-20 one window read 14, 30 and 20 per
  // cent within three minutes as Claude Code's cache and the plugin's own
  // live reading took turns being the newer; a reader who sees one number
  // cannot tell that from the budget moving. Five points is the line: under
  // that the two are the same reading at different moments.
  const s = window.sources;
  const split =
    s && Number.isFinite(s.cache) && Number.isFinite(s.live) && Math.abs(s.cache - s.live) > 5
      ? s.used === 'live'
        ? " (the live reading; Claude Code's cache says " + s.cache + '%)'
        : " (Claude Code's cache; the live reading says " + s.live + '%)'
      : '';
  return window.label + about + window.percentUsed + '%' + split + idle;
}

// Everything except the window that will actually stop the work.
function summariseOthers(windows, bindingKey) {
  return windows
    .filter((window) => window.percentUsed !== null && window.key !== bindingKey)
    .map(describeWindow)
    .join(', ');
}

// The user's bounds, applied at the rendering boundary rather than at each of
// the half-dozen places a cheaper tier can be suggested.
//
// The invariant is about what reaches the reader: with a floor of opus/high
// set, NOTHING the plugin says may point below opus/high. Filtering here means
// a new suggestion path cannot quietly bypass the bound by being added
// somewhere else, which is exactly how a rule like this rots.
function applyBounds(parts, bounds) {
  if (!bounds || (!bounds.floor && !bounds.ceiling && !bounds.pin)) return parts;
  const next = Object.assign({}, parts);
  const ok = (suggestion) => mode.allows(bounds, suggestion);
  if (next.escape) {
    const target =
      next.escape.kind === 'model' ? { model: next.escape.suggest } : { effort: next.escape.to };
    if (!ok(target)) next.escape = null;
    // Pinned means the plugin observes and keeps its hands off. The route is
    // still true and still worth knowing; what changes is that it is reported
    // rather than instructed.
    else if (bounds.pin) next.escape = Object.assign({}, next.escape, { report: true });
    // A model escape with no named target passes allows() by construction:
    // an unranked name is not evidence of a breach, and a NULL name has no
    // rank at all. That is the right call for a spelling nobody recognises and
    // the wrong one here, because with a model floor set, "switch to another
    // model" is an instruction to go somewhere that may be below it. The route
    // is still true, so it is reported rather than instructed.
    else if (next.escape.kind === 'model' && !next.escape.suggest && bounds.floor && bounds.floor.model) {
      next.escape = Object.assign({}, next.escape, { report: true });
    }
  }
  if (next.fit && !ok({ effort: next.fit.cheaper })) next.fit = null;
  if (next.effortWarning && next.effortWarning.cheaper && !ok({ effort: next.effortWarning.cheaper.effort })) {
    next.effortWarning = Object.assign({}, next.effortWarning, { cheaper: null });
  }
  // The per-model weekly sentence is a fourth suggestion path, and it was the
  // one this function did not touch. With `--floor opus --pin` set the brief
  // stated both bounds and then, in the next clause, told the agent to switch
  // to another model "for work that does not need opus" - below the floor, in
  // a session that had pinned self-switching off, naming the settings.json
  // writer to do it with. The window being scoped to one model is a FACT and
  // stays; the instruction half is what the bounds govern.
  if (next.family) {
    const floorModel = bounds.floor && bounds.floor.model ? mode.modelRank(bounds.floor.model) : null;
    const here = next.familyKey ? mode.modelRank(next.familyKey) : null;
    // A floor at or above the family this window counts leaves no cheaper
    // model to point at, so the only honest form is the report.
    const noRoomBelow = floorModel !== null && here !== null && floorModel >= here;
    next.familySwitch = !bounds.pin && !noRoomBelow;
  }
  return next;
}

function briefText(input) {
  // The mode decides how much of this is said, and `off` decides that none of
  // it is - at any percentage, at any pressure. That is the whole promise of
  // that mode and it is honoured here, before a single sentence is built.
  const policy = (input.mode && input.mode.policy) || null;
  const style = policy ? policy.briefStyle : 'normal';
  if (style === 'none') return '';
  const bounds = (input.mode && input.mode.bounds) || null;
  const pinned = Boolean(bounds && bounds.pin);
  const parts = applyBounds(input, bounds);
  // The short standing form only where the three standing strings would
  // otherwise appear: the tight and gone instructions are their own words.
  const shortStanding = parts.standingShort === true && parts.pressure !== 'tight' && parts.pressure !== 'gone';

  // The turns and the reset time belong to one specific window. Listing every
  // window and then the numbers invites reading them against the wrong one, so
  // the binding window is named and its figures are attached to it.
  const bound = [];
  const described = describeWindow(parts.binding);
  // When spending since the snapshot has outrun what the snapshot said was
  // left, the percentage is the last real reading, not the current one, and
  // the headline has to say so or every later prompt repeats a stale number.
  if (described) bound.push(described + (parts.binding.stale ? '' : (parts.correctionUnreliable ? ' used at the last real reading' : ' used')));
  if (Number.isFinite(parts.turnsLeft)) {
    // Another session spending the same budget means fewer of those turns are
    // yours, so say both numbers rather than the flattering one.
    // The stance below is judged on yourTurnsLeft, so whenever that is the
    // smaller number it has to be on the line too. Printing only the window's
    // figure is how a brief came to say "the budget is nearly gone" beside
    // "about 594 turns of headroom": both were true, of different numbers.
    const yours = Number.isFinite(parts.yourTurnsLeft) ? parts.yourTurnsLeft : null;
    const fewerYours = yours !== null && yours < parts.turnsLeft * 0.75;
    const shared =
      parts.sessions > 1 && yours !== null
        ? ' (' + parts.sessions + ' sessions active, roughly ' + yours +
          ' of them yours)'
        : fewerYours
          ? ' (about ' + count(yours, 'turn') + ' of that yours at this context size)'
          : '';
    bound.push('about ' + count(parts.turnsLeft, 'turn') + ' of headroom' + shared);
    // A turn count is a poor sense of urgency when several agents are spending
    // at once: two hundred turns sounds like plenty and can be gone in ten
    // minutes. The runway is the figure that does not flatter.
    if (parts.runsOutIn) bound.push('about ' + parts.runsOutIn + ' of that at the current pace');
  } else if (parts.sessions > 1) {
    // The headroom could not be worked out, but the fact that the budget is
    // being shared is still the most important thing about it. Attaching this
    // only to a turn count meant it went unsaid exactly when there was no
    // reading to attach it to.
    bound.push(parts.sessions + ' sessions active and sharing it');
  }
  if (parts.resetsIn) bound.push('resets in ' + parts.resetsIn);

  const sentences = [];
  // The mode token, only when the mode is not the one the plugin has always
  // been in. In `standard` the line is what it has always been, down to the
  // first character; anywhere else the reader is owed the reason the line
  // looks different from the one they are used to.
  const token = parts.mode && parts.mode.name !== 'standard' ? '(' + (parts.mode.label || parts.mode.name) + ') ' : '';
  // Fast mode changes what the figures above mean, so it is said in the same
  // sentence. Per the Claude Code docs (code.claude.com/docs/en/fast-mode and
  // /prompt-caching): on a subscription it is billed from usage credits and
  // "not included in the subscription rate limits", so the window's turns are
  // not what it spends; and the first request sent with it on "reads the
  // entire conversation history with no cache hits", once per conversation.
  // Only while the status line has said it is on; nothing is assumed.
  const fast = parts.fastMode
    ? '; fast mode on, billed from usage credits rather than this window, and its first turn re-reads the whole context uncached'
    : '';
  // One clause, on the prompt right after a cache miss the user caused, and
  // nothing otherwise. The cause comes from the status line's prompt_cache
  // object through feed.js; see cacheMissWhyFor.
  const missed = parts.cacheMissWhy
    ? '; the prompt cache missed on the last call because ' + parts.cacheMissWhy + ', so that call re-read the whole context'
    : '';
  sentences.push(
    bound.length
      ? '[usage-limits] ' + token + 'binding window is ' + bound.join(', ') + fast + missed + '.'
      : '[usage-limits] ' + token + 'no usable window reading' + fast + missed + '.'
  );
  // What tier is producing this turn.
  //
  // The line used to report the window, the turns, the session cost and the
  // context - everything about how much is being spent, and nothing about what
  // is doing the spending. The number that decides the cost of a turn was the
  // one number the line never printed. It says where the reading came from as
  // well as what it is, because the source is the whole point: settings.json
  // said xhigh for an entire session that was running something else.
  if (parts.tier) sentences.push(parts.tier);
  // Once per session, and only when the installed version is not this one.
  if (parts.staleVersion) sentences.push(parts.staleVersion);
  if (parts.newerModel) sentences.push(parts.newerModel);
  const bounded = mode.boundsNote(bounds);
  if (bounded) sentences.push(bounded);
  if (parts.planChanged) {
    sentences.push(
      'The plan has changed since these figures were learned, so the reading ' +
        'above was measured against a different allowance and may predate the ' +
        'change; run /usage before trusting it.'
    );
  }
  if (parts.rebuilt) {
    sentences.push(
      'That figure was rebuilt from local history because the ' +
        'snapshot is ' + parts.snapshotAge + ' old; run /usage to refresh it.'
    );
  } else if (parts.pointsSinceSnapshot) {
    sentences.push(
      'That includes about ' + count(parts.pointsSinceSnapshot, 'point') + ' spent since the ' +
        'snapshot was taken ' + parts.snapshotAge + ' ago, which it does not know about yet.'
    );
  } else if (parts.staleWindows) {
    // Do not quietly carry on with a window we know is wrong and could not
    // rebuild. Say it is unknown and point at the one command that fixes it.
    sentences.push(
      'A window is past its reset and could not be rebuilt from local history, ' +
        'so its reading is unknown rather than current; the snapshot is ' +
        parts.snapshotAge + ' old, so run /usage before trusting the rest.'
    );
  }
  if (parts.correctionUnreliable) {
    // A reading three hours old that has been spent past its own remainder is
    // not 82%; it is unknown, with 82% as the floor. Say exactly that.
    sentences.push(
      'That percentage is a floor, not a current reading: the last real snapshot is ' +
        parts.snapshotAge + ' old and about ' + count(parts.pointsBeyondSnapshot, 'point') +
        ' have been spent since, more than it said was left. Either the window is ' +
        'already exhausted or the snapshot is wrong; /usage refreshes it.'
    );
  } else if (parts.snapshotStale) {
    // The other way the figure goes wrong, and the one that actually happened.
    //
    // correctionUnreliable only fires when the measured spend EXCEEDS what the
    // snapshot said was left, so a snapshot taken at the very start of a window
    // can never trip it: everything spent since is still inside the remainder.
    // On 2026-09-13 that combination reported 7 per cent for most of a session
    // in which the account was at 41 - Claude Code's own cache had not moved in
    // 50 minutes, the plugin's live reading was rate-limited into backoff, and
    // the correction was quietly carrying the entire difference on its own.
    //
    // A correction is a measurement of local transcripts priced by a learned
    // rate. It is a good adjustment to a recent snapshot and a bad substitute
    // for an old one, because the pricing error compounds with every point it
    // has to bridge. The figure here is snapshot plus correction: a point
    // estimate that can land on either side of the account - on 2026-09-20 it
    // ran 13 to 17 points HIGH - so it is called an estimate. "Floor" is kept
    // for the branch above, where the correction is refused and the raw
    // snapshot is all that is shown, which really is a lower bound.
    sentences.push(
      'Treat that percentage as an estimate rather than a reading, high or low: the account ' +
        'snapshot behind it is ' + parts.snapshotAge + ' old, so most of the figure is measured ' +
        'from local history at a learned price rather than read from the account, and ' +
        'that gap widens the longer the snapshot stands. Run /usage to refresh it before ' +
        'making a decision that depends on the exact number.'
    );
  }
  // Work having actually been stopped is the most useful thing that can be said
  // about a budget, and the percentages stop showing it the moment the window
  // turns over. Saying it plainly is what stops the next session opening with
  // "plenty of room" an hour after the last one was cut off mid-edit.
  if (parts.refusedAgo) {
    sentences.push(
      'This limit refused work ' + parts.refusedAgo + ' ago, so treat the room above as ' +
        'the amount that ran out last time, not a fresh allowance.'
    );
  }
  // The other agent, when there is one on this machine. Its own budget, its
  // own direction: Codex counts down.
  if (parts.codex && parts.codex.bits.length) {
    sentences.push(
      'Codex' + (parts.codex.plan ? ' (' + parts.codex.plan + ')' : '') + ' has ' +
        parts.codex.bits.join(' and ') +
        (parts.codex.stale ? ', from the last reading it wrote' : '') + '.'
    );
  }
  // The effort setting changes the PRICE of a turn rather than how many there
  // are, and the blended headroom above hides that completely: an account that
  // has just moved to a dearer effort goes on being priced at the old one until
  // enough dear turns have landed to drag the average up, and on a small window
  // there is no "enough" - the window is gone first.
  //
  // A ChatGPT Plus account running gpt-6-astra at ultra effort emptied a whole
  // five-hour window on one ordinary task while this hook reported room the
  // entire way. Saying it here is what turns "plenty of room" into "about
  // twenty turns" before the window is spent rather than after.
  if (parts.effortWarning) {
    const warning = parts.effortWarning;
    const bits = [];
    if (Number.isFinite(warning.turnsLeft)) {
      const blended = warning.blendedTurnsLeft;
      bits.push(
        'at ' + warning.effort + ' effort this window holds about ' + count(warning.turnsLeft, 'turn') +
          (Number.isFinite(blended) && blended > warning.turnsLeft
            ? ', not the ' + blended + ' the headroom above suggests'
            : '')
      );
    }
    if (warning.cheaper && Number.isFinite(warning.cheaper.multiple)) {
      bits.push(
        warning.effort + ' writes about ' + warning.cheaper.multiple.toFixed(1) +
          ' times the output per turn that ' + warning.cheaper.effort + ' does'
      );
    }
    if (bits.length) {
      sentences.push(
        'The effort setting is what is spending this: ' + bits.join(', and ') +
          '. Keep it where the work genuinely needs the thinking and drop it where it ' +
          'does not; it changes what every turn costs, not how many you get.' +
          // The command, in the host's own vocabulary. /effort does not exist
          // in Codex, and naming it there is telling Codex to do nothing while
          // believing it acted.
          // The host this line is being written FOR, not whatever the process
          // happens to be set to. Reading global state here meant the sentence
          // was only accidentally right, and a caller that built a line for
          // the other host got a command that does not exist there.
          (warning.cheaper && warning.cheaper.effort
            ? ' To drop it: ' + usage.levers(parts.host || usage.currentHost()).effort(warning.cheaper.effort) + '.'
            : '')
      );
    }
  }
  // A per-model weekly is the one window effort cannot help with. Nothing you
  // do more cheaply on this model frees it; only running a different model
  // does, and that has to be said, because the obvious move at 90 percent is
  // to drop the effort and keep going, which spends the same window slower.
  // Suppressed when the escape line below fires: that one says the same thing
  // and names the model to switch to, where this one only ever managed
  // "Use /model (or ...". Two sentences making one point is a cost paid on
  // every prompt.
  const namesTheSwitch = parts.escape && parts.escape.kind === 'model';
  if (parts.family && !namesTheSwitch) {
    // The fact first, because it is true under every bound: nothing done more
    // cheaply on this model frees a window that counts only this model.
    const fact =
      'That window counts ' + parts.family + ' turns only, so lowering effort does not free it: ' +
      'switching model does.';
    sentences.push(
      parts.familySwitch === false
        ? fact + ' The bounds above rule that switch out, so this is a report: leave the model ' +
          'where it is and say in one line that the window is scoped to ' + parts.family + '.'
        : fact + ' Running work that does not need ' + parts.family + ' on a cheaper model is the ' +
          'lever, and it is the user\'s own setting to change - say so in one line rather than ' +
          'changing it. What IS yours is the model on anything you spawn: size that to the stage.'
    );
  }
  if (parts.othersSummary) sentences.push('Other windows: ' + parts.othersSummary + '.');

  // Being at the wall and being out of budget are different things, and the
  // difference is a command. Said as soon as the window is half gone, so it is
  // already known by the time it matters.
  const escape = parts.escape;
  // Pinned is the pure form of "this is the user wanting to decide for
  // themselves": the plugin observes, reports the gap, and keeps its hands
  // off. The route is unchanged - it is still true, and hiding it would be
  // withholding a fact - but every sentence built from it becomes a report
  // rather than an instruction.
  const lever = (command) =>
    pinned
      ? 'The lever is ' + command + ', and it is yours to take or leave: self-switching is pinned, so this is a report and not a switch.'
      : 'Use ' + command + '.';
  const escapeText =
    escape && escape.kind === 'model'
      ? 'This window is scoped to one model, so it is not the account\'s budget: switching model retires it. ' +
        (escape.nextLabel
          ? 'After a switch the binding window would be ' + escape.nextLabel + ' at ' + escape.nextPercent + ' per cent. '
          : '') +
        // No command rather than a wrong one: the vocabulary differs by host,
        // and "Use undefined" is worse than saying which lever it is and
        // leaving the reader to reach for it.
        (escape.command ? lever(escape.command) : '')
      : escape && escape.kind === 'effort'
        ? 'A model switch does not free this window - it follows the account - but effort does: ' +
          escape.to + ' measured ' + (escape.multiple ? escape.multiple + 'x ' : '') + 'cheaper a turn than ' +
          (escape.from || 'the current effort') + '.' + (escape.command ? ' ' + lever(escape.command) : '')
        : null;
  // Not only an emergency exit. The same lever is the right one whenever the
  // setting is dearer than the work in front of you needs - a mechanical edit
  // does not need the model a hard design decision does. Say so, because an
  // agent that only ever reads this as a wall notice will run every trivial
  // turn at the top setting and then wonder where the window went.
  //
  // What it must NOT say is that the agent may take it unasked. The commands
  // above are user-plane: /model and /effort are typed by a person, and
  // lowpower.js writes settings.json. This is the one channel that actually
  // reaches the model, so a sentence here saying "you may make that change
  // yourself, without being asked" was the plugin's own doctrine - "Claude may
  // never make one unasked" - broken in the place it does the most damage.
  // Naming it early and clearly is still right; making it is still the user's.
  const chooseText = escapeText && !pinned
    ? ' Raise it whenever the current setting is dearer than the work needs, not ' +
      'only when the window is nearly gone: say in one line that it is worth ' +
      'changing and why, and leave the change itself to the user, whose setting ' +
      'it is. What is yours without asking is the tier of what you SPAWN - the ' +
      'model on an Agent call, the model and effort inside a Workflow - so size ' +
      'that to the stage.'
    : '';
  // Kept in a variable as well as pushed: the terse style drops the sentences
  // that read the same every turn, and this is not one of them. Being at the
  // wall and being out of budget are different things, and the difference is a
  // command - dropping THAT to save characters would be the mode buying its
  // saving out of the one fact that changes what happens next.
  const escapeSentence =
    escapeText && parts.binding && Number.isFinite(parts.binding.percentUsed) && parts.binding.percentUsed >= HALF_SPENT
      ? escapeText + chooseText
      : null;
  if (escapeSentence) sentences.push(escapeSentence);

  // A window that is not binding can still be the expensive one to exhaust.
  if (parts.critical && parts.critical.length) {
    for (const other of parts.critical) {
      sentences.push(
        'Note that ' + other.label + ' is at ' + other.percentUsed + '% and resets in ' +
          other.resetsIn + ', so running that one out stops work for far longer than the ' +
          'binding window would. Weigh it even though it is not what runs out first.'
      );
    }
  }
  // /low-priority: the other thing that is not stopping.
  //
  // Three rules this block exists to keep. It says nothing at all unless the
  // account is provisioned for the command, because advertising a slash command
  // an account does not have is worse than silence. It never implies that the
  // plugin or the model can switch it on - Claude cannot type a slash command,
  // and the command is declared supportsNonInteractive:false, so it is unusable
  // in a headless or relayed run as well. And it words the offer as a
  // possibility, because the real gate is an experiment arm in a response
  // header that nothing here will ever see.
  //
  // No wait time is printed. The retry and the ceiling come from
  // lowPriorityRetryAfterSeconds and lowPriorityMaxWaitSeconds on each
  // response, so any fixed number would be invented.
  // Kept in a variable as well as pushed, for the same reason as the escape: it
  // is the difference between stopping at the 5-hour wall and not, and the terse
  // style drops only what reads the same every turn. This does not.
  const lp = parts.lowPriority || null;
  let lowPrioritySentence = null;
  // The acknowledged sentence describes the SWAP, so it may only be said when
  // the swap really happened. wallFeatures refuses to swap unless there is a
  // weekly window with a live percentage and a known reset, and this branch
  // used to fire on the acknowledgement alone - so on an account with no
  // readable weekly the brief said "binding window is 5-hour 99% used" in one
  // clause and "the figures above are the weekly" in the next. A line that
  // contradicts the numbers printed beside it is worse than no line: it tells
  // the model to ignore a wall that is still there.
  if (lp && lp.state === 'acknowledged' && lp.weeklyBinding) {
    lowPrioritySentence = (
      'The user has said /low-priority is on, so the brake is the weekly window and not the 5-hour one: ' +
        (Number.isFinite(lp.fiveHourPercent)
          ? 'the 5-hour limit is at ' + lp.fiveHourPercent + '% and no longer stops this session, '
          : 'the 5-hour limit no longer stops this session, ') +
        'the figures above are the weekly, and replies may pause while lower priority waits for spare ' +
        'capacity. Whether it is still on cannot be read from here, so if the user says it has ended, ' +
        'record that with usage-mode --low-priority off and the 5-hour wall counts again. It also draws on a separate ' +
        'weekly lower-priority allowance that is exposed to no hook and no file, so nothing here can ' +
        'track how much of that is left.'
    );
  } else if (lp && lp.state === 'acknowledged') {
    // Acknowledged, but there is no weekly reading to brake on, so the figures
    // above are still the window they say they are and the wall is still real.
    lowPrioritySentence = (
      'The user has said /low-priority is on, which spends the weekly limit instead of stopping at the ' +
        '5-hour one - but there is no usable weekly reading here to brake on, so the figures above are ' +
        'the window named beside them and that window is still the one to plan against. /usage (the ' +
        'user types it) refreshes the account snapshot; until it has a weekly, treat the limit above as real.'
    );
  } else if (lp && lp.advise && lp.advise.kind === 'offer') {
    lowPrioritySentence = (
      'If the wall offers it, /low-priority can carry this session past the 5-hour limit at lower ' +
        'priority instead of stopping: it spends the weekly limit, which is at ' +
        lp.advise.weeklyPercent + '% and so has room, and replies may pause while it waits for spare ' +
        'capacity - the wait and its ceiling are set by the server per request. It is a toggle only ' +
        'the user can type, and type again to stop: you cannot run a slash command, and nothing here ' +
        'can switch it on. Tell the user in one line that it is there; if the user says it is taken, ' +
        'usage-mode --low-priority on is what makes this line brake on the weekly instead.'
    );
  } else if (lp && lp.advise && lp.advise.kind === 'hold') {
    lowPrioritySentence = (
      'The wall may offer /low-priority here, and it is not worth taking: it spends the weekly limit, ' +
        'which is already at ' + lp.advise.weeklyPercent + '% - past the ' + lp.advise.threshold +
        ' per cent this plugin will recommend it at - and it draws on a weekly lower-priority ' +
        'allowance as well, which one user has reported burning through almost a week of usage in a ' +
        'couple of hours. The choice is the user\'s, and only the user can type it: say in one line ' +
        'that this plugin advises against it and why; waiting out the 5-hour reset is the cheaper move.'
    );
  }
  if (lowPrioritySentence) sentences.push(lowPrioritySentence);
  // A manual reset behind /limit-reset, when this account holds one.
  //
  // Two server flags sit behind the one command and they are different offers,
  // so each is worded in its own copy's terms and nothing is borrowed across
  // (lowpri.sessionReset has the bundle strings):
  //
  //   'weekly' (tengu_nifty_lemur, which this account has): resets the 5-hour
  //   session limit, once a week, and the work still counts toward the weekly.
  //   So it only helps when the 5-hour window is the wall - said at a weekly
  //   wall it would be advice that cannot work - and the first build, reading
  //   only the other flag, never said it at all.
  //
  //   'grant' (tengu_cedar_ember): a counted reset with a use-by date that
  //   "refills your limits". Its copy does not say it spends the weekly, and it
  //   has an early-use path, so neither "once a week" nor "only at a limit" is
  //   claimed for it.
  //
  // Neither is counted: whether this week's reset is already used, and how
  // many grants are left, are served by the API and appear in no file. And the
  // CLI refuses a reset while lower priority runs ("Resets can't be used while
  // you continue at lower priority"), which is why the weekly variant stays
  // silent once the brief has swapped to the weekly, and the grant says so.
  const resetVariant = lp && lp.resetGrant ? lp.resetVariant || 'grant' : null;
  const resetPressure = parts.pressure === 'tight' || parts.pressure === 'gone';
  const fiveHourWall = Boolean(parts.binding && parts.binding.key === 'five_hour');
  // Acknowledged is checked on its own as well as through the binding: with no
  // weekly reading the brief cannot swap, the 5-hour window stays binding, and
  // the reset would be offered to a session the CLI will not reset.
  if (resetVariant === 'weekly' && resetPressure && fiveHourWall && lp.state !== 'acknowledged') {
    sentences.push(
      'This account is set up for a manual session reset (/limit-reset): once a week it resets the ' +
        '5-hour limit, and the work it unlocks still counts toward the weekly, so it moves the 5-hour ' +
        'wall rather than adding budget. The server decides whether it can be used right now, and ' +
        "whether this week's is already used is not readable from here. Like /low-priority, only the user can type " +
        'it; you cannot run a slash command.'
    );
  } else if (resetVariant === 'grant' && resetPressure) {
    sentences.push(
      'This account appears to hold a limit reset (/limit-reset), which the CLI describes as refilling ' +
        'your limits while the weekly reset day stays put. How many are left and until when is not ' +
        'readable from here - the CLI asks the server for that.' +
        (lp.state === 'acknowledged' ? ' The CLI will not use one while lower priority is on.' : '') +
        ' Like /low-priority, only the user can type it; you cannot run a slash command.'
    );
  }
  // The cloud-session credit: the one lever that carries work past the wall
  // on an account with usage credits off. Only near the wall, only once a
  // session (run() decides), and it is the user's credit, so it is offered,
  // never taken.
  const cloudSentence =
    parts.cloudCredit && (parts.pressure === 'tight' || parts.pressure === 'gone')
      ? 'A cloud session is the way past this wall now rather than after the reset: the account has a ' +
        parts.cloudCredit + ' cloud-session credit on top of the plan, and relay cloud prints the claude --cloud ' +
        'command that hands it this work (it clones from GitHub, so push first). Offer it in one line; it spends ' +
        "the user's credit, so starting it is their call."
      : null;
  if (cloudSentence) sentences.push(cloudSentence);
  if (parts.session) {
    sentences.push(
      'This session: ' + parts.session.turns + ' turns, ' +
        (Number.isFinite(parts.session.tokens) ? usage.formatTokens(parts.session.tokens) + ' tokens, ' : '') +
        usage.formatUSD(parts.session.cost) + '.'
    );
  }
  // From the tally the Stop hook keeps, so these are exact as of the last reply.
  if (parts.lastReply && Number.isFinite(parts.lastReply.cost)) {
    sentences.push('Last reply ' + usage.formatMoney(parts.lastReply.cost) + '.');
  }
  if (Number.isFinite(parts.context) && parts.context > 0) {
    // The context is re-sent on every call, so past a point it is the cost of
    // the session. One clause, once it is large; no advice while it is not.
    sentences.push(
      'Context about ' + usage.formatTokens(parts.context) + ' tokens' +
        (parts.context >= LARGE_CONTEXT_TOKENS
          ? '; each turn re-reads that, so a fresh session or /compact at the next clean boundary cuts per-turn cost.'
          : '.')
    );
  }
  // Said once, on a session's first prompt, because the previous session's
  // total is the one figure nothing else ever shows.
  if (parts.lastSession && parts.lastSession.turns) {
    const last = parts.lastSession;
    sentences.push(
      'Last session: ' + last.turns + ' turns, ' + usage.formatTokens(last.tokens) + ' tokens, ' +
        roundMoney(last.cost) +
        (last.project || last.endedAgo
          ? ' (' +
            [
              last.project,
              last.endedAgo
                ? (last.open ? 'still open, last active ' : 'ended ') + last.endedAgo + ' ago'
                : null,
            ]
              .filter(Boolean)
              .join(', ') +
            ')'
          : '') + '.'
    );
  }

  // Is the setting bigger than the work needs? Asked from the setting, not
  // from the budget: a mechanical hour at the top setting is waste at 10 per
  // cent used exactly as much as at 80. The plugin supplies the measured half
  // and asks for the judgement, because only the reader knows what is coming.
  //
  // Said once per setting per session. Every prompt would be nagging, and the
  // question only changes when the setting does.
  if (parts.fit) {
    sentences.push(
      'Your effort is ' + parts.fit.effort + ', measured at ' + parts.fit.multiple +
        ' times the cost of ' + parts.fit.cheaper + ' a turn on this account (' +
        parts.fit.sample + ' turns against ' + parts.fit.cheaperSample + '). Judge what is ' +
        'actually in front of you before the next stretch: mechanical work - a rename, a docs ' +
        'pass, running tests, applying a fix you have already worked out - does not need it. ' +
        'If this stretch is that, say so in one line and name the lever. Dropping your own ' +
        'effort (' + parts.fit.command + ') is the user\'s setting to change, so offer it ' +
        'rather than making it; handing the stretch to a cheaper model and doing less of it at ' +
        'this setting are yours - a fan-out multiplies the setting across every agent. Put it ' +
        'back when the work gets hard again.'
    );
  }

  if (parts.voiceNote) sentences.push('How this user wants to be written to: ' + parts.voiceNote);

  // What the relay changes about all of this.
  //
  // With a wake booked, the end of the window stops being the end of the work,
  // and the instruction at the wall changes shape: the handoff is no longer a
  // note somebody has to find and read, it is the prompt this conversation
  // will be handed back. That is worth two minutes of writing, and it is worth
  // saying plainly, because a session told only "you are about to be cut off"
  // spends its last turns hedging.
  const carry = parts.relay;
  // Kept as well as pushed, for the same reason as the escape: a relay changes
  // what being cut off COSTS, which is the difference between winding down and
  // carrying on. The terse style drops what reads the same every turn; this is
  // not that.
  const relaySentences = [];
  if (carry && carry.armed) {
    const wake = new Date(carry.armed.wakeAt);
    relaySentences.push(
      'A relay is armed: ' + (carry.justArmed ? 'booked just now' : 'booked') + ' for ' +
        wake.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ', ' +
        carry.config.graceMinutes + ' minutes after this window resets, and it will ' +
        (carry.armed.mode === 'resume' ? 'hand your continuation straight back to this conversation' : 'notify the user with your continuation ready to open') +
        '.' + (carry.armed.warning ? ' Caveat: ' + carry.armed.warning + '.' : '')
    );
    if (!carry.armed.continuation) {
      relaySentences.push(
        'Nothing has been written for it yet. Before this session ends, run ' +
          'node "$CLAUDE_PLUGIN_ROOT/skills/usage-limits/scripts/relay.js" note "<what you would tell yourself>" ' +
          'with what is done, what is next in order, which files are mid-change and what must be verified first. ' +
          'That text is the prompt the relay delivers, so write it to be acted on, not read.'
      );
    }
  }
  // The relay was built for a CLI that stopped dead at the wall. Since 2.1.234
  // Claude Code waits out the reset and continues the same open session by
  // itself, and the setting that does it is ON BY DEFAULT
  // (autoContinueAtUsageLimit, code.claude.com/docs/en/settings-reference). In
  // place, with the context intact, that is strictly better than a wake: no
  // hand-off file to re-read and nothing lost. So the wake is the route for a
  // session that will be CLOSED. Both firing for the same reset would run the
  // work twice and spend the weekly twice, so since 1.41.0 the wake looks for
  // this session's process first and stands down when it is open and working
  // again (wake.js, liveSession). What the CLI does NOT do is continue a session
  // that stopped short of the wall, at a cap, so that case is said too.
  if (carry && carry.armed && carry.armed.mode === 'resume' && parts.autoContinue && parts.autoContinue.value) {
    relaySentences.push(
      'Claude Code\'s own "Continue automatically at usage limit" is on (' + parts.autoContinue.source +
        '), so if this terminal is still open when the limit is hit, the CLI carries THIS session across ' +
        'the reset by itself, in place, with its context intact - better than any wake. The wake is the ' +
        'route for a session that is closed by then. Both firing for the same reset would start the work ' +
        'twice and spend the weekly twice, so the wake checks for this session first and opens no second ' +
        'window while it is open at all: it wakes closed sessions only. The CLI does not continue a session ' +
        'that stopped short of the limit (at a cap); the wake gives such a session a few minutes, then leaves ' +
        'one note saying to continue it in its own terminal, and opens nothing.'
    );
  }
  if (carry && carry.last) {
    relaySentences.push(
      'The last relay ' +
        (carry.last.outcome === 'resumed'
          ? 'picked this work back up automatically after the previous reset (' + (carry.last.detail || 'resumed') + '); check what it did before repeating it'
          : carry.last.outcome === 'notified'
            ? 'left a notification after the previous reset rather than starting anything'
            : carry.last.outcome === 'live'
              ? 'found this session still open and carried across the previous reset in place, so it started nothing'
              : carry.last.outcome === 'open'
                ? 'found this session still open but idle after the previous reset, so it opened no second window and left a note'
                : 'ended as "' + carry.last.outcome + '"' + (carry.last.detail ? ' - ' + carry.last.detail : '')) +
        '.'
    );
  }

  for (const line of relaySentences) sentences.push(line);

  // Three states, and only the last one stops anything.
  //
  // The middle one is the one that keeps being got wrong. Near the wall the
  // instinct is to do less of what was asked, and that is the wrong trade: it
  // spends the user's request to protect a budget that expires anyway. The job
  // near the wall is to make being cut off cheap - order the work, save as you
  // go, keep a note of where things stand - not to shrink the work until it is
  // guaranteed to fit.
  // Whether Claude Code itself is giving the wrap-up instruction at this wall.
  //
  // Confirmed mechanism, gated on a flag this plugin reads rather than assumed:
  // the CLI injects its own "finish up" note when tengu_lantern_wick_mode is
  // "wrap-up" or "next-steps". On this machine that flag reads "off", so the
  // plugin's own instruction stands and nothing changes. When it flips, two
  // agents telling the model to wind down in different words is worse than one,
  // so this line stands down and says who is speaking instead.
  //
  // Not when an escape is live: the escape says the budget is still there, and
  // deferring to a note that says the opposite would be the plugin handing over
  // at the one moment it disagrees.
  const hostWrapsUpNow =
    Boolean(parts.hostWrapsUp) && !escapeText && (parts.pressure === 'tight' || parts.pressure === 'gone');
  const instruction = hostWrapsUpNow
    ? 'Claude Code is injecting its own wrap-up note at this wall, so it gives the instruction and this ' +
      'line does not repeat it. Follow that note; the figures above are the ones to quote, and the ' +
      'session total below is what to close with.'
    :
    // The escape outranks everything below it. A session that stops while a
    // command would have carried it on has not been careful, it has quit - and
    // that is a real session: the Fable weekly hit 89 per cent, the line said
    // the budget was nearly gone, and the work ended with the five-hour window
    // at 46 and every other model untouched.
    // Only a MODEL switch survives to 'gone'. It retires a scoped window
    // outright, so the budget really is still there. Effort does not: a
    // cheaper turn against an exhausted window is still a turn you cannot
    // take, and telling a session at 100 per cent that it is "not out of
    // budget" because medium is cheaper than high would be this plugin
    // producing the exact failure it exists to prevent, in reverse - refusing
    // to stop at the one moment stopping is right.
    escapeText &&
    (parts.pressure === 'tight' || (parts.pressure === 'gone' && escape && escape.kind === 'model'))
      ? 'This window is nearly gone, but you are not out of budget and you must ' +
        'not stop as though you were. ' + escapeText +
        (pinned
          ? ' Do not take it yourself - self-switching is pinned. Say in one line ' +
            'that the lever is there, and carry on with the whole request at full ' +
            'quality until the window actually ends; when it does, save the work, ' +
            'write the handoff, and say what is left.'
          : ' Say in one line that the lever is there and what it would ' +
            'free - it is the user\'s own setting, so it is theirs to pull - and ' +
            'carry on with the whole request at full quality meanwhile. Only if the ' +
            'switch is refused or impossible: save the work, write the handoff, and ' +
            'say what is left.')
      : parts.pressure === 'gone'
      ? 'The budget is gone, so nothing further will run. Save what exists and ' +
        'write the handoff: what is finished, what is next and in what order, ' +
        'which files are mid-change, and when the window resets.' +
        (parts.relay && parts.relay.armed
          ? ' Write it into the relay note as well as into your reply - that is ' +
            'the copy that gets acted on when the window reopens.'
          : '')
      : parts.pressure === 'tight' && parts.relay && parts.relay.armed
        ? 'The budget is nearly gone and the relay has it: being cut off now ' +
          'costs the wait, not the work. So do not wind down, do not narrow the ' +
          'request, and do not stop to ask whether to go on. Carry on at full ' +
          'quality, save at clean boundaries, and put everything the next turn ' +
          'needs into the relay note rather than into a summary for a person to ' +
          'read. Say in one line what will land after the reset instead of ' +
          'before it, then keep working until the window actually ends.'
      : parts.pressure === 'tight'
        ? 'The budget is nearly gone, so make being cut off cheap rather than doing ' +
          'less. Carry on with the whole request at full quality; do not narrow ' +
          'it or stop to ask. The most valuable part lands first, save at clean ' +
          'boundaries, with a running note of what is done, what is next and ' +
          'which files are mid-change. Say in one line what may not land before ' +
          'the reset, then keep working; for a mechanical remainder, node ' +
          'scripts/usage.js --recommend (skill directory) names the effort and model.'
        : shortStanding
          ? STANDING_SHORT
          : 'Before work, estimate the turns for the whole request, including verification, against ' +
            'the binding window and your share of it. Say "fits" only if that estimate is covered; ' +
            'when the estimate is unknown or too large, say exactly "it may not fit". Never infer ' +
            'that a request fits from a percentage alone. Then get on with the work at full quality, ' +
            'saving at clean boundaries. At an exhausted limit, stop normal narration and ' +
            'continuation claims; emit only the saved handoff if one is required.';

  // The mistake this guards against: quoting the roomiest window and pinning
  // the binding window figures to it.
  const care = shortStanding
    ? ''
    : ' Quote the binding window; its turns and reset time belong to it alone.';
  const fitAtWall = parts.pressure === 'tight'
    ? ' Assess the complete request including verification; say "fits" only with evidence, otherwise say exactly "it may not fit", then stop repeating budget commentary.'
    : '';

  // Finished work closes with what it cost. Not every reply: a progress note
  // mid-task is not the moment, and once the budget is gone nothing further
  // runs, so there is no reply to close.
  const closing =
    parts.pressure === 'gone' || shortStanding
      ? ''
      : ' When this reply completes what was asked, or wraps up the session, end it ' +
        'with one plain line giving the session total above (turns, tokens and cost). ' +
        'Skip it on partial progress; the hook prints the exact figure after you stop.';

  // What the mode adds, and what it takes away.
  //
  // The directive is the half of a mode that changes what the agent does. It
  // is injected verbatim, last, so it is the freshest thing in the line.
  //
  // It is dropped in two places. When the line is telling the agent to stop,
  // there is no budget left for it to govern, and a token-economy lecture at
  // 100 per cent is pure cost. And in the terse style once the wall is reached,
  // because the wall's own instruction is more specific than the directive and
  // says the same thing better - repeating both at 95 per cent would spend
  // exactly what the mode is asking to save.
  const stopping = parts.pressure === 'gone' && !(escape && escape.kind === 'model');
  // The wall, not "anything that is not roomy". pressure() returns roomy,
  // tight, gone and unknown, so `!== 'roomy'` dropped the directive at `tight`
  // - which is a normal working state, not the wall - and at `unknown`, which
  // is a stale window or a missing percentage and is not the wall either. Both
  // matter because autoPick resolves to `max` exactly at tight and above, so
  // the mode's behavioural half was dropped precisely where auto selects it.
  // At `gone` the wall's own instruction is more specific and `stopping` has
  // usually dropped it already; this is what keeps the two agreeing.
  const pastTheWall = style === 'terse' && parts.pressure === 'gone';
  const directive =
    parts.mode && parts.mode.directive && !stopping && !pastTheWall ? ' ' + parts.mode.directive : '';

  // Terse is one line plus the decision: the binding window, the tier, what to
  // do about it, and the directive. It drops the table, the per-model rows, the
  // session totals and the two standing reminders - the parts that read the
  // same every turn - and keeps every part that changes what happens next.
  //
  // What it must NOT drop is the decision itself. At the wall the instruction
  // is identical in both styles, word for word: a mode that says "budget gone"
  // less clearly to save forty characters has bought its saving out of the one
  // sentence that matters.
  if (style === 'terse') {
    // The number's own health, in one clause. Terseness may cost the table; it
    // may not cost the reader the knowledge that the figure is a floor.
    const caveat =
      parts.correctionUnreliable || (parts.binding && parts.binding.stale)
        ? ' Last real reading, not a current one; /usage refreshes it.'
        : '';
    // A percentage measured against a different allowance is not a shorter
    // truth, it is a different number. Terseness may cost the table; it may
    // not cost the reader the knowledge that the figure predates a plan
    // change - that would be the mode buying its saving out of the number
    // itself, which is the one thing the header forbids.
    const planCaveat = parts.planChanged
      ? ' Measured against a different allowance: the plan has changed since, so /usage before trusting it.'
      : '';
    // The one recommendation this session is allowed, in its short form. It
    // still cites the measurement, still names the command: terse is fewer
    // words, not less evidence.
    const adviceText = (parts.adviceText ? ' ' + parts.adviceText : '') + (parts.newerModel ? ' ' + parts.newerModel : '');
    return (
      sentences[0] + caveat + (parts.tier ? ' ' + parts.tier : '') + (bounded ? ' ' + bounded : '') + adviceText +
      (escapeSentence ? ' ' + escapeSentence : '') +
      (lowPrioritySentence ? ' ' + lowPrioritySentence : '') +
      (cloudSentence ? ' ' + cloudSentence : '') +
      (parts.pressure !== 'roomy' && relaySentences.length ? ' ' + relaySentences.join(' ') : '') +
      '\n' + instruction + fitAtWall + directive
    );
  }

  return sentences.join(' ') + '\n' + instruction + fitAtWall + closing + care + directive;
}

// Past this the context is the cost of the session, not a detail of it.
const LARGE_CONTEXT_TOKENS = 150000;

// A previous session's total reads better in whole dollars once it is large.
function roundMoney(value) {
  if (!Number.isFinite(value)) return '-';
  return value >= 10 ? '$' + Math.round(value) : usage.formatMoney(value);
}

function isTallyEntry(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// What the Stop hook's tally can add to the line: this session's last reply
// and context when it is a session the tally has seen, or the previous
// session's total when it has not, which is how a first prompt gets told what
// the last session cost.
function tallyContext(all, sessionId, now) {
  const none = { lastReply: null, context: null, lastSession: null };
  if (!all || typeof all !== 'object') return none;

  const mine = sessionId && isTallyEntry(all[sessionId]) ? all[sessionId] : null;
  if (mine) {
    return {
      lastReply: mine.lastReply || null,
      context: Number.isFinite(mine.context) ? mine.context : null,
      lastSession: null,
    };
  }

  const others = Object.keys(all)
    .filter((key) => key !== tally.IDS_KEY && isTallyEntry(all[key]))
    .map((key) => all[key])
    .sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0));
  const last = others[0];
  if (!last || !last.turns) return none;

  const open = !Number.isFinite(last.endedAt);
  const ended = open ? last.lastAt : last.endedAt;
  return {
    lastReply: null,
    context: null,
    lastSession: {
      turns: last.turns,
      tokens: tally.totalTokens(last.tokens),
      cost: last.cost,
      project: last.project || null,
      // Another window may still be in it, so say when it was last active
      // rather than claiming it ended.
      open,
      endedAgo: Number.isFinite(ended) ? usage.formatDuration(now - ended) : null,
    },
  };
}

// The relay, decided once per prompt.
//
// Two things happen here and neither of them slows the work down. Above the
// arming threshold, with a plan or an unfinished todo list to carry, a one-shot
// wake is booked for a few minutes after the reset - a scheduled task costs
// nothing and changes nothing about the turn in progress. And once a wake
// exists, what the hook tells Claude at the wall changes: the handoff is no
// longer a note for a person to find, it is the thing that will be handed back
// automatically, so it is worth writing properly.
//
// It also reports what happened last time. A relay that fired while nobody was
// watching is exactly the sort of thing a session should not have to be asked
// about.
function relayState(now, hookInput, binding, sessionId) {
  try {
    const state = (relay.reapLost(Date.now()), relay.read());
    const config = relay.settings(state);
    const last = state.history[state.history.length - 1];
    const ended = last && Number.isFinite(last.endedAt) && now - last.endedAt < 6 * 60 * 60 * 1000 ? last : null;
    // Said once per session per ended relay, not on every prompt for six hours.
    const recent = ended ? relayNewsFor(sessionId, ended, now) : null;
    if (!config.enabled) return recent ? { enabled: false, last: recent } : null;

    // Already armed for this session: nothing to decide, just say so.
    const mine = relay.armedFor(state, sessionId);
    if (mine) {
      return { enabled: true, armed: mine, config, last: recent };
    }
    const work = relay.detectWork(hookInput && hookInput.transcript_path, {});
    const able = relay.armable({ config, binding, sessionId, work, hostName: usage.currentHost() });
    if (!able.ok) return { enabled: true, why: able.why, config, last: recent, work };
    // Registering a scheduled task measured 936 ms, and this hook has ten
    // seconds of which the live reading may take four and the scan five. A
    // hook that is killed tells Claude nothing at all, which is far worse than
    // a relay that arms on the next prompt instead of this one - and if there
    // is no next prompt, the session ended and there was nothing to carry.
    if (Date.now() - now > ARM_DEADLINE_MS) {
      return { enabled: true, why: 'no time left in this hook; arming on the next prompt', config, last: recent, work };
    }
    const armed = relay.arm({
      now,
      config,
      // Registration must be finished, not merely started, inside the hook's
      // ten seconds; the scheduler trims its own waits to this.
      deadline: now + ARM_DEADLINE_MS + 4000,
      sessionId,
      binding,
      work,
      resetsAt: binding.resetsAt,
      cwd: (hookInput && hookInput.cwd) || process.cwd(),
      project: path.basename((hookInput && hookInput.cwd) || process.cwd()),
      hostName: usage.currentHost(),
    });
    return armed.ok
      ? { enabled: true, armed: armed.record, justArmed: true, config, last: recent, work }
      : { enabled: true, error: armed.error, config, last: recent, work };
  } catch (err) {
    // Nothing about carrying work forward is worth breaking the prompt for.
    return null;
  }
}

// What Claude Code's own wall-time features change about this brief.
//
// Only one of them changes a number. An acknowledged /low-priority retires the
// 5-hour wall - the session carries straight past that reset at lower priority,
// spending the weekly - so the window that actually stops the work becomes the
// weekly, and the brief has to brake on that one instead. The swap happens here,
// once, so the pressure, the relay and the sentence all describe the same
// window; doing it in three places is how they come to describe two.
//
// Never on a guess. `acknowledged` means the user said so through
// usage-mode --low-priority on, and that record lapses at the reset of the
// window it was recorded against. Whether low-priority is really running is in
// the CLI's process memory and readable nowhere; see lowpri.js.
// Claude Code only, and settled before a single file is read.
//
// Every one of these features is Claude Code's: /low-priority and /limit-reset
// are its slash commands, the wrap-up note is its injection, and
// autoContinueAtUsageLimit is its setting. None of them exist in Codex or in
// Antigravity, and ~/.claude.json describes an account neither of them is
// running on. Reading it from inside another host would put a Claude Code
// command in front of an agent that cannot type it, against a window it is not
// spending - the same mistake as naming /effort in Codex, which this plugin is
// otherwise careful never to make.
function wallFeatures(now, binding, windows, hostName) {
  const out = { binding, lowPriority: null, hostWrapsUp: false, swapped: false };
  if (hostName !== host.CLAUDE) return out;
  try {
    const account = lowpri.snapshot();
    const info = lowpri.forBrief({ account, now, binding, windows });
    out.lowPriority = info;
    out.hostWrapsUp = lowpri.wrapUp(account).hostWrapsUp;
    out.autoContinue = info.autoContinue;
    // Only where it is the way past the wall: usage credits not on, and not
    // already inside a cloud session, which is running on it.
    out.cloudCredit = info.cloudCredit && !info.inCloud && info.credits.available !== true ? info.cloudCredit : null;
    if (info.state === 'acknowledged' && binding && binding.key === 'five_hour') {
      const weekly = lowpri.weeklyOf(windows);
      if (weekly && Number.isFinite(weekly.percentUsed) && !weekly.stale && Number.isFinite(weekly.resetsAt)) {
        out.binding = weekly;
        out.swapped = true;
      }
    }
    // Whether the weekly really is the window the figures describe, which is
    // what the acknowledged sentence claims. True when the swap just happened
    // AND when the weekly was already binding on its own - the 5-hour window
    // reading low is the ordinary case for a session that has been running at
    // lower priority for a while. False when there was no weekly to brake on,
    // and then the sentence has to say so instead of claiming otherwise.
    out.lowPriority = Object.assign({}, info, {
      weeklyBinding: Boolean(out.binding && out.binding.key === 'seven_day'),
    });
  } catch (err) {
    // Nothing about these features is worth a failed prompt.
  }
  return out;
}

// The one line `off` will ever say, and only when it has been asked for.
//
// `off` means off, including at 100 per cent: that is what was asked and it is
// honoured literally. A silent cutoff at the wall is also the exact failure
// this plugin exists to prevent, and it has already cost real work more than
// once, so `mode off --guard 95` stores a percentage at which one short line
// is still allowed. The default stays null - discoverable, not imposed.
//
// It never scans. The snapshot, plus whatever correction an earlier turn has
// already paid for, and nothing else: a mode whose promise is that the plugin
// costs nothing cannot buy its one line with a five-second transcript scan.
//
// Three things it must get right, because it is the ONLY line this mode will
// ever emit and there is nothing else to correct it:
//
//   The windows come from snapshotWindows(), not from `utilization.limits`
//   alone. That array is optional - every fixture in this repo and every other
//   reader here works from the top-level five_hour/seven_day keys - so a guard
//   wired to it was silent at 97 per cent used on the payload shape everything
//   else treats as primary.
//
//   A per-model weekly for a model this session is not running cannot be the
//   window that stops the work, so it cannot be the thing that fires the
//   guard either. Without the applies filter it fired at 99 per cent on an
//   Opus weekly for a user with 80 per cent of their real budget left - the
//   exact false alarm bindingWindow() exists to prevent, in the one mode with
//   no second line to take it back.
//
//   And it says "5-hour", not "five_hour". A raw key in the one sentence the
//   user gets is the plugin talking to itself.
function guardLine(now, budget) {
  if (!Number.isFinite(budget.guardPercent)) return '';
  try {
    usage.setHost(host.detect(process.argv.slice(2), process.env));
    const base = usage.collect(now);
    if (!base.utilization) return '';
    const codexHome = usage.isCodex() ? require('./codex.js').homeDir() : null;
    let worst = null;
    for (const window of usage.snapshotWindows(base, now, codexHome)) {
      if (window.applies === false || window.stale) continue;
      const percent = window.percentUsed;
      if (!Number.isFinite(percent)) continue;
      if (!worst || percent > worst.percent) worst = { percent, label: window.label || window.key };
    }
    if (!worst || worst.percent < budget.guardPercent) return '';
    return (
      '[usage-limits] (off, guard at ' + budget.guardPercent + '%) ' + worst.label + ' is ' +
      Math.round(worst.percent) + '% used. Mode is off, so this is the only line you get.'
    );
  } catch (err) {
    // A guard that throws would be worse than a guard that is quiet.
    return '';
  }
}

// Whether this session has fast mode on. No hook input carries it; the status
// line JSON does, as `fast_mode`, and feed.js keeps that in this session's
// feed slot. A session with no slot - no status line installed - reads as off,
// so the clause is never said on a guess.
function fastModeFor(sessionId) {
  if (!sessionId) return false;
  try {
    const slot = feed.readFeed()[sessionId];
    return Boolean(slot && slot.fastMode === true);
  } catch (err) {
    return false;
  }
}

const GEMINI_UNREADABLE =
  "[usage-limits] Antigravity's quota is not readable by this plugin, so there is no budget figure and no fan-out ceiling here; Antigravity's own usage panel has the number.";
const LIMIT_REACHED =
  '[usage-limits] The meter says the usage limit is reached. Start nothing new: save the work, write the hand-off note in this turn, and end the turn.';

// Temporary files a killed process left behind: a hook that ran into its
// timeout between writing one and renaming it. Nothing else can clean them,
// and on 2026-09-25 about seventy had piled up in ~/.claude. Once per prompt
// is often enough and costs one directory listing per home. The clock here
// is always the real one, never the run's `now`: a stale file is judged by
// its mtime, which is real time too. Never throws.
function sweepDebris() {
  try {
    return atomic.sweep([configDir(), host.codexHome()], Date.now());
  } catch (err) {
    return 0;
  }
}

async function run(now, hookInput, opts) {
  if (String(process.env.USAGE_LIMITS_BRIEF || '').toLowerCase() === 'off') return '';

  const sessionId = hookInput && (hookInput.session_id || hookInput.conversationId) ? (hookInput.session_id || hookInput.conversationId) : null;
  // Which budget mode is in force, settled before anything expensive happens.
  // In `off` this whole hook is one small file read and then nothing: no
  // reading, no scan, no activity mark, no injection. That mode's promise is
  // that the plugin costs nothing, and a promise with a scan behind it is not
  // one. The visible consequence, stated in the docs: the panel does not
  // animate in `off`, because nothing runs to tell it anything.
  const budget = mode.forSession({ sessionId });
  if (budget.policy.briefStyle === 'none') return guardLine(now, budget);

  sweepDebris();

  // Settle host here, before any file is read. A caller that already knows the
  // host (agy-hook runs only inside Antigravity) says so, and that wins over
  // detection: an empty or unparseable payload used to fall through to
  // Claude Code and put Claude's usage, model and session into Antigravity.
  const detectedHost = host.detectFromHook(process.argv.slice(2), process.env, hookInput);
  const effectiveHost = (opts && opts.host)
    || ((hookInput && (hookInput.conversationId || hookInput.invocationNum !== undefined))
      ? host.GEMINI
      : detectedHost);
  const gemini = usage.setHost(effectiveHost) === host.GEMINI;
  // A prompt has arrived, so this session is working, and the prompt itself
  // says whether it asked for ultracode. The panel animates from this. The
  // activity file is Claude Code's, so an Antigravity conversation is never
  // counted in it.
  if (!gemini) activity.mark(
    'working',
    sessionId,
    Object.assign(
      {
        // Whole words only: both are real directives in the prompt. Ultrathink
        // is per prompt, so it is set true or false every time.
        ultrathink: Boolean(
          hookInput && typeof hookInput.prompt === 'string' && /\bultrathink\b/i.test(hookInput.prompt)
        ),
      },
      // Ultracode is Claude Code's own keyword trigger and it sticks for the
      // session once used, so it is only ever set on here and otherwise
      // carried forward. It is safe to read from the text now that every
      // display reads the mark of the one session it describes.
      hookInput && typeof hookInput.prompt === 'string' && /\bultracode\b/i.test(hookInput.prompt)
        ? { ultracode: true }
        : {}
    ),
    now
  );

  const config = settings();
  // How old the reading may be before this hook takes a fresh one is a mode
  // decision - the reading itself costs a request and a wait - but an explicit
  // environment setting is the user saying it outright, and that still wins.
  const envRefresh = Number(process.env.USAGE_LIMITS_REFRESH);
  const refreshSeconds = Number.isFinite(envRefresh)
    ? envRefresh
    : budget.policy.refreshSeconds || config.refreshSeconds;
  // The reading ages during long turns, and a burst of parallel agents can
  // spend half a window between two of them. Before the numbers go in front
  // of Claude, take the same reading Claude Code takes for /usage when the
  // one on disk is older than a few minutes. Offline or signed out this is
  // one quick failure and then a widening backoff, never a wait on every
  // prompt; USAGE_LIMITS_FETCH=off turns it off.
  try {
    if (gemini) {
      // Antigravity publishes no meter this plugin can read, and refreshing
      // Claude's /usage reading from inside Antigravity spends a request on
      // the wrong account.
    } else if (usage.isCodex()) {
      // Codex only writes its meter when it makes a request, so between turns
      // the newest figure can be half an hour old. Ask it, the way /status
      // does, when the reading has aged - but never inside this hook. The
      // reading means starting `codex app-server`, whose cold start alone has
      // been measured past four seconds, and Codex kills a hook at ten. So the
      // refresh is started detached and the next hook reads what it wrote.
      await require('./codex.js').refreshIfStale({
        now,
        maxAgeMs: refreshSeconds * SECOND,
        detach: true,
      });
    } else {
      const cached = usage.collect(now);
      const waitMs = refreshBudgetMs();
      // No room left in the hook for a network call: the figure on disk stands
      // and the next prompt tries again.
      if (waitMs > 0) {
        await live.refreshIfStale({
          now,
          maxAgeMs: refreshSeconds * SECOND,
          cacheFetchedAtMs: cached.snapshotFetchedAt,
          accountUuid: usage.accountUuid(),
          timeoutMs: waitMs,
        });
      }
    }
  } catch (err) {
    // The reading on disk is still there.
  }
  const base = usage.collect(now);
  if (!base.utilization) {
    if (gemini) return sayOnce(sessionId, GEMINI_UNREADABLE, now);
    // Codex can say a limit is already hit while giving no percentage; that
    // is the plainest reading there is, not a missing one.
    if (base.reachedType || base.spendControlReached) return sayOnce(sessionId, LIMIT_REACHED, now);
    return '';
  }

  const all = readCache();
  // Which setting the fit question was already asked for, read BEFORE anything
  // rewrites the slot. Reading it afterwards meant comparing the new answer
  // against itself, so the question could never be asked at all.
  const askedFitFor = all && all[sessionId || '_'] ? all[sessionId || '_'].fitFor || null : null;
  let view = pickCached(all, sessionId, now, config.cacheSeconds * SECOND);
  const login = usage.isCodex() ? null : usage.accountUuid();
  if (view && login && view.accountUuid !== login) view = null;

  // Everything shown has to come from one pass. Deriving the turns from a
  // full scan and the binding window from somewhere cheaper is how the two
  // end up describing different windows.
  if (!view || !view.binding) {
    // One call, shared with the report. Building the view twice is how the
    // snapshot correction reached the report and never reached the hook.
    const data = await usage.report(now, { sessionId, budgetMs: SCAN_BUDGET_MS });
    const binding = data.binding;
    view = {
      at: now,
      accountUuid: login,
      turnsLeft: binding && Number.isFinite(binding.turnsLeft) ? binding.turnsLeft : null,
      session: data.session,
      othersSummary: summariseOthers(data.windows, binding && binding.key),
      // The way out that is not stopping. Cached with the rest of the view
      // because it is derived from the same one pass over the windows.
      // The mode's own appetite goes in with it: how much emptier another
      // window has to be before a switch is worth naming, and whether the user
      // has pinned self-switching off altogether.
      escape: usage.escapeRoute(data.windows, binding, data.effortWarning || null, usage.currentHost(), budget.policy, budget.bounds),
      // Every window, trimmed to the cacheable fields, so the corrected reading
      // can be recorded for all three columns of the status line on a cache
      // hit too. Recording the binding window alone left the other two at
      // their raw snapshots on every short turn, where the pulse never runs.
      windows: (data.windows || []).map(cacheableBinding),
      sessions: data.sessions,
      staleWindows: data.staleWindows,
      planChanged: data.planChanged,
      critical: usage.criticalOthers(data.windows, binding && binding.key).map((w) => ({
        label: w.label,
        percentUsed: w.percentUsed,
        resetsIn: Number.isFinite(w.msToReset) ? usage.formatDuration(w.msToReset) : 'an unknown time',
      })),
      snapshotAge: usage.formatDuration(data.snapshotAgeMs),
      snapshotAgeMs: Number.isFinite(data.snapshotAgeMs) ? data.snapshotAgeMs : null,
      binding: cacheableBinding(binding),
      effortWarning: data.effortWarning || null,
      // From the per-effort TABLE, which is what report() returns. It was
      // being asked for from `data.events`, a field report() has never had -
      // it builds the event list internally and returns effortRates derived
      // from it - so this was null on every call on every machine, and with it
      // the whole recommendation channel: no fit sentence, nothing to offer,
      // nothing to decline.
      fit: usage.fitFromRates(data.effortRates || [], data.effortNow || null, usage.currentHost()),
    };
    view.fitFor = view.fit ? view.fit.effort : askedFitFor;
    writeCache(mergeCache(all, sessionId, view, KEEP_SESSIONS));
  }

  // Settled before the pressure, the relay and the line are decided, so all
  // three describe the same window.
  const wall = wallFeatures(now, view.binding, view.windows, usage.currentHost());
  const binding = wall.binding;
  // The turn count belongs to whichever window is now binding. Carrying the
  // 5-hour count onto a weekly window would put two budgets in one sentence.
  const turnsLeftNow = wall.swapped
    ? (Number.isFinite(binding.turnsLeft) ? binding.turnsLeft : null)
    : view.turnsLeft;
  const othersSummaryNow = wall.swapped
    ? summariseOthers(view.windows || [], binding.key)
    : view.othersSummary;
  // Everything derived from the window that WAS binding has to go with it.
  //
  // The escape route was worked out for the 5-hour window - "this window is
  // scoped to one model, so switching model retires it" - and the sentence that
  // prints it is gated on the binding window's percentage. Left in place after
  // the swap it would describe one window while the figures beside it described
  // another, which is the exact confusion the binding window exists to prevent.
  // Same for the critical list, which excludes whichever window was binding: the
  // weekly would otherwise be both the binding window and a "note that" warning
  // about itself.
  const escapeNow = wall.swapped ? null : view.escape || null;
  const criticalNow = wall.swapped
    ? (view.critical || []).filter((other) => other.label !== binding.label)
    : view.critical || [];
  const { active, share } = activeShare(view.sessions, all, now, sessionId);
  const yourTurnsLeft = Number.isFinite(turnsLeftNow)
    ? Math.max(1, Math.round(turnsLeftNow * share))
    : null;
  // Only a short runway is worth saying. Quoting it when there are hours left
  // would make the line longer without making it more useful.
  const shortRunway =
    binding && Number.isFinite(binding.headroomMs) &&
    binding.headroomMs <= RUNWAY_MENTION_MS;
  // Outside the cache on purpose: the tally moves after every reply.
  const found = tallyContext(tally.readState(), sessionId, now);
  // Learning how the user writes, from the prompt that just arrived. Counters
  // only, no model call, and it never speaks: what it knows is read back by
  // /usage-limits:voice and used when the relay writes as them.
  try {
    if (hookInput && typeof hookInput.prompt === 'string') voice.observe(hookInput.prompt, now);
  } catch (err) {
    // Style is not worth a failed hook.
  }
  // This hook has just paid for a transcript scan, so the corrected figure is
  // in hand. Leave it where the status line can read it: that line redraws far
  // too often to scan for itself, and without this it shows the raw snapshot,
  // which during a heavy session is wrong by tens of points in the flattering
  // direction.
  reading.recordAll(view.windows && view.windows.length ? view.windows : [binding], now, usage.isCodex() ? require('./codex.js').homeDir() : null);
  const carry = relayState(now, hookInput, binding, sessionId);
  // An instruction the user typed at /usage-limits:voice set. The learned
  // traits are for writing AS them and stay out of the way; this is them
  // saying how they want to be talked to, so it is said every time.
  let voiceNote = null;
  try {
    voiceNote = voice.read().note;
  } catch (err) {
    voiceNote = null;
  }

  // What tier is producing this turn, and what the user's own baseline is.
  // Read, displayed, never written.
  const terse = budget.policy.briefStyle === 'terse';
  const tierReading = mode.tierNow({ sessionId, now, usage, env: process.env, transcriptPath: hookInput && hookInput.transcript_path });
  const tier = mode.tierLine(tierReading, { terse });
  // Muted advice is muted for this too: it is a recommendation like the others.
  const newerAdvice = budget.advice && budget.advice.off ? null : mode.newerModelAdvice(tierReading, { usage, host: usage.currentHost(), bounds: budget.bounds, relayModel: relayModelNow() });

  // The recommendation channel. The measured fit sentence IS the
  // recommendation - it cites this account's own numbers and names the exact
  // command - so it goes out through the advice rules rather than beside them:
  // at most one per session, never once declined, never in `off`, never
  // pointing outside the bounds the user set.
  const fitCandidate = view.fit && askedFitFor !== view.fit.effort ? view.fit : null;
  const advice = mode.advicePending({ decided: budget, fit: fitCandidate, sessionId });
  const offering = advice.ok && !advice.alreadyOffered;
  if (offering) mode.adviceOffer(advice.id, sessionId, now);

  const pressureNow = pressure(binding, now, config, Number.isFinite(yourTurnsLeft) ? yourTurnsLeft : turnsLeftNow);
  const cloudCredit = pressureNow === 'tight' || pressureNow === 'gone' ? cloudCreditFor(sessionId, wall.cloudCredit, now) : null;
  // Fast mode changes what the window's figures mean, so a toggle is a change
  // worth saying even when nothing else has moved.
  const fastMode = fastModeFor(sessionId);

  // Say nothing when nothing a decision depends on has moved.
  //
  // Only `max` asks for this, and only while there is room: repeating the same
  // figure every prompt is the plugin charging for its own presence. The
  // pressure is in the digest and the wall is excluded outright, so the one
  // line that must never be swallowed cannot be.
  const digest = [
    budget.name,
    pressureNow,
    binding && Number.isFinite(binding.percentUsed) ? Math.round(binding.percentUsed / 5) * 5 : 'x',
    escapeNow ? escapeNow.kind : '-',
    tier || '-',
    active > 1 ? 'shared' : 'solo',
    carry && carry.armed ? 'relay' : '-',
    offering ? 'advice' : '-',
    fastMode ? 'fast' : '-',
    // An acknowledgement, or the wall starting to offer the toggle, changes what
    // the line says and which window it brakes on. Leaving it out of the digest
    // would let `max` swallow exactly the prompt on which that changed.
    wall.lowPriority ? wall.lowPriority.state + (wall.lowPriority.advise ? ':' + wall.lowPriority.advise.kind : '') : '-',
    wall.hostWrapsUp ? 'wrapup' : '-',
  ].join('|');
  if (!budget.policy.briefWhenUnchanged && pressureNow === 'roomy') {
    const slots = readCache();
    const slot = slots[sessionId || '_'];
    if (slot && slot.said === digest) return '';
    writeCache(mergeCache(slots, sessionId, Object.assign({}, slot || { at: now }, { said: digest }), KEEP_SESSIONS));
  }

  // The standing text in full the first time, twelve words after. Decided
  // here, and marked below only when the full form actually went out.
  const standingShort = standingShortFor(sessionId, now);
  const text = briefText({
    mode: budget,
    tier,
    standingShort,
    cacheMissWhy: cacheMissWhyFor(sessionId, now),
    staleVersion: staleVersionFor(sessionId, now),
    newerModel: newerModelFor(sessionId, newerAdvice, now),
    adviceText: terse && offering ? advice.text : null,
    relay: carry,
    voiceNote,
    lastReply: found.lastReply,
    context: found.context,
    lastSession: found.lastSession,
    sessions: active,
    yourTurnsLeft,
    runsOutIn: shortRunway ? usage.formatDuration(binding.headroomMs) : null,
    // Only while it is still the thing that just happened. A refusal from days
    // ago says nothing about now.
    refusedAgo:
      binding && Number.isFinite(binding.refusedAt) && now - binding.refusedAt < 6 * 60 * 60 * 1000
        ? usage.formatDuration(now - binding.refusedAt)
        : null,
    binding,
    // Named only while the window is actually tight: at 20 percent nobody
    // needs telling how to free it.
    family:
      binding && binding.family && Number.isFinite(binding.percentUsed) && binding.percentUsed >= HALF_SPENT
        ? familyLabel(binding.family)
        : null,
    othersSummary: othersSummaryNow,
    escape: escapeNow,
    host: usage.currentHost(),
    turnsLeft: turnsLeftNow,
    effortWarning: view.effortWarning || null,
    // Once per setting, and once per session, and never after a decline: the
    // advice rules above decide, and the sentence itself is unchanged.
    fit: offering && !terse ? fitCandidate : null,
    // Outside the cache: it is cheap, and it belongs to the other agent's
    // clock rather than this session's.
    codex: codexSummary(now),
    resetsIn:
      binding && !binding.stale && Number.isFinite(binding.resetsAt)
        ? usage.formatDuration(binding.resetsAt - now)
        : null,
    session: view.session,
    rebuilt: Boolean(binding && binding.estimated),
    staleWindows: view.staleWindows || 0,
    planChanged: Boolean(view.planChanged),
    critical: criticalNow,
    pointsSinceSnapshot: (binding && binding.pointsSinceSnapshot) || 0,
    correctionUnreliable: Boolean(binding && binding.correctionUnreliable),
    pointsBeyondSnapshot: (binding && binding.pointsBeyondSnapshot) || 0,
    snapshotAge: view.snapshotAge,
    snapshotStale: Number.isFinite(view.snapshotAgeMs) && view.snapshotAgeMs >= SNAPSHOT_TRUST_MS,
    fastMode,
    // Claude Code's own wall-time features, as far as they are readable.
    lowPriority: wall.lowPriority,
    hostWrapsUp: wall.hostWrapsUp,
    autoContinue: wall.autoContinue || null,
    cloudCredit,
    // The turn count that matters for this session is its share of a shared
    // budget, not the whole window's. Escalating on the whole window meant a
    // count that looked comfortable while the part actually available here was
    // a third of it.
    pressure: pressureNow,
  });
  // Only the roomy form carries the three standing strings; the terse style
  // drops them and the tight and gone instructions are their own words.
  if (text && !standingShort && !terse && pressureNow !== 'tight' && pressureNow !== 'gone') markStanding(sessionId, now);
  return text;
}

if (require.main === module) {
  let hookInputSeen = null;
  readHookInput()
    .then(async (input) => {
      hookInputSeen = input;
      const isGeminiHook = Boolean(
        (input && (input.conversationId || input.invocationNum !== undefined)) ||
        (process.argv.includes('--host') && process.argv[process.argv.indexOf('--host') + 1] === 'gemini') ||
        process.argv.includes('--gemini-hook')
      );
      const text = sayOnce(input && input.session_id, await run(Date.now(), input), Date.now());
      return { text, isGeminiHook, prompt: input && input.prompt };
    })
    .then(
      ({ text, isGeminiHook, prompt }) => {
        const said = withThriftSafe(text ? withBugcheck(text) : '', prompt);
        if (isGeminiHook) {
          const payload = {
            injectSteps: said ? [{ ephemeralMessage: said }] : []
          };
          process.stdout.write(JSON.stringify(payload) + '\n');
        } else {
          if (said) process.stdout.write(said + '\n');
        }
        process.exit(0);
      },
      () => {
        // A hook that throws must not disrupt the prompt it runs before. The
        // rule set does not depend on the reading, so a prompt that asked for
        // token efficiency still gets it when the brief itself failed.
        try {
          const input = hookInputSeen;
          const said = withThriftSafe('', input && input.prompt);
          if (said) {
            const gemini = Boolean(
              (input && (input.conversationId || input.invocationNum !== undefined)) ||
              (process.argv.includes('--host') && process.argv[process.argv.indexOf('--host') + 1] === 'gemini') ||
              process.argv.includes('--gemini-hook')
            );
            process.stdout.write((gemini ? JSON.stringify({ injectSteps: [{ ephemeralMessage: said }] }) : said) + '\n');
          }
        } catch (err) {
          // Nothing more to say.
        }
        process.exit(0);
      }
    );
}

// relay bugcheck always: the two passes the user asks for on nearly every
// request, asked for on every prompt. on and off touch the hand-off only.
function withBugcheck(text) {
  try {
    const relayModule = require('./relay.js');
    if (relayModule.settings(relayModule.read()).bugcheck === 'always') return text + ' ' + relayModule.BUGCHECK_LINE;
  } catch (err) {
    // The relay module is optional here.
  }
  return text;
}

// "Be token efficient" in the prompt: the sourced rule set rides along, even on
// a prompt where the brief itself stays quiet. A missing module costs nothing.
function withThriftSafe(text, prompt) {
  try {
    return require('./thrift.js').withThrift(text, prompt);
  } catch (err) {
    return text || '';
  }
}

module.exports = { wallFeatures, sweepDebris, withBugcheck, withThriftSafe, sayOnce, shapeOf, saidFile, REPEAT_MS, staleVersionFor, newerModelFor, cloudCreditFor, relayNewsFor, installedVersion, runningVersion,
  readSaid, standingSaid, markStanding, standingShortFor, STANDING_SHORT, cacheMissWhyFor, missReason, MISS_RECENT_MS,
  DEFAULTS,
  HOOK_BUDGET_MS,
  REFRESH_TIMEOUT_MS,
  SCAN_BUDGET_MS,
  refreshBudgetMs,
  aheadOfPace,
  pacingMatters,
  PACE_MIN_SPAN_MS,
  PACE_MIN_ELAPSED,
  pressure,
  sessionSpend,
  describeWindow,
  summariseOthers,
  briefText,
  codexSummary,
  tallyContext,
  LARGE_CONTEXT_TOKENS,
  SNAPSHOT_TRUST_MS,
  settings,
  fastModeFor,
  keepSlots,
  pickCached,
  mergeCache,
  liveSessions,
  activeShare,
  readCache,
  cacheableBinding,
  pressureInputs,
  applyBounds,
  guardLine,
  CACHED_BINDING_FIELDS,
  LIVE_WINDOW_MS,
  RUNWAY_MENTION_MS,
  KEEP_SESSIONS,
  run,
  cacheFile,
};
