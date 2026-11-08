#!/usr/bin/env node
'use strict';

// The status line: one line of bars under the Claude Code prompt, in Claude's
// own colours, from Claude's own numbers.
//
// Claude Code runs this on every change and hands it JSON on stdin. Two things
// in that JSON are worth more than anything on disk: `rate_limits`, which
// Claude Code fills from the rate-limit headers on its own API responses, and
// `model`, which is the one certain answer to which model is running. Both
// are recorded in a small feed file, one slot per session, so the side panel
// (which never sees this JSON) can draw from them too.
//
// It must be fast and it must never fail: no transcript scan, no network, one
// read of a few small files, and any error prints nothing rather than a stack
// trace where the bars should be.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const usage = require('./usage.js');
const host = require('./host.js');
const bars = require('./bars.js');
const view = require('./view.js');
const activity = require('./activity.js');
const statusline = require('./statusline.js');
const live = require('./live.js');

const KEEP_SESSIONS = 8;
// Two updates this close together mean Claude is mid-turn.
const WORKING_GAP_MS = 4000;
// A previous status line gets this long, then we go on without it.
const CHAIN_TIMEOUT_MS = 2000;
const STDIN_WAIT_MS = 500;
// How long a display keeps describing the session it chose before it will
// follow a different one.
const STICKY_QUIET_MS = 5 * 60 * 1000;
// Claude Code draws the status line inside its own margins, a few columns
// narrower than COLUMNS, and clips what does not fit.
const STATUSLINE_MARGIN = 4;

const SHORT = { five_hour: 'session', seven_day: 'week', spend_limit: 'spend' };
// When even that is too wide.
const SHORTER = { five_hour: '5h', seven_day: 'wk', spend_limit: 'spend' };
// Codex names its own windows "5h limit" and "Weekly limit"; on one line they
// are the same two abbreviations Claude's get.
const SHORT_CODEX = { five_hour: '5h', seven_day: 'week' };
const SHORTER_CODEX = { five_hour: '5h', seven_day: 'wk' };

function configDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

function feedFile() {
  return path.join(configDir(), 'usage-limits-feed.json');
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    return null;
  }
}

function readFeed() {
  const parsed = readJson(feedFile());
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const slots = {};
  for (const key of Object.keys(parsed)) {
    const value = parsed[key];
    if (value && typeof value === 'object' && Number.isFinite(value.at)) slots[key] = value;
  }
  return slots;
}

function writeFeed(all) {
  return live.writeAtomic(feedFile(), JSON.stringify(all));
}

// Two updates a few seconds apart mean a turn in progress, unless the status
// line is on a timer that fires that often anyway, in which case the gap says
// nothing and only the hooks' marks do.
function gapMeansWorking(settings) {
  const line = settings && settings.statusLine;
  const every = line && Number.isFinite(line.refreshInterval) ? line.refreshInterval * 1000 : null;
  return !(every !== null && every <= WORKING_GAP_MS);
}

// This session's own mark, from the hooks. Another window working must not
// spin this one's line.
function ownState(marks, sessionId, now) {
  const mine = sessionId && marks ? marks[sessionId] : null;
  if (!mine || !Number.isFinite(mine.at) || now - mine.at > activity.STALE_MS) {
    return { working: false, ultracode: false, ultrathink: false };
  }
  return { working: mine.state === 'working', ultracode: Boolean(mine.ultracode), ultrathink: Boolean(mine.ultrathink) };
}

