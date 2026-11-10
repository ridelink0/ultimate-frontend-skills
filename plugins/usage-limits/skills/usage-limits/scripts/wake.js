#!/usr/bin/env node
'use strict';

// The other end of the relay: what the operating system runs a few minutes
// after the window resets.
//
// Nothing here is on a hook's ten-second clock. It runs on its own, in its own
// process, long after the session that armed it has gone, so it can afford to
// check its assumptions before acting - and it has to, because the one thing
// worse than not resuming is resuming into a limit that has not lifted and
// burning the first minutes of a fresh window on a refusal.
//
// The order is deliberate:
//
//   1. Is there still something armed, and is it this one.
//   2. Has the window actually turned over. The reset time is a prediction;
//      the meter is the fact. If it has not, book another wake and stop.
//   3. Is a person sitting at this machine right now. If Computer Use is
//      installed it can answer that, and if the answer is yes the default is
//      to leave a notification rather than start a second agent in the same
//      directory as the one they are typing into.
//   4. Deliver.
//
// Every branch ends with a record on disk, because the next session's first
// job is to say what happened while nobody was watching.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const relay = require('./relay.js');
const net = require('./net.js');
const voice = require('./voice.js');
const host = require('./host.js');

const MINUTE = 60 * 1000;
const RESUME_TIMEOUT_MS = 3 * 60 * 60 * 1000;

function argOf(argv, name) {
  const at = argv.indexOf(name);
  return at === -1 ? null : argv[at + 1] || null;
}

// Settled before anything reads a file. A scheduled task inherits none of the
// session's environment, so the config directory has to be carried in the
// command line or every path below points at the wrong account.
const configDirArg = argOf(process.argv.slice(2), '--config-dir');
if (configDirArg) process.env.CLAUDE_CONFIG_DIR = configDirArg;

// A notification that needs no module installed and no identity registered.
// The WinRT toast looks better and fails silently when the calling process has
// no app identity, which a scheduled task frequently does not; a balloon from
// the in-box Forms assembly has shown up every time.
function toast(title, body) {
  if (process.platform === 'win32') {
    const script = [
      'Add-Type -AssemblyName System.Windows.Forms',
      'Add-Type -AssemblyName System.Drawing',
      '$icon = New-Object System.Windows.Forms.NotifyIcon',
      '$icon.Icon = [System.Drawing.SystemIcons]::Information',
      '$icon.Visible = $true',
      '$icon.ShowBalloonTip(15000, ' + relay.psQuote(title) + ', ' + relay.psQuote(body) + ', [System.Windows.Forms.ToolTipIcon]::Info)',
      'Start-Sleep -Seconds 12',
      '$icon.Dispose()',
    ].join('\n');
    spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 30000,
    });
    return;
  }
  if (process.platform === 'darwin') {
    spawnSync('osascript', ['-e', 'display notification ' + JSON.stringify(body) + ' with title ' + JSON.stringify(title)], {
      encoding: 'utf8',
      timeout: 15000,
    });
    return;
  }
  spawnSync('notify-send', [title, body], { encoding: 'utf8', timeout: 15000 });
}

// Has the window really opened? The endpoint is the only thing that knows, and
// it is worth four seconds to ask rather than trusting arithmetic done an hour
// ago on a reset time that can move.
async function windowReopened(record, now) {
  try {
    if (record.host === host.CODEX) {
      const codex = require('./codex.js');
      await codex.refresh({ now, timeoutMs: 8000 }).catch(() => null);
      const collected = codex.collect(now);
      // Same shape as the Claude side: keyed by window, each { utilization }.
      // Reading a flat "primary" that codex.collect never writes answered
      // "cannot tell" every time and disabled this check under Codex.
      const bucket = collected && collected.utilization ? collected.utilization[record.windowKey || 'five_hour'] : null;
      const value = bucket && typeof bucket.utilization === 'number' ? bucket.utilization : null;
      return { known: value !== null, percent: value };
    }
    const live = require('./live.js');
    const usage = require('./usage.js');
    await live.refresh({ now, accountUuid: usage.accountUuid(), timeoutMs: 8000 }).catch(() => null);
    const collected = usage.collect(now);
    const utilization = collected && collected.utilization;
    if (!utilization) return { known: false, percent: null };
    // The window the relay was armed against, by the key it was armed with.
    // Each entry is { utilization, resets_at, ... }; reading a flattened
    // "five_hour_utilization" off the top gave undefined every time, which read
    // as "cannot tell" and quietly disabled this whole check.
    const bucket = utilization[record.windowKey || 'five_hour'];
    const value = bucket && typeof bucket.utilization === 'number' ? bucket.utilization : null;
    return { known: value !== null, percent: value };
  } catch (err) {
    return { known: false, percent: null, error: err.message };
  }
}

// Is somebody at the keyboard? Computer Use knows, because it tracks physical
// input to stay out of the user's way. Without it, assume nobody is: the relay
// only ever fires after a window that was spent to exhaustion, which is not
// usually a moment somebody is still sitting there.
function userIsPresent(cli) {
  if (!cli) return { known: false, present: false };
  const run = spawnSync(process.execPath, [cli, '--json', 'status'], {
    encoding: 'utf8',
    timeout: 45000,
    windowsHide: true,
    env: Object.assign({}, process.env, { CLI_QUIET: '1', CU_OVERLAY: 'off' }),
  });
  if (run.status !== 0 || !run.stdout) return { known: false, present: false };
  try {
    const parsed = JSON.parse(run.stdout);
    const text = JSON.stringify(parsed);
    // The status report names the user when it has seen them recently. This
    // is a coarse read on purpose: a false "present" costs a notification
    // instead of a resume, which is the safe way round.
    return { known: true, present: /user (?:is )?active|user_active|physical input/i.test(text) };
  } catch (err) {
    return { known: false, present: false };
  }
}

