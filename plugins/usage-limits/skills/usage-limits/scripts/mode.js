#!/usr/bin/env node
'use strict';

// Budget modes: how hard the plugin leans, and what it costs to lean.
//
// The plugin is not free. It puts a line into the context before every prompt,
// refreshes readings after tool calls, and keeps a status line alive. A mode
// called "save tokens" that still injects four hundred tokens of advice per
// turn is not saving anything - it is charging for the advice about saving.
//
// So a mode changes two things, never one:
//
//   1. What the plugin TELLS the agent to do (the directive).
//   2. What the plugin COSTS to say it (verbosity, cadence, silence).
//
// Both halves are in the table below, and there is a test for the second one:
// the `max` line must never be longer than the `standard` line for the same
// reading.
//
// What a mode must NEVER do is lower the quality of the work. When things are
// tight you change the ORDER of the work, not the amount or the quality. The
// efficient modes buy their savings from ceremony - speculative reads,
// re-reads, preamble, subagents nobody needed, workflows that cost more
// context than they save - and never from doing the job worse. The directives
// say that outright, because a model reading "use fewer tokens" will otherwise
// quietly decide to skip the hard part.
//
// It also never writes settings.json. See "two planes" below.

const fs = require('fs');
const os = require('os');
const path = require('path');

const atomic = require('./atomic.js');
const host = require('./host.js');
const codex = require('./codex.js');
const lowpri = require('./lowpri.js');

// ---------------------------------------------------------------------------
// The policy table
//
// Each mode is a record other scripts READ. Nothing downstream hardcodes a
// mode name in a conditional beyond reading these fields, so a fifth mode is
// one entry here and nothing else.
//
// Two kinds of field live here and --explain keeps them apart, because a
// record that lists both as though they were the same thing is a saving that
// exists only where it is described. WIRED names the fields code actually
// reads; the rest are the mode's stance, and the only way they reach anything
// is by being restated in the directive prose below, which means they say
// nothing at all in the two modes that have no directive.
//
// Two fields have been deleted rather than sorted: `statusline` and
// `returnToBaseline`. Nothing read either of them, nothing said either of
// them, and `statusline: compact` was not merely inert but backwards - the
// status line is fourteen characters LONGER in `max`, because feed.js adds a
// "budget max" token there and nothing consumes a compact flag.

const MODES = {
  max: {
    name: 'max',
    summary: 'fewest tokens that can still finish the job',
    // One line, no table, no per-model rows.
    briefStyle: 'terse',
    // Say nothing when nothing a decision depends on has moved. The pressure
    // is part of that digest, so the wall always speaks.
    briefWhenUnchanged: false,
    // The reading itself costs IO and tokens, so it is taken less often.
    refreshSeconds: 600,
    // The mid-turn cadence is a different number from the prompt-time one and
    // always has been: the brief refreshes a reading it is about to print,
    // while the pulse interrupts work in progress. They are listed separately
    // so `standard` can keep BOTH of today's numbers rather than accidentally
    // slowing the pulse to the brief's cadence.
    pulseSeconds: 600,
    recheckSeconds: 0,
    directive: 'max',
    // Claude runs the cheapest tier that can still do the job.
    selfSwitch: 'active',
    subagents: 'avoid',
    workflows: 'off',
    // How much emptier another window has to be before a switch is worth
    // naming. Aggressive modes act on a smaller improvement; see escapeRoute.
    switchGapPoints: 5,
  },
  high: {
    name: 'high',
    summary: 'full capability, continuously re-costed',
    briefStyle: 'normal',
    briefWhenUnchanged: true,
    // The explicit two minutes.
    refreshSeconds: 120,
    pulseSeconds: 120,
    // The mid-turn re-cost. See pulse.js.
    recheckSeconds: 120,
    directive: 'high',
    // DOWN when the work is mechanical, back UP when it is not.
    selfSwitch: 'balanced',
    subagents: 'sized',
    workflows: 'when-cheaper',
    switchGapPoints: 5,
  },
  standard: {
    name: 'standard',
    summary: 'what the plugin does today',
    briefStyle: 'normal',
    briefWhenUnchanged: true,
    // Today's default, unchanged.
    refreshSeconds: 180,
    // Today's pulse interval, also unchanged.
    pulseSeconds: 120,
    recheckSeconds: 0,
    directive: null,
    // Today's behaviour: switch rather than stop, at the wall.
    selfSwitch: 'at-pressure',
    subagents: 'allowed',
    workflows: 'allowed',
    switchGapPoints: 10,
  },
  off: {
    name: 'off',
    summary: 'injects nothing, hooks return immediately',
    // Inject nothing at all.
    briefStyle: 'none',
    briefWhenUnchanged: true,
    // Hooks short-circuit before any reading.
    refreshSeconds: 0,
    pulseSeconds: 0,
    recheckSeconds: 0,
    directive: null,
    // Whatever the user set stands, untouched.
    selfSwitch: 'never',
    subagents: 'untouched',
    workflows: 'untouched',
    switchGapPoints: 10,
  },
};

const ORDER = ['max', 'high', 'standard', 'off'];
const DEFAULT_MODE = 'standard';

// The fields some other script reads, and where. Kept beside the table so a
// new field cannot be added and quietly reported as behaviour: if it is not
// here, --explain says outright that nothing reads it.
const WIRED = {
  briefStyle: 'brief.js: how much of the line is said, and "none" for silence',
  briefWhenUnchanged: 'brief.js: whether to repeat a line nothing has moved',
  refreshSeconds: 'brief.js: how old a reading may be before it is retaken; 0 short-circuits the hook',
  pulseSeconds: 'pulse.js: how often the mid-turn hook does real work',
  recheckSeconds: 'pulse.js: how often the mid-turn re-cost may speak',
  switchGapPoints: 'usage.js: how much emptier another window must be before a switch is named',
};

// ---------------------------------------------------------------------------
// Names
//
// "normal" is the trap. In the vocabulary this was asked in, "normal" means
// the FOURTH mode - the plugin ignored. To almost everyone else it means the
// THIRD - the plugin working as usual. A silent wrong guess picks the opposite
// of what was asked, so `normal` is an alias for neither: it is accepted and
// answered with a disambiguation.
const ALIASES = {
  ultra: 'max',
  ultraefficient: 'max',
  'ultra-efficient': 'max',
  maxtoken: 'max',
  'max-token': 'max',
  maxefficient: 'max',
  maxefficiency: 'max',
  'max-efficient': 'max',
  highefficient: 'high',
  'high-efficient': 'high',
  'high-efficiency': 'high',
  highefficiency: 'high',
  smart: 'high',
  tokenefficient: 'standard',
  'token-efficient': 'standard',
  efficient: 'standard',
  default: 'standard',
  on: 'standard',
  none: 'off',
  ignore: 'off',
  quiet: 'off',
  silent: 'off',
};

const AMBIGUOUS = {
  normal: ['standard', 'off'],
};

function ambiguityText(word) {
  const choices = AMBIGUOUS[word];
  if (!choices) return null;
  return (
    word + ' is ambiguous here. Did you mean:\n' +
    '  standard  the plugin working as usual\n' +
    '  off       the plugin stays out of the way'
  );
}

// Returns { mode } for a name that resolves, { ambiguous, message } for one
// that deliberately does not, and null for a word that is not a mode at all.
// Three outcomes rather than two, because "I will not guess" is an answer.
function normalise(value) {
  const word = String(value === undefined || value === null ? '' : value).trim().toLowerCase();
  if (!word) return null;
  if (AMBIGUOUS[word]) return { ambiguous: AMBIGUOUS[word].slice(), message: ambiguityText(word) };
  if (MODES[word]) return { mode: word };
  if (ALIASES[word]) return { mode: ALIASES[word], alias: word };
  if (word === 'auto') return { auto: true };
  return null;
}

// ---------------------------------------------------------------------------
// Tiers, for the user's bounds
//
// The canonical effort ladder the host accepts is low|medium|high|xhigh|max.
// "ultracode" is not a sixth level: it is xhigh plus standing dynamic workflow
// orchestration, set through its own settings key, so it ranks with xhigh.
//
// Two guards the modes have to respect and do not get to argue with:
//   - xhigh and max are refused outright when thinking is disabled.
//   - a model bound cannot be enforced against a model nobody has ranked, so
//     an unknown name is reported rather than silently treated as the floor.
const EFFORT_ORDER = ['low', 'medium', 'high', 'xhigh', 'max'];
const THINKING_ONLY_EFFORTS = ['xhigh', 'max'];

// Cheapest first. The order is the reverse of usage.js's FAMILIES, which is
// the account's own ordering of these families, so the two cannot drift into
// disagreeing about which way is "down".
const MODEL_ORDER = ['haiku', 'sonnet', 'opus', 'mythos', 'fable'];

function effortRank(value) {
  const name = String(value || '').trim().toLowerCase();
  if (name === 'ultracode') return EFFORT_ORDER.indexOf('xhigh');
  const at = EFFORT_ORDER.indexOf(name);
  return at === -1 ? null : at;
}

function modelRank(value) {
  const name = String(value || '').trim().toLowerCase();
  for (let i = 0; i < MODEL_ORDER.length; i += 1) {
    if (name.indexOf(MODEL_ORDER[i]) !== -1) return i;
  }
  return null;
}

// "sonnet/medium", "sonnet", "medium" - whichever half the user gave.
function parseTier(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return null;
  const parts = text.split('/').map((part) => part.trim()).filter(Boolean);
  const tier = { model: null, effort: null };
  for (const part of parts) {
    if (effortRank(part) !== null) tier.effort = part === 'ultracode' ? 'xhigh' : part;
    else if (modelRank(part) !== null) tier.model = MODEL_ORDER[modelRank(part)];
    else return { error: 'not a model or effort: ' + part };
  }
  if (!tier.model && !tier.effort) return { error: 'nothing recognised in "' + value + '"' };
  return tier;
}

function tierText(tier) {
  if (!tier) return null;
  return [tier.model, tier.effort].filter(Boolean).join('/');
}

// Does a suggestion respect the bounds the user set?
//
// A floor says "never below this, even in max". A ceiling says "never above
// this, even on the hard part". Anything the plugin would SAY that points
// outside them is dropped at the rendering boundary rather than argued with
// downstream, because the invariant is about what reaches the reader.
function allows(bounds, suggestion) {
  if (!bounds || !suggestion) return true;
  const check = (kind, rank) => {
    const floor = bounds.floor && bounds.floor[kind] ? rank(bounds.floor[kind]) : null;
    const ceiling = bounds.ceiling && bounds.ceiling[kind] ? rank(bounds.ceiling[kind]) : null;
    const mine = suggestion[kind] ? rank(suggestion[kind]) : null;
    // An unranked name is not evidence of a breach. Reporting it as one would
    // suppress a true statement over a spelling.
    if (mine === null) return true;
    if (floor !== null && mine < floor) return false;
    if (ceiling !== null && mine > ceiling) return false;
    return true;
  };
  return check('effort', effortRank) && check('model', modelRank);
}

