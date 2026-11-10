'use strict';

// Carrying a project across the reset.
//
// The old shape of the last hour before a limit was: notice the wall, write a
// plan, stop. The plan then sat in a dead terminal until somebody came back and
// read it. Everything the session knew - the files it had open, the half-made
// decision, the reason the second approach was abandoned - went with the
// window.
//
// The relay is the other half of that handoff. While there is still budget it
// arms a one-shot wake a few minutes after the window resets, and at that
// moment it hands the stored continuation back to the same conversation. The
// arming costs nothing and changes nothing about the work in progress; that is
// the point. Nobody should slow down to prepare for a wall.
//
// What this is NOT: a way to run an agent the user did not ask for. It is off
// until switched on, it only arms while there is a plan or a todo list to carry
// (an idle chat is not a project), and its default delivery is a notification,
// not a launch. Nothing here starts work unattended unless somebody chose that
// outright.
//
// Claude Code has its own version of this - autoContinueAtUsageLimit waits
// inside an open session and continues when the limit lifts - and where that
// applies it is better, because the process never dies. It is documented not to
// offer the wait for -p runs or background sessions, and it cannot help a
// terminal that has been closed, a machine that slept, or Codex. It also sends
// a fixed prompt of its own rather than the plan the session actually wrote.
// That is the gap this fills, and the reason it defers: when the native wait is
// what fired, the relay stands down.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const atomic = require('./atomic.js');
const host = require('./host.js');
const voice = require('./voice.js');
const lowpri = require('./lowpri.js');

const MINUTE = 60 * 1000;

const DEFAULTS = {
  // Off. Scheduling an agent to run while nobody is watching is a decision
  // somebody has to make on purpose.
  enabled: false,
  // Where the safety net goes up. Not a wall and not a warning: at this point
  // the session carries on exactly as before, and a wake is prepared in case
  // the budget runs out before the work does.
  at: 75,
  // Long enough after the reset that the meter has actually turned over. The
  // endpoint's reset time is the moment the window opens, and a request one
  // second later has been refused before.
  graceMinutes: 5,
  // notify  - raise a toast and leave the continuation on disk (default)
  // resume  - hand the continuation back to the conversation itself
  mode: 'notify',
  // off | resume | always. Only the middle one is free: 'always' changes a
  // Claude Code setting, and says so.
  thinking: 'resume',
  // Not restored by --resume. Whatever was in force in the session is gone at
  // wake time, so it is stated or the resumed run sits waiting for a person.
  permissionMode: null,
  model: null,
  // If the reading says the window has not turned over yet, try again this
  // many times before giving up and leaving a note.
  attempts: 3,
  // What to do when the user is at the keyboard when the wake fires. Their
  // session is the one that matters; a second agent in the same directory is
  // a way to lose work.
  whenBusy: 'notify',
  // WHERE IN THE TURN the arming happens.
  //
  //   threshold  the moment the window crosses `at`, which is mid-reply. What
  //              gets carried is whatever state the reply happened to be in.
  //   completion the end of the reply. The work has reached a boundary, the
  //              todo list is current, and the continuation describes
  //              something finished rather than something interrupted.
  //
  // 'completion' is the default because the difference is not cosmetic: a
  // continuation captured halfway through a tool call describes a state the
  // next session cannot resume from cleanly.
  armOn: 'completion',
  // The exception to waiting for a boundary. Past this, arm immediately
  // whatever the turn is doing - a relay that politely waits for a completion
  // that never comes, because the limit cut the reply off mid-sentence, is a
  // relay that was never armed at all.
  backstopAt: 95,
  // Being offline is not failing. These are the retries reserved for a machine
  // that cannot reach the API, and the minutes between them. Twelve at ten
  // minutes covers two hours of a router being off, which is the common case.
  offlineAttempts: 12,
  offlineRetryMinutes: 10,
  // Run the resumed session in a window you can see. Invisible is tidier and
  // it is also how you find out in the morning that nothing happened and have
  // no idea why.
  show: true,
  // Hand the work to a NEW conversation instead of resuming the old one.
  //
  // Off, the wake runs `claude --resume <id>`: the same conversation, with
  // everything it already holds. That is today's behaviour and stays the
  // default. On, it starts `claude` in the project with the whole hand-off as
  // its first prompt, so a session that has grown long hands its work on
  // instead of dragging its whole context into the next window (Gev,
  // 2026-09-29). Claude Code only; a Codex wake resumes its thread either way.
  fresh: false,
  // The hand-off carries how the user writes, so the resumed session answers
  // in their voice without being reminded; and it asks for the two bug passes
  // the user asks for on nearly every request. Both can be turned off.
  voice: true,
  bugcheck: 'on',
  // What happens after a wake fails for a reason that will not fix itself:
  // arm again for the next window, or stop and leave it to a person.
  onFailure: 'rearm',
  // And how many times it may do that. Without a cap, "arm again for the next
  // window" is a scheduled task that reschedules itself forever, which is a
  // worse failure than giving up: it is invisible, it never ends, and nobody
  // asked for it. Two rearms means the work gets three windows to happen in.
  maxRearms: 2,
  // Keep the full stdout and stderr of every resumed run on disk. It is the
  // only record of what happened while nobody was watching.
  runLog: true,
};

function configDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

function relayFile() {
  return path.join(configDir(), 'usage-limits-relay.json');
}

function logFile() {
  return path.join(configDir(), 'usage-limits-relay.log');
}

// Every resumed run's full output, kept per run. `relay log --run` reads the
// newest one back. Without this a failed overnight wake leaves one line in the
// note log and nothing to diagnose it with.
function runLogDir() {
  return path.join(configDir(), 'relay-runs');
}

function runLogFile(id, now) {
  const stamp = new Date(Number.isFinite(now) ? now : Date.now()).toISOString().replace(/[:.]/g, '-');
  return path.join(runLogDir(), String(id).slice(0, 8) + '-' + stamp + '.log');
}

function writeRunLog(file, text) {
  try {
    fs.mkdirSync(runLogDir(), { recursive: true });
    fs.writeFileSync(file, String(text == null ? '' : text), 'utf8');
    // Ten runs is more history than anyone reads and less than a directory
    // nobody ever cleans.
    const kept = fs.readdirSync(runLogDir()).filter((name) => name.endsWith('.log')).sort();
    for (const stale of kept.slice(0, Math.max(0, kept.length - 10))) {
      try {
        fs.unlinkSync(path.join(runLogDir(), stale));
      } catch (err) {
        // A log that will not delete is not worth a failed wake.
      }
    }
    return file;
  } catch (err) {
    return null;
  }
}

function latestRunLog() {
  try {
    const names = fs.readdirSync(runLogDir()).filter((name) => name.endsWith('.log')).sort();
    if (!names.length) return null;
    const file = path.join(runLogDir(), names[names.length - 1]);
    return { file, text: fs.readFileSync(file, 'utf8') };
  } catch (err) {
    return null;
  }
}

function planFile(id) {
  return path.join(configDir(), 'usage-limits-relay-' + String(id).replace(/[^A-Za-z0-9_-]/g, '') + '.md');
}

function note(line, now) {
  try {
    fs.appendFileSync(logFile(), new Date(Number.isFinite(now) ? now : Date.now()).toISOString() + '  ' + line + '\n');
  } catch (err) {
    // A log that cannot be written must not stop the thing it is logging.
  }
}

function empty() {
  return { version: 1, config: {}, armed: null, history: [] };
}

function read() {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(relayFile(), 'utf8'));
  } catch (err) {
    return empty();
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return empty();
  return {
    version: 1,
    config: parsed.config && typeof parsed.config === 'object' && !Array.isArray(parsed.config) ? parsed.config : {},
    armed: parsed.armed && typeof parsed.armed === 'object' && !Array.isArray(parsed.armed) ? parsed.armed : null,
    history: Array.isArray(parsed.history) ? parsed.history.slice(-10) : [],
    ...(Array.isArray(parsed.others) && parsed.others.length
      ? { others: parsed.others.filter((r) => r && typeof r === 'object' && !Array.isArray(r) && r.id) }
      : {}),
  };
}

/* ------------------------------------------------- more than one session -- */

// state.armed is the record armed first; every further session's record waits
// in state.others, each with its own scheduled task. Two sessions arming on
// the same night is the normal case (the plugin was tried ten times before
// this and one of the failures was the second session being refused), so
// nothing displaces anything: a session can only replace or cancel its own.
function records(state) {
  return [state && state.armed, ...(state && Array.isArray(state.others) ? state.others : [])].filter(Boolean);
}
function armedFor(state, id) {
  if (!id) return null;
  return records(state).find((r) => r && r.id === id) || null;
}
function putRecord(state, record) {
  if (!state.armed || state.armed.id === record.id) { state.armed = record; return; }
  const rest = (Array.isArray(state.others) ? state.others : []).filter((r) => r.id !== record.id);
  rest.push(record);
  state.others = rest;
}
function dropRecord(state, id) {
  const rest = Array.isArray(state.others) ? state.others.filter((r) => r.id !== id) : [];
  if (state.armed && state.armed.id === id) state.armed = rest.shift() || null;
  if (rest.length) state.others = rest;
  else delete state.others;
}

/* ------------------------------------------------- what stops a resume ---- */

// Startup trust belongs to Claude Code and the user. This diagnostic reads
// the existing answers but never creates or changes them.
function claudeJsonFile() {
  if (process.env.CLAUDE_CONFIG_DIR) return path.join(process.env.CLAUDE_CONFIG_DIR, '.claude.json');
  return path.join(os.homedir(), '.claude.json');
}
function projectKeys(cwd) {
  const raw = String(cwd || '').replace(/[\\/]+$/, '');
  if (!raw) return [];
  const fwd = raw.replace(/\\/g, '/');
  const back = raw.replace(/\//g, '\\');
  return [...new Set(process.platform === 'win32' ? [raw, fwd, back] : [raw])];
}
// Claude Code never writes trust for the home folder itself (its security
// page says so, and 2026-09-20 proved it), so a session that lives in $HOME
// is resumed from a small folder under the config dir that can be trusted,
// with --add-dir pointing back at the real one. --resume <id> finds the
// transcript from anywhere on 2.1.223 and later.
function isHome(dir) {
  const norm = (p) => String(p || '').replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase();
  return Boolean(dir) && norm(dir) === norm(os.homedir());
}
function launchDirFor(cwd) {
  if (!isHome(cwd)) return cwd;
  const dir = path.join(configDir(), 'relay-cwd');
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
  }
  return dir;
}
// There is deliberately no general settings.json writer here. It once existed
// to pre-answer the bypass-permissions warning; permission and trust answers
// belong to the user inside Claude Code. The one key this file changes is
// alwaysThinkingEnabled, and only through the `relay thinking always` command.

function preflightPrompts(cwd, config, options) {
  const file = claudeJsonFile();
  let raw = null;
  let parsed = {};
  try {
    raw = fs.readFileSync(file, 'utf8');
    parsed = JSON.parse(raw.replace(/^\uFEFF/, ''));
  } catch (err) {
    if (raw !== null) return { ok: false, file, error: file + ' is not readable JSON; left untouched', changes: [] };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, file, error: file + ' is not an object; left untouched', changes: [] };
  const projects = parsed.projects && typeof parsed.projects === 'object' ? parsed.projects : {};
  const trusted = projectKeys(cwd).some((key) => projects[key] && projects[key].hasTrustDialogAccepted === true);
  return {
    ok: true, file, changes: [],
    pending: trusted ? [] : ['folder trust for ' + cwd + ' must be accepted in Claude Code by the user'],
    dry: true,
  };
}

// Written to a sibling and renamed into place. Two hooks can run at once, and a
// reader that lands between the truncate and the write of a plain writeFileSync
// sees half a file; the rename is the only step another process can observe.
function writeAtomic(file, text) {
  atomic.writeFileAtomic(file, text);
}

function write(state) {
  try {
    fs.mkdirSync(configDir(), { recursive: true });
    writeAtomic(relayFile(), JSON.stringify(state, null, 2) + '\n');
    return true;
  } catch (err) {
    return false;
  }
}

// File first, then environment, then the defaults. The environment wins over
// the file so a single run can be steered without editing anything, which is
// also how every other setting in this plugin behaves.
function settings(state) {
  const held = state || read();
  const env = process.env;
  const stored = held.config || {};
  const bool = (value, fallback) => {
    if (value === undefined || value === null || value === '') return fallback;
    const text = String(value).toLowerCase();
    if (['1', 'on', 'true', 'yes'].includes(text)) return true;
    if (['0', 'off', 'false', 'no'].includes(text)) return false;
    return fallback;
  };
  const number = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const pick = (value, allowed, fallback) => {
    const text = value === undefined || value === null ? '' : String(value).toLowerCase();
    return allowed.includes(text) ? text : fallback;
  };
  return {
    enabled: bool(env.USAGE_LIMITS_RELAY, bool(stored.enabled, DEFAULTS.enabled)),
    at: Math.min(99, Math.max(10, number(env.USAGE_LIMITS_RELAY_AT, number(stored.at, DEFAULTS.at)))),
    graceMinutes: Math.min(180, Math.max(1, number(env.USAGE_LIMITS_RELAY_GRACE, number(stored.graceMinutes, DEFAULTS.graceMinutes)))),
    // The environment may only turn unattended resume OFF. A project's settings
    // can set env vars, so letting one say "resume" would start agents the user
    // never asked for; resume is stored only by the `relay mode resume` command.
    mode: pick(env.USAGE_LIMITS_RELAY_MODE, ['notify'], pick(stored.mode, ['notify', 'resume'], DEFAULTS.mode)),
    thinking: pick(env.USAGE_LIMITS_RELAY_THINKING, ['off', 'resume', 'always'], pick(stored.thinking, ['off', 'resume', 'always'], DEFAULTS.thinking)),
    // Ignore legacy modes: a plugin must never choose its own approvals.
    permissionMode: null,
    model: typeof stored.model === 'string' ? stored.model : DEFAULTS.model,
    attempts: Math.min(10, Math.max(1, number(stored.attempts, DEFAULTS.attempts))),
    whenBusy: pick(stored.whenBusy, ['notify', 'resume'], DEFAULTS.whenBusy),
    armOn: pick(env.USAGE_LIMITS_RELAY_ARM_ON, ['threshold', 'completion'], pick(stored.armOn, ['threshold', 'completion'], DEFAULTS.armOn)),
    backstopAt: Math.min(100, Math.max(10, number(stored.backstopAt, DEFAULTS.backstopAt))),
    offlineAttempts: Math.min(48, Math.max(1, number(stored.offlineAttempts, DEFAULTS.offlineAttempts))),
    offlineRetryMinutes: Math.min(120, Math.max(2, number(stored.offlineRetryMinutes, DEFAULTS.offlineRetryMinutes))),
    show: bool(stored.show, DEFAULTS.show),
    fresh: bool(stored.fresh, DEFAULTS.fresh),
    voice: bool(stored.voice, DEFAULTS.voice),
    bugcheck: pick(stored.bugcheck, ['on', 'always', 'off'], DEFAULTS.bugcheck),
    onFailure: pick(stored.onFailure, ['rearm', 'stop'], DEFAULTS.onFailure),
    maxRearms: Math.min(10, Math.max(0, number(stored.maxRearms, DEFAULTS.maxRearms))),
    runLog: bool(stored.runLog, DEFAULTS.runLog),
  };
}