// None of this is restored by --resume: a headless resume starts in the
// permission mode a fresh -p run would, so a session that was running with
// edits accepted comes back asking a person who is not there.
// The prompt is NOT in here. It travels on stdin - see deliverClaude.
//
// It used to be the argument after -p, and on 2026-09-14 a relay booked for
// 09:55 fired on time, three times, and died three times with the one line
// "The command line is too long." The continuation had grown to 7.5 KB and
// Windows caps a command line at 8,191 characters. Every retry hit the same
// wall, because the failure was deterministic, and the work sat on disk until
// somebody came home at 2:52 PM and found nothing done.
//
// claude -p reads the prompt from stdin when none is given as an argument and
// stdin is not a terminal, with a 10 MB cap. A 12 KB prompt was fed through
// that way and answered before this change was made. The prompt parameter is
// kept in the signature so callers and tests do not change shape.
function claudeArgs(record, prompt, config, fallback) {
  // relay fresh on: a new conversation, so no id to resume. The hand-off is
  // still the stdin prompt, whole.
  const args = fallback ? ['--continue', '-p'] : freshFor(config) ? ['-p'] : ['--resume', record.id, '-p'];
  // Nobody is awake to answer a prompt. Deny it rather than stall on it: a
  // resumed run that sits waiting for a keystroke burns its whole timeout and
  // reports nothing.
  args.push('--permission-prompts', 'none');
  if (!fallback && config.model) args.push('--model', config.model);
  return args;
}

// The whole output of a resumed run, kept on disk.
//
// A wake that failed at four in the morning left one line in the note log, and
// the only honest answer to "what happened" was "something". The run log is the
// rest of the story: what the CLI printed, on both streams, for every launch
// this wake attempted. `relay log --run` reads the newest one back.
function appendRun(runs, label, result) {
  if (!runs) return result;
  const code = result && result.status !== null && result.status !== undefined ? result.status : 'null';
  runs.push(
    '--- ' + label + ' (exit ' + code + ') ---' + '\n' +
    ((result && result.stdout) || '') +
    ((result && result.stderr) ? '\n' + '--- stderr ---' + '\n' + result.stderr : '')
  );
  return result;
}

// Invisible is tidier, and it is also how somebody finds out in the morning
// that nothing happened and has no way to tell why. `relay show off` restores
// the old behaviour for anyone who wants their screen left alone.
function spawnOptionsFor(record, config, cli) {
  return {
    encoding: 'utf8',
    cwd: record.cwd,
    timeout: RESUME_TIMEOUT_MS,
    // Always. The seen run is the interactive window (deliverVisible); this
    // headless one shared the wake's console once and died with it.
    windowsHide: true,
    shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(cli),
    // The visible launcher sets this in its own script; the headless run
    // inherited the wake's environment and could start an update at launch,
    // with nobody there to watch it. Only when nothing has set it already.
    env: Object.assign({}, process.env, process.env.DISABLE_AUTOUPDATER === undefined ? { DISABLE_AUTOUPDATER: '1' } : {}),
  };
}

// The window that says "Claude" and nothing else.
//
// On 2026-09-14 the 8:05 PM relay fired, resumed the session and worked - in
// a console window that showed only its title. `claude -p` prints its result
// when it has finished and nothing before, the wake was capturing both
// streams for the run log anyway, and a headless run does not register with
// Remote Control, so the phone showed nothing either. The user's words: "just
// a blank terminal screen that says Claude".
//
// So when the run is meant to be seen (relay show, the default) it is a real
// interactive session in its own window: resumed by id, model and permission
// mode set, Remote Control on under a name that says what it is, and the
// first prompt given as a short argument that points at the hand-off on
// disk. The hand-off itself cannot ride on argv (8,191 characters) and an
// interactive session's stdin is its keyboard, so the file is the one
// channel that fits every length. The session reads it with one tool call
// and carries on, and from then on it is a session like any other: on
// screen, on claude.ai/code, and typed into.
//
// The launcher is a .cmd file rather than a command line, so the only
// quoting rules that have to hold are cmd's own, applied to text this code
// wrote. `call` matters: claude.cmd is itself a batch file, and a batch file
// run without call never returns to the lines below it - the exit code
// would never be written and a failure would close the window unread.
const LAUNCH_GRACE_MS = 20000;

// relay fresh: a new conversation instead of `claude --resume`.
//
// Resuming carries the whole conversation into the next window, and a long
// session is exactly the one that runs out. With fresh on, the wake starts
// `claude` in the project with the hand-off itself as the first prompt -
// inline, so the new session has all of it without a tool call - Remote
// Control on under a name that says it is a new session, and the relay's
// permission mode and model. The ONE TERMINAL rule is the same: an old
// session that is open and working again makes the wake stand down.
function freshFor(config) {
  return Boolean(config && config.fresh);
}

// One argument has to hold the hand-off. Linux refuses a single argument past
// 128 KiB - bytes, not characters, so an accented letter or a dash costs two
// or three (70,000 two-byte characters measured E2BIG here); Windows caps a
// whole command line at 32,767 UTF-16 characters, and there each double quote
// and backslash can cost one more when it is quoted.
const FRESH_ARG_MAX = { win32: 30000, posix: 120000 };

