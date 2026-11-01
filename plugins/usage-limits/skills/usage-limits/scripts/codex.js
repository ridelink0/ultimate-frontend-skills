'use strict';

// The Codex reader.
//
// Codex turns out to keep both of the things this plugin needs in one place.
// Every session writes a rollout under ~/.codex/sessions, one JSON object per
// line, and each model request appends a `token_count` event carrying:
//
//   info.last_token_usage   what that request cost, in tokens
//   rate_limits             the account meter, as percentages with reset times
//
// So the rollouts are Claude's ~/.claude.json and ~/.claude/projects at once:
// the newest `rate_limits` is the snapshot, and the `last_token_usage` records
// are the pace. That means the window arithmetic in usage.js works unchanged;
// only the two readers below are different.
//
// Reading files is the fast path and costs nothing. `refresh()` asks Codex
// itself for a live reading, which takes about a second and starts a child
// process, so it is reserved for the times the newest rollout has gone stale.

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');

const atomic = require('./atomic.js');
const host = require('./host.js');

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// Codex reports up to two windows, a primary and a secondary, and which of them
// exist is a property of the plan rather than a constant.
//
// Plus and Pro both get the five-hour window, and a weekly one "may apply" on
// top. Enterprise and Edu on flexible pricing get neither: usage scales with
// credits instead, so the account reports no rolling window at all. Business
// tiers have been seen reporting none as well. And it moves: the five-hour
// window was withdrawn from Plus and later reinstated.
//
// So nothing here is assumed. A slot the payload does not carry produces no
// window, the length of a window comes from the payload, and the key it is
// filed under is derived from that length rather than from which slot it
// arrived in. Filing a seven-day window under `five_hour` because it happened
// to be the primary would price a point of one window with the cost of another.
const SLOTS = [
  { slot: 'primary', span: 5 * HOUR },
  { slot: 'secondary', span: 7 * DAY },
];

// Tokens are not all worth the same, and the meter is moved by what they cost
// rather than by how many there are. These weights are relative, not money:
// what matters downstream is only the ratio between the classes, because the
// calibration step divides the total by the meter's own percentage and so
// cancels the scale out. Output is the dear one, cached input the cheap one.
const WEIGHTS = { input: 1, cached: 0.1, cacheWrite: 1.25, output: 8 };

// What each plan means for how careful to be. Which windows a plan actually
// gets is never taken from here: that is read from the payload, because it
// differs by plan and has changed more than once. This is only the advice.
const POOLED =
  'Seats are pooled and the allowance is a workspace setting. Confirm headroom ' +
  'with whoever administers it before planning a long job around these numbers.';

const PLANS = {
  free: {
    label: 'ChatGPT Free',
    advice:
      'Free has the least room of any plan, and whichever window it reports ' +
      'will bind almost at once. Do one thing at a time and land it.',
  },
  go: {
    label: 'ChatGPT Go',
    advice:
      'Go sits just above Free. Expect the shorter window to bind first and ' +
      'size the job before starting it.',
  },
  plus: {
    label: 'ChatGPT Plus',
    advice:
      'Plus has room for ordinary work, but a long agentic run will find the ' +
      'five-hour window well before the weekly one. Size the job first.',
  },
  prolite: {
    label: 'ChatGPT Pro Lite',
    advice: 'Pro Lite has more room than Plus. Watch whichever window is reported as higher.',
  },
  pro: {
    label: 'ChatGPT Pro',
    advice:
      'Pro has the five-hour window too, with far more in it. It rarely binds, ' +
      'but a heavy day still reaches it, so do not assume it cannot.',
  },
  business: { label: 'ChatGPT Business', advice: POOLED },
  self_serve_business_prolite: { label: 'ChatGPT Business', advice: POOLED },
  self_serve_business_usage_based: {
    label: 'ChatGPT Business',
    advice:
      'This workspace is billed by usage rather than capped, so the limit is ' +
      'cost rather than a window. Watch the credits, not a percentage.',
  },
  team: { label: 'ChatGPT Team', advice: POOLED },
  enterprise: { label: 'ChatGPT Enterprise', advice: POOLED },
  ent26: { label: 'ChatGPT Enterprise', advice: POOLED },
  enterprise_cbp_automation: { label: 'ChatGPT Enterprise', advice: POOLED },
  enterprise_cbp_usage_based: {
    label: 'ChatGPT Enterprise',
    advice:
      'On flexible pricing there is no rolling window at all: usage scales ' +
      'with credits, so the credit balance is the budget to plan against.',
  },
  edu: { label: 'ChatGPT Edu', advice: POOLED },
  edu_plus: { label: 'ChatGPT Edu', advice: POOLED },
  edu_pro: { label: 'ChatGPT Edu', advice: POOLED },
};

function homeDir() {
  return host.codexHome();
}

function sessionsDir() {
  return path.join(homeDir(), 'sessions');
}

// ---------------------------------------------------------------------------
// Finding codex itself
// ---------------------------------------------------------------------------

