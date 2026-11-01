#!/usr/bin/env node
'use strict';

// The mid-turn ping.
//
// brief.js runs when a prompt is submitted, and that is the only budget figure
// the agent gets for the whole turn. A turn that runs for half an hour through
// hundreds of tool calls is working from a number taken before any of it
// happened, and it has no way to notice the budget draining underneath it.
//
// That is not hypothetical. On 2026-08-30 three sessions were told the 5-hour
// window had about 190 turns of headroom and were all rejected nine minutes
// later. Nothing in between ever told them otherwise, because nothing ran in
// between.
//
// So this runs after tool calls and puts a fresh line in front of the agent
// every couple of minutes. It has to be cheap, because it is called constantly:
// the common case is reading one small file, comparing a timestamp, and
// exiting without doing anything else.

const fs = require('fs');
const path = require('path');

const usage = require('./usage.js');
const reading = require('./reading.js');
const brief = require('./brief.js');
const host = require('./host.js');
const activity = require('./activity.js');
const live = require('./live.js');
const mode = require('./mode.js');
const ceiling = require('./ceiling.js');

const SECOND = 1000;
const DEFAULT_INTERVAL_SECONDS = 120;

// Same reasoning as the brief: ten seconds for the hook, four for a live
// reading, five for the scan, one of slack. This hook interrupts work in
// progress, so being late is worse here than anywhere else.
const SCAN_BUDGET_MS = 5000;

// One slot per session, same shape and same trimming as the brief's cache.
// Three keys per session now - the spoken pulse, the quiet subagent refresh,
// and the reading taken before a long call - so this is three times what it
// started at. Evicting a key only costs one extra scan, but evicting them as
// fast as they are written would mean nothing is ever throttled.
const KEEP_SESSIONS = 24;

function stateFile() {
  const dir = usage.isCodex()
    ? require('./codex.js').homeDir()
    : process.env.CLAUDE_CONFIG_DIR || path.join(require('os').homedir(), '.claude');
  return path.join(dir, 'usage-limits-pulse.json');
}

// How often this hook is allowed to do real work. The budget mode owns this
// number - a mode that says the reading itself costs too much has to be able
// to take fewer of them - but an explicit environment setting is the user
// saying it outright, and that still wins.
function intervalMs(policy) {
  const configured = Number(process.env.USAGE_LIMITS_PULSE_SECONDS);
  if (Number.isFinite(configured) && configured > 0) return configured * SECOND;
  const fromMode = policy && Number.isFinite(policy.pulseSeconds) ? policy.pulseSeconds : null;
  return (fromMode > 0 ? fromMode : DEFAULT_INTERVAL_SECONDS) * SECOND;
}

function readState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (err) {
    return {};
  }
}

function writeState(all) {
  // Never throws. Losing the throttle means one extra scan, which is
  // survivable; failing the tool call it runs after is not. Atomic because
  // several sessions' tool calls land on this file within the same second.
  usage.writeJsonAtomic(stateFile(), all);
}

// `extra` carries whatever else the slot has to remember, and it exists for
// one reason: the re-cost has to know what it said last time. A slot that is
// only a timestamp can throttle, but it cannot tell "two minutes have passed"
// from "two minutes have passed and nothing has changed", and those are
// different questions.
function trim(all, sessionId, at, extra) {
  const next = Object.assign({}, all);
  next[sessionId || '_'] = Object.assign({ at }, extra || null);
  const ordered = Object.keys(next).sort((a, b) => (next[b].at || 0) - (next[a].at || 0));
  const kept = {};
  for (const key of ordered.slice(0, KEEP_SESSIONS)) kept[key] = next[key];
  return kept;
}

// A tool call the agent itself said would run long.
//
// PreToolUse now matches Bash, so a build or a test suite can be measured
// before it starts rather than only after. But sharing the spoken pulse's one
// throttle slot makes that almost never happen: a tool call finished seconds
// ago, that PostToolUse pulse claimed the slot, and the one moment that
// matters - just before the turn goes blind for ten minutes - says nothing.
// Measured: a PostToolUse pulse at t, then `npm test` with a ten-minute
// timeout at t+5s, and the pre-call pulse returned empty.
//
// The declaration is the agent's own: a Bash call carries the timeout it was
// given, and anything above the pulse interval is a call that will outlast the
// next scheduled reading. Nothing is inferred from the command text. A
// backgrounded call is not this: it returns at once and PostToolUse fires
// normally, so the turn never goes blind.
function longCall(toolInput, every) {
  if (!toolInput || typeof toolInput !== 'object') return false;
  if (toolInput.run_in_background === true) return false;
  const declared = Number(toolInput.timeout);
  return Number.isFinite(declared) && declared > every;
}