function configure(changes) {
  const state = read();
  state.config = Object.assign({}, state.config, changes || {});
  delete state.config.permissionMode;
  write(state);
  return settings(state);
}

/* ------------------------------------------------------ is there work? ---- */

// A relay for a conversation with nothing outstanding is a scheduled agent
// with nothing to do, which is the exact thing this must never become. The
// evidence has to come from the session itself, so it is read out of the
// transcript: a todo list with anything unfinished, or a plan that was
// approved. Both are things the user asked for.
const TAIL_BYTES = 512 * 1024;

function transcriptTail(file, bytes) {
  let handle;
  try {
    handle = fs.openSync(file, 'r');
    const size = fs.fstatSync(handle).size;
    const want = Math.min(size, bytes || TAIL_BYTES);
    const buffer = Buffer.alloc(want);
    fs.readSync(handle, buffer, 0, want, size - want);
    return buffer.toString('utf8');
  } catch (err) {
    return '';
  } finally {
    if (handle !== undefined) {
      try {
        fs.closeSync(handle);
      } catch (err) {
        // Nothing useful to do about a handle that will not close.
      }
    }
  }
}

function detectWork(transcriptPath, options) {
  const out = { todos: [], pending: 0, plan: null, hasWork: false, source: null };
  if (!transcriptPath) return out;
  const text = transcriptTail(transcriptPath, options && options.bytes);
  if (!text) return out;
  const lines = text.split('\n');
  // Read backwards: the newest todo list is the only one that describes now.
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line || line.charAt(0) !== '{') continue;
    if (out.todos.length === 0 && line.indexOf('"TodoWrite"') === -1 && line.indexOf('"ExitPlanMode"') === -1) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch (err) {
      continue;
    }
    const content = event && event.message && Array.isArray(event.message.content) ? event.message.content : [];
    for (const part of content) {
      if (!part || part.type !== 'tool_use' || !part.input) continue;
      if (part.name === 'TodoWrite' && Array.isArray(part.input.todos) && !out.todos.length) {
        out.todos = part.input.todos
          .filter((todo) => todo && typeof todo.content === 'string')
          .map((todo) => ({ content: todo.content, status: String(todo.status || 'pending') }));
        out.source = 'todos';
      }
      if (part.name === 'ExitPlanMode' && typeof part.input.plan === 'string' && !out.plan) {
        out.plan = part.input.plan.slice(0, 4000);
        if (!out.source) out.source = 'plan';
      }
    }
    if (out.todos.length && out.plan) break;
  }
  out.pending = out.todos.filter((todo) => todo.status !== 'completed').length;
  out.hasWork = out.pending > 0 || Boolean(out.plan);
  return out;
}

/* --------------------------------------------------- what gets handed on -- */

// The continuation the session wrote itself, stored by the /usage-limits:relay
// note command. This is the good case: a paragraph from the session that knows
// what it was doing beats anything reconstructed from a todo list.
// The continuation is delivered on stdin now (wake.js), where the cap is
// 10 MB, so the old 8,000-character slice was a leftover from the argv era -
// and a silent one: a plan that ran long simply lost its tail. 64 KB is more
// than any note needs and small enough that a runaway write cannot fill a
// disk.
const CONTINUATION_MAX = 65536;

// `options.force` is the only way to write ANOTHER session's armed
// continuation. On 2026-09-14 a session wrote its note to whatever record was
// armed without checking whose it was; the armed record belonged to a peer,
// and the peer's 343-byte handoff was replaced with 3 KB of somebody else's
// plan minutes before it was due to fire. One machine has one relay, so
// displacement is normal - but a session may only overwrite a different
// session's plan on purpose, never by default.
function saveContinuation(id, text, options) {
  const body = String(text || '').slice(0, CONTINUATION_MAX).trim();
  if (!body) return null;
  const me = process.env.CLAUDE_CODE_SESSION_ID || process.env.CLAUDE_SESSION_ID || null;
  const armedNow = armedFor(read(), id);
  if (armedNow && me && me !== id && !(options && options.force)) {
    note('refused to overwrite the armed continuation of ' + id + ' from session ' + me + ' (pass force to do it on purpose)');
    return null;
  }
  try {
    fs.mkdirSync(configDir(), { recursive: true });
    fs.writeFileSync(planFile(id), body + '\n');
  } catch (err) {
    return null;
  }
  const state = read();
  const mine = armedFor(state, id);
  if (mine) {
    mine.continuation = true;
    mine.continuationAt = Date.now();
    write(state);
  }
  return planFile(id);
}

function readContinuation(id) {
  try {
    return fs.readFileSync(planFile(id), 'utf8').trim();
  } catch (err) {
    return '';
  }
}

// The prompt that restarts the work.
//
// Written the way the user writes, because it is delivered as if it came from
// them and a form letter gets a form letter back. Written in the imperative,
// because a resumed session that opens by asking what to do has wasted the
// wake it was given.
// Asked for on nearly every request, so the hand-off asks for it unprompted.
const BUGCHECK_LINE =
  'Before you call any of this done, check it for bugs twice: one full pass, then a second pass that assumes ' +
  'the first missed something. The user asks for this on nearly every request, so do it without being asked, ' +
  'unless the last turn already did both.';

// The opening for a new local session (relay fresh on). Unlike the resume it
// has none of the conversation, and unlike the cloud it is on this machine,
// in the same folder, with every uncommitted change still there.
function freshOpening(options) {
  return (
    (options.deferred
      ? 'The time this work was deferred to has come, and this is the plugin handing it to a new session, not a new request. '
      : 'The usage window has reset, and this is the plugin handing an earlier session\'s work to this new one, not a new request. ') +
    'You have none of that conversation: what follows is what it left. Carry on from where it stopped, at full quality, ' +
    'without re-asking what to do. ' +
    (options.projectDir
      ? 'The project is ' + options.projectDir + ', added to this session, which was started from a trusted folder on purpose: use absolute paths.'
      : 'You are in its project folder, with the files as it left them, uncommitted changes included.')
  );
}

function compose(input) {
  const parts = [];
  const options = input || {};
  if (options.thinking) parts.push('ultrathink');
  // A cloud session is not the same conversation and the window has not reset,
  // so it is told what it is: a fresh clone, with only what reached GitHub.
  parts.push(
    options.fresh
      ? freshOpening(options)
      : options.cloud
      ? 'A local session reached its usage limit and this is the plugin handing its work to a cloud session ' +
          'rather than waiting for the reset, not a new request. You have none of that conversation: what ' +
          'follows is what it left. Carry on from where it stopped, at full quality, without re-asking what to ' +
          'do. This is a fresh clone from GitHub, so only what was pushed is here; if something below is ' +
          'missing, say so rather than rebuilding it from the description.' +
          // Which branch the clone starts on is not the plugin's to choose, so
          // the one the work was pushed to is named.
          (options.branch && options.branch !== 'HEAD'
            ? ' The work is on branch ' + options.branch + ': check it out first if the clone is on another.'
            : '')
      : 'The usage window has reset and this is the plugin picking the work back up, not a new request. ' +
          'Carry on from where the last turn stopped, at full quality, without re-asking what to do.'
  );
  const continuation = String(options.continuation || '').trim();
  if (continuation) {
    parts.push('This is what the session left for itself:\n\n' + continuation);
  }
  const work = options.work;
  if (work && work.todos && work.todos.length) {
    const outstanding = work.todos.filter((todo) => todo.status !== 'completed');
    if (outstanding.length) {
      parts.push(
        'Still outstanding when the budget ran out:\n' +
          outstanding.map((todo) => '- ' + todo.content + (todo.status === 'in_progress' ? ' (was mid-change)' : '')).join('\n')
      );
    }
  }
  if (!continuation && work && work.plan) {
    parts.push('The plan that was approved:\n\n' + work.plan);
  }
  parts.push('Verify anything that was mid-change before building on it: the last turn may have been cut off part-way through an edit.');
  if (options.bugcheck !== false && options.bugcheck !== 'off') parts.push(BUGCHECK_LINE);
  const card = options.voice;
  if (card) parts.push('When you write back to the user, this is how they write:\n' + card);
  return parts.join('\n\n');
}

/* ------------------------------------------------------------ machinery --- */

function firstExisting(candidates) {
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      fs.accessSync(candidate);
      return candidate;
    } catch (err) {
      // Try the next one.
    }
  }
  return null;
}

// Codex installs itself into a content-addressed folder that changes with
// every update, so the path is discovered rather than remembered.
function findCodex(env) {
  const environment = env || process.env;
  if (environment.CODEX_CLI_PATH) return firstExisting([environment.CODEX_CLI_PATH]);
  const local = environment.LOCALAPPDATA;
  if (local) {
    const bin = path.join(local, 'OpenAI', 'Codex', 'bin');
    try {
      const found = fs
        .readdirSync(bin)
        .map((entry) => path.join(bin, entry, process.platform === 'win32' ? 'codex.exe' : 'codex'))
        .filter((file) => {
          try {
            fs.accessSync(file);
            return true;
          } catch (err) {
            return false;
          }
        })
        .sort();
      if (found.length) return found[found.length - 1];
    } catch (err) {
      // Not installed there.
    }
  }
  return firstExisting([
    path.join(os.homedir(), '.codex', 'bin', process.platform === 'win32' ? 'codex.exe' : 'codex'),
  ]);
}

function findClaude(env) {
  const environment = env || process.env;
  if (environment.USAGE_LIMITS_CLAUDE_CLI) return firstExisting([environment.USAGE_LIMITS_CLAUDE_CLI]);
  if (process.platform === 'win32') {
    const found = firstExisting([
      environment.APPDATA ? path.join(environment.APPDATA, 'npm', 'claude.cmd') : null,
      path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'claude.cmd'),
      path.join(os.homedir(), '.local', 'bin', 'claude.exe'),
    ]);
    if (found) return found;
  }
  return firstExisting([
    path.join(os.homedir(), '.local', 'bin', 'claude'),
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
    path.join(os.homedir(), '.npm-global', 'bin', 'claude'),
  ]);
}

// Computer Use, if the user installed it. The relay uses it for one thing:
// asking whether somebody is at the machine before starting an agent in the
// directory they might be working in. It is never used to type into a
// terminal - that plugin refuses to send input to a shell or an editor on
// purpose, and routing around a safety rule because it is inconvenient is how
// safety rules stop meaning anything.
function findComputerUse(env) {
  const environment = env || process.env;
  if (environment.USAGE_LIMITS_COMPUTER_USE) return firstExisting([environment.USAGE_LIMITS_COMPUTER_USE]);
  const roots = [
    path.join(configDir(), 'plugins', 'cache', 'computer-use', 'computer-use'),
    path.join(os.homedir(), '.claude', 'plugins', 'cache', 'computer-use', 'computer-use'),
  ];
  for (const root of roots) {
    let versions;
    try {
      versions = fs.readdirSync(root).sort();
    } catch (err) {
      continue;
    }
    for (const version of versions.reverse()) {
      const cli = path.join(root, version, 'tools', 'cli.mjs');
      try {
        fs.accessSync(cli);
        return cli;
      } catch (err) {
        // Keep looking.
      }
    }
  }
  return null;
}

function capabilities(env) {
  return {
    claude: findClaude(env),
    codex: findCodex(env),
    computerUse: findComputerUse(env),
    node: process.execPath,
  };
}

// The wake time: the moment the window opens, plus enough slack that the meter
// has really turned over.
function wakeAt(resetsAt, graceMinutes, now) {
  // Number(null) is 0 and Number('') is 0, and a wake booked for the epoch
  // plus five minutes is a wake booked for right now. A missing reset time has
  // to read as missing.
  if (resetsAt === null || resetsAt === undefined || resetsAt === '') return null;
  const reset = Number(resetsAt);
  if (!Number.isFinite(reset)) return null;
  const at = reset + Math.max(1, graceMinutes) * MINUTE;
  const floor = (Number.isFinite(now) ? now : Date.now()) + MINUTE;
  return Math.max(at, floor);
}