// The Codex desktop app does not put codex.exe on PATH. It installs it under a
// content-hashed directory that changes with every update, which is why the
// first port of this reader could never find it and reported "not signed in" on
// a machine that was signed in. Look where it actually lives, newest first.
function windowsCandidates() {
  const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const root = path.join(local, 'OpenAI', 'Codex', 'bin');
  let names = [];
  try {
    names = fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch (err) {
    return [];
  }

  const found = [];
  for (const name of names) {
    const file = path.join(root, name, 'codex.exe');
    try {
      found.push({ file, at: fs.statSync(file).mtimeMs });
    } catch (err) {
      // A half-written or superseded install directory.
    }
  }
  return found.sort((a, b) => b.at - a.at).map((entry) => entry.file);
}

// The app records the path it is using in its own config, which is the most
// reliable pointer of all when it is there.
function fromConfig() {
  let raw;
  try {
    raw = fs.readFileSync(path.join(homeDir(), 'config.toml'), 'utf8');
  } catch (err) {
    return null;
  }
  const match = /^\s*CODEX_CLI_PATH\s*=\s*['"](.+?)['"]\s*$/m.exec(raw);
  return match ? match[1] : null;
}

function onPath() {
  const name = process.platform === 'win32' ? 'codex.exe' : 'codex';
  const dirs = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const found = [];
  for (const dir of dirs) {
    const file = path.join(dir, name);
    // A .cmd or .ps1 shim cannot be spawned without a shell, so only take the
    // real executable.
    if (host.exists(file)) found.push(file);
  }
  return found;
}

function findExecutable(override) {
  const candidates = [];
  if (override) candidates.push(override);
  if (process.env.USAGE_LIMITS_CODEX) candidates.push(process.env.USAGE_LIMITS_CODEX);
  if (process.env.CODEX_CLI_PATH) candidates.push(process.env.CODEX_CLI_PATH);

  const configured = fromConfig();
  if (configured) candidates.push(configured);

  if (process.platform === 'win32') {
    candidates.push(...windowsCandidates());
  } else {
    candidates.push(path.join(homeDir(), 'bin', 'codex'));
    candidates.push('/usr/local/bin/codex');
    candidates.push('/opt/homebrew/bin/codex');
  }
  candidates.push(...onPath());

  for (const file of candidates) {
    if (file && host.exists(file)) return file;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Reading the rollouts
// ---------------------------------------------------------------------------

function rolloutFiles(since) {
  const root = sessionsDir();
  const files = [];

  // Rollouts are filed under sessions/YYYY/MM/DD, so walking is cheap, but
  // guard the depth anyway rather than trusting the layout.
  const walk = (dir, depth) => {
    if (depth > 5) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
        continue;
      }
      if (!entry.name.endsWith('.jsonl')) continue;
      try {
        const at = fs.statSync(full).mtimeMs;
        // A file untouched since before the window opened holds nothing for it.
        if (Number.isFinite(since) && at < since) continue;
        files.push({ file: full, at });
      } catch (err) {
        // Deleted between the listing and the stat.
      }
    }
  };

  walk(root, 0);
  return files.sort((a, b) => a.at - b.at);
}

// The session id is in the first line of the rollout, and also in its name.
// Take it from the name, which costs nothing and is right either way.
function sessionOf(file) {
  const match = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i
    .exec(path.basename(file));
  return match ? match[1] : null;
}

function weigh(usage) {
  if (!usage) return 0;
  const input = Number(usage.input_tokens) || 0;
  const cached = Number(usage.cached_input_tokens) || 0;
  const written = Number(usage.cache_write_input_tokens) || 0;
  const output = Number(usage.output_tokens) || 0;
  // input_tokens is the whole prompt including whatever was served from cache,
  // so the uncached part is the difference. Reasoning tokens are already
  // counted inside output_tokens.
  const fresh = Math.max(0, input - cached);
  return (
    fresh * WEIGHTS.input +
    cached * WEIGHTS.cached +
    written * WEIGHTS.cacheWrite +
    output * WEIGHTS.output
  ) / 1e6;
}

function partsOf(usage) {
  if (!usage) return { input: 0, cacheWrite: 0, cacheRead: 0, output: 0, reasoning: 0 };
  const input = Number(usage.input_tokens) || 0;
  const cached = Number(usage.cached_input_tokens) || 0;
  return {
    input: Math.max(0, input - cached),
    cacheWrite: Number(usage.cache_write_input_tokens) || 0,
    cacheRead: cached,
    output: Number(usage.output_tokens) || 0,
    // Codex reports the same thing Claude does under a different name, and the
    // same way round: inside output rather than beside it. Its own totals prove
    // it, with total_tokens coming to input plus output on 11,064 of 11,133
    // recorded turns. So it is carried for reporting and never added to a sum.
    reasoning: Number(usage.reasoning_output_tokens) || 0,
  };
}

function tokensOf(usage) {
  if (!usage) return 0;
  const total = Number(usage.total_tokens);
  if (Number.isFinite(total) && total > 0) return total;
  const parts = partsOf(usage);
  return parts.input + parts.cacheWrite + parts.cacheRead + parts.output;
}

// The model and effort in force are announced once per turn in a `turn_context`
// line, not repeated on each request, so a reader has to carry the last one
// forward. Without that every row in the report reads "unknown".
function contextFrom(line) {
  if (line.indexOf('"turn_context"') === -1) return null;
  let entry;
  try {
    entry = JSON.parse(line);
  } catch (err) {
    return null;
  }
  if (!entry || entry.type !== 'turn_context' || !entry.payload) return null;
  return {
    model: typeof entry.payload.model === 'string' ? entry.payload.model : '',
    effort: typeof entry.payload.effort === 'string' ? entry.payload.effort : null,
  };
}

// One rollout line to an event, or null if it is not a billable request.
function eventFrom(line, file, project, context) {
  if (line.indexOf('"token_count"') === -1) return null;
  let entry;
  try {
    entry = JSON.parse(line);
  } catch (err) {
    return null;
  }
  const payload = entry && entry.payload;
  if (!payload || payload.type !== 'token_count') return null;

  const at = Date.parse(entry.timestamp);
  if (!Number.isFinite(at)) return null;

  const usage = payload.info && payload.info.last_token_usage;
  if (!usage) return null;

  return {
    at,
    model: (context && context.model) || '',
    effort: (context && context.effort) || null,
    cost: weigh(usage),
    tokens: tokensOf(usage),
    parts: partsOf(usage),
    project: project || null,
    sessionId: sessionOf(file),
    // Carried so the newest meter reading can be picked out of the same pass.
    meter: payload.rate_limits || null,
  };
}

// Codex names the rollout's working directory in its first line. Reading one
// line per file is cheap and it is what makes the "projects" table mean
// something.
function projectOf(file) {
  let raw;
  try {
    const handle = fs.openSync(file, 'r');
    const buffer = Buffer.alloc(4096);
    const read = fs.readSync(handle, buffer, 0, buffer.length, 0);
    fs.closeSync(handle);
    raw = buffer.slice(0, read).toString('utf8');
  } catch (err) {
    return null;
  }
  const newline = raw.indexOf('\n');
  if (newline === -1) return null;
  let entry;
  try {
    entry = JSON.parse(raw.slice(0, newline));
  } catch (err) {
    return null;
  }
  const cwd = entry && entry.payload && entry.payload.cwd;
  return typeof cwd === 'string' ? cwd : null;
}

async function readEvents(since) {
  const files = rolloutFiles(since);
  const events = [];

  for (const entry of files) {
    const project = projectOf(entry.file);
    const stream = fs.createReadStream(entry.file, { encoding: 'utf8' });
    const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
    let context = null;
    try {
      for await (const line of lines) {
        const next = contextFrom(line);
        if (next) {
          context = next;
          continue;
        }
        const event = eventFrom(line, entry.file, project, context);
        if (event && event.at >= since) events.push(event);
      }
    } catch (err) {
      // A half-written line at the tail of a live session is expected.
    } finally {
      lines.close();
      stream.destroy();
    }
  }

  events.sort((a, b) => a.at - b.at);
  return events;
}

// ---------------------------------------------------------------------------
// The meter
// ---------------------------------------------------------------------------

function isoOf(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return null;
  return new Date(value * 1000).toISOString();
}

// Turn one `rate_limits` payload into the shape the window table already reads,
// so nothing downstream has to know which host it came from.
// A window is filed under what it actually is. The two lengths the shared table
// already knows keep its keys, so the calibration learned for a 5-hour window
// under Claude Code and under Codex stay comparable in shape; anything else is
// named by its own length so it gets a calibration of its own.
function keyFor(span, taken) {
  const preferred =
    span === 5 * HOUR ? 'five_hour' : span === 7 * DAY ? 'seven_day' : 'window_' + Math.round(span / MINUTE) + 'm';
  if (!taken || !taken.has(preferred)) return preferred;
  // Two windows of the same length would otherwise overwrite each other.
  let suffix = 2;
  while (taken.has(preferred + '_' + suffix)) suffix += 1;
  return preferred + '_' + suffix;
}

// One reading of one window, with the key it belongs under already worked out.
//
// Both the report and the calibration have to agree about which window is
// which, and they have to keep agreeing as the payload changes shape. Deriving
// the key in two places is how they stop agreeing: the calibration was once
// looking the key up in a table that no longer had one, and quietly measured
// nothing at all. So it is derived here, once.
function readingsOf(meter) {
  if (!meter || typeof meter !== 'object') return [];
  const taken = new Set();
  const readings = [];

  for (const entry of SLOTS) {
    const window = meter[entry.slot];
    if (!window || typeof window !== 'object') continue;
    // Number(null) is 0, and a null percentage read as "0% used" is worse
    // than no reading at all. Only an actual number counts.
    const raw = window.used_percent;
    const percent = raw === null || raw === undefined || raw === '' ? NaN : Number(raw);
    if (!Number.isFinite(percent)) continue;

    const minutes = Number(window.window_minutes);
    const span = Number.isFinite(minutes) && minutes > 0 ? minutes * MINUTE : entry.span;
    const key = keyFor(span, taken);
    taken.add(key);
    readings.push({
      key,
      slot: entry.slot,
      span,
      label: labelFor(span, entry.slot),
      percent,
      resetsAt: Number(window.resets_at) || null,
    });
  }
  return readings;
}

function utilizationFrom(meter) {
  if (!meter || typeof meter !== 'object') return null;

  const utilization = {};
  const specs = [];

  for (const reading of readingsOf(meter)) {
    utilization[reading.key] = {
      // The meter reports fractional percentages; the rest of the code expects
      // whole numbers, the way Claude's own snapshot reports them.
      utilization: Math.round(reading.percent),
      resets_at: isoOf(reading.resetsAt),
    };
    specs.push({ key: reading.key, label: reading.label, span: reading.span });
  }

  // No windows is a real answer, not a missing one: on flexible pricing the
  // account has no rolling limit and usage scales with credits. Returning null
  // here would throw away the plan and the credit balance, which on such an
  // account are the only figures there are.
  //
  // A slot that IS there but carries no readable percentage is a different
  // thing again: the meter answered without numbers, which happens around a
  // limit hit. Calling that flexible pricing told Codex on 2026-09-07 that its
  // Plus account had no window to run down, minutes after the window ran out.
  const slotsPresent = SLOTS.filter((entry) => meter[entry.slot] && typeof meter[entry.slot] === 'object').length;
  // Consumer plans are metered by windows without exception; only the
  // business-side plans can be on flexible pricing. So on Plus, Pro, Go or
  // Free a meter with no windows in it is a meter that failed to read them.
  const planType = typeof meter.plan_type === 'string' ? meter.plan_type : '';
  const consumer = /^(free|go|plus|pro|prolite)$/i.test(planType);
  const credits = meter.credits && typeof meter.credits === 'object' ? meter.credits : null;
  return {
    windowless: specs.length === 0 && slotsPresent === 0 && !consumer,
    unreadable: specs.length === 0 && (slotsPresent > 0 || consumer),
    utilization: specs.length ? utilization : null,
    specs,
    planType: typeof meter.plan_type === 'string' ? meter.plan_type : null,
    // Codex says outright when a limit has already been hit, which is a firmer
    // signal than a rounded percentage and must not be rounded away.
    reachedType:
      typeof meter.rate_limit_reached_type === 'string' ? meter.rate_limit_reached_type : null,
    spendControlReached: meter.spend_control_reached === true,
    credits: credits
      ? {
          enabled: credits.has_credits === true || credits.unlimited === true,
          everEnabled: credits.has_credits === true,
          limitReached: false,
          used: null,
          limit: null,
          percent: null,
          unlimited: credits.unlimited === true,
          balance: credits.balance === undefined ? null : credits.balance,
          currency: 'credits',
          disabledReason: null,
        }
      : null,
  };
}

// A span the table already has a name for keeps that name; anything else is
// described by its own length rather than mislabelled as one of the two. The
// slot name is the last resort, because "primary" at least does not claim a
// duration the window may not have.
function labelFor(span, fallback) {
  if (span === 5 * HOUR) return '5-hour';
  if (span === 7 * DAY) return 'weekly';
  const hours = span / HOUR;
  if (hours >= 24 && hours % 24 === 0) return hours / 24 + '-day';
  if (hours >= 1 && hours % 1 === 0) return hours + '-hour';
  const minutes = Math.round(span / MINUTE);
  return minutes > 0 ? minutes + '-minute' : fallback || 'window';
}

function planFrom(planType) {
  const id = String(planType || '').toLowerCase();
  const known = PLANS[id];
  if (known) return { id, label: known.label, advice: known.advice };
  return {
    id: id || 'unknown',
    // Show whatever was reported rather than "unknown" for a plan name that is
    // simply new.
    label: id ? 'ChatGPT ' + id : 'unknown',
    advice: null,
  };
}

// What one point of a window costs, measured rather than assumed.
//
// Claude Code has to infer this: its meter and its transcripts are separate
// files, so the price of a point is derived from a snapshot and everything
// spent around it. Codex writes both into the same record, which makes the
// measurement direct. Every request logs the meter as it stood and what that
// request cost, so the price of a point is the spend between two readings
// divided by how far the meter moved between them.
//
// The earlier port asked the user to count every turn by hand and refused to
// estimate without it, which is why it never produced a turn figure at all.
const MIN_POINTS_MOVED = 2;
const MIN_SAMPLE_TURNS = 5;

function calibrate(events, key, now) {
  const readings = [];
  for (const event of events) {
    if (!event.meter) continue;
    // The same assignment the report uses, so the window being calibrated is
    // certainly the window being reported.
    const reading = readingsOf(event.meter).find((one) => one.key === key);
    if (!reading) continue;
    readings.push({ at: event.at, percent: reading.percent, resetsAt: reading.resetsAt });
  }
  if (readings.length < 2) return null;

  // Only inside one window instance. A reset makes the meter fall, and pairing
  // across it would measure a negative pace or price a point at almost nothing.
  const last = readings[readings.length - 1];
  let first = last;
  for (let index = readings.length - 1; index >= 0; index -= 1) {
    const reading = readings[index];
    if (reading.resetsAt !== last.resetsAt) break;
    if (reading.percent > last.percent) break;
    first = reading;
  }

  const moved = last.percent - first.percent;
  if (moved < MIN_POINTS_MOVED) return null;

  // The spend that moved it is what happened after the first reading was taken,
  // up to and including the last.
  let cost = 0;
  let turns = 0;
  for (const event of events) {
    if (event.at <= first.at || event.at > last.at) continue;
    cost += event.cost;
    turns += 1;
  }
  if (turns < MIN_SAMPLE_TURNS || cost <= 0) return null;

  return { usdPerPercent: cost / moved, turns, percent: Math.round(last.percent) };
}

function limitIdOf(meter) {
  return meter && typeof meter.limit_id === 'string' ? meter.limit_id : '';
}

// Whether this payload is a reading of a rolling window at all.
//
// Percentages count, and so does Codex saying outright that the window is
// spent: at a limit hit the slots can come back null with
// `rate_limit_reached_type` set, and that payload is the truest description of
// the window there is. Skipping it for an older one that still had numbers
// would report a window as running when it has already stopped.
function carriesWindows(meter) {
  if (!meter || typeof meter !== 'object') return false;
  if (readingsOf(meter).length) return true;
  return typeof meter.rate_limit_reached_type === 'string' && meter.rate_limit_reached_type !== '';
}

// Codex writes more than one meter, and they are not successive readings of one
// thing. A Plus rollout carries `limit_id: "codex"`, which holds the 5-hour and
// weekly windows, interleaved with `limit_id: "premium"`, which holds the credit
// balance and has `primary` and `secondary` set to null.
//
// Taking whichever was written last therefore threw the windows away whenever a
// `premium` payload happened to land last, which on this machine was two of
// every six rollouts - and the report went blind at exactly the moment it was
// wanted. On 2026-09-07 the final line of a rollout was a `premium` payload two
// lines after a `codex` payload reading 99 per cent of the 5-hour window, and
// what reached the agent was a meter with no windows in it at all. That is the
// whole of "Codex does not slow down when the limit is close": nothing ever
// told it the limit was close.
//
// So the newest reading of EACH meter is kept, and the one that actually
// describes a window wins. Nothing is merged and nothing is synthesised: the
// payload returned is one Codex really wrote, and `at` is when it wrote it, so
// a stale reading still ages honestly.
function pickMeter(candidates) {
  const newestBy = new Map();
  let newest = null;
  for (const entry of candidates || []) {
    if (!entry || !entry.meter || !Number.isFinite(entry.at)) continue;
    if (!newest || entry.at > newest.at) newest = entry;
    const id = limitIdOf(entry.meter);
    const held = newestBy.get(id);
    if (!held || entry.at > held.at) newestBy.set(id, entry);
  }
  let best = null;
  for (const entry of newestBy.values()) {
    if (!carriesWindows(entry.meter)) continue;
    if (!best || entry.at > best.at) best = entry;
  }
  // No meter describes a window: that is a real answer too, and the newest
  // payload is the one that should say it. utilizationFrom then reports it as
  // unreadable or windowless exactly as before.
  return best || newest;
}

// The newest meter reading in the rollouts, and when it was taken.
function latestMeter(events) {
  const candidates = [];
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (!event || !event.meter) continue;
    candidates.push({ meter: event.meter, at: event.at });
    // Newest first, so the first payload that describes a window is the newest
    // one that does and nothing older can beat it.
    if (carriesWindows(event.meter)) break;
  }
  return pickMeter(candidates);
}

// The meter is written next to every request, so the newest one is always near
// the END of a rollout. Only the tail is read.
//
// This used to read whole files, and a rollout on this machine reaches 32 MB;
// twelve of those is a third of a gigabyte pulled through a string on a path
// that the status line takes every few hundred milliseconds. A megabyte of
// tail holds hundreds of token_count lines, which is far more than enough.
const TAIL_BYTES = 1024 * 1024;

function readTail(file, bytes) {
  let size = 0;
  try {
    size = fs.statSync(file).size;
  } catch (err) {
    return null;
  }
  const from = Math.max(0, size - bytes);
  let fd;
  try {
    fd = fs.openSync(file, 'r');
  } catch (err) {
    return null;
  }
  try {
    const length = size - from;
    if (length <= 0) return { text: '', partial: false };
    const buffer = Buffer.allocUnsafe(length);
    let read = 0;
    while (read < length) {
      const got = fs.readSync(fd, buffer, read, length - read, from + read);
      if (got <= 0) break;
      read += got;
    }
    return { text: buffer.toString('utf8', 0, read), partial: from > 0 };
  } catch (err) {
    return null;
  } finally {
    try {
      fs.closeSync(fd);
    } catch (err) {
      // Already closed.
    }
  }
}

function meterFromLines(text, partial) {
  const lines = text.split('\n');
  // The first line of a tail is a fragment of whatever it landed in the middle
  // of, so it is never parsed.
  const floor = partial ? 1 : 0;
  const candidates = [];
  for (let index = lines.length - 1; index >= floor; index -= 1) {
    const line = lines[index];
    if (!line || line.indexOf('"token_count"') === -1) continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch (err) {
      continue;
    }
    const meter = parsed && parsed.payload && parsed.payload.rate_limits;
    const at = Date.parse(parsed && parsed.timestamp);
    if (!meter || !Number.isFinite(at)) continue;
    candidates.push({ meter, at });
    // Walking backwards, so the first payload that describes a window is the
    // newest one that does. Stopping there keeps the common case at a handful
    // of parsed lines rather than the whole tail, which matters on the status
    // line path.
    if (carriesWindows(meter)) break;
  }
  return pickMeter(candidates);
}

// Scanning only the newest few rollouts, for the meter alone. `collect` runs on
// the status-line path where a full scan would be far too slow.
//
// A rollout whose tail holds only the credit meter is not a reason to stop: the
// windows are in an older one, and reporting nothing when they are three
// seconds away on disk is the blindness this whole path exists to avoid. The
// newest windowless reading is still kept, so an account that genuinely has no
// rolling window says so instead of saying nothing.
function meterFromDisk() {
  const files = rolloutFiles(NaN).slice(-12).reverse();
  let fallback = null;
  for (const entry of files) {
    const tail = readTail(entry.file, TAIL_BYTES);
    if (!tail) continue;
    const found = meterFromLines(tail.text, tail.partial);
    if (!found) continue;
    if (carriesWindows(found.meter)) return found;
    if (!fallback || found.at > fallback.at) fallback = found;
  }
  return fallback;
}

// Where a live reading taken by refreshIfStale() is kept, so the hooks and the
// report see it without asking Codex again.
function liveFile() {
  return path.join(homeDir(), 'usage-limits-codex-live.json');
}

// The app-server's account/rateLimits/read answers in camelCase (usedPercent,
// windowDurationMins, resetsAt, planType ...) while rollouts and every reader
// here use snake_case. Stored as received, a fresh live reading was invisible
// to readingsOf() and the brief, pulse and ceiling all went blind on Codex.
// One conversion, applied where a reading is taken and again where the file
// is read back, because a camelCase file may already be on disk.
const METER_RENAMES = { window_duration_mins: 'window_minutes' };
function snakeKey(key) {
  const snake = String(key).replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());
  return METER_RENAMES[snake] || snake;
}
function normalizeMeter(meter) {
  if (Array.isArray(meter)) return meter.map(normalizeMeter);
  if (!meter || typeof meter !== 'object') return meter;
  const out = {};
  for (const [key, value] of Object.entries(meter)) {
    const name = snakeKey(key);
    // A snake_case field that is already there wins over a converted twin.
    if (Object.prototype.hasOwnProperty.call(out, name) && name !== key) continue;
    out[name] = normalizeMeter(value);
  }
  return out;
}