function boundsNote(bounds) {
  if (!bounds) return null;
  const bits = [];
  if (bounds.floor) bits.push('never below ' + tierText(bounds.floor));
  if (bounds.ceiling) bits.push('never above ' + tierText(bounds.ceiling));
  if (bounds.pin) bits.push('no self-switching at all: report the gap and leave it');
  if (!bits.length) return null;
  return 'Bounds the user set: ' + bits.join('; ') + '.';
}

function thinkingCaveat(tier) {
  if (!tier || !tier.effort) return null;
  if (THINKING_ONLY_EFFORTS.indexOf(tier.effort) === -1) return null;
  return (
    tier.effort + ' is only accepted while thinking is on; with thinking disabled the request is ' +
    'refused outright, so check that before pointing anything at it.'
  );
}

// ---------------------------------------------------------------------------
// The directives
//
// Injected verbatim. The wording is the feature.
//
// One correction against what the host actually allows, because a directive
// that promises a lever nobody has is worse than no directive. Nothing a hook
// emits can change the running session's own model or effort: the whole hook
// output contract carries no such field, and PreModelSwitch is a veto on a
// switch someone else started, not a way to start one. What IS the agent's is
// the tier of what it spawns - the model on an Agent call, and model AND
// effort inside a Workflow script - so that is what the wording points at.
//
// The max directive is also the shortest, and that is not a coincidence: it is
// the mode whose whole promise is that the plugin costs little, and a
// four-hundred-token lecture about saving tokens spends what it is asking to
// save. Every clause of the longer draft is still here; the padding is not.
const DIRECTIVES = {
  max:
    'Budget mode: max efficiency. Fewest tokens that still get it right: search before you read, ' +
    'read ranges not whole files, never re-read what you just wrote, batch edits, no preamble. ' +
    'No subagent or workflow unless this loop truly cannot do it. Quality is not negotiable - ' +
    'ceremony is.',
  high:
    'Budget mode: high efficiency. Work at full capability, and every couple of minutes check ' +
    'whether the model, effort and approach you are running are bigger than this task needs - ' +
    'step down when they are, and step back up when the work turns hard again. Your own tier is ' +
    'not yours to set mid-turn, so when it is the thing that is too big, say so in one line with ' +
    'the exact command and carry on. What is yours is the tier of what you spawn: the model on an ' +
    'Agent call, and the model and effort inside a Workflow script. Size those to the stage - low ' +
    'effort for mechanical ones - and reach for a workflow only when it saves more context than ' +
    'it costs.',
  standard: null,
  off: null,
};

// The bounds are deliberately NOT glued on here. They are the user's own
// limits on what may be suggested, they apply in every mode including the two
// with no directive at all, and a renderer that wants them asks boundsNote()
// for them. Appending them here would have made them invisible in `standard`,
// which is the mode most people are in.
function directive(name) {
  return DIRECTIVES[name] || null;
}

// ---------------------------------------------------------------------------
// State
//
// One small file in the host-aware config directory, so a Codex session reads
// its own mode and not the Claude Code one. Atomic write, same beside-and-
// rename as the other stores: the prompt hook and a pulse can land here in the
// same second.

function configDir() {
  return host.detect(process.argv.slice(2), process.env) === host.CODEX
    ? codex.homeDir()
    : process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

function modeFile() {
  return path.join(configDir(), 'usage-limits-mode.json');
}

function changesFile() {
  return path.join(configDir(), 'usage-limits-changes.json');
}

// How many declines and how many change-log entries are worth keeping. Both
// are bounded for the same reason as the drift ledger: the file must be the
// same size after a year as after a day.
const KEEP_DECLINED = 40;
const KEEP_OFFERS = 10;
const KEEP_CHANGES = 100;

function empty() {
  return {
    version: 1,
    mode: DEFAULT_MODE,
    auto: false,
    guardPercent: null,
    // The ceiling is the only setting here that is ENFORCED rather than
    // reported: past it, fan-out calls are refused at the hook. Null means no
    // ceiling, and a ceiling nobody set never refuses anything. See ceiling.js.
    ceilingPercent: null,
    // WHOSE cap it is. A cap is said about the work in front of someone, so
    // it binds only in the session that set it; carrying it into the next one
    // means refusing fan-outs on a fresh window for a reason nobody gave. A
    // stored cap with no session here predates this rule and is ignored.
    ceilingSession: null,
    // Applies to EVERY session, survives a reset, and is only cleared by
    // asking. The session-scoped cap above lapses on purpose; this does not.
    ceilingAlways: null,
    setAt: null,
    setBy: null,
    session: null,
    floor: null,
    ceiling: null,
    pin: false,
    advice: { off: false, declined: {}, offered: {} },
  };
}

// A corrupt file falls back to the default rather than throwing. This is read
// from inside hooks, and a hook that fails over its own state file would cost
// more than the setting it was trying to honour.
function read() {
  const base = empty();
  let raw = null;
  try {
    raw = fs.readFileSync(modeFile(), 'utf8');
  } catch (err) {
    // Never written is the ordinary case. Anything else is a file that exists
    // and could not be read, which is a different thing from "no mode set" and
    // is flagged so describe() can say so instead of reporting the default as
    // though the user had chosen it.
    if (err.code !== 'ENOENT') base.unreadable = true;
    return base;
  }
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    base.unreadable = true;
    return base;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    base.unreadable = true;
    return base;
  }
  const named = normalise(parsed.mode);
  if (named && named.mode) base.mode = named.mode;
  base.auto = parsed.auto === true;
  base.guardPercent = Number.isFinite(parsed.guardPercent) ? parsed.guardPercent : null;
  // Anything outside 1-100 is not a ceiling, and enforcing a number that was
  // never a percentage would refuse work over a typo.
  base.ceilingSession = typeof parsed.ceilingSession === 'string' ? parsed.ceilingSession : null;
  base.ceilingAlways =
    Number.isFinite(parsed.ceilingAlways) && parsed.ceilingAlways > 0 && parsed.ceilingAlways <= 100
      ? parsed.ceilingAlways
      : null;
  base.ceilingPercent =
    Number.isFinite(parsed.ceilingPercent) && parsed.ceilingPercent > 0 && parsed.ceilingPercent <= 100
      ? parsed.ceilingPercent
      : null;
  base.setAt = Number.isFinite(parsed.setAt) ? parsed.setAt : null;
  base.setBy = typeof parsed.setBy === 'string' ? parsed.setBy : null;
  if (parsed.session && typeof parsed.session === 'object' && parsed.session.id) {
    const sessionMode = normalise(parsed.session.mode);
    if (sessionMode && sessionMode.mode) {
      base.session = { id: String(parsed.session.id), mode: sessionMode.mode, at: Number.isFinite(parsed.session.at) ? parsed.session.at : null };
    }
  }
  for (const key of ['floor', 'ceiling']) {
    const value = parsed[key];
    if (value && typeof value === 'object' && (value.model || value.effort)) {
      base[key] = {
        model: modelRank(value.model) === null ? null : String(value.model).toLowerCase(),
        effort: effortRank(value.effort) === null ? null : String(value.effort).toLowerCase(),
      };
      if (!base[key].model && !base[key].effort) base[key] = null;
    }
  }
  base.pin = parsed.pin === true;
  if (parsed.advice && typeof parsed.advice === 'object') {
    base.advice.off = parsed.advice.off === true;
    if (parsed.advice.declined && typeof parsed.advice.declined === 'object') {
      base.advice.declined = Object.assign({}, parsed.advice.declined);
    }
    if (parsed.advice.offered && typeof parsed.advice.offered === 'object') {
      base.advice.offered = Object.assign({}, parsed.advice.offered);
    }
  }
  return base;
}

function writeAtomic(file, value) {
  atomic.writeFileAtomic(file, JSON.stringify(value, null, 2) + '\n');
}

// Never throws for the same reason read() does not.
function write(state) {
  try {
    const next = Object.assign({}, state);
    next.advice = Object.assign({ off: false, declined: {}, offered: {} }, state.advice || {});
    next.advice.declined = trimStamps(next.advice.declined, KEEP_DECLINED);
    next.advice.offered = trimStamps(next.advice.offered, KEEP_OFFERS, (entry) => entry && entry.at);
    writeAtomic(modeFile(), next);
    return true;
  } catch (err) {
    return false;
  }
}

// Keeps the newest N by timestamp. `at` is either the value itself (declined)
// or a field on it (offered), so one trimmer serves both.
function trimStamps(table, keep, pick) {
  const entries = Object.keys(table || {}).map((key) => ({
    key,
    at: pick ? Number(pick(table[key])) || 0 : Number(table[key]) || 0,
  }));
  entries.sort((a, b) => b.at - a.at);
  const kept = {};
  for (const entry of entries.slice(0, keep)) kept[entry.key] = table[entry.key];
  return kept;
}

// ---------------------------------------------------------------------------
// auto
//
// Not a fifth mode: a switch that picks one from pressure, so it is always
// reported as the mode it resolved to ("auto -> max"), never as a mystery.
//
// It never resolves to `off`. Turning the plugin off is a decision a person
// makes, not one a threshold makes.
function autoPick(reading) {
  const percent = reading && Number.isFinite(reading.percentUsed) ? reading.percentUsed : null;
  const pressure = reading ? reading.pressure : null;
  if (pressure === 'tight' || pressure === 'gone') return 'max';
  if (percent === null) return DEFAULT_MODE;
  if (percent >= 80) return 'max';
  if (percent >= 50) return 'high';
  return DEFAULT_MODE;
}

