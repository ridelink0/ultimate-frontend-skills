#!/usr/bin/env node
'use strict';

// Copies the plugin's scripts into lib/ so the extension has no dependencies
// and packages as one file. Run before `vsce package`.
//
// The scripts are used exactly as they are, with one adjustment: live.js reads
// the package version from three directories up, which from lib/ is nowhere,
// so it is pointed at a package.json written beside it.
//
// The copying is a function rather than a script body because two other things
// need it and neither of them may touch vscode/lib/. test/vscode.test.js needs
// a built copy to activate the extension against, and used to get one by
// running this file - which wiped and rewrote vscode/lib/ in the middle of the
// suite, silently repairing exactly the staleness test/vscode-lib-drift.test.js
// exists to catch, and racing its directory read. It now builds into a scratch
// directory instead. The drift test needs the live.js patch, and takes it from
// here so there is one definition of "the one deliberate difference" rather
// than a copy in the test that could quietly stop matching this one.

const fs = require('fs');
const path = require('path');

const here = __dirname;
const root = path.join(here, '..');
const SOURCE_DIR = path.join(root, 'skills', 'usage-limits', 'scripts');

// The one deliberate difference between a source script and its packaged copy.
// Exported so the drift test asserts against this, not against a restatement.
const VERSION_REQUIRE = "require('../../../package.json')";
const PACKAGED_VERSION_REQUIRE = "require('./package.json')";

function patch(name, source) {
  if (name !== 'live.js') return source;
  return source.replace(VERSION_REQUIRE, PACKAGED_VERSION_REQUIRE);
}

// Writes the packaged copy of every script into `to`, plus the small
// package.json live.js reads its version from. Returns how many scripts moved.
function copyScripts(to, version) {
  fs.rmSync(to, { recursive: true, force: true });
  fs.mkdirSync(to, { recursive: true });

  let copied = 0;
  for (const name of fs.readdirSync(SOURCE_DIR)) {
    if (!name.endsWith('.js')) continue;
    const source = fs.readFileSync(path.join(SOURCE_DIR, name), 'utf8');
    fs.writeFileSync(path.join(to, name), patch(name, source), 'utf8');
    copied += 1;
  }
  fs.writeFileSync(
    path.join(to, 'package.json'),
    JSON.stringify({ name: 'claude-usage-limits', version, private: true }, null, 2) + '\n',
    'utf8'
  );
  return copied;
}

function build() {
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  const copied = copyScripts(path.join(here, 'lib'), version);
  fs.copyFileSync(path.join(root, 'LICENSE'), path.join(here, 'LICENSE'));
  require('./media/make-icon.js').write(path.join(here, 'media', 'icon.png'));

  // The extension carries the plugin's version.
  const manifestFile = path.join(here, 'package.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  if (manifest.version !== version) {
    manifest.version = version;
    fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  }
  return { copied, version };
}

if (require.main === module) {
  const { copied, version } = build();
  process.stdout.write('copied ' + copied + ' scripts into lib/ at version ' + version + '\n');
}

module.exports = {
  SOURCE_DIR,
  VERSION_REQUIRE,
  PACKAGED_VERSION_REQUIRE,
  patch,
  copyScripts,
  build,
};
