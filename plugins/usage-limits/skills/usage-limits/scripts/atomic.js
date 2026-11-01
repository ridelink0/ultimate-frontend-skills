'use strict';

// Every file this plugin replaces goes through here: written beside the target
// under a name that is this process's own, then renamed into place, so a
// reader sees either the old whole file or the new whole file.
//
// On Windows that rename is the step that fails. Two processes renaming onto
// the same target at the same moment - the prompt hook, the pulse and the
// status line do exactly that - get EPERM back from MoveFileEx for the one
// that loses. Measured on 2026-09-25 with four processes writing one file for
// three seconds: 2109 renames refused with EPERM against 469 that went
// through. The writers that did not delete their temporary file on that
// failure left one behind every time, and about seventy of them had piled up
// in ~/.claude by then. The same retry on EPERM, EACCES and EBUSY is what
// graceful-fs does for npm on Windows; here it is bounded tightly, because
// the hooks that call this have ten seconds between them and the prompt.
//
// What no code path can clean is a process killed between creating its
// temporary file and renaming it - a hook that ran into its timeout. sweep()
// removes those at the next prompt, once they are old enough that no live
// writer can still own them.

const fs = require('fs');
const path = require('path');

// One suffix for every temporary file, and nobody else's: anything ending in
// it is this plugin's, so the sweep never has to guess.
const SUFFIX = '.usage-limits-tmp';

// The codes Windows returns while another process has the target, or is
// replacing it. Anything else - ENOSPC, ENOENT, EISDIR - will not change on a
// second try.
const RETRY_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);

// About a third of a second in all. Contention clears in milliseconds; a
// target that is still held after this is held by something that will not let
// go soon, and the caller carries on with what is on disk.
const RETRY_DELAYS_MS = [5, 10, 20, 40, 60, 80, 100];

// A write takes milliseconds and the longest hook is killed at ten seconds, so
// nothing alive owns a temporary file this old.
const STALE_MS = 10 * 60 * 1000;

// Temporary names this plugin has used. The first is the one written now; the
// second is what reading.js, drift.js, mode.js and relay.js wrote before
// 1.39.6 - `usage-limits-<name>.json.<pid>.tmp` - and is matched only with the
// usage-limits- prefix and the pid, because a bare .tmp could be anyone's.
const OWN_TEMP = [
  /^.+\.usage-limits-tmp$/,
  /^usage-limits-[A-Za-z0-9_-]+\.json\.\d+\.tmp$/,
];

function sleepSync(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch (err) {
    // No shared memory here: spin for the same time instead.
    const until = Date.now() + ms;
    while (Date.now() < until) {
      // Waiting.
    }
  }
}

function tempFor(file) {
  return file + '.' + process.pid + SUFFIX;
}

function renameWithRetry(from, to) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (err) {
      if (!RETRY_CODES.has(err && err.code) || attempt >= RETRY_DELAYS_MS.length) throw err;
      sleepSync(RETRY_DELAYS_MS[attempt]);
    }
  }
}

// Never throws. True when the file is gone, whoever removed it.
function removeQuietly(file) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      fs.unlinkSync(file);
      return true;
    } catch (err) {
      if (err && err.code === 'ENOENT') return true;
      if (!RETRY_CODES.has(err && err.code) || attempt >= 3) return false;
      sleepSync(RETRY_DELAYS_MS[attempt]);
    }
  }
}

// Throws what the write or the last rename threw, after removing the
// temporary file. `options` is passed to writeFileSync (encoding, mode).
function writeFileAtomic(file, text, options) {
  const temp = tempFor(file);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(temp, text, options === undefined ? 'utf8' : options);
    renameWithRetry(temp, file);
  } catch (err) {
    removeQuietly(temp);
    throw err;
  }
}

// The same, for callers that carry on either way.
function tryWriteFileAtomic(file, text, options) {
  try {
    writeFileAtomic(file, text, options);
    return true;
  } catch (err) {
    return false;
  }
}

function isOwnTemp(name) {
  return OWN_TEMP.some((pattern) => pattern.test(name));
}

// Removes this plugin's temporary files older than STALE_MS from each
// directory. Only names isOwnTemp() accepts are ever looked at. Never throws;
// returns how many were removed.
function sweep(dirs, now, staleMs) {
  const at = Number.isFinite(now) ? now : Date.now();
  const age = Number.isFinite(staleMs) ? staleMs : STALE_MS;
  let removed = 0;
  const seen = new Set();
  for (const dir of [].concat(dirs || [])) {
    if (!dir || seen.has(path.resolve(dir))) continue;
    seen.add(path.resolve(dir));
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch (err) {
      continue;
    }
    for (const name of names) {
      if (!isOwnTemp(name)) continue;
      const file = path.join(dir, name);
      try {
        const stat = fs.statSync(file);
        if (!stat.isFile() || at - stat.mtimeMs < age) continue;
      } catch (err) {
        continue;
      }
      try {
        fs.unlinkSync(file);
        removed += 1;
      } catch (err) {
        // Gone already is someone else's sweep; held is worth one more try.
        if (err && err.code !== 'ENOENT' && removeQuietly(file)) removed += 1;
      }
    }
  }
  return removed;
}

module.exports = {
  SUFFIX,
  STALE_MS,
  RETRY_CODES,
  RETRY_DELAYS_MS,
  tempFor,
  renameWithRetry,
  removeQuietly,
  writeFileAtomic,
  tryWriteFileAtomic,
  isOwnTemp,
  sweep,
};