function readLiveMeter() {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(liveFile(), 'utf8'));
  } catch (err) {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  if (!Number.isFinite(parsed.at) || !parsed.meter || typeof parsed.meter !== 'object') return null;
  return Object.assign({}, parsed, { meter: normalizeMeter(parsed.meter) });
}

function writeLiveMeter(reading) {
  try {
    return atomic.tryWriteFileAtomic(liveFile(), JSON.stringify(reading));
  } catch (err) {
    // A reading that will not serialise is not written either.
    return false;
  }
}

function attemptFile() {
  return path.join(homeDir(), 'usage-limits-codex-fetch.json');
}

// How long a detached refresh is given before another hook may start one. The
// child is not waited on, so this claim is the only thing stopping every hook
// in a burst from launching its own app-server.
const DETACHED_GUARD_MS = 45 * 1000;

// A detached refresh sits outside everybody's hook budget, so it can afford to
// wait out a cold start instead of giving up at four seconds.
const DETACHED_TIMEOUT_MS = 25 * 1000;

// Start the refresh in a child nobody waits for.
//
// This is the answer to the hook timeout. Codex kills a hook at ten seconds,
// and `codex app-server` can take more than four to answer cold - so a hook
// that waits for the reading is a hook that gets killed, and a killed hook
// says nothing at all. Here the hook returns immediately and the reading lands
// in liveFile() a second or two later, where the NEXT hook reads it. One turn
// of latency for a figure that is refreshed every few minutes anyway.
function spawnRefresh(options) {
  const opts = options || {};
  const spawn = opts.spawn || require('child_process').spawn;
  const args = [__filename, '--refresh-meter'];
  if (opts.codexPath) args.push('--codex-path', String(opts.codexPath));
  const child = spawn(opts.execPath || process.execPath, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    // The child reads CODEX_HOME to find the same home directory this process
    // is using, so a test or a non-default install refreshes the right file.
    env: Object.assign({}, opts.env || process.env, { CODEX_HOME: homeDir() }),
  });
  if (child && typeof child.unref === 'function') child.unref();
  return child;
}

