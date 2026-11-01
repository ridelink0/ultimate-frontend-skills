#!/usr/bin/env node
'use strict';

// The panel: the session, weekly and per-model limits as live bars in a pane
// beside the Claude Code chat.
//
//   node scripts/panel.js              the live panel, q to quit
//   node scripts/panel.js --open       open it in a split pane to the right
//   node scripts/panel.js --once       one frame, for a pipe or a screenshot
//   node scripts/panel.js --json       the same frame as fields
//   node scripts/panel.js --no-fetch   never use the network
//
// Where the numbers come from, in order of freshness: the rate-limit headers
// on Claude's own API responses (recorded by the status line), the usage
// endpoint Claude Code calls for /usage (polled here), and Claude Code's own
// cache. Whichever is newest wins, and the footer says how old it is.
//
// Where the animation comes from: the hooks. A prompt marks the session as
// working, every tool call keeps it so, the Stop hook marks it idle. While
// Claude works the title shimmers and the spinner turns, in Claude's colours;
// under ultracode it turns rainbow, which is what Claude Code does too.

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');

const usage = require('./usage.js');
const host = require('./host.js');
const codex = require('./codex.js');
const bars = require('./bars.js');
const view = require('./view.js');
const live = require('./live.js');
const feed = require('./feed.js');
const activity = require('./activity.js');
const brief = require('./brief.js');

const SECOND = 1000;
const MINUTE = 60 * SECOND;
// How often to take a reading: quickly while Claude works, slowly while it
// waits. The status line feeds per-response figures in between.
const POLL_WORKING_MS = 30 * SECOND;
const POLL_IDLE_MS = 2 * MINUTE;
const POLL_FLOOR_MS = 15 * SECOND;
const FILE_CHECK_MS = SECOND;
const FRAME_MS = 100;
const MIN_COLUMNS = 24;
// The widest thing that follows a Codex bar, plus its space: "no reading" is
// ten characters and "100% left" is nine.
const CODEX_SUFFIX = 11;
const TITLE = 'Claude usage';
const LEVEL_RANK = { fill: 0, warning: 1, error: 2 };

const HELP = `claude-usage-limits panel - live limits in a pane beside the chat

  panel                the live panel; q or Esc quits, r takes a fresh reading
  panel --open         open the panel in a split pane to the right of this one
  panel --once         print one frame and exit
  panel --json         print one frame as JSON and exit
  panel --no-fetch     never use the network: show the reading already on disk
  panel --poll 45      seconds between readings (default 30 working, 120 idle)
  panel --width 40     draw for this many columns instead of the terminal's
  panel --ascii        plain characters instead of block glyphs
  panel --no-bell      no terminal bell when a window turns yellow or red

Shows the current session (5-hour) window, the current week, and the week for
the model in use when the account caps that model on its own. Bars turn yellow
at 80 percent and red at 90. Readings come from the same call Claude Code
makes for /usage, plus the rate-limit headers on Claude's own responses when
the status line is installed. USAGE_LIMITS_FETCH=off is the same as --no-fetch.
`;

function configDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    return null;
  }
}

function parseArgs(argv) {
  const args = {
    once: false,
    json: false,
    open: false,
    fetch: true,
    poll: null,
    width: null,
    help: false,
    ascii: String(process.env.USAGE_LIMITS_ASCII || '') === '1',
    bell: true,
    hostName: null,
  };
  const list = argv || [];
  for (let i = 0; i < list.length; i += 1) {
    const arg = list[i];
    if (arg === '--once') args.once = true;
    else if (arg === '--no-bell') args.bell = false;
    else if (arg === '--json') args.json = true;
    else if (arg === '--open') args.open = true;
    else if (arg === '--no-fetch') args.fetch = false;
    else if (arg === '--ascii') args.ascii = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--poll') args.poll = Number(list[++i]);
    else if (arg.indexOf('--poll=') === 0) args.poll = Number(arg.slice('--poll='.length));
    else if (arg === '--width') args.width = Number(list[++i]);
    else if (arg.indexOf('--width=') === 0) args.width = Number(arg.slice('--width='.length));
    else if (arg === '--host') args.hostName = list[++i] || null;
  }
  return args;
}

function settingsFor() {
  return readJson(path.join(configDir(), 'settings.json')) || {};
}

function accountUuid() {
  const account = readJson(usage.accountFile());
  return account && account.oauthAccount && account.oauthAccount.accountUuid ? account.oauthAccount.accountUuid : null;
}

