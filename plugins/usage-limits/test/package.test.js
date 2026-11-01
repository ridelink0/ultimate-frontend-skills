'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const root = path.join(__dirname, '..');

// Lets the suite be pointed at another npm to check the output shape still
// parses, for example USAGE_LIMITS_NPM="npx -y npm@latest".
const NPM = process.env.USAGE_LIMITS_NPM || 'npm';

let cached = null;

// What npm would really put in the tarball, asked of npm rather than worked
// out from our own reading of the files list.
function packInfo() {
  if (cached) return cached;

  const out = execSync(NPM + ' pack --dry-run --json', {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const parsed = JSON.parse(out);

  // npm 10 answers with [info]. npm 11 answers with { "<package>": info }.
  const info = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0];

  assert.ok(
    info && Array.isArray(info.files),
    'npm pack --dry-run --json returned a shape this test does not recognise. ' +
      'npm already changed it once between 10 and 11, so update packInfo() ' +
      'rather than deleting the check: it is the only thing standing between a ' +
      'broken files list and a published package that cannot start.'
  );

  cached = {
    files: info.files.map((entry) => entry.path.split(path.sep).join('/')),
    unpackedSize: info.unpackedSize,
  };
  return cached;
}

// Every local module reachable from an entry point, followed through the
// require graph rather than guessed at.
function reachableFrom(entry) {
  const seen = new Set();
  const queue = [path.resolve(root, entry)];

  while (queue.length) {
    const file = queue.pop();
    const relative = path.relative(root, file).split(path.sep).join('/');
    if (seen.has(relative)) continue;
    seen.add(relative);

    let source;
    try {
      source = fs.readFileSync(file, 'utf8');
    } catch (err) {
      continue;
    }

    const pattern = /require\(\s*['"](\.[^'"]+)['"]\s*\)/g;
    let match;
    while ((match = pattern.exec(source)) !== null) {
      let target = path.resolve(path.dirname(file), match[1]);
      if (!fs.existsSync(target)) target += '.js';
      if (fs.existsSync(target)) queue.push(target);
    }
  }

  return [...seen];
}

test('the npm pack output shape is one we understand', () => {
  const info = packInfo();
  assert.ok(info.files.length > 5, 'expected a real file list');
  assert.ok(Number.isFinite(info.unpackedSize), 'expected a size');
});

test('everything the published CLI requires is inside the tarball', () => {
  const { files } = packInfo();
  const needed = reachableFrom('bin/cli.js');

  assert.ok(needed.length >= 3, 'expected the CLI to pull in the scripts');
  for (const file of needed) {
    assert.ok(
      files.includes(file),
      file + ' is required at runtime but would not be published. Add it to ' +
        'the files list in package.json, or npx installs break while every ' +
        'other test still passes.'
    );
  }
});

test('the skill itself ships, not just the scripts', () => {
  const { files } = packInfo();
  for (const file of [
    'skills/usage-limits/SKILL.md',
    'skills/usage-limits/references/tactics.md',
    'skills/usage-limits/references/how-it-works.md',
    'commands/check.md',
    'hooks/hooks.json',
    '.claude-plugin/plugin.json',
  ]) {
    assert.ok(files.includes(file), file + ' should be in the package');
  }
});

// The plugin is installable from two hosts, and each reads a manifest the other
// ignores. Leaving one out of the files list publishes a package that installs
// on one host and is invisible on the other, with every other test still green.
test('both hosts get everything they need to install it', () => {
  const { files } = packInfo();
  for (const file of [
    '.codex-plugin/plugin.json',
    'agents/openai.yaml',
    'skills/usage-limits/agents/openai.yaml',
    'skills/usage-limits/scripts/codex.js',
    'skills/usage-limits/scripts/host.js',
    'skills/usage-limits/scripts/install-codex-hook.js',
    'skills/usage-limits/scripts/pulse.js',
  ]) {
    assert.ok(
      files.includes(file),
      file + ' should be in the package. Without it the Codex side either does ' +
        'not appear or fails at runtime, while the Claude side keeps working.'
    );
  }
});

// npm version bumps package.json; the manifests carry their own copy and the
// marketplaces pin to it. Bumping one and forgetting the other publishes a
// package whose two halves disagree about what version they are.
test('every host manifest carries the same version as the package', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  for (const manifest of ['.claude-plugin/plugin.json', '.codex-plugin/plugin.json']) {
    const parsed = JSON.parse(fs.readFileSync(path.join(root, manifest), 'utf8'));
    assert.strictEqual(
      parsed.version,
      pkg.version,
      manifest + ' is at ' + parsed.version + ' but the package is at ' + pkg.version +
        '. tools/sync-version.js should keep these in step.'
    );
  }
});

test('the version script updates every manifest, not just the first', () => {
  const script = fs.readFileSync(path.join(root, 'tools', 'sync-version.js'), 'utf8');
  assert.ok(script.indexOf('.codex-plugin') !== -1, 'the Codex manifest must be synced too');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.ok(
    pkg.scripts.version.indexOf('.codex-plugin/plugin.json') !== -1,
    'and staged, or the bump is left out of the release commit'
  );
});

test('the tarball stays small enough to be uncontroversial', () => {
  const { unpackedSize } = packInfo();
  assert.ok(
    unpackedSize < 2 * 1024 * 1024,
    'unpacked size grew to ' + unpackedSize + ' bytes; something large got in'
  );
});

test('the package version and the plugin manifest version agree', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, '.claude-plugin', 'plugin.json'), 'utf8')
  );
  assert.strictEqual(
    pkg.version,
    manifest.version,
    'a release bumps package.json; plugin.json has to move with it or the ' +
      'marketplace pins an older version than npm serves'
  );
});

// A plugin.json at the repo root, two versions stale, was the first thing a
// scraper or a reader would find and trust. Nothing read it: Claude Code reads
// .claude-plugin/, Codex reads .codex-plugin/, and the Antigravity installer
// writes its own manifest and hooks from code. Deleted in 1.37.0; this keeps
// it deleted.
test('the stale root-level manifest pair stays gone', () => {
  for (const file of ['plugin.json', 'hooks.json']) {
    assert.ok(!fs.existsSync(path.join(root, file)), file + ' at the repo root is read by nothing and drifts from the real manifests');
  }
});
