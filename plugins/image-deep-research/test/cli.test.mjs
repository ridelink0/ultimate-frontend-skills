// The command lines as a person types them: every usage mistake is one line
// on stderr and exit code 2, never a stack trace. No network and no browser
// is reached on these paths.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const script = (name) => fileURLToPath(new URL(`../skills/image-deep-research/scripts/${name}.mjs`, import.meta.url));
const run = (name, args) => spawnSync(process.execPath, [script(name), ...args], { encoding: 'utf8', timeout: 30000 });

const cases = [
  ['study', [], /usage: node study\.mjs/],
  ['study', ['example.com'], /not a URL: example\.com/],
  ['study', ['--list', 'nope'], /unknown list "nope"/],
  ['study', ['https://example.com', '--width', 'wide'], /whole number/],
  ['study', ['https://example.com', '--out'], /--out needs a value/],
  ['images', [], /usage: node images\.mjs/],
  ['images', ['cats', '--sources', 'openverse,flickr'], /unknown source flickr/],
  ['images', ['cats', '--n', '0'], /--n expected a whole number between 1 and 20/],
  ['images', ['--pick', '2'], /--pick needs --results/],
  ['images', ['--pick', 'two', '--results', 'r.json'], /--pick expected a whole number/],
  ['images', ['--pick', '2', '--results', 'no-such-dir/results.json'], /cannot read no-such-dir\/results\.json: ENOENT/],
];

for (const [name, args, message] of cases) {
  test(`${name} ${args.join(' ') || '(no arguments)'} is a one-line usage error`, () => {
    const r = run(name, args);
    assert.equal(r.status, 2, r.stderr + r.stdout);
    assert.match(r.stderr, message);
    assert.doesNotMatch(r.stderr, /\n\s+at /, 'a stack trace leaked');
  });
}

// --pick reads a saved run and nothing else: fetch is replaced by one that
// throws before the script loads, so any network call would fail the test.
test('images --pick prints the picked records from results.json, offline', () => {
  const dir = mkdtempSync(join(tmpdir(), 'idr-pick-'));
  try {
    const results = Array.from({ length: 6 }, (_, i) => ({
      source: 'commons', title: 'Work ' + (i + 1), creator: 'Maker ' + (i + 1), licence: 'CC BY-SA 4.0',
      licenceUrl: 'https://creativecommons.org/licenses/by-sa/4.0', url: `https://upload.example.org/${i + 1}.jpg`,
      page: `https://commons.example.org/File:${i + 1}`, verified: { ok: i !== 1, status: i !== 1 ? 200 : 404 },
    }));
    let k = 0;
    for (const r of results) if (r.verified.ok) r.n = ++k;
    const file = join(dir, 'results.json');
    writeFileSync(file, JSON.stringify({ query: 'q', results, errors: [] }));
    const offline = ['--import', 'data:text/javascript,globalThis.fetch=()=>{throw new Error("network used")}'];
    const pick = (list) => spawnSync(process.execPath, [...offline, script('images'), '--pick', list, '--results', file], { encoding: 'utf8', timeout: 30000 });
    const r = pick('2,5');
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.stdout.trim().split('\n'), [
      '02 Work 3 | Maker 3 | CC BY-SA 4.0 https://creativecommons.org/licenses/by-sa/4.0',
      '   image https://upload.example.org/3.jpg',
      '   page https://commons.example.org/File:3',
      '05 Work 6 | Maker 6 | CC BY-SA 4.0 https://creativecommons.org/licenses/by-sa/4.0',
      '   image https://upload.example.org/6.jpg',
      '   page https://commons.example.org/File:6',
    ]);
    const bad = pick('99');
    assert.equal(bad.status, 2);
    assert.equal(bad.stdout, '');
    assert.equal(bad.stderr, 'images: no verified result 99 in this run (1-5)\n');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