// One name per WAKE, not one per session.
//
// Reusing a name entangles every registration with the previous one's fate,
// and all of it is undocumented: whether -Force truly replaces a stale
// definition, what happens when a name is re-registered while its predecessor
// is pending expiry-deletion, and whether an old EndBoundary survives the
// update. On top of that MultipleInstances defaults to IgnoreNew, so a
// previous run still held open by the four-hour execution limit silently
// swallows the next launch.
//
// A unique suffix removes all of it at once, and lets DeleteExpiredTaskAfter
// do what it should: each fired wake garbage-collects itself. cancelSchedule
// works off the stored name, so nothing downstream changes.
function taskName(id, at) {
  const stamp = Number.isFinite(at) ? at : Date.now();
  return (
    'UsageLimitsRelay-' +
    String(id).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) +
    '-' +
    stamp.toString(36)
  );
}

// PowerShell also ends a single-quoted string at a curly single quote
// (U+2018-U+201B), so those are doubled too: a typographic apostrophe in a
// hand-off must not close its own argument.
function psQuote(value) {
  return "'" + String(value).replace(/['\u2018-\u201B]/g, '$&$&') + "'";
}

// One argument, quoted the way CommandLineToArgvW will unquote it. The rule
// that matters and that a naive version misses: a backslash is only an escape
// when it precedes a quote, so a run of backslashes before the closing quote
// has to be doubled or the quote is eaten - which is exactly what a config
// directory ending in a backslash did to the wake's command line.
function winArg(value) {
  const text = String(value);
  if (!/[\s"]/.test(text)) return text;
  let out = '"';
  let slashes = 0;
  for (const ch of text) {
    if (ch === '\\') {
      slashes += 1;
      continue;
    }
    if (ch === '"') {
      out += '\\'.repeat(slashes * 2 + 1) + '"';
    } else {
      out += '\\'.repeat(slashes) + ch;
    }
    slashes = 0;
  }
  return out + '\\'.repeat(slashes * 2) + '"';
}

function two(value) {
  return String(value).padStart(2, '0');
}

// Registered through the ScheduledTasks module rather than schtasks.exe, for
// one reason that matters: a schtasks /V1 one-shot cannot carry
// StartWhenAvailable, so a machine asleep at the trigger moment misses the run
// silently and forever. -StartWhenAvailable makes it fire on wake instead,
// which is the whole difference between a relay and a coin toss. schtasks is
// still the fallback for a box where the module is missing.
// The two registrations below are bounded by the caller's deadline, not by a
// fixed figure: from inside a hook there may be a few seconds left, from the
// command line there are as many as it takes. Measured once at 38 seconds
// worst case when both spawns waited their full fixed timeouts, inside a hook
// that is killed at ten.
function remainingMs(deadline, ceiling) {
  const left = Number.isFinite(deadline) ? deadline - Date.now() : ceiling;
  return Math.max(0, Math.min(ceiling, left));
}

// What the PowerShell route may take when nothing bounds it. It used to be a
// fixed eight seconds whether or not a hook was waiting, and on this machine
// the ScheduledTasks module alone takes longer than that: measured
// 2026-09-21, 32 seconds to load and register, 16 to unregister. So every arm
// by hand timed out here (ETIMEDOUT, which has no stderr), fell through to
// schtasks, and reported only the fallback's refusal - twice on the night of
// 2026-09-20, with the primary route's failure never seen at all.
const PS_ROUTE_MS = 60000;
const SCHTASKS_MS = 8000;

// One spawn's failure in a phrase that fits beside another's. A timeout has
// no stderr, so reading only stderr is how the primary route's failure was
// lost.
function describeSpawn(label, run, timeoutMs) {
  if (!run) return label + ': not attempted';
  if (run.error) {
    return label + ': ' + (run.error.code === 'ETIMEDOUT'
      ? 'timed out after ' + Math.round(timeoutMs / 1000) + ' s'
      : run.error.message);
  }
  const said = String(run.stderr || run.stdout || '').trim().split('\n')[0];
  if (said) return label + ': ' + said;
  return label + ': exited ' + run.status + ' with no output';
}

/* ------------------------------------------------------ the task launcher -- */

// The task's own launcher: one small batch file per record, under the config
// directory, holding the whole node command. Both registration routes point
// at it, so the task action has one fixed shape whose length no longer
// depends on where the plugin is installed. It has to be: schtasks caps /TR
// at 261 characters, and the action used to carry node's path, the plugin
// cache path to wake.js, the session id and the config directory - 326
// characters on the 1.36.0 install - so the fallback was refused every time
// it was tried. cmd's quoting rules apply to text this code wrote: a doubled
// percent sign is the one escape needed inside double quotes, and a double
// quote has no escape there, so it is dropped (no path can hold one).
function wakeLauncherFile(id) {
  return path.join(configDir(), 'relay-task-' + String(id).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 8) + '.cmd');
}

function batchArg(text) {
  return '"' + String(text).replace(/%/g, '%%').replace(/"/g, '') + '"';
}

function wakeLauncherScript(argv) {
  return '@echo off\r\n' + [process.execPath].concat(argv).map(batchArg).join(' ') + '\r\n';
}

function writeWakeLauncher(id, argv) {
  const file = wakeLauncherFile(id);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, wakeLauncherScript(argv), 'utf8');
  return file;
}

// Deleting a batch file while cmd is still on its last line makes cmd end
// with "The batch file cannot be found" (tested 2026-09-21), so a wake never
// deletes its own launcher. They are swept here instead, from a process that
// is not running under one: every relay-task-*.cmd whose record is gone.
function sweepWakeLaunchers(state) {
  const keep = new Set(records(state).map((r) => path.basename(wakeLauncherFile(r.id))));
  let names;
  try {
    names = fs.readdirSync(configDir());
  } catch (err) {
    return;
  }
  for (const name of names) {
    if (!/^relay-task-[A-Za-z0-9_-]{0,8}\.cmd$/.test(name) || keep.has(name)) continue;
    try {
      fs.unlinkSync(path.join(configDir(), name));
    } catch (err) {
      // A launcher that will not delete is a stray file, not a failed relay.
    }
  }
}

// Does Windows agree that this task will run?
//
// `state` and `next` come straight from Get-ScheduledTask and
// Get-ScheduledTaskInfo. A task can register cleanly and still never fire,
// and each of these has been seen: Disabled by policy or by an earlier
// failure; NextRunTime empty because the trigger time had already passed by
// the time it was written; NextRunTime set to something other than what was
// asked for, meaning the trigger did not take. None of them raised an error
// before, so the relay reported an armed wake and nothing happened.
function verifyRegistration(state, next, wanted, now) {
  const said = String(state || '').trim();
  if (/disabled/i.test(said)) {
    return { ok: false, error: 'the scheduled task registered but is Disabled, so it will not run' };
  }
  const text = String(next || '').trim();
  if (!text) {
    return { ok: false, error: 'the scheduled task registered but Windows reports no next run time, so it will not fire' };
  }
  // It has to LOOK like a timestamp before it is read as one.
  //
  // Date.parse is far too willing: Date.parse("12345") is the year 12345, which
  // is finite, comfortably in the future, and would sail through every check
  // below. This function exists to refuse a task that will not fire, so
  // accepting garbage as proof that one will is the worst failure it has.
  // PowerShell's .ToString("s") is always yyyy-MM-ddTHH:mm:ss; anything else is
  // not an answer to the question that was asked.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?/.test(text)) {
    return { ok: false, error: 'could not read the next run time Windows reported: ' + text };
  }
  const at = Date.parse(text);
  if (!Number.isFinite(at)) {
    return { ok: false, error: 'could not read the next run time Windows reported: ' + text };
  }
  if (at <= now) {
    return { ok: false, error: 'the scheduled task next run time is already in the past' };
  }
  // Five minutes of slack: Task Scheduler rounds to the minute and a trigger
  // can be nudged. Anything further out is a different time from the one asked
  // for, which means the trigger did not take.
  if (Number.isFinite(wanted) && Math.abs(at - wanted) > 5 * 60 * 1000) {
    return {
      ok: false,
      error: 'the scheduled task is set for ' + new Date(at).toISOString() + ', not the requested ' + new Date(wanted).toISOString(),
    };
  }
  return { ok: true, nextRun: at };
}

const SYSTEM32 = path.join(process.env.SystemRoot || 'C:' + path.sep + 'Windows', 'System32');
const HIDDEN_HOST = path.join(SYSTEM32, 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const HEADLESS_HOST = path.join(SYSTEM32, 'conhost.exe');

// conhost --headless arrived with the pseudoconsole in Windows 10 1809 (build
// 17763). Older builds, and anything that is not Windows, keep the PowerShell
// route alone.
function headlessAvailable() {
  if (process.platform !== 'win32') return false;
  const build = Number(String(os.release()).split('.')[2]);
  return Number.isFinite(build) && build >= 17763 && fs.existsSync(HEADLESS_HOST);
}

// The task used to run node.exe directly, and node.exe is a console program:
// under the scheduler, in an interactive session, it gets a console window
// of its own. That was the "blank terminal that says Claude" - the wake's own
// console, shared by its headless child - and closing it killed both (task
// result 0xC000013A), so the wake never wrote its outcome.
//
// PowerShell's -WindowStyle Hidden was the first fix, and it only works where
// the old console host draws the window. Windows 11 hands every new console to
// Windows Terminal by default, and Terminal ignores the flag: measured
// 2026-09-27, the task opened a "powershell.exe" Terminal window beside the
// Claude window the wake started, so the user saw two terminals for one relay
// and closing the wrong one killed the wake again (0xC000013A the same
// evening). conhost --headless gives the console no window at all, so there
// is nothing to hand to Terminal; measured the same evening, the same task
// under it opened no window, and the session window the wake opens (cmd /c
// start) still appeared, alone.
function hiddenAction(launcher, cwd, headless) {
  const useHeadless = headless === undefined ? headlessAvailable() : headless;
  const run = '-Command "& ' + psQuote(launcher) + '"';
  if (useHeadless) {
    // No -WindowStyle here: there is no window to style, and the 20 characters
    // matter to the schtasks fallback, which refuses a /TR over 261.
    return {
      execute: HEADLESS_HOST,
      argument: '--headless "' + HIDDEN_HOST + '" -NoProfile -NonInteractive ' + run,
      cwd: cwd || os.homedir(),
    };
  }
  return {
    execute: HIDDEN_HOST,
    argument: '-NoProfile -NonInteractive -WindowStyle Hidden ' + run,
    cwd: cwd || os.homedir(),
  };
}

// The one string schtasks measures: the /TR value.
function taskAction(action) {
  return '"' + action.execute + '" ' + action.argument;
}

// THE SCHEDULER SWITCH.
//
// Task Scheduler is machine-wide. A fake HOME, a fake CLAUDE_CONFIG_DIR or a
// test's temp folder changes where the relay keeps its records, and nothing at
// all about where its wakes go. Found 2026-09-25 23:55: an adversarial run of
// the relay hook with HOME and USERPROFILE pointed at sandbox folders
// registered 8 REAL tasks, two of them for the real session id, which would
// have resumed a second copy of the live conversation. So the real scheduler
// is only touched when nothing says this is a test or a sandbox:
//   USAGE_LIMITS_SCHEDULER=real     always real (the escape hatch)
//   USAGE_LIMITS_SCHEDULER=dry-run  never real
//   NODE_TEST_CONTEXT               set by `node --test` for every test file,
//                                   and inherited by what a test spawns
//   a redirected home               os.homedir() is not the account's own
// A dry run registers nothing, cancels nothing, and says so in its answer.
function sandboxedHome() {
  let real;
  try {
    real = os.userInfo().homedir;
  } catch (err) {
    return false;
  }
  if (!real) return false;
  const norm = (p) => {
    const resolved = path.resolve(p).replace(/[\\/]+$/, '');
    return process.platform === 'linux' ? resolved : resolved.toLowerCase();
  };
  return norm(real) !== norm(os.homedir());
}

function schedulerMode() {
  const said = String(process.env.USAGE_LIMITS_SCHEDULER || '').trim().toLowerCase();
  if (said === 'real') return { dry: false, why: null };
  if (said === 'dry-run' || said === 'dry') return { dry: true, why: 'USAGE_LIMITS_SCHEDULER=' + said };
  if (process.env.NODE_TEST_CONTEXT) return { dry: true, why: 'running under node --test' };
  if (sandboxedHome()) return { dry: true, why: 'the home folder is redirected to ' + os.homedir() };
  return { dry: false, why: null };
}

function dryRun(mode) {
  return { ok: true, how: 'dry-run', dry: true, warning: 'no wake was registered (' + mode.why + ')' };
}

function scheduleWindows(when, argv, name, cwd, deadline) {
  // No time left is a plain refusal, not a hung hook - and not a launcher
  // written for a task that is never registered.
  if (Number.isFinite(deadline) && remainingMs(deadline, PS_ROUTE_MS) < 1500) {
    return { ok: false, error: 'no time left in this hook to register the wake; it will arm on the next prompt' };
  }
  const mode = schedulerMode();
  if (mode.dry) return dryRun(mode);
  let lastVerifyError = null;
  const date = new Date(when);
  const stamp =
    date.getFullYear() + '-' + two(date.getMonth() + 1) + '-' + two(date.getDate()) + ' ' +
    two(date.getHours()) + ':' + two(date.getMinutes()) + ':' + two(date.getSeconds());
  const idAt = argv.indexOf('--id');
  let launcher;
  try {
    launcher = writeWakeLauncher(idAt !== -1 && argv[idAt + 1] ? argv[idAt + 1] : name, argv);
  } catch (err) {
    return { ok: false, error: 'could not write the wake launcher: ' + err.message };
  }
  const action = hiddenAction(launcher, cwd);
  const script = [
    '$ErrorActionPreference = "Stop"',
    '$action = New-ScheduledTaskAction -Execute ' + psQuote(action.execute) +
      ' -Argument ' + psQuote(action.argument) + ' -WorkingDirectory ' + psQuote(action.cwd),
    '$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date ' + psQuote(stamp) + ')',
    // A one-shot task does not remove itself. Without an expiry, every relay
    // leaves a dead entry in Task Scheduler forever; the wake also unregisters
    // itself when it finishes, and this is what catches the wakes that never
    // get to run at all.
    // "zzz" is load-bearing. EndBoundary is documented as
    // YYYY-MM-DDTHH:MM:SS(+-)HH:MM, and .ToString("s") emits no offset at
    // all. A boundary written without one can be read as UTC, which west of
    // Greenwich puts it HOURS IN THE PAST - so the task is born expired,
    // never fires, and DeleteExpiredTaskAfter quietly reaps it. None of that
    // raises an error: registration returns SCHED_S_SOME_TRIGGERS_FAILED
    // (0x0004131B), which is a SUCCESS code, so PowerShell never throws and
    // the relay reported a wake that could not happen.
    '$trigger.EndBoundary = (Get-Date ' + psQuote(stamp) + ').AddHours(12).ToString("yyyy-MM-ddTHH:mm:sszzz")',
    '$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -AllowStartIfOnBatteries ' +
      '-DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 4) ' +
      '-DeleteExpiredTaskAfter (New-TimeSpan -Minutes 10)',
    'Register-ScheduledTask -TaskName ' + psQuote(name) + ' -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null',
    // Ask Windows whether it will actually fire, rather than trusting that a
    // registration which did not throw is a wake that will happen.
    //
    // This is the difference between "it said it would restart at 4:30 and
    // nothing happened" and an error at arming time. Register-ScheduledTask
    // reports success for a task that will never run: a trigger already in the
    // past, a task left Disabled, a name whose previous registration is still
    // being torn down. NextRunTime is the only field that answers the question
    // actually being asked.
    '$info = Get-ScheduledTaskInfo -TaskName ' + psQuote(name) + ' -ErrorAction SilentlyContinue',
    '$state = (Get-ScheduledTask -TaskName ' + psQuote(name) + ' -ErrorAction SilentlyContinue).State',
    '$next = ""',
    'if ($info -and $info.NextRunTime) { $next = $info.NextRunTime.ToString("s") }',
    'Write-Output ("registered|" + $state + "|" + $next)',
  ].join('\n');
  const file = path.join(os.tmpdir(), name + '.ps1');
  try {
    fs.writeFileSync(file, script, 'utf8');
    const primaryMs = Math.max(500, remainingMs(deadline, PS_ROUTE_MS));
    const run = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: primaryMs,
    });
    const registered = (run.stdout || '').match(/registered\|([^|\r\n]*)\|([^\r\n]*)/);
    if (run.status === 0 && registered) {
      const verdict = verifyRegistration(registered[1], registered[2], when, Date.now());
      if (verdict.ok) return { ok: true, how: 'ScheduledTasks', nextRun: verdict.nextRun };
      // Registered but it will not fire. Fall through to schtasks rather than
      // reporting a wake that is not going to happen.
      lastVerifyError = verdict.error;
    }
    // Kept from here on, whatever the fallback does: the fallback's outcome
    // is the second half of the answer, never the whole of it.
    const primaryError = lastVerifyError ? 'ScheduledTasks: ' + lastVerifyError : describeSpawn('ScheduledTasks', run, primaryMs);
    // No time left for a second attempt is a plain refusal, not a hung hook.
    if (remainingMs(deadline, SCHTASKS_MS) < 1500) {
      return { ok: false, error: 'no time left in this hook to register the wake (' + primaryError + '); it will arm on the next prompt' };
    }
    // schtasks cannot express StartWhenAvailable, so this path is a worse
    // guarantee and says so rather than pretending the two are the same.
    const fallbackMs = Math.max(500, remainingMs(deadline, SCHTASKS_MS));
    const fallback = spawnSync(
      'schtasks.exe',
      ['/Create', '/TN', name, '/TR', taskAction(action), '/SC', 'ONCE',
        '/ST', two(date.getHours()) + ':' + two(date.getMinutes()),
        '/SD', two(date.getMonth() + 1) + '/' + two(date.getDate()) + '/' + date.getFullYear(),
        '/IT', '/Z', '/F'],
      { encoding: 'utf8', windowsHide: true, timeout: fallbackMs }
    );
    if (fallback.status === 0) {
      return { ok: true, how: 'schtasks', warning: 'a sleeping machine will miss this wake (' + primaryError + ')', primaryError };
    }
    // Both paths failed. If the PowerShell one registered something that
    // will not fire - or will fire at the wrong time - leaving it behind is
    // an orphan that nothing tracks and nothing cancels.
    if (lastVerifyError) {
      try {
        cancelSchedule(name);
      } catch (err) {
        // Nothing further to do; the expiry is the backstop.
      }
    }
    return { ok: false, error: primaryError + '; ' + describeSpawn('schtasks', fallback, fallbackMs), primaryError };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    try {
      fs.unlinkSync(file);
    } catch (err) {
      // Leaving a script behind in the temp directory is not worth reporting.
    }
  }
}

function schedulePosix(when, argv, name, cwd, deadline) {
  const mode = schedulerMode();
  if (mode.dry) return dryRun(mode);
  const seconds = Math.max(60, Math.round((when - Date.now()) / 1000));
  // `at` is the right tool and is absent on most desktops now. A detached
  // sleeper is second best: it survives the terminal closing, but not a
  // reboot, and the status line says so.
  const command = [process.execPath].concat(argv).map((value) => "'" + String(value).replace(/'/g, "'\\''") + "'").join(' ');
  const at = spawnSync('sh', ['-c', 'command -v at >/dev/null 2>&1 && echo yes || echo no'], { encoding: 'utf8' });
  if ((at.stdout || '').trim() === 'yes') {
    const minutes = Math.max(1, Math.round(seconds / 60));
    // Bounded by what the caller has left, like the Windows route: a hook is
    // killed at ten seconds and this used to wait twenty. An `at` that runs
    // out of time falls through to the sleeper below, which returns at once.
    const run = spawnSync('sh', ['-c', 'echo ' + JSON.stringify(command) + ' | at now + ' + minutes + ' minutes'], {
      encoding: 'utf8',
      timeout: Math.max(1000, remainingMs(deadline, 20000)),
    });
    // macOS ships `at` but launchd leaves atrun DISABLED by default, so the
    // command succeeds, prints a job id, and the wake never fires. Reporting
    // ok for that is worse than not having it: it is a silent no-op that looks
    // like a scheduled wake. Fall through to the sleeper, which at least runs.
    if (run.status === 0 && process.platform !== 'darwin') return { ok: true, how: 'at' };
  }
  try {
    const child = spawn('sh', ['-c', 'sleep ' + seconds + ' && ' + command], {
      detached: true,
      stdio: 'ignore',
      cwd: cwd || os.homedir(),
    });
    child.unref();
    return { ok: true, how: 'sleeper', warning: 'a reboot before the reset will cancel this wake', pid: child.pid };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function schedule(when, argv, name, cwd, deadline) {
  if (process.platform === 'win32') return scheduleWindows(when, argv, name, cwd, deadline);
  // The same refusal the Windows route makes. The `at` spawn below may wait
  // twenty seconds, inside a hook that is killed at ten, and a hook with no
  // time left must say so rather than start a registration it cannot finish -
  // the deadline was passed here and ignored on every platform but one.
  if (Number.isFinite(deadline) && deadline - Date.now() < 1500) {
    return { ok: false, error: 'no time left in this hook to register the wake; it will arm on the next prompt' };
  }
  return schedulePosix(when, argv, name, cwd, deadline);
}

function cancelSchedule(name) {
  // A dry run never touches a task, including one a real run registered.
  if (schedulerMode().dry) return true;
  if (process.platform === 'win32') {
    const run = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', 'Unregister-ScheduledTask -TaskName ' + psQuote(name) + ' -Confirm:$false'],
      { encoding: 'utf8', windowsHide: true, timeout: 20000 }
    );
    if (run.status === 0) return true;
    return spawnSync('schtasks.exe', ['/Delete', '/TN', name, '/F'], { encoding: 'utf8', windowsHide: true, timeout: 20000 }).status === 0;
  }
  return false;
}

/* ------------------------------------------------------------- arming ----- */

// Everything that has to be true before a wake is scheduled, in the order that
// makes the answer most useful to read.
// A saved continuation is work by definition: the session wrote down what
// comes next. On 2026-09-14 a session with an 8 KB note and no todo list hit
// 100 per cent and was refused for having "no plan or unfinished todo list",
// so nothing picked it up after the reset.
function workWithContinuation(work, id) {
  const base = work || { hasWork: false, pending: 0, source: null, todos: [], plan: null };
  if (base.hasWork) return base;
  const saved = id ? readContinuation(id) : '';
  if (!saved) return base;
  return Object.assign({}, base, { hasWork: true, pending: Math.max(1, base.pending || 0), source: 'continuation' });
}

// A wake that fired and never reported back. The 8:05 PM wake on 2026-09-14
// was killed with its console (task result 0xC000013A), so finish() never
// ran: the record stayed armed for a wake that was already over, its task
// stayed registered, and status said "wake in now" for hours. A wake marks
// wokeAt as its first act; a record past its wake with no mark for half an
// hour never started, and one marked but silent for longer than a resume
// can run has died. Either way it is history, and the slot is free.
// Not 30 minutes: a task registered StartWhenAvailable runs when a sleeping
// machine comes back, any time inside its 12-hour expiry, and reaping it
// sooner would cancel the very catch-up run the registration promises.
const LOST_UNSTARTED_MS = 12 * 60 * MINUTE + 30 * MINUTE;
const LOST_RUNNING_MS = 3 * 60 * MINUTE + 10 * MINUTE;
function reapLost(now) {
  const state = read();
  let reaped = false;
  for (const armed of records(state)) {
    if (!Number.isFinite(armed.wakeAt)) continue;
    const limit = Number.isFinite(armed.wokeAt) ? armed.wokeAt + LOST_RUNNING_MS : armed.wakeAt + LOST_UNSTARTED_MS;
    if (now < limit) continue;
    const detail = Number.isFinite(armed.wokeAt)
      ? 'the wake started ' + new Date(armed.wokeAt).toISOString() + ' and never reported back'
      : 'the wake was due ' + new Date(armed.wakeAt).toISOString() + ' and never started, or died before it could say so';
    state.history.push(Object.assign({}, armed, { endedAt: now, outcome: 'lost', detail }));
    state.history = state.history.slice(-10);
    dropRecord(state, armed.id);
    note('lost ' + armed.id + ': ' + detail, now);
    if (armed.task) {
      try {
        cancelSchedule(armed.task);
      } catch (err) {
      }
    }
    reaped = true;
  }
  if (reaped) {
    write(state);
    sweepWakeLaunchers(state);
  }
  return reaped;
}

function armable(input) {
  const options = input || {};
  const config = options.config || settings();
  if (!config.enabled) return { ok: false, why: 'the relay is off' };
  const binding = options.binding;
  if (!binding || binding.percentUsed === null || binding.percentUsed === undefined) return { ok: false, why: 'no usable window reading' };
  if (binding.stale) return { ok: false, why: 'the reading is stale' };
  if (binding.percentUsed < config.at) return { ok: false, why: 'below ' + config.at + ' per cent' };
  // The account's own reading has to be past the mark, not the local
  // extrapolation on top of it: on 2026-09-20 the estimate ran 17 points hot
  // and a relay armed on it would have armed a whole window early.
  const beyond = Number.isFinite(binding.pointsBeyondSnapshot) ? binding.pointsBeyondSnapshot : 0;
  const raw = binding.percentUsed - Math.max(0, beyond);
  if (raw < config.at) return { ok: false, why: 'the account reads ' + Math.round(raw) + ' per cent; only the local estimate (' + Math.round(binding.percentUsed) + ') is past ' + config.at };
  if (!Number.isFinite(binding.resetsAt)) return { ok: false, why: 'the window has no known reset time' };
  // /low-priority retires the 5-hour wall while it is on: the session carries
  // straight past that reset at lower priority, spending the weekly. A wake
  // booked for that reset would fire into a session that was never stopped -
  // and with Claude Code's own autoContinueAtUsageLimit on by default, two
  // things starting the same work is the one bug here that costs real weekly
  // budget. So it is refused, in plain words, and only for that window: the
  // weekly is a different wall and still arms.
  //
  // This reads the plugin's own acknowledgement, never a guess. Whether
  // low-priority is actually running lives in the CLI's process memory and is
  // readable nowhere; see lowpri.js.
  //
  // Claude Code only. Codex files a five-hour window under the same key, and
  // /low-priority is a Claude Code slash command against a Claude account, so an
  // acknowledgement made there must not refuse a Codex relay. The host is taken
  // from the caller where it knows, and detected otherwise - the Codex and
  // Antigravity hooks both pass --host.
  const hostHere = options.hostName || host.detect(process.argv.slice(2), process.env);
  if (binding.key === 'five_hour' && hostHere === host.CLAUDE) {
    let ack = null;
    try {
      ack = lowpri.readAck(options.now);
    } catch (err) {
      ack = null;
    }
    if (ack) {
      return {
        ok: false,
        why:
          'low-priority is acknowledged on, so the 5-hour reset is not a wall to wake after - ' +
          'this session carries past it and spends the weekly instead. Only the weekly window ' +
          'would be worth a wake; say so with usage-mode --low-priority off if it has been switched back off',
      };
    }
  }
  if (!options.sessionId) return { ok: false, why: 'no session id' };
  const work = workWithContinuation(options.work, options.sessionId);
  if (!work.hasWork) return { ok: false, why: 'no plan or unfinished todo list to carry, and no saved continuation' };
  // The boundary rule. Past the threshold but not yet at the backstop, arming
  // waits for the reply to finish - the Stop hook passes atCompletion and this
  // is the only caller that does. Mid-reply callers get told to wait, and the
  // brief says so rather than reporting a silent nothing.
  if (config.armOn === 'completion' && !options.atCompletion && binding.percentUsed < config.backstopAt) {
    return {
      ok: false,
      pending: true,
      why: 'waiting for this reply to finish before arming (past ' + config.backstopAt + ' per cent it stops waiting)',
    };
  }
  return { ok: true };
}

function arm(input) {
  const options = input || {};
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const config = options.config || settings();
  reapLost(now);
  options.work = workWithContinuation(options.work, options.sessionId);
  // `at` is an exact wake time, for work deferred to a moment somebody named
  // rather than to a window reset. The grace minutes exist so the meter has
  // really turned over before a resume fires; a time a person typed does not
  // want fifteen minutes added to it. Still floored a minute out, because a
  // task registered for a moment already past fires immediately.
  let when = Number.isFinite(options.at)
    ? Math.max(options.at, now + MINUTE)
    : wakeAt(options.resetsAt, config.graceMinutes, now);
  if (!when) return { ok: false, error: 'no reset time to wake after' };

  const state = read();
  const id = options.sessionId;
  // Two windows starting in the same second race each other for .claude.json
  // (verified: it corrupts, and onboarding comes back). A minute apart is safe.
  for (let guard = 0; guard < 20; guard++) {
    const clash = records(state).find((r) => r.id !== id && Number.isFinite(r.wakeAt) && Math.abs(r.wakeAt - when) < MINUTE);
    if (!clash) break;
    when = clash.wakeAt + MINUTE;
  }
  const launchCwd = launchDirFor(options.cwd || process.cwd());
  const name = taskName(id, when);
  // Names are unique per wake now, so re-arming no longer replaces the old
  // registration by name; the previous one has to be retired by hand or it
  // stays live and fires on its own.
  //
  // It is retired AFTER the replacement is registered, never before. While
  // the names were identical, -Force made this one atomic operation. With
  // unique names, cancelling first opens a window in which the old wake is
  // gone and the new one does not exist yet - and if registration then
  // fails, that window never closes: the user is left with no relay at all,
  // unattended, having had a working one a moment earlier.
  const existing = armedFor(state, id);
  const previousTask = existing && existing.task && existing.task !== name ? existing.task : null;
  let preflight = null;
  if (config.mode === 'resume' && (!options.hostName || options.hostName === host.CLAUDE) && options.preflight !== false) {
    preflight = preflightPrompts(launchCwd, config);
    if (preflight.ok && preflight.pending.length) note('user approval required for ' + id + ': ' + preflight.pending.join(', '), now);
    else if (!preflight.ok) note('could not inspect the start-up questions for ' + id + ': ' + preflight.error, now);
  }
  // Re-arming the same session for the same reset would register the task
  // twice; -Force replaces it, and the record is rewritten either way.
  const argv = [path.join(__dirname, 'wake.js'), '--id', id];
  if (options.hostName) argv.push('--host', options.hostName);
  // The wake runs hours later in a process that inherits nothing. If this
  // session is pointed at a config directory of its own, the wake has to be
  // pointed at the same one or it reads somebody else's relay - which in
  // testing meant it read the real one and found nothing armed.
  if (process.env.CLAUDE_CONFIG_DIR) argv.push('--config-dir', process.env.CLAUDE_CONFIG_DIR);
  const scheduled = options.schedule === false ? { ok: true, how: 'none' } : schedule(when, argv, name, options.cwd, options.deadline);
  if (scheduled.ok && previousTask) {
    // Safe now: the replacement exists.
    try {
      cancelSchedule(previousTask);
    } catch (err) {
      // The expiry removes it eventually either way.
    }
  }
  if (!scheduled.ok) {
    // The old wake is deliberately left alone here. A stale wake that still
    // fires is worth more than none, and it carries the same continuation.
    note('arm failed for ' + id + ': ' + scheduled.error + (previousTask ? '; the previous wake was left in place' : ''), now);
    // A launcher written for a session that has no record is a stray; one
    // that an earlier wake of this session still points at is kept with it.
    sweepWakeLaunchers(state);
    return { ok: false, error: scheduled.error };
  }

  const record = {
    id,
    task: scheduled.how === 'none' ? null : name,
    host: options.hostName || host.CLAUDE,
    cwd: options.cwd || process.cwd(),
    launchCwd: launchCwd !== (options.cwd || process.cwd()) ? launchCwd : null,
    project: options.project || null,
    armedAt: now,
    wakeAt: when,
    resetsAt: options.resetsAt,
    percentAtArming: options.binding ? options.binding.percentUsed : null,
    window: options.binding ? options.binding.label || options.binding.key : null,
    // The label is for reading; the key is what the meter is indexed by.
    windowKey: options.binding && options.binding.key ? options.binding.key : null,
    mode: config.mode,
    how: scheduled.how,
    warning: scheduled.warning || null,
    preflight: null,
    startupQuestions: preflight && preflight.ok ? preflight.pending : null,
    attempt: 0,
    continuation: false,
    // The outstanding items travel with the record, not just their count. They
    // are the work; a wake that knows only "two things were pending" has
    // nothing to hand back.
    work: options.work
      ? {
          pending: options.work.pending,
          source: options.work.source,
          todos: (options.work.todos || []).filter((todo) => todo.status !== 'completed').slice(0, 20),
          plan: options.work.plan ? String(options.work.plan).slice(0, 2000) : null,
        }
      : null,
  };
  // Displacing somebody else's live relay is legitimate - one machine, one
  // relay - but it must not be silent. A wake still in the future belonged to
  // work that somebody expected to be picked up.
  const beside = records(state).filter((r) => r.id !== id).map((r) => r.id.slice(0, 8));
  putRecord(state, record);
  write(state);
  sweepWakeLaunchers(state);
  note(
    'armed ' + id + ' for ' + new Date(when).toISOString() + ' via ' + scheduled.how +
      (scheduled.primaryError ? ' (' + scheduled.primaryError + ')' : '') +
      (beside.length ? ' beside ' + beside.join(', ') : ''),
    now
  );
  return { ok: true, record };
}

// `id` is optional, and when it is given it is a guard rather than a lookup:
// clear the relay only if the thing armed is the thing the caller means.
//
// Without it, disarm clears whatever happens to be armed, and that is not
// hypothetical. Measured 2026-09-14: a second process armed a throwaway
// session at 04:57:04 and cleaned it up four seconds later, and the cleanup
// took a live relay for an unrelated session - armed seven seconds earlier,
// due to wake five hours later - with it. Nothing reported that, because from
// disarm's point of view it did exactly what it was asked.
//
// The CLI never calls this without an id unless `relay cancel --all` was
// typed: it passes the --session id, this session's, or the only one armed,
// and with several armed and none of them named it refuses. Anything that
// knows which session it is tidying up should say so.
function disarm(reason, now, id) {
  const state = read();
  const all = records(state);
  if (!all.length) return { ok: true, changed: false };
  const targets = id ? all.filter((r) => r.id === id) : all;
  if (!targets.length) {
    note('nothing armed for ' + id + '; ' + all.map((r) => r.id.slice(0, 8)).join(', ') + ' left as they were', Number.isFinite(now) ? now : Date.now());
    return { ok: true, changed: false, refused: true, armed: all[0].id };
  }
  for (const record of targets) {
    if (record.task) cancelSchedule(record.task);
    state.history.push(Object.assign({}, record, { endedAt: Number.isFinite(now) ? now : Date.now(), outcome: reason || 'cancelled' }));
    dropRecord(state, record.id);
    try {
      fs.unlinkSync(planFile(record.id));
    } catch (err) {
    }
    note('disarmed ' + record.id + ': ' + (reason || 'cancelled'), now);
  }
  state.history = state.history.slice(-10);
  write(state);
  sweepWakeLaunchers(state);
  return { ok: true, changed: true, record: targets[0], records: targets };
}

function formatWait(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return 'now';
  const minutes = Math.round(ms / MINUTE);
  if (minutes < 60) return minutes + ' min';
  const hours = Math.floor(minutes / 60);
  return hours + 'h ' + (minutes % 60) + 'm';
}

function status(now) {
  const at = Number.isFinite(now) ? now : Date.now();
  reapLost(at);
  const state = read();
  const config = settings(state);
  const able = capabilities();
  const lines = [];
  lines.push(
    'Relay is ' + (config.enabled ? 'ON' : 'OFF') + ', arming at ' + config.at + ' per cent, waking ' +
      config.graceMinutes + ' min after the reset, delivery ' + config.mode +
      (config.mode === 'resume' ? (config.fresh ? ' into a new session (fresh on)' : ' of the same conversation (fresh off)') : '') + '.'
  );
  const all = records(state);
  for (const armed of all) {
    lines.push(
      'Armed: session ' + armed.id.slice(0, 8) + ' in ' + armed.cwd + ', wake in ' +
        formatWait(armed.wakeAt - at) + ' (' + new Date(armed.wakeAt).toLocaleString() + '), via ' + armed.how + '.'
    );
    if (armed.warning) lines.push('  Caveat: ' + armed.warning + '.');
    if (armed.startupQuestions && armed.startupQuestions.length) lines.push('  User approval required: ' + armed.startupQuestions.join(', '));
    if (armed.launchCwd) lines.push('  Resumes from ' + armed.launchCwd + ' (the home folder can never be trusted) with --add-dir back to ' + armed.cwd);
    lines.push('  Continuation written: ' + (armed.continuation ? 'yes' : 'not yet'));
  }
  if (!all.length) lines.push('Nothing armed.');
  else if (all.length > 1) lines.push(all.length + ' sessions armed; each wakes on its own task.');
  lines.push(
    'Available here: ' + [
      able.claude ? 'claude CLI' : null,
      able.codex ? 'codex CLI' : null,
      able.computerUse ? 'Computer Use' : null,
    ].filter(Boolean).join(', ') || 'no CLI found'
  );
  const last = state.history[state.history.length - 1];
  if (last) lines.push('Last relay: ' + last.outcome + ' at ' + new Date(last.endedAt).toLocaleString() + '.');
  return lines.join('\n');
}

/* ------------------------------------------------------ always thinking --- */

// "Ultrathink all the time" is two different things and only one of them is a
// prompt. Claude Code recognises the word ultrathink in the text it is given,
// which is what the relay puts there; for every other turn the switch lives in
// settings as alwaysThinkingEnabled. Writing somebody's settings file is not
// something to do quietly, so it is backed up first and reported afterwards.
function settingsFile() {
  return path.join(configDir(), 'settings.json');
}

function applyAlwaysThinking(on) {
  const file = settingsFile();
  let parsed = {};
  let existed = false;
  try {
    const raw = fs.readFileSync(file, 'utf8');
    existed = true;
    // Editors on Windows save JSON with a byte order mark often enough that
    // refusing it would read as "your settings file is broken" to somebody
    // whose settings file is fine.
    parsed = JSON.parse(raw.replace(/^﻿/, ''));
    fs.writeFileSync(file + '.bak-usage-limits', raw);
  } catch (err) {
    if (existed) return { ok: false, error: 'settings.json is not readable JSON; left untouched' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, error: 'settings.json is not an object; left untouched' };
  if (on) parsed.alwaysThinkingEnabled = true;
  else delete parsed.alwaysThinkingEnabled;
  try {
    fs.mkdirSync(configDir(), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(parsed, null, 2) + '\n');
  } catch (err) {
    return { ok: false, error: err.message };
  }
  return { ok: true, file, backup: existed ? file + '.bak-usage-limits' : null };
}

// The folder a Claude Code session ran in, from the cwd its own transcript
// records. Only the first 256 KB is read; a cut last line is skipped.
function sessionCwd(id) {
  if (!id) return null;
  let file = null;
  try {
    file = require('./wake.js').transcriptFile(id);
  } catch (err) {
    return null;
  }
  if (!file) return null;
  let text = '';
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(256 * 1024);
      const n = fs.readSync(fd, buf, 0, buf.length, 0);
      text = buf.toString('utf8', 0, n);
    } finally {
      fs.closeSync(fd);
    }
  } catch (err) {
    return null;
  }
  for (const line of text.split('\n')) {
    if (!line.includes('"cwd"')) continue;
    try {
      const entry = JSON.parse(line);
      if (entry && typeof entry.cwd === 'string' && entry.cwd) {
        // A folder since moved or deleted is no place to resume in.
        try {
          return fs.statSync(entry.cwd).isDirectory() ? entry.cwd : null;
        } catch (err) {
          return null;
        }
      }
    } catch (err) {
      // A line cut at the read boundary, or not JSON.
    }
  }
  return null;
}

// `relay arm [--session <id>] [note text]`: take the current reading, book the
// wake against the binding window's reset, and store any text given as the
// continuation. Uses the report rather than the hook's cache, so it costs a
// scan; that is fine from a command line.
async function armByHand(rest) {
  const usage = require('./usage.js');
  usage.setHost(host.detect(process.argv.slice(2), process.env));
  const config = configure({ enabled: true });
  const now = Date.now();
  const data = await usage.report(now, {});
  const binding = data && data.binding;
  if (!binding || !Number.isFinite(binding.resetsAt)) return 'No window with a known reset time to arm against; run /usage and try again.';
  const at = rest.indexOf('--session');
  const named = at !== -1 && rest[at + 1] ? rest[at + 1] : null;
  const sessionId = named || (data.session && data.session.id) || null;
  if (!sessionId) return 'No session id: pass --session <id> (from usage.js --sessions).';
  const text = rest.filter((item, i) => item !== '--session' && !(at !== -1 && i === at + 1)).join(' ').trim();
  // A named session resumes in its own folder, not wherever this command was
  // typed: the record's cwd is where the wake runs `claude --resume`, and the
  // shell's folder sent it to the wrong project (2026-11-09).
  const current = process.env.CLAUDE_CODE_SESSION_ID || process.env.CLAUDE_SESSION_ID || null;
  let cwd = process.cwd();
  // The session's own transcript wins over the shell's folder even for this
  // session: the Bash tool may have cd'd elsewhere since it started. Only a
  // named other session with no folder found is refused; otherwise the
  // shell's folder stands, as before.
  const own = sessionCwd(sessionId);
  if (own) cwd = own;
  else if (named && named !== current && usage.currentHost() === host.CLAUDE) {
    return 'Could not find the folder session ' + named.slice(0, 8) + ' ran in (no transcript with a cwd, or that folder no longer exists); run relay arm from inside that session or its folder instead.';
  }
  const result = arm({
    now,
    config,
    sessionId,
    binding,
    resetsAt: binding.resetsAt,
    cwd,
    project: path.basename(cwd),
    hostName: usage.currentHost(),
    work: { hasWork: true, pending: 1, source: 'manual', todos: [], plan: text || null },
  });
  if (!result.ok) return 'Could not arm: ' + result.error;
  if (text) saveContinuation(sessionId, text);
  // armable() refuses a 5-hour wake while low-priority is acknowledged, and
  // this path never went through it: `relay arm --session <id>` booked the wake
  // anyway and said nothing, which is the double-start the whole gate exists to
  // prevent. An explicit command is still honoured - it is what somebody typed
  // - but it says what `defer reset` says, so the person deciding has the fact.
  let lowPriorityNote = '';
  if (binding.key === 'five_hour' && usage.currentHost() === host.CLAUDE) {
    try {
      if (lowpri.readAck(now)) {
        lowPriorityNote =
          ' Note: you have said /low-priority is on, so this session carries past the 5-hour reset ' +
          'on its own and this wake would start the work a second time. Arm against the weekly ' +
          'instead, or say usage-mode --low-priority off if it has ended; "relay cancel" calls this one off.';
      }
    } catch (err) {
      // A missing or unreadable record is not a reason to refuse a command.
    }
  }
  return (
    'Armed by hand for session ' + sessionId.slice(0, 8) + ': wake at ' +
      new Date(result.record.wakeAt).toLocaleString() + ' via ' + result.record.how + '.' +
      (result.record.startupQuestions && result.record.startupQuestions.length ? ' User approval required: ' + result.record.startupQuestions.join(', ') + '.' : '') +
      (text ? ' Continuation saved.' : ' No continuation yet - add one with: relay note "<text>"') +
      lowPriorityNote
  );
}

/* ------------------------------------------------------------ the cloud --- */

// Carrying the work into a cloud session now, instead of waiting for the reset.
//
// With usage credits off (org_level_disabled on this account) the 5-hour wall
// stops a local session dead, and the wake can only pick the work up after the
// reset. The CLI offers a second way at that same wall: a cloud-session credit
// (lowpri.cloudCredit), and `claude --cloud <description>` starts a
// claude.ai/code session. One was seen on 2026-09-28 still working with its own
// server record saying five_hour "rejected".
//
// Two things make it unlike the wake, and both are said rather than assumed.
// The cloud session clones the repository from GitHub, so it has none of this
// machine's uncommitted changes or unpushed commits; and it cannot read a file
// here, so the hand-off rides inline as the description instead of as a
// pointer to relay-plan-<id>.md.
//
// `relay cloud` prints the command and starts nothing. `--go` starts it, and is
// guarded the way the scheduler is: under node --test, with
// USAGE_LIMITS_CLOUD=dry-run, or with the home folder redirected it launches
// nothing and says so; USAGE_LIMITS_CLOUD=real overrides all three. A cloud
// session spends a real credit, so no test may ever start one.
function cloudLaunchMode() {
  const said = String(process.env.USAGE_LIMITS_CLOUD || '').trim().toLowerCase();
  if (said === 'real') return { dry: false, why: null };
  if (said === 'dry-run' || said === 'dry') return { dry: true, why: 'USAGE_LIMITS_CLOUD=' + said };
  if (process.env.NODE_TEST_CONTEXT) return { dry: true, why: 'running under node --test' };
  if (sandboxedHome()) return { dry: true, why: 'the home folder is redirected to ' + os.homedir() };
  return { dry: false, why: null };
}

// The longest description worth passing as one argument. Linux refuses a
// single argument past 128 KiB (MAX_ARG_STRLEN); Windows caps a whole command
// line at 32,767 characters, and at 8,191 once cmd.exe is in the way.
const CLOUD_ARG_MAX = { win32: 32000, posix: 120000 };

function runGit(args, cwd) {
  const run = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 10000, windowsHide: true });
  return { status: run.status, stdout: String(run.stdout || '').trim() };
}

// What the cloud clone will and will not have. `git` is injectable so the
// states can be tested without a repository in each of them.
function gitState(cwd, git) {
  const run = git || runGit;
  const inside = run(['rev-parse', '--is-inside-work-tree'], cwd);
  if (inside.status !== 0 || inside.stdout !== 'true') return { repo: false };
  const status = run(['status', '--porcelain'], cwd);
  const dirty = status.status === 0 && status.stdout ? status.stdout.split('\n').filter(Boolean).length : 0;
  const branch = run(['rev-parse', '--abbrev-ref', 'HEAD'], cwd).stdout || null;
  const tracking = run(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], cwd);
  const upstream = tracking.status === 0 && tracking.stdout ? tracking.stdout : null;
  let unpushed = null;
  if (upstream) {
    const count = run(['rev-list', '--count', '@{u}..HEAD'], cwd);
    unpushed = count.status === 0 ? Number(count.stdout) || 0 : null;
  }
  const remotes = run(['remote'], cwd);
  return { repo: true, dirty, branch, upstream, unpushed, remote: remotes.status === 0 && Boolean(remotes.stdout) };
}

