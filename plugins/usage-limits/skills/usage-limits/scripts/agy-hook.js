#!/usr/bin/env node
'use strict';

// The Antigravity entry point.
//
// Antigravity (and the `agy` CLI behind it) has a lifecycle-hook system that is
// close to Claude Code's in spirit and different from it in every detail that
// matters to a script:
//
//   - Events are PreInvocation, PostInvocation, PreToolUse, PostToolUse and
//     Stop. PreInvocation is the one that corresponds to UserPromptSubmit.
//   - Every payload is protojson, so the keys are camelCase: conversationId,
//     workspacePaths, transcriptPath, modelName, stepIdx, invocationNum.
//   - Output is JSON on stdout, and each event has its own shape. Plain text
//     on stdout is not context; it is a parse failure, and a parse failure is
//     silent. That is the whole reason this file exists rather than pointing
//     Antigravity at brief.js and hoping.
//   - PreToolUse takes a decision of allow, deny, ask or force_ask.
//
// The contract is documented on the machine itself, in the built-in
// agy-customizations skill at
// ~/.gemini/antigravity-cli/builtin/skills/agy-customizations/docs/hooks.md,
// which is where these shapes were read from rather than guessed.
//
//   node agy-hook.js --event PreInvocation
//   node agy-hook.js --event PreToolUse
//
// Nothing here ever exits non-zero. Antigravity runs hooks synchronously and
// they block the agent loop, so a hook that fails is a hook that stops the
// user's work, and no budget figure is worth that.

const usage = require('./usage.js');
const host = require('./host.js');
const mode = require('./mode.js');
const ceiling = require('./ceiling.js');
// brief.js is loaded only on PreInvocation: PreToolUse runs before tool calls
// and must stay a few small requires, not the whole brief.

// PreToolUse must always name a decision. Antigravity reads an answer with no
// decision as a refusal, so the old bare {} blocked every tool it ran on.
const ALLOW = { decision: 'allow' };

const EVENTS = ['PreInvocation', 'PostInvocation', 'PreToolUse', 'PostToolUse', 'Stop'];

function eventFrom(argv, input) {
  const args = argv || [];
  const at = args.indexOf('--event');
  if (at !== -1 && EVENTS.includes(args[at + 1])) return args[at + 1];
  // Antigravity does not name the event in the payload, so the shape is the
  // only other evidence. toolCall is only ever present on the two tool events,
  // and only PreToolUse can act on one.
  if (input && input.toolCall) return 'PreToolUse';
  if (input && input.terminationReason !== undefined) return 'Stop';
  if (input && input.invocationNum !== undefined) return 'PreInvocation';
  return null;
}

function readInput() {
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

// The tool name, as Antigravity spells it.
//
// Tool names there are the step type lowercased with the CORTEX_STEP_TYPE_
// prefix removed, so they are snake_case: run_command, view_file, browser_*.
// ceiling.js matches both spellings, so nothing has to be translated here.
function toolNameOf(input) {
  if (!input || !input.toolCall) return '';
  return String(input.toolCall.name || '');
}

// The cheapest percentage worth enforcing against.
//
// Antigravity does not publish remaining quota anywhere this can read - see
// collectGemini in usage.js, which says so rather than inventing a number - so
// on a Gemini host this is usually null and the ceiling never fires. It is
// still wired, because the same hook file runs when USAGE_LIMITS_HOST names a
// host that DOES have a meter, and because a ceiling that silently does
// nothing on the day Antigravity starts publishing one would be worse.
function percentNow(now) {
  // The same no-scan view and the same rule as the Claude Code pulse: the
  // fullest window this agent can spend into, never a window that has reset.
  try {
    return ceiling.worstWindow(usage.snapshotWindows(usage.collect(now), now, null));
  } catch (err) {
    // No reading is a reason not to enforce, never a reason to throw.
    return null;
  }
}

// assess() takes the number and the name of the window it belongs to.
function reading(worst) {
  return { percent: worst ? worst.percent : null, label: worst ? worst.label : null };
}

async function run(now, input, argv) {
  const event = eventFrom(argv, input);
  if (!event) return {};

  usage.setHost(host.GEMINI);
  const sessionId = input && input.conversationId ? String(input.conversationId) : null;
  const budget = mode.forSession({ sessionId });
  if (budget.policy.briefStyle === 'none') return event === 'PreToolUse' ? ALLOW : {};

  if (event === 'PreToolUse') {
    const tool = toolNameOf(input);
    if (!ceiling.isMultiplier(tool)) return ALLOW;
    const at = ceiling.assess(Object.assign({ state: budget.state, env: process.env, sessionId }, reading(percentNow(now))));
    const call = ceiling.verdict(at, tool);
    if (call.decision !== 'deny') return ALLOW;
    return { decision: 'deny', reason: call.reason };
  }

  if (event === 'PreInvocation') {
    // The one place a budget line can reach the model. Antigravity takes it as
    // an injected step rather than as stdout text; an ephemeralMessage is a
    // transient system message, which is exactly what a per-turn figure is.
    let text = '';
    try {
      text = await require('./brief.js').run(now, input, { host: host.GEMINI });
    } catch (err) {
      text = '';
    }
    const warning = ceiling.warning(
      ceiling.assess(Object.assign({ state: budget.state, env: process.env, sessionId }, reading(percentNow(now))))
    );
    const message = [text, warning].filter(Boolean).join(' ');
    return message ? { injectSteps: [{ ephemeralMessage: message }] } : { injectSteps: [] };
  }

  // PostToolUse, PostInvocation and Stop all want an object and none of them
  // wants anything from this plugin. Deliberately NOT returning
  // terminationBehavior on PostInvocation, and NOT returning decision
  // "continue" on Stop: both would keep the loop running, which is the
  // opposite of what a budget plugin should ever do to a user's quota.
  return {};
}

// Read stdin, answer, exit zero. A function rather than a bare block because
// the installer's launcher calls it: see install-antigravity.js, which writes a
// two-line launcher beside hooks.json so the hook command carries no path and
// therefore no quotes for `cmd /c` to mangle.
function main(argv) {
  const args = argv || [];
  return readInput()
    .then((input) => run(Date.now(), input, args))
    .then(
      (result) => {
        process.stdout.write(JSON.stringify(result || {}) + '\n');
        process.exit(0);
      },
      () => {
        // Hooks block the agent loop here, so a failure has to be silent and
        // well formed rather than loud - and on PreToolUse, well formed means
        // an explicit allow, never a bare {} that reads as a refusal.
        const pre = args.join(' ').includes('--event PreToolUse');
        process.stdout.write(JSON.stringify(pre ? ALLOW : {}) + '\n');
        process.exit(0);
      }
    );
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { EVENTS, ALLOW, eventFrom, toolNameOf, percentNow, run, main };
