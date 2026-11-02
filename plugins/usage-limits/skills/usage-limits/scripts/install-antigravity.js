#!/usr/bin/env node
'use strict';

// Installs the plugin into Antigravity.
//
// Antigravity discovers customizations from ~/.gemini/config/ on a machine, and
// a plugin there is a directory holding plugin.json, optionally hooks.json,
// rules/ and skills/. That is documented on the machine itself, in the built-in
// agy-customizations skill, and this installer follows it rather than guessing:
//
//   ~/.gemini/config/plugins/usage-limits/
//     plugin.json      the marker that makes the directory a plugin
//     hooks.json       PreInvocation for the budget line, PreToolUse for the ceiling
//     rules/AGENTS.md  the always-on rules
//
// The installed directory is deliberately small. Hooks run with their working
// directory set to the folder containing hooks.json, so a copied plugin would
// need the whole script tree copied with it and would then go stale the moment
// the real one was updated. Instead the commands carry an absolute path back to
// this checkout, so there is one copy of the code and updating it updates what
// Antigravity runs.
//
//   node install-antigravity.js status
//   node install-antigravity.js on
//   node install-antigravity.js off
//
// Everything written is confined to that one directory, and `off` removes
// exactly what `on` created and nothing else.

const fs = require('fs');
const os = require('os');
const path = require('path');

const atomic = require('./atomic.js');
const host = require('./host.js');

const PLUGIN = 'usage-limits';

function pluginsDir() {
  return path.join(host.geminiConfigDir(), 'config', 'plugins');
}

function pluginDir() {
  return path.join(pluginsDir(), PLUGIN);
}

// Forward slashes on every platform. They work in Windows paths and keep the
// command free of escapes in both JSON and the shell that runs it.
function slashes(file) {
  return String(file).replace(/\\/g, '/');
}

function scriptPath(name) {
  return path.join(__dirname, name);
}

// The name of the launcher written beside hooks.json.
const LAUNCHER = 'agy-hook.js';

// A hook command a shell cannot mangle.
//
// Antigravity runs hook commands through `cmd /c` on Windows. It does not pass
// /s, so cmd applies its own quote rule: the outer quotes are stripped only
// when the string carries exactly one pair. A path with a space in it needs a
// pair of its own, which makes three, and cmd then keeps them all - the command
// name becomes the whole quoted string and node is handed `C:/Users/Some` as
// its script. That is not a theory: a checkout under a directory with a space
// in its name installed cleanly and every hook then failed silently, because
// Antigravity reports nothing when a hook cannot start.
//
// So the command carries no quotes at all, which means it must carry no spaces
// either. Two ways to get there, and the one used depends on the path:
//
//   - the plugin directory has no space: name the launcher absolutely, exactly
//     as before, and nothing depends on the working directory
//   - it does: name it relatively. Hooks run with their working directory set
//     to the folder holding hooks.json, which is where the launcher is written
//
// Either way the real path into this checkout lives inside the launcher, as
// JavaScript, where no shell ever sees it.
function launcherPath() {
  return path.join(pluginDir(), LAUNCHER);
}

function hookCommand(event, dir) {
  const absolute = slashes(dir === undefined ? launcherPath() : path.join(dir, LAUNCHER));
  const target = absolute.includes(' ') ? LAUNCHER : absolute;
  return 'node ' + target + ' --event ' + event;
}

// The launcher itself. It exists so the command above needs no path: requiring
// the real script by absolute path is a string in a JS file, which survives any
// amount of shell quoting, and calling main() is what `node agy-hook.js` would
// have done.
function launcherText() {
  return [
    "'use strict';",
    '',
    '// Written by install-antigravity.js. Do not edit: `on` rewrites it.',
    '//',
    '// The hook command that runs this file carries no path and no quotes,',
    "// because Antigravity's `cmd /c` keeps the quotes around a path with a",
    '// space in it and node is then handed a truncated script name. The path',
    '// lives here instead, where only node reads it.',
    'require(' + JSON.stringify(slashes(scriptPath('agy-hook.js'))) + ').main(process.argv.slice(2));',
    '',
  ].join('\n');
}

function manifest() {
  return {
    name: PLUGIN,
    description:
      'Puts the remaining usage budget in front of the agent before each turn, and enforces a ' +
      'ceiling past which fan-out calls are refused.',
  };
}

function hooks() {
  return {
    'usage-limits-brief': {
      PreInvocation: [{ type: 'command', command: hookCommand('PreInvocation'), timeout: 10 }],
    },
    'usage-limits-ceiling': {
      PreToolUse: [
        {
          // Only the fan-out tools: a node start before every tool call cost
          // 3-6 s each here, and ordinary tools have nothing to ask the ceiling.
          matcher: 'invoke_subagent|browser_subagent',
          hooks: [{ type: 'command', command: hookCommand('PreToolUse'), timeout: 10 }],
        },
      ],
    },
  };
}

