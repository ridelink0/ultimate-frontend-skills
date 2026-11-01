'use strict';

// vscode/lib/ is a generated copy of skills/usage-limits/scripts/, made by
// vscode/build.js so the extension packages with no dependencies. It is not
// checked in, so the failure this guards against is local and quiet: someone
// builds it, edits a script weeks later, then runs `npm run package` in
// vscode/ - which does rebuild - or, far more likely, packages from a tree
// where the rebuild did not happen and ships logic the plugin stopped using.
//
// The guard only works if nothing else in the suite rebuilds vscode/lib/ while
// it runs. test/vscode.test.js used to, via `node vscode/build.js`, in a
// sibling process: real drift introduced into vscode/lib/ was erased by that
// rebuild, and this test passed. Measured across four runs of the full suite
// with a deliberate change in vscode/lib/reading.js: red once, green three
// times, and the change gone from disk after the first run. It now builds into
// a scratch directory, so what is on disk here is only ever what a person put
// there.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const build = require('../vscode/build.js');

const root = path.join(__dirname, '..');
const from = build.SOURCE_DIR;
const to = path.join(root, 'vscode', 'lib');

function packagedFilesOrNull() {
  try {
    return fs.readdirSync(to).filter((name) => name.endsWith('.js')).sort();
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

// build.js's one deliberate difference is a string replace. If live.js ever
// stops containing the string being replaced, the replace becomes a silent
// no-op: the copy would match the source, this test would be satisfied, and
// the packaged live.js would ask for a package.json three directories above
// vscode/lib/ and throw when anything asked it for a version. So the anchor is
// asserted directly rather than inferred from the two files agreeing.
test('the one deliberate difference still has something to bite on', () => {
  const source = fs.readFileSync(path.join(from, 'live.js'), 'utf8');
  assert.ok(
    source.includes(build.VERSION_REQUIRE),
    'live.js no longer contains ' + build.VERSION_REQUIRE + ', so vscode/build.js silently packages a version lookup that resolves nowhere'
  );
  assert.strictEqual(
    build.patch('live.js', source).includes(build.PACKAGED_VERSION_REQUIRE),
    true
  );
  // And it is the only file the patch touches.
  for (const name of fs.readdirSync(from).filter((n) => n.endsWith('.js') && n !== 'live.js')) {
    const other = fs.readFileSync(path.join(from, name), 'utf8');
    assert.strictEqual(build.patch(name, other), other, name + ' must be copied byte for byte');
  }
});

test('vscode/lib/ matches skills/usage-limits/scripts/, apart from the one known live.js patch', (t) => {
  const packagedFiles = packagedFilesOrNull();
  if (packagedFiles === null) {
    // Nothing has been built in this tree, so nothing can be packaged stale.
    // Skipped rather than passed, so a run that checked nothing says so.
    t.skip('vscode/lib/ has not been built in this tree - nothing to compare');
    return;
  }

  const sourceFiles = fs.readdirSync(from).filter((name) => name.endsWith('.js')).sort();
  assert.deepStrictEqual(
    packagedFiles,
    sourceFiles,
    'vscode/lib/ must carry exactly the scripts the plugin ships, no more and no fewer - run `node vscode/build.js`'
  );

  const mismatched = [];
  for (const name of sourceFiles) {
    const source = fs.readFileSync(path.join(from, name), 'utf8');
    const packaged = fs.readFileSync(path.join(to, name), 'utf8');
    if (packaged !== build.patch(name, source)) mismatched.push(name);
  }

  assert.deepStrictEqual(
    mismatched,
    [],
    'these packaged scripts have drifted from skills/usage-limits/scripts/: run `node vscode/build.js`'
  );
});