function number(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

// What one status line update tells us, folded onto what the last one said.
// A run without rate_limits (they only appear after the first API response)
// keeps the previous ones rather than forgetting them.
function slotFrom(input, previous, now) {
  const login = usage.accountUuid();
  const prior = previous && typeof previous === 'object' && (!login || previous.accountUuid === login) ? previous : {};
  const model = input.model && typeof input.model === 'object' ? input.model : {};
  const hasHeaders = Boolean(input.rate_limits && typeof input.rate_limits === 'object');
  return {
    at: now,
    accountUuid: login,
    tokens: input.context_window ? require('./tokens.js').fromStatusLine(input) : prior.tokens || null,
    prevAt: Number.isFinite(prior.at) ? prior.at : null,
    sessionId: input.session_id || null,
    model: typeof model.id === 'string' ? model.id : prior.model || null,
    modelName: typeof model.display_name === 'string' ? model.display_name : prior.modelName || null,
    effort: input.effort && typeof input.effort.level === 'string' ? input.effort.level : prior.effort || null,
    // When the effort above was last handed over, as distinct from `at`: an
    // update without one carries the old effort forward, and dating it by this
    // redraw would let a stale reading outrank a newer transcript line.
    effortAt: input.effort && typeof input.effort.level === 'string' ? now : Number.isFinite(prior.effortAt) ? prior.effortAt : null,
    rateLimits: hasHeaders ? input.rate_limits : prior.rateLimits || null,
    headersAt: hasHeaders ? now : Number.isFinite(prior.headersAt) ? prior.headersAt : null,
    context: input.context_window ? number(input.context_window.used_percentage) : number(prior.context),
    cost: input.cost ? number(input.cost.total_cost_usd) : number(prior.cost),
    cwd: typeof input.cwd === 'string' ? input.cwd : prior.cwd || null,
    version: typeof input.version === 'string' ? input.version : prior.version || null,
    fastMode: input.fast_mode === true,
    cacheMiss: missFrom(input.prompt_cache, prior.cacheMiss),
  };
}

// The last prompt-cache miss and its diagnosed causes, from the status line's
// prompt_cache object: last_miss_at is epoch seconds and last_miss_cause is
// null until the first miss and whenever no cause was found (Claude Code
// 2.1.260 and later; both per code.claude.com/docs/en/statusline). The moment
// is what lets the brief tell a new miss from the same one arriving on every
// refresh. A refresh without the object, or without a diagnosed cause, keeps
// what the last one said.
function missFrom(cache, prior) {
  if (!cache || typeof cache !== 'object') return prior || null;
  const at = typeof cache.last_miss_at === 'number' && Number.isFinite(cache.last_miss_at) ? cache.last_miss_at * 1000 : null;
  const cause = cache.last_miss_cause;
  const causes = cause && typeof cause === 'object' && Array.isArray(cause.causes)
    ? cause.causes.filter((name) => typeof name === 'string')
    : [];
  if (at === null || !causes.length) return prior || null;
  return { at, causes };
}

function trim(all, keep) {
  const ordered = Object.keys(all).sort((a, b) => (all[b].at || 0) - (all[a].at || 0));
  const kept = {};
  for (const key of ordered.slice(0, keep || KEEP_SESSIONS)) kept[key] = all[key];
  return kept;
}

function record(all, input, now) {
  if (!input || typeof input !== 'object' || !input.session_id) return all || {};
  const next = Object.assign({}, all || {});
  next[input.session_id] = slotFrom(input, next[input.session_id], now);
  return trim(next);
}

function newest(all) {
  let best = null;
  for (const key of Object.keys(all || {})) {
    const slot = all[key];
    if (slot && Number.isFinite(slot.at) && (!best || slot.at > best.at)) best = slot;
  }
  return best;
}

// Which session a display with no session of its own should describe.
//
// "Whichever moved last" reads badly with two windows open: two Claudes on the
// same model at different efforts made the line flip between ultracode and
// xhigh every few seconds, which is noise, not news. So a display sticks to
// the session it is already describing until that one has been quiet for a
// while, and only then moves to the newest.
function stickySlot(all, previousId, now, quietMs) {
  const slots = all || {};
  const quiet = Number.isFinite(quietMs) ? quietMs : STICKY_QUIET_MS;
  const at = Number.isFinite(now) ? now : Date.now();
  const held = previousId ? slots[previousId] : null;
  if (held && Number.isFinite(held.at) && at - held.at <= quiet) return held;
  return newest(slots);
}

function isWorking(slot, now) {
  if (!slot || !Number.isFinite(slot.at) || !Number.isFinite(slot.prevAt)) return false;
  return now - slot.at < WORKING_GAP_MS && slot.at - slot.prevAt < WORKING_GAP_MS;
}

function shortLabel(row, shorter) {
  const table = shorter ? SHORTER : SHORT;
  if (table[row.key]) return table[row.key];
  return row.family || row.key;
}

// The line. Widest form first, then narrower bars, then no model, then no
// bars, so it always fits whatever COLUMNS says.
function line(built, options) {
  const opts = options || {};
  const columns = Number.isFinite(opts.columns) && opts.columns > 0 ? opts.columns : 80;
  const mode = opts.mode || 'none';
  const tick = Number.isFinite(opts.tick) ? opts.tick : 0;
  const reduced = Boolean(opts.reduced);
  const ascii = Boolean(opts.ascii);

  if (!built || !built.rows || !built.rows.length) return '';
  if (built.state === 'none') return bars.dim('usage: no reading yet', mode);

  const glyph = built.working
    ? bars.paint(bars.spinner(tick, { ascii, reduced }), bars.THEME.claude, mode)
    : bars.paint(ascii ? '*' : '✻', bars.THEME.claude, mode);
  const effortName = built.effort;
  const effort = effortName ? bars.effortColour(effortName) : null;
  const effortText = !effortName
    ? ''
    : effort.rainbow
      ? bars.rainbow(effortName, tick, { mode, reduced })
      : effort.shimmer && built.working
        ? bars.shimmer(effortName, tick, effort.rgb, effort.shimmer, { mode, reduced })
        : bars.paint(effortName, effort.rgb, mode);
  // The word, in the rainbow, the way Claude Code paints it in the prompt.
  const thinking = built.ultrathink ? ' ' + bars.dim('·', mode) + ' ' + bars.rainbow('ultrathink', tick, { mode, reduced }) : '';
  // The budget mode, only when it is not the one the plugin has always been
  // in. `standard` is today's behaviour and today's line, unchanged to the
  // character; anything else changes what the hooks say, and a line that does
  // not mention it leaves the user guessing why the briefing went quiet.
  // It rides on the head so the width ladder drops it with the head, before it
  // ever costs a percentage its place.
  const budgetText =
    built.budget && built.budget.name !== 'standard'
      ? ' ' + bars.dim('·', mode) + ' ' + bars.dim('budget ' + built.budget.label, mode)
      : '';
  const head =
    glyph + ' ' + built.modelLabel + (effortText ? ' ' + bars.dim('·', mode) + ' ' + effortText : '') + thinking + budgetText;

  const segment = (row, width, shorter) => {
    const label = shortLabel(row, shorter);
    const percent = row.level === 'fill' ? row.percentText : bars.paint(row.percentText, bars.levelColour(row.level), mode);
    if (!width || row.percent === null) return label + ' ' + percent;
    return label + ' ' + bars.bar(row.percent, width, { mode, level: row.level, ascii, tick, reduced, style: built.style }) + ' ' + percent;
  };

  const attempts = [
    { width: 10, head: true },
    { width: 8, head: true },
    { width: 6, head: true },
    { width: 6, head: false },
    { width: 4, head: false },
    { width: 4, head: false, shorter: true },
    { width: 0, head: false },
    { width: 0, head: false, shorter: true },
    { width: 0, head: false, shorter: true, gap: ' ' },
  ];

  // The Codex tail.
  //
  // It always says "left", and if that does not fit it is not shown at all.
  // Codex reports what remains and Claude reports what is spent, so a bare
  // "85%" sitting beside a bare "15%" would be read as the same kind of
  // number when they run in opposite directions - which is precisely the
  // confusion this row exists to remove.
  // Another Claude spending the same budget is worth a word on the line.
  const others =
    Number.isFinite(built.othersWorking) && built.othersWorking > 0
      ? bars.paint('+' + built.othersWorking + ' working', bars.THEME.claude, mode)
      : '';
  // Agents spend the same window and were the one thing on it with no voice.
  // A fan-out can empty half a five-hour window in five minutes while the line
  // shows one session working, so the count goes on the line whenever any are
  // live - and it is dropped first when the terminal is too narrow, because a
  // percentage the user cannot see is worse than a count they cannot see.
  const agents =
    built.agents && built.agents.running > 0
      ? bars.paint(
          '+' + built.agents.running + ' agent' + (built.agents.running === 1 ? '' : 's') +
            (built.agents.runs > 1 ? ' (' + built.agents.runs + ' runs)' : ''),
          bars.THEME.claude,
          mode
        )
      : '';
  let text = '';
  for (const attempt of attempts) {
    const parts = built.rows.map((row) => segment(row, attempt.width, attempt.shorter));
    if (others) parts.push(others);
    if (agents && !attempt.shorter) parts.push(agents);
    if (attempt.head) parts.unshift(head);
    text = parts.join(attempt.gap || '  ');
    if (bars.visibleWidth(text) <= columns) return text;
  }
  return text;
}

// The Codex line, drawn UNDERNEATH the Claude one.
//
// It began as a tail on the same line, and that was wrong twice over. It read
// as one more Claude window when it is a different account with a different
// budget, and being last it was the first thing the width ladder dropped, so on
// an ordinary terminal it was simply never there. A line of its own is what the
// panel already does and what was asked for.
//
// Every figure says "left", because Codex counts down where Claude counts up.
function codexLine(built, options) {
  const opts = options || {};
  const columns = Number.isFinite(opts.columns) && opts.columns > 0 ? opts.columns : 80;
  const mode = opts.mode || 'none';
  const tick = Number.isFinite(opts.tick) ? opts.tick : 0;
  const reduced = Boolean(opts.reduced);
  const ascii = Boolean(opts.ascii);

  const block = built && built.codex;
  if (!block || !Array.isArray(block.rows) || !block.rows.length) return '';
  // Nothing readable at all is silence, not a line of dashes.
  if (!block.rows.some((row) => row.percentLeft !== null)) return '';

  // The name, not a mark: there is no ChatGPT logo a terminal font can draw.
  const glyph = bars.paint(bars.CODEX_LABEL, bars.THEME.codex, mode);
  const plan = block.plan ? bars.dim(String(block.plan), mode) : '';

  const segment = (row, width, shorter) => {
    const label = (shorter ? SHORTER_CODEX : SHORT_CODEX)[row.key] || row.key;
    // A window whose reading has rolled over says so rather than vanishing: on
    // a line of its own there is room, and dropping it silently would read as
    // "Codex has one window" when it has two.
    if (row.percentLeft === null) return label + ' ' + bars.dim(row.percentText, mode);
    const text = Math.floor(row.percentLeft) + '% left';
    const painted = row.level === 'fill' ? text : bars.paint(text, bars.levelColour(row.level), mode);
    if (!width) return label + ' ' + painted;
    return (
      label + ' ' + bars.bar(row.percentLeft, width, { mode, level: row.level, ascii, tick, reduced }) + ' ' + painted
    );
  };

  const attempts = [
    { width: 10, head: true },
    { width: 8, head: true },
    { width: 6, head: true },
    { width: 6, head: false },
    { width: 4, head: false },
    { width: 0, head: false },
    { width: 0, head: false, shorter: true },
    { width: 0, head: false, shorter: true, gap: ' ' },
    // Last of all, only the windows that have a number. "5h rolling" is ten
    // columns saying nothing a figure would not, and in a pane this narrow it
    // is the difference between the line fitting and being clipped.
    { width: 0, head: false, shorter: true, gap: ' ', readable: true },
  ];

  let text = '';
  for (const attempt of attempts) {
    const gap = attempt.gap || '  ';
    const rows = attempt.readable ? block.rows.filter((row) => row.percentLeft !== null) : block.rows;
    if (!rows.length) continue;
    const body = rows.map((row) => segment(row, attempt.width, attempt.shorter)).join(gap);
    // "Codex · ChatGPT Plus", the way the Claude line separates its model from
    // its effort. Without the dot the two ran together as "Codex ChatGPT Plus".
    const label = attempt.head && plan ? glyph + ' ' + bars.dim('·', mode) + ' ' + plan + gap : glyph + ' ';
    text = label + body;
    if (bars.visibleWidth(text) <= columns) return text;
  }
  return text;
}

function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve('');
    let raw = '';
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve(raw);
    };
    const timer = setTimeout(done, STDIN_WAIT_MS);
    if (timer.unref) timer.unref();
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      raw += chunk;
    });
    process.stdin.on('end', done);
    process.stdin.on('error', done);
  });
}