// One frame's worth of facts. Reads every file the plugin keeps, takes a
// fresh reading when asked, and hands the lot to the display model.
async function snapshot(options) {
  const opts = options || {};
  const env = opts.env || process.env;
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  let outcome = opts.outcome || null;
  const onCodex = usage.isCodex();

  let collected;
  if (onCodex) {
    // Codex keeps its meter in its session rollouts and answers a live reading
    // through its own app-server, which is what /status shows. That is the
    // system Codex uses, so it is the one read here.
    let meter = null;
    if (opts.fetch) {
      try {
        meter = await codex.refresh();
        outcome = { ok: true };
      } catch (err) {
        outcome = { ok: false, kind: 'offline', message: (err && err.code) || 'codex did not answer' };
      }
    }
    collected = codex.collect(now, meter ? { meter } : undefined);
  } else {
    if (opts.fetch) {
      const result = await live.refresh({ now, accountUuid: accountUuid(), env, timeoutMs: opts.timeoutMs });
      outcome = result.outcome;
    }
    collected = usage.collect(now);
  }

  const login = onCodex ? null : accountUuid();
  const slots = onCodex ? {} : Object.fromEntries(Object.entries(feed.readFeed()).filter(([, slot]) => !login || slot.accountUuid === login));
  // Stay with the session already being described, so two windows on the same
  // model at different efforts do not make the header flip back and forth.
  const marks = onCodex ? {} : activity.read();
  // The session to describe: the one this display was already describing,
  // else the newest mark. Every session writes a mark, but only a terminal
  // session writes a feed slot, so choosing from the feed meant a VS Code
  // window with no status line was never the one described and its own
  // ultrathink never showed.
  const freshest = Object.keys(marks)
    .filter((key) => key !== '_' && marks[key] && Number.isFinite(marks[key].at) && now - marks[key].at <= activity.STALE_MS)
    .sort((a, b) => marks[b].at - marks[a].at)[0];
  const sticky = opts.sessionId && marks[opts.sessionId] && now - marks[opts.sessionId].at <= feed.STICKY_QUIET_MS;
  const described = (sticky ? opts.sessionId : null) || freshest || opts.sessionId || null;
  // A described session with no status line of its own (VS Code) must not be
  // dressed in another session's slot: that is how a Fable window came to say
  // Opus. Its transcript speaks for it instead. Only a panel with no session
  // at all falls back to the newest slot on the machine.
  const slot = (described && slots[described]) || (described ? null : feed.stickySlot(slots, opts.sessionId, now));
  const spoken = !onCodex && described && !slot ? usage.liveModel(described) : null;
  // The marks are machine-wide, and this panel describes ONE session. Reading
  // the machine-wide summary here is what let a prompt in another window put
  // ultrathink on this window's bars. When the session being described is
  // known, its own mark is the only one that speaks for it.
  // A panel that was given a session speaks for that session alone. A panel
  // with none of its own is the machine's, and there the newest working
  // session's word is the one shown - two windows in different modes would
  // otherwise make it depend on whose tool call landed last.
  const seen = onCodex
    ? { working: codexWorking(now), ultracode: false, ultrathink: false, model: null }
    : opts.sessionId && marks[opts.sessionId]
      ? Object.assign(feed.ownState(marks, opts.sessionId, now), {
          model: (marks[opts.sessionId] && marks[opts.sessionId].model) || null,
        })
      : activity.summarise(marks, now);
  const settings = onCodex ? {} : settingsFor();

  const built = view.build({
    now,
    utilization: collected.utilization,
    fetchedAtMs: collected.snapshotFetchedAt,
    source: onCodex ? (outcome && outcome.ok ? 'api' : 'cache') : collected.snapshotSource,
    windowSpecs: collected.windowSpecs || null,
    headers: slot ? slot.rateLimits : null,
    headersAt: slot ? slot.headersAt : null,
    model: (slot && slot.model) || seen.model || (spoken && spoken.model) || null,
    modelName: slot ? slot.modelName : null,
    // Whichever of the status line and the transcript spoke last. The setting
    // is only the last resort: a panel beside a VS Code window has no status
    // line to ask, and the setting there never moves, which is how it came to
    // report xhigh through a session running at max.
    effort: view.pickEffort(
      slot && slot.effort ? { effort: slot.effort, at: slot.at } : null,
      onCodex || !described ? null : usage.liveEffort(described),
      collected.settings ? collected.settings.effortLevel : null
    ),
    working: seen.working || feed.isWorking(slot, now),
    // Ultracode comes from the effort level above, not from here. Ultrathink
    // is a word in a prompt, and the hooks record it per session.
    ultrathink: Boolean(seen.ultrathink),
    ultracode: Boolean(seen.ultracode) || settings.ultracode === true,
    settingsModel: collected.settings ? collected.settings.model : null,
    outcome,
    env,
  });
  built.now = now;
  built.tokens = slot ? slot.tokens || null : null;
  built.sessionId = described || (slot && slot.sessionId) || null;
  built.host = onCodex ? 'codex' : 'claude';
  built.title = onCodex ? 'Codex usage' : TITLE;
  built.plan = collected.plan || null;
  if (onCodex && collected.windowless && !built.note) built.note = 'this plan meters no rolling window';
  // Every Claude on this machine, and which of them are working. Two windows
  // share one limit, so the other one's state is part of this one's picture.
  // Codex leaves no marks, so under Codex the list is empty rather than wrong.
  built.sessionsList = onCodex ? [] : loadSessions(now);
  built.sessions = onCodex ? 0 : Math.max(built.sessionsList.length, brief.liveSessions(brief.readCache(), now, brief.LIVE_WINDOW_MS, null));
  built.othersWorking = built.sessionsList.filter((row) => row.state === 'working').length;
  // What the pace says: when the binding window runs out at the current rate,
  // if that comes before its reset. The transcript scan behind it belongs to
  // the report, so it is taken with the readings, not with every frame; the
  // frames in between carry the last answer forward.
  built.pace = opts.pace !== undefined ? opts.pace : await paceOf(now);
  // The other agent's meter, drawn under this one's.
  //
  // Read from Codex's own rollouts on disk and nothing else: no child process,
  // no network, no waiting. Codex having nothing to say, or not being installed
  // at all, must never be a reason the Claude panel is late or absent.
  built.codex = null;
  if (!onCodex && host.codexHasSessions()) {
    try {
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
      // An unreadable Codex is simply no Codex row.
    }
  }
  // Whether the panel is allowed the network at all, which is what the footer
  // reports. A frame rebuilt from disk between readings is not "network off".
  built.fetch = opts.network !== undefined ? Boolean(opts.network) : Boolean(opts.fetch);
  built.outcome = outcome;
  return built;
}

