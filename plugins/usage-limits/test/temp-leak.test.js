'use strict';

// About seventy temporary files were found in ~/.claude on 2026-09-25:
// usage-limits-reading.json.<pid>.tmp, usage-limits-drift.json.<pid>.tmp,
// usage-limits-pulse.json.<pid>.usage-limits-tmp and more. Two ways in, both
// reproduced here:
//
//   1. A rename Windows refused. Two processes renaming onto one target at
//      once get EPERM for the loser, and reading.js, drift.js, mode.js,
//      relay.js and codex.js never deleted their temporary file when that
//      happened. The refusal is simulated by making fs.renameSync throw the
//      code Windows returns, and once for real with processes racing.
//   2. A process killed between writing and renaming - a hook that hit its
//      timeout. No code path can clean that, so the next prompt sweeps it.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const SCRIPTS = path.join(__dirname, '..', 'skills', 'usage-limits', 'scripts');
const atomic = require(path.join(SCRIPTS, 'atomic.js'));

const NOW = Date.parse('2026-09-25T18:00:00.000Z');
const MINUTE = 60 * 1000;

function temps(dir) {
  return fs.readdirSync(dir).filter((name) => /\.tmp$|\.usage-limits-tmp$/.test(name));
}

function withDirs(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-limits-leak-'));
  const codexDir = path.join(dir, 'codex');
  fs.mkdirSync(codexDir);
  const before = { claude: process.env.CLAUDE_CONFIG_DIR, codex: process.env.CODEX_HOME };
  process.env.CLAUDE_CONFIG_DIR = dir;
  process.env.CODEX_HOME = codexDir;
  try {
    return fn(dir, codexDir);
  } finally {
    if (before.claude === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = before.claude;
    if (before.codex === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = before.codex;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// fs.renameSync throws `code` for the first `times` calls (Infinity: always),
// the way MoveFileEx refuses while another process holds or replaces the
// target. Everything else about fs is real.
function withRefusedRename(code, times, fn) {
  const real = fs.renameSync;
  let calls = 0;
  fs.renameSync = function refused(from, to) {
    calls += 1;
    if (calls <= times) {
      const err = new Error(code + ': operation not permitted, rename \'' + from + '\' -> \'' + to + '\'');
      err.code = code;
      err.syscall = 'rename';
      throw err;
    }
    return real.apply(fs, arguments);
  };
  try {
    return fn(() => calls);
  } finally {
    fs.renameSync = real;
  }
}

function load(name) {
  return require(path.join(SCRIPTS, name));
}

const BINDING = {
  key: 'five_hour',
  percentUsed: 73,
  pointsSinceSnapshot: 60,
  adjusted: true,
  resetsAt: NOW + 30 * MINUTE,
  turnsLeft: 55,
};

// Every writer the debris was traced to, driven through its own public entry.
// Each returns what the writer returned; `failed` says what failure looks like
// for it (they report it differently, and that contract is not changed here).
const WRITERS = [
  { name: 'reading.record', run: () => load('reading.js').record(BINDING, NOW), failed: false },
  { name: 'drift.recordTurns', run: () => load('drift.js').recordTurns('standard', 3, 0.25, NOW), failed: false },
  {
    name: 'mode.write',
    run: () => {
      const mode = load('mode.js');
      const state = mode.read();
      state.mode = 'max';
      return mode.write(state);
    },
    failed: false,
  },
  { name: 'relay.write', run: () => load('relay.js').write({ config: { enabled: true } }), failed: false },
  { name: 'usage.writeJsonAtomic', run: (dir) => load('usage.js').writeJsonAtomic(path.join(dir, 'usage-limits-models.json'), { a: 1 }), failed: false },
  { name: 'live.writeAtomic', run: (dir) => load('live.js').writeAtomic(path.join(dir, 'usage-limits-live.json'), '{"a":1}'), failed: false },
  { name: 'activity.mark', run: () => load('activity.js').mark('working', 's-1', null, NOW), failed: false },
  { name: 'codex.writeLiveMeter', run: () => load('codex.js').writeLiveMeter({ at: NOW, meter: {} }), failed: false },
];

for (const writer of WRITERS) {
  test(writer.name + ' leaves no temporary file when every rename is refused', () =>
    withDirs((dir, codexDir) => {
      const result = withRefusedRename('EPERM', Infinity, () => writer.run(dir));
      assert.strictEqual(result, writer.failed, 'the failure is reported the way this writer always reported it');
      assert.deepStrictEqual(temps(dir), [], 'nothing left in the config dir');
      assert.deepStrictEqual(temps(codexDir), [], 'nothing left in the Codex home');
    }));

  test(writer.name + ' gets through a rename refused a few times, the way contention clears', () =>
    withDirs((dir, codexDir) => {
      const result = withRefusedRename('EPERM', 3, (calls) => {
        const value = writer.run(dir);
        assert.ok(calls() >= 4, 'the rename was tried again after being refused');
        return value;
      });
      assert.notStrictEqual(result, writer.failed, 'the write went through on a later attempt');
      assert.deepStrictEqual(temps(dir), []);
      assert.deepStrictEqual(temps(codexDir), []);
      // Which home a writer uses depends on host detection (CODEX_HOME is set
      // here), so the target may be in either.
      const written = fs.readdirSync(dir).concat(fs.readdirSync(codexDir)).filter((name) => name.startsWith('usage-limits-'));
      assert.ok(written.length >= 1, 'the target file exists');
    }));
}

test('the writers that throw still throw, after removing their temporary file', () =>
  withDirs((dir) => {
    for (const code of ['EPERM', 'EBUSY', 'EACCES', 'EXDEV']) {
      withRefusedRename(code, Infinity, () => {
        assert.throws(() => atomic.writeFileAtomic(path.join(dir, 'usage-limits-x.json'), '{}'), (err) => err.code === code);
      });
      assert.deepStrictEqual(temps(dir), [], code + ' leaves nothing behind');
    }
  }));

test('a code that will not change on retry is not retried', () =>
  withDirs((dir) => {
    withRefusedRename('EXDEV', Infinity, (calls) => {
      assert.strictEqual(atomic.tryWriteFileAtomic(path.join(dir, 'usage-limits-x.json'), '{}'), false);
      assert.strictEqual(calls(), 1);
    });
  }));

test('the retry is bounded well inside a hook budget', () =>
  withDirs((dir) => {
    const started = Date.now();
    withRefusedRename('EBUSY', Infinity, () => atomic.tryWriteFileAtomic(path.join(dir, 'usage-limits-x.json'), '{}'));
    const took = Date.now() - started;
    const planned = atomic.RETRY_DELAYS_MS.reduce((a, b) => a + b, 0);
    assert.ok(planned <= 500, 'the planned waits add up to at most half a second');
    assert.ok(took < 3000, 'took ' + took + ' ms');
  }));

test('a failed write leaves no temporary file either', () =>
  withDirs((dir) => {
    // A directory where the target should be: the rename fails with a code
    // that is not retried, on every platform.
    const target = path.join(dir, 'usage-limits-y.json');
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, 'inside'), 'x');
    assert.strictEqual(atomic.tryWriteFileAtomic(target, '{}'), false);
    assert.deepStrictEqual(temps(dir), []);
  }));

test('the sweep removes only this plugin\'s own temporary files, and only stale ones', () =>
  withDirs((dir, codexDir) => {
    const stale = NOW - atomic.STALE_MS - MINUTE;
    const fresh = NOW - MINUTE;
    const files = {
      // Debris of exactly the shapes found on 2026-09-25.
      'usage-limits-reading.json.20316.tmp': stale,
      'usage-limits-drift.json.34480.tmp': stale,
      'usage-limits-fetch.json.30900.usage-limits-tmp': stale,
      'usage-limits-activity.json.29612.usage-limits-tmp': stale,
      'settings.json.usage-limits-tmp': stale,
      'settings.json.4242.usage-limits-tmp': stale,
      // A live writer's file: too young to touch.
      'usage-limits-pulse.json.21620.usage-limits-tmp': fresh,
      // Not this plugin's, however old.
      'settings.json.4242.tmp': stale,
      'history.jsonl.tmp': stale,
      'usage-limits-reading.json': stale,
      'usage-limits-reading.json.tmp': stale,
      'usage-limits-notes.txt.123.tmp': stale,
      'other-usage-limits-x.json.12.tmp': stale,
    };
    for (const [name, at] of Object.entries(files)) {
      fs.writeFileSync(path.join(dir, name), 'x');
      fs.utimesSync(path.join(dir, name), at / 1000, at / 1000);
    }
    fs.writeFileSync(path.join(codexDir, 'usage-limits-brief.json.77.usage-limits-tmp'), 'x');
    fs.utimesSync(path.join(codexDir, 'usage-limits-brief.json.77.usage-limits-tmp'), stale / 1000, stale / 1000);
    // A directory that happens to match is left alone.
    fs.mkdirSync(path.join(dir, 'odd.usage-limits-tmp'));
    fs.utimesSync(path.join(dir, 'odd.usage-limits-tmp'), stale / 1000, stale / 1000);

    const removed = atomic.sweep([dir, codexDir, dir, path.join(dir, 'missing')], NOW);
    assert.strictEqual(removed, 7);
    assert.deepStrictEqual(fs.readdirSync(dir).sort(), [
      'codex',
      'history.jsonl.tmp',
      'odd.usage-limits-tmp',
      'other-usage-limits-x.json.12.tmp',
      'settings.json.4242.tmp',
      'usage-limits-notes.txt.123.tmp',
      'usage-limits-pulse.json.21620.usage-limits-tmp',
      'usage-limits-reading.json',
      'usage-limits-reading.json.tmp',
    ]);
    assert.deepStrictEqual(fs.readdirSync(codexDir), []);
    assert.strictEqual(atomic.sweep(null, NOW), 0, 'nothing to sweep is not an error');
  }));

test('the prompt hook sweeps stale debris before it answers', () =>
  withDirs((dir, codexDir) => {
    const old = (Date.now() - atomic.STALE_MS - MINUTE) / 1000;
    const orphan = path.join(dir, 'usage-limits-reading.json.20316.tmp');
    const codexOrphan = path.join(codexDir, 'usage-limits-brief.json.77.usage-limits-tmp');
    const young = path.join(dir, 'usage-limits-pulse.json.21620.usage-limits-tmp');
    for (const file of [orphan, codexOrphan, young]) fs.writeFileSync(file, 'x');
    fs.utimesSync(orphan, old, old);
    fs.utimesSync(codexOrphan, old, old);
    const result = spawnSync(process.execPath, [path.join(SCRIPTS, 'brief.js')], {
      input: JSON.stringify({ session_id: 'sweep-test', prompt: 'hello' }),
      encoding: 'utf8',
      timeout: 60 * 1000,
      env: Object.assign({}, process.env, {
        CLAUDE_CONFIG_DIR: dir,
        CODEX_HOME: codexDir,
        // No network from a test.
        USAGE_LIMITS_FETCH: 'off',
      }),
    });
    assert.strictEqual(result.status, 0, result.stderr);
    assert.strictEqual(fs.existsSync(orphan), false, 'the stale temp in the config dir is gone');
    assert.strictEqual(fs.existsSync(codexOrphan), false, 'and the one in the Codex home');
    assert.strictEqual(fs.existsSync(young), true, 'a young one may still be a live writer\'s and stays');
  }));

// The real thing, not a stub: processes racing to replace one file through
// reading.record, the busiest writer the debris came from. On Windows this
// refused thousands of renames in three seconds on 2026-09-25; on other
// platforms a rename onto a busy target just succeeds, and the test still
// holds. Whatever the platform, no process may leave its temporary file.
test('processes racing on one file leave no temporary files behind', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-limits-race-'));
  try {
    const child = [
      "const reading = require(" + JSON.stringify(path.join(SCRIPTS, 'reading.js')) + ");",
      'const end = Date.now() + 1500;',
      'let at = ' + NOW + ';',
      'while (Date.now() < end) {',
      "  reading.record({ key: 'five_hour', percentUsed: 40 + (at % 7), resetsAt: " + (NOW + 3 * 60 * MINUTE) + ", turnsLeft: 50 }, at);",
      '  at += 1000;',
      '}',
    ].join('\n');
    const runs = [];
    for (let i = 0; i < 4; i += 1) {
      runs.push(
        new Promise((resolve) => {
          const proc = spawn(process.execPath, ['-e', child], {
            env: Object.assign({}, process.env, { CLAUDE_CONFIG_DIR: dir }),
            stdio: ['ignore', 'ignore', 'pipe'],
          });
          let stderr = '';
          proc.stderr.on('data', (chunk) => (stderr += chunk));
          proc.on('close', (code) => resolve({ code, stderr }));
        })
      );
    }
    for (const run of await Promise.all(runs)) assert.strictEqual(run.code, 0, run.stderr);
    assert.deepStrictEqual(temps(dir), []);
    const parsed = JSON.parse(fs.readFileSync(path.join(dir, 'usage-limits-reading.json'), 'utf8'));
    assert.ok(parsed.five_hour, 'the file that won is whole');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// A writer added later that renames on its own brings the leak back, so the
// rename lives in one place.
test('no script renames a file except through atomic.js', () => {
  const offenders = [];
  for (const name of fs.readdirSync(SCRIPTS)) {
    if (!name.endsWith('.js') || name === 'atomic.js') continue;
    const source = fs.readFileSync(path.join(SCRIPTS, name), 'utf8');
    if (/\brenameSync\s*\(|\.rename\s*\(/.test(source)) offenders.push(name);
  }
  assert.deepStrictEqual(offenders, []);
});

// The second leak, and the one 60bc2e5 did not cover: the SUITE's own temp
// directories. That commit stopped the `.usage-limits-tmp` files a refused
// rename or a killed hook left behind; it never touched the directories the
// tests themselves make with mkdtempSync. Measured on 2026-09-25 after it
// landed: 82 usage-limits-* folders added to %TEMP% by every full run, with
// 2,774 already piled up.
//
// The rule, checked rather than remembered: a test file that makes a temporary
// directory has to be the thing that removes it - either through
// tools/test-tempdirs.js, which removes them all when the file's process exits,
// or with its own rmSync. A file with neither leaks one directory per run for
// ever, and nothing else in the suite will ever notice.
test('every test file that makes a temporary directory also gets rid of it', () => {
  const dir = path.join(__dirname);
  const offenders = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.test.js')) continue;
    const source = fs.readFileSync(path.join(dir, name), 'utf8');
    if (!/\bmkdtempSync\s*\(/.test(source)) continue;
    const routed = /tempdirs\.(make|track)\s*\(/.test(source);
    const removes = /\brmSync\s*\(/.test(source);
    if (!routed && !removes) offenders.push(name);
  }
  assert.deepStrictEqual(
    offenders,
    [],
    'these test files create temporary directories and never remove them - use tools/test-tempdirs.js'
  );
});

test('the temp-directory helper removes everything it made', () => {
  const tempdirs = require('../tools/test-tempdirs.js');
  const a = tempdirs.make('ul-helper-a-');
  const b = tempdirs.make(path.join(os.tmpdir(), 'ul-helper-b-'));
  // Both forms: a bare prefix and the full template the call sites build. An
  // absolute template joined onto os.tmpdir() again is not a path on Windows.
  assert.ok(fs.existsSync(a) && fs.existsSync(b));
  assert.ok(path.isAbsolute(a) && path.isAbsolute(b));
  assert.strictEqual(path.dirname(a), path.dirname(b));
  // Contents go too, not just an empty directory.
  fs.writeFileSync(path.join(a, 'x.json'), '{}');
  fs.mkdirSync(path.join(b, 'deep', 'deeper'), { recursive: true });
  tempdirs.cleanup();
  assert.strictEqual(fs.existsSync(a), false);
  assert.strictEqual(fs.existsSync(b), false);
  assert.strictEqual(tempdirs.made.size, 0);
  // A second cleanup, and a directory somebody else already removed, are both
  // fine: this runs on process exit, where throwing would be the worst place.
  tempdirs.track(path.join(os.tmpdir(), 'ul-helper-gone-does-not-exist'));
  assert.doesNotThrow(() => tempdirs.cleanup());
});