function due(all, sessionId, now, every) {
  const entry = all ? all[sessionId || '_'] : null;
  if (!entry || !Number.isFinite(entry.at)) return true;
  return now - entry.at >= every;
}

// Deliberately shorter than the prompt-submit brief. That one sets up the whole
// turn; this one interrupts work already in progress, so it earns its place only
// by being one line and only by carrying something that changes what happens
// next.
function pulseText(parts) {
  const bits = [];
  if (parts.percentUsed !== null && parts.percentUsed !== undefined) {
    bits.push(parts.label + ' now ' + (parts.approximate ? 'about ' : '') + parts.percentUsed + '%');
  }
  if (Number.isFinite(parts.turnsLeft)) bits.push('about ' + parts.turnsLeft + ' turns left');
  if (parts.runsOutIn) bits.push(parts.runsOutIn + ' at this pace');
  if (parts.sessions > 1) bits.push(parts.sessions + ' sessions sharing it');
  if (!bits.length) return '';

  const head = '[usage-limits] ' + (parts.fanout ? 'Before this fan-out: ' : '') + bits.join(', ') + '.';
  if (parts.fanout) {
    // Parallel Agent calls fire this once per call, so the advice sentence was
    // being said six times in a row for one reading. The reading itself is
    // never throttled; the advice is said once per session per ten minutes,
    // through the same state file as every other throttle here.
    if (parts.advice === false) return head;
    // Said before every Workflow or Agent call. The agents spend this same
    // window, nothing can speak again until they stop, and a main-loop turn
    // with a large context costs more than one whole fresh-context agent.
    return (
      head + ' Subagents spend this window too and nothing can warn you until they ' +
      'stop, so size the fan-out to what is left' +
      (parts.pressure === 'gone' ? ' - which is nothing: do not launch it' : parts.pressure === 'tight' ? ' - a handful, not dozens' : '') +
      '. Fewer agents with a fresh context beat another turn of a long one.'
    );
  }
  // The tight and gone sentences are advice too, and they were said on every
  // due pulse - three times in ten minutes on 2026-09-20. Same slot and same
  // ten minutes as the fan-out advice; the reading itself is never withheld.
  if ((parts.pressure === 'gone' || parts.pressure === 'tight') && parts.advice === false) return head;
  if (parts.pressure === 'gone') {
    return head + ' The budget is gone. Stop adding work, save what exists and write the handoff.';
  }
  if (parts.pressure === 'tight') {
    // Mid-turn, so this has to change how the work is carried out without
    // changing what the work is. Keep going; just keep it landable.
    return (
      head + ' Keep going with the whole job, but make a cutoff cheap: land the ' +
      'valuable part first, save at clean boundaries, and keep a note of what is ' +
      'done and what is next.'
    );
  }
  return head + ' Still room; carry on.';
}

// The two-minute re-cost. The distinguishing feature of `high`, and the reason
// it is not simply `standard` with a shorter interval.
//
// A PostToolUse hook CAN put text in front of the model mid-turn: the hook
// output contract takes additionalContext on this event, and it has been seen
// arriving mid-turn in a running session. So this is a real nudge, not a note
// filed for the next prompt.
//
// What it must not do is claim a lever nobody has. Nothing a hook emits can
// change the running session's own model or effort - there is no such field in
// the whole hook output contract, and PreModelSwitch is a veto on a switch
// someone else started rather than a way to start one. So for the main loop
// this names the command and leaves it with the person, and for what the turn
// SPAWNS it says the thing that is genuinely the agent's to decide.
//
// It is built every two minutes and SAID only when it differs from the last
// thing said in this session. See the caller: a re-cost that repeats itself is
// not a re-cost, it is a bill for advice already given.
function recheckText(parts) {
  const bits = [];
  if (parts.fit) {
    bits.push(
      'this turn is at ' + parts.fit.effort + ', measured ' + parts.fit.multiple + ' times the cost of ' +
        parts.fit.cheaper + ' a turn on this account'
    );
  }
  if (parts.escape && parts.escape.kind === 'effort' && parts.escape.to) {
    bits.push(parts.escape.to + ' would free the window that binds');
  }
  if (!bits.length) return '';
  const command = (parts.fit && parts.fit.command) || (parts.escape && parts.escape.command) || null;
  return (
    '[usage-limits] Re-costed: ' + bits.join(', and ') + '. If the stretch in front of you is ' +
    'mechanical, the tier is bigger than the work' + (command ? ' - the change is ' + command + ', and it is the ' +
    "user's to make, so say it in one line rather than waiting for it" : '') +
    (parts.pin
      ? '. Self-switching is pinned, so this is a report: change nothing on the strength of it.'
      : '. Size what you spawn the same way: low effort for mechanical stages. Step back up when the work turns hard again.')
  );
}

