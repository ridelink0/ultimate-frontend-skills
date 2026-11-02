#!/usr/bin/env node
'use strict';

// Installs the budget line into Codex.
//
// Claude Code lets a plugin ship its own hooks, so installing the plugin is all
// there is to it. Codex is not there yet, and it is worth writing down exactly
// how far it gets, because the answer is not obvious from the outside:
//
//   - Codex has the whole hook engine. The binary carries UserPromptSubmit,
//     SessionStart, PreToolUse and the rest, and `codex features list` reports
//     `hooks` as stable and enabled.
//   - A plugin cannot ship one. `plugin_hooks` is reported as `removed`, so a
//     `hooks` field in .codex-plugin/plugin.json is accepted and ignored.
//   - On codex-cli 0.151.0-alpha.7.2 nothing fired hooks from anywhere. On
//     0.153.4 the user-level ~/.codex/hooks.json does run them, but only after
//     a one-time review: the terminal UI opens with "Hooks need review - hooks
//     can run outside the sandbox after you trust them", and the choices are
//     "Trust all and continue" or "Continue without trusting (hooks won't
//     run)". The trust is persisted as a hash of the hooks, so a hook this
//     script rewrites has to be trusted again. The desktop app never shows
//     that review, which is why a machine using only the app can have the
//     hooks installed for weeks and never once run them.
//
// So the hooks are written, and `status` says whether anything has ever run
// them. But the trust review is the user's to accept, deliberately - this
// script does not forge a trust hash to get round a safety prompt - and until
// it is accepted the hooks are inert. AGENTS.md is what works regardless:
// Codex reads it at the top of every session in scope, which is the one
// always-on instruction channel. It cannot carry live numbers the way a hook
// can, so instead it tells Codex to go and read them at the start of a piece
// of work - and, since the effort setting is what actually empties a Codex
// window, to look at that.
//
// Both halves are marked and reversible, and neither touches anything else in
// the files it edits.
//
//   node install-codex-hook.js status
//   node install-codex-hook.js on
//   node install-codex-hook.js off

const fs = require('fs');
const path = require('path');

const host = require('./host.js');

// One before each prompt, one during long turns so the figure does not go
// stale while work is running.
const EVENTS = [
  { event: 'UserPromptSubmit', script: 'brief.js', status: 'Checking usage limits' },
  { event: 'PostToolUse', script: 'pulse.js', status: 'Checking usage limits' },
  // Codex has subagents too, and a turn that hands its work to them makes no
  // tool calls of its own for as long as they run. Same quiet refresh as on
  // Claude Code; pulse.js sees the event name and says nothing.
  { event: 'SubagentStop', script: 'pulse.js', status: 'Checking usage limits' },
  // The ceiling, and the only entry here that can refuse anything.
  //
  // Codex is the host where a reported figure demonstrably does not change
  // behaviour, and the reason is not stubbornness: gpt-6-astra's own system
  // prompt, shipped in models_cache.json, tells it "do not settle for a partial
  // or helpful enough solution that does not fully satisfy the user's task to
  // save time, effort or tokens", and ranks the live user instruction above
  // anything an AGENTS.md or a skill says. A line asking it to economise is
  // arguing with its own instructions and losing.
  //
  // So this one does not ask. PreToolUse takes a permissionDecision of "deny",
  // and past the ceiling the fan-out calls get one. The matcher is broad
  // because ceiling.js decides what is actually a multiplier; a hook that fires
  // and returns nothing costs a few milliseconds, and a matcher that misses a
  // renamed tool costs the window.
  { event: 'PreToolUse', script: 'pulse.js', status: 'Checking usage limits', matcher: '.*' },
];
const EVENT = EVENTS[0].event;
// Ten seconds is the same budget the Claude hook gets. The brief caches the
// expensive half for a minute, so the common case is far under it.
const TIMEOUT_SECONDS = 10;

function hooksFile() {
  return path.join(host.codexHome(), 'hooks.json');
}

// Whether Codex has ever actually run one of these hooks. Each writes a small
// state file beside the rollouts the first time it fires, so the hooks being
// installed with none of those present means the trust review has never been
// accepted - which is the state a machine using only the desktop app sits in
// indefinitely, with no error anywhere to say so.
function everRan() {
  const dir = host.codexHome();
  return ['usage-limits-pulse.json', 'usage-limits-brief.json'].some((name) =>
    host.exists(path.join(dir, name))
  );
}

const TRUST_STEP =
  'Codex runs hooks from this file only after a one-time review. Start `codex` in a\n' +
  '  terminal once and choose "Trust all and continue"; the desktop app never shows\n' +
  '  that review. Rewriting the hooks changes their hash, so `on` means reviewing again.';

function briefScript(name) {
  return path.join(__dirname, name || 'brief.js');
}