function plural(n, word) {
  return n + ' ' + word + (n === 1 ? '' : 's');
}

// `cli` is the claude a person on Windows would be running the printed command
// with. A batch shim (claude.cmd from npm) runs through cmd.exe even from
// PowerShell, and cmd.exe ends a command at the first line break, so the cloud
// session would get only the hand-off's first line. `native` is a claude.exe
// found elsewhere on the machine, if there is one: --go already uses it.
function cloudWarnings(git, prompt, platform, cli, native) {
  const out = [];
  if (!git.repo) {
    out.push('This folder is not a git repository. A cloud session starts from a clone of a GitHub repository, so there is nothing here for it to start from.');
  } else {
    if (!git.remote) out.push('The repository has no remote, so there is nothing on GitHub for the cloud session to clone.');
    if (git.dirty) {
      out.push(plural(git.dirty, 'uncommitted change') + ' in the working tree. The cloud session clones from GitHub and will not see ' +
        (git.dirty === 1 ? 'it' : 'them') + ': commit and push first.');
    }
    if (git.remote && !git.upstream) {
      out.push('Branch ' + git.branch + ' has no upstream, so the cloud session cannot clone it: git push -u origin ' + git.branch + ' first.');
    }
    if (git.unpushed) {
      out.push(plural(git.unpushed, 'commit') + ' on ' + git.branch + ' not pushed to ' + git.upstream + ': push first, or the cloud session starts without ' +
        (git.unpushed === 1 ? 'it' : 'them') + '.');
    }
  }
  const limit = platform === 'win32' ? CLOUD_ARG_MAX.win32 : CLOUD_ARG_MAX.posix;
  if (prompt.length > limit) {
    out.push('The hand-off is ' + prompt.length + ' characters, more than one command-line argument holds here (' + limit + '): shorten the continuation (relay note) and run this again.');
  }
  if (platform === 'win32' && cli && /\.(cmd|bat)$/i.test(cli)) {
    out.push('claude here is ' + cli + ', a batch shim. PowerShell runs it through cmd.exe, and cmd.exe cuts the hand-off at its first line break, ' +
      'so the cloud session would get one line of it: ' +
      (native && !/\.(cmd|bat)$/i.test(native)
        ? 'run it with the native claude.exe instead (& ' + psQuote(native) + ' in place of claude), or use --go, which does.'
        : 'run it where claude is the native claude.exe (claude install puts one in ~/.local/bin).'));
  }
  if (platform === 'win32' && prompt.indexOf('"') !== -1) {
    out.push('The hand-off holds double quotes, which Windows PowerShell before 7.3 drops from an argument: paste it into PowerShell 7.3 or later (pwsh), or use --go.');
  }
  return out;
}

