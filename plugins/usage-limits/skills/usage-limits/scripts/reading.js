'use strict';

// The freshest corrected percentage, left where the cheap readers can find it.
//
// There are two ways to know how much of a window is gone. The snapshot is what
// the account last told us, and it is free to read. The correction is the spend
// measured out of the transcripts since that snapshot was taken, and it costs a
// scan of up to several seconds - far too much for something that redraws under
// the prompt on every keystroke.
//
// So the fast readers used the snapshot alone, and during a heavy session that
// is not a small error. Measured on a real session: the snapshot said 13 per
// cent while the same codebase, given a scan, said 73. The status line is the
// number a person actually looks at, and it was sixty points wrong, in the
// flattering direction, for twenty minutes.
//
// The fix is not to make the cheap path expensive. It is to notice that
// something already paid for the scan - the prompt hook before every turn, the
// pulse hook during long ones - and to have it leave the answer here. One small
// file, one object per window key, and the readers prefer it whenever it is
// fresher than the snapshot it would otherwise trust.

const fs = require('fs');
const os = require('os');
const path = require('path');

const atomic = require('./atomic.js');
const drift = require('./drift.js');

// Older than this and the spend it measured is history: turns have happened
// since, and a stale correction that says 40 per cent is worse than an honest
// snapshot that says 13, because it looks authoritative.
const FRESH_MS = 8 * 60 * 1000;

function configDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

function readingFile(codexHome) {
  return path.join(codexHome || configDir(), 'usage-limits-reading.json');
}

function accountUuid(codexHome) {
  if (codexHome) return null;
  try { return require('./usage.js').accountUuid(); } catch (err) { return null; }
}

function read(codexHome) {
  try {
    const parsed = JSON.parse(fs.readFileSync(readingFile(codexHome), 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed;
  } catch (err) {
    return {};
  }
}

// Every window that has a correction, not just the binding one.
//
// The status line prints all three, and only one of them can be binding. So
// recording the binding window alone left the other two showing their raw
// snapshots - which is the same bug, on two thirds of the line.
function recordAll(windows, now, codexHome) {
  let written = 0;
  for (const window of Array.isArray(windows) ? windows : [windows]) {
    if (record(window, now, codexHome)) written += 1;
  }
  return written;
}

// Never throws. This is written from inside hooks, and a hook that fails over a
// cache file would be worse than the stale number it was trying to fix.
function record(binding, now, codexHome) {
  if (!binding || !binding.key) return false;
  if (binding.percentUsed === null || binding.percentUsed === undefined) return false;
  // A rebuilt or unreliable figure is not an improvement on the snapshot; it is
  // a different kind of guess. Only a correction the report itself trusts is
  // worth putting in front of the cheap readers.
  if (binding.stale || binding.estimated || binding.correctionUnreliable) return false;
  try {
    const all = read(codexHome);
    const at = Number.isFinite(now) ? now : Date.now();
    // Whatever was sitting here before is what the cheap readers had been
    // trusting; this fresh, checked correction is what the meter actually
    // said. The gap between them is real drift a session just lived through,
    // and it is worth keeping regardless of what happens to this record next.
    const previous = all[binding.key];
    const next = {
      at,
      accountUuid: accountUuid(codexHome),
      percentUsed: binding.percentUsed,
      pointsSinceSnapshot: binding.pointsSinceSnapshot || 0,
      adjusted: Boolean(binding.adjusted),
      resetsAt: Number.isFinite(binding.resetsAt) ? binding.resetsAt : null,
      turnsLeft: Number.isFinite(binding.turnsLeft) ? binding.turnsLeft : null,
    };
    if (previous) drift.record(binding.key, previous, next, at, codexHome);
    all[binding.key] = next;
    // One entry per window key, and there are only ever a handful of those, so
    // this file cannot grow. Anything whose reset has passed describes a window
    // that no longer exists.
    for (const key of Object.keys(all)) {
      const entry = all[key];
      if (!entry || !Number.isFinite(entry.at) || at - entry.at > 24 * 60 * 60 * 1000) delete all[key];
      else if (Number.isFinite(entry.resetsAt) && entry.resetsAt <= at) delete all[key];
    }
    fs.mkdirSync(path.dirname(readingFile(codexHome)), { recursive: true });
    // Write beside and rename: the prompt hook and the pulse can both land
    // here in the same second, and a reader between a truncate and a write
    // would see half a file.
    const file = readingFile(codexHome);
    // A refused rename is retried and a failed one leaves nothing behind: see
    // atomic.js. The caller only ever needed to know whether it landed.
    return atomic.tryWriteFileAtomic(file, JSON.stringify(all));
  } catch (err) {
    return false;
  }
}

// The corrected percentage for one window, or null when there is nothing better
// than the snapshot. `snapshotAt` is when the snapshot being compared against
// was fetched: a correction measured before it is already included in it, and
// applying it again would double-count the same spend.
function correctedFor(key, now, snapshotAt, codexHome) {
  const entry = read(codexHome)[key];
  if (!entry || !Number.isFinite(entry.at)) return null;
  const login = accountUuid(codexHome);
  if (login && entry.accountUuid !== login) return null;
  const at = Number.isFinite(now) ? now : Date.now();
  if (at - entry.at > FRESH_MS) return null;
  if (Number.isFinite(snapshotAt) && entry.at < snapshotAt) return null;
  if (Number.isFinite(entry.resetsAt) && entry.resetsAt <= at) return null;
  return entry;
}

function clear(codexHome) {
  try {
    fs.unlinkSync(readingFile(codexHome));
  } catch (err) {
    // Already gone is the outcome that was asked for.
  }
}

module.exports = { FRESH_MS, configDir, readingFile, read, record, recordAll, correctedFor, clear };