// The report's runway: how long the binding window lasts at the pace of the
// last hour, measured from every session's spend. The percentage says where
// you are; this says when you hit the wall, which is the number the rival
// monitors lead with and the one that matters on a busy afternoon.
async function paceOf(now) {
  try {
    const data = await usage.report(now, {});
    const binding = data && data.binding;
    if (!binding || !Number.isFinite(binding.headroomMs)) return null;
    const resetsInMs = Number.isFinite(binding.resetsAt) ? binding.resetsAt - now : null;
    return {
      label: binding.label,
      headroomMs: binding.headroomMs,
      resetsInMs,
      turnsLeft: Number.isFinite(binding.turnsLeft) ? binding.turnsLeft : null,
      runsOut: binding.verdict === 'runs-out' || (resetsInMs !== null && binding.headroomMs < resetsInMs),
    };
  } catch (err) {
    return null;
  }
}

// Codex has no hooks to say when it is working, but it appends to its rollout
// file as it goes, so a rollout touched in the last few seconds is a turn in
// progress.
function codexWorking(now) {
  try {
    const recent = codex.rolloutFiles(now - 5 * SECOND);
    return recent.some((entry) => !Number.isFinite(entry.at) || entry.at >= now - 5 * SECOND);
  } catch (err) {
    return false;
  }
}

// Codex runs no hooks on this machine, so it writes no marks, and its sessions
// never appeared beside the Claudes. Its rollout files say what a mark would:
// a rollout appended in the last half minute is a session at work, one touched
// within the stale window is one idling. The first line of a rollout is the
// session's meta record - its id, its working directory, what launched it.
function codexSessions(now, opts) {
  const o = opts || {};
  const stale = Number.isFinite(o.staleMs) ? o.staleMs : activity.STALE_MS;
  const busyMs = Number.isFinite(o.busyMs) ? o.busyMs : 30 * SECOND;
  let files = [];
  try {
    files = Array.isArray(o.files) ? o.files : codex.rolloutFiles(now - stale);
  } catch (err) {
    return [];
  }
  const rows = [];
  for (const entry of files) {
    if (!entry || !Number.isFinite(entry.at) || entry.at < now - stale) continue;
    let meta = null;
    try {
      const fd = fs.openSync(entry.file, 'r');
      const buf = Buffer.alloc(4096);
      const n = fs.readSync(fd, buf, 0, 4096, 0);
      fs.closeSync(fd);
      const first = buf.toString('utf8', 0, n).split(String.fromCharCode(10))[0];
      const parsed = JSON.parse(first);
      meta = parsed && parsed.payload && typeof parsed.payload === 'object' ? parsed.payload : null;
    } catch (err) {
      meta = null;
    }
    const id = (meta && (meta.session_id || meta.id)) || path.basename(entry.file, '.jsonl');
    rows.push({
      key: 'codex:' + id,
      id,
      host: 'codex',
      state: entry.at >= now - busyMs ? 'working' : 'idle',
      stateAt: entry.at,
      lastAt: entry.at,
      model: null,
      modelName: 'Codex' + (meta && meta.originator ? ' (' + String(meta.originator) + ')' : ''),
      cwd: meta && meta.cwd ? String(meta.cwd) : null,
      ultracode: false,
      ultrathink: false,
    });
  }
  rows.sort((x, y) => y.lastAt - x.lastAt);
  return rows;
}

// Every session this machine has heard from lately: the Claudes from the
// files the hooks and the status line keep, and the Codexes from their own
// rollouts.
function loadSessions(now) {
  return claudeSessions(now).concat(codexSessions(now));
}