// Forward slashes on every platform. They work in Windows paths, and they keep
// the command free of escapes in both JSON and the shell that runs it.
function quote(file) {
  return '"' + String(file).replace(/\\/g, '/') + '"';
}

// process.execPath rather than a bare `node`, because a hook does not
// necessarily inherit a PATH with node on it, and a hook that cannot start is
// silent: no error, no budget line, and nothing to tell you why.
function command(script) {
  return quote(process.execPath) + ' ' + quote(briefScript(script)) + ' --host codex';
}

// Ours is any entry that runs one of this plugin's own hook scripts, whatever
// node or absolute path it was written with. Matching on that rather than on
// the whole string is what makes reinstalling replace instead of duplicate.
function isOurs(entry) {
  if (!entry || typeof entry.command !== 'string') return false;
  const text = entry.command.replace(/\\/g, '/');
  return EVENTS.some((one) => text.indexOf('usage-limits/scripts/' + one.script) !== -1);
}

function readHooks() {
  let raw;
  try {
    raw = fs.readFileSync(hooksFile(), 'utf8');
  } catch (err) {
    return { config: { hooks: {} }, existed: false, broken: false };
  }
  try {
    const parsed = JSON.parse(raw.replace(/^﻿/, ''));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    if (!parsed.hooks || typeof parsed.hooks !== 'object') parsed.hooks = {};
    return { config: parsed, existed: true, broken: false };
  } catch (err) {
    // Never overwrite a file that might be someone's working configuration
    // just because it could not be parsed.
    return { config: null, existed: true, broken: true };
  }
}