async function run(now, hookInput) {
  if (String(process.env.USAGE_LIMITS_PULSE || '').toLowerCase() === 'off') return '';

  const sessionId = hookInput && hookInput.session_id ? hookInput.session_id : null;
  const event = hookInput && hookInput.hook_event_name ? String(hookInput.hook_event_name) : 'PostToolUse';

  // The budget mode, settled before anything is read, marked or scanned. In
  // `off` the hook stops here: no reading, no activity mark, no state write.
  // That mode's whole promise is that the plugin costs nothing, and a hook
  // that "returns immediately" after a transcript scan has already broken it.
  const budget = mode.forSession({ sessionId });
  if (budget.policy.refreshSeconds === 0) return '';

  usage.setHost(host.detectFromHook(process.argv.slice(2), process.env, hookInput));

  // A subagent finishing is the other reason to look, and on a busy afternoon
  // it is the more important one.
  //
  // This hook exists because PostToolUse fires on the MAIN thread's tool calls,
  // and a turn that hands its work to a workflow makes none for half an hour.
  // On 2026-09-06 two workflows spent a whole five-hour window between one
  // prompt and the next, and nothing ran in between to notice: the reading on
  // disk aged eleven minutes while forty-three agents spent against it, and the
  // session was cut off at a figure the plugin still believed was 3%.
  //
  // So it refreshes and says nothing. The mark is deliberately not written -
  // a subagent is not a session, and marking one would put it in the list of
  // windows sharing this budget and split the headroom with a ghost.
  const quiet = event === 'SubagentStop';
  // The call about to fan out. Everything it spawns spends this window with no
  // main-thread tool call to pulse on, so this is the last word before the
  // bill. On 2026-09-07 a 34-agent workflow took a five-hour window from 28%
  // to 100% in sixteen minutes, and the session was cut off at a figure the
  // pulse had last read as 24%.
  const tool = hookInput && hookInput.tool_name ? String(hookInput.tool_name) : '';
  const fanout = event === 'PreToolUse' && /^(Workflow|Agent|Task)$/.test(tool);

  // The ceiling, checked before the throttle and before any scan.
  //
  // Everything else in this hook is advice, and advice is throttled so it does
  // not become noise. A refusal that only arrives when the pulse happens to be
  // due is not a refusal, so this runs on every fan-out regardless, off the two
  // readings that are already on disk. It is the one thing here that does not
  // ask the model to agree with it.
  if (event === 'PreToolUse' && ceiling.isMultiplier(tool)) {
    try {
      const worst = ceilingPercent(now, null, hookInput && hookInput.transcript_path);
      const at = ceiling.assess({
        percent: worst ? worst.percent : null,
        label: worst ? worst.label : null,
        state: budget.state,
        env: process.env,
        // The cap only binds in the session that set it.
        sessionId,
      });
      const call = ceiling.verdict(at, tool);
      if (call.decision === 'deny') return { deny: true, reason: call.reason };
    } catch (err) {
      // A ceiling that throws must not block the call it was asked to judge.
    }
  }
  // The other way a turn goes quiet for a long time: one foreground tool call
  // that runs for minutes. See longCall().
  const long = event === 'PreToolUse' && !fanout && longCall(hookInput && hookInput.tool_input, intervalMs(budget.policy));
  if (!quiet) {
    // A tool call just finished, so the turn is still running. A few bytes, so
    // the panel beside the chat keeps animating through a long turn.
    activity.mark('working', sessionId, null, now);
  }

  const all = readState();
  const every = intervalMs(budget.policy);
  // The quiet refresh keeps its own throttle. Sharing one with the spoken
  // pulse would mean a workflow's subagents used up the interval and the tool
  // call right after it, the first chance to actually tell Claude, said
  // nothing because something had already "pulsed" two minutes ago.
  // Same reasoning for the call about to run long: its own slot, so it is
  // still throttled to one reading per interval and a run of long calls does
  // not scan before every one of them, but the post-tool pulses cannot use up
  // the interval and leave the blind stretch unmeasured.
  const throttleKey = quiet
    ? (sessionId || '_') + '#subagent'
    : long
      ? (sessionId || '_') + '#long'
      : sessionId;
  // The cheap path, and the one taken almost every time. A fan-out is never
  // throttled: it is said every time, because every time it is about to cost.
  if (!fanout && !due(all, throttleKey, now, every)) return '';
  const adviceKey = (sessionId || '_') + '#fanout-advice';
  const sayAdvice = fanout && due(all, adviceKey, now, 10 * 60 * 1000);

  // Claimed before the scan rather than after, so a slow scan cannot let a
  // second tool call start another one.
  writeState(sayAdvice ? trim(trim(all, throttleKey, now), adviceKey, now) : trim(all, throttleKey, now));

  // A reading as old as the interval is replaced with the one Claude Code
  // would take for /usage, so a turn that runs for an hour is measured
  // against the account rather than against a guess from its own transcript.
  try {
    if (usage.isCodex()) {
      // Never waited on inside the hook. `codex app-server` can take longer to
      // answer cold than this hook is allowed to live, and a killed PostToolUse
      // hook is a tool call that stalls. The child writes the meter file and
      // the next pulse reads it.
      await require('./codex.js').refreshIfStale({ now, maxAgeMs: every, detach: true });
    } else {
      const cached = usage.collect(now);
      // Sized from what is left of the hook's ten seconds, not from a constant:
      // this hook interrupts work in progress, so being late is worse here than
      // anywhere else.
      const waitMs = brief.refreshBudgetMs({ reserveMs: SCAN_BUDGET_MS + 1000 });
      if (waitMs > 0) {
        await live.refreshIfStale({
          now,
          maxAgeMs: every,
          cacheFetchedAtMs: cached.snapshotFetchedAt,
          accountUuid: usage.accountUuid(),
          timeoutMs: waitMs,
        });
      }
    }
  } catch (err) {
    // The reading on disk is still there.
  }

  // Refreshing was the whole errand. The next prompt, or the next tool call on
  // the main thread, reports the number this just brought up to date.
  if (quiet) return '';

  const data = await usage.report(now, { sessionId, budgetMs: SCAN_BUDGET_MS });
  if (!data.binding) return '';
  // The same swap the brief makes, out of the same function so the two can never
  // disagree: once the user has said /low-priority is on, the weekly is the only
  // brake left, and a mid-turn line still counting down the 5-hour window would
  // undo the brief on every tool call. Claude Code only; see brief.wallFeatures.
  const wall = brief.wallFeatures(now, data.binding, data.windows || [], usage.currentHost());
  const binding = wall.binding;
  // This turn paid for the scan, so leave the corrected figure where the
  // status line and --status can read it without paying for one. Every window,
  // not the one that happens to be binding after the swap.
  reading.recordAll(data.windows || [data.binding], now, usage.isCodex() ? require('./codex.js').homeDir() : null);

  // The same count and the same split as the brief, so the two lines never
  // disagree about how many sessions there are or how much of the budget is
  // this one's.
  const { active, share } = brief.activeShare(data.sessions, brief.readCache(), now, sessionId);
  const turnsLeft = Number.isFinite(binding.turnsLeft)
    ? active > 1
      ? Math.max(1, Math.round(binding.turnsLeft * share))
      : binding.turnsLeft
    : null;

  const config = brief.settings();
  const runwayMs = brief.RUNWAY_MENTION_MS;
  const pressure = brief.pressure(binding, now, config, turnsLeft);

  // The mode's own mid-turn re-cost, on its own throttle slot.
  //
  // Its own slot because the "quiet when roomy" rule below would otherwise
  // swallow it exactly when it matters most: a turn running a tier far bigger
  // than the work needs is precisely the case where the budget still looks
  // roomy and nothing else would say a word.
  let recheck = '';
  const recheckMs = (budget.policy.recheckSeconds || 0) * SECOND;
  const recheckKey = (sessionId || '_') + '#recheck';
  if (recheckMs > 0 && due(readState(), recheckKey, now, recheckMs)) {
    // From the per-effort TABLE, which is what report() returns. It was asked
    // for from `data.events`, a field report() has never had, so the measured
    // half of the re-cost was null on every call on every machine and `high`
    // was left emitting its escape clause alone.
    const fit = usage.fitFromRates(data.effortRates || [], data.effortNow || null, usage.currentHost());
    // The user's bounds are the user's, and `pin` is one of them: it lives on
    // bounds, not on the mode's policy, so it has to be handed over here or
    // the route comes back unable to say it is a report.
    const route = usage.escapeRoute(data.windows || [binding], binding, data.effortWarning || null, usage.currentHost(), budget.policy, budget.bounds);
    const allowed = (suggestion) => mode.allows(budget.bounds, suggestion);
    // The measured half is a recommendation about the user's own setting, so
    // it goes out through the advice rules rather than around them: never once
    // muted, never once declined, never below a bound, and not a second time
    // in a session where the brief has already made it. Filtering only on the
    // bounds here meant `mode --no-advice` and `mode --decline` were both
    // routed around every two minutes, in the one mode that speaks mid-turn.
    const advice = mode.advicePending({ decided: budget, fit, sessionId });
    const offerFit = advice.ok && !advice.alreadyOffered ? fit : null;
    const text = recheckText({
      fit: offerFit,
      escape: route && route.kind === 'effort' && allowed({ effort: route.to }) ? route : null,
      pin: budget.bounds && budget.bounds.pin,
    });
    // Say it once.
    //
    // Nothing this line is built from moves within a turn, so on the throttle
    // alone it repeated itself verbatim every two minutes: measured, fifteen
    // identical injections in one half-hour turn at 20 per cent used. That is
    // the failure this whole feature exists to avoid, arriving in the mode
    // named for efficiency. `high` re-costs continuously - it takes the
    // measurement every two minutes - and speaks when the answer CHANGES.
    const state = readState();
    const before = state[recheckKey] && state[recheckKey].said;
    recheck = text && text !== before ? text : '';
    // Recorded only when it is actually said, and only for the half that is a
    // recommendation, so that "no, leave it" has something to refuse: without
    // this, `mode --decline` after a mid-turn re-cost had no id to act on.
    if (recheck && offerFit && advice.id) mode.adviceOffer(advice.id, sessionId, now, advice.text);
    // Claimed whether or not it produced a line: the measurement was taken,
    // and taking it again in ten seconds would cost the same and say the same.
    writeState(trim(state, recheckKey, now, text ? { said: text } : null));
  }

  // Quiet when there is nothing to act on. A line every two minutes saying the
  // budget is fine is noise that costs the budget it is reporting on.
  if (!fanout && pressure === 'roomy' && String(process.env.USAGE_LIMITS_PULSE || '').toLowerCase() !== 'always') {
    return recheck;
  }

  // The pressure advice shares the fan-out advice's slot and its ten minutes.
  // Unlike the fan-out's, it is stamped after the fact and only when a line
  // actually carried it: a pulse with no reading to hang it on says nothing,
  // and must not spend the slot on nothing.
  const sayPressureAdvice = !fanout && (pressure === 'tight' || pressure === 'gone') && due(readState(), adviceKey, now, 10 * 60 * 1000);
  const spoken = pulseText({
    label: binding.label,
    percentUsed: binding.percentUsed,
    approximate: Boolean(binding.estimated || binding.adjusted),
    turnsLeft,
    runsOutIn:
      Number.isFinite(binding.headroomMs) && binding.headroomMs <= runwayMs
        ? usage.formatDuration(binding.headroomMs)
        : null,
    sessions: active,
    pressure,
    fanout,
    advice: fanout ? sayAdvice : sayPressureAdvice,
  });
  if (spoken && sayPressureAdvice) writeState(trim(readState(), adviceKey, now));
  return recheck ? (spoken ? spoken + ' ' + recheck : recheck) : spoken;
}