// Where autoPick's reading comes from when the caller has none.
//
// Every production caller had none. brief.js, pulse.js, feed.js, stop.js and
// the report all ask forSession({ sessionId }) and nothing else, because they
// need the mode BEFORE they can afford a reading - that is the whole point of
// settling it first. autoPick's no-measurement branch then returned
// `standard`, so an account could sit at 95 per cent used with `auto` on and
// every hook, the status line and the ledger would read and behave as
// standard. The headline behaviour of the mode was inert.
//
// So it takes the cheap reading itself: the snapshot already on disk plus
// whatever correction an earlier turn has already paid for. No scan, no
// request, no wait - the same source the status line redraws from many times a
// second. It is only ever reached while `auto` is actually on.
//
// Required lazily because usage.js requires this module back; at module scope
// that is a half-built export table.
function readingNow(now) {
  try {
    const usage = require('./usage.js');
    // The host this hook is running for, settled the same way every caller
    // settles it, so a Codex session reads Codex's meter.
    usage.setHost(host.detect(process.argv.slice(2), process.env));
    const collected = usage.collect(Number.isFinite(now) ? now : Date.now());
    if (!collected || !collected.utilization) return null;
    const codexHome = usage.isCodex() ? codex.homeDir() : null;
    const windows = usage.snapshotWindows(collected, now, codexHome);
    // The same suppression every other reader makes: a per-model weekly for a
    // model this session is not running cannot be the window that stops it, so
    // it must not be the thing that picks the mode either.
    const usable = windows.filter((w) => w.applies !== false && !w.stale && Number.isFinite(w.percentUsed));
    if (!usable.length) return null;
    return { percentUsed: usable.reduce((worst, w) => (w.percentUsed > worst.percentUsed ? w : worst)).percentUsed };
  } catch (err) {
    // No reading is the one thing autoPick already handles: it falls to the
    // default rather than guessing.
    return null;
  }
}

// ---------------------------------------------------------------------------
// Resolution and precedence
//
//   USAGE_LIMITS_MODE env  ->  --session override  ->  persisted file  ->  standard
//
// Each level reports its own source, the way the effort chain does, because
// "which mode am I in" is uninteresting next to "and who said so".
function resolve(options) {
  const opts = options || {};
  const env = opts.env || process.env;
  const state = opts.state || read();
  const sessionId = opts.sessionId || null;
  const reading = opts.reading || null;

  let name = null;
  let source = null;
  let auto = false;

  const fromEnv = normalise(env.USAGE_LIMITS_MODE);
  if (fromEnv && fromEnv.mode) {
    name = fromEnv.mode;
    source = 'environment';
  } else if (fromEnv && fromEnv.auto) {
    auto = true;
    source = 'environment';
  } else if (state.session && sessionId && state.session.id === sessionId) {
    name = state.session.mode;
    source = 'this session';
  } else if (state.auto) {
    auto = true;
    source = 'auto, from the file';
  } else {
    name = state.mode || DEFAULT_MODE;
    source = state.setAt ? 'the file' : 'the default';
  }

  let label = name;
  if (auto) {
    // A caller that has a reading passes it; one that has none gets the cheap
    // one rather than silently resolving to the default. See readingNow().
    name = autoPick(reading || readingNow(opts.now));
    label = 'auto -> ' + name;
  }

  const policy = MODES[name] || MODES[DEFAULT_MODE];
  return {
    name: policy.name,
    label,
    source,
    auto,
    policy,
    guardPercent: state.guardPercent,
    ceilingPercent: state.ceilingPercent,
    bounds: { floor: state.floor, ceiling: state.ceiling, pin: state.pin === true },
    advice: state.advice,
    state,
    // The one field every caller needs and nobody should re-derive.
    directive: directive(policy.name),
  };
}

// What a hook wants: one call, never throws, and the reading is optional
// because a hook that has not scanned yet still has to know whether to bother.
function forSession(options) {
  try {
    return resolve(options);
  } catch (err) {
    const policy = MODES[DEFAULT_MODE];
    return {
      name: policy.name,
      label: policy.name,
      source: 'the default',
      auto: false,
      policy,
      guardPercent: null,
      ceilingPercent: null,
      bounds: { floor: null, ceiling: null, pin: false },
      advice: { off: false, declined: {}, offered: {} },
      state: empty(),
      directive: null,
    };
  }
}

// ---------------------------------------------------------------------------
// The change log
//
// "Can you change it back?" needs a referent. Without one the agent is
// guessing at the user's own settings, and a guess written into their file is
// exactly the surprise the read-only rule exists to prevent. So every change
// the plugin knows about is written down, and "back" means the last entry.
//
//   { at, plane: user|agent|mode, key, from, to, by: user|claude, reason }

// "Nothing has been changed yet" and "the record of what changed is gone" are
// different facts, and a file that cannot be parsed must not be reported as
// the first. A user who has been making changes and is told nothing was ever
// changed has no reason to suspect the file. ENOENT is one err.code check
// away, so the distinction costs a line.
function readChanges() {
  let raw = null;
  try {
    raw = fs.readFileSync(changesFile(), 'utf8');
  } catch (err) {
    // Never written is the ordinary case, and it is not a fault.
    return err.code === 'ENOENT' ? { entries: [] } : { entries: [], unreadable: true };
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.entries)) return { entries: [], unreadable: true };
    // A truncated file can leave entries that are not objects; they are
    // dropped rather than allowed to reach a renderer.
    return { entries: parsed.entries.filter((e) => e && typeof e === 'object' && Number.isFinite(e.at)) };
  } catch (err) {
    return { entries: [], unreadable: true };
  }
}

const UNREADABLE_LOG =
  'The change log exists but could not be read, so what changed is not known ' +
  'rather than empty. The file is ';

function logChange(entry, now) {
  if (!entry || !entry.key) return false;
  try {
    const state = readChanges();
    state.entries.push({
      at: Number.isFinite(now) ? now : Date.now(),
      plane: entry.plane || 'mode',
      key: String(entry.key),
      from: entry.from === undefined ? null : entry.from,
      to: entry.to === undefined ? null : entry.to,
      by: entry.by === 'claude' ? 'claude' : 'user',
      reason: entry.reason ? String(entry.reason).slice(0, 200) : null,
      // How far the change reached, as a field rather than as English inside
      // `to`. A session override used to be recorded as the string
      // "max (this session)", which reads correctly and is useless to undo:
      // it parsed back to the persisted mode, rewrote that, left the override
      // in place, and reported a revert that had not happened.
      scope: entry.scope === 'session' ? 'session' : 'global',
      sessionId: entry.sessionId ? String(entry.sessionId) : null,
    });
    if (state.entries.length > KEEP_CHANGES) state.entries = state.entries.slice(-KEEP_CHANGES);
    writeAtomic(changesFile(), state);
    return true;
  } catch (err) {
    return false;
  }
}

// The change undo will act on: the newest one that is still standing.
//
// Two kinds of entry are skipped. An undo's own reversal is a record of the
// undo, not a change to reverse - taking it as the target made a second `undo`
// redo the first, oscillating between two states forever instead of stepping
// back through the log. And an entry already reversed is done with, so undo
// twice reaches the change before it.
function lastUndoable(entries) {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (!entry || entry.undone || entry.reason === 'undo') continue;
    return { entry, index: i };
  }
  return null;
}

// Stamps the entry undo just reversed, so it is not offered again.
function markUndone(index, now) {
  try {
    const state = readChanges();
    if (!state.entries[index]) return false;
    state.entries[index] = Object.assign({}, state.entries[index], { undone: Number.isFinite(now) ? now : Date.now() });
    writeAtomic(changesFile(), state);
    return true;
  } catch (err) {
    return false;
  }
}

function ago(ms) {
  if (!Number.isFinite(ms) || ms < 0) return 'just now';
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return minutes + 'm ago';
  const hours = Math.round(minutes / 60);
  if (hours < 48) return hours + 'h ago';
  return Math.round(hours / 24) + 'd ago';
}

function describeChange(entry, now) {
  return (
    '  ' + ago(now - entry.at).padEnd(9) + entry.plane.padEnd(9) + entry.key + ': ' +
    (entry.from === null ? '(unset)' : entry.from) + ' -> ' + (entry.to === null ? '(unset)' : entry.to) +
    (entry.scope === 'session' ? ' (this session only)' : '') +
    ' (by ' + entry.by + (entry.reason ? ', ' + entry.reason : '') + (entry.undone ? ', since undone' : '') + ')'
  );
}

function history(now, limit) {
  const log = readChanges();
  const entries = log.entries.slice(-(limit || 20)).reverse();
  if (!entries.length) {
    return log.unreadable ? UNREADABLE_LOG + changesFile() + '.' : 'Nothing has been changed through this plugin yet.';
  }
  const at = Number.isFinite(now) ? now : Date.now();
  return ['What changed, newest first:'].concat(entries.map((e) => describeChange(e, at))).join('\n');
}

