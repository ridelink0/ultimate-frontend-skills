#!/usr/bin/env node
'use strict';

// npm version bumps package.json and nothing else, but each host's plugin
// manifest carries its own version and the marketplace pins to it. Run from the
// npm "version" lifecycle script so they can never drift.
//
// There is one manifest per host. Bumping only the one you remembered is the
// quiet failure: the package publishes, the other host keeps serving the old
// version number, and nothing complains.

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;

const MANIFESTS = [
  path.join('.claude-plugin', 'plugin.json'),
  path.join('.codex-plugin', 'plugin.json'),
  // The VS Code extension is its own package with its own version field, and
  // it was the one that drifted: 1.12.7 shipped with the extension still
  // saying 1.12.6 until somebody noticed by hand.
  path.join('vscode', 'package.json'),
];

for (const relative of MANIFESTS) {
  const manifest = path.join(root, relative);
  let plugin;
  try {
    plugin = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  } catch (err) {
    // A host whose manifest is not in this checkout is not an error; a
    // malformed one is.
    if (err.code === 'ENOENT') {
      process.stdout.write(relative + ' not present, skipped\n');
      continue;
    }
    throw err;
  }

  if (plugin.version === version) {
    process.stdout.write(relative + ' already at ' + version + '\n');
    continue;
  }
  const before = plugin.version;
  plugin.version = version;
  fs.writeFileSync(manifest, JSON.stringify(plugin, null, 2) + '\n', 'utf8');
  process.stdout.write(relative + ' ' + before + ' -> ' + version + '\n');
}
