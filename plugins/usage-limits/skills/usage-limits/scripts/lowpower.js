#!/usr/bin/env node
'use strict';

// Turns the expensive knobs down and remembers what they were.
//
// effortLevel is the setting behind the /effort picker. It drives how much
// reasoning the model does per turn, and reasoning is billed as output
// tokens, which are the priciest tokens in the request. Dropping xhigh to
// low is the single largest per-turn saving available without changing
// model or scope.
//
//   node scripts/lowpower.js status
//   node scripts/lowpower.js on
//   node scripts/lowpower.js on --effort medium --model sonnet
//   node scripts/lowpower.js off
//
// The saved values live in usage-limits-lowpower.json inside the config
// directory, so "off" puts back exactly what was there, including keys
// that were not set in the first place.

const fs = require('fs');
const os = require('os');
const path = require('path');

const atomic = require('./atomic.js');

const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];
const MANAGED_KEYS = ['effortLevel', 'model'];
const DEFAULTS = { effortLevel: 'low' };

function configDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

function settingsFile() {
  return path.join(configDir(), 'settings.json');
}

function stateFile() {
  return path.join(configDir(), 'usage-limits-lowpower.json');
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

// Replace through a temporary file so an interrupted run cannot leave
// settings.json half written.
function writeJson(file, value) {
  atomic.writeFileAtomic(file, JSON.stringify(value, null, 2) + '\n');
}

function parseArgs(argv) {
  const args = { command: null, effort: null, model: null, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') args.dryRun = true;
    // Codex only: leave the [agents] subagent clamp alone.
    else if (arg === '--no-agents') args.agents = false;
    else if (arg === '--host') args.host = argv[++i];
    else if (arg.startsWith('--host=')) args.host = arg.slice(7);
    else if (arg === '--effort') args.effort = argv[++i];
    else if (arg === '--model') args.model = argv[++i];
    else if (arg.startsWith('--effort=')) args.effort = arg.slice('--effort='.length);
    else if (arg.startsWith('--model=')) args.model = arg.slice('--model='.length);
    else if (!args.command && !arg.startsWith('-')) args.command = arg;
    else throw new Error('Unknown argument: ' + arg);
    if (['--host', '--effort', '--model'].includes(arg) && (!argv[i] || argv[i].startsWith('--'))) throw new Error('Missing value for ' + arg);
  }
  for (const key of ['host', 'effort', 'model']) if (Object.hasOwn(args, key) && args[key] === '') throw new Error('Missing value for --' + key);
  if (!args.command) args.command = 'status';
  return args;
}

// Work out the new settings without touching disk. Returns the object to
// write, the state to remember, and a readable list of what moved.
function planApply(settings, options, existingState) {
  const current = settings || {};
  const wanted = {};
  const effort = options.effort || DEFAULTS.effortLevel;

  if (EFFORT_LEVELS.indexOf(effort) === -1) {
    throw new Error('unknown effort "' + effort + '", expected one of ' + EFFORT_LEVELS.join(', '));
  }
  // Claude Code refuses 'max' in settings.json; it only survives through
  // /effort or CLAUDE_CODE_EFFORT_LEVEL. Writing it here would save a value
  // the next session silently ignores, which is worse than an error.
  if (effort === 'max') {
    throw new Error(
      "settings.json does not accept 'max'. Use --effort xhigh here, and /effort max " +
        'or CLAUDE_CODE_EFFORT_LEVEL=max for the sessions that need it.'
    );
  }
  wanted.effortLevel = effort;
  if (options.model) wanted.model = options.model;

  // A second "on" must not record the already-lowered values as the
  // originals, or "off" would restore low power forever.
  const saved =
    existingState && existingState.previous ? existingState.previous : capture(current);

  const next = Object.assign({}, current, wanted);
  const changes = [];
  for (const key of Object.keys(wanted)) {
    const before = current[key] === undefined ? '(unset)' : current[key];
    if (String(before) !== String(wanted[key])) {
      changes.push(key + ': ' + before + ' -> ' + wanted[key]);
    }
  }

  return {
    settings: next,
    state: { savedAt: new Date().toISOString(), previous: saved, applied: wanted },
    changes,
  };
}

// Snapshot only the keys this tool is allowed to touch. A key that was not
// present is recorded as null so it can be removed again on restore.
function capture(settings) {
  const previous = {};
  for (const key of MANAGED_KEYS) {
    previous[key] = Object.prototype.hasOwnProperty.call(settings, key) ? settings[key] : null;
  }
  return previous;
}

function planRestore(settings, state) {
  if (!state || !state.previous) {
    return { settings: settings || {}, changes: [], restored: false };
  }
  const next = Object.assign({}, settings || {});
  const changes = [];

  for (const key of MANAGED_KEYS) {
    const before = next[key] === undefined ? '(unset)' : next[key];
    const target = state.previous[key];
    if (target === null || target === undefined) {
      if (Object.prototype.hasOwnProperty.call(next, key)) {
        delete next[key];
        changes.push(key + ': ' + before + ' -> (unset)');
      }
    } else if (String(before) !== String(target)) {
      next[key] = target;
      changes.push(key + ': ' + before + ' -> ' + target);
    }
  }

  return { settings: next, changes, restored: true };
}

function describe(settings, state) {
  const lines = [];
  const current = settings || {};
  lines.push('Low power    ' + (state ? 'on since ' + state.savedAt : 'off'));
  lines.push('effortLevel  ' + (current.effortLevel || '(unset, defaults to xhigh)'));
  lines.push('model        ' + (current.model || '(unset)'));
  if (state && state.previous) {
    const previous = state.previous;
    const parts = MANAGED_KEYS.map(
      (key) => key + '=' + (previous[key] === null ? '(unset)' : previous[key])
    );
    lines.push('will restore ' + parts.join('  '));
  }
  return lines.join('\n');
}

// Write down what was changed here, so "change my effort back" has a referent.
//
// This script is the ONLY thing in the plugin that writes settings.json, and
// it was the only change the log could not name: mode.js recorded fourteen
// kinds of mode-plane change and nothing ever wrote a user-plane entry, so
// `mode --history` answered "nothing has been changed through this plugin yet"
// immediately after this had rewritten the user's baseline, and undo's whole
// user-plane branch was unreachable code.
//
// Required lazily and inside a try: a settings write that already succeeded
// must not be reported as a failure because a log line could not be added, and
// this file otherwise depends on nothing.
//
// `by` is a reading of the environment, not a claim about intent. Claude Code
// and Codex both put a session id into the environment of everything they
// launch, so a run from inside an agent session is recorded as the agent's and
// a run from the user's own shell as theirs. It is the honest half of "at
// whose instruction": who typed it, not who wanted it.
function logSettingsChange(changes, direction, env) {
  if (!changes || !changes.length) return;
  const e = env || process.env;
  const by = e.CLAUDE_CODE_SESSION_ID || e.CLAUDE_SESSION_ID || e.CODEX_SESSION_ID ? 'claude' : 'user';
  try {
    const mode = require('./mode.js');
    for (const change of changes) {
      // "effortLevel: xhigh -> low", as planApply and planRestore build them.
      const at = change.indexOf(': ');
      const key = at === -1 ? change : change.slice(0, at);
      const rest = at === -1 ? '' : change.slice(at + 2);
      const arrow = rest.indexOf(' -> ');
      mode.logChange({
        plane: 'user',
        key,
        from: arrow === -1 ? null : rest.slice(0, arrow),
        to: arrow === -1 ? rest || null : rest.slice(arrow + 4),
        by,
        reason: direction === 'off' ? 'lowpower off' : 'lowpower on',
      });
    }
  } catch (err) {
    // A record of the change is worth less than the change itself.
  }
}

function main(argv) {
  const args = parseArgs(argv);
  const host = require('./host.js');
  if (args.host && !['codex', 'claude'].includes(args.host)) throw new Error('Expected --host codex or --host claude');
  if ((args.host || host.detect(argv)) === host.CODEX) return require('./codex-lowpower.js').main(args);
  const file = settingsFile();
  const settings = readJson(file) || {};
  const state = readJson(stateFile());

  if (args.command === 'status') {
    process.stdout.write(describe(settings, state) + '\n');
    return 0;
  }

  if (args.command === 'on') {
    const plan = planApply(settings, args, state);
    if (!plan.changes.length && state) {
      process.stdout.write('Already in low power. Nothing to change.\n');
      return 0;
    }
    if (args.dryRun) {
      process.stdout.write('Would change:\n  ' + (plan.changes.join('\n  ') || '(nothing)') + '\n');
      return 0;
    }
    if (!state && fs.existsSync(file)) fs.copyFileSync(file, file + '.usage-limits-backup');
    writeJson(file, plan.settings);
    writeJson(stateFile(), plan.state);
    logSettingsChange(plan.changes, 'on');
    process.stdout.write(
      'Low power on.\n  ' + (plan.changes.join('\n  ') || '(nothing to change)') + '\n' +
        'Applies to new sessions. For the session you are in, run /effort ' +
        plan.state.applied.effortLevel + '.\n'
    );
    return 0;
  }

  if (args.command === 'off') {
    if (!state) {
      process.stdout.write('Low power is not on. Nothing to restore.\n');
      return 0;
    }
    const plan = planRestore(settings, state);
    if (args.dryRun) {
      process.stdout.write('Would restore:\n  ' + (plan.changes.join('\n  ') || '(nothing)') + '\n');
      return 0;
    }
    writeJson(file, plan.settings);
    fs.unlinkSync(stateFile());
    logSettingsChange(plan.changes, 'off');
    process.stdout.write(
      'Low power off.\n  ' + (plan.changes.join('\n  ') || '(nothing to change)') + '\n'
    );
    return 0;
  }

  process.stderr.write('usage: lowpower.js [status|on|off] [--host claude|codex] [--effort level] [--model name] [--dry-run]\n');
  return 1;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    process.stderr.write('lowpower: ' + (err && err.message ? err.message : String(err)) + '\n');
    process.exitCode = 1;
  }
}

module.exports = {
  main,
  EFFORT_LEVELS,
  MANAGED_KEYS,
  parseArgs,
  capture,
  planApply,
  planRestore,
  describe,
};