// The cheapest reading good enough to enforce a ceiling against.
//
// The ceiling is checked before every fan-out, which is far too often to scan
// transcripts for. snapshotWindows() is the no-scan view every other cheap
// reader uses: the account snapshot, the corrections the last scan left
// behind, and whether each window is one this agent can spend into. The
// fullest of those wins, because a ceiling means "no window past here".
//
// This used to take the highest number on disk, whatever window it belonged
// to - including a weekly scoped to a model this session was not running, and
// the snapshot of a window that had already reset. See ceiling.worstWindow().
//
// Returns null when nothing is readable, and a ceiling with no reading behind
// it never refuses. Guessing high would block work over a number nobody
// measured; guessing low would not be a ceiling at all.
function ceilingPercent(now, collected, transcriptPath) {
  const codexHome = usage.isCodex() ? require('./codex.js').homeDir() : null;
  try {
    const running = lastModel(transcriptPath);
    return ceiling.worstWindow(
      usage.snapshotWindows(collected || usage.collect(now), now, codexHome, running ? [running] : [])
    );
  } catch (err) {
    // No snapshot is a reason not to enforce, not a reason to throw.
    return null;
  }
}

// The model this session's last reply came from, off the tail of its transcript.
//
// The setting says what a session started on; /model changes what it runs
// without touching settings.json. A weekly scoped to the model actually
// running must count, so the pulse adds this to the setting rather than
// replacing it - suppressing a window takes both sides agreeing. One read of
// the last 64 KB, from the end, whole lines only. Null on anything unexpected.
function lastModel(transcriptPath) {
  if (!transcriptPath) return null;
  let fd = null;
  try {
    fd = fs.openSync(transcriptPath, 'r');
    const size = fs.fstatSync(fd).size;
    const length = Math.min(size, 64 * 1024);
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, size - length);
    const lines = buffer.toString('utf8').split('\n');
    // The first line of a partial read is cut; only a read from the start is whole.
    if (length < size) lines.shift();
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      if (!lines[i].includes('"assistant"')) continue;
      try {
        const entry = JSON.parse(lines[i]);
        const model = entry && entry.type === 'assistant' && entry.message && entry.message.model;
        // "<synthetic>" marks a reply Claude Code wrote itself, not a model.
        if (model && typeof model === 'string' && !model.startsWith('<')) return model;
      } catch (err) {
        // A half-written last line while the transcript is being appended.
      }
    }
    return null;
  } catch (err) {
    return null;
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch (err) {
        // Already closed is fine.
      }
    }
  }
}