// The status line that was there before ours, run with the same stdin, so
// installing this one loses nothing.
function runPrevious(command, raw, env, budgetMs) {
  try {
    const result = spawnSync(command, {
      shell: true,
      input: raw,
      encoding: 'utf8',
      timeout: Math.max(300, Number.isFinite(budgetMs) ? budgetMs : CHAIN_TIMEOUT_MS),
      env: env || process.env,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    // A command that never reads its stdin - echo, most one-line status lines -
    // can exit before the JSON is written, and the write then fails with EPIPE.
    // That says nothing about the command, which ran and printed. Measured on a
    // Linux runner: the whole test took 85 ms, so no timeout was involved, and
    // the line was dropped anyway. Only the command's own failure drops it.
    if (result.status !== 0) return '';
    if (result.error && result.error.code !== 'EPIPE') return '';
    return String(result.stdout || '').replace(/\s+$/, '');
  } catch (err) {
    return '';
  }
}

function settingsFor(dir) {
  return readJson(path.join(dir, 'settings.json')) || {};
}

function clockFor(settings, env) {
  const e = env || process.env;
  if (e.USAGE_LIMITS_CLOCK === '24h') return '24h';
  if (e.USAGE_LIMITS_CLOCK === '12h') return '12h';
  const format = settings && typeof settings.timeFormat === 'string' ? settings.timeFormat : '';
  return format.indexOf('24') === 0 ? '24h' : '12h';
}

function motionOff(settings, env) {
  const e = env || process.env;
  const flag = String(e.USAGE_LIMITS_MOTION || '').toLowerCase();
  if (flag === 'off' || flag === '0' || flag === 'false') return true;
  return Boolean(settings && settings.prefersReducedMotion === true);
}

// Written and flushed before the process is allowed to end: stdout is a pipe
// here, and a pipe write can still be in flight when process.exit runs.
// The budget mode, for the token on the line. Wrapped and lazy: the status
// line must never fail over an optional word, and a machine that has never set
// a mode should not pay for a require to be told so.
function budgetNow(sessionId) {
  try {
    return require('./mode.js').forSession({ sessionId });
  } catch (err) {
    return null;
  }
}

function out(text) {
  return new Promise((resolve) => {
    process.stdout.write(text, () => resolve());
  });
}

async function main(argv) {
  const env = process.env;
  const started = Date.now();
  const now = started;
  let chained = '';
  try {
    usage.setHost(host.detect(argv || [], env));
    const raw = await readStdin();
    let input = null;
    try {
      input = raw.trim() ? JSON.parse(raw) : null;
    } catch (err) {
      input = null;
    }
    if (input && typeof input !== 'object') input = null;
    // Claude Code handing this its own status-line JSON settles which agent is
    // running, and it beats any guess made from the environment. Anyone with
    // CODEX_HOME set for their Codex install was otherwise detected as Codex
    // here and got a blank status line under Claude Code, with nothing to say
    // why - detection is only meant to be the fallback for a hand-run script.
    if (input && (input.session_id || input.model)) usage.setHost(host.CLAUDE);

    const state = statusline.readState();
    if (state && state.chain && state.previous && state.previous.type === 'command' && state.previous.command) {
      // Whatever the stdin wait used comes out of the previous line's time.
      chained = runPrevious(state.previous.command, raw, env, CHAIN_TIMEOUT_MS - (Date.now() - started));
    }

    let all = readFeed();
    if (input && input.session_id) {
      all = record(all, input, now);
      writeFeed(all);
    }

    const off = String(env.USAGE_LIMITS_STATUSLINE || '').toLowerCase();
    if (off === 'off' || off === '0' || off === 'false') {
      if (chained) await out(chained + '\n');
      return 0;
    }
    if (usage.isCodex()) {
      if (chained) await out(chained + '\n');
      return 0;
    }

    const slot = input && input.session_id ? all[input.session_id] : newest(all);
    const collected = usage.collect(now);
    const settings = settingsFor(configDir());
    const marks = activity.read();
    const mine = input && input.session_id ? input.session_id : null;
    // This session's own state; only with no session id at all does the
    // machine-wide picture stand in for it.
    const own = mine ? ownState(marks, mine, now) : activity.summarise(marks, now);
    // The other sessions working right now, so the line can say so.
    const othersWorking = activity
      .combine({ marks, feed: all }, now, activity.STALE_MS)
      .filter((row) => row.state === 'working' && row.sessionId !== mine).length;
    const built = view.build({
      now,
      agents: usage.liveAgents(now),
      budget: budgetNow(mine || (slot && slot.sessionId) || null),
      utilization: collected.utilization,
      fetchedAtMs: collected.snapshotFetchedAt,
      source: collected.snapshotSource,
      headers: slot ? slot.rateLimits : null,
      headersAt: slot ? slot.headersAt : null,
      model: slot ? slot.model : null,
      modelName: slot ? slot.modelName : null,
      // Claude Code hands this line the effort outright, and that value is
      // read first: the slot beside it was loaded from disk before this
      // update was stored, so on a session's very first line it is empty and
      // trusting it printed no effort at all until the second update. The
      // slot still answers for a build that sends none, and only when it has
      // none either is the transcript worth a look.
      effort:
        (input && input.effort && typeof input.effort.level === 'string' && input.effort.level)
          || (slot && slot.effort)
          || view.pickEffort(
              null,
              usage.liveEffort(mine || (slot && slot.sessionId) || null),
              collected.settings ? collected.settings.effortLevel : null
            ),
      working: own.working || (gapMeansWorking(settings) && isWorking(slot, now)),
      ultrathink: Boolean(own.ultrathink),
      ultracode: Boolean(own.ultracode) || settings.ultracode === true,
      settingsModel: collected.settings ? collected.settings.model : null,
      env,
    });
    // The other agent's meter, from its rollouts on disk. Required lazily and
    // guarded by a single stat, so a machine without Codex pays nothing, and
    // wrapped because a status line must never fail over an optional row.
    // USAGE_LIMITS_CODEX_ROW=off turns it off.
    built.codex = null;
    if (String(env.USAGE_LIMITS_CODEX_ROW || '').toLowerCase() !== 'off' && host.codexHasSessions()) {
      try {
        const codex = require('./codex.js');
        const other = codex.collect(now);
        const block = view.buildCodex({
          now,
          utilization: other.utilization,
          fetchedAtMs: other.snapshotFetchedAt,
          windowSpecs: other.windowSpecs,
          plan: other.plan,
          windowless: other.windowless,
        });
        if (block.present) built.codex = block;
      } catch (err) {
        // No Codex row, and the Claude line is unaffected.
      }
    }

    const drawn = {
      columns: Math.max(20, (Number(env.COLUMNS) || 80) - STATUSLINE_MARGIN),
      // Claude Code captures the output, so stdout is never a TTY here, and
      // ANSI is supported all the same.
      mode: bars.colourMode(env, true),
      tick: Math.floor(now / bars.TICK_MS),
      reduced: motionOff(settings, env),
      ascii: String(env.USAGE_LIMITS_ASCII || '') === '1',
      clock: clockFor(settings, env),
    };
    const text = line(built, drawn);
    // Underneath, on its own line. Claude Code draws every line the status
    // line prints, which is how a chained status line already works.
    const other = codexLine(built, drawn);
    await out((chained ? chained + '\n' : '') + text + (other ? '\n' + other : '') + '\n');
    return 0;
  } catch (err) {
    if (chained) await out(chained + '\n');
    return 0;
  }
}

module.exports = {
  KEEP_SESSIONS,
  WORKING_GAP_MS,
  CHAIN_TIMEOUT_MS,
  feedFile,
  readFeed,
  missFrom,
  writeFeed,
  slotFrom,
  record,
  newest,
  isWorking,
  stickySlot,
  STICKY_QUIET_MS,
  gapMeansWorking,
  ownState,
  line,
  codexLine,
  runPrevious,
  clockFor,
  motionOff,
  main,
};

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code || 0;
    },
    () => {
      process.exitCode = 0;
    }
  );
}