// Take the reading and record it, with no staleness or backoff check. This is
// the half of refreshIfStale() that actually costs something, split out so the
// detached child can run it without tripping over the in-flight claim the
// parent just wrote.
async function fetchAndRecord(options) {
  const opts = options || {};
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const maxAgeMs = Number.isFinite(opts.maxAgeMs) ? opts.maxAgeMs : 3 * MINUTE;
  const claim = (delayMs, kind) => {
    try {
      fs.writeFileSync(attemptFile(), JSON.stringify({ attemptedAtMs: now, delayMs, kind }), 'utf8');
    } catch (err) {
      // One extra attempt is survivable.
    }
  };
  try {
    const reading = await refresh({ codexPath: opts.codexPath, timeoutMs: opts.timeoutMs });
    if (!reading || !reading.meter) {
      claim(maxAgeMs, 'empty');
      return { reading: null, error: 'no meter' };
    }
    writeLiveMeter(reading);
    claim(maxAgeMs, 'ok');
    return { reading, error: null };
  } catch (err) {
    // Codex missing or not answering: back off rather than pay for it again on
    // every prompt.
    claim(Math.min(10 * MINUTE, Math.max(2 * MINUTE, maxAgeMs * 2)), (err && err.code) || 'error');
    return { reading: null, error: (err && err.code) || 'error' };
  }
}

