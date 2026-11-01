'use strict';
// Reversible edits to Codex's top-level defaults. Never changes a running turn.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const atomicWrite = require('./atomic.js');
const KEYS = ['model', 'model_reasoning_effort'];
const EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];

function scan(text) {
  // Do not pretend a line editor is a full TOML parser.
  if (text.includes('"""') || text.includes("'''")) throw new Error('Multiline TOML requires manual editing; config was not changed.');
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) || [];
  const found = {};
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/^\uFEFF/, '');
    if (/^\s*\[/.test(line)) break;
    for (const key of KEYS) {
      const re = new RegExp('^\\s*(?:' + key + '|"' + key + '"|\\x27' + key + '\\x27)\\s*=');
      if (!re.test(line)) continue;
      if (Object.hasOwn(found, key)) throw new Error('Duplicate top-level ' + key + '; config was not changed.');
      if (!/=\s*(?:"(?:[^"\\]|\\.)*"|'[^']*')\s*(?:#.*)?(?:\r?\n)?$/.test(line))
        throw new Error('Unsupported value for ' + key + '; config was not changed.');
      found[key] = { index: i, line: lines[i] };
    }
  }
  return { lines, found };
}
function rewrite(text, values) {
  const { lines, found } = scan(text);
  const prepend = [];
  for (const [key, line] of Object.entries(values)) {
    if (!KEYS.includes(key)) throw new Error('Invalid managed setting');
    if (found[key]) lines[found[key].index] = line || '';
    else if (line) prepend.push(line);
  }
  return prepend.join('') + lines.join('');
}
// ---------------------------------------------------------------------------
// The subagent clamp
//
// Effort is the biggest lever on Codex and this is the second. Two facts, both
// read out of the model catalog Codex itself caches at
// CODEX_HOME/models_cache.json rather than taken from documentation:
//
//   gpt-6-astra: default_reasoning_level = "low"
//                multi_agent_reasoning_effort = "xhigh"
//
// So Astra's own default effort is the cheapest one, and its subagents run at
// the dearest one NO MATTER what the main session is set to. A session at
// medium that delegates is still paying xhigh for everything it delegates, and
// the "ultra" level is described in that same catalog as "maximum reasoning
// with automatic task delegation" - it spawns them on its own.
//
// The [agents] table is where that is bounded. It is a table rather than a
// top-level key, and the line editor above deliberately refuses to be a TOML
// parser, so this is handled the one way that is safe without one: a marked
// block appended at the end of the file. A TOML table runs until the next
// header, so appending at the end is always valid, and the editor above stops
// at the first '[' so the two never interfere.
//
// If the file already has an [agents] table this refuses outright rather than
// writing a second one, because duplicate tables are a TOML error and a config
// this tool broke would be worse than a window it failed to save.
const AGENTS_START = '# >>> usage-limits lowpower: subagent clamp';
const AGENTS_END = '# <<< usage-limits lowpower';

function hasAgentsTable(text) {
  // Any [agents] or [agents.x] header that is not inside our own block.
  const outside = stripAgentsBlock(text);
  return /^[ \t]*\[\s*agents\s*[.\]]/m.test(outside);
}

function stripAgentsBlock(text) {
  const from = text.indexOf(AGENTS_START);
  if (from === -1) return text;
  const to = text.indexOf(AGENTS_END, from);
  if (to === -1) return text;
  // The block is written after one blank separator line, so removing it has to
  // take that line too. Leaving it behind meant `off` returned a file one
  // newline longer than `on` found it - which is not a restore, and the
  // round-trip tests that guard this editor said so.
  let start = from;
  if (text.endsWith('\r\n\r\n', from)) start = from - 2;
  else if (text.endsWith('\n\n', from)) start = from - 1;
  const after = to + AGENTS_END.length;
  // Take the newline that ends the marker line with it.
  const end = text.startsWith('\r\n', after) ? after + 2 : text.startsWith('\n', after) ? after + 1 : after;
  return text.slice(0, start) + text.slice(end);
}

function agentsBlock(newline) {
  return [
    AGENTS_START,
    '# Written by the usage-limits plugin. "lowpower off --host codex" removes it.',
    '# Astra runs its subagents at xhigh whatever the session is set to, so this',
    '# is the only place that spend is bounded.',
    '[agents]',
    'max_concurrent_threads_per_session = 1',
    'default_subagent_reasoning_effort = "low"',
    AGENTS_END,
  ].join(newline) + newline;
}

function withAgentsBlock(text, wanted, newline) {
  const base = stripAgentsBlock(text);
  if (!wanted) return base;
  if (hasAgentsTable(base)) {
    throw new Error(
      'config.toml already has an [agents] table; the subagent clamp was not written. ' +
        'Set max_concurrent_threads_per_session and default_subagent_reasoning_effort there yourself.'
    );
  }
  const padded = base.length && !base.endsWith('\n') ? base + newline : base;
  return padded + (padded.length ? newline : '') + agentsBlock(newline);
}

