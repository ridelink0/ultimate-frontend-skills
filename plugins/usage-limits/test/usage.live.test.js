'use strict';

// The live reading and Claude Code's own cache describe the same account. The
// newer of the two is the one to read, and everything downstream - the hook,
// the pulse, the status line, the report - goes through collect(), so this is
// the one place the choice is made.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const usage = require('../skills/usage-limits/scripts/usage.js');
const live = require('../skills/usage-limits/scripts/live.js');
const tempdirs = require('../tools/test-tempdirs.js');

const NOW = Date.parse('2026-09-05T12:00:00.000Z');
const MINUTE = 60 * 1000;

function snapshot(percent) {
  return {
    five_hour: { utilization: percent, resets_at: '2026-09-05T16:00:00.000Z' },
    seven_day: { utilization: 4, resets_at: '2026-09-06T23:00:00.000Z' },
  };
}

function setup(cacheAt, cachePercent) {
  const dir = tempdirs.make(path.join(os.tmpdir(), 'usage-limits-collect-'));
  const account = { oauthAccount: { accountUuid: 'acc', organizationType: 'claude_max' } };
  // An empty object keeps accountFile() on this file: with no snapshot key at
  // all it would fall through to the real ~/.claude.json.
  account.cachedUsageUtilization = {};
  if (cacheAt !== null) {
    account.cachedUsageUtilization = {
      fetchedAtMs: cacheAt,
      accountUuid: 'acc',
      utilization: snapshot(cachePercent),
    };
  }
  fs.writeFileSync(path.join(dir, '.claude.json'), JSON.stringify(account));
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ model: 'claude-opus-5' }));
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

test('a newer live reading is preferred over the cache', () => {
  const dir = setup(NOW - 10 * MINUTE, 40);
  withConfigDir(dir, () => {
    live.writeLive({ fetchedAtMs: NOW - MINUTE, utilization: snapshot(55), accountUuid: 'acc' });
    const collected = usage.collectClaude(NOW);
    assert.strictEqual(collected.utilization.five_hour.utilization, 55);
    assert.strictEqual(collected.snapshotFetchedAt, NOW - MINUTE);
    assert.strictEqual(collected.snapshotAgeMs, MINUTE);
    assert.strictEqual(collected.snapshotSource, 'live');
  });
});

test('an older live reading loses to the cache', () => {
  const dir = setup(NOW - MINUTE, 40);
  withConfigDir(dir, () => {
    live.writeLive({ fetchedAtMs: NOW - 10 * MINUTE, utilization: snapshot(55), accountUuid: 'acc' });
    const collected = usage.collectClaude(NOW);
    assert.strictEqual(collected.utilization.five_hour.utilization, 40);
    assert.strictEqual(collected.snapshotSource, 'cache');
  });
});

test('a live reading for another account is ignored', () => {
  const dir = setup(NOW - 10 * MINUTE, 40);
  withConfigDir(dir, () => {
    live.writeLive({ fetchedAtMs: NOW - MINUTE, utilization: snapshot(55), accountUuid: 'someone-else' });
    const collected = usage.collectClaude(NOW);
    assert.strictEqual(collected.utilization.five_hour.utilization, 40);
    assert.strictEqual(collected.snapshotSource, 'cache');
  });
});

test('a live reading stamped in the future is not trusted as fresher', () => {
  const dir = setup(NOW - MINUTE, 40);
  withConfigDir(dir, () => {
    live.writeLive({ fetchedAtMs: NOW + 5 * MINUTE, utilization: snapshot(55), accountUuid: 'acc' });
    const collected = usage.collectClaude(NOW);
    assert.strictEqual(collected.utilization.five_hour.utilization, 40);
  });
});

test('with no cache at all the live reading is the snapshot', () => {
  const dir = setup(null, null);
  withConfigDir(dir, () => {
    live.writeLive({ fetchedAtMs: NOW - MINUTE, utilization: snapshot(55), accountUuid: 'acc' });
    const collected = usage.collectClaude(NOW);
    assert.strictEqual(collected.utilization.five_hour.utilization, 55);
    assert.strictEqual(collected.snapshotSource, 'live');
  });
});

test('with neither there is no snapshot, as before', () => {
  const dir = setup(null, null);
  withConfigDir(dir, () => {
    const collected = usage.collectClaude(NOW);
    assert.strictEqual(collected.utilization, null);
    assert.strictEqual(collected.snapshotSource, null);
  });
});

test('preferLive is the whole rule, in one place', () => {
  const fresh = { fetchedAtMs: NOW, utilization: snapshot(1), accountUuid: 'acc' };
  assert.strictEqual(usage.preferLive(null, fresh, 'acc', NOW), true);
  assert.strictEqual(usage.preferLive({ fetchedAtMs: NOW - 1 }, fresh, 'acc', NOW), true);
  assert.strictEqual(usage.preferLive({ fetchedAtMs: NOW + 1 }, fresh, 'acc', NOW), false);
  assert.strictEqual(usage.preferLive(null, null, 'acc', NOW), false);
  assert.strictEqual(usage.preferLive(null, { fetchedAtMs: NOW }, 'acc', NOW), false, 'no utilization');
  // An unattributed reading cannot be assigned to a known current account.
  assert.strictEqual(usage.preferLive(null, { fetchedAtMs: NOW, utilization: {} , accountUuid: null }, 'acc', NOW), false);
  assert.strictEqual(usage.preferLive(null, { fetchedAtMs: NOW, utilization: {}, accountUuid: 'x' }, null, NOW), true);
});