function rulesText() {
  // Shipped from the repo so there is one copy of the wording, but never fails
  // the install over a missing file: the hooks are the part that matters.
  try {
    return fs.readFileSync(path.join(__dirname, '..', '..', '..', 'rules', 'AGENTS.md'), 'utf8');
  } catch (err) {
    return null;
  }
}

function writeFile(file, text) {
  atomic.writeFileAtomic(file, text);
}

function installed() {
  try {
    fs.accessSync(path.join(pluginDir(), 'plugin.json'));
    return true;
  } catch (err) {
    return false;
  }
}

// Whether Antigravity is on this machine at all. Its config directory is the
// evidence; ~/.gemini alone is not, because the Gemini CLI uses that too.
function present() {
  return host.exists(path.join(host.geminiConfigDir(), 'antigravity-cli')) ||
    host.exists(path.join(host.geminiConfigDir(), 'antigravity'));
}

function status() {
  const lines = [];
  lines.push('Antigravity   ' + (present() ? 'found at ' + host.geminiConfigDir() : 'not found on this machine'));
  lines.push('Plugin        ' + (installed() ? 'installed at ' + pluginDir() : 'not installed'));
  if (installed()) {
    let current = null;
    try {
      current = JSON.parse(fs.readFileSync(path.join(pluginDir(), 'hooks.json'), 'utf8'));
    } catch (err) {
      // An unreadable hooks.json is worth saying rather than throwing.
    }
    const events = current ? Object.keys(current).map((name) => Object.keys(current[name]).filter((k) => k !== 'enabled').join(', ')) : [];
    lines.push('Hooks         ' + (events.length ? events.join(', ') : 'none readable'));
    lines.push(
      'Enabled       recorded in ' +
        path.join(host.geminiConfigDir(), 'config', 'config.json') +
        ' under plugins.' + PLUGIN + '; a plugin with no entry there is on by default.'
    );
  }
  if (!present()) {
    lines.push('');
    lines.push('Nothing to install into. Antigravity keeps its configuration in ~/.gemini/config.');
  }
  return lines.join('\n');
}

function enable() {
  if (!present()) {
    return (
      'Antigravity was not found on this machine, so there is nothing to install into.\n' +
      'Expected its configuration at ' + host.geminiConfigDir() + '.'
    );
  }
  const dir = pluginDir();
  writeFile(path.join(dir, 'plugin.json'), JSON.stringify(manifest(), null, 2) + '\n');
  // Before hooks.json, so the file the commands name is never missing while
  // they are readable.
  writeFile(path.join(dir, LAUNCHER), launcherText());
  writeFile(path.join(dir, 'hooks.json'), JSON.stringify(hooks(), null, 2) + '\n');
  const rules = rulesText();
  if (rules) writeFile(path.join(dir, 'rules', 'AGENTS.md'), rules);

  return [
    'Installed into ' + dir + '.',
    '  PreInvocation  the budget line, as an injected ephemeral message',
    '  PreToolUse     the ceiling, which refuses fan-out calls past it',
    rules ? '  rules/AGENTS.md  the always-on rules' : '  (rules/AGENTS.md was not found in this checkout and was skipped)',
    '',
    'The hooks run this checkout directly, so updating it updates what Antigravity runs.',
    'Antigravity picks the plugin up when it next starts. There is no quota figure for it: ' +
      'Antigravity refreshes its own quota but writes it nowhere readable, so the budget line ' +
      'reports what it can and says so where it cannot.',
  ].join('\n');
}

// Removes only what enable() wrote, one named file at a time, and only takes
// the directory away when nothing else has been put in it.
function disable() {
  const dir = pluginDir();
  if (!installed()) return 'Not installed. Nothing to remove.';
  const removed = [];
  for (const relative of ['plugin.json', 'hooks.json', LAUNCHER, path.join('rules', 'AGENTS.md')]) {
    const file = path.join(dir, relative);
    try {
      fs.unlinkSync(file);
      removed.push(relative);
    } catch (err) {
      // Already gone is the outcome that was asked for.
    }
  }
  for (const relative of ['rules', '']) {
    try {
      fs.rmdirSync(path.join(dir, relative));
    } catch (err) {
      // Not empty, or already gone. Either way it is not ours to force.
    }
  }
  return 'Removed ' + (removed.length ? removed.join(', ') : 'nothing') + ' from ' + dir + '.';
}

function main(argv) {
  const command = (argv || []).find((arg) => !arg.startsWith('-')) || 'status';
  if (command === 'status') return status();
  if (command === 'on') return enable();
  if (command === 'off') return disable();
  throw new Error('Expected status, on or off');
}

if (require.main === module) {
  try {
    process.stdout.write(main(process.argv.slice(2)) + '\n');
    process.exitCode = 0;
  } catch (err) {
    process.stderr.write('install-antigravity: ' + (err && err.message ? err.message : String(err)) + '\n');
    process.exitCode = 1;
  }
}

module.exports = { PLUGIN, pluginsDir, pluginDir, hookCommand, manifest, hooks, installed, present, status, enable, disable, main };