// Reverses the last logged change, naming it first.
//
// It only reverses what the plugin itself owns - the mode plane and the agent
// plane. A user-plane entry is settings.json, and this file never writes that:
// it names the entry and the one command that undoes it, and leaves the file
// alone. That is not timidity, it is the two-planes rule - the user's baseline
// is theirs - and it is what keeps "no mode writes settings.json" true by
// construction rather than by remembering.
function undo(now) {
  const state = readChanges();
  const found = lastUndoable(state.entries);
  if (!found) {
    return {
      ok: false,
      text: state.unreadable
        ? UNREADABLE_LOG + changesFile() + '. Nothing was changed.'
        : 'There is nothing in the change log to undo.',
    };
  }
  const last = found.entry;
  const at = Number.isFinite(now) ? now : Date.now();
  if (last.plane === 'user') {
    // In Codex the command needs the host on it, or it edits the other agent's
    // baseline: lowpower.js falls back to host.detect(argv), where Claude wins
    // ties, and a machine with both installed has both.
    const codexHere = host.detect(process.argv.slice(2), process.env) === host.CODEX;
    // Which way the change went decides which command reverses it. Naming
    // "lowpower off" after a restore would be telling the user to run the
    // thing they just ran, which is a no-op dressed up as an undo.
    const had = last.from === null || last.from === '(unset)' ? null : last.from;
    const reverse = last.reason === 'lowpower off'
      ? 'node scripts/lowpower.js on' +
        (last.key === 'effortLevel' && had ? ' --effort ' + had : '') +
        (last.key === 'model' && had ? ' --model ' + had : '')
      : 'node scripts/lowpower.js off';
    return {
      ok: false,
      entry: last,
      text:
        'The last change was to your own settings (' + last.key + ': ' +
        (last.from === null ? '(unset)' : last.from) + ' -> ' + (last.to === null ? '(unset)' : last.to) +
        '), ' + ago(at - last.at) + '. That plane is yours and this ' +
        'script does not write it. To put it back: ' + reverse +
        (codexHere ? ' --host codex' : '') + '. Note that it applies to ' +
        'NEW sessions - the one you are in keeps ' +
        (codexHere ? 'the tier it started with; Codex changes a running session through its own controls.' : 'the tier it started with.'),
    };
  }
  if (last.plane !== 'mode') {
    return {
      ok: false,
      entry: last,
      text:
        'The last change was on the agent plane (' + last.key + ': ' + last.from + ' -> ' + last.to +
        '), which lives in the turn that made it and cannot be rewritten from here. Nothing was changed.',
    };
  }
  const target = normalise(last.from);
  const current = read();
  const before = current.auto ? 'auto' : current.mode;
  // A reversal is only true if the EFFECTIVE mode moves, and the session
  // override outranks the file. Rewriting the file under a live override and
  // reporting "reverted, nothing else was touched" was a revert that had not
  // happened: mode --session-id S1 still answered with the override.
  if (last.key === 'mode' && last.scope === 'session') {
    const had = current.session;
    current.session = null;
    write(current);
    markUndone(found.index, now);
    logChange({ plane: 'mode', key: 'mode', from: last.to, to: current.mode, by: 'user', reason: 'undo' }, now);
    return {
      ok: true,
      entry: last,
      text:
        'Reverting the session override' + (had && had.mode ? ' (' + had.mode + ')' : '') +
        '. This session is back on the persisted mode, ' + current.mode + '. Nothing else was touched.',
    };
  }
  if (last.key === 'mode' && target && (target.mode || target.auto)) {
    // "turn auto on, try a mode, put it back" is the likeliest undo there is,
    // and it was the one that failed: normalise('auto') returns { auto: true }
    // with no `.mode`, so the branch fell through to "not one this script can
    // reverse" while the log held exactly what was needed.
    current.auto = Boolean(target.auto);
    if (target.mode) current.mode = target.mode;
    current.setAt = at;
    current.setBy = 'undo';
    write(current);
    markUndone(found.index, now);
    const back = target.auto ? 'auto' : target.mode;
    logChange({ plane: 'mode', key: 'mode', from: before, to: back, by: 'user', reason: 'undo' }, now);
    return { ok: true, entry: last, text: 'Reverting mode ' + before + ' back to ' + back + '. Nothing else was touched.' };
  }
  if (last.key === 'auto') {
    current.auto = last.from === true || last.from === 'on';
    write(current);
    markUndone(found.index, now);
    logChange({ plane: 'mode', key: 'auto', from: last.to, to: current.auto, by: 'user', reason: 'undo' }, now);
    return { ok: true, entry: last, text: 'Reverting auto back to ' + (current.auto ? 'on' : 'off') + '.' };
  }
  if (last.key === 'guard') {
    current.guardPercent = Number.isFinite(last.from) ? last.from : null;
    write(current);
    markUndone(found.index, now);
    logChange({ plane: 'mode', key: 'guard', from: last.to, to: current.guardPercent, by: 'user', reason: 'undo' }, now);
    return { ok: true, entry: last, text: 'Reverting the guard back to ' + (current.guardPercent === null ? 'none' : current.guardPercent + '%') + '.' };
  }
  if (last.key === 'floor' || last.key === 'ceiling') {
    current[last.key] = last.from ? parseTier(last.from) : null;
    if (current[last.key] && current[last.key].error) current[last.key] = null;
    write(current);
    markUndone(found.index, now);
    logChange({ plane: 'mode', key: last.key, from: last.to, to: tierText(current[last.key]), by: 'user', reason: 'undo' }, now);
    return { ok: true, entry: last, text: 'Reverting the ' + last.key + ' back to ' + (tierText(current[last.key]) || 'none') + '.' };
  }
  if (last.key === 'pin') {
    current.pin = last.from === true;
    write(current);
    markUndone(found.index, now);
    logChange({ plane: 'mode', key: 'pin', from: last.to, to: current.pin, by: 'user', reason: 'undo' }, now);
    return { ok: true, entry: last, text: 'Reverting pin back to ' + (current.pin ? 'on' : 'off') + '.' };
  }
  return { ok: false, entry: last, text: 'The last change (' + last.key + ') is not one this script can reverse. Nothing was changed.' };
}

// ---------------------------------------------------------------------------
// The advice channel
//
// The two planes are not sealed off from each other: they talk, in both
// directions, through the conversation. The whole rule in one line:
//
//   Claude may RECOMMEND a user-plane change. Claude may MAKE one when asked.
//   Claude may never make one unasked.
//
// The failure mode of a feature like this is nagging, and a plugin that nags
// gets turned off, at which point it protects nothing. So:
//   - Evidence or silence. A recommendation cites a measurement or it is not
//     made. "Recommended" with no number is nagging.
//   - One per session, at most.
//   - A declined recommendation is remembered and never raised again.
//   - Never in off. In max, allowed but terse, and still capped at one.
//   - Always names the exact command, the plane it changes, and when it takes
//     effect. A recommendation the user cannot act on in one step is a
//     complaint.

// The id is what a decline is remembered by, so it describes the SUGGESTION
// and not the moment: the same advice next week is the same advice.
function adviceId(fit) {
  if (!fit) return null;
  return 'effort:' + fit.effort + '>' + fit.cheaper;
}

// `fit` is usage.settingFit()'s output: measured, or null. Passing it in
// rather than reaching for usage.js keeps this module free of the cycle and
// makes "evidence or silence" structural - with no measurement there is
// nothing to build a recommendation out of.
function advicePending(options) {
  const opts = options || {};
  const decided = opts.decided || resolve(opts);
  const fit = opts.fit || null;
  const sessionId = opts.sessionId || null;
  const advice = decided.advice || { off: false, declined: {}, offered: {} };

  if (decided.policy.briefStyle === 'none') return { ok: false, reason: 'off', text: null };
  if (advice.off) return { ok: false, reason: 'muted', text: null };
  if (!fit) return { ok: false, reason: 'no measurement', text: null };
  const id = adviceId(fit);
  if (advice.declined && advice.declined[id]) return { ok: false, reason: 'declined before', id, text: null };
  // A bound the user set outranks the measurement: advice that points below
  // their own floor is advice they already refused.
  if (!allows(decided.bounds, { effort: fit.cheaper })) return { ok: false, reason: 'below the bounds set', id, text: null };
  const offered = advice.offered && sessionId ? advice.offered[sessionId] : null;
  const alreadyOffered = Boolean(offered && offered.id === id);

  // Terse in max, and the same measurement either way.
  const terse = decided.policy.briefStyle === 'terse';
  const text = terse
    ? 'Recommendation: ' + fit.effort + ' measured ' + fit.multiple + 'x ' + fit.cheaper +
      ' a turn here (' + fit.sample + ' turns). Yours to make: ' + fit.command + ', from your next turn.'
    : 'One recommendation, from this account\'s own record: ' + fit.effort + ' has measured ' +
      fit.multiple + ' times the cost of ' + fit.cheaper + ' a turn (' + fit.sample + ' turns against ' +
      fit.cheaperSample + '). If the stretch ahead is mechanical, ' + fit.command + ' is the change and it ' +
      'is the user\'s own setting to make - offer it, do not make it. Say plainly that it applies from ' +
      'the next turn onward, not retroactively.';

  return { ok: true, id, text, alreadyOffered, terse };
}

// What was offered, and what it said.
//
// The text is stored, not only the id, because the CLI has to be able to
// answer "what is pending" and "decline what you just offered" without a
// transcript scan. The brief is the only thing that HAS the measurement - it
// has already paid for the scan - so the offer it writes is where a later
// `mode --advice` gets its evidence from.
function adviceOffer(id, sessionId, now, text) {
  if (!id || !sessionId) return false;
  const state = read();
  state.advice.offered[sessionId] = {
    id,
    at: Number.isFinite(now) ? now : Date.now(),
    text: text ? String(text).slice(0, 600) : null,
  };
  return write(state);
}

// The most recent offer: this session's when there is one, otherwise the
// newest across sessions. "The user just said no" is said in a session, but a
// user typing the command in a fresh shell has no session id to give and still
// means the recommendation they were just shown.
function adviceLastOffer(sessionId, state) {
  const current = state || read();
  const offered = (current.advice && current.advice.offered) || {};
  if (sessionId && offered[sessionId] && offered[sessionId].id) {
    return Object.assign({ sessionId }, offered[sessionId]);
  }
  let best = null;
  for (const key of Object.keys(offered)) {
    const entry = offered[key];
    if (!entry || !entry.id) continue;
    if (!best || (Number(entry.at) || 0) > (Number(best.at) || 0)) best = Object.assign({ sessionId: key }, entry);
  }
  return best;
}

function adviceDecline(id, now) {
  if (!id) return false;
  const state = read();
  state.advice.declined[id] = Number.isFinite(now) ? now : Date.now();
  return write(state);
}

function adviceMute(off) {
  const state = read();
  state.advice.off = Boolean(off);
  return write(state);
}

// ---------------------------------------------------------------------------
// The two planes, side by side
//
// The user plane is settings.json, the pickers, lowpower.js: the user saying
// what they want for themselves. It is read here and never written.
//
// The agent plane is the tier actually running this turn. That is what costs
// money, and it is the agent's to move - for what it spawns. Its own tier it
// can only report and name the command for.
//
// CLAUDE_EFFORT is read FIRST and deliberately not folded into usage.js's
// effort chain. The host sets it per turn, after any silent downgrade for the
// selected model, which makes it the most accurate reading there is - and it
// is present in the environment of everything the host launches, so putting it
// into the shared chain would change what every other caller sees.
function tierNow(options) {
  const opts = options || {};
  const env = opts.env || process.env;
  const usage = opts.usage || require('./usage.js');
  const sessionId = opts.sessionId || null;

  let effort = null;
  const perTurn = String(env.CLAUDE_EFFORT || '').trim().toLowerCase();
  if (perTurn && (effortRank(perTurn) !== null || perTurn === 'ultracode')) {
    effort = { effort: perTurn, source: 'this turn', live: true };
  }
  if (!effort) {
    try {
      effort = usage.effortNow(sessionId, env);
    } catch (err) {
      effort = null;
    }
  }

  let settings = null;
  try {
    settings = usage.collect(Number.isFinite(opts.now) ? opts.now : Date.now()).settings || null;
  } catch (err) {
    settings = null;
  }

  // The newest assistant message is the model that actually answered, which a
  // settings alias ('opus') cannot say. The hook's own transcript_path is read
  // first when the caller has it: it is the file this very turn is written to,
  // where the session-id lookup has to find it under the config directory.
  let running = null;
  try {
    let seen = null;
    if (opts.transcriptPath && typeof usage.transcriptModel === 'function') seen = usage.transcriptModel(opts.transcriptPath);
    if (!(seen && seen.model) && sessionId) seen = usage.liveModel(sessionId);
    running = seen && seen.model ? seen.model : null;
  } catch (err) {
    running = null;
  }

  return {
    baseline: {
      model: settings && settings.model ? settings.model : null,
      effort: settings && settings.effortLevel ? settings.effortLevel : null,
    },
    running: {
      model: running,
      effort: ultracodeName(effort ? effort.effort : null, sessionId, opts.now),
      source: effort ? effort.source : null,
    },
  };
}