// Ask Codex for the meter, but only when the newest reading on disk has aged,
// and never twice in quick succession. Codex writes its meter into a rollout
// only when it makes a request, so between turns the newest reading can be
// half an hour old: the agent then plans against a figure from before the work
// it just did, says the limit is fine, and hits it. This is what closes that
// gap, the same way the Claude side takes a fresh /usage reading.
async function refreshIfStale(options) {
  const opts = options || {};
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const maxAgeMs = Number.isFinite(opts.maxAgeMs) ? opts.maxAgeMs : 3 * MINUTE;
  const env = opts.env || process.env;
  if (opts.fetch === false || String(env.USAGE_LIMITS_FETCH || '').toLowerCase() === 'off') {
    return { reading: readLiveMeter(), skipped: 'disabled' };
  }

  const onDisk = meterFromDisk();
  const live = readLiveMeter();
  const newestAt = Math.max(onDisk && Number.isFinite(onDisk.at) ? onDisk.at : 0, live ? live.at : 0);
  if (newestAt > 0 && now - newestAt < maxAgeMs) return { reading: live, skipped: 'fresh' };

  let attempt = null;
  try {
    attempt = JSON.parse(fs.readFileSync(attemptFile(), 'utf8'));
  } catch (err) {
    attempt = null;
  }
  const sinceAttempt = attempt && Number.isFinite(attempt.attemptedAtMs) ? now - attempt.attemptedAtMs : null;
  if (sinceAttempt !== null && Number.isFinite(attempt.delayMs) && sinceAttempt >= -MINUTE && sinceAttempt < attempt.delayMs) {
    return { reading: live, skipped: 'backoff' };
  }
  // Claim the attempt before making it: Codex's app-server takes about a
  // second, and several hooks can fire at once.
  const claim = (delayMs, kind) => {
    try {
      fs.writeFileSync(attemptFile(), JSON.stringify({ attemptedAtMs: now, delayMs, kind }), 'utf8');
    } catch (err) {
      // One extra attempt is survivable.
    }
  };
  // The hook's own path: start the reading and get out of the way. Waiting for
  // `codex app-server` inside a hook is what overran Codex's ten-second limit
  // under load - the cold start alone has been measured past four seconds, and
  // the brief still has a transcript scan to do after it. The child writes the
  // meter file; the next hook reads it.
  if (opts.detach) {
    claim(DETACHED_GUARD_MS, 'detached');
    try {
      spawnRefresh({ codexPath: opts.codexPath, spawn: opts.spawn, execPath: opts.execPath, env: env });
    } catch (err) {
      claim(Math.max(2 * MINUTE, maxAgeMs), 'spawn-failed');
      return { reading: live, skipped: null, error: 'spawn failed' };
    }
    return { reading: live, skipped: 'detached' };
  }

  claim(Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : 8000, 'inflight');

  const done = await fetchAndRecord({
    now,
    maxAgeMs,
    timeoutMs: opts.timeoutMs,
    codexPath: opts.codexPath,
  });
  if (done.error) return { reading: live, skipped: null, error: done.error };
  return { reading: done.reading, skipped: null };
}