// The command a person pastes. PowerShell on Windows, where the relay already
// lives, and sh everywhere else; both keep line breaks inside single quotes.
function cloudCommand(prompt, platform) {
  const quoted = platform === 'win32' ? psQuote(prompt) : require('./wake.js').shQuote(prompt);
  return 'claude --cloud ' + quoted;
}

// The same prompt the wake would deliver - continuation, outstanding todos or
// the approved plan, thinking, voice, bug check - opened for a cloud session.
// The session is this one (CLAUDE_CODE_SESSION_ID) unless --session names
// another; with neither, the one armed relay. Text given on the command line
// stands in for the stored continuation.
function cloudHandoff(input) {
  const options = input || {};
  const env = options.env || process.env;
  const state = read();
  const config = settings(state);
  const me = options.sessionId || env.CLAUDE_CODE_SESSION_ID || env.CLAUDE_SESSION_ID || null;
  const all = records(state);
  const record = armedFor(state, me) || (!me && all.length === 1 ? all[0] : null);
  const id = me || (record && record.id) || null;
  const given = String(options.text || '').trim().slice(0, CONTINUATION_MAX);
  const continuation = given || (id ? readContinuation(id) : '');
  let work = record && record.work && Array.isArray(record.work.todos) ? record.work : null;
  if (!work && id) {
    const transcript = require('./wake.js').transcriptFile(id);
    const found = transcript ? detectWork(transcript) : null;
    if (found && found.hasWork) work = found;
  }
  const outstanding = work ? work.todos.filter((todo) => todo.status !== 'completed').length : 0;
  if (!continuation && !outstanding && !(work && work.plan)) {
    return {
      ok: false,
      error:
        'Nothing to hand over' + (id ? ' for session ' + id.slice(0, 8) : '') + ': no continuation, no outstanding todos, no approved plan. ' +
        'A cloud session has none of this conversation, so write what it needs first: relay cloud "<text>", or relay note "<text>" and run this again.',
    };
  }
  const platform = options.platform || process.platform;
  const cwd = (record && record.cwd) || options.cwd || process.cwd();
  const git = gitState(cwd, options.git);
  const prompt = compose({
    cloud: true,
    branch: git.repo ? git.branch : null,
    continuation,
    work,
    thinking: config.thinking !== 'off',
    voice: config.voice === false ? null : voice.card(),
    bugcheck: config.bugcheck,
  });
  return {
    ok: true,
    id,
    cwd,
    platform,
    prompt,
    source: given ? 'the text given' : continuation ? 'the saved continuation' : outstanding ? plural(outstanding, 'outstanding todo') : 'the approved plan',
    command: cloudCommand(prompt, platform),
    git,
    warnings: cloudWarnings(git, prompt, platform, options.cli || null, options.nativeCli || null),
  };
}

