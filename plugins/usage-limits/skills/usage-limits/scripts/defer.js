#!/usr/bin/env node
'use strict';

// "Not now. Do it at ten."
//
// The relay answers a question the plugin asks itself: the window ran out, so
// when can this be picked up? This answers a question the USER asks: I do not
// want this started now, start it then.
//
// They share all the machinery below the surface - the same saved plan, the
// same scheduled task, the same wake script - and differ in one way that
// matters. The relay fires when a window RESETS, which is a time nobody chose
// and which moves. A deferral fires at a time a person named, so the grace
// minutes that let a meter settle are not added to it: 9:50 means 9:50.
//
//   node defer.js 9:50pm                 tonight at 21:50
//   node defer.js 21:50 --work "..."     with the work spelled out
//   node defer.js "in 90m"               ninety minutes from now
//   node defer.js reset                  when the binding window resets
//   node defer.js status                 what is deferred, and when it fires
//   node defer.js cancel                 call it off
//
// The reply is deliberately one line. The whole point of the command is that
// nothing happens now, and a paragraph explaining that would itself be the
// thing the user was trying to avoid.

const fs = require('fs');
const os = require('os');
const path = require('path');

const relay = require('./relay.js');
const host = require('./host.js');

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

// ---------------------------------------------------------------------------
// When
// ---------------------------------------------------------------------------

// Turn what somebody typed into a moment.
//
// Deliberately narrow. Every format here is one a person actually types at a
// terminal, and anything else is refused with the list rather than guessed at:
// a deferral that silently fires at the wrong hour is worse than one that
// refuses to be set.
function parseWhen(text, now, resetsAt) {
  const raw = String(text == null ? '' : text).trim().toLowerCase();
  if (!raw) return { error: 'No time given.' };

  // The window reset, which is the common case and the sensible default.
  if (/^(reset|next reset|the reset|window|when it resets)$/.test(raw)) {
    if (!Number.isFinite(resetsAt)) {
      return { error: 'The reset time is not known right now, so name a clock time instead.' };
    }
    // The one case where the relay's grace IS wanted: a meter needs a moment
    // to turn over, and this is a window reset rather than a chosen time.
    return { at: resetsAt + 5 * MINUTE, label: 'when the window resets' };
  }

  // "in 90m", "in 2h", "in 45 minutes", "in 1.5 hours"
  const relative = raw.match(/^in\s+([0-9]+(?:\.[0-9]+)?)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours)$/);
  if (relative) {
    const amount = Number(relative[1]);
    if (!Number.isFinite(amount) || amount <= 0) return { error: 'That is not a length of time.' };
    const unit = /^m/.test(relative[2]) ? MINUTE : HOUR;
    const span = amount * unit;
    // A year out is not a deferral, it is a mistake.
    if (span > 14 * 24 * HOUR) return { error: 'That is more than a fortnight away.' };
    return { at: now + span, label: 'in ' + relative[1] + (unit === MINUTE ? ' minutes' : ' hours') };
  }

  // "9:50pm", "9pm", "21:50", "09:50"
  const clock = raw.match(/^([0-9]{1,2})(?::([0-9]{2}))?\s*(am|pm)?$/);
  if (clock) {
    let hour = Number(clock[1]);
    const minute = clock[2] === undefined ? 0 : Number(clock[2]);
    const meridiem = clock[3];
    if (minute > 59) return { error: 'There is no such minute as ' + minute + '.' };
    if (meridiem) {
      if (hour < 1 || hour > 12) return { error: 'With am or pm the hour has to be 1 to 12.' };
      if (meridiem === 'pm' && hour !== 12) hour += 12;
      if (meridiem === 'am' && hour === 12) hour = 0;
    } else if (hour > 23) {
      return { error: 'There is no such hour as ' + hour + '.' };
    } else if (clock[2] === undefined) {
      // A bare number with no minutes and no am/pm is ambiguous - "9" could be
      // either nine. Refuse rather than pick one.
      return { error: 'Ambiguous: say 9am, 9pm or 09:00.' };
    }
    const at = new Date(now);
    at.setHours(hour, minute, 0, 0);
    let stamp = at.getTime();
    // A time already past today means tomorrow. That is what a person means by
    // "do it at nine" when they say it at eleven at night.
    if (stamp <= now) stamp += 24 * HOUR;
    return { at: stamp, label: formatClock(stamp) };
  }

  return {
    error:
      'Could not read "' + text + '" as a time. Try 9:50pm, 21:50, "in 90m", or "reset".',
  };
}

function formatClock(stamp) {
  const d = new Date(stamp);
  let hour = d.getHours();
  const meridiem = hour >= 12 ? 'PM' : 'AM';
  hour = hour % 12 === 0 ? 12 : hour % 12;
  const minute = String(d.getMinutes()).padStart(2, '0');
  return hour + ':' + minute + ' ' + meridiem;
}

