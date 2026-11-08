// Compiles the Computer Use host from the C# source in this repo using the csc.exe
// that ships with the Windows .NET Framework. No SDK, no toolchain, no npm
// native addon, no download.
//
// The build is content-addressed: the compiled exe is stamped with a hash of
// its source and the reference set, so it rebuilds only when something actually
// changed and is a no-op on every later start.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WIN_SOURCES = [
  path.join(HERE, 'native', 'AxonHost.cs'),
  path.join(HERE, 'native', 'Presence.cs'),
  path.join(HERE, 'native', 'Overlay.cs'),
];
const MAC_SOURCES = [path.join(HERE, 'native', 'AxonHost.swift')];

export const SOURCES = process.platform === 'darwin' ? MAC_SOURCES : WIN_SOURCES;
export const SOURCE = SOURCES[0];

export function dataDir() {
  // The compiled host lives in plugin data, not in the plugin directory, so it
  // survives plugin updates and never lands inside a git checkout.
  const fromEnv = process.env.CU_PLUGIN_DATA || process.env.CLAUDE_PLUGIN_DATA;
  if (fromEnv && fromEnv.trim() && !fromEnv.includes('${')) return fromEnv.trim();
  return path.join(os.homedir(), '.claude', 'plugins', 'data', 'computer-use');
}

export function binDir() {
  return path.join(dataDir(), 'bin');
}

// The binary is named after a hash of its own source and reference set. Two
// Claude Code sessions starting at once therefore agree on the filename without
// coordinating, and a rebuild after an edit writes a new file rather than
// overwriting one another session may be executing.
function exeFor(stamp) {
  const ext = process.platform === 'win32' ? '.exe' : '';
  return path.join(binDir(), `AxonHost-${stamp.slice(0, 16)}${ext}`);
}

// Swift ships with the Xcode Command Line Tools, which `xcode-select --install`
// provides on any Mac.
function findSwiftc() {
  for (const c of ['/usr/bin/swiftc', '/usr/local/bin/swiftc']) if (fs.existsSync(c)) return c;
  try {
    const r = spawnSync('xcrun', ['-f', 'swiftc'], { encoding: 'utf8' });
    if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  } catch { /* xcrun absent */ }
  return null;
}