// The CLI to launch. A batch shim cannot carry the hand-off - cmd.exe ends a
// command at the first line break - so on Windows the native claude.exe is
// looked for first.
function cloudCli(env, platform) {
  const environment = env || process.env;
  if (environment.USAGE_LIMITS_CLAUDE_CLI) return firstExisting([environment.USAGE_LIMITS_CLAUDE_CLI]);
  if (platform === 'win32') {
    const native = firstExisting([path.join(os.homedir(), '.local', 'bin', 'claude.exe')]);
    if (native) return native;
    const where = spawnSync('where', ['claude.exe'], { encoding: 'utf8', timeout: 10000, windowsHide: true });
    const first = where.status === 0 ? String(where.stdout || '').split(/\r?\n/)[0].trim() : '';
    return first || findClaude(environment);
  }
  const found = findClaude(environment);
  if (found) return found;
  const which = spawnSync('sh', ['-c', 'command -v claude'], { encoding: 'utf8', timeout: 10000 });
  return which.status === 0 ? String(which.stdout || '').trim() || null : null;
}

// The claude that `claude` typed into a Windows shell runs: the first match on
// PATH that has an extension. `where claude` also lists the extensionless sh
// script npm writes beside claude.cmd, and lists it first, but neither shell
// runs a file with no extension - so taking the first line named the sh
// script, and the shim warning never fired for the npm install it is about.
// Only asked on Windows. `run` stands in for spawnSync in the tests.
function shellClaude(env, run) {
  const environment = env || process.env;
  if (environment.USAGE_LIMITS_CLAUDE_CLI) return firstExisting([environment.USAGE_LIMITS_CLAUDE_CLI]);
  const where = (run || spawnSync)('where', ['claude'], { encoding: 'utf8', timeout: 10000, windowsHide: true });
  const lines = where && where.status === 0 ? String(where.stdout || '').split(/\r?\n/).map((line) => line.trim()) : [];
  const first = lines.find((line) => line && path.win32.extname(line)) || '';
  return first || findClaude(environment);
}