// "3h 12m", the same shape the rest of the plugin prints.
function formatSpan(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return 'now';
  const minutes = Math.round(ms / MINUTE);
  if (minutes < 60) return minutes + 'm';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 24) return rest ? hours + 'h ' + rest + 'm' : hours + 'h';
  const days = Math.floor(hours / 24);
  return days + 'd ' + (hours % 24) + 'h';
}

// ---------------------------------------------------------------------------
// The line
// ---------------------------------------------------------------------------

// One sentence, and it has to carry four things: that nothing was started,
// when it will start, how far away that is, and how to call it off. Everything
// else is noise in a command whose whole purpose is to not do things.
function confirmation(parts) {
  const bits = [];
  const descriptive = parts.label && parts.label !== parts.clock && !/^in /.test(parts.label);
  bits.push('Doing this at ' + parts.clock + (descriptive ? ' (' + parts.label + ')' : ''));
  bits.push('in ' + formatSpan(parts.in));
  const line = bits.join(', ') + '. ';
  const tail = [];
  tail.push('Nothing has been started');
  if (parts.items) tail.push(parts.items + ' saved');
  if (parts.fires) tail.push(parts.fires);
  // Every note, not only the first: two can apply at once.
  for (const note of parts.notes && parts.notes.length ? parts.notes : [parts.resetNote]) {
    if (note) tail.push(note);
  }
  return line + tail.join('; ') + '. Run "defer cancel" to call it off.';
}

// ---------------------------------------------------------------------------
// Doing it
// ---------------------------------------------------------------------------

function bindingReset(now) {
  try {
    const usage = require('./usage.js');
    usage.setHost(host.detect(process.argv.slice(2), process.env));
    const collected = usage.collect(now);
    const utilization = collected && collected.utilization;
    if (!utilization) return { resetsAt: null, percent: null, windowKey: null };
    let worst = null;
    for (const key of Object.keys(utilization)) {
      const window = utilization[key];
      if (!window || typeof window !== 'object') continue;
      const percent = Number(window.utilization);
      if (!Number.isFinite(percent)) continue;
      const resets = Date.parse(window.resets_at);
      if (!worst || percent > worst.percent) {
        worst = { percent, resetsAt: Number.isFinite(resets) ? resets : null, windowKey: key };
      }
    }
    return worst || { resetsAt: null, percent: null };
  } catch (err) {
    return { resetsAt: null, percent: null, windowKey: null };
  }
}

// Claude Code only, like every other reader of this fact: /low-priority is its
// slash command against its account, and Codex files a five-hour window under the
// same key.
function lowPriorityAcknowledged(now) {
  try {
    if (host.detect(process.argv.slice(2), process.env) !== host.CLAUDE) return false;
    return Boolean(require('./lowpri.js').readAck(now));
  } catch (err) {
    return false;
  }
}

// What the wake will do at that time, in the words of the relay settings that
// decide it. Said in the line because the three are very different things to
// come back to: a notification, the same conversation, or a new one.
function whatFires(config, hostName, hasSession) {
  if (!config || config.mode !== 'resume') return 'then it only raises a notification with the plan (relay mode notify)';
  if (hostName === host.CODEX) return 'then it resumes the Codex thread';
  if (config.fresh) return 'then it starts a new claude session in this folder with the saved work as its first prompt (relay fresh on)';
  return hasSession
    ? 'then it resumes this same conversation (relay fresh off)'
    : 'then it would resume a conversation, but no session id is known here, so it will fail: relay fresh on starts a new session instead';
}

function hasSessionId(argv, env) {
  return Boolean(argOf(argv, '--session-id') || env.CLAUDE_CODE_SESSION_ID || env.CLAUDE_SESSION_ID || env.CODEX_SESSION_ID);
}

function sessionId(argv, env) {
  const at = argv.indexOf('--session-id');
  if (at !== -1 && argv[at + 1]) return argv[at + 1];
  return env.CLAUDE_CODE_SESSION_ID || env.CLAUDE_SESSION_ID || env.CODEX_SESSION_ID || 'defer-' + Date.now().toString(36);
}

function argOf(argv, name) {
  const at = argv.indexOf(name);
  return at === -1 ? null : argv[at + 1] || null;
}

function plan(options) {
  const now = options.now;
  const binding = options.binding || { resetsAt: null, percent: null };
  const when = parseWhen(options.when, now, binding.resetsAt);
  if (when.error) return { ok: false, error: when.error };

  const notes = [];
  // Worth saying, because it is the difference between the deferred run having
  // a budget and hitting the same wall again.
  if (Number.isFinite(binding.resetsAt)) {
    if (when.at >= binding.resetsAt) notes.push('the window will have reset by then');
    else if (Number.isFinite(binding.percent) && binding.percent >= 80) {
      notes.push('note: that is before the window resets at ' + formatClock(binding.resetsAt));
    }
  }
  // A deferral is a time the user named, so it is honoured whatever else is
  // true - unlike an automatic relay wake, which the acknowledgement refuses.
  // But waiting for a 5-hour reset this session carries straight past is
  // waiting for nothing, and that is worth one line before the task is
  // registered rather than after it fires.
  if (options.lowPriorityAck && binding.windowKey === 'five_hour') {
    notes.push(
      'note: you have said /low-priority is on, so this session carries past the 5-hour reset ' +
        'and waiting for it buys nothing - the weekly is the window that still stops work'
    );
  }
  return {
    ok: true,
    at: when.at,
    label: when.label,
    clock: formatClock(when.at),
    in: when.at - now,
    // resetNote is the first of them, kept because the confirmation and the
    // tests have always read that field. `notes` is all of them, because there
    // can now be two and dropping the second would have hidden the one fact
    // worth printing: that waiting for this reset buys nothing.
    resetNote: notes[0] || null,
    notes,
  };
}

