'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const host = require('../skills/usage-limits/scripts/host.js');
const usage = require('../skills/usage-limits/scripts/usage.js');
const tempdirs = require('../tools/test-tempdirs.js');

function tempDir(name) {
  const dir = tempdirs.make(path.join(os.tmpdir(), 'usage-limits-' + name + '-'));
  return dir;
}

function withConfigDir(dir, fn) {
  const before = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = dir;
  try {
    return fn();
  } finally {
    if (before === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = before;
  }
}

const WITH_METER = JSON.stringify({
  cachedUsageUtilization: { fetchedAtMs: 1, utilization: { five_hour: { utilization: 3 } } },
});

// What a Claude Code migration leaves behind: real file, real keys, no meter.
const STUB = JSON.stringify({
  firstStartTime: '2026-09-02T00:00:00.000Z',
  machineID: 'abc',
  opusProMigrationComplete: true,
  userID: 'def',
});

test('a config-directory account file carrying the meter is the one used', () => {
  const dir = tempDir('scoped');
  fs.writeFileSync(path.join(dir, '.claude.json'), WITH_METER, 'utf8');

  withConfigDir(dir, () => {
    assert.strictEqual(host.claudeSnapshotFile(), path.join(dir, '.claude.json'));
    assert.strictEqual(host.claudeHasSnapshot(), true);
    assert.strictEqual(usage.accountFile(), path.join(dir, '.claude.json'));
  });
});

// The reported failure. A migration writes ~/.claude/.claude.json holding
// machine ids and no meter. Choosing it because it merely existed reported no
// Claude snapshot, and detection then fell through to Codex and quoted that
// agent's meter in a Claude session.
test('a snapshotless stub never passes for the account file', () => {
  const dir = tempDir('stub');
  const stub = path.join(dir, '.claude.json');
  fs.writeFileSync(stub, STUB, 'utf8');

  withConfigDir(dir, () => {
    assert.notStrictEqual(
      host.claudeSnapshotFile(),
      stub,
      'a file with no cachedUsageUtilization is not a snapshot'
    );
  });
});

test('detection never picks Codex while a Claude snapshot is readable', () => {
  const dir = tempDir('detect');
  fs.writeFileSync(path.join(dir, '.claude.json'), WITH_METER, 'utf8');

  withConfigDir(dir, () => {
    assert.strictEqual(host.detect([], {}), host.CLAUDE);
    // An explicit request still wins; detection is only the fallback.
    assert.strictEqual(host.detect(['--host', 'codex'], {}), host.CODEX);
    assert.strictEqual(host.detect([], { USAGE_LIMITS_HOST: 'codex' }), host.CODEX);
    assert.strictEqual(host.detect(['--host', 'gemini'], {}), host.GEMINI);
    assert.strictEqual(host.detect([], { USAGE_LIMITS_HOST: 'gemini' }), host.GEMINI);
    assert.strictEqual(host.detect([], { ANTIGRAVITY_CLI: '1' }), host.GEMINI);
  });
});