function collect(now, options) {
  // The newest of the three: a reading handed in, one taken by the hooks, or
  // the newest one Codex happened to write into a rollout.
  const given = options && options.meter;
  const live = readLiveMeter();
  const disk = meterFromDisk();
  const best =
    given ||
    (live && (!disk || !Number.isFinite(disk.at) || live.at > disk.at) ? live : disk);
  const found = best;
  const mapped = found ? utilizationFrom(found.meter) : null;
  const plan = planFrom(mapped && mapped.planType);

  return {
    now,
    host: host.CODEX,
    // Codex quotes a percentage of an allowance, never a price, so there is no
    // honest money column to print.
    money: false,
    accountFile: sessionsDir(),
    plan: plan.label,
    planId: plan.id,
    planTier: null,
    planAdvice: plan.advice,
    snapshotAgeMs: found ? now - found.at : null,
    snapshotFetchedAt: found ? found.at : null,
    utilization: mapped ? mapped.utilization : null,
    // The account was read and genuinely reports no rolling window, which is
    // what flexible pricing looks like. That is a different thing from having
    // found nothing to read, and it needs to be said differently.
    windowless: Boolean(mapped && mapped.windowless),
    // The meter reported window slots but no readable percentage in them.
    unreadable: Boolean(mapped && mapped.unreadable),
    windowSpecs: mapped ? mapped.specs : null,
    reachedType: mapped ? mapped.reachedType : null,
    spendControlReached: Boolean(mapped && mapped.spendControlReached),
    codexCredits: mapped ? mapped.credits : null,
    settings: {
      model: readConfigValue('model') || 'default',
      effortLevel: readConfigValue('model_reasoning_effort') || 'default',
    },
    extraUsage: null,
  };
}