// The tally is required lazily: it requires usage.js back, and this module is
// loaded by the VS Code extension too.
function claudeSessions(now) {
  let tallyList = [];
  try {
    const tally = require('./tally.js');
    tallyList = tally.sessions(tally.readState());
  } catch (err) {
    tallyList = [];
  }
  return activity.combine(
    { marks: activity.read(), feed: feed.readFeed(), tally: tallyList, brief: brief.readCache() },
    now,
    brief.LIVE_WINDOW_MS
  );
}

// Where a session is working, as short as it can be said.
function whereLabel(row) {
  if (row.cwd) return path.basename(String(row.cwd)) || String(row.cwd);
  if (row.project) return usage.shortenProject(row.project, 18);
  return '';
}

// Cut a painted line to a width without leaving an escape open.
function fit(text, width) {
  if (bars.visibleWidth(text) <= width) return text;
  let out = '';
  let shown = 0;
  let i = 0;
  const s = String(text);
  while (i < s.length) {
    if (s[i] === '\x1b') {
      const match = s.slice(i).match(/^\x1b\[[0-9;?]*[ -/]*[@-~]/);
      if (match) {
        out += match[0];
        i += match[0].length;
        continue;
      }
    }
    if (shown >= width) break;
    const point = s.codePointAt(i);
    const ch = String.fromCodePoint(point);
    out += ch;
    shown += 1;
    i += ch.length;
  }
  // A reset only where there was colour to reset; plain text stays plain.
  return s.indexOf('\x1b') === -1 ? out : out + '\x1b[0m';
}

// In a narrow pane the titles are the short ones.
function shortTitle(row) {
  if (row.key === 'five_hour') return 'Session';
  if (row.key === 'seven_day') return 'Week';
  return String(row.title).replace(/^Current week /, 'Week ').replace(/^Current /, '');
}

// Codex's own row titles are already short; these are for a very narrow pane.
function shortCodexTitle(row) {
  if (row.key === 'five_hour') return '5h';
  if (row.key === 'seven_day') return 'Week';
  return String(row.title).replace(/ limit$/, '');
}

// The Codex rows say "left", so their sublines have to as well, and they must
// never point at a Claude Code command to fix a Codex reading.
function codexSubline(row, mode, opts) {
  if (row.stale) return bars.dim('window rolled over since Codex last ran', mode);
  if (row.percentLeft === null) return bars.dim('no reading yet', mode);
  const reset = bars.formatReset(row.msToReset, row.resetsAtMs, opts.now, { clock: opts.clock });
  return reset ? bars.dim(reset, mode) : '';
}

function subline(row, mode, opts) {
  if (row.stale) return bars.dim('window rolled over, taking a fresh reading', mode);
  if (row.unreported) return bars.dim('not reported yet, run /usage in Claude Code', mode);
  if (row.idle) return bars.dim('nothing in this window yet', mode);
  if (row.percent === null) return bars.dim('no reading yet', mode);
  const reset = bars.formatReset(row.msToReset, row.resetsAtMs, opts.now, { clock: opts.clock });
  return reset ? bars.dim(reset, mode) : '';
}

// Seconds while it is seconds; the report's formatter rounds to minutes, which
// reads as "0m ago" for a reading taken just now.
function since(ms) {
  if (!Number.isFinite(ms)) return '';
  if (ms < 60 * SECOND) return Math.max(0, Math.round(ms / SECOND)) + 's';
  return usage.formatDuration(ms);
}

// The freshness footer as separate bits, so a narrow pane can stack them
// rather than cut them.
function stateBits(built) {
  const bits = [];
  if (built.state === 'none') bits.push('no reading yet');
  else if (built.state === 'live') bits.push('live' + (Number.isFinite(built.ageMs) ? ', updated ' + since(built.ageMs) + ' ago' : ''));
  else bits.push('cached' + (Number.isFinite(built.ageMs) ? ', reading from ' + since(built.ageMs) + ' ago' : ''));
  if (built.fetch === false) bits.push('network off');
  return bits;
}

function stateLines(built, mode, width) {
  const bits = stateBits(built);
  const joined = bits.join(' · ');
  if (joined.length <= width) return [bars.dim(joined, mode)];
  return bits.map((bit) => bars.dim(bit, mode));
}

function noteColour(built) {
  const kind = built.outcome && !built.outcome.ok ? built.outcome.kind : null;
  if (kind === 'unauthorized' || kind === 'forbidden' || kind === 'no_credentials') return bars.THEME.error;
  if (kind === 'offline' || kind === 'expired' || kind === 'rate_limited' || kind === 'server' || kind === 'http' || kind === 'bad_response') {
    return bars.THEME.warning;
  }
  return null;
}

// The frame, as lines. Fits any width from MIN_COLUMNS up and any height,
// dropping breathing room first and footers second.
function render(built, options) {
  const opts = options || {};
  // Laid out for at least MIN_COLUMNS, but cut to the width that really
  // exists: a line wider than the pane wraps, and a wrapped frame scrolls.
  const real = Number.isFinite(opts.columns) ? Math.max(1, Math.floor(opts.columns)) : 40;
  const columns = Math.max(MIN_COLUMNS, real);
  const height = Number.isFinite(opts.rows) ? Math.floor(opts.rows) : null;
  const mode = opts.mode || 'none';
  const tick = Number.isFinite(opts.tick) ? opts.tick : 0;
  const reduced = Boolean(opts.reduced);
  const ascii = Boolean(opts.ascii);
  const now = Number.isFinite(opts.now) ? opts.now : built.now || Date.now();
  const clock = opts.clock || '12h';
  const barWidth = Math.max(8, Math.min(50, columns - 6));
  const animate = built.working && !reduced;

  // The title is Claude's orange, shimmering while Claude works, and nothing
  // else: the rainbow and the purple belong to the bars.
  const glyph = built.working
    ? bars.paint(bars.spinner(tick, { ascii, reduced }), bars.THEME.claude, mode)
    : bars.paint(ascii ? '*' : '✻', bars.THEME.claude, mode);
  const titleText = built.title || TITLE;
  const title = animate
    ? bars.shimmer(titleText, tick, bars.THEME.claude, bars.THEME.claudeShimmer, { mode, reduced })
    : bars.paint(titleText, bars.THEME.claude, mode);

  const effortName = built.effort;
  const effort = effortName ? bars.effortColour(effortName) : null;
  const effortText = !effortName
    ? ''
    : effort.rainbow
      ? bars.rainbow(effortName, tick, { mode, reduced })
      : effort.shimmer && animate
        ? bars.shimmer(effortName, tick, effort.rgb, effort.shimmer, { mode, reduced })
        : bars.paint(effortName, effort.rgb, mode);
  const status = built.working ? 'working' : 'idle';
  const thinking = built.ultrathink
    ? bars.rainbow('ultrathink', tick, { mode, reduced })
    : '';
  const who = [built.modelLabel, effortText, thinking, bars.dim(status, mode)].filter(Boolean).join(bars.dim(' · ', mode));

  const head = [glyph + ' ' + bars.bold(title, mode), who];
  const body = [];
  for (const row of built.rows) {
    const percent =
      row.level === 'fill' ? row.percentText : bars.paint(row.percentText, bars.levelColour(row.level), mode);
    body.push({
      lines: [
        bars.bold(columns < 34 ? shortTitle(row) : row.title, mode),
        (row.percent === null
          ? bars.paint((ascii ? '-' : '░').repeat(barWidth), bars.THEME.empty, mode)
          : bars.bar(row.percent, barWidth, { mode, level: row.level, ascii, tick, reduced, style: built.style })) +
          ' ' +
          percent,
        subline(row, mode, { now, clock }),
      ].filter((line) => line !== ''),
    });
  }

  // The Codex block, in the same shapes and the same colours, counting the
  // other way: Codex reports what is LEFT, so its bars drain as they are spent
  // where Claude's fill. The mark is a plain hexagon rather than the Codex
  // logo, which is OpenAI's Blossom and not ours to recolour.
  if (built.codex && built.codex.rows.length) {
    const block = built.codex;
    const lines = [
      bars.bold(bars.paint(block.title, bars.THEME.codex, mode), mode),
    ];
    // "85% left" is five characters wider than "85%", so the Codex bars get
    // their own width. Sharing the Claude one clipped every Codex row.
    const codexWidth = Math.max(6, Math.min(50, columns - CODEX_SUFFIX));
    for (const row of block.rows) {
      const percent =
        row.level === 'fill' ? row.percentText : bars.paint(row.percentText, bars.levelColour(row.level), mode);
      lines.push(bars.bold(columns < 34 ? shortCodexTitle(row) : row.title, mode));
      lines.push(
        (row.percentLeft === null
          ? bars.paint((ascii ? '-' : '░').repeat(codexWidth), bars.THEME.empty, mode)
          : // No ultracode or ultrathink styling here: those describe how this
            // Claude is running and have nothing to do with the other agent.
            bars.bar(row.percentLeft, codexWidth, { mode, level: row.level, ascii, tick, reduced })) +
          ' ' +
          percent
      );
      const sub = codexSubline(row, mode, { now, clock });
      if (sub) lines.push(sub);
    }
    const tail = [];
    if (block.plan) tail.push(block.plan);
    if (block.note) tail.push(block.note);
    else if (Number.isFinite(block.ageMs)) tail.push('reading from ' + since(block.ageMs) + ' ago');
    if (tail.length) lines.push(bars.dim(tail.join(' · '), mode));
    body.push({ lines });
  }

  // The other Claudes. One row each: what it runs, where, and whether it is
  // working right now, with its own spinner when it is.
  const list = Array.isArray(built.sessionsList) ? built.sessionsList : [];
  if (list.length) {
    const working = list.filter((row) => row.state === 'working').length;
    const idle = list.length - working;
    const summary = [working ? working + ' working' : null, idle ? idle + ' idle' : null].filter(Boolean).join(', ');
    const lines = [bars.bold('Sessions', mode) + bars.dim(' · ' + summary, mode)];
    const shown = list.slice(0, 5);
    for (const row of shown) {
      const busy = row.state === 'working';
      const glyph = busy
        ? row.ultracode
          ? bars.rainbow(bars.spinner(tick, { ascii, reduced }), tick, { mode, reduced })
          : bars.paint(bars.spinner(tick, { ascii, reduced }), bars.THEME.claude, mode)
        : bars.dim(ascii ? '.' : '·', mode);
      // A session the status line has not described is still a Claude.
      const name = row.modelName || (row.model ? bars.prettyModel(row.model) : 'Claude');
      const where = whereLabel(row);
      const state = busy
        ? bars.paint('working', bars.THEME.claude, mode)
        : bars.dim('idle ' + since(now - row.lastAt) + ' ago', mode);
      const parts = [glyph + ' ' + name];
      if (where && columns >= 36) parts.push(bars.dim(where, mode));
      parts.push(state);
      lines.push(parts.join('  '));
    }
    if (list.length > shown.length) lines.push(bars.dim('+' + (list.length - shown.length) + ' more', mode));
    body.push({ lines });
  }

  const footer = [];
  for (const line of require('./tokens.js').lines(built.tokens)) footer.push(line);
  if (!list.length && built.sessions > 1) footer.push(bars.dim(built.sessions + ' sessions sharing this budget', mode));
  if (built.note) {
    const colour = noteColour(built);
    footer.push(colour ? bars.paint(built.note, colour, mode) : bars.dim(built.note, mode));
  }
  if (built.pace && built.pace.runsOut && Number.isFinite(built.pace.headroomMs)) {
    // The longest form that fits: a sentence in a wide pane, a phrase in a
    // narrow one, never a sentence cut off halfway.
    const left = usage.formatDuration(built.pace.headroomMs);
    const turns = Number.isFinite(built.pace.turnsLeft) ? ', about ' + built.pace.turnsLeft + ' turns' : '';
    const forms = [
      'at this pace the ' + built.pace.label + ' window runs out in ' + left + turns,
      'runs out in ' + left + ' at this pace' + turns,
      'runs out in ' + left + ' at this pace',
      'wall in ' + left,
    ];
    const text = forms.find((form) => form.length <= real) || forms[forms.length - 1];
    const colour = built.pace.headroomMs < 10 * MINUTE ? bars.THEME.error : built.pace.headroomMs < 30 * MINUTE ? bars.THEME.warning : null;
    footer.push(colour ? bars.paint(text, colour, mode) : bars.dim(text, mode));
  }
  for (const line of stateLines(built, mode, real)) footer.push(line);
  if (opts.interactive !== false) footer.push(bars.dim('q quit · r refresh', mode));

  // Full layout first, then without spacers, then without the footer.
  const compose = (spacers, withFooter) => {
    const lines = head.slice();
    for (const section of body) {
      if (spacers) lines.push('');
      for (const line of section.lines) lines.push(line);
    }
    if (withFooter) {
      if (spacers) lines.push('');
      for (const line of footer) lines.push(line);
    }
    return lines;
  };
  let lines = compose(true, true);
  if (height !== null && lines.length > height) lines = compose(false, true);
  if (height !== null && lines.length > height) lines = compose(false, false);
  if (height !== null && lines.length > height) lines = lines.slice(0, height);
  return lines.map((line) => fit(line, real));
}

function quote(value) {
  return '"' + String(value).replace(/"/g, '\\"') + '"';
}

// How to put the panel in a pane to the right of the current one, for the
// terminals that can be told to. Pure, so the table can be tested.
function openCommand(env, panelPath, nodePath, platform, extraArgs, options) {
  const e = env || process.env;
  const os = platform || process.platform;
  const node = nodePath || process.execPath;
  const panel = panelPath || __filename;
  const extra = Array.isArray(extraArgs) ? extraArgs.map(String) : [];
  const cmd = [quote(node), quote(panel)].concat(extra.map(quote)).join(' ');

  if (e.TMUX) {
    // A percentage on -l arrived in tmux 3.1; older ones want the old -p.
    const version = options && options.tmuxVersion ? String(options.tmuxVersion).match(/(\d+)\.(\d+)/) : null;
    const old = version && (Number(version[1]) < 3 || (Number(version[1]) === 3 && Number(version[2]) < 1));
    return {
      program: 'tmux',
      args: ['split-window', '-h', '-d'].concat(old ? ['-p', '24'] : ['-l', '24%'], [cmd]),
      note: 'opened a pane to the right in tmux',
    };
  }
  if (e.WEZTERM_PANE) {
    return {
      program: 'wezterm',
      args: ['cli', 'split-pane', '--right', '--percent', '24', '--', node, panel].concat(extra),
      note: 'opened a pane to the right in WezTerm',
    };
  }
  if (e.KITTY_WINDOW_ID) {
    return {
      program: 'kitten',
      args: ['@', 'launch', '--location=vsplit', '--bias=24', '--cwd=current', node, panel].concat(extra),
      note: 'opened a pane to the right in kitty (needs allow_remote_control)',
    };
  }
  if (e.ZELLIJ) {
    return {
      program: 'zellij',
      args: ['action', 'new-pane', '-d', 'right', '--', node, panel].concat(extra),
      note: 'opened a pane to the right in zellij',
    };
  }
  if (os === 'win32') {
    if (e.WT_SESSION) {
      return {
        command:
          'start "" wt.exe -w 0 sp -V --size 0.24 --title "Claude usage" --suppressApplicationTitle ' + cmd,
        shell: true,
        note: 'opened a pane to the right in Windows Terminal',
      };
    }
    return {
      command: 'start "Claude usage" ' + cmd,
      shell: true,
      note: 'opened the panel in a new terminal window (run this from inside Windows Terminal to get a split pane)',
    };
  }
  if (String(e.TERM_PROGRAM || '') === 'iTerm.app') {
    const script =
      'tell application "iTerm2" to tell current session of current window to split vertically with default profile command ' +
      quote(cmd);
    return { program: 'osascript', args: ['-e', script], note: 'opened a pane to the right in iTerm2' };
  }
  return null;
}

function tmuxVersion() {
  try {
    const result = require('child_process').spawnSync('tmux', ['-V'], { encoding: 'utf8', timeout: 2000, windowsHide: true });
    return result && result.stdout ? String(result.stdout).trim() : null;
  } catch (err) {
    return null;
  }
}

function openPanel(env, extraArgs) {
  const e = env || process.env;
  const plan = openCommand(e, __filename, process.execPath, process.platform, extraArgs, {
    tmuxVersion: e.TMUX ? tmuxVersion() : null,
  });
  if (!plan) {
    process.stdout.write(
      'This terminal cannot be told to split. Open a second pane to the right and run:\n  ' +
        quote(process.execPath) +
        ' ' +
        quote(__filename) +
        '\n'
    );
    return 0;
  }
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(plan.command || plan.program, plan.args || [], {
        shell: Boolean(plan.shell),
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      });
    } catch (err) {
      process.stderr.write('panel: could not start ' + (plan.program || 'the terminal') + ': ' + err.message + '\n');
      return resolve(1);
    }
    child.on('error', (err) => {
      process.stderr.write('panel: could not start ' + (plan.program || 'the terminal') + ': ' + err.message + '\n');
      resolve(1);
    });
    // Give a launcher that fails fast a moment to say so; otherwise get out of
    // its way.
    setTimeout(() => {
      child.unref();
      process.stdout.write(plan.note + '\n');
      resolve(0);
    }, 300);
  });
}

