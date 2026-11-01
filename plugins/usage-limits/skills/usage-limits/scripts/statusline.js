#!/usr/bin/env node
'use strict';

// Puts the bars under the Claude Code prompt, and takes them out again.
//
//   node scripts/statusline.js status
//   node scripts/statusline.js on [--refresh N] [--no-chain] [--dry-run]
//   node scripts/statusline.js off
//
// `on` points Claude Code's statusLine setting at a small launcher written into
// the config directory. The launcher finds wherever this plugin is currently
// installed and runs feed.js from there, so a plugin update that moves the
// install directory does not leave the status line pointing at a folder that
// no longer exists.
//
// A status line that was already there is kept: it is recorded, and feed.js
// runs it first and prints its output above ours, unless --no-chain. `off`
// puts back exactly what was there, including nothing.

const fs = require('fs');
const os = require('os');
const path = require('path');

const atomic = require('./atomic.js');

function configDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

function settingsFile() {
  return path.join(configDir(), 'settings.json');
}

function stateFile() {
  return path.join(configDir(), 'usage-limits-statusline.json');
}

function launcherFile() {
  return path.join(configDir(), 'usage-limits-statusline.js');
}

function feedFile() {
  return path.join(__dirname, 'feed.js');
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

function readState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (err) {
    return null;
  }
}

// Replace through a temporary file so an interrupted run cannot leave
// settings.json half written.
function writeJson(file, value) {
  atomic.writeFileAtomic(file, JSON.stringify(value, null, 2) + '\n');
}

// The launcher. It is deliberately dumb: find feed.js, hand over, and if that
// is not possible print nothing and exit 0, because a status line that shows
// an error every 300ms is worse than one that is blank.
function launcherSource(recordedFeed) {
  return [
    '#!/usr/bin/env node',
    "'use strict';",
    '// Written by claude-usage-limits (statusline on). Finds the current install and',
    '// runs its status line. Remove with: claude-usage-limits statusline off',
    "const fs = require('fs');",
    "const os = require('os');",
    "const path = require('path');",
    "const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');",
    'const candidates = [];',
    'try {',
    "  const installed = JSON.parse(fs.readFileSync(path.join(configDir, 'plugins', 'installed_plugins.json'), 'utf8'));",
    '  for (const key of Object.keys((installed && installed.plugins) || {})) {',
    "    if (key.indexOf('usage-limits@') !== 0) continue;",
    '    for (const entry of installed.plugins[key] || []) {',
    "      if (entry && entry.installPath) candidates.push(path.join(entry.installPath, 'skills', 'usage-limits', 'scripts', 'feed.js'));",
    '    }',
    '  }',
    '} catch (err) {}',
    "candidates.push(path.join(configDir, 'skills', 'usage-limits', 'scripts', 'feed.js'));",
    'candidates.push(' + JSON.stringify(recordedFeed) + ');',
    'let feed = null;',
    'for (const file of candidates) {',
    '  try {',
    '    if (fs.statSync(file).isFile()) {',
    '      feed = file;',
    '      break;',
    '    }',
    '  } catch (err) {}',
    '}',
    'if (!feed) process.exit(0);',
    'try {',
    '  Promise.resolve(require(feed).main(process.argv.slice(2))).then(',
    '    (code) => process.exit(code || 0),',
    '    () => process.exit(0)',
    '  );',
    '} catch (err) {',
    '  process.exit(0);',
    '}',
    '',
  ].join('\n');
}

function parseArgs(argv) {
  const args = { command: null, refresh: null, chain: true, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--no-chain') args.chain = false;
    else if (arg === '--refresh') args.refresh = Number(argv[++i]);
    else if (arg.indexOf('--refresh=') === 0) args.refresh = Number(arg.slice('--refresh='.length));
    else if (!args.command) args.command = arg;
  }
  if (!args.command) args.command = 'status';
  return args;
}

function isOurs(statusLine, launcher) {
  return Boolean(
    statusLine &&
      statusLine.type === 'command' &&
      typeof statusLine.command === 'string' &&
      statusLine.command.indexOf(path.basename(launcher)) !== -1
  );
}

// Work out the settings to write without touching disk.
function planOn(settings, state, options) {
  const current = settings || {};
  const opts = options || {};
  const launcher = opts.launcher || launcherFile();
  const existing = current.statusLine === undefined ? null : current.statusLine;
  // What "off" must put back is whatever is in the settings right now that is
  // not ours. A second "on" must not record our own launcher as that thing -
  // but it must not keep an old memory either: a status line the user set
  // between two "on" runs was being overwritten and lost, because the first
  // run's record was trusted over the file in front of us.
  const remembered =
    state && Object.prototype.hasOwnProperty.call(state, 'previous') ? state.previous : null;
  const previous = isOurs(existing, launcher) ? remembered : existing;
  const command = 'node ' + JSON.stringify(launcher);
  const statusLine = { type: 'command', command };
  if (Number.isFinite(opts.refresh) && opts.refresh >= 1) statusLine.refreshInterval = Math.floor(opts.refresh);
  const chain =
    opts.chain !== false &&
    Boolean(previous && previous.type === 'command' && typeof previous.command === 'string' && previous.command);
  const next = Object.assign({}, current, { statusLine });
  const changes = [];
  if (JSON.stringify(existing) !== JSON.stringify(statusLine)) {
    changes.push('statusLine: ' + (existing ? JSON.stringify(existing) : '(unset)') + ' -> ' + JSON.stringify(statusLine));
  }
  return {
    settings: next,
    state: {
      installedAt: new Date().toISOString(),
      previous,
      chain,
      launcher,
      feed: opts.feed || feedFile(),
    },
    changes,
  };
}