function writeHooks(config) {
  const file = hooksFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

// ---------------------------------------------------------------------------
// AGENTS.md, which is the half that works today
// ---------------------------------------------------------------------------

const AGENTS_START = '<!-- usage-limits:start -->';
const AGENTS_END = '<!-- usage-limits:end -->';

function agentsFile() {
  return path.join(host.codexHome(), 'AGENTS.md');
}

// Deliberately short. This sits in the context of every session in scope, so
// every line has to earn its place, and the numbers themselves are left to the
// script rather than being described here.
function agentsBlock() {
  return [
    AGENTS_START,
    '## Usage limits',
    '',
    'Before starting any substantial piece of work, run:',
    '',
    '    node ' + quote(briefScript('usage.js')) + ' --host codex',
    '',
    'Open the reply with one line naming the binding window, the turns of headroom',
    'left in it, and whether the request fits. Size the work against that number: if',
    'it does not fit, say what you will do now and what you will leave for after the',
    'reset, rather than starting and being cut off partway.',
    '',
    'The number is an estimate that shrinks as the work runs, so run it again after',
    'every ten or so tool-heavy turns, after any step that took minutes, and before',
    'the last long step of a job. When the turns left are fewer than the steps still',
    'ahead, or under fifteen, stop at the next clean boundary: save the work, write',
    'what is done and what is next to WORK-PLAN.md in the working directory, commit',
    'if there is a repository, and say so. Never push on into the limit: a job cut',
    'off partway loses the handoff as well as the work.',
    '',
    'Below ten percent left, or a few turns, the check itself was the last cheap',
    'thing: start nothing new, write the handoff in this same turn, and end the',
    'turn. On 8 September a session read the meter at five percent, carried on,',
    'and lost the rest of the window inside that turn.',
    '',
    'This is about the order of the work, not the amount. Do not economise, shorten',
    'answers or skip verification to save budget: unspent budget is lost at the',
    'reset, not carried over.',
    '',
    'The reasoning effort in config.toml is what actually empties a window: one',
    'ordinary task at ultra effort on a Plus plan can take a whole five-hour window.',
    'The report measures what each effort costs here and prices the window at the',
    'one set now; if it says the window holds only a few turns at this effort, say',
    'so, and use a lower effort for work that does not need the thinking.',
    AGENTS_END,
  ].join('\n');
}

function readAgents() {
  try {
    return { text: fs.readFileSync(agentsFile(), 'utf8'), existed: true };
  } catch (err) {
    return { text: '', existed: false };
  }
}

// Between the markers and nowhere else, so whatever else the file holds is
// carried through untouched.
function stripAgents(text) {
  const start = text.indexOf(AGENTS_START);
  const end = text.indexOf(AGENTS_END);
  if (start === -1 || end === -1 || end < start) return text;
  const before = text.slice(0, start).replace(/\n+$/, '');
  const after = text.slice(end + AGENTS_END.length).replace(/^\n+/, '');
  if (!before) return after;
  if (!after) return before + '\n';
  return before + '\n\n' + after;
}

function agentsInstalled() {
  const { text } = readAgents();
  return text.indexOf(AGENTS_START) !== -1;
}

// One marker without its pair, or more than one of either. Stripping refuses to
// touch that, because the only safe reading of "start with no end" is that the
// region runs to the end of the file, and deleting to the end of somebody's
// AGENTS.md is not a repair. Left alone, the next `on` would strip nothing and
// then append, leaving two blocks; so `on` refuses too and says what to fix.
function agentsMalformed(text) {
  const source = typeof text === 'string' ? text : readAgents().text;
  const starts = source.split(AGENTS_START).length - 1;
  const ends = source.split(AGENTS_END).length - 1;
  if (starts === 0 && ends === 0) return false;
  if (starts !== 1 || ends !== 1) return true;
  return source.indexOf(AGENTS_END) < source.indexOf(AGENTS_START);
}

// True when the block is there but points at a different copy of the plugin,
// which would send Codex to a script that may no longer exist.
function agentsStale() {
  const { text } = readAgents();
  const start = text.indexOf(AGENTS_START);
  if (start === -1) return false;
  const end = text.indexOf(AGENTS_END);
  const current = text.slice(start, end === -1 ? undefined : end + AGENTS_END.length);
  return current.trim() !== agentsBlock().trim();
}

function writeAgents(text) {
  const file = agentsFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
}

function enableAgents() {
  const { text } = readAgents();
  if (agentsMalformed(text)) return false;
  const rest = stripAgents(text).replace(/\n+$/, '');
  writeAgents((rest ? rest + '\n\n' : '') + agentsBlock() + '\n');
  return true;
}

function disableAgents() {
  const { text, existed } = readAgents();
  if (!existed || text.indexOf(AGENTS_START) === -1) return false;
  if (agentsMalformed(text)) return false;
  writeAgents(stripAgents(text));
  return true;
}

// Strips our entry out of one event's groups and drops any group left empty,
// so removing is a clean reversal rather than a pile of empty objects.
function withoutOurs(groups) {
  return (Array.isArray(groups) ? groups : [])
    .map((group) => {
      if (!group || typeof group !== 'object') return null;
      const hooks = Array.isArray(group.hooks) ? group.hooks.filter((one) => !isOurs(one)) : [];
      if (!hooks.length) return null;
      return Object.assign({}, group, { hooks });
    })
    .filter(Boolean);
}

function find(config, event) {
  const groups = config && config.hooks ? config.hooks[event || EVENT] : null;
  for (const group of Array.isArray(groups) ? groups : []) {
    for (const one of (group && Array.isArray(group.hooks) ? group.hooks : [])) {
      if (isOurs(one)) return one;
    }
  }
  return null;
}

function status() {
  const { config, existed, broken } = readHooks();
  if (broken) {
    return {
      installed: false,
      broken: true,
      file: hooksFile(),
      text: hooksFile() + ' is not valid JSON, so nothing was changed. Fix or remove it, then run `on` again.',
    };
  }
  const rows = EVENTS.map((one) => ({
    event: one.event,
    script: one.script,
    found: find(config, one.event),
    wanted: command(one.script),
  }));
  const missing = rows.filter((row) => !row.found);
  // A hook installed from a copy of the plugin that has since moved would point
  // at a file that is no longer there, and would fail silently.
  const stale = rows.filter((row) => row.found && row.found.command !== row.wanted);

  const lines = [];
  if (!missing.length) lines.push('Installed in ' + hooksFile() + '.');
  else if (missing.length === rows.length) {
    lines.push('Not installed. Run `on` to add it to ' + hooksFile() + '.');
  } else {
    lines.push(
      'Partly installed in ' + hooksFile() + '. Missing: ' +
        missing.map((row) => row.event).join(', ') + '. Run `on`.'
    );
  }
  for (const row of stale) {
    lines.push('  ' + row.event + ' points somewhere else, so run `on`:\n    ' + row.found.command);
  }

  // Reported second and plainly, because this is the half that is actually
  // doing the work. Saying "installed" about the hooks alone would claim an
  // automatic budget line that no current Codex build delivers.
  const malformed = agentsMalformed();
  const agents = agentsInstalled() && !malformed;
  lines.push(
    malformed
      ? 'The usage-limits markers in ' + agentsFile() + ' are not a matched pair, so\n' +
        '  nothing was changed. Delete the block by hand and run `on` again.'
      : agents
        ? 'AGENTS.md block present in ' + agentsFile() + '.' +
          (agentsStale() ? '\n  It points at another copy of the plugin, so run `on`.' : '')
        : 'AGENTS.md block missing from ' + agentsFile() + '. Run `on`.'
  );
  if (!missing.length) {
    lines.push(
      everRan()
        ? 'Codex has run these hooks: their state files are beside its rollouts.'
        : 'Codex has never run these hooks. ' + TRUST_STEP + '\n' +
          '  Until then the AGENTS.md block is what makes this work.'
    );
  }

  return {
    installed: !missing.length && agents,
    hooksInstalled: !missing.length,
    agentsInstalled: agents,
    partial: Boolean(missing.length && missing.length < rows.length),
    broken: false,
    existed,
    file: hooksFile(),
    agentsFile: agentsFile(),
    events: rows.map((row) => ({ event: row.event, installed: Boolean(row.found) })),
    stale: stale.length > 0 || agentsStale(),
    text: lines.join('\n'),
  };
}

function enable() {
  const { config, broken } = readHooks();
  if (broken) return { ok: false, text: status().text };

  for (const one of EVENTS) {
    const rest = withoutOurs(config.hooks[one.event]);
    const group = {
      hooks: [
        {
          type: 'command',
          command: command(one.script),
          timeout: TIMEOUT_SECONDS,
          statusMessage: one.status,
        },
      ],
    };
    // Tool-scoped events take a matcher; the others ignore one, and writing a
    // matcher where none belongs is the kind of thing a strict parser rejects.
    if (one.matcher) group.matcher = one.matcher;
    rest.push(group);
    config.hooks[one.event] = rest;
  }
  if (!config.description) {
    config.description = 'Hooks for Codex. Managed entries are marked by the script that wrote them.';
  }
  if (agentsMalformed()) {
    return {
      ok: false,
      text:
        'The usage-limits markers in ' + agentsFile() + ' are not a matched pair.\n' +
        'Nothing was changed, in either file. Delete that block by hand and run `on` again.',
    };
  }

  writeHooks(config);
  enableAgents();
  return {
    ok: true,
    text:
      'Installed, in two places.\n' +
      '  ' + agentsFile() + '\n' +
      '    A marked block telling Codex to check the budget at the start of a piece\n' +
      '    of work. This is the part that works today.\n' +
      '  ' + hooksFile() + '\n' +
      EVENTS.map((one) => '    ' + one.event + '  ' + command(one.script)).join('\n') + '\n' +
      '    ' + TRUST_STEP.replace(/\n  /g, '\n    ') + '\n' +
      'Start a new thread for it to take effect. Run `off` to remove both.',
  };
}

function disable() {
  const { config, existed, broken } = readHooks();
  if (broken) return { ok: false, text: status().text };

  const removedAgents = disableAgents();
  const hadHooks = existed && EVENTS.some((one) => find(config, one.event));
  if (hadHooks) {
    for (const one of EVENTS) {
      const rest = withoutOurs(config.hooks[one.event]);
      if (rest.length) config.hooks[one.event] = rest;
      else delete config.hooks[one.event];
    }
    writeHooks(config);
  }

  if (!hadHooks && !removedAgents) {
    return { ok: true, text: 'Nothing to remove: it was not installed.' };
  }
  const done = [];
  if (removedAgents) done.push('the AGENTS.md block from ' + agentsFile());
  if (hadHooks) done.push('the hooks from ' + hooksFile());
  return {
    ok: true,
    text: 'Removed ' + done.join(' and ') + '. Everything else in those files was left alone.',
  };
}

const HELP = `install-codex-hook - make Codex check the budget without being asked

  node install-codex-hook.js status   what is installed, and does it point here
  node install-codex-hook.js on       install into AGENTS.md and hooks.json
  node install-codex-hook.js off      take both out again

Codex will not load hooks from a plugin, and on current builds it does not run
them from ~/.codex/hooks.json or config.toml either, though the engine is there.
So this installs two things: a marked block in ~/.codex/AGENTS.md, which is what
actually works today, and the hooks themselves for when that lands.

Claude Code needs none of this. Installing the plugin is enough there.
`;

function main(argv) {
  const command_ = (argv && argv[0]) || 'status';
  if (command_ === '--help' || command_ === '-h' || command_ === 'help') {
    process.stdout.write(HELP);
    return 0;
  }
  if (command_ === 'status') {
    const result = status();
    process.stdout.write(result.text + '\n');
    return result.broken ? 1 : 0;
  }
  if (command_ === 'on' || command_ === 'install') {
    const result = enable();
    process.stdout.write(result.text + '\n');
    return result.ok ? 0 : 1;
  }
  if (command_ === 'off' || command_ === 'uninstall' || command_ === 'remove') {
    const result = disable();
    process.stdout.write(result.text + '\n');
    return result.ok ? 0 : 1;
  }
  process.stderr.write('install-codex-hook: unknown command "' + command_ + '".\n' + HELP);
  return 2;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = {
  EVENT,
  EVENTS,
  TIMEOUT_SECONDS,
  hooksFile,
  briefScript,
  command,
  isOurs,
  withoutOurs,
  find,
  readHooks,
  AGENTS_START,
  AGENTS_END,
  agentsFile,
  agentsBlock,
  readAgents,
  stripAgents,
  agentsInstalled,
  agentsStale,
  enableAgents,
  disableAgents,
  status,
  enable,
  disable,
  main,
  HELP,
};