function argCost(text, platform) {
  return platform === 'win32' ? text.length + (text.match(/["\\]/g) || []).length : Buffer.byteLength(text, 'utf8');
}

function isShim(cli) {
  return /\.(cmd|bat)$/i.test(String(cli || ''));
}

function freshName(record) {
  return 'usage-limits relay ' + (record.project || path.basename(record.cwd)) + ' (new session)';
}

// When the hand-off cannot ride inline, the first prompt points at the file
// holding it, the way the resume does. Short and free of quotes, for cmd.
function freshPointerPrompt(file) {
  return (
    'This is a new session taking over work that the usage-limits plugin handed on from an earlier one, not a new request. ' +
    'Everything it left is in the file ' + file + ' - read it with the Read tool now and carry on from it at full quality, ' +
    'without re-asking what to do.'
  );
}

function freshArgs(record, config, first) {
  const args = [];
  if (record.launchCwd) args.push('--add-dir', record.cwd);
  if (config && config.model) args.push('--model', config.model);
  args.push('--remote-control', freshName(record));
  args.push(first);
  return args;
}

// The new session's command line: the hand-off inline when one argument can
// carry it, and the pointer when it cannot - a batch shim on Windows (cmd.exe
// ends a command at the first line break) or a hand-off too long for argv.
function freshLaunch(record, config, cli, prompt, promptFile, platform) {
  const text = String(prompt == null ? '' : prompt);
  const limit = platform === 'win32' ? FRESH_ARG_MAX.win32 : FRESH_ARG_MAX.posix;
  let why = null;
  if (platform === 'win32' && isShim(cli)) {
    why = cli + ' is a batch shim and cmd.exe ends a command at the first line break';
  } else if (argCost(text, platform) > limit) {
    why = 'the hand-off is ' + argCost(text, platform) + (platform === 'win32' ? ' characters' : ' bytes') +
      ', more than one argument holds here (' + limit + ')';
  }
  return { cli, args: freshArgs(record, config, why ? freshPointerPrompt(promptFile) : text), inline: !why, why };
}

// On Windows the launcher is a .cmd, and cmd cannot carry a line break in an
// argument, so an inline hand-off goes through node instead: the launcher
// calls this script with --exec-spec, and it starts claude with the arguments
// from the spec as an array, which Node quotes for CreateProcess. Ctrl+C is
// claude's to handle; this process only waits and passes the exit code on.
// UNVERIFIED on a real Windows console: written from Node's documented spawn
// behaviour, with the argument passing itself under test.
function specFile(id) {
  return path.join(relay.configDir(), 'relay-wake-' + String(id) + '.spec.json');
}

function execSpec(file, io) {
  const ops = Object.assign({ spawn, exit: (code) => process.exit(code), onSigint: (fn) => process.on('SIGINT', fn) }, io || null);
  let spec;
  try {
    spec = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    process.stderr.write('[usage-limits relay] could not read ' + file + ': ' + err.message + '\n');
    ops.exit(1);
    return null;
  }
  ops.onSigint(() => {});
  const child = ops.spawn(spec.cli, spec.args, { stdio: 'inherit' });
  child.on('error', (err) => {
    process.stderr.write('[usage-limits relay] could not start ' + spec.cli + ': ' + err.message + '\n');
    ops.exit(1);
  });
  child.on('exit', (code) => ops.exit(code === null ? 1 : code));
  return child;
}

function bridgeCommand(file) {
  return cmdArg(process.execPath) + ' ' + cmdArg(path.join(__dirname, 'wake.js')) + ' ' + cmdArg('--exec-spec') + ' ' + cmdArg(file);
}

function wakePromptFile(id) {
  return path.join(relay.configDir(), 'relay-wake-' + id + '.md');
}

function launcherFile(id, platform) {
  return path.join(relay.configDir(), 'relay-wake-' + id + ((platform || process.platform) === 'win32' ? '.cmd' : '.sh'));
}

function exitFile(id) {
  return path.join(relay.configDir(), 'relay-wake-' + id + '.exit');
}

// Short, plain, and free of quotes: it goes through cmd and then argv.
function pointerPrompt(file) {
  return (
    'The usage window has reset and this is the plugin picking the work back up, not a new request. ' +
    'The full hand-off is in the file ' + file + ' - read it with the Read tool now and carry on from it ' +
    'at full quality, without re-asking what to do. If the working directory is not the project folder, ' +
    'it was resumed from a trusted folder on purpose: use absolute paths.'
  );
}

// Doubled percent signs are the one escape cmd needs inside double quotes;
// a double quote itself has no escape there, so it is dropped.
function cmdArg(text) {
  return '"' + String(text).replace(/%/g, '%%').replace(/"/g, '') + '"';
}

function visibleArgs(record, config, promptFile) {
  const args = ['--resume', record.id];
  if (record.launchCwd) args.push('--add-dir', record.cwd);
  if (config && config.model) args.push('--model', config.model);
  args.push('--remote-control', 'usage-limits relay ' + (record.project || path.basename(record.cwd)));
  args.push(pointerPrompt(promptFile));
  return args;
}

// `command`, when given, is what follows `call`: the fresh launch's own line.
function launcherScript(record, config, cli, promptFile, exitPath, command) {
  const name = String(record.project || path.basename(record.cwd)).replace(/[&|<>^%"]/g, '');
  return [
    '@echo off',
    'title Claude relay - ' + name,
    'cd /d ' + cmdArg(record.launchCwd || record.cwd),
    'set DISABLE_AUTOUPDATER=1',
    // Seen live on 2026-09-14: launched from inside a session, the window
    // inherited that session's markers - transcript saving was off (the
    // child-session marker) and the hooks took it for the parent (its id).
    // The resumed session is nobody's child, whoever opened the window.
    'set CLAUDE_CODE_CHILD_SESSION=',
    'set CLAUDE_CODE_SESSION_ID=',
    'call ' + (command || cmdArg(cli) + ' ' + visibleArgs(record, config, promptFile).map(cmdArg).join(' ')),
    'set CODE=%ERRORLEVEL%',
    '> ' + cmdArg(exitPath) + ' echo %CODE%',
    'if not "%CODE%"=="0" (',
    '  echo.',
    '  echo [usage-limits relay] claude exited with code %CODE%. The window stays open so the message above can be read; the plan is still on disk.',
    '  pause >nul',
    ')',
    '',
  ].join('\r\n');
}

// `claude --resume` finds a session by its transcript, one folder per project
// under the config dir. Checking first means a session that is gone gets the
// same permanent answer the headless path gives, without opening a window
// whose only content would be the error.
function transcriptExists(id) {
  const root = path.join(relay.configDir(), 'projects');
  try {
    for (const dir of fs.readdirSync(root)) {
      if (fs.existsSync(path.join(root, dir, id + '.jsonl'))) return true;
    }
  } catch (err) {
    // No projects folder at all.
  }
  return false;
}

function transcriptFile(id) {
  const root = path.join(relay.configDir(), 'projects');
  try {
    for (const dir of fs.readdirSync(root)) {
      const file = path.join(root, dir, id + '.jsonl');
      if (fs.existsSync(file)) return file;
    }
  } catch (err) {
    // No projects folder at all.
  }
  return null;
}

// ONE TERMINAL.
//
// The session a relay was armed for is often still open. Claude Code's own
// autoContinueAtUsageLimit (on by default) carries an open session across the
// reset in place, and a wake that opened `claude --resume` beside it put two
// terminals on the screen running the same conversation - the same work
// started twice and the weekly spent twice. Gev, 2026-09-27: "fix it to where
// it makes 1 terminal and not 2".
//
// Claude Code keeps one file per running process in <config>/sessions,
// named for the pid: { pid, sessionId, procStart, kind, cwd, ... }. procStart
// is the process creation time (a Windows FILETIME, read against
// Get-Process on 2026-09-27: 134350239768728478 on both sides), which is what
// tells a live session from a dead one whose pid Windows has handed to
// something else. A file whose process is gone is left where it is: it is
// Claude Code's, not the relay's.
function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

function processStart(pid) {
  if (process.platform !== 'win32') return null;
  const shell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const run = spawnSync(shell, ['-NoProfile', '-NonInteractive', '-Command', '(Get-Process -Id ' + Number(pid) + ' -ErrorAction Stop).StartTime.ToFileTimeUtc()'], {
    encoding: 'utf8',
    timeout: 30000,
    windowsHide: true,
  });
  const said = String(run.stdout || '').trim();
  return run.status === 0 && /^\d+$/.test(said) ? said : null;
}

function liveSession(id, io) {
  const ops = Object.assign({ alive: pidAlive, started: processStart }, io || null);
  const dir = path.join(relay.configDir(), 'sessions');
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch (err) {
    return null;
  }
  for (const name of names) {
    if (!/^\d+\.json$/.test(name)) continue;
    let held;
    try {
      held = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
    } catch (err) {
      continue;
    }
    if (!held || held.sessionId !== id) continue;
    const pid = Number(held.pid);
    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) continue;
    if (!ops.alive(pid)) continue;
    // A start time that can be read and does not match is a recycled pid.
    // One that cannot be read (not Windows, or the query failed) leaves the
    // pid's word as the answer.
    if (held.procStart) {
      const started = ops.started(pid);
      if (started !== null && String(started) !== String(held.procStart)) continue;
    }
    return { pid, kind: held.kind || null, cwd: held.cwd || null };
  }
  return null;
}

// Written to since `since`: the open session is working again, which is what
// the CLI's own continue looks like from outside.
function transcriptActiveSince(id, since) {
  const file = transcriptFile(id);
  if (!file) return false;
  try {
    return fs.statSync(file).mtimeMs >= since;
  } catch (err) {
    return false;
  }
}

// How long a wake that finds the session open but quiet waits for it to start
// working by itself before opening the one window it would have opened anyway.
const LIVE_WAIT_MS = 3 * MINUTE;
const LIVE_POLL_MS = 15 * 1000;

function readExit(file) {
  try {
    const code = parseInt(fs.readFileSync(file, 'utf8').trim(), 10);
    return Number.isFinite(code) ? code : null;
  } catch (err) {
    return null;
  }
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// `start` returns as soon as the window exists; the launcher runs on in it.
// Pre-quoted arguments go through verbatim, because Node's own quoting is
// for programs that parse like C, and cmd does not.
function openWindow(launcher, exitPath, record) {
  const run = spawnSync('cmd.exe', ['/d', '/c', 'start', '"Claude relay"', '/D', cmdArg(record.launchCwd || record.cwd), cmdArg(launcher)], {
    encoding: 'utf8',
    timeout: 30000,
    windowsHide: true,
    windowsVerbatimArguments: true,
  });
  if (run.status !== 0) throw new Error(((run.stderr || run.stdout || '') + '').trim().split('\n')[0] || 'start exited ' + run.status);
}

// The same window on macOS and Linux. UNVERIFIED on a real Mac or Linux box:
// written from the documented behaviour of osascript and the common terminal
// emulators, with the launcher script itself under test. The shell quoting
// is the POSIX one: close the quote, escape one, reopen.
const Q = String.fromCharCode(39);
function shQuote(text) {
  return Q + String(text).split(Q).join(Q + String.fromCharCode(92) + Q + Q) + Q;
}

// `args`, when given, replaces the resume's: the fresh launch's own.
function launcherScriptPosix(record, config, cli, promptFile, exitPath, args) {
  return [
    '#!/bin/sh',
    // The folder the start-up questions were answered for, as on Windows: for
    // a project in the home folder that is the trusted launch folder, with
    // --add-dir back to the project. Started in the home folder itself, the
    // window sat at the trust question the preflight never answered.
    'cd ' + shQuote(record.launchCwd || record.cwd) + ' || exit 1',
    'unset CLAUDE_CODE_CHILD_SESSION CLAUDE_CODE_SESSION_ID',
    shQuote(cli) + ' ' + (args || visibleArgs(record, config, promptFile)).map(shQuote).join(' '),
    'code=$?',
    'echo "$code" > ' + shQuote(exitPath),
    'if [ "$code" -ne 0 ]; then',
    '  echo',
    '  echo "[usage-limits relay] claude exited with code $code. This window stays open so the message above can be read; the plan is still on disk."',
    '  read -r _',
    'fi',
    '',
  ].join(String.fromCharCode(10));
}

function hasCommand(name) {
  const run = spawnSync('sh', ['-c', 'command -v ' + shQuote(name)], { encoding: 'utf8', timeout: 10000 });
  return run.status === 0;
}

function openWindowPosix(launcher) {
  fs.chmodSync(launcher, 0o755);
  if (process.platform === 'darwin') {
    const run = spawnSync('osascript', ['-e', 'tell application "Terminal" to do script ' + JSON.stringify('sh ' + shQuote(launcher))], { encoding: 'utf8', timeout: 30000 });
    if (run.status !== 0) throw new Error(((run.stderr || run.stdout || '') + '').trim().split(String.fromCharCode(10))[0] || 'osascript exited ' + run.status);
    return;
  }
  if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) throw new Error('no DISPLAY or WAYLAND_DISPLAY: not a graphical session');
  const terminals = [
    ['x-terminal-emulator', ['-e', 'sh', launcher]],
    ['gnome-terminal', ['--', 'sh', launcher]],
    ['konsole', ['-e', 'sh', launcher]],
    ['xterm', ['-e', 'sh', launcher]],
  ];
  for (const [bin, args] of terminals) {
    if (!hasCommand(bin)) continue;
    const child = spawn(bin, args, { detached: true, stdio: 'ignore' });
    child.unref();
    return;
  }
  throw new Error('no terminal emulator found (tried x-terminal-emulator, gnome-terminal, konsole, xterm)');
}

// `io` exists so the window path can be tested without a window: open, sleep
// and now are the three things it does to the world. `platform` picks the
// launcher, and `nativeCli` is where a fresh launch on Windows looks for
// claude.exe when the CLI it was given is a batch shim.
function deliverVisible(record, prompt, config, cli, runs, io) {
  const platform = (io && io.platform) || process.platform;
  const ops = Object.assign({
    open: platform === 'win32' ? openWindow : openWindowPosix,
    sleep: sleepMs,
    now: Date.now,
    nativeCli: () => relay.cloudCli(process.env, 'win32'),
  }, io || null);
  const fresh = freshFor(config);
  // A new session needs no transcript; only a resume does.
  if (!fresh && !transcriptExists(record.id)) {
    return {
      ok: false,
      permanent: true,
      error:
        'the session ' + String(record.id).slice(0, 8) + ' no longer exists, so there was nothing to resume. ' +
        'The plan is still on disk: run "claude" in ' + record.cwd + ' and paste it in.',
    };
  }
  const label = fresh ? 'claude, a new session (window)' : 'claude --resume (window)';
  const promptFile = wakePromptFile(record.id);
  const launcher = launcherFile(record.id, platform);
  const exitPath = exitFile(record.id);
  let launch = null;
  if (fresh) {
    let use = cli;
    if (platform === 'win32' && isShim(cli)) {
      let native = null;
      try {
        native = ops.nativeCli();
      } catch (err) {
        native = null;
      }
      if (native && !isShim(native)) use = native;
    }
    launch = freshLaunch(record, config, use, prompt, promptFile, platform);
  }
  try {
    fs.mkdirSync(relay.configDir(), { recursive: true });
    fs.writeFileSync(promptFile, String(prompt == null ? '' : prompt) + '\n');
    let script;
    if (platform === 'win32') {
      let command = null;
      if (launch && launch.inline) {
        const spec = specFile(record.id);
        fs.writeFileSync(spec, JSON.stringify({ cli: launch.cli, args: launch.args }));
        command = bridgeCommand(spec);
      } else if (launch) {
        command = cmdArg(launch.cli) + ' ' + launch.args.map(cmdArg).join(' ');
      }
      script = launcherScript(record, config, cli, promptFile, exitPath, command);
    } else {
      script = launch
        ? launcherScriptPosix(record, config, launch.cli, promptFile, exitPath, launch.args)
        : launcherScriptPosix(record, config, cli, promptFile, exitPath);
    }
    fs.writeFileSync(launcher, script);
    try {
      fs.unlinkSync(exitPath);
    } catch (err) {
      // None left from last time.
    }
  } catch (err) {
    return { ok: false, error: 'could not write the launcher: ' + err.message };
  }
  if (launch && !launch.inline) {
    relay.note('wake ' + record.id + ': the hand-off is not inline (' + launch.why + '); the first prompt points at ' + promptFile);
  }
  try {
    ops.open(launcher, exitPath, record);
  } catch (err) {
    appendRun(runs, label, { status: 1, stdout: '', stderr: err.message });
    return { ok: false, openFailed: true, error: 'could not open a window: ' + err.message };
  }
  const started = ops.now();
  while (ops.now() - started < LAUNCH_GRACE_MS) {
    ops.sleep(1000);
    const code = readExit(exitPath);
    if (code !== null) {
      const after = Math.round((ops.now() - started) / 1000);
      appendRun(runs, label, {
        status: code,
        stdout: '',
        stderr: 'exited within ' + after + 's; its output is in the window, which stays open when the exit is not 0',
      });
      if (code === 0) return { ok: true, how: fresh ? 'a new claude session in a window' : 'claude --resume in a window' };
      return { ok: false, error: 'claude exited ' + code + ' in the window it opened (left open so the message can be read)' };
    }
  }
  appendRun(runs, label, {
    status: 0,
    stdout:
      'still running after ' + Math.round(LAUNCH_GRACE_MS / 1000) + 's: an interactive session in its own window, Remote Control on' +
      (fresh ? ' as "' + freshName(record) + '", the hand-off ' + (launch.inline ? 'inline as its first prompt' : 'in ' + promptFile + ' (' + launch.why + ')') : '') +
      '. Its output is on screen and in the session transcript, not in this log.',
    stderr: '',
  });
  return { ok: true, how: fresh ? 'a new claude session in a window, Remote Control on' : 'claude --resume in a window, Remote Control on' };
}
function deliverClaude(record, prompt, config, cli, runs, io) {
  // Seen by default. relay show off keeps the headless run, and so does a
  // machine where no window could be opened (no terminal emulator found).
  if (config && config.show !== false) {
    const visible = deliverVisible(record, prompt, config, cli, runs, io);
    if (!visible.openFailed) return visible;
  }
  const args = claudeArgs(record, prompt, config, false);
  const fresh = freshFor(config);
  const label = fresh ? 'claude -p, a new session' : 'claude --resume';
  // stdin, never argv. See claudeArgs for the 7.5 KB note that proved why.
  const options = Object.assign(spawnOptionsFor(record, config, cli), { input: String(prompt == null ? '' : prompt) });
  const run = appendRun(runs, label, ((io && io.spawnSync) || spawnSync)(cli, args, options));
  if (run.status === 0) return { ok: true, how: label };
  const detail = ((run.stderr || run.stdout || '') + '').trim().split('\n')[0];
  if (fresh) return { ok: false, error: detail || 'claude exited ' + run.status };
  // A session id that no longer resolves used to fall back to `--continue`,
  // on the reasoning that the work still needs doing and only the thread is
  // gone. That fallback is removed, because of what `--continue` actually
  // selects.
  //
  // `--continue` normally SKIPS sessions created by `claude -p`, the SDK and
  // /loop - but `claude -p --continue`, which is exactly what this ran,
  // INCLUDES them. So the most recent session it could land on is a previous
  // relay's own headless run, not the user's work. Resuming that, unattended,
  // at four in the morning, with permissionMode bypassPermissions, means an
  // agent continuing a conversation nobody chose, in a directory it was not
  // asked about.
  //
  // The plan is on disk either way. A wake that stops and says the thread is
  // gone loses nothing; a wake that resumes the wrong conversation can.
  if (/No conversation found/i.test(detail)) {
    return {
      ok: false,
      error:
        'the session ' + String(record.id).slice(0, 8) + ' no longer exists, so there was nothing to resume. ' +
        'The plan is still on disk: run "claude" in ' + record.cwd + ' and paste it in.',
      permanent: true,
    };
  }
  return { ok: false, error: detail || 'claude exited ' + run.status };
}

function deliverCodex(record, prompt, cli, runs) {
  // Codex keeps interactive sessions on a local app server, and queue is the
  // supported way to put a message into one from outside. If the thread is
  // gone, exec resume does the same work in a fresh process.
  // Same wall as the Claude path: Windows caps a command line at 8,191
  // characters and a continuation can be longer than that. `queue --message`
  // has no stdin form, so past the safe length it is skipped rather than
  // attempted - a call that is known to fail is not worth the time it takes to
  // fail. `exec` reads its prompt from stdin when none is given, so that path
  // carries the long ones. UNVERIFIED against a live Codex: this is the Claude
  // fix applied by analogy to the documented exec behaviour, not a measured
  // run, because measuring it would spend the user's ChatGPT quota.
  const text = String(prompt == null ? '' : prompt);
  const fitsArgv = text.length <= 6000;
  const queued = fitsArgv
    ? spawnSync(cli, ['queue', '--thread', record.id, '--message', text], {
        encoding: 'utf8',
        cwd: record.cwd,
        timeout: 60000,
        windowsHide: true,
      })
    : { status: 1, stdout: '', stderr: 'continuation is ' + text.length + ' chars, too long for argv; going straight to exec' };
  appendRun(runs, 'codex queue', queued);
  if (queued.status === 0) return { ok: true, how: 'codex queue' };
  const run = spawnSync(cli, ['exec', 'resume', record.id, '--skip-git-repo-check'], {
    encoding: 'utf8',
    input: text,
    cwd: record.cwd,
    timeout: RESUME_TIMEOUT_MS,
    windowsHide: true,
  });
  appendRun(runs, 'codex exec resume', run);
  if (run.status === 0) return { ok: true, how: 'codex exec resume' };
  return { ok: false, error: ((run.stderr || run.stdout || '') + '').trim().split('\n')[0] || 'codex exited ' + run.status };
}

function finish(state, record, outcome, detail, now) {
  state.history.push(
    Object.assign({}, record, { endedAt: now, outcome, detail: detail || null })
  );
  state.history = state.history.slice(-10);
  if (outcome === 'resumed') {
    try {
      fs.unlinkSync(relay.planFile(record.id));
    } catch (err) {
      // No note, or already gone.
    }
  }
  relay.dropRecord(state, record.id);
  relay.write(state);
  relay.note('wake ' + record.id + ': ' + outcome + (detail ? ' - ' + detail : ''), now);
  // Last, deliberately: this deletes the task this process is running under,
  // so everything that had to be recorded is already on disk before it runs.
  if (record.task) {
    try {
      relay.cancelSchedule(record.task);
    } catch (err) {
      // The expiry set at registration removes it either way.
    }
  }
}

// `overrides` exists so the retry path can be tested without spawning a CLI or
// registering a real scheduled task. Production passes nothing and gets the
// real functions; only the names listed here can be swapped.
// The record this wake owns, wherever the state keeps it.
function mine(held, record) {
  return relay.armedFor(held, record.id);
}

async function run(now, argv, overrides) {
  // `reachable` belongs in here with the rest. Left out, the preflight below
  // called the real network on every run of the retry tests, so the whole
  // launch-failure suite passed only on a machine that could reach
  // api.anthropic.com - and went red, in the offline branch, on a laptop with
  // its wifi off or behind a TLS-inspecting proxy. That is the exact condition
  // the relay is built for, so it is the last thing its tests should need.
  const deps = Object.assign(
    {
      windowReopened, deliverClaude, deliverCodex, toast, userIsPresent,
      arm: relay.arm, capabilities: relay.capabilities, reachable: net.reachable,
      liveSession, transcriptActiveSince, sleep: sleepMs, now: Date.now,
    },
    overrides || null
  );
  const id = argOf(argv, '--id');
  const state = relay.read();
  const record = id ? relay.armedFor(state, id) : state.armed;
  if (!record) return { outcome: relay.records(state).length ? 'superseded' : 'nothing-armed' };
  // Marked before anything else, so a wake that dies part-way (the 8:05 PM
  // one was killed with its console) is told apart from one that never ran.
  record.wokeAt = now;
  relay.write(state);

  const config = relay.settings(state);
  const capabilities = deps.capabilities();

  const reopened = await deps.windowReopened(record, now);
  // Only reschedule on a reading that says the window is still full. An
  // unreadable meter is not evidence of a limit, and refusing to act on it
  // would turn every offline moment into a cancelled relay.
  if (reopened.known && Number.isFinite(reopened.percent) && reopened.percent >= config.at) {
    const attempt = (record.attempt || 0) + 1;
    if (attempt >= config.attempts) {
      deps.toast('Usage limits', 'The window still reads ' + Math.round(reopened.percent) + ' per cent after ' + attempt + ' checks. The plan is saved; pick it up when you are ready.');
      finish(state, record, 'gave-up', 'window still at ' + Math.round(reopened.percent) + '%', now);
      return { outcome: 'gave-up' };
    }
    const again = deps.arm({
      now,
      sessionId: record.id,
      cwd: record.cwd,
      hostName: record.host,
      resetsAt: now + config.graceMinutes * MINUTE,
      binding: { percentUsed: reopened.percent, resetsAt: now + config.graceMinutes * MINUTE },
      work: Object.assign({ hasWork: true, pending: 1, source: null, todos: [] }, record.work || {}),
      config,
    });
    if (again.ok) {
      const held = relay.read();
      mine(held, record).attempt = attempt;
      mine(held, record).continuation = record.continuation;
      relay.write(held);
    }
    relay.note('wake ' + record.id + ': window still at ' + Math.round(reopened.percent) + '%, retry ' + attempt, now);
    return { outcome: 'rescheduled', attempt };
  }

  // ONE TERMINAL (see liveSession). An open session that is working again -
  // written to since the window reset - has been carried across by the CLI,
  // and a second window would run the same work twice, so the wake stands
  // down. One that is open but quiet gets LIVE_WAIT_MS to start by itself
  // (the CLI's continue, or the session's own timer); if it is closed in that
  // time, or stays quiet, the wake opens its one window, because nothing
  // outside a session can type into it and the plan still has to run.
  if (record.host !== host.CODEX) {
    const since = Number.isFinite(record.wakeAt) ? record.wakeAt - (config.graceMinutes || 0) * MINUTE : now - 5 * MINUTE;
    const started = deps.now();
    let open = deps.liveSession(record.id);
    while (open) {
      if (deps.transcriptActiveSince(record.id, since)) {
        // Carried across in place by the CLI's own continue. Nothing needs
        // anybody, so nothing is said: the history and the log hold it.
        finish(state, record, 'live', 'the session is open in process ' + open.pid + ' and working again; no second window', now);
        return { outcome: 'live', pid: open.pid };
      }
      if (deps.now() - started >= LIVE_WAIT_MS) break;
      deps.sleep(LIVE_POLL_MS);
      open = deps.liveSession(record.id);
    }
    // Still open and still quiet. A second `claude --resume` beside it is two
    // terminals on one conversation, and if the CLI's own continue fires late
    // the same work starts twice (R8, 2026-11-09). The relay wakes CLOSED
    // sessions only; an open one is the person's, so it gets one note.
    if (open) {
      deps.toast(
        'Usage limits: the window has reset',
        (record.project || path.basename(record.cwd)) + ' is still open in its own terminal but has not carried on. Continue it there; no second window was opened.'
      );
      finish(state, record, 'open', 'the session is open in process ' + open.pid + ' but idle since the reset; no second window', now);
      return { outcome: 'open', pid: open.pid };
    }
  }

  // THE PREFLIGHT.
  //
  // The retry above is the right shape but the wrong budget for the failure it
  // was written for. A relay woke at 04:25:01 and said "SSL certificate
  // hostname mismatch" 1.5 seconds later - a laptop whose wifi is off, with
  // something answering the handshake in the endpoint's place. Three retries
  // five minutes apart cover fifteen minutes. A router that is off overnight is
  // off for hours, and at the end of those fifteen minutes the relay was spent.
  //
  // So: ask first, before spending a launch on it, and give being offline its
  // own much longer budget. A machine that cannot reach the API has not failed.
  // It is waiting, and waiting is free.
  const link = await deps.reachable({ timeoutMs: 8000 });
  if (!link.online) {
    const offlineAttempt = (record.offlineAttempt || 0) + 1;
    if (offlineAttempt <= config.offlineAttempts) {
      const wait = net.backoffMinutes(offlineAttempt - 1, config.offlineRetryMinutes);
      const again = deps.arm({
        now,
        sessionId: record.id,
        cwd: record.cwd,
        hostName: record.host,
        project: record.project,
        resetsAt: now + wait * MINUTE,
        binding: { percentUsed: reopened.known ? reopened.percent : record.percentAtArming, resetsAt: now + wait * MINUTE },
        work: Object.assign({ hasWork: true, pending: 1, source: null, todos: [] }, record.work || {}),
        // graceMinutes is already inside `wait`; adding it again would compound
        // the backoff every round until the retries were hours apart.
        config: Object.assign({}, config, { graceMinutes: 0, armOn: 'threshold' }),
      });
      if (again.ok) {
        const held = relay.read();
        if (mine(held, record)) {
          mine(held, record).offlineAttempt = offlineAttempt;
          mine(held, record).attempt = record.attempt || 0;
          mine(held, record).continuation = record.continuation;
          relay.write(held);
        }
        // Said once, on the first miss, then quiet. Twelve toasts through the
        // night is how a useful notification becomes something to turn off.
        if (offlineAttempt === 1) {
          deps.toast(
            'Usage limits: waiting for the network',
            link.reason === 'intercepted'
              ? 'The window reset, but something is answering in the API\'s place - a captive portal, a VPN or a proxy. Holding the plan and retrying.'
              : 'The window reset, but this machine has no route to the API. Holding the plan and retrying.'
          );
        }
        relay.note('wake ' + record.id + ': offline (' + link.reason + '), retry ' + offlineAttempt + ' in ' + wait + 'm', now);
        return { outcome: 'offline', reason: link.reason, attempt: offlineAttempt, retryInMinutes: wait };
      }
      relay.note('wake ' + record.id + ': offline and could not book a retry: ' + again.error, now);
    }
    deps.toast('Usage limits: still offline',
      'No route to the API after ' + (record.offlineAttempt || 0) + ' tries. The plan is saved: claude --resume ' + record.id.slice(0, 8));
    finish(state, record, 'offline', link.reason + ' - ' + link.detail, now);
    return { outcome: 'offline-gave-up', detail: link.detail };
  }

  const continuation = relay.readContinuation(record.id);
  // relay fresh: the new session has none of the conversation, so its prompt
  // opens by saying so. A Codex wake resumes its thread either way.
  const fresh = record.host !== host.CODEX && freshFor(config);
  const prompt = relay.compose({
    fresh,
    deferred: record.deferred === true,
    projectDir: record.launchCwd ? record.cwd : null,
    continuation,
    work: record.work && record.work.todos ? record.work : null,
    thinking: config.thinking !== 'off',
    voice: config.voice === false ? null : voice.card(),
    bugcheck: config.bugcheck,
  });

  let mode = config.mode;
  const presence = deps.userIsPresent(config.mode === 'resume' ? capabilities.computerUse : null);
  if (mode === 'resume' && presence.known && presence.present && config.whenBusy === 'notify') {
    mode = 'notify';
    relay.note('wake ' + record.id + ': someone is at the machine, leaving a note instead', now);
  }

  if (mode === 'notify') {
    // A new session has none of the conversation, so what it needs is the
    // whole hand-off, not the continuation alone: written where the window
    // path writes it, and named in the note.
    let handoffFile = null;
    if (fresh) {
      try {
        fs.mkdirSync(relay.configDir(), { recursive: true });
        fs.writeFileSync(wakePromptFile(record.id), prompt + '\n');
        handoffFile = wakePromptFile(record.id);
      } catch (err) {
        handoffFile = null;
      }
    }
    deps.toast(
      'Usage limits: the window has reset',
      'The plan for ' + (record.project || path.basename(record.cwd)) + ' is ready to pick up. ' +
        (fresh
          ? 'Start claude in ' + record.cwd + ' and give it the hand-off in ' + (handoffFile || relay.planFile(record.id))
          : 'Run: claude --resume ' + record.id.slice(0, 8))
    );
    finish(state, record, 'notified', presence.present ? 'user present' : null, now);
    return { outcome: 'notified' };
  }

  const cli = record.host === host.CODEX ? capabilities.codex : capabilities.claude;
  if (!cli) {
    deps.toast('Usage limits', 'The window has reset but the ' + record.host + ' CLI could not be found, so the plan was left on disk.');
    finish(state, record, 'no-cli', null, now);
    return { outcome: 'no-cli' };
  }

  deps.toast(
    fresh ? 'Usage limits: handing over' : 'Usage limits: resuming',
    fresh
      ? 'Starting a new session for ' + (record.project || path.basename(record.cwd)) + ' with the saved plan.'
      : 'Carrying on with ' + (record.project || path.basename(record.cwd)) + ' where the limit stopped it.'
  );
  const runs = [];
  // Startup trust stays with the user; the relay never writes its answers.
  if (record.host !== 'codex') {

    if (record.launchCwd) {
      try {
        fs.mkdirSync(record.launchCwd, { recursive: true });
      } catch (err) {
      }
    }
    const pre = relay.preflightPrompts(record.launchCwd || record.cwd, config);
    if (pre.ok && pre.pending.length) relay.note('wake ' + record.id + ': user approval required: ' + pre.pending.join(', '), now);
    else if (!pre.ok) relay.note('wake ' + record.id + ': could not inspect the start-up questions: ' + pre.error, now);
  }

  const delivered = record.host === host.CODEX
    ? deps.deliverCodex(record, prompt, cli, runs)
    : deps.deliverClaude(record, prompt, config, cli, runs);
  const logPath = config.runLog === false ? null : relay.writeRunLog(relay.runLogFile(record.id, now), runs.join('\n' + '\n'));
  if (delivered.ok) {
    deps.toast('Usage limits: done', fresh
      ? 'A new session has the plan (' + delivered.how + '). Open it to read along.'
      : 'The resumed run finished. Open the session to read it.');
    finish(state, record, 'resumed', delivered.how + (logPath ? ' - log at ' + logPath : ''), now);
    return { outcome: 'resumed', how: delivered.how, log: logPath };
  }
  // A launch that failed is not the same as a job that cannot be done, and
  // until now it was treated as one.
  //
  // `attempts` is 3 by default, but the only path that ever counted an attempt
  // was the one above, for a window that had not really reset. A failure to
  // LAUNCH went straight to finish() and the relay was over - permanently,
  // after a single try, hours later, with nobody awake to see it.
  //
  // Measured on this machine on 2026-09-14: a relay armed at 94 per cent woke
  // at 04:25:01 and reported "Unable to connect to API: SSL certificate
  // hostname mismatch" 1.5 seconds later, with attempt still 0. That is what a
  // machine that has just woken looks like before its network is up. The work
  // was saved and never picked up, which is the one outcome this whole feature
  // exists to prevent.
  //
  // So a failed delivery now re-arms, up to the same attempt budget. No attempt
  // is made to sort transient errors from permanent ones: the cost of retrying
  // a permanent failure is one more launch and a later toast, and the cost of
  // not retrying a transient one is the entire night's work.
  const attempt = (record.attempt || 0) + 1;
  if (attempt < config.attempts) {
    // `resetsAt: now` means "treat this moment as the reset", so wakeAt() adds
    // the usual grace and books the next try that far out.
    const again = deps.arm({
      now,
      sessionId: record.id,
      cwd: record.cwd,
      hostName: record.host,
      resetsAt: now,
      binding: { percentUsed: reopened.known ? reopened.percent : null, resetsAt: now },
      work: Object.assign({ hasWork: true, pending: 1, source: null, todos: [] }, record.work || {}),
      config,
    });
    if (again.ok) {
      const held = relay.read();
      mine(held, record).attempt = attempt;
      mine(held, record).continuation = record.continuation;
      relay.write(held);
      deps.toast(
        'Usage limits: retrying',
        'The resume could not start (' + (delivered.error || 'unknown error') + '). Trying again in ' +
          config.graceMinutes + ' minutes.'
      );
      relay.note('wake ' + record.id + ': ' + delivered.error + ', retry ' + attempt + ' in ' + config.graceMinutes + 'm', now);
      return { outcome: 'retrying', attempt, error: delivered.error };
    }
    // Could not even book the retry; fall through and say so plainly.
    relay.note('wake ' + record.id + ': retry could not be scheduled: ' + again.error, now);
  }
  // Out of the short retries. Classification earns its place here, where the
  // question is no longer "retry or not" but "how long is it worth waiting",
  // and what to tell somebody who is asleep.
  //
  //   wait       the network or the service. Another window is cheap.
  //   permanent  a key, a login, a missing binary. Another window changes
  //              nothing, and saying "retrying" would be a lie.
  const verdict = net.classify((delivered.error || '') + ' ' + runs.join(' '));
  const rearms = record.rearms || 0;
  if (config.onFailure === 'rearm' && verdict.kind !== 'permanent' && rearms < config.maxRearms) {
    // A whole window later, not five more minutes: whatever this is, time is
    // the only variable left worth changing.
    const nextWindow = deps.arm({
      now,
      sessionId: record.id,
      cwd: record.cwd,
      hostName: record.host,
      project: record.project,
      resetsAt: now + 5 * 60 * MINUTE,
      binding: { percentUsed: record.percentAtArming, resetsAt: now + 5 * 60 * MINUTE },
      work: Object.assign({ hasWork: true, pending: 1, source: null, todos: [] }, record.work || {}),
      config: Object.assign({}, config, { armOn: 'threshold' }),
    });
    if (nextWindow.ok) {
      const held = relay.read();
      if (mine(held, record)) {
        mine(held, record).attempt = 0;
        mine(held, record).offlineAttempt = 0;
        mine(held, record).rearms = rearms + 1;
        mine(held, record).continuation = record.continuation;
        relay.write(held);
      }
      deps.toast('Usage limits: could not resume',
        (delivered.error || 'the run failed') + ' - ' + verdict.why + '. Armed again for the next window.' + (logPath ? ' See: relay log --run' : ''));
      relay.note('wake ' + record.id + ': failed (' + verdict.kind + '), armed again for the next window (' + (rearms + 1) + ' of ' + config.maxRearms + ')', now);
      return { outcome: 'rearmed', error: delivered.error, why: verdict.why, rearms: rearms + 1, log: logPath };
    }
  }
  deps.toast('Usage limits: could not resume',
    (delivered.error || 'The plan is still on disk.') + (verdict.kind === 'permanent' ? ' This will not fix itself: ' + verdict.why + '.' : '') + (logPath ? ' See: relay log --run' : ''));
  finish(state, record, 'failed', (delivered.error || '') + ' [' + verdict.kind + ']' + (logPath ? ' - log at ' + logPath : ''), now);
  return { outcome: 'failed', error: delivered.error, attempts: attempt, kind: verdict.kind, log: logPath };
}

if (require.main === module && process.argv.includes('--exec-spec')) {
  execSpec(argOf(process.argv.slice(2), '--exec-spec'));
} else if (require.main === module) {
  run(Date.now(), process.argv.slice(2)).then(
    (result) => {
      process.stdout.write(JSON.stringify(result) + '\n');
      process.exit(0);
    },
    (err) => {
      relay.note('wake crashed: ' + err.message, Date.now());
      process.exit(0);
    }
  );
}

module.exports = { freshFor, freshLaunch, freshArgs, freshName, freshPointerPrompt, FRESH_ARG_MAX, execSpec, specFile, bridgeCommand, deliverVisible, launcherFile, liveSession, transcriptActiveSince, pidAlive, LIVE_WAIT_MS, LIVE_POLL_MS, launcherScriptPosix, shQuote, visibleArgs, launcherScript, pointerPrompt, transcriptExists, transcriptFile, wakePromptFile, LAUNCH_GRACE_MS, run, toast, userIsPresent, claudeArgs, deliverClaude, deliverCodex, windowReopened, argOf, appendRun, spawnOptionsFor };