// Ultracode reads as "xhigh" everywhere, and that is technically true and
// practically wrong.
//
// Ultracode RESOLVES to xhigh, so every effort reader - the settings file, the
// live transcript, CLAUDE_EFFORT - honestly reports xhigh, and the display said
// xhigh at somebody who had typed ultracode. The two are the same amount of
// reasoning and a very different amount of everything else, so a person who
// asked for one and is shown the other has no way to tell it took.
//
// The plugin already knows. brief.js sets an ultracode flag on the session's
// activity mark the moment the word appears in a prompt, and it STICKS for the
// session because ultracode is a session-level trigger rather than a per-prompt
// one. Nothing read it back. This does.
//
// Only xhigh is renamed. If some future effort is higher, reporting it as
// ultracode would be a downgrade dressed up as a label, so it is left alone.
function ultracodeName(effort, sessionId, now) {
  if (effort !== 'xhigh' || !sessionId) return effort;
  try {
    const entry = require('./activity.js').read()[sessionId];
    return entry && entry.ultracode ? 'ultracode' : effort;
  } catch (err) {
    // The real effort is a better answer than no answer.
    return effort;
  }
}

function sameFamily(a, b) {
  const left = modelRank(a);
  const right = modelRank(b);
  if (left === null || right === null) return String(a || '') === String(b || '');
  return left === right;
}

// The model as the brief names it: the family and the version. It used to be
// the family alone, so claude-opus-5 and claude-opus-5-5 both printed "opus"
// and a switch between them - a 20% price change, 60% on cache reads - was
// invisible in the one line that exists to say what is producing the turn. A
// bare alias ('opus') has no version to show and is shown as it is.
function modelLabel(name) {
  if (!name) return null;
  let parsed = null;
  try {
    parsed = require('./usage.js').parseModelId(name);
  } catch (err) {
    parsed = null;
  }
  if (parsed) return parsed.version.length ? parsed.family + ' ' + parsed.version.join('.') : parsed.family;
  const rank = modelRank(name);
  return rank === null ? name : MODEL_ORDER[rank];
}

// Same model for the purpose of "is the running tier the baseline". Same
// family, and where both sides carry a version, the same version: opus 5 and
// opus 5.5 are different models at different prices, but a baseline of the
// bare alias 'opus' says nothing about which Opus, so it disagrees with none.
function sameModel(a, b) {
  if (!sameFamily(a, b)) return false;
  let left = null;
  let right = null;
  try {
    const usage = require('./usage.js');
    left = usage.parseModelId(a);
    right = usage.parseModelId(b);
  } catch (err) {
    return true;
  }
  if (!left || !right || !left.version.length || !right.version.length) return true;
  return left.version.join('.') === right.version.join('.');
}

function money(value) {
  return Number.isInteger(value) ? '$' + value : '$' + value.toFixed(2);
}

// A newer model in the SAME family at a lower price is the cheapest saving
// there is: no step down in tier, nothing given up, only the price. The advice
// channel above only ever says "choose lower"; this says "choose newer", once
// per session (brief.js keeps the count), and only from prices on record.
//
// What the user can do differs by host, and the sentence says only what is
// real where it is read. In Claude Code, `/model <id>` switches the session and
// saves the model as the default for new sessions (the picker's `s` key is the
// this-session-only form), per code.claude.com/docs/en/model-config, read
// 2026-09-25. A subagent with no model of its own falls through to the main
// conversation's model (docs/en/sub-agents, same day), so a switch reaches
// those from their next dispatch. Codex has no /model of that kind, so there
// the only lever named is its config.
//
// The payback figure is exact arithmetic on the two rows, not an estimate of
// the session: switching costs one write of the context at the new model's
// write price instead of one read at the old read price, and every later turn
// saves the difference in read price on that context. The context size cancels
// out of the ratio, so the number of turns holds for any session. It counts the
// reads alone; the cheaper input and output only shorten it.
function newerModelAdvice(tier, options) {
  const opts = options || {};
  if (!tier) return null;
  const usage = opts.usage || require('./usage.js');
  if (typeof usage.newerSibling !== 'function') return null;
  const base = tier.baseline || {};
  const run = tier.running || {};
  const hostName = opts.host || host.CLAUDE;
  // A bound the user set outranks the price: nothing said points outside it.
  const sibling = (model) => {
    const found = model ? usage.newerSibling(model) : null;
    return found && allows(opts.bounds, { model: found.to }) ? found : null;
  };
  const current = run.model || base.model;
  const found = sibling(current);
  // The relay resumes with its own --model when one is set (wake.js), so a
  // session moved to the newer model still wakes on the old one. Claude Code
  // only: that is where `relay model` feeds a Claude CLI.
  const relayFound = hostName === host.CLAUDE && opts.relayModel ? sibling(opts.relayModel) : null;
  if (!found && !relayFound) return null;

  const name = (family, version) => family.charAt(0).toUpperCase() + family.slice(1) + ' ' + version.join('.');
  const pct = (was, now) => Math.round((1 - now / was) * 100);
  const prices = (pair) => {
    const a = pair.fromRate;
    const b = pair.toRate;
    const bits = [];
    if (b.input < a.input || b.output < a.output) {
      bits.push(money(b.input) + '/' + money(b.output) + ' per million tokens in and out against ' + money(a.input) + '/' + money(a.output));
    }
    if (b.cacheRead < a.cacheRead) {
      bits.push('cache reads ' + money(b.cacheRead) + ' against ' + money(a.cacheRead) + ', ' + pct(a.cacheRead, b.cacheRead) +
        '% less on the reads that are most of what a long session spends');
    }
    return bits.join('; ');
  };
  const family = (pair) => pair.family.charAt(0).toUpperCase() + pair.family.slice(1);

  const sentences = [];
  if (found) {
    const a = found.fromRate;
    const b = found.toRate;
    sentences.push(name(found.family, found.toVersion) + ' is a newer ' + family(found) + ' at a lower price than the ' +
      name(found.family, found.fromVersion) + ' running here. At first-party API prices: ' + prices(found) +
      '. Same tier and a newer release, so no step down.');
    const pinnedAlready = base.model && String(base.model).toLowerCase().replace(/\[[^\]]*\]\s*$/, '').trim() === found.to;
    if (hostName === host.CLAUDE) {
      sentences.push('It is the user\'s switch, not yours: offer `/model ' + found.to + '`, which moves this session and saves it as the ' +
        'default for new sessions' + (pinnedAlready ? ' (settings.json already names it, so new sessions start on it either way)' : '') +
        '. Subagents given no model of their own (and no CLAUDE_CODE_SUBAGENT_MODEL) run on the session\'s model, so they follow from their next dispatch.');
      // Only where the switch can be made mid-session is its one-off cost
      // worth a number; elsewhere the offer is a pin for new sessions, which
      // rebuild anyway.
      if (b.cacheRead < a.cacheRead) {
        const turns = (write) => Math.ceil(Math.round(((write * b.input - a.cacheRead) / (a.cacheRead - b.cacheRead)) * 100) / 100);
        sentences.push('Switching rebuilds the prompt cache once; the cheaper reads alone repay that in about ' + turns(1.25) +
          ' turns (' + turns(2) + ' on the one-hour cache).');
      } else {
        sentences.push('Switching rebuilds the prompt cache once, so on a large context it is worth making at the next session start rather than now.');
      }
    } else if (hostName === host.CODEX) {
      sentences.push('It is the user\'s setting, not yours: offer pinning model = "' + found.to + '" in config.toml for new sessions.');
    } else {
      sentences.push('It is the user\'s setting, not yours: offer choosing ' + found.to + ' in this host\'s own model setting.');
    }
  }
  if (relayFound) {
    const same = found && found.to === relayFound.to && found.from === relayFound.from;
    sentences.push('Relay wakes are pinned to ' + opts.relayModel + ' on their own' +
      (same ? '' : ', and ' + name(relayFound.family, relayFound.toVersion) + ' is a newer ' + family(relayFound) +
        ' at a lower price (' + prices(relayFound) + ')') +
      ', so a resumed run starts on the older model even after this session switches: offer `/usage-limits:relay model ' + relayFound.to +
      '`, which is the user\'s setting too.');
  }
  const id = (found ? found.from + '->' + found.to : '') + (relayFound ? '|relay:' + relayFound.from + '->' + relayFound.to : '');
  return {
    id,
    from: found ? found.from : null,
    to: found ? found.to : null,
    relay: relayFound ? { from: relayFound.from, to: relayFound.to } : null,
    text: sentences.join(' '),
  };
}
// One clause for the brief, or two lines for `--baseline`.
//
// Where the baseline and the running tier agree there is nothing interesting
// to say, so it says it once. Where they differ, THAT is the story, and it is
// the whole reason the line exists: a turn that opened with the window and
// never said what tier was producing it was hiding the number that decides
// what the turn costs.
function tierLine(tier, options) {
  const opts = options || {};
  if (!tier) return null;
  const base = tier.baseline || {};
  const run = tier.running || {};
  const runningText = [modelLabel(run.model) || modelLabel(base.model), run.effort || base.effort].filter(Boolean).join('/');
  if (!runningText) return null;
  const baseText = [modelLabel(base.model), base.effort].filter(Boolean).join('/');
  const differs =
    baseText && runningText !== baseText &&
    (!sameModel(run.model || base.model, base.model) || (run.effort || base.effort) !== base.effort);
  const source = run.source ? ' (' + run.source + ')' : '';
  if (opts.terse) {
    return differs ? runningText + source + ', yours ' + baseText : runningText + source;
  }
  // Reporting the tier is not the same as deciding about it.
  //
  // This line has always said what is running and left it there, and the
  // observed result is that the tier is simply never revisited: a session opens
  // on the dearest model at the dearest effort and stays there through work
  // that did not need either. Saying the number is not a prompt to act on it.
  //
  // So when the tier IS an expensive one, the line asks for a decision rather
  // than leaving a fact lying around. Only then: on a cheap tier there is
  // nothing to decide, and a sentence asking every turn would be exactly the
  // per-turn cost this plugin exists to avoid.
  //
  // Deliberately names no slash command. /model and /effort do not exist in
  // Codex, and telling Codex to run them is telling it to do nothing while
  // believing it acted - the mistake levers() already exists to prevent.
  const dear = topTier(run.model || base.model, run.effort || base.effort);
  // What the plugin can actually do about the tier, stated exactly.
  //
  // Nothing in a hook, a tool or the SDK can change a running session's model
  // or effort - that was researched to the primary sources on 2026-09-14 and
  // the answer is a flat no. /model and /effort are the user's, by design. So
  // the most honest thing this line can do is name the decision and, where it
  // is cheap, say so: on Fable 5.1 on a subscription an /effort change keeps
  // the prompt cache (prompt-caching doc, v2.1.260+), which makes stepping
  // effort down mid-session free. On every other model it rebuilds the cache,
  // and on a large context that can cost more than a few cheaper turns save -
  // so there the advice is to choose at the START of a session.
  const onFable = sameFamily(run.model || base.model, 'fable');
  const decide = dear
    ? ' Decide in one line whether the work in front of you needs ' + runningText + '.' +
      (onFable
        ? ' On Fable 5.1 an /effort change keeps the cache, so if the next stretch is mechanical, /effort low now costs nothing.'
        : ' Changing effort or model mid-session rebuilds the cache, so if it does not, say so and choose lower at the next session start rather than switching now.')
    : '';
  return differs
    ? 'Running ' + runningText + source + '; your baseline is ' + baseText + '. The gap is the ' +
      'interesting part: your baseline is yours and is not being changed.' + decide
    : 'Running ' + runningText + source + '.' + decide;
}

