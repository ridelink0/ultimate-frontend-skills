#!/usr/bin/env node
'use strict';

// The end-of-reply tally.
//
// Runs as the Stop hook, after Claude has finished a reply, and puts one line
// in front of the user saying what that reply cost and what the session has
// cost so far. It costs the model nothing: the line goes to the person, not
// into the context, and the numbers come from bytes of the transcript that
// have already been written.
//
// It must never exit with code 2. On this event that would stop Claude from
// stopping.

const usage = require('./usage.js');
const host = require('./host.js');
const tally = require('./tally.js');
const activity = require('./activity.js');
const mode = require('./mode.js');
const drift = require('./drift.js');
const relay = require('./relay.js');
const path = require('path');


/* ---------------------------------------------- arming at the boundary ---- */

// The relay used to arm the instant the window crossed its mark, which is
// somewhere in the middle of a reply: halfway through a tool call, with a todo
// list that has not been updated since three steps ago. What it carried was a
// snapshot of an interruption.
//
// This is the other end of that. The Stop hook is the one moment in a session
// that is definitionally a boundary - the reply is finished, the todo list is
// current, and whatever the session wrote as a continuation is written. Arming
// here means the thing handed to the next session describes work that reached
// a stopping point.
//
// It is deliberately cheap in the case that matters, which is the relay being
// off: three file reads and a return. Nothing here may throw, and nothing here
// may delay the hook - a tally line the user is waiting for must not wait on a
// scheduled task.
const WINDOW_LABELS = { five_hour: '5-hour', seven_day: 'weekly', seven_day_opus: 'weekly (Opus)', seven_day_sonnet: 'weekly (Sonnet)' };

function bindingFromCollect(collected, now) {
  const utilization = collected && collected.utilization;
  if (!utilization) return null;
  const windows = [];
  for (const key of Object.keys(utilization)) {
    const bucket = utilization[key];
    if (!bucket || typeof bucket.utilization !== 'number') continue;
    const resetsAt = bucket.resets_at ? Date.parse(bucket.resets_at) : NaN;
    windows.push({
      key,
      label: WINDOW_LABELS[key] || key.replace(/_/g, ' '),
      percentUsed: bucket.utilization,
      resetsAt: Number.isFinite(resetsAt) ? resetsAt : null,
      // A per-model weekly for a model this session is not running cannot be
      // the thing that stops the work; bindingWindow already knows that, and
      // this only has to hand it the flag.
      applies: key.indexOf('seven_day_') !== 0 || key === 'seven_day',
      stale: Number.isFinite(collected.snapshotAgeMs) && collected.snapshotAgeMs > 30 * 60 * 1000,
    });
  }
  if (!windows.length) return null;
  const bound = usage.bindingWindow(windows);
  // A window with no known reset time cannot be woken after, so it is no use
  // to the relay even when it is the one that binds.
  return bound && Number.isFinite(bound.resetsAt) ? bound : null;
}

function armAtCompletion(now, hookInput, sessionId) {
  let state;
  try {
    state = (relay.reapLost(Date.now()), relay.read());
  } catch (err) {
    return null;
  }
  const config = relay.settings(state);
  if (!config.enabled || config.armOn !== 'completion') return null;
  // Already carrying this session forward: nothing to decide.
  if (relay.armedFor(state, sessionId)) return null;

  const transcript = hookInput && hookInput.transcript_path ? hookInput.transcript_path : null;
  const work = relay.detectWork(transcript, {});
  if (!work.hasWork) return null;

  const binding = bindingFromCollect(usage.collect(now), now);
  if (!binding) return null;

  const able = relay.armable({ config, binding, sessionId, work, atCompletion: true, hostName: usage.currentHost() });
  if (!able.ok) return null;

  const armed = relay.arm({
    now,
    config,
    sessionId,
    binding,
    work,
    resetsAt: binding.resetsAt,
    cwd: (hookInput && hookInput.cwd) || process.cwd(),
    project: path.basename((hookInput && hookInput.cwd) || process.cwd()),
    hostName: usage.currentHost(),
    // The Stop hook is not on the prompt's clock, so registration can be
    // allowed to finish rather than being abandoned half-done.
    deadline: now + 20000,
  });
  return armed.ok ? armed.record : null;
}

async function run(now, hookInput) {
  const sessionId = hookInput && hookInput.session_id ? hookInput.session_id : null;

  // `off` means off here too, and that is the whole reason this check is the
  // first thing in the hook rather than a filter on the line at the end.
  //
  // This hook was the expensive one left running: it read the entire
  // transcript after every reply - 2.77 MB on the session that measured it -
  // wrote two state files and printed a line, in the mode documented as "the
  // hooks return before reading anything: no scan, no state write, no line".
  // The line goes to the person rather than into the context, so it cost no
  // tokens; the scan cost exactly what `standard` costs, which is the half of
  // that promise that was false.
  //
  // Two consequences, both stated where the user sets the mode and in the
  // docs: no end-of-reply cost line in `off`, and no drift-ledger rows tagged
  // `off` - a mode that injects nothing has no injection to attribute a cost
  // to, so there is nothing for the ledger to compare.
  //
  // USAGE_LIMITS_TALLY stays the independent control, for anyone who wants the
  // briefing and not the cost line.
  // Before the mode gate, deliberately.
  //
  // `off` means the plugin injects nothing and prints nothing. It does not mean
  // a relay the user turned on themselves stops working - that is a promise
  // made in a different place, by a different command, and silencing the brief
  // must not quietly revoke it. The cost is one JSON read that returns
  // immediately when the relay is off, which it is by default.
  try {
    armAtCompletion(now, hookInput, sessionId);
  } catch (err) {
    // A relay that failed to arm is a relay that arms on the next reply.
  }

  const budget = mode.forSession({ sessionId });
  if (budget.policy.briefStyle === 'none') return '';

  // The reply is finished: the panel beside the chat can stop animating.
  activity.mark('idle', sessionId, null, now);

  if (String(process.env.USAGE_LIMITS_TALLY || '').toLowerCase() === 'off') return '';
  usage.setHost(host.detect(process.argv.slice(2), process.env));

  const transcript = hookInput && hookInput.transcript_path ? hookInput.transcript_path : null;
  if (!sessionId || !transcript) return '';

  const all = tally.readState();
  const { session, delta, created } = tally.update(all, sessionId, transcript, now, {
    cwd: hookInput.cwd || null,
  });
  tally.writeState(tally.trim(all));

  // The mode ledger: what a reply actually cost, tagged with the mode that was
  // in force while it ran. Modes should be evidence rather than vibes, and this
  // is the only place that knows both halves at once. Skipped on the first
  // sighting of a session, where the figures are history rather than this
  // reply, and never allowed to disturb the hook.
  try {
    if (!created) {
      drift.recordTurns(
        budget.name,
        delta.turns,
        delta.cost,
        now,
        usage.isCodex() ? require('./codex.js').homeDir() : null
      );
    }
  } catch (err) {
    // A ledger entry is worth nothing next to the line this hook exists for.
  }

  // The first time a session is seen, everything read is history rather than
  // the reply that just finished, so only the total is shown.
  return JSON.stringify({
    systemMessage: tally.formatTally(session, created ? null : delta, tally.pricing(now)),
  });
}

if (require.main === module) {
  tally
    .readHookInput()
    .then((input) => run(Date.now(), input))
    .then(
      (text) => {
        if (text) process.stdout.write(text + '\n');
        process.exit(0);
      },
      () => {
        process.exit(0);
      }
    );
}

module.exports = { run, armAtCompletion, bindingFromCollect };