function pollBase(built, args, env) {
  const configured = Number.isFinite(args.poll) && args.poll > 0 ? args.poll * SECOND : Number((env || process.env).USAGE_LIMITS_POLL) * SECOND;
  if (Number.isFinite(configured) && configured > 0) return Math.max(POLL_FLOOR_MS, configured);
  return built && built.working ? POLL_WORKING_MS : POLL_IDLE_MS;
}

async function interactive(args) {
  const out = process.stdout;
  const env = process.env;
  const settings = settingsFor();
  const reduced = feed.motionOff(settings, env);
  const clock = feed.clockFor(settings, env);
  const mode = bars.colourMode(env, out.isTTY);
  const fetch = args.fetch && !live.fetchDisabled(env);
  const bell = args.bell && String(env.USAGE_LIMITS_BELL || '').toLowerCase() !== 'off';

  const state = {
    levels: {},
    built: null,
    outcome: null,
    lastFetchAt: 0,
    delayMs: 0,
    fetching: false,
    lastFrame: '',
    lastTick: -1,
    lastCheck: 0,
    dirty: true,
    stopped: false,
  };

  const leave = () => {
    if (state.stopped) return;
    state.stopped = true;
    try {
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
    } catch (err) {
      // Not a TTY any more; nothing to restore.
    }
    out.write('\x1b[0m\x1b[?25h\x1b[?1049l');
  };
  out.write('\x1b[?1049h\x1b[?25l\x1b[H\x1b[2J');
  process.on('exit', leave);
  process.on('SIGINT', () => {
    leave();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    leave();
    process.exit(0);
  });
  out.on('resize', () => {
    state.dirty = true;
  });

  if (process.stdin.isTTY) {
    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('keypress', (ch, key) => {
      const name = key && key.name;
      if (name === 'q' || name === 'escape' || (key && key.ctrl && name === 'c')) {
        leave();
        process.exit(0);
      }
      if (name === 'r') {
        state.lastFetchAt = 0;
        state.delayMs = 0;
        state.dirty = true;
      }
    });
  }

  const draw = (now) => {
    const width = Number.isFinite(args.width) && args.width > 0 ? args.width : out.columns || 40;
    const lines = render(state.built, {
      columns: width,
      rows: out.rows || null,
      tick: Math.floor(now / bars.TICK_MS),
      mode,
      reduced,
      ascii: args.ascii,
      now,
      clock,
    });
    const frame = lines.map((line) => '\x1b[2K' + line).join('\n') + '\x1b[J';
    if (frame === state.lastFrame && !state.dirty) return;
    state.lastFrame = frame;
    state.dirty = false;
    out.write('\x1b[H' + frame);
  };

  const step = async () => {
    if (state.stopped) return;
    const now = Date.now();
    const due = fetch && !state.fetching && now - state.lastFetchAt >= state.delayMs;
    if (due) {
      // The reading runs beside the frames, never in front of them: a slow
      // network must not freeze the spinner or the countdown.
      state.fetching = true;
      snapshot({ fetch: true, network: fetch, env, now, sessionId: state.built ? state.built.sessionId : null })
        .then((built) => {
          state.built = built;
          state.outcome = built.outcome;
        })
        .catch((err) => {
          state.outcome = { ok: false, kind: 'bad_response', message: err && err.message ? err.message : String(err) };
        })
        .then(() => {
          state.lastFetchAt = Date.now();
          state.delayMs = live.nextDelayMs(state.outcome, state.delayMs, {
            baseMs: pollBase(state.built, args, env),
            maxMs: POLL_IDLE_MS,
          });
          state.fetching = false;
          state.dirty = true;
        });
    }
    if (!state.built || now - state.lastCheck >= FILE_CHECK_MS) {
      state.lastCheck = now;
      try {
        state.built = await snapshot({
          fetch: false,
          network: fetch,
          env,
          now,
          outcome: state.outcome,
          pace: state.built ? state.built.pace : null,
          sessionId: state.built ? state.built.sessionId : null,
        });
      } catch (err) {
        // Keep the last frame; a transient read error is not worth a blank.
      }
      // One bell when a window first turns yellow, another when it turns red.
      if (bell && state.built) {
        for (const row of state.built.rows) {
          const before = state.levels[row.key];
          if (before !== undefined && LEVEL_RANK[row.level] > LEVEL_RANK[before]) out.write('\x07');
          state.levels[row.key] = row.level;
        }
      }
      // A window that rolled over deserves a reading sooner than the timer.
      if (fetch && state.built && state.built.rows.some((row) => row.stale) && state.delayMs > 5 * SECOND) {
        state.delayMs = 5 * SECOND;
      }
    }
    if (state.built) {
      const tick = Math.floor(Date.now() / bars.TICK_MS);
      const animating = (state.built.working || state.built.ultracode || state.built.ultrathink) && !reduced;
      if (state.dirty || (animating && tick !== state.lastTick) || now - state.lastCheck < FRAME_MS) {
        state.lastTick = tick;
        draw(Date.now());
      }
    }
    if (!state.stopped) setTimeout(step, FRAME_MS);
  };
  await step();
  return new Promise(() => {});
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(HELP);
    return 0;
  }
  usage.setHost(host.detect(argv || [], process.env));
  if (args.open) return openPanel(process.env, args.hostName ? ['--host', args.hostName] : []);

  const once = args.once || args.json || !process.stdout.isTTY;
  if (once) {
    const network = args.fetch && !live.fetchDisabled(process.env);
    const built = await snapshot({ fetch: network, network, env: process.env });
    if (args.json) {
      process.stdout.write(JSON.stringify(built, null, 2) + '\n');
      return 0;
    }
    const settings = settingsFor();
    const lines = render(built, {
      columns: Number.isFinite(args.width) && args.width > 0 ? args.width : process.stdout.columns || 40,
      tick: 0,
      mode: bars.colourMode(process.env, process.stdout.isTTY),
      reduced: true,
      ascii: args.ascii,
      clock: feed.clockFor(settings, process.env),
      interactive: false,
    });
    process.stdout.write(lines.join('\n') + '\n');
    return 0;
  }
  return interactive(args);
}

module.exports = {
  codexSessions,
  HELP,
  TITLE,
  MIN_COLUMNS,
  POLL_WORKING_MS,
  POLL_IDLE_MS,
  parseArgs,
  settingsFor,
  snapshot,
  loadSessions,
  whereLabel,
  fit,
  since,
  render,
  openCommand,
  pollBase,
  main,
};

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => {
      if (Number.isFinite(code)) process.exitCode = code;
    },
    (err) => {
      process.stderr.write('panel: ' + (err && err.message ? err.message : String(err)) + '\n');
      process.exitCode = 1;
    }
  );
}