function planOff(settings, state) {
  const current = settings || {};
  const next = Object.assign({}, current);
  const previous = state && Object.prototype.hasOwnProperty.call(state, 'previous') ? state.previous : null;
  const changes = [];
  if (previous === null || previous === undefined) {
    if (next.statusLine !== undefined) {
      changes.push('statusLine: removed');
      delete next.statusLine;
    }
  } else {
    changes.push('statusLine: restored');
    next.statusLine = previous;
  }
  return { settings: next, changes };
}

function backupOnce(file) {
  const backup = file + '.usage-limits-backup';
  if (fs.existsSync(file) && !fs.existsSync(backup)) fs.copyFileSync(file, backup);
}

function describeStatus(settings, state) {
  const current = (settings && settings.statusLine) || null;
  const launcher = launcherFile();
  const ours = isOurs(current, launcher);
  const lines = [];
  if (ours) {
    lines.push('status line: on');
    lines.push('  command  ' + current.command);
    if (current.refreshInterval) lines.push('  refresh  every ' + current.refreshInterval + 's');
    if (state && state.chain && state.previous && state.previous.command) {
      lines.push('  chained  ' + state.previous.command);
    } else if (state && state.previous) {
      lines.push('  replaced ' + JSON.stringify(state.previous) + ' (restored by "off")');
    }
  } else if (current) {
    lines.push('status line: another command is set');
    lines.push('  command  ' + (current.command || JSON.stringify(current)));
    lines.push('  "on" keeps it and prints its output above ours; --no-chain replaces it');
  } else {
    lines.push('status line: off');
    lines.push('  "on" installs it; settings.json is edited through a temporary file and backed up once');
  }
  return lines.join('\n');
}

function main(argv) {
  const args = parseArgs(argv || []);
  const file = settingsFile();
  let settings;
  try {
    settings = readJson(file) || {};
  } catch (err) {
    process.stderr.write('statusline: could not read ' + file + ': ' + err.message + '\n');
    return 1;
  }
  const state = readState();

  if (args.command === 'status') {
    process.stdout.write(describeStatus(settings, state) + '\n');
    return 0;
  }

  if (args.command === 'on') {
    if (args.refresh !== null && (!Number.isFinite(args.refresh) || args.refresh < 1)) {
      process.stderr.write('statusline: --refresh takes a whole number of seconds, 1 or more\n');
      return 2;
    }
    const planned = planOn(settings, state, { refresh: args.refresh, chain: args.chain });
    if (args.dryRun) {
      process.stdout.write((planned.changes.length ? planned.changes.join('\n') : 'no change') + '\n');
      return 0;
    }
    backupOnce(file);
    fs.mkdirSync(path.dirname(planned.state.launcher), { recursive: true });
    fs.writeFileSync(planned.state.launcher, launcherSource(planned.state.feed), 'utf8');
    writeJson(file, planned.settings);
    writeJson(stateFile(), planned.state);
    process.stdout.write(
      (planned.changes.length ? planned.changes.join('\n') : 'already on') +
        '\nThe bars appear under the prompt in new Claude Code sessions' +
        (planned.state.chain ? ', above the status line that was already there' : '') +
        '.\n'
    );
    return 0;
  }

  if (args.command === 'off') {
    const planned = planOff(settings, state);
    if (args.dryRun) {
      process.stdout.write((planned.changes.length ? planned.changes.join('\n') : 'no change') + '\n');
      return 0;
    }
    if (planned.changes.length) writeJson(file, planned.settings);
    for (const stale of [stateFile(), launcherFile()]) {
      try {
        fs.unlinkSync(stale);
      } catch (err) {
        // Already gone is the state we want.
      }
    }
    process.stdout.write((planned.changes.length ? planned.changes.join('\n') : 'already off') + '\n');
    return 0;
  }

  process.stderr.write('statusline: unknown command "' + args.command + '". Use status, on or off.\n');
  return 2;
}

module.exports = {
  settingsFile,
  stateFile,
  launcherFile,
  feedFile,
  readState,
  launcherSource,
  parseArgs,
  isOurs,
  planOn,
  planOff,
  describeStatus,
  main,
};

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}