// `deps` holds what the launch does to the world - mode, cli, spawn - so it can
// be tested without starting anything. Detached, with its output in a run log,
// because the command outlives this process and somebody will ask what it did.
function launchCloud(handoff, deps) {
  const d = deps || {};
  const mode = d.mode || cloudLaunchMode();
  const who = handoff.id ? 'session ' + handoff.id.slice(0, 8) : 'the text given';
  if (mode.dry) {
    note('cloud: dry run for ' + who + ', nothing launched (' + mode.why + ')');
    return { ok: true, dry: true, text: 'Dry run: nothing was launched (' + mode.why + ').' };
  }
  if (!handoff.git.repo) return { ok: false, text: 'Not launched: there is no repository here for a cloud session to clone.' };
  const cli = d.cli || cloudCli(d.env, handoff.platform);
  if (!cli) return { ok: false, text: 'Not launched: the claude CLI was not found. Run the command above yourself.' };
  if (handoff.platform === 'win32' && /\.(cmd|bat)$/i.test(cli)) {
    return {
      ok: false,
      text: 'Not launched: claude here is ' + cli + ', a batch shim, and cmd.exe ends a command at the first line break, so the hand-off cannot pass through it. ' +
        'PowerShell runs a shim through cmd.exe too, so run the command above where claude is the native claude.exe (claude install puts one in ~/.local/bin).',
    };
  }
  const now = Date.now();
  const log = writeRunLog(runLogFile('cloud', now), '--- claude --cloud from ' + handoff.cwd + ' for ' + who + ', ' + new Date(now).toISOString() + ' ---\n');
  let fd = null;
  try {
    if (log) fd = fs.openSync(log, 'a');
  } catch (err) {
    fd = null;
  }
  // Nobody's child: launched from inside a session, it would otherwise inherit
  // that session's markers (see the wake's launcher).
  const env = Object.assign({}, d.env || process.env);
  delete env.CLAUDE_CODE_CHILD_SESSION;
  delete env.CLAUDE_CODE_SESSION_ID;
  try {
    const child = (d.spawn || spawn)(cli, ['--cloud', handoff.prompt], {
      cwd: handoff.cwd,
      detached: true,
      stdio: fd === null ? 'ignore' : ['ignore', fd, fd],
      windowsHide: true,
      env,
    });
    if (child && typeof child.on === 'function') {
      child.on('error', (err) => {
        note('cloud: claude --cloud for ' + who + ' failed to start: ' + err.message);
      });
    }
    if (child && typeof child.unref === 'function') child.unref();
    const pid = child && child.pid ? child.pid : null;
    note('cloud: launched claude --cloud for ' + who + ' from ' + handoff.cwd + (pid ? ' (pid ' + pid + ')' : '') + (log ? ', output in ' + log : ''));
    return {
      ok: true,
      pid,
      log,
      text: 'Started claude --cloud' + (pid ? ' (pid ' + pid + ')' : '') + '.' + (log ? ' What it prints goes to ' + log + '.' : '') +
        ' The session appears on claude.ai/code.',
    };
  } catch (err) {
    note('cloud: could not launch claude --cloud for ' + who + ': ' + err.message);
    return { ok: false, text: 'Could not start claude --cloud: ' + err.message };
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch (err) {
        // The child has its own copy.
      }
    }
  }
}

function cloud(rest, deps) {
  const args = rest || [];
  const d = deps || {};
  const at = args.indexOf('--session');
  const named = at !== -1 ? args[at + 1] || null : null;
  const go = args.includes('--go');
  // --host is the plugin's own flag (relay.md: add --host codex under Codex),
  // and a hand-off that ended in "--host codex" would be telling the cloud
  // session something nobody meant.
  const skip = new Set();
  for (const flag of ['--session', '--host']) {
    const i = args.indexOf(flag);
    if (i !== -1) skip.add(i).add(i + 1);
  }
  const text = args.filter((item, i) => item !== '--go' && !skip.has(i)).join(' ');
  // Which claude the printed command would meet, asked only for Windows, where
  // a batch shim cannot carry it: the first on PATH, as the shell finds it.
  const platform = d.platform || process.platform;
  let cli = null;
  let nativeCli = null;
  if (platform === 'win32') {
    try {
      cli = d.cli !== undefined ? d.cli : shellClaude(d.env);
      if (/\.(cmd|bat)$/i.test(String(cli || ''))) nativeCli = d.nativeCli !== undefined ? d.nativeCli : cloudCli(d.env, platform);
    } catch (err) {
      cli = null;
    }
  }
  const handoff = cloudHandoff({ sessionId: named, text, env: d.env, git: d.git, platform, cwd: d.cwd, cli, nativeCli });
  if (!handoff.ok) return handoff.error;
  let amount = null;
  try {
    amount = lowpri.creditText(lowpri.cloudCredit(d.account !== undefined ? d.account : lowpri.snapshot()));
  } catch (err) {
    amount = null;
  }
  const lines = [
    'Cloud hand-off' + (handoff.id ? ' for session ' + handoff.id.slice(0, 8) : '') + ', from ' + handoff.source + ': ' +
      handoff.prompt.length + ' characters, inline, because a cloud session cannot read a file on this machine.' +
      (amount ? ' It runs on the ' + amount + ' cloud-session credit, not the plan\'s 5-hour window.' : ''),
  ];
  for (const warning of handoff.warnings) lines.push('Warning: ' + warning);
  lines.push('', 'Run this from ' + handoff.cwd + (handoff.platform === 'win32' ? ', in PowerShell' : '') + ':', '', handoff.command, '');
  if (!go) {
    lines.push('relay cloud --go starts it from here.');
    return lines.join('\n');
  }
  lines.push(launchCloud(handoff, d).text);
  return lines.join('\n');
}

/* ------------------------------------------------------------- doctor ----- */

// Everything that has to be true hours from now, checked while somebody is
// still here to fix it.
//
// The relay's whole promise is that it works unattended, and every part of it
// fails quietly: a CLI that moved, a permission mode nobody set so the run sits
// waiting for an approval, a machine that sleeps through its own wake, a
// network that is not there. Each of those has cost a whole window at least
// once. This asks all of them at once and says which would bite.
async function doctor(now) {
  const at = Number.isFinite(now) ? now : Date.now();
  const state = read();
  const config = settings(state);
  const caps = capabilities();
  const checks = [];
  const add = (name, ok, detail, severity) => checks.push({ name, ok, detail, severity: severity || (ok ? 'ok' : 'error') });

  add('relay enabled', config.enabled, config.enabled ? 'on, arming at ' + config.at + ' per cent' : 'off - nothing will ever be scheduled');
  add('delivery mode', true, config.mode === 'resume'
    ? 'resume: it starts the CLI itself, ' + (config.fresh ? 'as a new session with the hand-off as its first prompt (fresh on)' : 'resuming the same conversation (fresh off)')
    : 'notify: it raises a toast and leaves the plan on disk', 'ok');
  add('arming point', true, config.armOn === 'completion'
    ? 'completion - it waits for the reply to finish, and stops waiting past ' + config.backstopAt + ' per cent'
    : 'threshold - it arms the moment the window crosses ' + config.at + ' per cent, even mid-reply', 'ok');

  if (config.mode === 'resume') {
    add('user permissions', true,
      'native Claude Code permissions apply; interactive runs can ask the user, and unattended approval requests are denied', 'ok');
  }

  const cli = caps.claude || caps.codex;
  add('a CLI to resume with', Boolean(cli), cli || 'neither the claude nor the codex CLI could be found on PATH');

  // Whether there is a login for the wake to resume under, asked of the CLI
  // itself: `claude auth status --json` reports loggedIn and nothing secret.
  // WHEN it expires is the one thing this cannot check. That command reports
  // no expiry (2.1.263, read from its output), and the only expiry on disk
  // is inside .credentials.json, which the relay does not read for credential
  // values. So it is stated as a limit rather than guessed at: a login that
  // lapses before the wake stops the resumed run at a prompt nobody answers.
  if (caps.claude) {
    const auth = spawnSync(caps.claude, ['auth', 'status', '--json'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 20000,
      shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(caps.claude),
    });
    let parsed = null;
    try {
      parsed = JSON.parse(String(auth.stdout || '').trim());
    } catch (err) {
      parsed = null;
    }
    if (parsed && typeof parsed.loggedIn === 'boolean') {
      add('login', parsed.loggedIn, parsed.loggedIn
        ? 'logged in' + (parsed.subscriptionType ? ' (' + parsed.subscriptionType + ')' : '') +
          '. Its expiry is not checked: claude auth status does not report one and the relay does not read .credentials.json, so run /login before a relay that fires hours from now'
        : 'not logged in - the resumed run would stop at the login prompt. Run: claude auth login');
    } else {
      add('login', true, 'claude auth status gave no answer; expiry is not checked either way, so run /login before a long relay', 'warning');
    }
  }

  const net = await require('./net.js').reachable({ timeoutMs: 8000 });
  add('network to the API', net.online, net.detail,
    net.online ? 'ok' : net.reason === 'intercepted' ? 'error' : 'warning');

  // Can a task actually be registered by this account? Registering and removing
  // a throwaway is the only honest answer; asking the policy is not.
  if (process.platform === 'win32') {
    for (const rec of records(state)) {
      const pre = preflightPrompts(rec.launchCwd || rec.cwd, config, { dry: true });
      const quiet = pre.ok && !pre.pending.length;
      add('start-up questions for ' + String(rec.id).slice(0, 8), quiet,
        pre.ok
          ? (quiet ? 'folder trust already recorded by Claude Code in ' + pre.file : pre.pending.join(', '))
          : pre.error,
        quiet ? 'ok' : 'warn');
    }
    if (!records(state).length && config.mode === 'resume') {
      const pre = preflightPrompts(launchDirFor(process.cwd()), config, { dry: true });
      const quiet = pre.ok && !pre.pending.length;
      add('start-up questions here', quiet,
        pre.ok
          ? (quiet ? 'folder trust already recorded by Claude Code for ' + process.cwd() : pre.pending.join(', '))
          : pre.error,
        quiet ? 'ok' : 'warn');
    }
    const probeName = 'usage-limits-doctor-probe';
    // Ninety seconds, not twenty: the PowerShell route takes over thirty on
    // this machine, and a probe cut off before it can finish reports the
    // fallback, which is a different answer to the question being asked.
    const registered = scheduleWindows(at + 6 * 60 * MINUTE, [path.join(__dirname, 'wake.js'), '--id', 'doctor-probe'], probeName, os.homedir(), at + 90000);
    add('scheduled tasks', registered.ok, registered.ok
      ? 'registered a test task via ' + registered.how + (registered.how === 'schtasks'
        ? ' - the PowerShell path failed (' + registered.primaryError + '), so a sleeping machine will miss its wake'
        : ' - StartWhenAvailable and WakeToRun are set, so a machine that was off or asleep still runs it')
      : registered.error, registered.ok && registered.how === 'schtasks' ? 'warning' : undefined);
    if (registered.ok) cancelSchedule(probeName);
    // The probe's launcher has no record, so the sweep takes it.
    sweepWakeLaunchers(state);

    // A wake at 3am is no use if the machine hibernates at midnight and the
    // task is not allowed to wake it. This reads the actual power policy.
    const power = spawnSync('powercfg.exe', ['/query', 'SCHEME_CURRENT', 'SUB_SLEEP'], { encoding: 'utf8', windowsHide: true, timeout: 8000 });
    const denied = /Allow wake timers[\s\S]{0,600}?Current AC Power Setting Index: 0x00000000/i.test(power.stdout || '');
    add('wake timers', !denied,
      denied
        ? 'wake timers are disabled on AC power, so a sleeping machine will not wake for the relay. Fix in Windows power settings, or: powercfg /setacvalueindex SCHEME_CURRENT SUB_SLEEP RTCWAKE 1'
        : 'the power plan allows a scheduled task to wake this machine',
      denied ? 'warning' : 'ok');
  } else {
    add('scheduled wake', true, 'posix: at(1) or launchd, checked at arming time', 'ok');
  }

  add('config directory writable', (() => {
    try {
      fs.mkdirSync(configDir(), { recursive: true });
      const probe = path.join(configDir(), '.doctor');
      fs.writeFileSync(probe, 'x');
      fs.unlinkSync(probe);
      return true;
    } catch (err) {
      return false;
    }
  })(), configDir());

  if (state.armed) {
    const continuation = readContinuation(state.armed.id);
    add('continuation saved', Boolean(continuation && continuation.trim()),
      continuation && continuation.trim()
        ? continuation.trim().length + ' characters - the resumed run knows what it is picking up'
        : 'nothing written. The wake would hand back only the todo list, which is thinner than a paragraph the session wrote itself. Use: relay note "<what to do next>"',
      'warning');
    add('wake time', Number.isFinite(state.armed.wakeAt),
      new Date(state.armed.wakeAt).toLocaleString() + ' (' + formatWait(state.armed.wakeAt - at) + ' from now) via ' + state.armed.how);
  } else {
    add('armed', false, 'nothing is armed yet', 'warning');
  }

  const errors = checks.filter((c) => c.severity === 'error');
  const warnings = checks.filter((c) => c.severity === 'warning');
  const mark = (c) => (c.severity === 'ok' ? '  ok   ' : c.severity === 'warning' ? '  warn ' : '  FAIL ');
  const lines = checks.map((c) => mark(c) + c.name.padEnd(26) + ' ' + c.detail);
  lines.unshift(errors.length
    ? errors.length + ' thing' + (errors.length === 1 ? '' : 's') + ' would stop the relay working.'
    : warnings.length
      ? 'Nothing would stop it, but ' + warnings.length + ' thing' + (warnings.length === 1 ? ' is' : 's are') + ' worth fixing.'
      : 'Everything the relay needs is in place.');
  lines.unshift('');
  return { text: lines.join('\n'), checks, errors: errors.length, warnings: warnings.length };
}

/* ----------------------------------------------------------------- cli ---- */