function readConfigValue(key) {
  let raw;
  try {
    raw = fs.readFileSync(path.join(homeDir(), 'config.toml'), 'utf8');
  } catch (err) {
    return null;
  }
  // Only the top-level table; a key of the same name inside a section is a
  // different setting.
  const head = raw.split(/^\s*\[/m)[0];
  const match = new RegExp('^\\s*' + key + '\\s*=\\s*[\'"](.+?)[\'"]\\s*$', 'm').exec(head);
  return match ? match[1] : null;
}

// ---------------------------------------------------------------------------
// A live reading
// ---------------------------------------------------------------------------

// Ask Codex for the meter now, rather than taking the newest one it happened to
// write. Costs about a second and a child process, so it is for when the
// rollout reading has gone stale, not for every prompt.
function refresh(options) {
  const settings = options || {};
  const executable = findExecutable(settings.codexPath);
  if (!executable) {
    return Promise.reject(
      Object.assign(new Error('Codex was not found on this machine.'), { code: 'CODEX_NOT_FOUND' })
    );
  }

  const childProcess = require('child_process');
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = childProcess.spawn(executable, ['app-server'], {
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'ignore'],
      });
    } catch (err) {
      reject(Object.assign(new Error('Codex could not be started.'), { code: 'CODEX_START_FAILED' }));
      return;
    }

    let settled = false;
    let buffer = '';
    let bytes = 0;
    const limit = 2 * 1024 * 1024;

    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.stdin.end();
      } catch (error) {
        // Already gone.
      }
      // Closing stdin is how app-server is asked to stop. Kill only if it does
      // not take the hint, and only ever this one process.
      const grace = setTimeout(() => {
        try {
          child.kill();
        } catch (error) {
          // Already gone.
        }
      }, 1000);
      if (grace.unref) grace.unref();
      if (err) reject(err);
      else resolve(value);
    };

    const timer = setTimeout(
      () => finish(Object.assign(new Error('Codex did not answer in time.'), { code: 'CODEX_TIMEOUT' })),
      Number.isFinite(settings.timeoutMs) ? settings.timeoutMs : 15000
    );

    child.once('error', (err) =>
      finish(
        Object.assign(new Error('Codex could not be started.'), {
          code: err && err.code === 'ENOENT' ? 'CODEX_NOT_FOUND' : 'CODEX_START_FAILED',
        })
      )
    );
    child.once('close', () =>
      finish(
        Object.assign(new Error('Codex closed before reporting its limits.'), {
          code: 'CODEX_CLOSED',
        })
      )
    );

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > limit) {
        finish(Object.assign(new Error('Codex sent too much.'), { code: 'CODEX_OUTPUT_LIMIT' }));
        return;
      }
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch (err) {
          continue;
        }
        // A server-initiated request is answered with a refusal and nothing
        // else; this client never approves anything or hands over credentials.
        if (message && message.method && message.id !== undefined) {
          write({
            id: message.id,
            error: { code: -32601, message: 'This reader does not support server requests.' },
          });
          continue;
        }
        if (!message || message.id === undefined) continue;
        if (message.id === 1 && message.result) {
          write({ method: 'initialized', params: {} });
          write({ method: 'account/rateLimits/read', id: 2 });
          continue;
        }
        if (message.id === 2) {
          if (message.error) {
            finish(
              Object.assign(new Error('Codex would not report its limits.'), {
                code: 'CODEX_LIMITS_UNAVAILABLE',
              })
            );
            return;
          }
          const limits = message.result && message.result.rateLimits;
          finish(null, { at: Date.now(), meter: limits ? normalizeMeter(limits) : null });
          return;
        }
      }
    });

    const write = (message) => {
      try {
        child.stdin.write(JSON.stringify(message) + '\n');
      } catch (err) {
        finish(Object.assign(new Error('Codex stopped listening.'), { code: 'CODEX_CLOSED' }));
      }
    };

    write({
      method: 'initialize',
      id: 1,
      params: {
        clientInfo: { name: 'usage-limits', title: 'Usage Limits', version: '1.0.0' },
      },
    });
  });
}