// Whether this tier is dear enough to be worth a decision. Opus or above, or an
// effort at or above xhigh; either alone is enough to be worth asking.
//
// MODEL_ORDER runs CHEAPEST first - haiku, sonnet, opus, mythos, fable - so the
// dear end is a HIGH rank, not a low one. Getting that backwards asked haiku to
// justify itself and let opus through silently, which is the exact inverse of
// the point.
function topTier(model, effort) {
  const rank = modelRank(model);
  const dearModel = rank !== null && rank >= MODEL_ORDER.indexOf('opus');
  const dearEffort = ['xhigh', 'max', 'ultra', 'ultracode'].includes(String(effort || '').toLowerCase());
  return dearModel || dearEffort;
}

// ---------------------------------------------------------------------------
// The ledger
//
// Modes are evidence, not vibes. The measurement lives in drift.js, which
// already has the bounded-append pattern and a file of its own; a second store
// for the same kind of after-the-fact measurement would be a second thing to
// keep correct.
function ledger(now) {
  const drift = require('./drift.js');
  const codexHome = host.detect(process.argv.slice(2), process.env) === host.CODEX ? codex.homeDir() : null;
  const rows = drift.modeSummary(codexHome);
  if (!rows.length) return 'Mode ledger: nothing measured yet. It fills in as replies land in each mode.';
  const lines = ['Measured cost per mode:'];
  for (const row of rows) {
    lines.push(
      '  ' + row.mode.padEnd(9) + String(row.turns).padStart(4) + ' turns   ' +
        (Number.isFinite(row.usdPerTurn) ? '$' + row.usdPerTurn.toFixed(2) + '/turn' : 'no price')
    );
  }
  lines.push('');
  lines.push('Observed, not predicted: what replies actually cost while each mode was on.');
  // Said rather than left to be noticed: `off` returns before the Stop hook
  // reads anything, so it has no rows here and never will. A mode that
  // injects nothing has no injection to attribute a cost to.
  if (!rows.some((row) => row.mode === 'off')) {
    lines.push('`off` never appears: its hooks return before the reply is measured.');
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Rendering

// The mode's full record, in two halves that are not the same kind of fact.
//
// The first half is what the plugin DOES: every field here is read by a named
// script, and changing it changes behaviour. The second is the mode's stance
// towards the agent, which has no effect except through the directive - so
// when there is no directive it is said plainly that nothing carries it. The
// old version printed both under one heading, which reported five fields as
// behaviour when nothing anywhere read them.
function explain(name) {
  const policy = MODES[name];
  if (!policy) return 'No such mode: ' + name + '. Try one of: ' + ORDER.join(', ') + '.';
  const text = DIRECTIVES[name];
  const lines = [name + ' - ' + policy.summary, '', '  What the plugin does (read by the scripts named):'];
  for (const key of Object.keys(policy)) {
    if (!WIRED[key]) continue;
    lines.push('    ' + key.padEnd(20) + String(policy[key]).padEnd(10) + WIRED[key]);
  }
  const stance = Object.keys(policy).filter((key) => key !== 'name' && key !== 'summary' && key !== 'directive' && !WIRED[key]);
  if (stance.length) {
    lines.push('');
    lines.push(
      text
        ? '  What the mode asks of the agent. Nothing reads these fields; they reach'
        : '  What the mode asks of the agent. Nothing reads these fields, and this mode'
    );
    lines.push(text ? '  the agent only by being restated in the directive below:' : '  has no directive, so nothing carries them - they describe intent only:');
    for (const key of stance) lines.push('    ' + key.padEnd(20) + String(policy[key]));
  }
  lines.push('');
  lines.push(text ? '  Directive, injected verbatim:' : '  Directive: none. ' + (name === 'off' ? 'Nothing is injected at all.' : 'The line is what it is today.'));
  if (text) lines.push('    ' + text);
  return lines.join('\n');
}

function list(decided) {
  const lines = ['Budget modes:', ''];
  for (const name of ORDER) {
    const policy = MODES[name];
    const here = decided && decided.name === name ? ' <- current' : '';
    lines.push('  ' + name.padEnd(9) + policy.summary + here);
  }
  lines.push('');
  lines.push('Aliases: ' + Object.keys(ALIASES).sort().join(', ') + '.');
  lines.push('"normal" is deliberately not an alias: it means opposite things to different people.');
  return lines.join('\n');
}

function describe(decided, now) {
  const lines = [];
  lines.push('Mode: ' + decided.label + ' (from ' + decided.source + ')');
  lines.push('  ' + decided.policy.summary);
  lines.push('');
  lines.push('  brief         ' + decided.policy.briefStyle + (decided.policy.briefWhenUnchanged ? '' : ', silent when nothing moved'));
  lines.push('  readings      ' + (decided.policy.refreshSeconds ? 'every ' + decided.policy.refreshSeconds + 's' : 'none: the hooks return before reading anything'));
  if (decided.policy.recheckSeconds) lines.push('  recheck       every ' + decided.policy.recheckSeconds + 's, mid-turn');
  lines.push('  subagents     ' + decided.policy.subagents);
  lines.push('  workflows     ' + decided.policy.workflows);
  if (decided.guardPercent !== null && decided.guardPercent !== undefined) {
    lines.push('  guard         one line at ' + decided.guardPercent + '% used, and nothing else');
  }
  const note = boundsNote(decided.bounds);
  if (note) lines.push('  bounds        ' + note.replace('Bounds the user set: ', ''));
  if (decided.advice && decided.advice.off) lines.push('  advice        off');
  lines.push('');
  lines.push('  It governs the agent plane only. Your settings.json is never written by this.');
  lines.push('  File: ' + modeFile());
  if (decided.state && decided.state.unreadable) {
    lines.push('');
    lines.push('  That file exists but could not be read, so the mode above is the default');
    lines.push('  rather than anything you chose. Setting it again rewrites it.');
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// CLI

function setMode(name, opts, now) {
  const state = read();
  const before = state.auto ? 'auto' : state.mode;
  const at = Number.isFinite(now) ? now : Date.now();
  if (opts && opts.session) {
    if (!opts.sessionId) {
      return 'A session override needs the session id. Run it with --session-id <id>, or set it for good with: mode ' + name;
    }
    state.session = { id: opts.sessionId, mode: name, at };
    write(state);
    logChange({ plane: 'mode', key: 'mode', from: before, to: name, by: 'user', reason: 'session override', scope: 'session', sessionId: opts.sessionId }, at);
    return 'Mode ' + name + ' for this session only. The persisted mode is still ' + state.mode + '.';
  }
  // A live session override outranks the file, so setting the mode globally
  // while one is in force changed nothing at all for the session that typed
  // the command - and the reply named a directive that would never appear.
  // Setting the mode outright is the user saying what the mode is now, so the
  // override goes, and it is said rather than done quietly.
  const cleared = state.session;
  state.session = null;
  state.mode = name;
  state.auto = false;
  state.setAt = at;
  state.setBy = 'user';
  if (opts && Number.isFinite(opts.guard)) state.guardPercent = opts.guard;
  if (opts && Number.isFinite(opts.ceiling)) {
    state.ceilingPercent = opts.ceiling;
    state.ceilingSession = opts.sessionId || null;
  }
  write(state);
  logChange({ plane: 'mode', key: 'mode', from: before, to: name, by: 'user', reason: null }, at);

  const policy = MODES[name];
  const lines = ['Mode ' + name + ': ' + policy.summary + '.'];
  if (cleared && cleared.mode) {
    lines.push(
      'The session override (' + cleared.mode + ') was cleared, so this takes effect ' +
        'in that session too.'
    );
  }
  if (name === 'off') {
    // off means off, including at 100 per cent. That is what was asked and it
    // is honoured literally. But a silent cutoff at the wall is the exact
    // failure this plugin exists to prevent, so the consequence is stated once
    // - and the way to keep one line is offered rather than imposed.
    lines.push('off: nothing will be injected, including at the wall.');
    // Said out loud because it is the one consequence a user would otherwise
    // discover by noticing something missing: the end-of-reply cost line and
    // the closing line are hooks too, and off stops them reading the
    // transcript at all. The panel stops animating for the same reason.
    lines.push(
      'That covers every hook: no end-of-reply cost line, no closing line, and ' +
        'the live panel will not animate, because nothing runs to tell it anything.'
    );
    if (state.guardPercent === null || state.guardPercent === undefined) {
      lines.push('Run "mode off --guard 95" if you want one short line when the window is nearly spent.');
    } else {
      lines.push('The guard is set: one short line at ' + state.guardPercent + '% used, and nothing else.');
    }
  } else {
    const text = DIRECTIVES[name];
    if (text) lines.push('From the next prompt, this goes in front of the work: ' + text);
  }
  return lines.join('\n');
}

function main(argv) {
  const args = (argv || []).slice();
  const now = Date.now();
  const flag = (name) => args.indexOf(name) !== -1;
  const value = (name) => {
    const at = args.indexOf(name);
    if (at === -1) return null;
    const next = args[at + 1];
    return next && next.indexOf('--') !== 0 ? next : null;
  };
  // CLAUDE_CODE_SESSION_ID is the one Claude Code actually exports;
  // CLAUDE_SESSION_ID never existed, so this read null and a cap set from the
  // command line could record no owner and therefore never bind.
  const sessionId = value('--session-id') || process.env.CLAUDE_CODE_SESSION_ID || process.env.CLAUDE_SESSION_ID || null;
  const decided = resolve({ sessionId });

  if (flag('--list')) return list(decided);
  if (flag('--explain')) return explain(String(value('--explain') || '').toLowerCase());
  if (flag('--ledger')) return ledger(now);
  if (flag('--history')) return history(now, Number(value('--history')) || 20);
  if (flag('--baseline')) {
    const tier = tierNow({ sessionId, now });
    const base = [tier.baseline.model, tier.baseline.effort].filter(Boolean).join('/') || 'not set';
    const run = [tier.running.model, tier.running.effort].filter(Boolean).join('/') || 'unknown';
    // Codex has no settings.json and no /model or /effort, so naming them
    // there is telling Codex to reach for controls it does not have. usage.js
    // is already scrupulous about this for the commands it prints; these two
    // lines were not.
    const codexHere = host.detect(process.argv.slice(2), process.env) === host.CODEX;
    return [
      'baseline  ' + base + '   (yours: ' +
        (codexHere ? 'config.toml and the /model picker' : 'settings.json and the pickers') +
        ', never written by this plugin)',
      'running   ' + run + (tier.running.source ? '   (' + tier.running.source + ')' : ''),
      '',
      'Changing the baseline applies to NEW sessions. For the one you are in, ' +
        (codexHere
          ? "Codex's own model and effort controls are the only lever."
          : 'the picker is the only lever.'),
    ].join('\n');
  }
  // What is pending, read off the record of what was actually offered.
  //
  // It used to call usage.settingFit(null, ...) - an event list of null, which
  // that function turns into [] and returns null from before it looks at
  // anything - so the answer was "nothing to recommend (no measurement)" on
  // every machine, including one with four thousand measured turns on disk.
  // The measurement is not this command's to take: it costs a transcript scan,
  // the brief has already paid for one, and what the brief offered is written
  // down. So this reads that.
  if (flag('--advice')) {
    const state = read();
    if (state.advice && state.advice.off) {
      return 'Recommendations are off (mode --advice-on turns them back on). Nothing is pending.';
    }
    const offer = adviceLastOffer(sessionId, state);
    if (!offer) {
      return 'Nothing has been offered yet. A recommendation is made from a measurement the ' +
        'briefing takes, so there is nothing to show until one has been.';
    }
    if (state.advice.declined && state.advice.declined[offer.id]) {
      return 'Nothing pending: "' + offer.id + '" was offered and declined, and will not be raised again.';
    }
    return (offer.text || 'Pending: ' + offer.id + '.') +
      '\nTo say no to it, and never see it again: mode --decline';
  }
  // Somebody has to be able to say no, or "a declined recommendation is never
  // raised again" is a promise with no way to keep it. This is the verb for
  // the moment the user says "no, leave it": it records the id and that
  // recommendation is never volunteered again, in this session or any later
  // one. With no id it declines whatever is currently pending.
  if (flag('--decline')) {
    const given = value('--decline');
    // Same fix as --advice, and it matters more here: this is the documented
    // way for the user to say no, and with the id taken from a settingFit()
    // call that could only ever return null, saying no recorded nothing and
    // the same recommendation came back in the next session.
    const id = given || (adviceLastOffer(sessionId) || {}).id || null;
    if (!id) return 'There is nothing pending to decline.';
    adviceDecline(id, now);
    logChange({ plane: 'mode', key: 'advice', from: id, to: 'declined', by: 'user', reason: null }, now);
    return 'Declined, and remembered: "' + id + '" will not be suggested again.';
  }
  if (flag('--no-advice')) {
    adviceMute(true);
    logChange({ plane: 'mode', key: 'advice', from: 'on', to: 'off', by: 'user', reason: null }, now);
    return 'Recommendations are off. Nothing will be suggested about your own settings again until: mode --advice-on';
  }
  if (flag('--advice-on')) {
    adviceMute(false);
    logChange({ plane: 'mode', key: 'advice', from: 'off', to: 'on', by: 'user', reason: null }, now);
    return 'Recommendations are back on, capped at one per session and never repeated once declined.';
  }
  // Whether the user has switched /low-priority on.
  //
  // This is a RECORD of something the user said, not a reading. Claude Code
  // keeps the live state in process memory and writes it nowhere - not to
  // ~/.claude.json, not to ~/.claude/state, and no hook payload or status-line
  // field carries it - so the plugin cannot know. What it can do is take the
  // user's word, stamp it with the window it belongs to, and let it lapse at
  // that window's reset, which is when low-priority ends anyway.
  //
  // Nothing else may write this. The model cannot type a slash command, so it
  // cannot have turned low-priority on, so it has nothing to acknowledge.
  if (flag('--low-priority')) {
    // Claude Code only, said plainly rather than by doing nothing. /low-priority
    // is a Claude Code slash command against a Claude account; recording it under
    // Codex or Antigravity would write a fact about the wrong agent's budget into
    // the wrong agent's config directory.
    const hostHere = host.detect(process.argv.slice(2), process.env);
    if (hostHere !== host.CLAUDE) {
      return '/low-priority is a Claude Code command and does not exist in ' +
        (hostHere === host.CODEX ? 'Codex' : 'Antigravity') +
        ', so there is nothing to record here. Use that host\'s own controls for the task in hand.';
    }
    const asked = String(value('--low-priority') || '').trim().toLowerCase();
    const account = lowpri.snapshot();
    const provisioned = lowpri.offer(account);
    const detail = provisioned.offered
      ? 'This account is provisioned for it (' + lowpri.FLAG + ' enabled' +
        (provisioned.version ? ', config version ' + provisioned.version : '') + '), though the ' +
        'offer itself also depends on an experiment arm that arrives in a response header, so it ' +
        'is not guaranteed to appear at every wall.'
      : provisioned.known
        ? 'This account is NOT provisioned for it right now (' + lowpri.FLAG + ' is present and disabled), ' +
          'so the wall will not offer it.'
        : 'Whether this account is provisioned for it is unknown: ' + lowpri.FLAG + ' has never been ' +
          'seen in the feature cache, which is the absence of a fact rather than the fact of an absence.';
    if (asked === 'on' || asked === 'yes' || asked === 'true') {
      // Stamp it with the 5-hour window it belongs to, so the fact lapses when
      // that window resets instead of steering the headroom maths for ever.
      let windowKey = null;
      let resetsAt = null;
      try {
        const usage = require('./usage.js');
        const windows = usage.snapshotWindows(usage.collect(now), now, null) || [];
        const five = windows.find((w) => w && w.key === 'five_hour');
        // Only a reset still ahead. A stale snapshot carries the reset of a
        // window that has already rolled over, and stamping that on the record
        // printed "Recorded ... lapses at" a time already gone - and the very
        // next read found it spent, so the statement vanished. The next reset
        // is unknown then, and the record takes the five-hour ceiling instead.
        if (five && Number.isFinite(five.resetsAt) && five.resetsAt > now) {
          windowKey = 'five_hour';
          resetsAt = five.resetsAt;
        }
      } catch (err) {
        // No reading is not a reason to refuse the user's own statement; the
        // record simply has no expiry to hang on.
      }
      const written = lowpri.acknowledge({ on: true, windowKey, resetsAt, now });
      // A write that did not happen is never reported as one. With a directory
      // sitting where the state file goes this said "Recorded" and the next
      // brief behaved as though nothing had been said.
      if (!written.saved) {
        return [
          'NOT recorded: ' + written.file + ' could not be written, so nothing was saved and the ' +
            'brief will go on treating the 5-hour window as a real wall.',
          '',
          'Check that the path is a writable file and not a directory, then run this again.',
        ].join('\n');
      }
      logChange({ plane: 'mode', key: 'low-priority', from: 'unknown', to: 'on', by: 'user', reason: null }, now);
      return [
        'Recorded: you have switched /low-priority on.',
        '',
        'From here the brief brakes on your WEEKLY window rather than the 5-hour one, stops telling ' +
          'you to wind down at the 5-hour wall, says replies may pause while lower priority waits for ' +
          'spare capacity, and will not book a relay wake for the 5-hour reset - that reset is no ' +
          'longer a wall this session stops at.',
        '',
        'What it costs, in Anthropic\'s own words: it uses your weekly limit, and it draws on a ' +
          'separate weekly lower-priority allowance whose size is exposed to no hook and no file, so ' +
          'the plugin cannot track it. Nothing here can tell whether it is still on, so when you ' +
          'turn it off: mode --low-priority off',
        '',
        resetsAt
          ? 'This lapses on its own at ' + new Date(resetsAt).toLocaleString() + ', when the 5-hour window resets.'
          : 'No 5-hour reset time was readable, so this lapses at ' +
            new Date(now + lowpri.ACK_MAX_MS).toLocaleString() + ' instead - five hours, the length of ' +
            'the window the toggle belongs to, which is the longest it could honestly still be true. ' +
            'Run /usage and set it again if it is still on then.',
        '',
        detail,
      ].join('\n');
    }
    if (asked === 'off' || asked === 'no' || asked === 'false') {
      const had = lowpri.readAck(now);
      const cleared = lowpri.acknowledge({ on: false, now });
      // The same rule as "on": a clear that did not reach the file is not
      // reported as one, because the record it failed to remove still steers
      // the brief at the weekly.
      if (had && !cleared.saved) {
        return 'NOT cleared: ' + cleared.file + ' could not be written, so the acknowledgement is still ' +
          'there and the brief will go on braking on the weekly until it lapses at ' +
          new Date(had.expiresAt).toLocaleString() + '. Check that the file is writable, then run this again.';
      }
      logChange({ plane: 'mode', key: 'low-priority', from: had ? 'on' : 'unknown', to: 'off', by: 'user', reason: null }, now);
      return had
        ? 'Cleared: low-priority is off again, so the 5-hour window counts as a wall from the next prompt.'
        : 'Nothing was recorded, so there was nothing to clear. Low-priority is off as far as this plugin knows.';
    }
    if (asked) {
      return 'mode --low-priority takes "on" or "off". Say which; this is a record of what YOU did, so it is never guessed.';
    }
    const ack = lowpri.readAck(now);
    const wrap = lowpri.wrapUp(account);
    const auto = lowpri.autoContinue();
    return [
      // readAck drops a record with no usable timestamp, so there is no longer
      // a path that prints "at Invalid Date" here, and the expiry is always a
      // real time: the window's reset, or five hours from the statement.
      ack
        ? 'You have acknowledged low-priority ON, at ' + new Date(ack.at).toLocaleString() +
          (Number.isFinite(ack.expiresAt)
            ? ', lapsing at ' + new Date(ack.expiresAt).toLocaleString() +
              (ack.expiryKnown ? ' when the 5-hour window resets' : ' (no reset time was readable, so this is five hours from the statement)')
            : '') + '.'
        : 'Low-priority has not been acknowledged, so the plugin treats the 5-hour window as a real wall.',
      '',
      'It is a toggle you type yourself. The model cannot run a slash command, and /low-priority is ' +
        'declared supportsNonInteractive:false, so it is unusable in a headless or relayed run as well.',
      '',
      detail,
      '',
      'Claude Code will ' + (wrap.hostWrapsUp ? '' : 'NOT ') + 'inject its own wrap-up note at the wall on ' +
        'this machine (' + lowpri.WRAPUP_MODE_FLAG + ' is "' + wrap.mode + '")' +
        (wrap.textProvisioned && !wrap.hostWrapsUp ? ', although the note text is provisioned' : '') + '.',
      'Claude Code\'s own continue-after-reset is ' + (auto.value ? 'ON' : 'OFF') + ' (' + auto.source + ').',
      '',
      'To set it: mode --low-priority on   /   mode --low-priority off',
    ].join('\n');
  }
  if (flag('--pin') || flag('--no-pin')) {
    const state = read();
    const before = state.pin;
    state.pin = flag('--pin');
    write(state);
    logChange({ plane: 'mode', key: 'pin', from: before, to: state.pin, by: 'user', reason: null }, now);
    return state.pin
      ? 'Pinned. Nothing will self-switch: the gap between your baseline and what is running is reported and left alone.'
      : 'Unpinned. Self-switching is back to what the mode says.';
  }
  // The bounds, and the answer for each one asked for.
  //
  // Returned as a list rather than straight out of the loop, because this ran
  // BEFORE the positional argument was looked at: `mode max --floor sonnet`
  // set the floor, said so, and returned - leaving the mode untouched and
  // unmentioned. The user asked for two things and was told about one.
  const boundLines = [];
  for (const key of ['--floor', '--ceiling']) {
    if (!flag(key)) continue;
    const raw = value(key);
    const field = key.slice(2);
    const state = read();
    const before = tierText(state[field]);
    if (!raw || raw === 'none' || raw === 'off') {
      state[field] = null;
      write(state);
      logChange({ plane: 'mode', key: field, from: before, to: null, by: 'user', reason: null }, now);
      boundLines.push('The ' + field + ' is cleared.');
      continue;
    }
    const tier = parseTier(raw);
    if (!tier || tier.error) {
      return 'Could not read a tier from "' + raw + '": ' + ((tier && tier.error) || 'nothing recognised') + '. Try sonnet/medium.';
    }
    state[field] = tier;
    write(state);
    logChange({ plane: 'mode', key: field, from: before, to: tierText(tier), by: 'user', reason: null }, now);
    const caveat = thinkingCaveat(tier);
    boundLines.push(
      'The ' + field + ' is ' + tierText(tier) + '. Nothing the plugin says will point ' +
        (field === 'floor' ? 'below' : 'above') + ' it.' + (caveat ? '\nNote: ' + caveat : '')
    );
  }

  const first = String(args[0] || '').toLowerCase();
  if (first === 'undo') return undo(now).text;
  if (first === 'auto') {
    const state = read();
    const before = state.auto;
    const off = String(args[1] || '').toLowerCase() === 'off';
    state.auto = !off;
    write(state);
    logChange({ plane: 'mode', key: 'auto', from: before, to: state.auto, by: 'user', reason: null }, now);
    if (off) return 'auto is off. The mode is ' + state.mode + ' until you change it.';
    return [
      'auto is on. It picks from pressure and always reports which one it picked:',
      '  under 50% used and roomy   -> standard',
      '  50 to 79                   -> high',
      '  80+, or tight or gone      -> max',
      'It never picks off. Turning the plugin off is a decision a person makes.',
    ].join('\n');
  }
  if (first && first.indexOf('--') !== 0) {
    const named = normalise(first);
    if (!named) return 'No such mode: ' + first + '.\n\n' + list(decided);
    if (named.ambiguous) return named.message;
    if (named.auto) return main(['auto'].concat(args.slice(1)));
    const guard = guardValue(args, flag, value);
    if (guard.error) return guard.error;
    const ceilingArg = ceilingValue(args, flag, value);
    if (ceilingArg.error) return ceilingArg.error;
    const set = setMode(named.mode, {
      session: flag('--session'),
      sessionId,
      guard: guard.percent,
      ceiling: ceilingArg.percent,
    }, now);
    if (ceilingArg.clear) clearCeiling(now);
    const lines = [set];
    if (ceilingArg.percent !== undefined || ceilingArg.clear) lines.push(ceilingLine());
    return lines.concat(boundLines).join('\n');
  }

  // The usage cap on its own, without changing the mode.
  //
  // Spelled --cap, NOT --ceiling: this file already uses --ceiling for the
  // model/effort bound ("never go above opus/xhigh"), and taking that spelling
  // swallowed it - mode --ceiling opus/xhigh started answering "could not read a
  // percentage". The two are unrelated
  // settings: the mode says how loudly the plugin talks, the ceiling says where
  // it stops the work.
  if (flag('--cap')) {
    const ceilingArg = ceilingValue(args, flag, value);
    if (ceilingArg.error) return ceilingArg.error;
    const state = read();
    const previous = state.ceilingPercent;
    if (flag('--always')) {
      state.ceilingAlways = ceilingArg.clear ? null : ceilingArg.percent;
    }
    state.ceilingPercent = ceilingArg.clear ? null : ceilingArg.percent;
    state.ceilingSession = ceilingArg.clear ? null : sessionId;
    write(state);
    logChange(
      { plane: 'mode', key: 'ceiling', from: previous, to: state.ceilingPercent, by: 'user', reason: null },
      now
    );
    return ceilingLine();
  }

  if (boundLines.length) return boundLines.join('\n');
  return describe(decided, now);
}

function clearCeiling(now) {
  const state = read();
  const previous = state.ceilingPercent;
  state.ceilingPercent = null;
  state.ceilingSession = null;
  state.ceilingAlways = null;
  write(state);
  logChange({ plane: 'mode', key: 'ceiling', from: previous, to: null, by: 'user', reason: null }, now);
}

// What the ceiling is now, and what it will actually do. Said in terms of the
// refusal, because a percentage on its own does not tell anyone what changes.
function ceilingLine() {
  const state = read();
  if (Number.isFinite(state.ceilingAlways)) {
    return (
      'Standing cap ' + state.ceilingAlways + '%, for this and every future session on this ' +
      'machine, including after a limit resets. Past it, fan-out calls are refused at the hook; ' +
      'nothing else is blocked. "mode --cap off --always" removes it.'
    );
  }
  if (state.ceilingPercent === null || state.ceilingPercent === undefined) {
    return 'Ceiling off. Nothing is refused; the plugin reports and does not intervene.';
  }
  return (
    'Cap ' + state.ceilingPercent + '%' + (state.ceilingSession ? ', for THIS session only' : ' (stored against no session, so it is ignored - set it again to apply it here)') +
    '. Past that, fan-out calls (Agent, Task, Workflow and ' +
    'their equivalents) are refused at the hook. Nothing else ' +
    'is blocked, so the work still finishes - sequentially, in one session, which is where the ' +
    'saving comes from. It lapses when this session ends; "mode --cap off" removes it now.'
  );
}

// The ceiling percentage, or the reason it was refused. Same validation as the
// guard, and for the same reason: a number accepted without being read is a
// setting that silently does the opposite of what was asked.
//
// A ceiling differs from the guard in one way - "off" is a meaningful value,
// because a ceiling is the one setting here that takes something away, and
// taking it back has to be as easy as setting it.
function ceilingValue(args, flag, value) {
  if (!flag('--cap')) return { percent: undefined, clear: false };
  const token = value('--cap');
  if (token === null) {
    return { error: '--cap needs a percentage or "off", for example: mode --cap 60' };
  }
  const text = String(token).trim().toLowerCase();
  if (text === 'off' || text === 'none' || text === 'no') return { percent: undefined, clear: true };
  const raw = Number(text.replace(/%$/, ''));
  if (!Number.isFinite(raw)) {
    return { error: 'Could not read a percentage from "' + token + '". Try: mode --cap 60' };
  }
  if (raw < 1 || raw > 100) {
    return {
      error:
        'The ceiling is a percentage of a window, so it has to be between 1 and 100. ' +
        (raw > 100
          ? String(raw) + ' can never be reached, so nothing would ever be refused.'
          : String(raw) + ' would refuse every fan-out from the start of the window.'),
    };
  }
  return { percent: raw, clear: false };
}

// The guard percentage, or the reason it was refused.
//
// Three ways this went wrong and all three are the same shape - a number that
// was accepted without being read.
//
//   `mode off --guard` with no value: value() returns null when the next token
//   is missing, and Number(null) is 0, which is finite. That stored a guard of
//   zero, which fires on every prompt at any usage - the exact opposite of
//   what "off" was asked for, and described in the reply as "one short line at
//   0% used".
//
//   `--guard 500`: never fires, so the user asked for a line at the wall and
//   silently has none. That is the one scenario the guard exists for.
//
//   `--guard 0`: a line on every prompt, as above.
//
// A percentage of a window is a number between 1 and 100. Anything else is
// refused with the reason, because a guard that silently does nothing is worse
// than no guard at all.
function guardValue(args, flag, value) {
  if (!flag('--guard')) return { percent: undefined };
  const token = value('--guard');
  if (token === null) {
    return { error: '--guard needs a percentage, for example: mode off --guard 95' };
  }
  const raw = Number(token);
  if (!Number.isFinite(raw)) {
    return { error: 'Could not read a percentage from "' + token + '". Try: mode off --guard 95' };
  }
  if (raw < 1 || raw > 100) {
    return {
      error:
        'The guard is a percentage of a window, so it has to be between 1 and 100. ' +
        (raw > 100
          ? String(raw) + ' can never be reached, so the line would never appear.'
          : String(raw) + ' is reached immediately, so the line would appear on every prompt.'),
    };
  }
  return { percent: raw };
}

if (require.main === module) {
  try {
    process.stdout.write(main(process.argv.slice(2)) + '\n');
  } catch (err) {
    process.stdout.write('mode: ' + err.message + '\n');
  }
  process.exit(0);
}

module.exports = {
  MODES,
  ORDER,
  WIRED,
  ALIASES,
  AMBIGUOUS,
  DIRECTIVES,
  DEFAULT_MODE,
  EFFORT_ORDER,
  MODEL_ORDER,
  THINKING_ONLY_EFFORTS,
  KEEP_CHANGES,
  KEEP_DECLINED,
  configDir,
  modeFile,
  changesFile,
  empty,
  read,
  write,
  normalise,
  ambiguityText,
  parseTier,
  tierText,
  effortRank,
  modelRank,
  allows,
  boundsNote,
  thinkingCaveat,
  directive,
  autoPick,
  readingNow,
  resolve,
  forSession,
  readChanges,
  logChange,
  lastUndoable,
  history,
  undo,
  adviceId,
  advicePending,
  adviceOffer,
  adviceLastOffer,
  adviceDecline,
  adviceMute,
  tierNow,
  ultracodeName,
  topTier,
  tierLine,
  modelLabel,
  sameModel,
  newerModelAdvice,
  ledger,
  explain,
  list,
  describe,
  setMode,
  guardValue,
  main,
};