function main(argv) {
  const args = argv || [];
  const command = (args[0] || 'status').toLowerCase();
  const rest = args.slice(1);
  const value = rest.filter((item) => !item.startsWith('--'))[0];

  if (command === 'status') return status(Date.now());
  if (command === 'on' || command === 'off') {
    const config = configure({ enabled: command === 'on' });
    return (
      'Relay ' + (config.enabled ? 'ON' : 'OFF') + '.\n' +
      (config.enabled
        ? 'It arms once the binding window passes ' + config.at + ' per cent AND the session has an unfinished ' +
          'todo list or an approved plan. Delivery is "' + config.mode + '"' +
          (config.mode === 'notify' ? ' - it will notify you, not start anything by itself.' : ' - it will hand the plan back to the conversation itself.')
        : 'Nothing will be scheduled.')
    );
  }
  if (command === 'at') {
    if (!value) return 'Give a percentage, for example: relay at 75';
    return 'Arming at ' + configure({ at: Number(value) }).at + ' per cent.';
  }
  if (command === 'grace') {
    if (!value) return 'Give minutes, for example: relay grace 5';
    return 'Waking ' + configure({ graceMinutes: Number(value) }).graceMinutes + ' minutes after the reset.';
  }
  if (command === 'mode') {
    if (!['notify', 'resume'].includes(String(value))) return 'Mode is notify or resume.';
    const config = configure({ mode: value });
    return (
      'Delivery is now "' + config.mode + '".' +
      (config.mode === 'resume'
        ? '\nAt the wake it will run the CLI itself in the project directory, ' +
          (config.fresh ? 'as a new session (relay fresh on)' : 'resuming the same conversation (relay fresh on starts a new one instead)') +
          '. Native user permissions apply; an unattended request for approval is denied.'
        : '')
    );
  }
  if (command === 'permission') {
    return 'The relay does not set permission modes. Configure permissions directly in Claude Code; the relay never grants trust or approves actions.';
  }
  if (command === 'model') {
    return 'Resumed runs will use --model ' + (configure({ model: value || null }).model || '(the default)') + '.';
  }
  if (command === 'thinking') {
    if (!['off', 'resume', 'always'].includes(String(value))) return 'Thinking is off, resume or always.';
    const config = configure({ thinking: value });
    if (value !== 'always') {
      return (
        'Thinking: ' + config.thinking + '.' +
        (config.thinking === 'resume' ? ' The word ultrathink goes into the prompt the relay delivers.' : '')
      );
    }
    const applied = applyAlwaysThinking(true);
    return applied.ok
      ? 'Thinking: always. Set alwaysThinkingEnabled in ' + applied.file +
        (applied.backup ? ' (backup at ' + applied.backup + ')' : '') +
        '.\nIt applies to new sessions. Note that adaptive-reasoning models decide their own budget, so this is a request, not a guarantee.'
      : 'Could not set it: ' + applied.error;
  }
  if (command === 'note') {
    const state = read();
    const all = records(state);
    if (!all.length) return 'Nothing is armed, so there is nowhere to put a continuation yet.';
    // This session's own relay; with several armed and none this session's, the id has to be named.
    const sessionAt = rest.indexOf('--session');
    const named = sessionAt !== -1 ? rest[sessionAt + 1] : null;
    const me = named || process.env.CLAUDE_CODE_SESSION_ID || process.env.CLAUDE_SESSION_ID || null;
    const target = armedFor(state, me) || (all.length === 1 ? all[0] : null);
    if (!target) return all.length + ' relays are armed (' + all.map((r) => r.id.slice(0, 8)).join(', ') + ') and none is this session\'s; pass --session <id>.';
    const fromFile = rest.indexOf('--file') !== -1 ? rest[rest.indexOf('--file') + 1] : null;
    let text = fromFile ? '' : rest.filter((item, i) => item !== '--file' && item !== '--session' && !(sessionAt !== -1 && i === sessionAt + 1)).join(' ');
    if (fromFile) {
      try {
        text = fs.readFileSync(fromFile, 'utf8');
      } catch (err) {
        return 'Could not read ' + fromFile;
      }
    }
    const written = saveContinuation(target.id, text, { force: Boolean(named) });
    return written ? 'Continuation saved for the relay of ' + target.id.slice(0, 8) + ' (' + written + ').' : 'Nothing to save.';
  }
  if (command === 'cancel') {
    // One relay unless --all: the one --session names, else this session's,
    // else the only one armed. On 2026-11-09 `cancel --session ID` from a shell
    // with no session id of its own took every armed relay down, because the
    // named id was never read and "not this session's" fell through to all.
    const state = read();
    const all = records(state);
    if (!all.length) return 'Nothing was armed.';
    const list = all.map((r) => r.id.slice(0, 8)).join(', ');
    const sessionAt = rest.indexOf('--session');
    const named = sessionAt !== -1 ? rest[sessionAt + 1] || null : null;
    if (sessionAt !== -1 && !named) return 'No session id after --session.';
    let id;
    if (named) {
      if (!armedFor(state, named)) return 'No relay is armed for ' + named + '; armed: ' + list + '. Nothing was cancelled.';
      id = named;
    } else if (!rest.includes('--all')) {
      const me = process.env.CLAUDE_CODE_SESSION_ID || process.env.CLAUDE_SESSION_ID || null;
      if (armedFor(state, me)) id = me;
      else if (all.length === 1) id = all[0].id;
      else return all.length + ' relays are armed (' + list + ') and none is this session\'s; pass --session <id>, or --all for every one. Nothing was cancelled.';
    }
    const result = disarm('cancelled by hand', Date.now(), id);
    if (!result.changed) return 'Nothing was armed.';
    const n = result.records ? result.records.length : 1;
    return n > 1 ? n + ' relays cancelled and their scheduled wakes removed.' : 'Relay cancelled and the scheduled wake removed.';
  }
  // Arming by hand, for the cases the hook cannot see: Codex writes no plan
  // tool into its rollouts, so nothing there ever reads as work to carry; and
  // a person can have a project in their head that is in no todo list.
  if (command === 'arm') return armByHand(rest);
  // Past the wall now rather than after it: the same hand-off, into a cloud
  // session on the cloud-session credit.
  if (command === 'cloud') return cloud(rest);
  if (command === 'armon' || command === 'arm-on') {
    if (!['threshold', 'completion'].includes(String(value))) {
      return 'Arming is "threshold" (the moment the window crosses the mark, mid-reply) or "completion" (the end of the reply).';
    }
    const config = configure({ armOn: value });
    return config.armOn === 'completion'
      ? 'Arming at completion. Crossing ' + config.at + ' per cent no longer arms anything by itself - the relay arms when the reply it is watching finishes, so what it carries is work that reached a boundary rather than a state it was halfway through. Past ' + config.backstopAt + ' per cent it stops waiting and arms anyway, because a completion that never comes is a relay that was never armed.'
      : 'Arming at the threshold. It arms the moment the window crosses ' + config.at + ' per cent, even mid-reply.';
  }
  if (command === 'backstop') {
    if (!value) return 'Give a percentage, for example: relay backstop 95';
    const config = configure({ backstopAt: Number(value) });
    return 'Past ' + config.backstopAt + ' per cent it stops waiting for a completion and arms immediately.';
  }
  if (command === 'voice') {
    const on = !['off', 'false', 'no', '0'].includes(String(value || 'on').toLowerCase());
    configure({ voice: on });
    return on
      ? 'The hand-off will carry how you write, so the resumed session answers in your voice without being reminded.'
      : 'The hand-off will not carry how you write.';
  }
  if (command === 'bugcheck') {
    // pick() is local to settings(); the command checks the value itself.
    const wanted = String(value || 'on').toLowerCase();
    const choice = ['on', 'always', 'off'].includes(wanted) ? wanted : null;
    if (!choice) return 'Bug check: on (the hand-off asks for two passes), always (every prompt does), or off.';
    configure({ bugcheck: choice });
    if (choice === 'off') return 'Neither the hand-off nor the prompt hook will ask for the two bug passes.';
    if (choice === 'always') return 'Every prompt, and the hand-off, will ask for two bug passes before anything is called done.';
    return 'The hand-off will ask for two bug passes before anything is called done.';
  }
  if (command === 'show') {
    const on = !['off', 'false', 'no', '0'].includes(String(value || 'on').toLowerCase());
    configure({ show: on });
    return on
      ? 'The resumed run will be a session in a window you can see, with Remote Control on; a headless run keeps its output in relay log --run.'
      : 'The resumed run will be invisible. Its output is still kept: relay log --run.';
  }
  if (command === 'fresh') {
    const wanted = String(value || '').toLowerCase();
    if (!['on', 'off', 'true', 'false', 'yes', 'no', '1', '0'].includes(wanted)) {
      return 'Fresh is ' + (settings(read()).fresh ? 'ON' : 'OFF') + ' now. Say relay fresh on (the wake starts a new session with the hand-off) or relay fresh off (it resumes the same conversation).';
    }
    const config = configure({ fresh: ['on', 'true', 'yes', '1'].includes(wanted) });
    const when = config.mode === 'resume' ? '' : ' It applies once relay mode resume is set; with mode notify nothing is started either way.';
    return config.fresh
      ? 'Fresh ON: the wake starts a new claude session in the project, with the whole hand-off as its first prompt, Remote Control on and ' +
          'native user permissions' +
          '. The old conversation is left as it was; if it is still open and working again, the wake stands down.' + when
      : 'Fresh OFF: the wake resumes the same conversation (claude --resume).' + when;
  }
  if (command === 'onfailure' || command === 'on-failure') {
    if (!['rearm', 'stop'].includes(String(value))) return 'On failure: "rearm" (try again next window) or "stop" (leave it to a person).';
    const config = configure({ onFailure: value });
    return config.onFailure === 'rearm'
      ? 'A wake that fails will arm again for the next window rather than being lost, up to ' + config.maxRearms +
        ' time' + (config.maxRearms === 1 ? '' : 's') + ' - so the work gets ' + (config.maxRearms + 1) + ' windows to happen in, and then it stops.'
      : 'A wake that fails will stop and leave a note.';
  }
  if (command === 'rearms') {
    if (!value) return 'Give a count, for example: relay rearms 2';
    const config = configure({ maxRearms: Number(value) });
    return 'A failing wake will arm itself again at most ' + config.maxRearms + ' time' + (config.maxRearms === 1 ? '' : 's') + '.';
  }
  if (command === 'offline') {
    if (!value) return 'Give a number of retries, for example: relay offline 12';
    const config = configure({ offlineAttempts: Number(value) });
    return 'A machine that cannot reach the API will retry ' + config.offlineAttempts + ' times, ' +
      config.offlineRetryMinutes + ' minutes apart at first and backing off from there. Being offline never counts as a failed run.';
  }
  if (command === 'preflight') {

    const target = process.argv.slice(3).find((a) => !String(a).startsWith('--')) || process.cwd();

    const r = preflightPrompts(target, settings(read()));

    if (!r.ok) return 'Could not inspect startup trust: ' + r.error;

    return r.pending.length ? 'User approval required: ' + r.pending.join('; ') + '. No settings were changed.' : 'Claude Code already records folder trust for ' + target + '. No settings were changed.';

  }

  if (command === 'doctor' || command === 'check') return doctor(Date.now()).then((r) => r.text);
  if (command === 'log') {
    if (rest.includes('--run')) {
      const latest = latestRunLog();
      if (!latest) return 'No resumed run has been recorded yet.';
      return latest.file + '\n\n' + latest.text.split('\n').slice(-120).join('\n');
    }
    try {
      return fs.readFileSync(logFile(), 'utf8').split('\n').slice(-20).join('\n');
    } catch (err) {
      return 'No relay log yet.';
    }
  }
  return [
    'usage: relay.js [status|on|off|at N|grace N|mode notify|resume|permission MODE|model NAME|',
    '                 thinking off|resume|always|armon threshold|completion|backstop N|',
    '                 show on|off|fresh on|off|onfailure rearm|stop|offline N|doctor|preflight [cwd]|',
    '                 arm [--session ID] [TEXT]|note TEXT|cloud [--session ID] [--go] [TEXT]|',
    '                 cancel|log [--run]]',
    '',
    status(Date.now()),
  ].join('\n');
}

if (require.main === module) {
  Promise.resolve()
    .then(() => main(process.argv.slice(2)))
    .then(
      (text) => {
        process.stdout.write(text + '\n');
        process.exit(0);
      },
      (err) => {
        process.stdout.write('relay: ' + err.message + '\n');
        process.exit(0);
      }
    );
}

module.exports = { shellClaude, cloud, cloudHandoff, cloudCommand, cloudWarnings, cloudLaunchMode, cloudCli, launchCloud, gitState, CLOUD_ARG_MAX,
  workWithContinuation, reapLost, schedulerMode, sandboxedHome, hiddenAction, headlessAvailable, HEADLESS_HOST, HIDDEN_HOST, BUGCHECK_LINE,
  taskAction, wakeLauncherFile, wakeLauncherScript, writeWakeLauncher, sweepWakeLaunchers, batchArg, describeSpawn, PS_ROUTE_MS, SCHTASKS_MS,
  records, armedFor, putRecord, dropRecord, preflightPrompts, claudeJsonFile, projectKeys, isHome, launchDirFor,
  DEFAULTS,
  MINUTE,
  main,
  settingsFile,
  applyAlwaysThinking,
  configDir,
  relayFile,
  logFile,
  planFile,
  note,
  empty,
  read,
  write,
  settings,
  configure,
  detectWork,
  transcriptTail,
  saveContinuation,
  readContinuation,
  compose,
  capabilities,
  findClaude,
  findCodex,
  findComputerUse,
  wakeAt,
  taskName,
  psQuote,
  winArg,
  remainingMs,
  armByHand,
  sessionCwd,
  schedule,
  verifyRegistration,
  scheduleWindows,
  schedulePosix,
  cancelSchedule,
  armable,
  arm,
  disarm,
  status,
  formatWait,
  doctor,
  runLogDir,
  runLogFile,
  writeRunLog,
  latestRunLog,
};