// The detached refresh, run as `node codex.js --refresh-meter`. Nothing waits
// for this process, so it can spend the cold start a hook cannot.
if (require.main === module) {
  const argv = process.argv.slice(2);
  if (argv[0] !== '--refresh-meter') {
    process.stderr.write('codex.js: only --refresh-meter is runnable\n');
    process.exitCode = 2;
  } else {
    const at = argv.indexOf('--codex-path');
    fetchAndRecord({
      now: Date.now(),
      timeoutMs: DETACHED_TIMEOUT_MS,
      codexPath: at !== -1 ? argv[at + 1] : null,
    })
      .catch(() => null)
      .then(() => {
        // The app-server is asked to stop by having its stdin closed, which
        // refresh() has already done. This timer is deliberately not unref'd:
        // it is the one thing that ends this process if the child it started
        // does not exit on its own.
        setTimeout(() => process.exit(0), 2000);
      });
  }
}

module.exports = {
  SLOTS,
  WEIGHTS,
  PLANS,
  DETACHED_GUARD_MS,
  DETACHED_TIMEOUT_MS,
  spawnRefresh,
  fetchAndRecord,
  normalizeMeter,
  homeDir,
  sessionsDir,
  findExecutable,
  windowsCandidates,
  fromConfig,
  rolloutFiles,
  sessionOf,
  weigh,
  partsOf,
  tokensOf,
  contextFrom,
  eventFrom,
  readEvents,
  keyFor,
  readingsOf,
  utilizationFrom,
  labelFor,
  planFrom,
  limitIdOf,
  carriesWindows,
  pickMeter,
  latestMeter,
  meterFromDisk,
  readTail,
  meterFromLines,
  TAIL_BYTES,
  liveFile,
  attemptFile,
  readLiveMeter,
  writeLiveMeter,
  refreshIfStale,
  calibrate,
  MIN_POINTS_MOVED,
  MIN_SAMPLE_TURNS,
  collect,
  refresh,
};