// PostToolUse does not take plain stdout as context the way UserPromptSubmit
// does, so the line is returned in the documented envelope instead.
function envelope(text, event) {
  // PreToolUse and PostToolUse both take additionalContext, each under its own
  // event name; the wrong name is dropped without a word.
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: event === 'PreToolUse' ? 'PreToolUse' : 'PostToolUse',
      additionalContext: text,
    },
  });
}

// The refusal envelope.
//
// Claude Code and Codex document the same PreToolUse shape: a permissionDecision
// of "deny" with a reason, which is shown to the model in place of the tool
// result. Exit code stays 0 - exit 2 also blocks, but routes the reason through
// stderr, and a reason the model can read is the entire point of refusing.
function refusal(reason) {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  });
}

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

if (require.main === module) {
  let hookEvent = null;
  readHookInput()
    .then((input) => {
      hookEvent = input && input.hook_event_name ? String(input.hook_event_name) : null;
      return run(Date.now(), input);
    })
    .then(
      (result) => {
        // A refusal, not a line. Claude Code and Codex take the same shape
        // here; Antigravity's differs and is handled by its own entry point.
        if (result && typeof result === 'object' && result.deny) {
          process.stdout.write(refusal(result.reason) + '\n');
          process.exit(0);
        }
        if (result) process.stdout.write(envelope(result, hookEvent) + '\n');
        process.exit(0);
      },
      () => {
        // A hook that throws must never disturb the tool call it runs after.
        process.exit(0);
      }
    );
}

module.exports = {
  recheckText,
  DEFAULT_INTERVAL_SECONDS,
  KEEP_SESSIONS,
  stateFile,
  intervalMs,
  readState,
  writeState,
  trim,
  due,
  longCall,
  pulseText,
  envelope,
  refusal,
  ceilingPercent,
  lastModel,
  run,
};