function status(now) {
  const state = relay.read();
  const armed = relay.armedFor(state, process.env.CLAUDE_CODE_SESSION_ID) || state.armed;
  if (!armed) return 'Nothing is deferred.';
  const when = Number(armed.wakeAt);
  const deferred = armed.deferred === true;
  return (
    (deferred ? 'Deferred' : 'Relay armed') +
    ': ' +
    (armed.project || path.basename(armed.cwd || '')) +
    ' at ' +
    formatClock(when) +
    ' (in ' +
    formatSpan(when - now) +
    ')' +
    (armed.how ? ', via ' + armed.how : '') +
    '.'
  );
}

function cancel() {
  const state = relay.read();
  const own = relay.armedFor(state, process.env.CLAUDE_CODE_SESSION_ID) || state.armed;
  if (!own) return 'Nothing was deferred.';
  const label = formatClock(Number(own.wakeAt));
  const result = relay.disarm('cancelled by hand', Date.now(), own.id);
  return result && result.ok === false
    ? 'Could not cancel: ' + result.error
    : 'Cancelled the run booked for ' + label + '.';
}

function main(argv, now) {
  const args = (argv || []).filter((a) => a !== undefined);
  const first = args.find((a) => !a.startsWith('--')) || '';
  const at = Number.isFinite(now) ? now : Date.now();

  if (first === 'status') return status(at);
  if (first === 'cancel' || first === 'off') return cancel();
  if (!first || first === 'help') {
    return [
      'defer <time> [--work "..."]   put the work off until then and start nothing now',
      '  9:50pm | 21:50 | "in 90m" | reset',
      'defer status                  what is deferred and when it fires',
      'defer cancel                  call it off',
    ].join('\n');
  }

  const binding = bindingReset(at);
  const decided = plan({ now: at, when: first, binding, lowPriorityAck: lowPriorityAcknowledged(at) });
  if (!decided.ok) return decided.error;

  const id = sessionId(args, process.env);
  const hostName = host.detect(args, process.env);
  const work = argOf(args, '--work');
  const cwd = argOf(args, '--cwd') || process.cwd();

  // The plan is saved before the task is registered. A task that fires with
  // nothing to read is worse than a plan nobody scheduled.
  let items = null;
  if (work) {
    relay.saveContinuation(id, work);
    items = work.split('\n').filter((l) => l.trim()).length + ' line' +
      (work.split('\n').filter((l) => l.trim()).length === 1 ? '' : 's');
  }

  const armed = relay.arm({
    now: at,
    sessionId: id,
    cwd,
    hostName,
    at: decided.at,
    binding: { percentUsed: binding.percent, resetsAt: binding.resetsAt },
    work: { hasWork: true, pending: 1, source: 'defer', todos: [] },
  });
  if (!armed.ok) return 'Could not schedule it: ' + armed.error;

  // Mark it as a deferral rather than a limit relay, so `status` and the next
  // session can tell the two apart - they read the same record.
  try {
    const held = relay.read();
    // By this deferral's own id. It used to pass the sessionId FUNCTION here,
    // which matched nothing, so with another relay armed first the label and
    // the continuation flag went on that relay instead of this one.
    const mine = relay.armedFor(held, id);
    if (mine) {
      mine.deferred = true;
      mine.continuation = Boolean(work);
      relay.write(held);
    }
  } catch (err) {
    // The schedule is the part that matters; the label is not worth failing for.
  }

  relay.note('deferred ' + id + ' until ' + new Date(decided.at).toISOString(), at);
  return confirmation({
    label: decided.label,
    clock: decided.clock,
    in: decided.in,
    items,
    fires: whatFires(relay.settings(), hostName, hasSessionId(args, process.env)),
    resetNote: decided.resetNote,
    notes: decided.notes,
  });
}

if (require.main === module) {
  try {
    process.stdout.write(main(process.argv.slice(2), Date.now()) + '\n');
    process.exitCode = 0;
  } catch (err) {
    process.stderr.write('defer: ' + (err && err.message ? err.message : String(err)) + '\n');
    process.exitCode = 1;
  }
}

module.exports = { whatFires, lowPriorityAcknowledged, parseWhen, formatClock, formatSpan, confirmation, plan, status, cancel, main, MINUTE, HOUR };
