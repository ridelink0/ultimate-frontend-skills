'use strict';

// Which agent this is running inside, and therefore whose meter to read.
//
// The plugin ships for two hosts. Claude Code keeps its usage figures in
// ~/.claude.json and its turn history under ~/.claude/projects. Codex keeps
// both in its session rollouts under ~/.codex/sessions. The maths downstream is
// the same either way; only the two readers differ.
//
// Guessing wrong is worse than not guessing, because a machine with both
// installed would confidently report the other agent's budget. So anything that
// installs a hook or a command states the host outright, and detection is only
// the fallback for someone running the script by hand.

const fs = require('fs');
const os = require('os');
const path = require('path');

const CLAUDE = 'claude';
const CODEX = 'codex';
const GEMINI = 'gemini';

function geminiConfigDir() {
  return process.env.GEMINI_CONFIG_DIR || path.join(os.homedir(), '.gemini');
}

function geminiHome() {
  return process.env.GEMINI_HOME || path.join(geminiConfigDir(), 'antigravity-cli');
}

function codexHome() {
  return process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
}

function claudeConfigDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

function exists(file) {
  try {
    fs.accessSync(file);
    return true;
  } catch (err) {
    return false;
  }
}

// Claude Code only writes this once it has talked to the API, so its presence
// is a stronger signal than the directory existing.
//
// Look in both places rather than stopping at whichever exists. A migration
// leaves a small ~/.claude/.claude.json carrying machine ids and no meter,
// while the account state stays in the home directory file; stopping at the
// stub answered "no Claude snapshot" on a machine plainly running Claude Code,
// and detection then fell through to Codex and reported its meter instead.
function claudeSnapshotFile() {
  const scoped = path.join(claudeConfigDir(), '.claude.json');
  const home = path.join(os.homedir(), '.claude.json');
  for (const file of scoped === home ? [home] : [scoped, home]) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (parsed && parsed.cachedUsageUtilization) return file;
    } catch (err) {
      // Missing or unreadable is just "not this one".
    }
  }
  return null;
}

function claudeHasSnapshot() {
  return claudeSnapshotFile() !== null;
}

function codexHasSessions() {
  return exists(path.join(codexHome(), 'sessions'));
}

function geminiHasSessions() {
  return exists(geminiHome());
}

function normalise(value) {
  const name = String(value || '').trim().toLowerCase();
  if (name === GEMINI || name === 'agy' || name === 'antigravity' || name === 'google') return GEMINI;
  if (name === CODEX || name === 'chatgpt' || name === 'openai') return CODEX;
  if (name === CLAUDE || name === 'claude-code' || name === 'anthropic') return CLAUDE;
  return null;
}

// `--host gemini` beats everything, then the environment variable, then what is
// actually on disk.
function detect(argv, env) {
  const args = argv || [];
  const at = args.indexOf('--host');
  const explicit = at !== -1 ? normalise(args[at + 1]) : null;
  if (explicit) return explicit;

  const environment = env || process.env;
  const fromEnv = normalise(environment.USAGE_LIMITS_HOST);
  if (fromEnv) return fromEnv;

  // Set by Antigravity / Gemini CLI
  if (environment.ANTIGRAVITY_CLI || environment.GEMINI_CLI || environment.GEMINI_WORKSPACE) return GEMINI;
  // Set by Claude Code for plugin hooks and commands.
  if (environment.CLAUDE_PLUGIN_ROOT || environment.CLAUDE_PROJECT_DIR) return CLAUDE;
  // Set by Codex for the processes it launches.
  if (environment.CODEX_HOME || environment.CODEX_CLI_PATH) return CODEX;

  if (claudeHasSnapshot()) return CLAUDE;
  if (codexHasSessions()) return CODEX;
  if (geminiHasSessions()) return GEMINI;
  return CLAUDE;
}

// Codex hook payloads always carry turn_id; Claude Code's never do. Codex also
// loads an installed plugin's Claude-style hooks/hooks.json, which runs these
// scripts with no --host and may set CLAUDE_PLUGIN_ROOT, so detect() alone
// called that Codex turn Claude Code and briefed Claude's budget into Codex.
// An explicit --host or USAGE_LIMITS_HOST still wins.
function detectFromHook(argv, env, input) {
  const args = argv || [];
  const environment = env || process.env;
  if (args.includes('--host') || normalise(environment.USAGE_LIMITS_HOST)) return detect(args, environment);
  if (input && typeof input === 'object' && input.turn_id !== undefined && input.turn_id !== null) return CODEX;
  return detect(args, environment);
}

module.exports = {
  detectFromHook,
  CLAUDE,
  CODEX,
  GEMINI,
  detect,
  normalise,
  geminiHome,
  geminiConfigDir,
  geminiHasSessions,
  codexHome,
  claudeConfigDir,
  claudeHasSnapshot,
  claudeSnapshotFile,
  codexHasSessions,
  exists,
};