function findCsc() {
  const win = process.env.WINDIR || process.env.SystemRoot || 'C:\\Windows';
  const candidates = [
    path.join(win, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
    path.join(win, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe'),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return null;
}

// UIAutomation and WindowsBase live only in the GAC on a stock Windows box -
// there is no Reference Assemblies folder unless a dev SDK is installed - so
// resolve them by walking the versioned GAC directories.
function findGacAssembly(name) {
  const win = process.env.WINDIR || process.env.SystemRoot || 'C:\\Windows';
  const roots = [
    path.join(win, 'Microsoft.NET', 'assembly', 'GAC_MSIL', name),
    path.join(win, 'assembly', 'GAC_MSIL', name),
  ];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    let versions;
    try { versions = fs.readdirSync(root); } catch { continue; }
    // Prefer v4.x, and the highest version string among those.
    versions.sort().reverse();
    const preferred = versions.filter((v) => v.startsWith('v4.')).concat(versions);
    for (const v of preferred) {
      const dll = path.join(root, v, name + '.dll');
      if (fs.existsSync(dll)) return dll;
    }
  }
  return null;
}

function computeStamp(csc, refs) {
  const h = createHash('sha256');
  for (const f of SOURCES) h.update(fs.readFileSync(f));
  h.update('\0' + csc);
  for (const r of refs) h.update('\0' + r);
  h.update('\0v2');
  return h.digest('hex');
}

export class BuildError extends Error {
  constructor(message, hint) {
    super(message);
    this.code = 'build_failed';
    this.hint = hint;
  }
}

export function ensureHost({ force = false, log = () => {} } = {}) {
  if (process.platform === 'darwin') return ensureMacHost({ force, log });
  if (process.platform !== 'win32') {
    throw new BuildError(
      'Computer Use runs on Windows and macOS. This looks like ' + process.platform + '.',
      'Linux would need an AT-SPI driver, which does not exist yet.'
    );
  }

  const csc = findCsc();
  if (!csc) {
    throw new BuildError(
      'Could not find the in-box C# compiler (csc.exe) under %WINDIR%\\Microsoft.NET.',
      'Computer Use needs the .NET Framework 4.x runtime, which is part of Windows. On a stripped image, enable it in Windows Features.'
    );
  }

  const needed = ['UIAutomationClient', 'UIAutomationTypes', 'WindowsBase'];
  const refs = [];
  const missing = [];
  for (const n of needed) {
    const p = findGacAssembly(n);
    if (p) refs.push(p);
    else missing.push(n);
  }
  if (missing.length) {
    throw new BuildError(
      'Missing .NET Framework assemblies in the GAC: ' + missing.join(', ') + '.',
      'These ship with the .NET Framework. Enable ".NET Framework 4.x Advanced Services" in Windows Features.'
    );
  }

  const stamp = computeStamp(csc, refs);
  const exe = exeFor(stamp);

  if (!force && fs.existsSync(exe)) {
    log('host up to date');
    return { exe, rebuilt: false, csc };
  }

  fs.mkdirSync(binDir(), { recursive: true });
  log('compiling host with ' + csc);

  // Compile to a process-unique name first. Two sessions racing here each build
  // their own file and then try to claim the shared name, so neither can ever
  // write into a binary the other is executing.
  const temp = path.join(binDir(), `.build-${process.pid}-${Date.now()}.exe`);

  const args = [
    '-nologo',
    '-optimize+',
    '-target:exe',
    '-platform:anycpu',
    '-out:' + temp,
    ...refs.map((r) => '-r:' + r),
    '-r:System.Web.Extensions.dll',
    '-r:System.Drawing.dll',
    '-r:System.Windows.Forms.dll',
    ...SOURCES,
  ];

  const res = spawnSync(csc, args, { encoding: 'utf8', windowsHide: true });
  if (res.error) {
    throw new BuildError('Could not run the C# compiler: ' + res.error.message, null);
  }
  if (res.status !== 0) {
    const out = ((res.stdout || '') + (res.stderr || '')).trim();
    throw new BuildError('Compiling the Computer Use host failed.', out.slice(0, 2000));
  }
  // The compiler has been linting this code on every build and the result was
  // going straight to the floor: stdout is read ONLY when status is non-zero,
  // so every warning on a SUCCESSFUL build was discarded unread. On
  // interop-heavy code that is the cheapest static analysis available - CS0618
  // obsolete APIs, unreachable code, unused locals in P/Invoke paths - and
  // surfacing it costs nothing, because csc has already done the work.
  //
  // Printed rather than thrown: a warning is not a reason to fail a build that
  // produced a working executable, and making it one would mean the host could
  // not be rebuilt until every warning was cleared.
  const warnings = ((res.stdout || '') + (res.stderr || ''))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.includes('warning CS'));
  if (warnings.length) {
    const shown = warnings.slice(0, 20);
    process.stdout.write(
      warnings.length + ' C# compiler warning' + (warnings.length === 1 ? '' : 's') + ':\n'
    );
    for (const line of shown) process.stdout.write('  ' + line + '\n');
    if (warnings.length > shown.length) {
      process.stdout.write('  ... and ' + (warnings.length - shown.length) + ' more\n');
    }
  }

  if (!fs.existsSync(temp)) {
    throw new BuildError('The compiler reported success but produced no executable.', null);
  }

  try {
    fs.renameSync(temp, exe);
  } catch (err) {
    // Losing the race is fine: the winner's binary has identical contents,
    // because the name is a hash of exactly what went into it.
    try { fs.unlinkSync(temp); } catch {}
    if (!fs.existsSync(exe)) {
      throw new BuildError('Could not place the compiled host: ' + err.message, null);
    }
  }

  pruneOldBuilds(exe, log);
  warmUp(exe, log);
  log('host built at ' + exe);
  return { exe, rebuilt: true, csc };
}

// The first execution of a newly written binary is slow: a real-time antivirus
// scan runs before it starts, and on Windows that costs seconds. Paying it here,
// once, at build time, means the first thing Claude asks Computer Use to do is not
// mysteriously slow.
function warmUp(exe, log) {
  try {
    const r = spawnSync(exe, ['--warmup'], { timeout: 20000, windowsHide: true, encoding: 'utf8' });
    if (r.error) log('warm-up skipped: ' + r.error.message);
  } catch (err) {
    log('warm-up skipped: ' + err.message);
  }
}

// Superseded binaries from earlier versions of the source. A file still being
// executed by another session cannot be deleted on Windows, and that refusal is
// exactly the outcome we want, so failures here are ignored.
function pruneOldBuilds(keep, log) {
  let entries;
  try { entries = fs.readdirSync(binDir()); } catch { return; }
  for (const name of entries) {
    if (!/^(AxonHost-[0-9a-f]{16}(\.exe)?|\.build-.*|AxonHost\.(exe|stamp))$/.test(name)) continue;
    const full = path.join(binDir(), name);
    if (full === keep) continue;
    try { fs.unlinkSync(full); } catch { /* in use by another session */ }
  }
}

function ensureMacHost({ force = false, log = () => {} } = {}) {
  const swiftc = findSwiftc();
  if (!swiftc) {
    throw new BuildError('Could not find swiftc.',
      'Install the Xcode Command Line Tools: xcode-select --install');
  }

  const h = createHash('sha256');
  for (const f of SOURCES) h.update(fs.readFileSync(f));
  h.update(' ' + swiftc + ' mac-v1');
  const stamp = h.digest('hex');
  const exe = exeFor(stamp);

  if (!force && fs.existsSync(exe)) {
    log('host up to date');
    return { exe, rebuilt: false, compiler: swiftc };
  }

  fs.mkdirSync(binDir(), { recursive: true });
  log('compiling host with ' + swiftc);
  const temp = path.join(binDir(), '.build-' + process.pid + '-' + Date.now());

  const res = spawnSync(swiftc, [
    '-O', '-o', temp,
    '-framework', 'AppKit',
    '-framework', 'ApplicationServices',
    '-framework', 'CoreGraphics',
    ...SOURCES,
  ], { encoding: 'utf8' });

  if (res.error) throw new BuildError('Could not run swiftc: ' + res.error.message, null);
  if (res.status !== 0 || !fs.existsSync(temp)) {
    const out = ((res.stdout || '') + (res.stderr || '')).trim();
    throw new BuildError('Compiling the macOS host failed.',
      out.slice(0, 2000) + String.fromCharCode(10, 10) +
      'The macOS host is a port that has not been validated on hardware. ' +
      'Please open an issue at https://github.com/ridelink0/claude-computer-use/issues with this output.');
  }
  try { fs.chmodSync(temp, 0o755); } catch {}
  try { fs.renameSync(temp, exe); }
  catch (err) {
    try { fs.unlinkSync(temp); } catch {}
    if (!fs.existsSync(exe)) throw new BuildError('Could not place the compiled host: ' + err.message, null);
  }
  pruneOldBuilds(exe, log);
  warmUp(exe, log);
  log('host built at ' + exe);
  return { exe, rebuilt: true, compiler: swiftc };
}

// Allow `node build.mjs` for a manual/diagnostic build.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  try {
    const r = ensureHost({ force: process.argv.includes('--force'), log: (m) => console.log(m) });
    console.log(r.rebuilt ? 'built: ' + r.exe : 'already current: ' + r.exe);
    if (process.argv.includes('--self-test')) {
      // Runs the host's own check, so a user can see whether it works on their
      // machine without involving Claude at all.
      const t = spawnSync(r.exe, ['--self-test'], { encoding: 'utf8' });
      process.stdout.write(t.stdout || '');
      process.stderr.write(t.stderr || '');
      if (process.platform === 'win32' && !(t.stdout || '').trim()) {
        console.log('(the Windows host has no --self-test; run node tools/test-all.mjs instead)');
      }
      process.exit(t.status === 0 ? 0 : 1);
    }
  } catch (e) {
    console.error(e.message);
    if (e.hint) console.error(e.hint);
    process.exit(1);
  }
}