function read(file, fallback) {
  try { return fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return fallback; throw e; }
}
function atomic(file, text) {
  // Throws on failure, as before, with the temporary file already removed.
  atomicWrite.writeFileAtomic(file, text, { encoding: 'utf8', mode: 0o600 });
}
function checkState(state) {
  if (!state) return;
  if (state.version !== 1 || !state.previous || !state.applied) throw new Error('Unrecognized restore state; config was not changed.');
  const keys = Object.keys(state.previous);
  if (!keys.length || keys.some(k => !KEYS.includes(k)) || JSON.stringify(keys.sort()) !== JSON.stringify(Object.keys(state.applied).sort()))
    throw new Error('Invalid restore state; config was not changed.');
  for (const values of [state.previous, state.applied]) {
    for (const [key, line] of Object.entries(values)) {
      if (line === null) continue;
      if (typeof line !== 'string') throw new Error('Invalid restore line');
      const parsed = scan(line);
      if (parsed.lines.length !== 1 || !parsed.found[key]) throw new Error('Invalid restore line');
    }
  }
}
function plan(text, options, state) {
  checkState(state);
  const { found } = scan(text);
  const lineOf = key => found[key] ? found[key].line : null;
  if (state) for (const [key, line] of Object.entries(state.applied)) {
    if (lineOf(key) !== line) throw new Error(key + ' changed outside lowpower; review config and restore state before continuing.');
  }
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  if (options.command === 'off') {
    const restored = state ? rewrite(text, state.previous) : text;
    // The clamp is removed on `off` whether or not this run is the one that
    // wrote it, so a state file lost to a crash cannot strand it in the config.
    return { text: withAgentsBlock(restored, false, newline), state: null };
  }
  const effort = options.effort || 'low';
  if (!EFFORTS.includes(effort)) throw new Error('Unknown Codex effort: ' + effort);
  if (options.model !== null && options.model !== undefined && !/^[a-zA-Z0-9][a-zA-Z0-9_.:/-]*$/.test(options.model))
    throw new Error('Invalid Codex model identifier');
  const wanted = { model_reasoning_effort: effort };
  if (options.model) wanted.model = options.model;
  const previous = { ...(state && state.previous) };
  const applied = { ...(state && state.applied) };
  for (const [key, value] of Object.entries(wanted)) {
    if (!Object.hasOwn(previous, key)) previous[key] = lineOf(key);
    applied[key] = key + ' = ' + JSON.stringify(value) + newline;
  }
  // On unless explicitly refused. Astra's subagents run at xhigh regardless of
  // the session's effort, so lowering effort WITHOUT bounding them leaves the
  // most expensive path in the product untouched.
  const clampAgents = options.agents !== false;
  return {
    text: withAgentsBlock(rewrite(text, applied), clampAgents, newline),
    state: { version: 1, previous, applied, agentsClamp: clampAgents },
  };
}
function main(args) {
  if (!['status', 'on', 'off'].includes(args.command)) throw new Error('Expected status, on or off');
  const dir = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  const file = path.join(dir, 'config.toml');
  const stateFile = path.join(dir, 'usage-limits-lowpower.json');
  const notice = 'Codex defaults only: new sessions. Active tasks, profiles and command-line overrides keep their own settings.';
  // A lock serializes our writers. Other editors are detected before commit.
  let lock;
  if (args.command !== 'status' && !args.dryRun) {
    fs.mkdirSync(dir, { recursive: true });
    lock = fs.openSync(stateFile + '.lock', 'wx');
  }
  try {
    const text = read(file, '');
    const rawState = read(stateFile, null);
    const state = rawState ? JSON.parse(rawState) : null;
    checkState(state);
    if (args.command === 'status') {
      const { found } = scan(text);
      console.log('Codex low power: ' + (state ? 'on' : 'off'));
      for (const key of KEYS) console.log(found[key] ? found[key].line.trim() : key + ' = (unset)');
      console.log(notice);
      return 0;
    }
    const result = plan(text, args, state);
    if (args.dryRun) {
      console.log('Dry run; no files changed.\n' + notice);
      const { found } = scan(result.text);
      for (const key of KEYS) console.log(found[key] ? found[key].line.trim() : key + ' = (unset)');
      return 0;
    }
    if (read(file, '') !== text || read(stateFile, null) !== rawState) throw new Error('Settings changed concurrently; retry.');
    // Save recovery information before changing defaults; roll it back on error.
    if (result.state) atomic(stateFile, JSON.stringify(result.state, null, 2) + '\n');
    try {
      if (result.text !== text) {
        if (!state && fs.existsSync(file)) fs.copyFileSync(file, file + '.usage-limits-backup');
        atomic(file, result.text);
      }
    } catch (e) {
      if (rawState !== null) atomic(stateFile, rawState);
      else if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);
      throw e;
    }
    if (!result.state && fs.existsSync(stateFile)) fs.unlinkSync(stateFile);
    console.log('Codex low power ' + args.command + '.\n' + notice);
    return 0;
  } finally {
    if (lock !== undefined) { fs.closeSync(lock); fs.unlinkSync(stateFile + '.lock'); }
  }
}
module.exports = { scan, rewrite, plan, main, EFFORTS, AGENTS_START, AGENTS_END, hasAgentsTable, stripAgentsBlock, agentsBlock, withAgentsBlock };
