'use strict';

// Temporary directories for the test suite, removed when the file that made
// them exits.
//
// Per-test cleanup is the obvious answer and it is the one that keeps failing.
// A helper that creates a directory and deletes it in a `finally` only covers
// the tests routed through that helper: the suite also makes directories inline
// inside a test body, hands them to a spawned process, or makes a second one for
// a Codex home beside the first, and those were never deleted at all. Measured
// on 2026-09-25: 2,774 usage-limits-* folders in %TEMP%, and 82 more added by
// every full run after the atomic-temp fix in 60bc2e5, which covered a
// different thing - the `.usage-limits-tmp` files a killed hook leaves behind.
//
// So the cleanup is hung on process exit instead of on each test. `node --test`
// runs every test file in its own process, so "this process is exiting" means
// "this file is done", including after a failure, a throw, or an assertion that
// stopped the file early - which is exactly where the `finally` blocks were
// being skipped.
//
// This lives in tools/ rather than test/ on purpose: `node --test` loads EVERY
// .js file under a directory named test/ as a test file, so a helper put there
// would be counted as a test and would run its own exit hook a second time.

const fs = require('fs');
const os = require('os');
const path = require('path');

const made = new Set();
let hooked = false;

// A drop-in for fs.mkdtempSync that remembers what it made.
//
// It takes either a bare prefix or the full template the call sites already
// build - path.join(os.tmpdir(), 'usage-limits-feed-') - so replacing
// fs.mkdtempSync with this is the whole change at each site, and the names in
// %TEMP% stay the ones they were, still recognisable while a test is running.
// Joining an already-absolute template onto os.tmpdir() again would produce
// 'C:\Temp\C:\Temp\usage-limits-feed-' on Windows, which is not a path.
function make(prefix) {
  const template = path.isAbsolute(prefix) ? prefix : path.join(os.tmpdir(), prefix);
  const dir = fs.mkdtempSync(template);
  track(dir);
  return dir;
}

// For a directory made some other way - by a spawned process, or by a test that
// needs the path before it exists.
function track(dir) {
  made.add(dir);
  if (!hooked) {
    hooked = true;
    // Both, because a test file that throws at the top level exits through
    // uncaughtException rather than a clean exit, and `exit` still runs after.
    process.on('exit', cleanup);
  }
  return dir;
}

function cleanup() {
  for (const dir of made) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (err) {
      // A directory a spawned process still holds open on Windows is the one
      // case this cannot win, and failing the suite over it would be worse.
    }
  }
  made.clear();
}

module.exports = { make, track, cleanup, made };
